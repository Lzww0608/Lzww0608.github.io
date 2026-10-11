import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import {
  READING_SHELF_APP, READING_SHELF_LIMITS, eventBookmarkId, paragraphBookmarkId,
  parseReadingProgress, parseReadingShelfDocument, parseReadingShelfJson,
  parseReadingShelfRoute, readingProgressId, normalizeReadingShelfRoute,
} from '../src/reading-shelf-schema.ts';
import { libraryChapters, chapterRoute, personSourcesRoute } from '../src/library.ts';
import { eventComparisonRoute } from '../src/event-comparison-route.ts';
import { personTimelineRoute } from '../src/person-timeline-route.ts';
import { createReadingNavigationSession, readingPositionDecision } from '../src/reading-navigation-state.ts';
import { createReadingShelfStore, READING_SHELF_STORAGE_KEY, verifyParagraphBookmark, verifyEventBookmark } from '../src/reading-shelf.ts';
import { timelineEventIdentity } from '../src/event-timeline-links-schema.ts';
import { readFileSync } from 'node:fs';
import { rememberReadingContext, savedReadingContext } from '../src/reading-shelf-context.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const library = loadLibrary();
const chapter = loadPublishedChapters(library).find(item => item.id === 'old-v028');
const paragraph = chapter.paragraphs.find(item => item.id === 'old-v028-p16');
const personId = 'li-cunxu';
const savedAt = '2026-10-12T00:00:00.000Z';
const binding = { kind: 'paragraph', chapterId: chapter.id, paragraphId: paragraph.id,
  originalRevision: paragraph.revision, originalSha256: hash(paragraph.original) };
const readerRoute = chapterRoute(libraryChapters.find(item => item.id === chapter.id), {
  paragraphId: paragraph.id, query: '', field: 'both',
});
const progress = {
  id: readingProgressId(readerRoute, personId), route: readerRoute, personId, updatedAt: savedAt,
  position: { scrollY: 8311, anchorId: paragraph.id, offset: -529, details: {} },
  view: { fontSize: 25, expandedTranslations: { [paragraph.id]: true } }, binding,
};
const bookmark = {
  id: paragraphBookmarkId(chapter.id, paragraph.id, personId), kind: 'paragraph', chapterId: chapter.id,
  paragraphId: paragraph.id, personId, originalRevision: paragraph.revision,
  originalSha256: hash(paragraph.original), savedAt,
};
const document = { schemaVersion: 1, app: READING_SHELF_APP, progress: [progress], bookmarks: [bookmark] };
const clone = value => structuredClone(value);

test('independent real paragraph roundtrip keeps reading metadata and cannot export canonical originals or translations', () => {
  const serialized = JSON.stringify(parseReadingShelfDocument(document));
  const restored = parseReadingShelfJson(serialized);
  assert.deepEqual(restored, document);
  assert.equal(serialized.includes(paragraph.original), false);
  assert.equal(serialized.includes(paragraph.translation.text), false);
  assert.equal(Object.hasOwn(restored, 'notice'), false);
  const isolated = parseReadingShelfDocument(document);
  isolated.progress[0].position.offset = 999;
  isolated.progress[0].view.expandedTranslations[paragraph.id] = false;
  assert.equal(progress.position.offset, -529);
  assert.equal(progress.view.expandedTranslations[paragraph.id], true);
});

test('normalization persists only a registered public destination and strips live nested return context', () => {
  const comparison = eventComparisonRoute('huliu', 'counterattack', personTimelineRoute(personId, 'li-cunxu-huliu'));
  const liveReader = chapterRoute(libraryChapters.find(item => item.id === chapter.id), {
    paragraphId: paragraph.id, query: '', field: 'both', returnTo: comparison,
  });
  assert.equal(normalizeReadingShelfRoute(liveReader), readerRoute);
  assert.equal(parseReadingShelfRoute(liveReader), null);
  assert.equal(normalizeReadingShelfRoute(comparison), eventComparisonRoute('huliu', 'counterattack'));
  const search = personSourcesRoute(personId, 'old', { query: '胡柳', field: 'translation' });
  assert.equal(parseReadingShelfRoute(search).query, '胡柳');
});

test('untrusted persistence routes cannot reach owner editor, external URLs, retired navigation, ambiguous queries or out-of-range paragraphs', () => {
  const invalid = [
    'https://evil.invalid/', '//evil.invalid/', 'javascript:alert(1)', '#'+readerRoute,
    'owner-review', 'owner-review?person=li-cunxu', 'sources', 'map', 'timeline',
    'read-old/old-v028?paragraph=old-v028-p9999', 'read-old/old-v028?paragraph=new-v03-p1',
    'read-old/old-v028?paragraph=old-v028-p16&paragraph=old-v028-p16',
    'read-old/old-v028?token=x', 'read-old/old-v028?field=private',
    'person-sources/missing/old', 'person-sources/li-cunxu/missing',
    'person-sources/li-cunxu/old?q=a&q=b', 'person-sources/li-cunxu/old?field=private',
    'person-timeline/li-cunxu?event=zhou-dewei-huliu', 'event-comparison/huliu?stage=unknown',
    'event-comparison/huliu?stage=counterattack&stage=counterattack',
  ];
  for (const route of invalid) {
    assert.equal(parseReadingShelfRoute(route), null, route);
    const invalidProgress = clone(progress); invalidProgress.route = route;
    assert.throws(() => parseReadingProgress(invalidProgress), undefined, route);
  }
});

test('the importer rejects unknown or private fields at every nested level rather than retaining them invisibly', () => {
  const invalid = [
    value => value.ownerReviews = [],
    value => value.token = 'private',
    value => value.progress[0].original = paragraph.original,
    value => value.progress[0].translation = paragraph.translation,
    value => value.progress[0].position.html = '<img onerror="alert(1)">',
    value => value.progress[0].view.editorDraft = 'private',
    value => value.progress[0].binding.text = paragraph.original,
    value => value.bookmarks[0].notes = 'private notes',
    value => value.progress[0].position.details.__proto__ = { compromised: true },
  ];
  // A __proto__ assignment is not an own JSON field; test its actual serialized
  // form separately below, rather than mistaking JavaScript prototype mutation
  // for an import payload.
  for (const mutate of invalid.slice(0, -1)) {
    const value = clone(document); mutate(value);
    assert.throws(() => parseReadingShelfJson(JSON.stringify(value)));
  }
  const proto = JSON.stringify(document).replace('"details":{}', '"details":{"__proto__":true}');
  assert.throws(() => parseReadingShelfJson(proto));
});

test('one bad item invalidates the complete file and duplicate identities or JSON keys are refused', () => {
  const validFirst = clone(document);
  const invalidLast = clone(bookmark); invalidLast.paragraphId = 'old-v028-p9999';
  validFirst.bookmarks.push(invalidLast);
  assert.throws(() => parseReadingShelfDocument(validFirst));
  for (const field of ['progress', 'bookmarks']) {
    const duplicate = clone(document); duplicate[field].push(clone(duplicate[field][0]));
    assert.throws(() => parseReadingShelfDocument(duplicate));
  }
  const serialized = JSON.stringify(document);
  for (const payload of [
    serialized.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    serialized.replace('"schemaVersion":1', '"schemaVersion":1,"\\u0073chemaVersion":1'),
    serialized.replace('"fontSize":25', '"fontSize":25,"fontSize":25'),
  ]) assert.throws(() => parseReadingShelfJson(payload));
});

test('paragraph identity, source binding, viewport and view metadata must agree instead of trusting saved anchor selectors', () => {
  const invalid = [
    value => value.personId = 'missing', value => value.id = 'progress:forged',
    value => value.position.anchorId = '.owner-review', value => value.position.anchorId = paragraph.id+'" onclick="alert(1)',
    value => value.position.offset = Infinity, value => value.position.scrollY = -1,
    value => delete value.binding, value => value.binding.paragraphId = 'old-v028-p17',
    value => value.binding.originalSha256 = 'invalid', value => value.view.fontSize = 200,
    value => value.view.expandedTranslations[paragraph.id] = 'true',
    value => value.view.expandedTranslations['editor-private'] = true,
    value => value.view.selectedBooks = ['old'],
  ];
  for (const mutate of invalid) { const value = clone(progress); mutate(value); assert.throws(() => parseReadingProgress(value)); }
});

test('event metadata is bounded to the correct existing person/event without accepting an imported full event', () => {
  const event = { id: eventBookmarkId(personId, 'li-cunxu-huliu'), kind: 'event', personId,
    eventId: 'li-cunxu-huliu', eventSha256: hash('synthetic identity only'), label: '胡柳陂先败后胜，周德威战死', savedAt };
  const value = { ...clone(document), bookmarks: [event] };
  assert.equal(parseReadingShelfDocument(value).bookmarks[0].eventId, 'li-cunxu-huliu');
  for (const mutate of [event => event.eventId = 'zhou-dewei-huliu', event => event.label = '<script>bad</script>',
    event => event.label = 'x'.repeat(201), event => event.evidence = [paragraph], event => event.personId = 'missing']) {
    const invalid = clone(value); mutate(invalid.bookmarks[0]); assert.throws(() => parseReadingShelfDocument(invalid));
  }
});

test('file and collection limits count actual UTF-8 bytes and reject oversized input before parsing', () => {
  const oversized = '漢'.repeat(Math.floor(READING_SHELF_LIMITS.bytes / 3) + 1);
  assert.ok(oversized.length < READING_SHELF_LIMITS.bytes);
  assert.throws(() => parseReadingShelfJson(oversized));
  const bookmarks = clone(document);
  bookmarks.bookmarks = Array.from({ length: READING_SHELF_LIMITS.bookmarks + 1 }, () => clone(bookmark));
  assert.throws(() => parseReadingShelfDocument(bookmarks));
  const wrongVersion = { ...clone(document), schemaVersion: 2 };
  assert.throws(() => parseReadingShelfDocument(wrongVersion));
});

test('a fresh navigation session never invents native history ancestors from imported progress', () => {
  const session = createReadingNavigationSession();
  const refreshed = session.activate(readerRoute, 'reading-stale-other-tab');
  assert.equal(session.size(), 1);
  assert.equal(session.distanceToEntry('reading-stale-other-tab'), null);
  assert.equal(session.returnDistance(personTimelineRoute(personId, 'li-cunxu-huliu'), personTimelineRoute(personId, 'li-cunxu-huliu')), null);
  assert.equal(readingPositionDecision(refreshed, paragraph.id).kind, 'target');
  assert.equal(session.hydrateCurrent(readerRoute, progress), true);
  assert.equal(session.current().id, refreshed.id);
  assert.equal(session.size(), 1);
  assert.equal(readingPositionDecision(session.current(), paragraph.id).kind, 'restore');
  assert.equal(session.distanceToEntry('reading-stale-other-tab'), null);
});

function storageModel() {
  const values = new Map(); let writes = 0;
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes++; },
  };
  return { storage, values, writes: () => writes };
}
function storageChange(events, storage) {
  const event = new Event('storage');
  Object.defineProperties(event, { key: { value: READING_SHELF_STORAGE_KEY }, storageArea: { value: storage } });
  events.dispatchEvent(event);
}
const makeStore = (storage, events = null) => createReadingShelfStore({ storage, events, clock: () => savedAt });

test('stale-tab mutations preserve independently saved bookmarks and honor deliberate deletion in shared storage', async () => {
  const model = storageModel();
  const first = makeStore(model.storage), second = makeStore(model.storage);
  await first.toggleParagraphBookmark({ chapterId: chapter.id, paragraph, personId });
  const nextParagraph = chapter.paragraphs.find(item => item.id === 'old-v028-p17');
  await second.toggleParagraphBookmark({ chapterId: chapter.id, paragraph: nextParagraph, personId });
  assert.equal(parseReadingShelfJson(model.values.get(READING_SHELF_STORAGE_KEY)).bookmarks.length, 2);
  first.removeBookmark(bookmark.id);
  second.saveProgress({ route: readerRoute, personId, position: progress.position, view: progress.view, binding });
  const persisted = parseReadingShelfJson(model.values.get(READING_SHELF_STORAGE_KEY));
  assert.equal(persisted.bookmarks.length, 1);
  assert.equal(persisted.bookmarks[0].paragraphId, 'old-v028-p17');
  assert.equal(persisted.progress.length, 1);
  first.destroy(); second.destroy();
});

test('quota-failed bookmark addition remains an addition when another tab adds the same bookmark before retry', async () => {
  const model = storageModel(), events = new EventTarget(); let blocked = true;
  const failingStorage = { getItem: model.storage.getItem, setItem: (key, value) => {
    if (blocked) throw new DOMException('Full', 'QuotaExceededError');
    model.storage.setItem(key, value);
  } };
  const first = makeStore(failingStorage, events), second = makeStore(model.storage);
  assert.equal(await first.toggleParagraphBookmark({ chapterId: chapter.id, paragraph, personId }), true);
  assert.equal(first.isParagraphBookmarked(chapter.id, paragraph.id, personId), true);
  assert.match(first.getSnapshot().notice, /无法保存/);
  await second.toggleParagraphBookmark({ chapterId: chapter.id, paragraph, personId });
  storageChange(events, failingStorage);
  assert.equal(first.isParagraphBookmarked(chapter.id, paragraph.id, personId), true);
  blocked = false;
  first.saveProgress({ route: readerRoute, personId, position: progress.position, view: progress.view, binding });
  assert.equal(parseReadingShelfJson(model.values.get(READING_SHELF_STORAGE_KEY)).bookmarks.length, 1);
  assert.equal(first.getSnapshot().notice, null);
  first.destroy(); second.destroy();
});

test('blocked storage keeps browsing metadata usable in memory and exportable without touching credentials', async () => {
  const forbidden = { getItem: () => { throw new DOMException('Forbidden', 'SecurityError'); },
    setItem: () => { throw new DOMException('Forbidden', 'SecurityError'); } };
  const store = makeStore(forbidden);
  store.saveProgress({ route: readerRoute, personId, position: progress.position, view: progress.view, binding });
  await store.toggleParagraphBookmark({ chapterId: chapter.id, paragraph, personId });
  const exported = parseReadingShelfJson(store.exportJson());
  assert.equal(exported.progress.length, 1); assert.equal(exported.bookmarks.length, 1);
  assert.equal(exported.progress[0].position.offset, -529);
  assert.ok(store.getSnapshot().notice);
  store.destroy();
});

test('invalid import cannot partially write and a mutated reviewed preview must be checked again on merge', async () => {
  const model = storageModel(), store = makeStore(model.storage);
  await store.toggleParagraphBookmark({ chapterId: chapter.id, paragraph, personId });
  const before = store.exportJson(), writes = model.writes();
  const invalid = clone(document); invalid.progress[0].view.token = 'private';
  assert.throws(() => store.previewImport(JSON.stringify(invalid)));
  assert.equal(model.writes(), writes); assert.equal(store.exportJson(), before);
  const preview = store.previewImport(JSON.stringify(document)); preview.document.bookmarks[0].original = paragraph.original;
  assert.throws(() => store.mergeImport(preview));
  assert.equal(model.writes(), writes); assert.equal(store.exportJson(), before);
  store.destroy();
});

test('opening a saved bookmark must match final current public source/event, so absent or revised data pauses it', async () => {
  assert.equal(await verifyParagraphBookmark(bookmark, paragraph), true);
  assert.equal(await verifyParagraphBookmark(bookmark), false);
  assert.equal(await verifyParagraphBookmark(bookmark, { ...paragraph, revision: paragraph.revision + 1 }), false);
  assert.equal(await verifyParagraphBookmark(bookmark, { ...paragraph, original: paragraph.original + '改' }), false);
  const timeline = JSON.parse(readFileSync(new URL('../../content/person-timelines/li-cunxu.json', import.meta.url), 'utf8'));
  const event = timeline.events.find(event => event.id === 'li-cunxu-huliu');
  const eventBookmark = { id: eventBookmarkId(personId, event.id), kind: 'event', personId, eventId: event.id,
    eventSha256: hash(timelineEventIdentity(event)), label: event.title, savedAt };
  assert.equal(await verifyEventBookmark(eventBookmark, event), true);
  assert.equal(await verifyEventBookmark(eventBookmark), false);
  assert.equal(await verifyEventBookmark(eventBookmark, { ...event, title: event.title + '改' }), false);
});

test('reload context is tab-entry specific for two people in the same chapter and rejects private or unavailable session seeds', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const model = storageModel();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: model.storage } });
  try {
    const first = 'reading-11111111-1111-4111-8111-111111111111-1';
    const second = 'reading-22222222-2222-4222-8222-222222222222-1';
    rememberReadingContext(first, readerRoute, 'li-cunxu');
    rememberReadingContext(second, readerRoute, 'zhou-dewei');
    assert.equal(savedReadingContext(first, readerRoute).personId, 'li-cunxu');
    assert.equal(savedReadingContext(second, readerRoute).personId, 'zhou-dewei');
    assert.equal(savedReadingContext('reading-unknown', readerRoute), undefined);
    const serialized = model.values.get('ancient-history-reading-context-v1');
    const seed = JSON.parse(serialized);
    assert.deepEqual(Object.keys(seed[0]).sort(), ['entryId', 'personId', 'route']);
    assert.equal(serialized.includes(paragraph.original), false);
    seed[0].token = 'private';
    model.values.set('ancient-history-reading-context-v1', JSON.stringify(seed));
    assert.equal(savedReadingContext(first, readerRoute), undefined);
    assert.equal(savedReadingContext(second, readerRoute).personId, 'zhou-dewei');
    Object.defineProperty(globalThis.window, 'sessionStorage', { get: () => { throw new DOMException('Forbidden', 'SecurityError'); } });
    assert.doesNotThrow(() => rememberReadingContext(first, readerRoute, 'li-cunxu'));
    assert.equal(savedReadingContext(first, readerRoute), undefined);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete globalThis.window;
  }
});
