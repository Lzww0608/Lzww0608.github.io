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
const sharedPerson = people.find(personId => [baixiang, huliu].every(document => document.links.some(link => link.personId === personId)));

test('both public topics are explicitly registered, match every prebuild document and share real person entrances', () => {
  assert.deepEqual(eventComparisons.map(document => document.id), ['baixiang', 'huliu']);
  assert.deepEqual(eventComparisons, loadEventComparisons(library));
  assert.deepEqual(eventTimelineLinks, loadEventTimelineLinks(library));
  assert.deepEqual(comparisonsForPerson('li-cunxu').map(document => document.id), ['baixiang', 'huliu']);
  assert.deepEqual(comparisonsForPerson('unknown'), []);
  assert.deepEqual(comparisons.get('huliu').stages.map(stage => stage.id), ['preparation', 'setback', 'counterattack', 'aftermath']);
  assert.ok(sharedPerson, 'a historical participant must actually have events registered for both battles');
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
