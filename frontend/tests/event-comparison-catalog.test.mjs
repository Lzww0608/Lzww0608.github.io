import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadEventComparisons } from '../../content/event-comparisons.mjs';
import { loadEventTimelineLinks } from '../../content/event-timeline-links.mjs';
import { eventComparisons, comparisonsForPerson } from '../src/event-comparison-data.ts';
import { eventTimelineLinks, resolveEventTimelineLinks } from '../src/event-timeline-links.ts';
import { readEventComparison } from '../src/event-comparison-loader.ts';
import { readTimelineComparisonLinks, readComparisonTimelineLinks } from '../src/event-timeline-links-loader.ts';
import { readPersonTimeline } from '../src/person-timeline-loader.ts';
import { eventComparisonRoute, resolveEventComparisonRoute } from '../src/event-comparison-route.ts';
import { chapterRoute, libraryChapters, resolveReadingRoute, resolveRoute } from '../src/library.ts';
import { createReadingNavigationSession, readingPositionDecision } from '../src/reading-navigation-state.ts';
import { createReadingShelfStore, parseReadingShelfRoute, normalizeReadingShelfRoute, inferReadingPerson,
  progressResumeRoute, bookmarkRoute, verifyParagraphBookmark, verifyEventBookmark } from '../src/reading-shelf.ts';

const library = loadLibrary();
const chapters = new Map(loadPublishedChapters(library).map(chapter => [chapter.id, chapter]));
const people = [...new Set(eventTimelineLinks.flatMap(document => document.links.map(link => link.personId)))];
const documents = new Map(people.map(personId => [personId,
  JSON.parse(readFileSync(new URL(`../../content/person-timelines/${personId}.json`, import.meta.url), 'utf8'))]));
const options = () => ({ apiBase: '', archiveBase: '/', signal: new AbortController().signal });
function archive(url) {
  const personId = /\/person-timelines\/([a-z0-9-]+)\.json$/.exec(url)?.[1];
  if (personId && documents.has(personId)) return Response.json(documents.get(personId));
  const chapterId = /\/chapters\/([a-z0-9-]+)(?:\.json)?$/.exec(url)?.[1];
  return chapterId && chapters.has(chapterId) ? Response.json(chapters.get(chapterId)) : new Response('', { status: 404 });
}
const comparisons = new Map(await Promise.all(eventComparisons.map(async document => [document.id,
  (await readEventComparison({ ...options(), document, fetcher: async url => archive(url) })).page])));
const timelines = new Map(await Promise.all(people.map(async personId => [personId,
  (await readPersonTimeline({ ...options(), personId,
    eventIds: eventTimelineLinks.flatMap(document => document.links.filter(link => link.personId === personId).map(link => link.eventId)),
    fetcher: async url => archive(url) })).page])));
const baixiang = eventTimelineLinks.find(document => document.comparisonId === 'baixiang');
const huliu = eventTimelineLinks.find(document => document.comparisonId === 'huliu');
const jinyang = eventTimelineLinks.find(document => document.comparisonId === 'jinyang');
const sharedPerson = people.find(personId => [baixiang, huliu].every(document => document.links.some(link => link.personId === personId)));

test('all three public topics are explicitly registered, match prebuild documents and retain the prior person entrances', () => {
  assert.deepEqual(eventComparisons.map(document => document.id), ['baixiang', 'huliu', 'jinyang']);
  assert.deepEqual(eventComparisons, loadEventComparisons(library));
  assert.deepEqual(eventTimelineLinks, loadEventTimelineLinks(library));
  assert.deepEqual(comparisonsForPerson('li-cunxu').map(document => document.id), ['baixiang', 'huliu']);
  assert.deepEqual(comparisonsForPerson('unknown'), []);
  assert.deepEqual(comparisons.get('huliu').stages.map(stage => stage.id), ['preparation', 'setback', 'counterattack', 'aftermath']);
  assert.ok(sharedPerson, 'a historical participant must actually have events registered for both battles');
  assert.deepEqual(comparisonsForPerson('shi-jingtang').map(document => document.id), ['huliu', 'jinyang']);
});

test('Jinyang resolves all three books, four people and four phases with complete current paragraphs and bidirectional timeline proofs', async () => {
  const page = comparisons.get('jinyang');
  assert.deepEqual(new Set(page.document.personIds), new Set(['shi-jingtang', 'li-congke', 'zhang-jingda', 'liu-zhiyuan']));
  assert.deepEqual(new Set(page.sources.map(source => source.bookId)), new Set(['old', 'new', 'tongjian']));
  assert.deepEqual(page.stages.map(stage => stage.id), ['preparation', 'relief', 'foundation', 'collapse']);
  assert.equal(page.sources.length, 71);
  assert.equal(new Set(page.sources.map(source => source.paragraphId)).size, 71);
  for (const source of page.sources) {
    assert.equal(source.status, 'available', source.paragraphId);
    assert.deepEqual(source.paragraph, chapters.get(source.chapterId).paragraphs.find(paragraph => paragraph.id === source.paragraphId));
    assert.ok(source.paragraph.translation?.text.trim(), `current full translation: ${source.paragraphId}`);
  }
  for (const stage of page.stages) assert.equal(stage.status, 'available');
  for (const difference of page.differences) {
    assert.equal(difference.status, 'available', difference.id);
    for (const evidence of difference.evidence) {
      const source = page.sources.find(source => source.id === evidence.sourceId);
      assert.ok(source.paragraph.original.includes(evidence.excerpt));
    }
  }
  const before = JSON.stringify([...documents, ...chapters]);
  const forward = await readComparisonTimelineLinks({ ...options(), comparison: page, fetcher: async url => archive(url) });
  assert.equal(forward.unavailableCount, 0);
  assert.equal(forward.links.length, jinyang.links.length);
  assert.deepEqual(new Set(forward.links.map(link => link.person.id)), new Set(page.document.personIds));
  for (const personId of page.document.personIds) {
    const backwards = await readTimelineComparisonLinks({ ...options(), personId, timeline: timelines.get(personId), fetcher: async url => archive(url) });
    const expected = jinyang.links.filter(link => link.personId === personId);
    const actual = backwards.links.filter(link => link.comparisonId === 'jinyang');
    assert.equal(actual.length, expected.length);
    for (const reference of expected) {
      assert.deepEqual(actual.find(link => link.event.id === reference.eventId).stageIds, reference.stageIds);
      assert.deepEqual(forward.links.find(link => link.person.id === personId && link.event.id === reference.eventId).stageIds, reference.stageIds);
    }
  }
  assert.equal(JSON.stringify([...documents, ...chapters]), before);
});

test('responding empty, malformed, revised or HTTP-error Jinyang sources pause only their proofs and never revive deployed text', async () => {
  const previousChapters = new Set(eventComparisons.filter(document => document.id !== 'jinyang').flatMap(document => document.sources.map(source => source.chapterId)));
  const uniqueChapters = new Set(comparisons.get('jinyang').sources.map(source => source.chapterId).filter(id => !previousChapters.has(id)));
  assert.ok(uniqueChapters.size);
  const personId = 'shi-jingtang';
  const expectedHuliu = huliu.links.filter(link => link.personId === personId).length;
  assert.ok(expectedHuliu);
  for (const kind of ['empty', 'invalid', 'revised', 'http-error']) {
    const requested = [];
    const fetcher = async url => {
      requested.push(url);
      const chapterId = /\/api\/chapters\/([a-z0-9-]+)$/.exec(url)?.[1];
      if (!uniqueChapters.has(chapterId)) return archive(url);
      if (kind === 'http-error') return new Response('', { status: 503 });
      if (kind === 'invalid') return Response.json({ id: chapterId, private: 'invalid source fixture' });
      const chapter = structuredClone(chapters.get(chapterId));
      if (kind === 'empty') chapter.paragraphs = [];
      else for (const paragraph of chapter.paragraphs) paragraph.original += '仅测试当前底本改变。';
      return Response.json(chapter);
    };
    const paused = (await readEventComparison({ ...options(), document: comparisons.get('jinyang').document, apiBase: 'https://api.example', fetcher })).page;
    assert.ok(paused.sources.some(source => source.status === 'available'));
    assert.ok(paused.sources.filter(source => uniqueChapters.has(source.chapterId)).every(source => source.status === 'unavailable' && source.source === 'api'));
    assert.ok(paused.differences.some(difference => difference.status === 'unavailable'));
    const links = await readTimelineComparisonLinks({ ...options(), personId, timeline: timelines.get(personId), apiBase: 'https://api.example', fetcher });
    assert.equal(links.links.filter(link => link.comparisonId === 'huliu').length, expectedHuliu);
    assert.ok(links.unavailableCount > 0);
    assert.ok(requested.every(url => url.startsWith('https://api.example/api/chapters/')), 'a responding API does not request archive recovery');
  }
  const offlineRequests = [];
  const offline = (await readEventComparison({ ...options(), document: comparisons.get('jinyang').document, apiBase: 'https://api.example',
    fetcher: async url => { offlineRequests.push(url); if (url.startsWith('https://api.example')) throw new TypeError('offline'); return archive(url); } })).page;
  assert.ok(offline.sources.every(source => source.status === 'available' && source.source === 'archive'));
  assert.ok(offlineRequests.some(url => url.startsWith('/history/chapters/')));
});

test('Jinyang timeline to comparison to Reader returns are bounded and preserve independent topic reading state', () => {
  const reference = jinyang.links.find(link => link.personId === 'shi-jingtang');
  const timelineRoute = `person-timeline/${reference.personId}?event=${reference.eventId}`;
  const destination = eventComparisonRoute('jinyang', reference.stageIds[0], timelineRoute);
  assert.equal(resolveEventComparisonRoute(destination).returnTo, timelineRoute);
  const source = comparisons.get('jinyang').sources.find(source => source.status === 'available');
  const chapter = libraryChapters.find(chapter => chapter.id === source.chapterId);
  const reader = chapterRoute(chapter, { paragraphId: source.paragraphId, query: '', field: 'both', returnTo: destination });
  assert.equal(resolveReadingRoute(reader).returnTo, destination);
  assert.equal(resolveRoute('#' + reader), reader);
  for (const invalid of ['event-comparison/jinyang?stage=battle', 'event-comparison/jinyang?stage=aftermath',
    'event-comparison/jinyang?stage=relief&stage=collapse', 'event-comparison/jinyang?stage=collapse&return=owner-review',
    'event-comparison/jinyang?stage=collapse&return=https%3A%2F%2Fexample.com',
    `event-comparison/jinyang?stage=collapse&return=${encodeURIComponent(destination)}`]) assert.equal(resolveEventComparisonRoute(invalid), null);
  const session = createReadingNavigationSession();
  const origin = eventComparisonRoute('huliu', 'aftermath');
  const original = session.activate(origin);
  const oldView = { selectedBooks: ['old', 'chunqiu'], fontSize: 21, expandedTranslations: {} };
  session.rememberView(origin, oldView);
  session.savePosition({ anchorId: 'comparison-stage-aftermath', offset: -200, scrollY: 5100, details: {} });
  const target = session.activate(destination);
  assert.deepEqual(session.readView(destination, {}), {});
  const newView = { selectedBooks: ['new', 'tongjian'], fontSize: 25, expandedTranslations: {} };
  const newPosition = { anchorId: `comparison-stage-${reference.stageIds[0]}`, offset: -500, scrollY: 19000, details: {} };
  session.rememberView(destination, newView); session.savePosition(newPosition);
  session.activate(origin, original.id); assert.deepEqual(session.readView(origin, {}), oldView);
  const restored = session.activate(destination, target.id);
  assert.deepEqual(session.readView(destination, {}), newView);
  assert.deepEqual(readingPositionDecision(restored, 'comparison-stage-collapse'), { kind: 'restore', position: newPosition });
});

test('Jinyang saved progress and real paragraph/event bookmarks round-trip without old-topic state, return chains or text', async () => {
  let backing = null;
  const storage = { getItem: () => backing, setItem: (_key, value) => { backing = value; } };
  const store = createReadingShelfStore({ storage, events: null, clock: () => '2026-01-01T00:00:00.000Z' });
  const page = comparisons.get('jinyang'), stage = page.document.stages.find(stage => stage.id === 'relief');
  const source = page.sources.find(source => stage.sourceIds.includes(source.id) && source.status === 'available');
  const paragraph = source.paragraph;
  const live = eventComparisonRoute('jinyang', stage.id, 'person-timeline/shi-jingtang');
  const leaf = eventComparisonRoute('jinyang', stage.id);
  assert.equal(normalizeReadingShelfRoute(live), leaf);
  assert.equal(parseReadingShelfRoute(leaf).comparisonId, 'jinyang');
  assert.equal(parseReadingShelfRoute(live), null);
  assert.equal(inferReadingPerson(leaf, 'shi-jingtang'), 'shi-jingtang');
  assert.equal(inferReadingPerson(leaf, 'li-cunxu'), undefined);
  store.saveProgress({ route: live, personId: 'shi-jingtang', position: { scrollY: 12000,
    anchorId: `comparison-paragraph-jinyang-${stage.id}-${source.id}`, offset: -345, details: {} },
    view: { selectedBooks: ['old', 'new'], fontSize: 24, expandedTranslations: { [`${stage.id}/${source.id}`]: true } },
    binding: { kind: 'paragraph', chapterId: source.chapterId, paragraphId: source.paragraphId,
      originalRevision: source.originalRevision, originalSha256: source.originalSha256 } });
  await store.toggleParagraphBookmark({ chapterId: source.chapterId, paragraph, personId: 'shi-jingtang' });
  const reference = jinyang.links.find(link => link.personId === 'shi-jingtang');
  const event = timelines.get(reference.personId).events.find(event => event.id === reference.eventId);
  await store.toggleEventBookmark({ personId: reference.personId, event });
  const text = store.exportJson();
  assert.ok(!text.includes(paragraph.original) && !text.includes(paragraph.translation.text));
  assert.ok(!text.includes('return=') && !text.includes('owner-review'));
  const restored = createReadingShelfStore({ storage: null, events: null });
  restored.mergeImport(restored.previewImport(text));
  const progress = restored.getProgress(leaf, 'shi-jingtang');
  assert.equal(progressResumeRoute(progress), leaf);
  assert.equal(progress.position.offset, -345);
  assert.deepEqual(progress.view.selectedBooks, ['old', 'new']);
  assert.equal(restored.getProgress('event-comparison/huliu', 'shi-jingtang'), undefined);
  const bookmarks = restored.getSnapshot().bookmarks;
  const savedParagraph = bookmarks.find(bookmark => bookmark.kind === 'paragraph');
  const savedEvent = bookmarks.find(bookmark => bookmark.kind === 'event');
  assert.equal(resolveReadingRoute(bookmarkRoute(savedParagraph)).focusParagraphId, source.paragraphId);
  assert.equal(await verifyParagraphBookmark(savedParagraph, paragraph), true);
  assert.equal(await verifyParagraphBookmark(savedParagraph, { ...paragraph, original: paragraph.original + '改变。' }), false);
  assert.equal(await verifyEventBookmark(savedEvent, event), true);
  assert.equal(await verifyEventBookmark(savedEvent, { ...event, summary: event.summary + '改变。' }), false);
  store.destroy(); restored.destroy();
});

test('every second-topic source retains its full existing original and translation and every actual link resolves both ways', async () => {
  const page = comparisons.get('huliu');
  assert.ok(page.sources.length > 0);
  for (const source of page.sources) {
    assert.equal(source.status, 'available');
    assert.deepEqual(source.paragraph, chapters.get(source.chapterId).paragraphs.find(paragraph => paragraph.id === source.paragraphId));
  }
  const before = JSON.stringify([...documents, ...chapters]);
  const forward = await readComparisonTimelineLinks({ ...options(), comparison: page, fetcher: async url => archive(url) });
  assert.equal(forward.unavailableCount, 0);
  assert.equal(forward.links.length, huliu.links.length);
  for (const reference of huliu.links) {
    const forwardLink = forward.links.find(link => link.person.id === reference.personId && link.event.id === reference.eventId);
    assert.deepEqual(forwardLink.stageIds, reference.stageIds);
    const backwards = await readTimelineComparisonLinks({ ...options(), personId: reference.personId,
      timeline: timelines.get(reference.personId), fetcher: async url => archive(url) });
    assert.ok(backwards.links.some(link => link.comparisonId === 'huliu' && link.event.id === reference.eventId
      && JSON.stringify(link.stageIds) === JSON.stringify(reference.stageIds)));
  }
  const both = await readTimelineComparisonLinks({ ...options(), personId: sharedPerson,
    timeline: timelines.get(sharedPerson), fetcher: async url => archive(url) });
  assert.deepEqual(new Set(both.links.map(link => link.comparisonId)), new Set(['baixiang', 'huliu']));
  assert.equal(both.unavailableCount, 0);
  assert.equal(JSON.stringify([...documents, ...chapters]), before);
});

test('a revised Hu Liu event cannot remove a separately proved Baixiang event of the same person', async () => {
  const reference = huliu.links.find(link => link.personId === sharedPerson);
  assert.ok(!baixiang.links.some(link => link.personId === sharedPerson && link.eventId === reference.eventId));
  const timeline = structuredClone(timelines.get(sharedPerson));
  timeline.events.find(event => event.id === reference.eventId).summary += '仅测试当前事实已修订。';
  const result = await readTimelineComparisonLinks({ ...options(), personId: sharedPerson, timeline, fetcher: async url => archive(url) });
  assert.ok(!result.links.some(link => link.comparisonId === 'huliu' && link.event.id === reference.eventId));
  assert.equal(result.links.filter(link => link.comparisonId === 'baixiang').length,
    baixiang.links.filter(link => link.personId === sharedPerson).length);
  assert.equal(result.unavailableCount, 1);
});

test('responding empty Hu Liu chapters pause that topic without reviving static sources or disabling Baixiang', async () => {
  const baixiangChapters = new Set(comparisons.get('baixiang').document.sources.map(source => source.chapterId));
  const uniqueChapters = new Set(comparisons.get('huliu').document.sources.map(source => source.chapterId).filter(id => !baixiangChapters.has(id)));
  assert.ok(uniqueChapters.size > 0, 'the second battle has independent chapters in the current archive');
  const urls = [];
  const result = await readTimelineComparisonLinks({ ...options(), personId: sharedPerson, timeline: timelines.get(sharedPerson),
    apiBase: 'https://api.example', fetcher: async url => {
      urls.push(url);
      const chapterId = /\/api\/chapters\/([a-z0-9-]+)$/.exec(url)?.[1];
      if (uniqueChapters.has(chapterId)) return Response.json({ ...chapters.get(chapterId), paragraphs: [] });
      return archive(url);
    } });
  assert.equal(result.links.filter(link => link.comparisonId === 'baixiang').length,
    baixiang.links.filter(link => link.personId === sharedPerson).length);
  assert.ok(result.unavailableCount > 0);
  assert.ok(urls.every(url => url.startsWith('https://api.example/api/chapters/')));
  const secondPage = (await readEventComparison({ ...options(), document: comparisons.get('huliu').document, apiBase: 'https://api.example',
    fetcher: async url => {
      const chapterId = /\/api\/chapters\/([a-z0-9-]+)$/.exec(url)?.[1];
      return uniqueChapters.has(chapterId) ? Response.json({ ...chapters.get(chapterId), paragraphs: [] }) : archive(url);
    } })).page;
  assert.ok(secondPage.sources.some(source => source.status === 'available'));
  assert.ok(secondPage.sources.filter(source => uniqueChapters.has(source.chapterId)).every(source => source.status === 'unavailable' && source.source === 'api'));
  assert.ok(secondPage.differences.some(difference => difference.status === 'unavailable'));
});

test('each topic isolates a source-proof failure even when the other battle has the same stage name', async () => {
  for (const [affected, unaffected] of [[huliu, baixiang], [baixiang, huliu]]) {
    const page = comparisons.get(affected.comparisonId);
    const reference = affected.links.find(link => link.stageIds.includes('aftermath'));
    assert.ok(reference);
    const sourceIds = new Set(reference.evidence.filter(evidence => evidence.stageId === 'aftermath').map(evidence => evidence.sourceId));
    const paused = { ...page, sources: page.sources.map(source => sourceIds.has(source.id)
      ? { id: source.id, status: 'unavailable', source: 'api', reason: 'stale-original' } : source) };
    const before = await resolveEventTimelineLinks(unaffected, timelines, comparisons.get(unaffected.comparisonId));
    const second = await resolveEventTimelineLinks(affected, timelines, paused);
    assert.ok(!second.links.some(link => link.person.id === reference.personId && link.event.id === reference.eventId && link.stageIds.includes('aftermath')));
    assert.ok(second.unavailableCount > 0);
    const after = await resolveEventTimelineLinks(unaffected, timelines, comparisons.get(unaffected.comparisonId));
    assert.deepEqual(after, before);
  }
});

test('cross-topic returns remain catalog checked and Reader preserves only the permitted bounded context', () => {
  const origin = eventComparisonRoute('baixiang', 'battle');
  const destination = eventComparisonRoute('huliu', 'counterattack', origin);
  assert.equal(resolveEventComparisonRoute(destination).returnTo, origin);
  assert.equal(resolveRoute('#'+destination), destination);
  const source = comparisons.get('huliu').sources.find(source => source.status === 'available');
  const chapter = libraryChapters.find(chapter => chapter.id === source.chapterId);
  const reader = chapterRoute(chapter, { paragraphId: source.paragraphId, query: '', field: 'both', returnTo: destination });
  assert.equal(resolveReadingRoute(reader).returnTo, destination);
  for (const invalid of ['event-comparison/unknown?stage=counterattack', 'event-comparison/huliu?stage=battle',
    'event-comparison/baixiang?stage=counterattack', 'event-comparison/huliu?stage=aftermath&stage=aftermath']) {
    assert.equal(resolveEventComparisonRoute(invalid), null);
    assert.throws(() => eventComparisonRoute('huliu', 'setback', invalid));
  }
  assert.equal(resolveEventComparisonRoute(`${destination}&return=${encodeURIComponent(origin)}`), null);
  assert.equal(resolveEventComparisonRoute(`event-comparison/baixiang?stage=battle&return=${encodeURIComponent(destination)}`), null);
});

test('same-named stages in different battles have independent book selections, expansion state and reading offsets', () => {
  const session = createReadingNavigationSession();
  const firstRoute = eventComparisonRoute('baixiang', 'aftermath');
  const first = session.activate(firstRoute);
  const firstView = { selectedBooks: ['old', 'tongjian'], expandedTranslations: { 'aftermath/x': true }, fontSize: 21 };
  const firstPosition = { anchorId: 'comparison-paragraph-baixiang-aftermath-x', offset: -321, scrollY: 18000, details: {} };
  session.rememberView(firstRoute, firstView); session.savePosition(firstPosition);
  const secondRoute = eventComparisonRoute('huliu', 'aftermath', firstRoute);
  const second = session.activate(secondRoute);
  assert.deepEqual(session.readView(secondRoute, {}), {}, 'a different topic must not inherit a same-named stage');
  const secondView = { selectedBooks: ['new', 'chunqiu'], expandedTranslations: {}, fontSize: 25 };
  const secondPosition = { anchorId: 'comparison-paragraph-huliu-aftermath-x', offset: -702, scrollY: 23000, details: { 'difference/x': true } };
  session.rememberView(secondRoute, secondView); session.savePosition(secondPosition);
  assert.equal(session.returnDistance(firstRoute, firstRoute), -1);
  const restoredFirst = session.activate(firstRoute, first.id);
  assert.deepEqual(session.readView(firstRoute, {}), firstView);
  assert.deepEqual(readingPositionDecision(restoredFirst, 'comparison-stage-aftermath'), { kind: 'restore', position: firstPosition });
  const restoredSecond = session.activate(secondRoute, second.id);
  assert.deepEqual(session.readView(secondRoute, {}), secondView);
  assert.deepEqual(readingPositionDecision(restoredSecond, 'comparison-stage-aftermath'), { kind: 'restore', position: secondPosition });
});
