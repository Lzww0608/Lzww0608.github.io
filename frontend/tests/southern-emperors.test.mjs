import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { peopleForEra, filterSearch } from '../src/data.ts';
import { catalogPeople, peopleForGroup, topicsForPerson, personMatchesGroup } from '../src/person-catalog.ts';
import { eraForChapter, eraForPerson, peopleRoute, personIndexRoute } from '../src/eras.ts';
import { libraryBooks, libraryChapters, chapterRoute, personSourcesRoute, resolveRoute,
  resolveReadingRoute, resolvePersonSourcesRoute } from '../src/library.ts';
import { relationshipNodes, personRelationships, relationshipNodesForPeople,
  searchRelationshipNodes, getRelationshipNeighborhood } from '../src/relationships.ts';
import { readingShelfEra, parseReadingProgress } from '../src/reading-shelf-schema.ts';
import { createReadingShelfStore, inferReadingPerson, normalizeReadingShelfRoute,
  bookmarkRoute, progressResumeRoute, verifyParagraphBookmark, READING_SHELF_STORAGE_KEY } from '../src/reading-shelf.ts';
import { rememberReadingContext, savedReadingContext } from '../src/reading-shelf-context.ts';
import { personTimelineRoute, resolvePersonTimelineRoute } from '../src/person-timeline-route.ts';
import { readChapter } from '../src/history-loader.ts';

const personId = 'liu-yu-song';
const hash = value => createHash('sha256').update(value).digest('hex');
const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const archive = chapterId => readJson(`../../content/five-dynasties/chapters/${chapterId}.json`);
const chapter = id => {
  const value = libraryChapters.find(item => item.id === id);
  assert.ok(value, `Actual public chapter ${id} must be present.`);
  return value;
};
const paragraph = (chapterId, paragraphId) => {
  const value = archive(chapterId).paragraphs.find(item => item.id === paragraphId);
  assert.ok(value, `Actual paragraph ${paragraphId} must be present.`);
  return value;
};
function createStore() {
  let raw = null;
  const storage = { getItem: key => key === READING_SHELF_STORAGE_KEY ? raw : null,
    setItem: (key, value) => { assert.equal(key, READING_SHELF_STORAGE_KEY); raw = value; } };
  return createReadingShelfStore({ storage, events: null, clock: () => '2026-10-29T00:00:00.000Z' });
}
function saveParagraph(store, chapterId, paragraphId, context) {
  const p = paragraph(chapterId, paragraphId);
  const route = chapterRoute(chapter(chapterId), { paragraphId, query: '', field: 'both' });
  return store.saveProgress({ route, ...(context ? { personId: context } : {}),
    position: { scrollY: 1200, anchorId: paragraphId, offset: -180, details: {} },
    view: { fontSize: 24, expandedTranslations: { [paragraphId]: true } },
    binding: { kind: 'paragraph', chapterId, paragraphId, originalRevision: p.revision, originalSha256: hash(p.original) } });
}

test('actual Liu Yu belongs to the Southern emperors topic behind the era choice, preserving old entrances', () => {
  for (const address of ['', '#', '#eras', '#not-a-route']) assert.equal(resolveRoute(address), 'eras');
  assert.equal(resolveRoute('#people'), 'people');
  assert.equal(resolveRoute('#people/southern-northern'), 'people/southern-northern');
  for (const legacy of ['overview', 'timeline', 'sources', 'map']) assert.equal(resolveRoute(`#${legacy}`), 'people');
  const liuYu = catalogPeople.find(person => person.id === personId);
  assert.ok(liuYu, 'The reviewed Liu Yu profile must be integrated before this release passes.');
  assert.equal(liuYu.name, '刘裕');
  assert.equal(liuYu.dynasty, '刘宋');
  assert.equal(eraForPerson(liuYu), 'southern-northern');
  assert.equal(personIndexRoute(liuYu), 'people/southern-northern');
  assert.ok(topicsForPerson(liuYu).some(topic => topic.id === 'southern-emperors'));
  assert.ok(peopleForGroup(peopleForEra('southern-northern'), 'southern-emperors').includes(liuYu));
  assert.equal(personMatchesGroup(liuYu, 'emperors'), false);
  assert.equal(peopleForEra('five-dynasties').some(person => person.id === personId), false);
  const zhuWen = catalogPeople.find(person => person.id === 'zhu-wen');
  assert.equal(zhuWen.dynasty, '后梁');
  assert.equal(personIndexRoute(zhuWen), peopleRoute('five-dynasties'));
});

test('actual simplified/traditional names stay within the selected era in list and relationship search', () => {
  const south = peopleForEra('southern-northern'), five = peopleForEra('five-dynasties');
  const southNodes = relationshipNodesForPeople(south, relationshipNodes, personRelationships);
  const fiveNodes = relationshipNodesForPeople(five, relationshipNodes, personRelationships);
  for (const query of ['刘裕', '劉裕', '宋武帝']) {
    assert.ok(filterSearch(query, 'person', 'southern-northern').some(item => item.id === personId), query);
    assert.equal(filterSearch(query, 'person', 'five-dynasties').some(item => item.id === personId), false);
    assert.ok(searchRelationshipNodes(query, southNodes, south).some(item => item.id === personId), query);
    assert.equal(searchRelationshipNodes(query, fiveNodes, five).some(item => item.id === personId), false);
  }
  for (const query of ['朱温', '朱溫', '朱全忠']) {
    assert.ok(filterSearch(query, 'person', 'five-dynasties').some(item => item.id === 'zhu-wen'));
    assert.deepEqual(filterSearch(query, 'person', 'southern-northern'), []);
    assert.deepEqual(searchRelationshipNodes(query, southNodes, south), []);
  }
  assert.deepEqual(searchRelationshipNodes('', southNodes, south), []);
  const direct = getRelationshipNeighborhood(personId, southNodes, personRelationships);
  assert.ok(direct.relationships.length > 0, 'Published Liu Yu relations must be available, not an empty placeholder graph.');
  assert.ok(direct.relationships.every(edge => edge.from === personId || edge.to === personId));
  assert.equal(direct.nodes.some(node => five.some(person => person.id === node.id)), false);
  assert.deepEqual(getRelationshipNeighborhood('zhu-wen', southNodes, personRelationships), { nodes: [], relationships: [] });
  assert.deepEqual(getRelationshipNeighborhood(personId, fiveNodes, personRelationships), { nodes: [], relationships: [] });
});

test('the four real Southern source chapters keep book identity, paragraph focus and a precise person-source return', () => {
  const sources = personSourcesRoute(personId, 'songshu', { query: '刘裕', field: 'original' });
  for (const [bookId, chapterId] of [['songshu', 'songshu-v001'], ['songshu', 'songshu-v002'], ['songshu', 'songshu-v003'], ['nanshi', 'nanshi-v001']]) {
    const entry = chapter(chapterId), first = archive(chapterId).paragraphs[0];
    const route = chapterRoute(entry, { paragraphId: first.id, query: '', field: 'both', returnTo: sources });
    const resolved = resolveReadingRoute(route);
    assert.equal(resolveRoute(`#${route}`), route);
    assert.equal(resolved.book.id, bookId);
    assert.equal(resolved.chapter.id, chapterId);
    assert.equal(resolved.focusParagraphId, first.id);
    assert.equal(resolved.returnTo, sources);
    assert.equal(resolvePersonSourcesRoute(resolved.returnTo).search.query, '刘裕');
    assert.equal(eraForChapter(entry), 'southern-northern');
    assert.equal(resolveReadingRoute(`read-old/${chapterId}`), null);
    assert.equal(normalizeReadingShelfRoute(route), `read-${bookId}/${chapterId}?paragraph=${first.id}`);
  }
  for (const bookId of ['songshu', 'nanshi']) {
    assert.equal(libraryBooks.find(book => book.id === bookId).defaultChapter, `${bookId}-v001`);
    assert.equal(resolveReadingRoute(`read-${bookId}`).chapter.id, `${bookId}-v001`);
  }
});

test('actual retrospective Liu Yu mentions preserve explicit Southern context without guessing it from the chapter', () => {
  for (const [chapterId, paragraphId, evidence] of [
    ['huiyao-v002', 'huiyao-v002-p55', '宋武帝'],
    ['huiyao-v002', 'huiyao-v002-p60', '劉裕'],
    ['shiguochunqiu-v041', 'shiguochunqiu-v041-p9', '宋高祖豁達大度'],
  ]) {
    const entry = chapter(chapterId);
    assert.equal(eraForChapter(entry), 'five-dynasties');
    assert.ok(entry.subjects.includes(personId), 'The checked cross-era association must be public.');
    assert.ok(paragraph(entry.id, paragraphId).original.includes(evidence));
    const returnTo = personSourcesRoute(personId, entry.bookId);
    const route = chapterRoute(entry, { paragraphId, query: '', field: 'both', returnTo });
    const resolved = resolveReadingRoute(route);
    assert.equal(resolved.returnTo, returnTo);
    assert.equal(personIndexRoute(resolvePersonSourcesRoute(resolved.returnTo).person), 'people/southern-northern');
    assert.equal(inferReadingPerson(route, personId), personId);
    assert.equal(inferReadingPerson(route), undefined, 'The caller must supply validated explicit context.');
    const canonical = normalizeReadingShelfRoute(route);
    assert.equal(readingShelfEra({ route: canonical, personId }), 'southern-northern');
    assert.equal(readingShelfEra({ route: canonical }), 'five-dynasties');
    assert.equal(readingShelfEra({ kind: 'paragraph', chapterId: entry.id, personId }), 'southern-northern');
  }
});

test('unrelated cross-era context cannot be persisted or classified as the previous person', async () => {
  const store = createStore();
  for (const [chapterId, paragraphId, wrongPerson] of [['songshu-v001', 'songshu-v001-p1', 'zhu-wen'], ['old-v028', 'old-v028-p16', personId]]) {
    const route = chapterRoute(chapter(chapterId), { paragraphId, query: '', field: 'both' });
    assert.equal(inferReadingPerson(route, wrongPerson), undefined);
    assert.equal(readingShelfEra({ route, personId: wrongPerson }), eraForChapter(chapter(chapterId)));
    assert.throws(() => saveParagraph(store, chapterId, paragraphId, wrongPerson), /人物与地址不匹配/);
    await assert.rejects(store.toggleParagraphBookmark({ chapterId, paragraph: paragraph(chapterId, paragraphId), personId: wrongPerson }));
    const clean = saveParagraph(store, chapterId, paragraphId);
    assert.throws(() => parseReadingProgress({ ...clean, id: `progress:${wrongPerson}:read-${chapter(chapterId).bookId}/${chapterId}`, personId: wrongPerson }));
  }
});

test('mixed-era bookmarks and progress roundtrip with exact anchors while existing Five Dynasties rows stay unchanged', async () => {
  const store = createStore();
  const old = saveParagraph(store, 'old-v028', 'old-v028-p16', 'li-cunxu');
  await store.toggleParagraphBookmark({ chapterId: 'old-v028', paragraph: paragraph('old-v028', 'old-v028-p16'), personId: 'li-cunxu' });
  const oldDocument = JSON.parse(store.exportJson());
  for (const [chapterId, paragraphId] of [['songshu-v001', 'songshu-v001-p1'], ['huiyao-v002', 'huiyao-v002-p55'], ['huiyao-v002', 'huiyao-v002-p60']]) {
    saveParagraph(store, chapterId, paragraphId, personId);
    await store.toggleParagraphBookmark({ chapterId, paragraph: paragraph(chapterId, paragraphId), personId });
  }
  const serialized = store.exportJson(), restored = createStore();
  restored.mergeImport(restored.previewImport(JSON.stringify(oldDocument)));
  restored.mergeImport(restored.previewImport(serialized));
  assert.deepEqual(restored.getProgress(old.route, 'li-cunxu'), old);
  assert.deepEqual(restored.getSnapshot().bookmarks.find(item => item.id === oldDocument.bookmarks[0].id), oldDocument.bookmarks[0]);
  assert.deepEqual(restored.getSnapshot().progress.filter(item => readingShelfEra(item) === 'five-dynasties'), [old]);
  assert.ok(restored.getSnapshot().progress.filter(item => item.personId === personId).every(item => readingShelfEra(item) === 'southern-northern'));
  for (const saved of restored.getSnapshot().bookmarks) {
    const p = paragraph(saved.chapterId, saved.paragraphId);
    assert.equal(resolveReadingRoute(bookmarkRoute(saved)).focusParagraphId, p.id);
    assert.equal(await verifyParagraphBookmark(saved, p), true);
    assert.equal(await verifyParagraphBookmark(saved, { ...p, original: p.original + '改' }), false);
    assert.equal(readingShelfEra(saved), saved.personId === personId ? 'southern-northern' : 'five-dynasties');
    assert.equal(serialized.includes(p.original), false);
  }
  const continued = restored.getProgress('read-huiyao/huiyao-v002', personId);
  assert.equal(resolveReadingRoute(progressResumeRoute(continued)).focusParagraphId, 'huiyao-v002-p60');
  assert.equal(continued.position.offset, -180);
  assert.equal(continued.view.expandedTranslations['huiyao-v002-p60'], true);
  assert.equal(serialized.includes('return='), false);
});

test('reload context uses the matching opaque history entry and never spills into a fresh link or another chapter', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  } } });
  try {
    const first = 'reading-12345678-1234-1234-1234-123456789abc-1';
    const second = 'reading-12345678-1234-1234-1234-123456789abc-2';
    const route = 'read-huiyao/huiyao-v002?paragraph=huiyao-v002-p55';
    rememberReadingContext(first, route, personId);
    rememberReadingContext(second, route);
    assert.equal(savedReadingContext(first, route)?.personId, personId);
    assert.equal(savedReadingContext(second, route)?.personId, undefined);
    assert.equal(savedReadingContext('reading-12345678-1234-1234-1234-123456789abc-3', route), undefined);
    assert.equal(savedReadingContext(first, 'read-old/old-v028?paragraph=old-v028-p16'), undefined);
    rememberReadingContext(second, 'read-songshu/songshu-v001', 'zhu-wen');
    assert.equal(savedReadingContext(second, 'read-songshu/songshu-v001'), undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window;
  }
});

test('an actual Liu Yu timeline event retains its exact return through the full source chapter', () => {
  const timeline = readJson(`../../content/person-timelines/${personId}.json`);
  const event = timeline.events.find(item => item.evidence?.length);
  assert.ok(event, 'A sourced event must exist, not an identity placeholder.');
  const evidence = event.evidence[0];
  const returnTo = personTimelineRoute(personId, event.id);
  const route = chapterRoute(chapter(evidence.chapterId), { paragraphId: evidence.paragraphId, query: '', field: 'both', returnTo });
  assert.equal(resolveRoute(`#${route}`), route);
  assert.equal(resolveReadingRoute(route).returnTo, returnTo);
  assert.equal(resolvePersonTimelineRoute(returnTo).eventId, event.id);
  assert.equal(inferReadingPerson(route, personId), personId);
  assert.equal(readingShelfEra({ route: returnTo, personId }), 'southern-northern');
});

test('new Southern chapters obey offline fallback and reject successful invalid API responses', async () => {
  for (const [bookId, chapterId] of [['songshu', 'songshu-v003'], ['nanshi', 'nanshi-v001']]) {
    const archived = archive(chapterId), requests = [];
    const options = { bookId, chapterId, apiBase: 'https://api.example', archiveBase: '/', signal: new AbortController().signal };
    const offline = await readChapter({ ...options, fetcher: async url => {
      requests.push(String(url));
      if (String(url).startsWith('https://api.example')) throw new TypeError('Offline fixture');
      return Response.json(archived);
    } });
    assert.equal(offline.source, 'archive');
    assert.equal(offline.chapter.id, chapterId);
    assert.equal(offline.chapter.paragraphs[0].original, archived.paragraphs[0].original);
    assert.ok(requests.includes(`https://api.example/api/chapters/${chapterId}`));
    const authoritativeRequests = [];
    await assert.rejects(readChapter({ ...options, fetcher: async url => {
      authoritativeRequests.push(String(url));
      return Response.json(String(url).startsWith('https://api.example') ? {} : archived);
    } }), /could not be verified/);
    assert.ok(authoritativeRequests.includes(`https://api.example/api/chapters/${chapterId}`));
  }
});
