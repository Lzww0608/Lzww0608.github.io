import { eventComparisons } from './event-comparison-data.ts';
import { eventTimelineLinks } from './event-timeline-links.ts';
import { resolveEventTimelineLinks } from './event-timeline-links-schema.ts';
import { readEventComparison } from './event-comparison-loader.ts';
import { readPersonTimeline } from './person-timeline-loader.ts';
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

export async function readTimelineComparisonLinks({ personId, timeline, apiBase, archiveBase, signal, fetcher = fetch }: LinkReadOptions & {
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
    try {
      const comparisonDocument = eventComparisons.find(comparison => comparison.id === document.comparisonId)!;
      const comparison = await readEventComparison({ document: comparisonDocument, apiBase, archiveBase, signal, fetcher: sharedFetch });
      const resolved = await resolveEventTimelineLinks(selected, new Map([[personId, timeline]]), comparison.page);
      links.push(...resolved.links); unavailableCount += resolved.unavailableCount;
    } catch { signal.throwIfAborted(); unavailableCount += selected.links.length; }
  }
  signal.throwIfAborted();
  return { links, unavailableCount };
}

export async function readComparisonTimelineLinks({ comparison, apiBase, archiveBase, signal, fetcher = fetch }: LinkReadOptions & {
  comparison: EventComparisonResponse;
}): Promise<EventTimelineLinksResponse> {
  const document = eventTimelineLinks.find(document => document.comparisonId === comparison.document.id);
  if (!document) return { links: [], unavailableCount: 0 };
  const people = [...new Set(document.links.map(link => link.personId))];
  const timelines = new Map<string, PersonTimelineResponse>();
  const sharedFetch = boundedFetcher(fetcher, signal);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, people.length) }, async () => {
    while (cursor < people.length) {
      signal.throwIfAborted();
      const personId = people[cursor++]!;
      try {
        const result = await readPersonTimeline({ personId, apiBase, archiveBase, signal,
          eventIds: document.links.filter(link => link.personId === personId).map(link => link.eventId), fetcher: sharedFetch });
        timelines.set(personId, result.page);
      } catch { signal.throwIfAborted(); }
    }
  }));
  signal.throwIfAborted();
  const result = await resolveEventTimelineLinks(document, timelines, comparison);
  signal.throwIfAborted();
  return result;
}
