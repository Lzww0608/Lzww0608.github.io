import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { readPersonTimeline } from '../src/person-timeline-loader.ts';
import { parsePersonTimelineDocument, parsePersonTimelineResponse } from '../src/person-timeline-schema.ts';
import { hasPersonTimeline, personTimelineRoute, resolvePersonTimelineRoute } from '../src/person-timeline-route.ts';
import { chapterRoute, libraryChapters, resolveReadingRoute, resolveRoute } from '../src/library.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const library = loadLibrary(), allChapters = loadPublishedChapters(library);
const source = allChapters.find(chapter => chapter.id === 'old-v025');
const paragraph = source.paragraphs.find(paragraph => paragraph.id === 'old-v025-p2');
const reference = { chapterId: source.id, paragraphId: paragraph.id, originalRevision: paragraph.revision,
  originalSha256: hash(paragraph.original), excerpt: [...paragraph.original].slice(0, 70).join('') };
const event = { id: 'fixture-keyong-birth', year: 856, sortOrder: 1, title: '出生记载', summary: '底本记述李克用的出生与家世。',
  sourceDate: '大中十年', precision: 'year', phase: 'early', evidence: [reference] };
const document = { schemaVersion: 1, scope: 'current-archive', personId: 'li-keyong', events: [event] };
const resolvedReference = { ...reference, bookId: source.bookId, bookTitle: source.bookTitle, chapterTitle: source.title, paragraph };
const response = { ...document, events: [{ ...event, evidence: [resolvedReference] }], unavailableCount: 0, resultSetRevision: hash('fixture-version') };
const options = { personId: document.personId, apiBase: '', archiveBase: '/', signal: new AbortController().signal };
const archive = async (url, inputDocument = document, inputSource = source) => {
  if (url.endsWith(`/person-timelines/${document.personId}.json`)) return Response.json(inputDocument);
  if (url.endsWith(`/chapters/${source.id}.json`)) return Response.json(inputSource);
  return new Response('', { status: 404 });
};

test('every real timeline document remains readable with exact canonical sources and complete published translations when the API is offline', async () => {
  const root = new URL('../../content/person-timelines/', import.meta.url);
  const documents = readdirSync(root).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(new URL(file, root), 'utf8')));
  assert.deepEqual(new Set(documents.map(document => document.personId)), new Set(['li-keyong', 'li-cunxu']));
  const chapters = new Map(allChapters.map(chapter => [chapter.id, chapter]));
  for (const document of documents) {
    const result = await readPersonTimeline({ ...options, personId: document.personId, fetcher: async url => {
      if (url.endsWith(`/person-timelines/${document.personId}.json`)) return Response.json(document);
      const chapterId = /\/chapters\/([a-z0-9-]+)\.json$/.exec(url)?.[1];
      return chapterId && chapters.has(chapterId) ? Response.json(chapters.get(chapterId)) : new Response('', { status: 404 });
    } });
    assert.equal(result.source, 'archive');
    assert.equal(result.page.unavailableCount, 0);
    assert.deepEqual(result.page.events.map(event => event.id), document.events.map(event => event.id));
    for (const event of result.page.events) for (const evidence of [...event.evidence, ...(event.variants?.flatMap(variant => variant.evidence) ?? [])]) {
      const canonical = chapters.get(evidence.chapterId).paragraphs.find(paragraph => paragraph.id === evidence.paragraphId);
      assert.deepEqual(evidence.paragraph, canonical);
      assert.ok(evidence.paragraph.translation?.text, `${event.id}: ${evidence.paragraphId} has a complete published translation`);
      assert.equal(hash(evidence.paragraph.original), evidence.originalSha256);
    }
  }
});

test('offline timeline resolves the original paragraph and complete published translation without altering either', async () => {
  const before = JSON.stringify(source), previews = [];
  const result = await readPersonTimeline({ ...options, onArchive: page => previews.push(page), fetcher: url => archive(url) });
  assert.equal(result.source, 'archive');
  assert.equal(previews.length, 1);
  assert.equal(result.page.events[0].evidence[0].paragraph.id, paragraph.id);
  assert.deepEqual(result.page.events[0].evidence[0].paragraph.translation, paragraph.translation);
  assert.equal(result.page.events[0].evidence[0].excerpt, reference.excerpt);
  assert.equal(JSON.stringify(source), before);
});

test('latest valid API translations win over static copies and change the result snapshot', async () => {
  const latest = structuredClone(response);
  latest.events[0].evidence[0].paragraph.translation = { ...paragraph.translation, id: 'fixture-new-version', version: paragraph.translation.version + 1, text: `${paragraph.translation.text}校订说明。` };
  latest.resultSetRevision = hash(JSON.stringify(latest.events));
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: async (url, init) => {
    assert.equal(init.credentials, 'omit');
    return url.startsWith('https://api.example') ? Response.json(latest) : archive(url);
  } });
  assert.equal(result.source, 'api');
  assert.equal(result.page.events[0].evidence[0].paragraph.translation.id, 'fixture-new-version');
  assert.notEqual(result.page.resultSetRevision, response.resultSetRevision);
});

test('successful empty or suspended API timelines are authoritative and cannot preview an older archive after responding', async () => {
  const empty = { ...response, events: [], unavailableCount: 1, resultSetRevision: hash('paused') }, previews = [];
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', onArchive: value => previews.push(value),
    fetcher: url => url.startsWith('https://api.example') ? Promise.resolve(Response.json(empty)) : archive(url) });
  assert.equal(result.source, 'api');
  assert.deepEqual(result.page.events, []);
  assert.equal(result.page.unavailableCount, 1);
  assert.deepEqual(previews, []);
});

test('responding API errors, unknown people, malformed JSON and invalid bindings cannot revive static events', async () => {
  const invalid = structuredClone(response);
  invalid.events[0].evidence[0].paragraph.original += '来源已变化。';
  for (const apiResponse of [new Response('', { status: 404 }), new Response('', { status: 500 }),
    new Response('{bad'), Response.json(invalid), Response.json({ ...response, personId: 'li-cunxu' })]) {
    await assert.rejects(readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: url =>
      url.startsWith('https://api.example') ? Promise.resolve(apiResponse) : archive(url) }), /could not be verified/);
  }
});

test('network loss falls back to independently bound archive sources, and navigation cancellation stops callbacks', async () => {
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: url => {
    if (url.startsWith('https://api.example')) throw new TypeError('Network unavailable');
    return archive(url);
  } });
  assert.equal(result.source, 'archive');
  const controller = new AbortController(), previews = [];
  await assert.rejects(readPersonTimeline({ ...options, signal: controller.signal, onArchive: page => previews.push(page), fetcher: async url => {
    controller.abort(); return archive(url);
  } }), error => error.name === 'AbortError');
  assert.deepEqual(previews, []);
});

test('changed originals pause the whole event, including an independently stale variant', async () => {
  for (const mutate of [value => value.events[0].evidence[0].originalRevision++, value => {
    value.events[0].variants = [{ label: '另书异文', sourceDate: '大中十年', year: 856,
      summary: '另一来源的记载单独列出。', notes: ['保留来源差异。'], evidence: [{ ...reference, originalSha256: '0'.repeat(64) }] }];
  }]) {
    const changed = structuredClone(document); mutate(changed);
    const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, changed) });
    assert.deepEqual(result.page.events, []);
    assert.equal(result.page.unavailableCount, 1);
  }
});

test('a source without a matching nonblank published translation pauses its whole event and cannot validate an API event', async () => {
  for (const translation of [null, { ...paragraph.translation, text: '' }, { ...paragraph.translation, text: '   ' }]) {
    const missing = structuredClone(source);
    missing.paragraphs.find(item => item.id === reference.paragraphId).translation = translation;
    assert.equal(hash(missing.paragraphs.find(item => item.id === reference.paragraphId).original), reference.originalSha256);
    const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, document, missing) });
    assert.deepEqual(result.page.events, []);
    assert.equal(result.page.unavailableCount, 1);
    const incomplete = structuredClone(response);
    incomplete.events[0].evidence[0].paragraph.translation = translation;
    await assert.rejects(parsePersonTimelineResponse(incomplete, document.personId));
  }
  const completeParagraph = source.paragraphs.find(item => item.id !== reference.paragraphId);
  const completeReference = { chapterId: source.id, paragraphId: completeParagraph.id, originalRevision: completeParagraph.revision,
    originalSha256: hash(completeParagraph.original), excerpt: [...completeParagraph.original].slice(0, 40).join('') };
  const variantOnlyMissing = structuredClone(document);
  variantOnlyMissing.events[0].evidence = [completeReference];
  variantOnlyMissing.events[0].variants = [{ label: '另一来源的记载', sourceDate: '大中十年', evidence: [reference] }];
  const missing = structuredClone(source);
  missing.paragraphs.find(item => item.id === reference.paragraphId).translation = null;
  const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, variantOnlyMissing, missing) });
  assert.deepEqual(result.page.events, []);
  assert.equal(result.page.unavailableCount, 1);
});

test('timeline schema rejects duplicate events, unknown phases, guessed dates, ordering and forged evidence', async () => {
  assert.equal(parsePersonTimelineDocument(document, document.personId).events.length, 1);
  for (const mutate of [value => value.events.push(value.events[0]), value => value.events[0].precision = 'approximate',
    value => value.events[0].phase = 'unknown', value => value.events[0].year = -1,
    value => value.events[0].evidence[0].chapterId = 'old-not-existing',
    value => value.events[0].evidence[0].paragraphId = 'new-v04-p1',
    value => value.events.push({ ...value.events[0], id: 'earlier-fixture', year: 855 }),
    value => value.events.push({ ...value.events[0], id: 'same-order-fixture' })]) {
    const invalid = structuredClone(document); mutate(invalid);
    assert.throws(() => parsePersonTimelineDocument(invalid, document.personId));
  }
  for (const mutate of [value => value.events[0].evidence[0].paragraph.revision++, value => value.events[0].evidence[0].excerpt = '不是原文的引文。',
    value => value.events[0].evidence[0].bookTitle = '其他书籍', value => value.events[0].evidence[0].chapterTitle = '其他章节',
    value => value.events[0].evidence[0].paragraph.id = 'old-v025-p3', value => value.unavailableCount = -1]) {
    const invalid = structuredClone(response); mutate(invalid);
    await assert.rejects(parsePersonTimelineResponse(invalid, document.personId));
  }
});

test('person timeline routes expose only real registered timelines and retain a safe exact-event reader return', () => {
  const summary = JSON.parse(readFileSync(new URL('../src/person-timeline-summary.json', import.meta.url), 'utf8'));
  const entry = summary.people.find(person => person.personId === 'li-keyong');
  const route = personTimelineRoute(entry.personId, entry.eventIds[0]);
  assert.equal(hasPersonTimeline('li-keyong'), true);
  assert.equal(hasPersonTimeline('li-cunxu'), true);
  assert.equal(hasPersonTimeline('zhu-wen'), false);
  assert.equal(resolveRoute(`#${route}`), route);
  assert.equal(resolvePersonTimelineRoute(route).person.id, 'li-keyong');
  const chapter = libraryChapters.find(chapter => chapter.id === 'old-v025');
  const read = chapterRoute(chapter, { query: '', field: 'both', paragraphId: paragraph.id, returnTo: route });
  assert.equal(resolveReadingRoute(read).returnTo, route);
  assert.equal(resolveReadingRoute(read).focusParagraphId, paragraph.id);
  for (const invalid of ['https://evil.example', 'person-timeline/zhu-wen', 'person-timeline/li-keyong/extra',
    'person-timeline/li-keyong?event=https://evil.example', 'person-timeline/li-keyong?event=not-registered',
    `person-timeline/li-keyong?event=${entry.eventIds[0]}&event=${entry.eventIds[0]}`, 'person-timeline/li-keyong?token=secret']) {
    assert.equal(resolvePersonTimelineRoute(invalid), null);
    assert.equal(resolveReadingRoute(`read-old/${chapter.id}?return=${encodeURIComponent(invalid)}`).returnTo, undefined);
  }
});
