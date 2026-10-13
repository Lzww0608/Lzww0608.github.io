import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { eventComparisons } from '../src/event-comparison-data.ts';
import { eventTimelineLinks } from '../src/event-timeline-links.ts';
import { parseEventTimelineLinksDocument, resolveEventTimelineLinks, timelineEventIdentity } from '../src/event-timeline-links-schema.ts';
import { readTimelineComparisonLinks, readComparisonTimelineLinks } from '../src/event-timeline-links-loader.ts';
import { readPersonTimeline } from '../src/person-timeline-loader.ts';
import { readEventComparison } from '../src/event-comparison-loader.ts';

const hash = text => createHash('sha256').update(text).digest('hex');
const comparisonDocument = eventComparisons.find(document => document.id === 'baixiang');
const registry = eventTimelineLinks.find(document => document.comparisonId === 'baixiang');
const chapters = new Map(loadPublishedChapters(loadLibrary()).map(chapter => [chapter.id, chapter]));
const people = [...new Set(registry.links.map(link => link.personId))];
const documents = new Map(people.map(personId => [personId, JSON.parse(readFileSync(new URL(`../../content/person-timelines/${personId}.json`, import.meta.url), 'utf8'))]));
const signal = () => new AbortController().signal;
const options = () => ({ apiBase: '', archiveBase: '/', signal: signal() });
function archive(url) {
  const personId = /\/person-timelines\/([a-z0-9-]+)\.json$/.exec(url)?.[1];
  if (personId && documents.has(personId)) return Response.json(documents.get(personId));
  const chapterId = /\/chapters\/([a-z0-9-]+)(?:\.json)?$/.exec(url)?.[1];
  return chapterId && chapters.has(chapterId) ? Response.json(chapters.get(chapterId)) : new Response('', { status: 404 });
}
function apiTimelinePerson(url) {
  return /^\/api\/people\/([a-z0-9-]+)\/timeline$/.exec(new URL(url, 'https://archive.example').pathname)?.[1];
}
const comparison = (await readEventComparison({ ...options(), document: comparisonDocument, fetcher: async url => archive(url) })).page;
const timelines = new Map(await Promise.all(people.map(async personId => [personId,
  (await readPersonTimeline({ ...options(), personId, eventIds: registry.links.filter(link => link.personId === personId).map(link => link.eventId), fetcher: async url => archive(url) })).page])));

test('all real registered events resolve bidirectionally, without changing existing facts, originals or translations', async () => {
  const before = JSON.stringify([...documents, ...chapters]);
  const result = await resolveEventTimelineLinks(registry, timelines, comparison);
  assert.equal(result.links.length, 12); assert.equal(result.unavailableCount, 0);
  assert.equal(result.links.reduce((count, link) => count + link.stageIds.length, 0), 14);
  assert.equal(new Set(result.links.map(link => link.person.id)).size, 10);
  for (const link of result.links) {
    const reference = registry.links.find(reference => reference.personId === link.person.id && reference.eventId === link.event.id);
    assert.equal(hash(timelineEventIdentity(link.event)), reference.eventSha256);
    const backwards = await readTimelineComparisonLinks({ ...options(), personId: link.person.id, timeline: timelines.get(link.person.id), fetcher: async url => archive(url) });
    assert.ok(backwards.links.some(other => other.event.id === link.event.id && JSON.stringify(other.stageIds) === JSON.stringify(link.stageIds)));
  }
  assert.equal(JSON.stringify([...documents, ...chapters]), before);
});

test('unknown/private/duplicate links and unregistered stages, people, events and source roles are rejected', () => {
  for (const mutate of [value => { value.password = 'private'; }, value => { value.links[0].ownerReview = {}; },
    value => { value.links[0].personId = 'li-keyong'; }, value => { value.links[0].eventId = 'same-name-in-another-person'; },
    value => { value.links[0].eventSha256 = 'wrong'; }, value => { value.links.push(value.links[0]); },
    value => { value.links[0].stageIds.push('other-battle'); }, value => { value.links[0].stageIds.push(value.links[0].stageIds[0]); },
    value => { value.links[0].evidence = []; }, value => { value.links[0].evidence[0].sourceId = 'old-v001-p1'; },
    value => { value.links[0].evidence[0].credentials = 'private'; }]) {
    const value = structuredClone(registry); mutate(value);
    assert.throws(() => parseEventTimelineLinksDocument(value, comparisonDocument), /Invalid event timeline/);
  }
});

test('a stable event ID with changed facts or dates pauses its mapping rather than matching the year or keyword', async () => {
  const reference = registry.links[0];
  for (const mutate of [event => { event.summary += '内容修订。'; }, event => { event.sourceDate += '日期修订。'; },
    event => { event.evidence[0].excerpt += '无据'; }, event => { event.notes = ['新的事实限定']; }]) {
    const current = new Map(timelines), timeline = structuredClone(current.get(reference.personId));
    mutate(timeline.events.find(event => event.id === reference.eventId)); current.set(reference.personId, timeline);
    const result = await resolveEventTimelineLinks(registry, current, comparison);
    assert.ok(!result.links.some(link => link.person.id === reference.personId && link.event.id === reference.eventId));
    assert.equal(result.unavailableCount, 1);
  }
});

test('a suspended comparison source pauses its dependent stages while valid stages and other events remain available', async () => {
  const reference = registry.links.find(link => link.stageIds.length > 1);
  const stageId = reference.stageIds[0], sourceId = reference.evidence.find(evidence => evidence.stageId === stageId).sourceId;
  const paused = { ...comparison, sources: comparison.sources.map(source => source.id === sourceId
    ? { id: source.id, status: 'unavailable', source: 'api', reason: 'stale-original' } : source) };
  const result = await resolveEventTimelineLinks(registry, timelines, paused);
  const linked = result.links.find(link => link.person.id === reference.personId && link.event.id === reference.eventId);
  assert.ok(!linked?.stageIds.includes(stageId));
  assert.ok(result.links.length > 0); assert.ok(result.unavailableCount > 0);
});

test('responding empty, invalid and failed API timelines cannot revive a static link', async () => {
  const personId = people[0], current = timelines.get(personId);
  for (const apiResponse of [Response.json({ ...current, events: [], unavailableCount: 1 }),
    new Response('', { status: 500 }), new Response('{bad'), new Response(null, { status: 204 }), Response.error(),
    Response.json({ ...current, personId: 'li-keyong' })]) {
    const result = await readComparisonTimelineLinks({ ...options(), comparison, apiBase: 'https://api.example', fetcher: async url => {
      const id = apiTimelinePerson(url);
      if (id === personId) return apiResponse;
      return id ? Response.json(timelines.get(id)) : archive(url);
    } });
    assert.ok(!result.links.some(link => link.person.id === personId));
    assert.equal(result.unavailableCount, registry.links.filter(link => link.personId === personId).length);
  }
});

test('concurrency slots cover complete streamed bodies and responding truncated bodies cannot restore static links', async () => {
  let active = 0, peak = 0;
  const result = await readComparisonTimelineLinks({ ...options(), comparison, apiBase: 'https://api.example', fetcher: async (url, init) => {
    const id = apiTimelinePerson(url);
    const value = id ? timelines.get(id) : await archive(url).json();
    assert.equal(init.signal.aborted, false); active++; peak = Math.max(peak, active);
    return new Response(new ReadableStream({ async start(controller) {
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      if (id === people[0]) controller.error(new TypeError('Body transfer failed after headers'));
      else { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); }
    } }));
  } });
  assert.ok(peak <= 6); assert.ok(!result.links.some(link => link.person.id === people[0]));
  assert.equal(result.unavailableCount, registry.links.filter(link => link.personId === people[0]).length);
});

test('offline selected-event reads are deduplicated and globally bounded and never load unrelated person chapters', async () => {
  let active = 0, peak = 0; const calls = [];
  const result = await readComparisonTimelineLinks({ ...options(), comparison, fetcher: async (url, init) => {
    assert.equal(init.credentials, 'omit'); calls.push(url); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--; return archive(url);
  } });
  assert.equal(result.links.length, 12); assert.equal(result.unavailableCount, 0);
  assert.ok(peak <= 6); assert.equal(new Set(calls).size, calls.length);
  const expected = new Set([...timelines.values()].flatMap(timeline => timeline.events.flatMap(event =>
    [...event.evidence, ...(event.variants?.flatMap(variant => variant.evidence) ?? [])].map(source => `/history/chapters/${source.chapterId}.json`))));
  assert.deepEqual(new Set(calls.filter(url => url.includes('/chapters/'))), expected);
});

test('a person timeline verifies only comparison references for that person’s available registered events', async () => {
  const personId = people[0], calls = [];
  const timeline = (await readPersonTimeline({ ...options(), personId, fetcher: async url => archive(url) })).page;
  const result = await readTimelineComparisonLinks({ ...options(), personId, timeline,
    fetcher: async url => { calls.push(url); return archive(url); } });
  const selectedLinks = eventTimelineLinks.flatMap(document => document.links.filter(link => link.personId === personId && timeline.events.some(event => event.id === link.eventId)));
  const expected = new Set(eventTimelineLinks.flatMap(document => document.links.filter(link => selectedLinks.includes(link)).flatMap(link => link.evidence.map(evidence => {
    const source = eventComparisons.find(comparison => comparison.id === document.comparisonId).sources.find(source => source.id === evidence.sourceId);
    return `/history/chapters/${source.chapterId}.json`;
  }))));
  assert.deepEqual(new Set(calls), expected);
  assert.equal(result.links.length, selectedLinks.length);
  assert.equal(result.unavailableCount, 0);
});

test('a comparison stage reads only its linked timeline events and all of their primary and variant evidence', async () => {
  const stageId = 'battle', calls = [];
  const result = await readComparisonTimelineLinks({ ...options(), comparison, stageIds: [stageId],
    fetcher: async url => { calls.push(url); return archive(url); } });
  const selectedLinks = registry.links.filter(link => link.stageIds.includes(stageId));
  assert.equal(result.links.length, selectedLinks.length);
  assert.ok(result.links.every(link => JSON.stringify(link.stageIds) === JSON.stringify([stageId])));
  const selectedEvents = selectedLinks.map(link => documents.get(link.personId).events.find(event => event.id === link.eventId));
  const expectedChapters = new Set(selectedEvents.flatMap(event => [...event.evidence,
    ...(event.variants?.flatMap(variant => variant.evidence) ?? [])].map(source => `/history/chapters/${source.chapterId}.json`)));
  assert.deepEqual(new Set(calls.filter(url => url.includes('/chapters/'))), expectedChapters);
  assert.deepEqual(new Set(calls.filter(url => url.includes('/person-timelines/'))),
    new Set(selectedLinks.map(link => `/history/person-timelines/${link.personId}.json`)));
  assert.equal(result.unavailableCount, 0);
});

test('stage API requests select only registered linked event IDs while retaining complete checked events', async () => {
  const stageId = 'battle', calls = [];
  const selectedLinks = registry.links.filter(link => link.stageIds.includes(stageId));
  const result = await readComparisonTimelineLinks({ ...options(), comparison, stageIds: [stageId], apiBase: 'https://api.example',
    fetcher: async url => {
      const personId = apiTimelinePerson(url);
      if (!personId) return archive(url);
      const ids = new URL(url).searchParams.getAll('eventId');
      calls.push({ personId, ids });
      const events = timelines.get(personId).events.filter(event => ids.includes(event.id));
      return Response.json({ ...timelines.get(personId), events });
    } });
  assert.equal(result.links.length, selectedLinks.length);
  assert.equal(calls.length, new Set(selectedLinks.map(link => link.personId)).size);
  for (const call of calls) assert.deepEqual(new Set(call.ids),
    new Set(selectedLinks.filter(link => link.personId === call.personId).map(link => link.eventId)));
});

test('comparison proof that is still pending cannot report a changed timeline or trigger unrelated timeline reads', async () => {
  const pending = { ...comparison, sources: comparison.sources.map(source => ({ ...source, status: 'pending', source: 'none', reason: 'not-requested' })) };
  let calls = 0;
  const result = await readComparisonTimelineLinks({ ...options(), comparison: pending, stageIds: ['battle'], fetcher: async () => { calls++; throw new Error('No valid comparison proof'); } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { links: [], unavailableCount: 0 });
});

test('latest API translation versions are retained in the mapped event while canonical fact identity remains valid', async () => {
  const current = structuredClone(timelines.get(people[0]));
  const source = current.events[0].evidence[0];
  source.paragraph.translation = { ...source.paragraph.translation, id: 'latest-owner-version', version: source.paragraph.translation.version + 1,
    text: `${source.paragraph.translation.text}校订。`, origin: 'human', reviewStatus: 'owner-edited' };
  const result = await readComparisonTimelineLinks({ ...options(), comparison, apiBase: 'https://api.example', fetcher: async url => {
    const id = apiTimelinePerson(url);
    return id ? Response.json(id === people[0] ? current : timelines.get(id)) : archive(url);
  } });
  const link = result.links.find(link => link.person.id === people[0] && link.event.id === current.events[0].id);
  assert.equal(link.event.evidence[0].paragraph.translation.id, 'latest-owner-version');
  assert.equal(result.unavailableCount, 0);
});

test('cancellation releases queued link reads and an unrelated or mismatched person never receives fabricated mappings', async () => {
  const controller = new AbortController();
  await assert.rejects(readComparisonTimelineLinks({ ...options(), comparison, signal: controller.signal, fetcher: async () => {
    controller.abort(); throw new DOMException('Cancelled', 'AbortError');
  } }), error => error.name === 'AbortError');
  const unrelated = { ...timelines.get(people[0]), personId: 'li-keyong', events: [] };
  assert.deepEqual(await readTimelineComparisonLinks({ ...options(), personId: 'li-keyong', timeline: unrelated, fetcher: () => { throw new Error('Should not request'); } }), { links: [], unavailableCount: 0 });
  await assert.rejects(readTimelineComparisonLinks({ ...options(), personId: 'li-keyong', timeline: timelines.get(people[0]) }), /Mismatched timeline/);
});
