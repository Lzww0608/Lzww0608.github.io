import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { readEventComparison } from '../src/event-comparison-loader.ts';
import { parseEventComparisonDocument } from '../src/event-comparison-schema.ts';
import { createPublicReadingFetcher } from '../src/public-reading-fetch.ts';
import { eventComparisons } from '../src/event-comparison-data.ts';
import { eventTimelineLinks } from '../src/event-timeline-links.ts';
import { eventComparisonRoute } from '../src/event-comparison-route.ts';
import { personTimelineRoute, resolvePersonTimelineRoute } from '../src/person-timeline-route.ts';
import { catalogPeople } from '../src/person-catalog.ts';

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

test('a requested stage and selected books are readable without requesting later stages or treating unrequested evidence as unavailable', async () => {
  const laterChapter = chapters.get('tongjian-v267');
  const laterSource = reference(laterChapter, laterChapter.paragraphs[0]);
  const staged = structuredClone(document);
  staged.sources.push(laterSource);
  staged.stages.push({ id: 'later', title: '后续', sourceIds: [laterSource.id] });
  staged.differences.push({ ...structuredClone(staged.differences[0]), id: 'across', stageId: null,
    evidence: [staged.differences[0].evidence[0], { sourceId: laterSource.id, excerpt: laterChapter.paragraphs[0].original }] });
  const calls = [];
  const result = await readEventComparison({ ...options(), document: staged, apiBase: 'https://api.example',
    request: { stageIds: ['battle'], bookIds: ['old'] }, fetcher: async url => {
      calls.push(url);
      if (!url.endsWith(oldChapter.id)) throw new Error('Unrequested chapter');
      return responseFor(url);
    } });
  assert.deepEqual(calls, [`https://api.example/api/chapters/${oldChapter.id}`]);
  assert.equal(result.page.sources[0].status, 'available');
  for (const source of result.page.sources.slice(1)) {
    assert.equal(source.status, 'pending'); assert.equal(source.reason, 'not-requested');
    assert.equal(Object.hasOwn(source, 'paragraph'), false);
  }
  assert.equal(result.page.stages[1].status, 'pending');
  assert.equal(result.page.stages[0].unavailableCount, 0);
  assert.equal(result.page.differences[0].status, 'pending');
  assert.equal(result.page.differences[1].status, 'pending');
  assert.ok(result.page.differences.every(difference => !Object.hasOwn(difference, 'summary')));
});

test('progress publishes a verified complete paragraph while another requested API chapter remains pending', async () => {
  let release, receivedFast, receivedShell;
  const fast = new Promise(resolve => { receivedFast = resolve; });
  const shell = new Promise(resolve => { receivedShell = resolve; });
  const updates = [];
  const loading = readEventComparison({ ...options(), apiBase: 'https://api.example', request: { stageIds: ['battle'] },
    onProgress: progress => {
      updates.push(progress);
      receivedShell();
      if (progress.page.sources[0].status === 'available') receivedFast();
    }, fetcher: async url => url.endsWith(newChapter.id) ? new Promise(resolve => { release = () => resolve(responseFor(url)); }) : responseFor(url) });
  let timer;
  await Promise.race([shell, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
  clearTimeout(timer);
  assert.ok(updates.length > 0, 'pending page must be published before the whole batch finishes');
  await fast;
  const partial = updates.at(-1);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.page.sources[0].paragraph, oldParagraph);
  assert.equal(partial.page.sources[1].status, 'pending');
  assert.equal(partial.page.sources[1].reason, 'loading');
  assert.equal(partial.page.differences[0].status, 'pending');
  release();
  const result = await loading;
  assert.equal(updates.at(-1).complete, true);
  assert.equal(result.page.differences[0].status, 'available');
});

test('explicit difference verification requests every evidence source including unselected books and retains API suspension', async () => {
  const calls = [];
  const result = await readEventComparison({ ...options(), apiBase: 'https://api.example',
    request: { stageIds: ['battle'], bookIds: ['old'], differenceIds: ['narrative'] }, fetcher: async url => {
      calls.push(url); return url.endsWith(newChapter.id) ? new Response('', { status: 500 }) : responseFor(url);
    } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.startsWith('https://api.example')));
  assert.equal(result.page.sources[1].status, 'unavailable');
  assert.equal(result.page.differences[0].status, 'unavailable');
  assert.equal(Object.hasOwn(result.page.differences[0], 'summary'), false);
});

test('incremental difference proof preserves current readable paragraphs and requests only missing evidence chapters', async () => {
  const initial = (await readEventComparison({ ...options(), apiBase: 'https://api.example',
    request: { stageIds: ['battle'], bookIds: ['old'] }, fetcher: async url => responseFor(url) })).page;
  const calls = [], updates = [];
  const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', previousPage: initial,
    request: { differenceIds: ['narrative'] }, onProgress: update => updates.push(update), fetcher: async url => {
      calls.push(url); return url.endsWith(newChapter.id) ? new Response('', { status: 500 }) : responseFor(url);
    } });
  assert.deepEqual(calls, [`https://api.example/api/chapters/${newChapter.id}`]);
  assert.ok(updates.length >= 2);
  assert.ok(updates.every(update => update.page.sources[0].status === 'available'));
  assert.deepEqual(result.page.sources[0].paragraph, initial.sources[0].paragraph);
  assert.equal(result.page.sources[1].status, 'unavailable');
  assert.equal(result.page.differences[0].status, 'unavailable');
});

test('an incremental response remains authoritative for previously readable paragraphs from the same chapter', async () => {
  const extraParagraph = oldChapter.paragraphs.find(paragraph => paragraph.id === 'old-v027-p17');
  const expanded = structuredClone(document);
  expanded.sources.push(reference(oldChapter, extraParagraph));
  expanded.stages[0].sourceIds.push(extraParagraph.id);
  const initial = (await readEventComparison({ ...options(), document: expanded, apiBase: 'https://api.example',
    request: { sourceIds: [oldParagraph.id] }, fetcher: async url => responseFor(url) })).page;
  const changed = structuredClone(oldChapter);
  changed.paragraphs = changed.paragraphs.filter(paragraph => paragraph.id !== oldParagraph.id);
  const calls = [];
  const result = await readEventComparison({ ...options(), document: expanded, apiBase: 'https://api.example', previousPage: initial,
    request: { sourceIds: [extraParagraph.id] }, fetcher: async url => { calls.push(url); return Response.json(changed); } });
  assert.equal(result.page.sources[0].status, 'unavailable');
  assert.equal(result.page.sources[0].source, 'api');
  assert.equal(result.page.sources[0].reason, 'stale-original');
  assert.equal(result.page.sources[2].status, 'available');
  assert.equal(result.page.differences[0].status, 'unavailable');
  assert.deepEqual(calls, [`https://api.example/api/chapters/${oldChapter.id}`]);
});

test('partial requests reject unknown scopes and mismatched snapshots before reading chapters', async () => {
  const initial = (await readEventComparison({ ...options(), fetcher: async url => responseFor(url) })).page;
  for (const request of [{ stageIds: ['missing'] }, { bookIds: ['private'] }, { sourceIds: ['missing'] },
    { differenceIds: ['missing'] }, { stageIds: ['battle', 'battle'] }, { private: true }]) {
    let calls = 0;
    await assert.rejects(readEventComparison({ ...options(), request, fetcher: async () => { calls++; return Response.json(oldChapter); } }), /Invalid comparison request/);
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(readEventComparison({ ...options(), request: { differenceIds: ['narrative'] },
    previousPage: { ...initial, document: { ...initial.document, summary: '另一份资料' } },
    fetcher: async () => { calls++; return Response.json(oldChapter); } }), /Mismatched comparison snapshot/);
  assert.equal(calls, 0);
});

test('an API body timeout after received headers pauses proof without fetching the archive', async () => {
  const urls = [];
  const current = createPublicReadingFetcher(async () => new Response(new ReadableStream({ start() {} })));
  const result = await readEventComparison({ ...options(), apiBase: 'https://api.example', request: { sourceIds: [oldParagraph.id] },
    fetcher: async (url, init) => {
      urls.push(url);
      return url.startsWith('https://api.example') ? current(url, { ...init, signal: AbortSignal.timeout(10) }) : responseFor(url);
    } });
  assert.deepEqual(urls, [`https://api.example/api/chapters/${oldChapter.id}`]);
  assert.equal(result.page.sources[0].status, 'unavailable');
  assert.equal(result.page.sources[0].source, 'api');
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

const comparisonComponent = await transform(readFileSync(new URL('../src/EventComparison.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env.BASE_URL': '"/"' },
});
const componentDocument = eventComparisons.find(document => document.id === 'huliu');
const componentPage = (await readEventComparison({ ...options(), document: componentDocument, fetcher: async url => responseFor(url) })).page;
function renderComparisonState(previous = {}, destination = {}) {
  const captured = {}, previousDocument = previous.document ?? componentDocument;
  const previousStageId = previous.stageId ?? previousDocument.stages[0].id;
  const previousBooks = previous.books ?? ['old', 'new', 'tongjian'];
  const previousRoute = previous.route ?? eventComparisonRoute(previousDocument.id, previousStageId);
  const previousKey = JSON.stringify([previousDocument, previousStageId, previousBooks, [], previous.retry ?? 0, previousRoute, previous.entryId ?? 'entry-one']);
  const nextDocument = destination.document ?? previousDocument, nextStageId = destination.stageId ?? previousStageId;
  const nextRoute = destination.route ?? eventComparisonRoute(nextDocument.id, nextStageId);
  const nextBooks = destination.books ?? previousBooks;
  const page = previous.page ?? componentPage;
  let stateIndex = 0;
  const modules = {
    react: { ...React, useState: initial => {
      const index = stateIndex++;
      if (index === 0) return [initial && typeof initial === 'object' && 'page' in initial ? { key: previousKey, page } : page, () => {}];
      if (index === 1) return [initial && typeof initial === 'object' ? { key: previousKey, state: previous.state ?? 'ready' } : previous.state ?? 'ready', () => {}];
      if (index === 2) return [destination.retry ?? previous.retry ?? 0, () => {}];
      if (index === 3) return [[], () => {}];
      if (index === 4) return ['loading', () => {}];
      if (index === 5) return [0, () => {}];
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    }, useMemo: callback => callback(), useRef: value => ({ current: value }), useEffect: () => {} },
    '@phosphor-icons/react': { ArrowLeft: () => null, CaretDown: () => null, CaretUp: () => null },
    './CollapsibleSidebar': { useSidebarState: () => ({ collapsed: false, toggle: () => {} }), CollapsibleSidebar: ({ children }) => React.createElement('aside', null, children) },
    './OriginalParagraph': { OriginalParagraph: ({ paragraph }) => React.createElement('p', { 'data-current-paragraph': paragraph.id }, paragraph.original) },
    './history-api': { historyApiBase: 'https://api.example' },
    './event-comparison-loader': { readEventComparison },
    './event-comparison-route': { eventComparisonRoute },
    './person-timeline-route': { personTimelineRoute, resolvePersonTimelineRoute },
    './use-reading-position': { useReadingPosition: value => { captured.position = value; }, useReadingView: () => [{ selectedBooks: nextBooks, expandedTranslations: {}, fontSize: 20 }, () => {}] },
    './use-reading-progress': { pendingReadingResume: () => null, useReadingProgress: value => { captured.progress = value; return { ready: value.ready, stale: false }; } },
    './reading-navigation-state': { readingNavigation: { current: () => ({ id: destination.entryId ?? 'entry-one', route: nextRoute }) } },
    './event-timeline-links-loader': { readComparisonTimelineLinks: () => { throw new Error('SSR never starts effects'); } },
    './event-timeline-links': { eventTimelineLinks }, './person-catalog': { catalogPeople },
    './use-original-script': { useOriginalScript: () => ({ script: 'traditional', displayScript: 'traditional', selectScript: () => {} }) },
    './event-comparison.css': {},
  };
  const module = { exports: {} }, nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(comparisonComponent.code, { module, exports: module.exports, require: name => modules[name] ?? nativeRequire(name) });
  const element = module.exports.EventComparison({ document: nextDocument, stageId: nextStageId, route: nextRoute, go: () => {}, onReadSource: () => {} });
  return { ...captured, html: renderToStaticMarkup(element) };
}

test('a new phase, document, book selection, retry or history entry cannot restore from the previous completed comparison on its first render', () => {
  const destinations = [{ stageId: componentDocument.stages[1].id }, { document: eventComparisons.find(document => document.id === 'jinyang'), stageId: 'relief' },
    { books: ['old'] }, { retry: 1 }, { entryId: 'entry-two' }];
  for (const destination of destinations) for (const state of ['ready', 'error']) {
    const rendered = renderComparisonState({ state }, destination);
    assert.equal(rendered.progress.ready, false);
    assert.equal(rendered.position.ready, false);
    assert.match(rendered.html, /data-read-state="loading"/);
    assert.doesNotMatch(rendered.html, /data-current-paragraph=/);
  }
});

test('the final current phase can restore before timeline proof finishes and renders only that phase', () => {
  const rendered = renderComparisonState();
  assert.equal(rendered.progress.ready, true);
  assert.equal(rendered.position.ready, true);
  assert.equal(rendered.position.targetId, `comparison-stage-${componentDocument.stages[0].id}`);
  assert.equal([...rendered.html.matchAll(/class="comparison-stage"/g)].length, 1);
  for (const stage of componentDocument.stages) assert.ok(rendered.html.includes(stage.title));
  const stageButtons = [...rendered.html.matchAll(/data-timeline-person="[^"]+"[^>]*>/g)];
  assert.ok(stageButtons.length > 0);
  assert.ok(stageButtons.every(match => match[0].includes('disabled=""')));
});
