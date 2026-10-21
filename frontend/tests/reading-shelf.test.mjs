import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadingShelfStore, READING_SHELF_STORAGE_KEY, READING_SHELF_APP, READING_SHELF_LIMITS,
  parseReadingShelfJson, parseReadingShelfRoute, normalizeReadingShelfRoute, inferReadingPerson, readingProgressId,
  paragraphBookmarkId, eventBookmarkId, bookmarkRoute, progressResumeRoute, describeBookmark, describeProgress,
  verifyParagraphBookmark, verifyEventBookmark } from '../src/reading-shelf.ts';
import { loadOriginalConverter, originalParagraphs } from '../src/original-script.ts';
import { timelineHash } from '../src/person-timeline-schema.ts';
import { timelineEventIdentity } from '../src/event-timeline-links-schema.ts';
import { eventComparisons } from '../src/event-comparison-data.ts';
import { libraryBooks, libraryChapters, resolveReadingRoute, resolveRoute } from '../src/library.ts';

const date = '2026-01-01T00:00:00.000Z';
const later = '2026-01-02T00:00:00.000Z';
const sha = 'a'.repeat(64);
const chapterId = 'old-v027', paragraphId = 'old-v027-p18', personId = 'li-cunxu';
const paragraph = { id: paragraphId, position: 18, revision: 1, original: '原文只用于现场核验，不存入阅读文件。', translation: null };
const route = `read-old/${chapterId}?paragraph=${paragraphId}`;
const timeline = JSON.parse(await fs.readFile(new URL('../../content/person-timelines/li-cunxu.json', import.meta.url), 'utf8'));
const event = timeline.events.find(item => item.id === 'li-cunxu-baixiang');
const document = (progress = [], bookmarks = []) => ({ schemaVersion: 1, app: READING_SHELF_APP, progress, bookmarks });
const progress = (overrides = {}) => ({ id: readingProgressId(route, personId), route, personId, updatedAt: date,
  position: { scrollY: 4200, anchorId: paragraphId, offset: -700, details: { [`${paragraphId}/details/0`]: true } },
  view: { fontSize: 24, expandedTranslations: { [paragraphId]: true } },
  binding: { kind: 'paragraph', chapterId, paragraphId, originalRevision: 1, originalSha256: sha }, ...overrides });
function storage(initial = null) {
  let data = initial;
  return { getItem: key => key === READING_SHELF_STORAGE_KEY ? data : null,
    setItem: (key, value) => { assert.equal(key, READING_SHELF_STORAGE_KEY); data = value; }, raw: () => data };
}
function create(initial = null, options = {}) {
  const backing = storage(initial);
  return { store: createReadingShelfStore({ storage: backing, clock: () => date, events: null, ...options }), backing };
}

test('actual catalog leaf routes retain public search and strip only verified live returns', () => {
  const comparison = 'event-comparison/baixiang?stage=battle';
  assert.equal(normalizeReadingShelfRoute(`${route}&return=${encodeURIComponent(comparison)}`), route);
  assert.equal(parseReadingShelfRoute(`${route}&return=${encodeURIComponent(comparison)}`), null);
  const sources = 'person-sources/li-cunxu/old?q=%E6%9F%8F%E4%B9%A1&field=both';
  assert.equal(normalizeReadingShelfRoute(sources), sources);
  assert.equal(parseReadingShelfRoute(sources).query, '柏乡');
  assert.equal(normalizeReadingShelfRoute('read-old'), 'read-old/old-v001');
  assert.equal(parseReadingShelfRoute('read-old'), null);
  for (const bad of ['owner-review', 'https://evil.example/x', '//evil.example/x', 'read-old/old-v027?paragraph=old-v027-p99999',
    'read-old/old-v027?paragraph=old-v027-p018', 'read-old/old-v027?field=wrong', 'read-old/old-v027?q=x&private=1',
    'read-old/old-v027?q=x&q=y', 'person-sources/li-cunxu/old?field=private', 'person-sources/li-cunxu/old?q=x?more=y',
    'person-timeline/li-cunxu?event=zhou-dewei-baixiang', 'event-comparison/huliu?stage=missing',
    `${route}&return=${encodeURIComponent('owner-review')}`, `${route}&return=${encodeURIComponent('person-sources/li-cunxu?private=secret')}`]) {
    assert.equal(parseReadingShelfRoute(bad, true), null, bad);
  }
});

test('actual Shiguo Chunqiu catalog routes and paragraph bookmarks remain distinct from Wudai Chunqiu', async () => {
  const book = libraryBooks.find(book => book.id === 'shiguochunqiu');
  const chapter = libraryChapters.find(chapter => chapter.id === 'shiguochunqiu-v004');
  assert.ok(book, 'The actual public Shiguo Chunqiu book must be integrated before release.');
  assert.ok(chapter, 'The actual complete volume 004 must be integrated before release.');
  assert.equal(chapter.bookId, book.id);
  assert.equal(book.defaultChapter, chapter.id);
  const archived = JSON.parse(await fs.readFile(new URL(`../../content/five-dynasties/chapters/${chapter.id}.json`, import.meta.url), 'utf8'));
  const original = archived.paragraphs[0];
  const target = `read-${book.id}/${chapter.id}?paragraph=${original.id}`;
  assert.equal(resolveRoute(`#${target}`), target);
  assert.equal(resolveReadingRoute(target).focusParagraphId, original.id);
  assert.equal(normalizeReadingShelfRoute(`read-${book.id}`), `read-${book.id}/${chapter.id}`);
  assert.equal(parseReadingShelfRoute(target).chapterId, chapter.id);
  assert.equal(resolveReadingRoute(`read-chunqiu/${chapter.id}`), null);
  assert.equal(parseReadingShelfRoute(`read-${book.id}/${chapter.id}?paragraph=${chapter.id}-p${chapter.paragraphCount + 1}`), null);
  assert.equal(parseReadingShelfRoute(`read-unknown/${chapter.id}`), null);
  for (const existing of libraryBooks.filter(book => book.id !== 'shiguochunqiu')) {
    assert.equal(resolveReadingRoute(`read-${existing.id}`).chapter.id, existing.defaultChapter);
  }
  const { store } = create();
  await store.toggleParagraphBookmark({ chapterId: chapter.id, paragraph: original });
  const saved = store.getSnapshot().bookmarks[0];
  assert.equal(bookmarkRoute(saved), target);
  assert.equal(await verifyParagraphBookmark(saved, original), true);
  assert.equal(await verifyParagraphBookmark(saved, { ...original, original: `${original.original}改` }), false);
  const restored = create();
  restored.store.mergeImport(restored.store.previewImport(store.exportJson()));
  assert.equal(bookmarkRoute(restored.store.getSnapshot().bookmarks[0]), target);
  assert.ok(!store.exportJson().includes(original.original));
});

test('actual Ma Ling book routes, exact paragraph bookmarks and script switching stay distinct from Lu You', async () => {
  const book = libraryBooks.find(b => b.id === 'nantangma');
  const chapter = libraryChapters.find(c => c.id === 'nantangma-v010');
  assert.ok(book && chapter, 'The complete fixed Ma Ling volume must be integrated before release.');
  const archived = JSON.parse(await fs.readFile(new URL('../../content/five-dynasties/chapters/nantangma-v010.json', import.meta.url), 'utf8'));
  const original = archived.paragraphs[3], before = structuredClone(original);
  const target = 'read-nantangma/nantangma-v010?paragraph=' + original.id;
  assert.equal(book.defaultChapter, chapter.id);
  assert.equal(resolveRoute('#' + target), target);
  assert.equal(resolveReadingRoute(target).focusParagraphId, original.id);
  assert.equal(normalizeReadingShelfRoute('read-nantangma'), 'read-nantangma/nantangma-v010');
  assert.equal(parseReadingShelfRoute(target).chapterId, chapter.id);
  assert.equal(resolveReadingRoute('read-nantanglu/nantangma-v010'), null);
  assert.equal(parseReadingShelfRoute('read-nantangma/nantangma-v010?paragraph=nantangma-v010-p18'), null);
  const { store } = create(); await store.toggleParagraphBookmark({ chapterId: chapter.id, paragraph: original });
  const saved = store.getSnapshot().bookmarks[0];
  assert.equal(bookmarkRoute(saved), target); assert.equal(await verifyParagraphBookmark(saved, original), true);
  assert.equal(await verifyParagraphBookmark(saved, { ...original, original: original.original + '改' }), false);
  const restored = create(); restored.store.mergeImport(restored.store.previewImport(store.exportJson()));
  assert.equal(bookmarkRoute(restored.store.getSnapshot().bookmarks[0]), target);
  const convert = await loadOriginalConverter(), simplified = originalParagraphs([original], 'simplified', convert);
  assert.notEqual(simplified[0].original, original.original); assert.ok(simplified[0].original.includes('𠉀'));
  assert.equal(originalParagraphs([original], 'traditional', convert)[0], original);
  assert.deepEqual(original, before); assert.ok(!store.exportJson().includes(original.original));
});

test('person inference preserves explicit known context and never guesses from chapter subjects', () => {
  assert.equal(inferReadingPerson(route), undefined);
  assert.equal(inferReadingPerson(route, personId), personId);
  assert.equal(inferReadingPerson(route, 'missing'), undefined);
  assert.equal(inferReadingPerson('person-timeline/zhou-dewei', personId), 'zhou-dewei');
  assert.equal(inferReadingPerson('event-comparison/baixiang', 'meng-chang'), undefined);
});

test('metadata round trip restores actual paragraph offset and view without storing original or translation', async () => {
  const { store, backing } = create();
  const input = progress(); delete input.id; delete input.updatedAt;
  store.saveProgress(input);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.equal(store.getProgress(`read-old/${chapterId}`, personId).position.offset, -700);
  assert.deepEqual(store.getSnapshot().progress[0].view, input.view);
  const bookmarkEnabled = await store.toggleParagraphBookmark({ chapterId, paragraph, personId });
  assert.equal(bookmarkEnabled, true);
  const text = store.exportJson();
  assert.ok(!text.includes(paragraph.original));
  assert.ok(!text.includes('translation'));
  assert.ok(!text.includes('return='));
  const restored = createReadingShelfStore({ storage: backing, events: null });
  assert.equal(restored.getLatestProgress(personId).route, route);
  assert.equal(restored.getSnapshot().bookmarks.length, 1);
  assert.equal(progressResumeRoute(restored.getLatestProgress(personId)), route);
  assert.deepEqual(describeProgress(restored.getLatestProgress(personId)), { title: '旧五代史', detail: '李存勖 · 卷 27 · 唐庄宗纪1 · 第 18 段' });
  assert.throws(() => restored.getSnapshot().progress.push(progress()), TypeError);
});

test('paragraph bookmark derives current hash and retains only identity, original binding and person context', async () => {
  const { store } = create();
  await store.toggleParagraphBookmark({ chapterId, paragraph, personId });
  const saved = store.getSnapshot().bookmarks[0];
  assert.equal(saved.id, paragraphBookmarkId(chapterId, paragraphId, personId));
  assert.equal(saved.originalSha256, await timelineHash(paragraph.original));
  assert.equal(bookmarkRoute(saved), route);
  assert.match(describeBookmark(saved).detail, /第 18 段/);
  assert.equal(await verifyParagraphBookmark(saved, paragraph), true);
  assert.equal(await verifyParagraphBookmark(saved, { ...paragraph, revision: 2 }), false);
  assert.equal(await verifyParagraphBookmark(saved, { ...paragraph, original: '修订内容。' }), false);
  assert.equal(await verifyParagraphBookmark(saved, undefined), false);
  assert.equal(store.isParagraphBookmarked(chapterId, paragraphId, personId), true);
  assert.equal(store.isParagraphBookmarked(chapterId, paragraphId, 'zhou-dewei'), false);
  await store.toggleParagraphBookmark({ chapterId, paragraph, personId });
  assert.equal(store.getSnapshot().bookmarks.length, 0);
});

test('event bookmark uses canonical current event facts, excluding resolved source bodies', async () => {
  const { store } = create();
  await store.toggleEventBookmark({ personId, event });
  const saved = store.getSnapshot().bookmarks[0];
  assert.equal(saved.id, eventBookmarkId(personId, event.id));
  assert.equal(saved.eventSha256, await timelineHash(timelineEventIdentity(event)));
  assert.equal(saved.label, event.title);
  assert.equal(bookmarkRoute(saved), `person-timeline/${personId}?event=${event.id}`);
  assert.equal(await verifyEventBookmark(saved, event), true);
  assert.equal(await verifyEventBookmark(saved, { ...event, summary: event.summary + '改动' }), false);
  assert.equal(await verifyEventBookmark(saved, undefined), false);
  const raw = store.exportJson();
  assert.ok(!raw.includes(event.summary));
  assert.ok(!raw.includes(event.evidence[0].excerpt));
});

test('whole import validates before mutation; malicious extra fields never remove existing records', () => {
  const { store } = create(JSON.stringify(document([progress()])));
  const before = store.exportJson();
  for (const bad of [
    { ...document(), token: 'secret' },
    document([{ ...progress(), original: 'private' }]),
    document([{ ...progress(), position: { scrollY: 10, anchorId: 'owner-review', details: {} } }]),
    document([{ ...progress(), view: { fontSize: 24, password: 'secret' } }]),
    document([{ ...progress(), route: 'owner-review', id: 'private' }]),
    document([{ ...progress(), position: { ...progress().position, details: { 'private/details/0': true } } }]),
    document([{ ...progress(), binding: { ...progress().binding, original: 'text' } }]),
    document([{ ...progress(), updatedAt: '9999-01-01T00:00:00.000Z' }]),
    document([progress(), progress()]),
  ]) {
    assert.throws(() => store.previewImport(JSON.stringify(bad)));
    assert.equal(store.exportJson(), before);
  }
  assert.throws(() => store.previewImport('{"schemaVersion":1,"schemaVersion":1,"app":"ancient-history-reading","progress":[],"bookmarks":[]}'));
  assert.throws(() => store.previewImport('{"schemaVersion":1,"schema\\u0056ersion":1,"app":"ancient-history-reading","progress":[],"bookmarks":[]}'));
  assert.throws(() => store.previewImport(' '.repeat(READING_SHELF_LIMITS.bytes + 1)));
  assert.equal(store.exportJson(), before);
});

test('preview can be reviewed without saving, and merge revalidates the reviewed payload', () => {
  const { store, backing } = create();
  const preview = store.previewImport(JSON.stringify(document([progress()])));
  assert.equal(preview.progressCount, 1);
  assert.equal(backing.raw(), null);
  preview.document.progress[0].view.secret = 'private';
  assert.throws(() => store.mergeImport(preview));
  assert.equal(backing.raw(), null);
  assert.equal(store.getSnapshot().progress.length, 0);
});

test('import deduplicates stable targets and keeps newer local progress, including repeated import', () => {
  const { store } = create(JSON.stringify(document([progress({ updatedAt: later })])));
  const old = store.previewImport(JSON.stringify(document([progress()])));
  store.mergeImport(old); store.mergeImport(old);
  assert.equal(store.getSnapshot().progress.length, 1);
  assert.equal(store.getLatestProgress().updatedAt, later);
  const newer = progress({ updatedAt: '2026-01-03T00:00:00.000Z', view: { fontSize: 28 } });
  store.mergeImport(store.previewImport(JSON.stringify(document([newer]))));
  assert.equal(store.getLatestProgress().view.fontSize, 28);
});

test('stale tabs read latest storage before mutation and cannot resurrect a deleted bookmark', async () => {
  const backing = storage();
  const a = createReadingShelfStore({ storage: backing, clock: () => date, events: null });
  const b = createReadingShelfStore({ storage: backing, clock: () => later, events: null });
  await a.toggleParagraphBookmark({ chapterId, paragraph, personId });
  await b.toggleEventBookmark({ personId, event });
  assert.equal(b.getSnapshot().bookmarks.length, 2);
  b.removeBookmark(paragraphBookmarkId(chapterId, paragraphId, personId));
  a.saveProgress({ route, personId, position: { scrollY: 0, details: {} }, view: {} });
  const saved = parseReadingShelfJson(backing.raw());
  assert.equal(saved.bookmarks.length, 1);
  assert.equal(saved.bookmarks[0].kind, 'event');
});

test('storage events refresh without writing old local snapshots back into another tab', async () => {
  const backing = storage(), events = new EventTarget();
  const a = createReadingShelfStore({ storage: backing, clock: () => date, events });
  const b = createReadingShelfStore({ storage: backing, clock: () => later, events: null });
  let changes = 0; a.subscribe(() => changes++);
  await b.toggleParagraphBookmark({ chapterId, paragraph, personId });
  const dispatch = () => { const change = new Event('storage'); Object.assign(change, { key: READING_SHELF_STORAGE_KEY }); events.dispatchEvent(change); };
  dispatch(); assert.equal(a.getSnapshot().bookmarks.length, 1);
  const before = backing.raw(); dispatch(); assert.equal(backing.raw(), before);
  b.removeBookmark(b.getSnapshot().bookmarks[0].id); dispatch();
  assert.equal(a.getSnapshot().bookmarks.length, 0); assert.equal(changes, 2);
  a.destroy(); await b.toggleParagraphBookmark({ chapterId, paragraph, personId }); dispatch();
  assert.equal(a.getSnapshot().bookmarks.length, 0);
});

test('disabled storage and quota fallback keep all active records exportable', async () => {
  const memory = createReadingShelfStore({ storage: null, clock: () => date, events: null });
  await memory.toggleParagraphBookmark({ chapterId, paragraph, personId });
  assert.match(memory.getSnapshot().notice, /暂存于本页/);
  assert.equal(memory.previewImport(memory.exportJson()).bookmarkCount, 1);
  const backing = storage(JSON.stringify(document([progress()])));
  let blocked = true;
  const quota = createReadingShelfStore({ storage: { getItem: backing.getItem, setItem: (key, value) => { if (blocked) throw new DOMException('quota', 'QuotaExceededError'); backing.setItem(key, value); } }, clock: () => date, events: null });
  await quota.toggleParagraphBookmark({ chapterId, paragraph, personId });
  await quota.toggleEventBookmark({ personId, event });
  assert.equal(quota.getSnapshot().bookmarks.length, 2);
  assert.equal(quota.getSnapshot().progress.length, 1);
  assert.match(quota.getSnapshot().notice, /请导出/);
  blocked = false; quota.removeProgress(quota.getSnapshot().progress[0].id);
  assert.equal(parseReadingShelfJson(backing.raw()).bookmarks.length, 2);
  assert.equal(parseReadingShelfJson(backing.raw()).progress.length, 0);
  assert.equal(quota.getSnapshot().notice, null);
});

test('capacity gained by another tab does not throw or discard a previously accepted memory bookmark', async () => {
  const backing = storage(), events = new EventTarget();
  let blocked = true;
  const store = createReadingShelfStore({ storage: { getItem: backing.getItem, setItem: (key, value) => { if (blocked) throw new DOMException('quota', 'QuotaExceededError'); backing.setItem(key, value); } }, clock: () => date, events });
  await store.toggleParagraphBookmark({ chapterId, paragraph, personId });
  const rows = [];
  for (const chapter of libraryChapters) for (let index = 1; index <= chapter.paragraphCount && rows.length < 1000; index++) {
    const id = `${chapter.id}-p${index}`;
    rows.push({ id: paragraphBookmarkId(chapter.id, id), kind: 'paragraph', chapterId: chapter.id, paragraphId: id, originalRevision: 1, originalSha256: sha, savedAt: date });
  }
  assert.equal(rows.length, 1000);
  const raw = JSON.stringify(document([], rows));
  backing.setItem(READING_SHELF_STORAGE_KEY, raw);
  const change = new Event('storage'); Object.assign(change, { key: READING_SHELF_STORAGE_KEY });
  events.dispatchEvent(change);
  assert.equal(store.getSnapshot().bookmarks.length, 1);
  assert.match(store.getSnapshot().notice, /超出容量/);
  assert.equal(backing.raw(), raw);
  assert.equal(store.previewImport(store.exportJson()).bookmarkCount, 1);
  const pendingBookmarkId = store.getSnapshot().bookmarks[0].id;
  blocked = false;
  // Cleanup must run after replaying the accepted add, and before the final
  // atomic capacity gate. Rejecting an intermediate 1001-row set would make
  // the very record that triggered the notice impossible to remove.
  store.removeBookmark(pendingBookmarkId);
  assert.equal(store.getSnapshot().notice, null);
  assert.equal(store.getSnapshot().bookmarks.length, 1000);
  assert.equal(store.getSnapshot().bookmarks.some(item => item.id === pendingBookmarkId), false);
  assert.equal(parseReadingShelfJson(backing.raw()).bookmarks.length, 1000);
  assert.equal(parseReadingShelfJson(backing.raw()).bookmarks.some(item => item.id === pendingBookmarkId), false);
});

test('a corrupt saved document is reported and does not crash the site or expose parser details', () => {
  const { store, backing } = create('{"broken":true}');
  assert.equal(store.getSnapshot().progress.length, 0);
  assert.match(store.getSnapshot().notice, /无法读取/);
  assert.equal(backing.raw(), '{"broken":true}');
  assert.ok(!store.getSnapshot().notice.includes('broken'));
});

test('every persistent anchor must bind the exact identity; arbitrary selectors and different event bindings are rejected', () => {
  const bad = [
    progress({ binding: undefined }),
    progress({ position: { scrollY: 20, anchorId: '#password', details: {} } }),
    progress({ position: { scrollY: 20, anchorId: paragraphId, offset: Infinity, details: {} } }),
    progress({ binding: { ...progress().binding, paragraphId: 'old-v027-p19' } }),
    progress({ view: { fontSize: 31 } }),
    progress({ view: { selectedBooks: ['old'] } }),
  ];
  for (const record of bad) assert.throws(() => parseReadingShelfJson(JSON.stringify(document([record]))));
});

test('comparison records keep three known selected books, real stage and registered source bindings', () => {
  const comparison = eventComparisons.find(document => document.id === 'baixiang');
  const stage = comparison.stages.find(stage => stage.id === 'battle');
  const source = comparison.sources.find(source => source.id === stage.sourceIds[0]);
  const route = 'event-comparison/baixiang?stage=battle';
  const entry = progress({ id: readingProgressId(route, personId), route,
    position: { scrollY: 6700, anchorId: 'comparison-stage-battle', offset: -24, details: {} },
    binding: { kind: 'stage', comparisonId: comparison.id, stageId: stage.id, sourceBindings: [{ sourceId: source.id, chapterId: source.chapterId, paragraphId: source.paragraphId, originalRevision: source.originalRevision, originalSha256: source.originalSha256 }] },
    view: { fontSize: 24, selectedBooks: ['old', 'tongjian', 'huiyao'], expandedTranslations: { [`battle/${source.id}`]: true } } });
  const { store } = create();
  store.mergeImport(store.previewImport(JSON.stringify(document([entry]))));
  assert.equal(progressResumeRoute(store.getLatestProgress()), route);
  assert.equal(describeProgress(store.getLatestProgress()).title, '柏乡之战');
  assert.throws(() => store.previewImport(JSON.stringify(document([{ ...entry, view: { selectedBooks: ['old', 'old'] } }]))));
  assert.throws(() => store.previewImport(JSON.stringify(document([{ ...entry, binding: { ...entry.binding, sourceBindings: [{ ...entry.binding.sourceBindings[0], originalSha256: sha }] } }]))));
});

test('person passage pagination keeps search collection and source revision, rejecting cursor mixtures', () => {
  const route = 'person-sources/li-cunxu/old?q=%E6%9F%8F%E4%B9%A1&field=both';
  const entry = progress({ id: readingProgressId(route, personId), route,
    position: { scrollY: 1400, anchorId: `person-passage-${paragraphId}`, offset: -80, details: { [`person-passage-${paragraphId}/provenance`]: true } },
    view: { fontSize: 23, passages: { cursor: '50', cursors: ['0', '50'], index: 1, source: 'api', resultSetRevision: sha } } });
  const checked = parseReadingShelfJson(JSON.stringify(document([entry]))).progress[0];
  assert.equal(checked.view.passages.cursor, '50');
  assert.equal(parseReadingShelfRoute(progressResumeRoute(checked)).query, '柏乡');
  assert.throws(() => parseReadingShelfJson(JSON.stringify(document([{ ...entry, view: { passages: { ...entry.view.passages, cursor: '0' } } }]))));
  assert.throws(() => parseReadingShelfJson(JSON.stringify(document([{ ...entry, view: { passages: { ...entry.view.passages, cursors: ['0', '0'] } } }]))));
  assert.throws(() => parseReadingShelfJson(JSON.stringify(document([{ ...entry, view: { passages: { ...entry.view.passages, source: 'private' } } }]))));
});
