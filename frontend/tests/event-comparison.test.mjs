import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { readEventComparison } from '../src/event-comparison-loader.ts';
import { parseEventComparisonDocument } from '../src/event-comparison-schema.ts';

const hash = text => createHash('sha256').update(text).digest('hex');
const allChapters = loadPublishedChapters(loadLibrary());
const chapters = new Map(allChapters.map(chapter => [chapter.id, chapter]));
const oldChapter = chapters.get('old-v027'), newChapter = chapters.get('new-v25');
const oldParagraph = oldChapter.paragraphs.find(paragraph => paragraph.id === 'old-v027-p18');
const newParagraph = newChapter.paragraphs.find(paragraph => paragraph.id === 'new-v25-p5');
const reference = (chapter, paragraph) => ({ id: paragraph.id, label: `原篇第 ${paragraph.position} 段`, bookId: chapter.bookId,
  chapterId: chapter.id, paragraphId: paragraph.id, originalRevision: paragraph.revision, originalSha256: hash(paragraph.original) });
const document = { schemaVersion: 1, scope: 'current-archive', id: 'comparison-fixture', title: '柏乡之战测试对读',
  summary: '测试以真实归档段落验证原译绑定。', dateLabel: '原书记日分别保留', personIds: ['li-cunxu'],
  sources: [reference(oldChapter, oldParagraph), reference(newChapter, newParagraph)],
  stages: [{ id: 'battle', title: '会战', summary: '测试阶段说明', sourceIds: [oldParagraph.id, newParagraph.id] }],
  differences: [{ id: 'narrative', stageId: 'battle', title: '测试来源对照', kind: 'perspective', summary: '测试说明须依赖两份有效底本。',
    evidence: [{ sourceId: oldParagraph.id, excerpt: [...oldParagraph.original].slice(0, 65).join('') },
      { sourceId: newParagraph.id, excerpt: [...newParagraph.original].slice(0, 65).join('') }] }] };
const options = () => ({ document, apiBase: '', archiveBase: '/', signal: new AbortController().signal });
function responseFor(url, inputChapters = chapters) {
  const chapterId = /\/chapters\/([a-z0-9-]+)(?:\.json)?$/.exec(url)?.[1];
  return chapterId && inputChapters.has(chapterId) ? Response.json(inputChapters.get(chapterId)) : new Response('', { status: 404 });
}

test('offline comparison retains complete canonical paragraphs and their complete published translations', async () => {
  const before = JSON.stringify([oldChapter, newChapter]);
  const result = await readEventComparison({ ...options(), fetcher: url => responseFor(url) });
  assert.equal(result.page.resultSetRevision.length, 64);
  assert.deepEqual(result.page.sources.map(source => source.id), document.sources.map(source => source.id));
  for (const source of result.page.sources) {
    assert.equal(source.status, 'available');
    assert.equal(source.source, 'archive');
    assert.deepEqual(source.paragraph, chapters.get(source.chapterId).paragraphs.find(paragraph => paragraph.id === source.paragraphId));
    assert.equal(hash(source.paragraph.original), source.originalSha256);
  }
  assert.equal(result.page.differences[0].status, 'available');
  assert.equal(result.page.stages[0].status, 'available');
  for (const evidence of result.page.differences[0].evidence) {
    const original = result.page.sources.find(source => source.id === evidence.sourceId).paragraph.original;
    assert.ok(evidence.originalRanges.length);
    for (const range of evidence.originalRanges) assert.equal([...original].slice(range.start, range.end).join(''), evidence.excerpt);
  }
  assert.equal(JSON.stringify([oldChapter, newChapter]), before);
});

test('a current API translation wins without fetching a stale archive and changes the result revision', async () => {
  const initial = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: url => responseFor(url) });
  const latest = structuredClone(oldChapter), paragraph = latest.paragraphs.find(paragraph => paragraph.id === oldParagraph.id);
  paragraph.translation = { ...paragraph.translation, id: 'latest-owner-version', version: paragraph.translation.version + 1,
    text: `${paragraph.translation.text}测试校订。`, origin: 'human', reviewStatus: 'owner-edited' };
  const urls = [];
  const result = await readEventComparison({ ...options(), apiBase: 'https://api.example/', fetcher: async (url, init) => {
    urls.push(url); assert.equal(init.credentials, 'omit');
    return responseFor(url, new Map([[latest.id, latest], [newChapter.id, newChapter]]));
  } });
  assert.equal(result.page.sources[0].paragraph.translation.id, 'latest-owner-version');
  assert.equal(result.page.sources[0].paragraph.translation.text, paragraph.translation.text);
  assert.equal(result.page.differences[0].status, 'available');
  assert.notEqual(result.page.resultSetRevision, initial.page.resultSetRevision);
  assert.ok(urls.every(url => url.startsWith('https://api.example/api/chapters/')));
});

test('HTTP errors, malformed or empty responding API chapters cannot restore a deployed source', async () => {
  const invalidChapters = [new Response('', { status: 404 }), new Response('', { status: 500 }), new Response('{bad'),
    Response.json({ ...oldChapter, paragraphs: [] }), Response.json({ ...oldChapter, id: newChapter.id }),
    Response.json({ ...oldChapter, bookId: 'new' }), Response.json({ ...oldChapter, paragraphs: [...oldChapter.paragraphs, oldChapter.paragraphs[0]] })];
  for (const invalid of invalidChapters) {
    const urls = [];
    const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: async url => {
      urls.push(url); return url.endsWith(oldChapter.id) ? invalid : responseFor(url);
    } });
    assert.equal(result.page.sources[0].status, 'unavailable');
    assert.equal(result.page.sources[0].source, 'api');
    assert.equal(Object.hasOwn(result.page.sources[0], 'paragraph'), false);
    assert.equal(result.page.sources[1].status, 'available');
    assert.equal(result.page.differences[0].status, 'unavailable');
    assert.equal(Object.hasOwn(result.page.differences[0], 'summary'), false);
    assert.equal(result.page.stages[0].status, 'partial');
    assert.equal(Object.hasOwn(result.page.stages[0], 'summary'), false);
    assert.deepEqual(result.page.stages[0].availableSourceIds, [newParagraph.id]);
    assert.ok(urls.every(url => url.startsWith('https://api.example')));
  }
});

test('changed or removed API originals pause only their sources and every dependent difference', async () => {
  for (const mutate of [chapter => { chapter.paragraphs = chapter.paragraphs.filter(paragraph => paragraph.id !== oldParagraph.id); },
    chapter => { chapter.paragraphs.find(paragraph => paragraph.id === oldParagraph.id).revision++; },
    chapter => { chapter.paragraphs.find(paragraph => paragraph.id === oldParagraph.id).original += '测试来源更改。'; }]) {
    const changed = structuredClone(oldChapter); mutate(changed);
    const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: url =>
      responseFor(url, new Map([[changed.id, changed], [newChapter.id, newChapter]])) });
    assert.equal(result.page.sources[0].status, 'unavailable');
    assert.equal(result.page.sources[0].reason, 'stale-original');
    assert.equal(result.page.sources[1].status, 'available');
    assert.equal(result.page.differences[0].status, 'unavailable');
    assert.deepEqual(result.page.differences[0].unavailableSourceIds, [oldParagraph.id]);
  }
});

test('missing or blank published translations do not expose a source as an independently translated comparison', async () => {
  for (const translation of [null, { ...oldParagraph.translation, text: '' }, { ...oldParagraph.translation, text: '   ' },
    { ...oldParagraph.translation, id: '' }, { ...oldParagraph.translation, language: 'en' }]) {
    const changed = structuredClone(oldChapter);
    changed.paragraphs.find(paragraph => paragraph.id === oldParagraph.id).translation = translation;
    const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: url =>
      responseFor(url, new Map([[changed.id, changed], [newChapter.id, newChapter]])) });
    assert.equal(result.page.sources[0].status, 'unavailable');
    assert.equal(result.page.sources[0].reason, 'missing-translation');
    assert.equal(result.page.sources[1].status, 'available');
    assert.equal(Object.hasOwn(result.page.differences[0], 'summary'), false);
  }
});

test('network loss falls back only for that chapter and can retain current live sources beside static sources', async () => {
  const urls = [];
  const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: async url => {
    urls.push(url);
    if (url === `https://api.example/api/chapters/${newChapter.id}`) throw new TypeError('Network unavailable');
    return responseFor(url);
  } });
  assert.deepEqual(result.page.sources.map(source => source.source), ['api', 'archive']);
  assert.equal(result.page.differences[0].status, 'available');
  assert.ok(urls.includes(`/history/chapters/${newChapter.id}.json`));
  assert.ok(!urls.includes(`/history/chapters/${oldChapter.id}.json`));
  const unavailable = await readEventComparison({ ...options(), apiBase: 'https://api.example', fetcher: async () => { throw new TypeError('Network unavailable'); } });
  assert.ok(unavailable.page.sources.every(source => source.status === 'unavailable' && source.source === 'none'));
  assert.equal(unavailable.page.stages[0].status, 'unavailable');
  assert.equal(Object.hasOwn(unavailable.page.differences[0], 'summary'), false);
});

test('a stale comparison excerpt suspends its conclusion without hiding other valid original and translation paragraphs', async () => {
  const stale = structuredClone(document);
  stale.differences[0].evidence[0].excerpt = '这不是底本中的连续引文。';
  const result = await readEventComparison({ ...options(), document: stale, fetcher: url => responseFor(url) });
  assert.ok(result.page.sources.every(source => source.status === 'available'));
  assert.equal(result.page.differences[0].status, 'unavailable');
  assert.equal(result.page.differences[0].reason, 'stale-evidence');
  assert.equal(Object.hasOwn(result.page.differences[0], 'summary'), false);
});

test('comparison validation rejects forged identities, dangling citations, duplicates, unknown and private fields before fetching', async () => {
  const mutations = [value => value.id = '../private', value => value.personIds.push('not-registered'),
    value => value.personIds.push(value.personIds[0]), value => value.sources.push(value.sources[0]),
    value => value.sources[0].bookId = 'new', value => value.sources[0].chapterId = 'not-archived',
    value => value.sources[0].paragraphId = newParagraph.id, value => value.sources[0].originalRevision = 0,
    value => value.sources[0].originalSha256 = 'not-a-hash', value => value.stages.push(value.stages[0]),
    value => value.stages[0].sourceIds.push('missing-source'), value => value.stages[0].sourceIds.pop(),
    value => value.differences.push(value.differences[0]), value => value.differences[0].stageId = 'missing-stage',
    value => value.differences[0].kind = 'made-up', value => value.differences[0].evidence[0].sourceId = 'missing-source',
    value => value.differences[0].evidence[0].excerpt = ' ', value => value.ownerPassword = 'private',
    value => value.sources[0].translation = { text: 'copied translation' }, value => value.stages[0].privateReview = true,
    value => value.differences[0].humanReviewed = true, value => value.differences[0].evidence[0].privateNote = 'hidden'];
  for (const mutate of mutations) {
    const invalid = structuredClone(document); mutate(invalid);
    assert.throws(() => parseEventComparisonDocument(invalid));
    let requests = 0;
    await assert.rejects(readEventComparison({ ...options(), document: invalid, fetcher: async () => { requests++; return Response.json(oldChapter); } }));
    assert.equal(requests, 0);
  }
  assert.throws(() => parseEventComparisonDocument(document, 'another-event'));
});

test('several references in one chapter share a single request and preserve each complete paragraph', async () => {
  const expanded = structuredClone(document);
  const paragraph = oldChapter.paragraphs.find(paragraph => paragraph.id === 'old-v027-p17');
  expanded.sources.push(reference(oldChapter, paragraph));
  expanded.stages[0].sourceIds.push(paragraph.id);
  const urls = [];
  const result = await readEventComparison({ ...options(), document: expanded, fetcher: async url => { urls.push(url); return responseFor(url); } });
  assert.equal(urls.length, 2);
  assert.equal(urls.filter(url => url.endsWith('old-v027.json')).length, 1);
  assert.deepEqual(result.page.sources[2].paragraph, paragraph);
});

test('cancellation before or during navigation cannot return an older comparison or try an archive', async () => {
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  await assert.rejects(readEventComparison({ ...options(), signal: controller.signal, fetcher: async () => { requests++; return Response.json(oldChapter); } }), error => error.name === 'AbortError');
  assert.equal(requests, 0);
  const pending = new AbortController(), urls = [];
  const reading = readEventComparison({ ...options(), apiBase: 'https://api.example', signal: pending.signal, fetcher: (url, init) => {
    urls.push(url);
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  await new Promise(resolve => setImmediate(resolve));
  pending.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.ok(urls.every(url => url.startsWith('https://api.example')));
});

test('chapter loading is concurrent, bounded, and its resolution order does not alter the snapshot', async () => {
  const selected = [...allChapters.filter(chapter => chapter.bookId === 'old').slice(0, 6), newChapter, chapters.get('tongjian-v267')];
  const many = structuredClone(document);
  many.sources = selected.map(chapter => reference(chapter, chapter.paragraphs[0]));
  many.stages[0].sourceIds = many.sources.map(source => source.id);
  many.differences = [];
  let active = 0, maximum = 0;
  const pending = [];
  const reading = readEventComparison({ ...options(), document: many, apiBase: 'https://api.example', fetcher: url => {
    active++; maximum = Math.max(maximum, active);
    return new Promise(resolve => pending.push(() => { active--; resolve(responseFor(url)); }));
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 6);
  pending.splice(0).reverse().forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
  pending.splice(0).reverse().forEach(resolve => resolve());
  const reversed = await reading;
  assert.equal(maximum, 6);
  assert.deepEqual(reversed.page.sources.map(source => source.id), many.sources.map(source => source.id));
  const straight = await readEventComparison({ ...options(), document: many, apiBase: 'https://api.example', fetcher: url => responseFor(url) });
  assert.equal(reversed.page.resultSetRevision, straight.page.resultSetRevision);
});

test('evidence ranges use Unicode code points and preserve every repeated continuous quote', async () => {
  const modified = structuredClone(oldChapter), paragraph = modified.paragraphs.find(paragraph => paragraph.id === oldParagraph.id);
  // This is a private in-memory fixture; canonical files and translations are unchanged.
  paragraph.original = `𠮷柏鄉。${paragraph.original}柏鄉。`;
  const unicode = structuredClone(document);
  unicode.sources[0].originalSha256 = hash(paragraph.original);
  unicode.differences[0].evidence[0].excerpt = '柏鄉。';
  const result = await readEventComparison({ ...options(), document: unicode, fetcher: url =>
    responseFor(url, new Map([[modified.id, modified], [newChapter.id, newChapter]])) });
  const evidence = result.page.differences[0].evidence[0];
  assert.equal(result.page.differences[0].status, 'available');
  assert.equal(evidence.originalRanges[0].start, 1);
  assert.ok(evidence.originalRanges.length >= 2);
  for (const range of evidence.originalRanges) assert.equal([...paragraph.original].slice(range.start, range.end).join(''), '柏鄉。');
});
