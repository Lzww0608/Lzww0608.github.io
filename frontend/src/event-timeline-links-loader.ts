import { eventComparisons } from './event-comparison-data.ts';
import { eventTimelineLinks } from './event-timeline-links.ts';
import { resolveEventTimelineLinks } from './event-timeline-links-schema.ts';
import { readEventComparison } from './event-comparison-loader.ts';
import { readPersonTimeline } from './person-timeline-loader.ts';
import { publicReadingFetch } from './public-reading-fetch.ts';
import type { EventComparisonResponse } from './event-comparison-schema.ts';
import type { PersonTimelineResponse } from './person-timeline-schema.ts';
import type { EventTimelineLinksResponse } from './event-timeline-links-schema.ts';

interface LinkReadOptions {
  apiBase: string;
  archiveBase: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}

// Only public reads in the current load share responses. There is no cross-load
// cache which could resurrect an older responding API or a revised event.
function boundedFetcher(fetcher: typeof fetch, signal: AbortSignal): typeof fetch {
  const requests = new Map<string, Promise<Response>>();
  const waiting: (() => void)[] = [];
  let active = 0;
  signal.addEventListener('abort', () => { while (waiting.length) waiting.shift()?.(); }, { once: true });
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    signal.throwIfAborted();
    const url = String(input);
    let request = requests.get(url);
    if (!request) {
      request = (async () => {
        while (active >= 6) { await new Promise<void>(resolve => waiting.push(resolve)); signal.throwIfAborted(); }
        signal.throwIfAborted(); active++;
        try {
          // The deadline starts when this read gets a slot, and the slot covers
          // the complete body. Large public timelines must not expire while
          // waiting behind another chapter or be counted as finished at headers.
          const response = await fetcher(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
          if (response.status === 0) return response;
          let body: ArrayBuffer;
          try { body = await response.arrayBuffer(); }
          catch (error) {
            signal.throwIfAborted();
            // A responding API remains authoritative even when its body fails.
            return new Response(new ReadableStream({ start(controller) { controller.error(error); } }),
              { status: response.status, statusText: response.statusText, headers: response.headers });
          }
          return new Response([204, 205, 304].includes(response.status) ? null : body,
            { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        finally { active--; waiting.shift()?.(); }
      })();
      requests.set(url, request);
    }
    return (await request).clone();
  }) as typeof fetch;
}

export async function readTimelineComparisonLinks({ personId, timeline, apiBase, archiveBase, signal, fetcher = publicReadingFetch }: LinkReadOptions & {
  personId: string;
  timeline: PersonTimelineResponse;
}): Promise<EventTimelineLinksResponse> {
  if (timeline.personId !== personId) throw new Error('Mismatched timeline');
  const documents = eventTimelineLinks.filter(document => document.links.some(link => link.personId === personId));
  const links: EventTimelineLinksResponse['links'] = [];
  let unavailableCount = 0;
  const sharedFetch = boundedFetcher(fetcher, signal);
  for (const document of documents) {
    signal.throwIfAborted();
    const selected = { ...document, links: document.links.filter(link => link.personId === personId) };
    const available = { ...selected, links: selected.links.filter(link => timeline.events.some(event => event.id === link.eventId)) };
    unavailableCount += selected.links.length - available.links.length;
    if (!available.links.length) continue;
    try {
      const comparisonDocument = eventComparisons.find(comparison => comparison.id === document.comparisonId)!;
      const sourceIds = [...new Set(available.links.flatMap(link => link.evidence.map(evidence => evidence.sourceId)))];
      const comparison = await readEventComparison({ document: comparisonDocument, request: { sourceIds }, apiBase, archiveBase, signal, fetcher: sharedFetch });
      const resolved = await resolveEventTimelineLinks(available, new Map([[personId, timeline]]), comparison.page);
      links.push(...resolved.links); unavailableCount += resolved.unavailableCount;
    } catch { signal.throwIfAborted(); unavailableCount += available.links.length; }
  }
  signal.throwIfAborted();
  return { links, unavailableCount };
}

export async function readComparisonTimelineLinks({ comparison, stageIds, apiBase, archiveBase, signal, fetcher = publicReadingFetch }: LinkReadOptions & {
  comparison: EventComparisonResponse;
  stageIds?: readonly string[];
}): Promise<EventTimelineLinksResponse> {
  const document = eventTimelineLinks.find(document => document.comparisonId === comparison.document.id);
  if (!document) return { links: [], unavailableCount: 0 };
  if (stageIds && (!stageIds.length || new Set(stageIds).size !== stageIds.length
    || stageIds.some(id => !comparison.document.stages.some(stage => stage.id === id)))) throw new Error('Invalid comparison stage selection');
  const scoped = { ...document, links: document.links.filter(link => !stageIds || link.stageIds.some(id => stageIds.includes(id))).map(link => {
    const selectedStages = stageIds ? link.stageIds.filter(id => stageIds.includes(id)) : link.stageIds;
    return { ...link, stageIds: selectedStages, evidence: link.evidence.filter(evidence => selectedStages.includes(evidence.stageId)) };
  }) };
  // Sources that were intentionally not requested have no failure verdict.
  // Defer these links until their complete comparison proof is requested.
  const selected = { ...scoped, links: scoped.links.filter(link => !link.evidence.some(evidence =>
    comparison.sources.find(source => source.id === evidence.sourceId)?.status === 'pending')) };
  const people = [...new Set(selected.links.map(link => link.personId))];
  const timelines = new Map<string, PersonTimelineResponse>();
  const sharedFetch = boundedFetcher(fetcher, signal);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, people.length) }, async () => {
    while (cursor < people.length) {
      signal.throwIfAborted();
      const personId = people[cursor++]!;
      try {
        const result = await readPersonTimeline({ personId, apiBase, archiveBase, signal,
          eventIds: selected.links.filter(link => link.personId === personId).map(link => link.eventId), fetcher: sharedFetch });
        timelines.set(personId, result.page);
      } catch { signal.throwIfAborted(); }
    }
  }));
  signal.throwIfAborted();
  const result = await resolveEventTimelineLinks(selected, timelines, comparison);
  signal.throwIfAborted();
  return result;
}
