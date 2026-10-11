import { parseChapter } from './chapter-schema.ts';
import { libraryChapters } from './library.ts';
import { parsePersonTimelineDocument, parsePersonTimelineResponse, resolveTimelineEvidence, timelineHash } from './person-timeline-schema.ts';
import type { PersonTimelineEvent, PersonTimelineResponse, ResolvedTimelineEvidence, TimelineEvidence } from './person-timeline-schema.ts';
import type { ChapterResponse } from './types.ts';

export async function readPersonTimeline({ personId, apiBase, archiveBase, signal, onArchive, eventIds, fetcher = fetch }: {
  personId: string;
  apiBase: string;
  archiveBase: string;
  signal: AbortSignal;
  onArchive?: (page: PersonTimelineResponse) => void;
  eventIds?: readonly string[];
  fetcher?: typeof fetch;
}): Promise<{ page: PersonTimelineResponse; source: 'api' | 'archive' }> {
  if (!/^[a-z0-9-]+$/.test(personId)) throw new Error('Unknown timeline person');
  signal.throwIfAborted();
  let authoritativeFailure = false;
  let apiResponded = false;
  const archiveRead = (async () => {
    async function request(url: string): Promise<unknown> {
      const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit' });
      if (!response.ok) throw new Error('Archived timeline unavailable');
      return await response.json() as unknown;
    }
    const document = parsePersonTimelineDocument(await request(`${archiveBase}history/person-timelines/${encodeURIComponent(personId)}.json`), personId);
    const selectedEvents = eventIds ? document.events.filter(event => eventIds.includes(event.id)) : document.events;
    const chapterIds = [...new Set(selectedEvents.flatMap(event => [...event.evidence, ...(event.variants?.flatMap(variant => variant.evidence) ?? [])]).map(item => item.chapterId))];
    const chapters = new Map<string, ChapterResponse>();
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, chapterIds.length) }, async () => {
      while (cursor < chapterIds.length) {
        signal.throwIfAborted();
        const chapterId = chapterIds[cursor++]!, metadata = libraryChapters.find(item => item.id === chapterId);
        if (!metadata) throw new Error('Unknown timeline source');
        const source = parseChapter(await request(`${archiveBase}history/chapters/${encodeURIComponent(chapterId)}.json`), metadata.bookId, chapterId);
        chapters.set(chapterId, source);
      }
    }));
    async function resolveList(evidence: TimelineEvidence[]): Promise<ResolvedTimelineEvidence[]> {
      return Promise.all(evidence.map(reference => {
        const source = chapters.get(reference.chapterId)?.paragraphs.find(paragraph => paragraph.id === reference.paragraphId);
        return resolveTimelineEvidence(reference, source);
      }));
    }
    let unavailableCount = 0;
    const events: PersonTimelineEvent<ResolvedTimelineEvidence>[] = [];
    for (const event of selectedEvents) {
      signal.throwIfAborted();
      try {
        const evidence = await resolveList(event.evidence);
        const { variants: referenceVariants, ...eventData } = event;
        const variants = referenceVariants ? await Promise.all(referenceVariants.map(async variant => ({ ...variant, evidence: await resolveList(variant.evidence) }))) : undefined;
        events.push({ ...eventData, evidence, ...(variants !== undefined ? { variants } : {}) });
      } catch {
        // A changed source pauses the complete event, including its variants.
        unavailableCount++;
      }
    }
    const resultSetRevision = await timelineHash(JSON.stringify({ personId, events, unavailableCount }));
    const page = await parsePersonTimelineResponse({ schemaVersion: 1, scope: 'current-archive', personId, events, unavailableCount, resultSetRevision }, personId);
    signal.throwIfAborted();
    if (!apiResponded) onArchive?.(page);
    return page;
  })();
  const liveRead = apiBase ? (async () => {
    const response = await fetcher(`${apiBase.replace(/\/$/, '')}/api/people/${encodeURIComponent(personId)}/timeline`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit',
    });
    // A responding API is authoritative. Error/unknown responses and invalid
    // successful JSON must never revive a previously deployed event.
    apiResponded = true;
    authoritativeFailure = true;
    if (!response.ok) throw new Error('Current timeline unavailable');
    const completePage = await parsePersonTimelineResponse(await response.json(), personId);
    const page = eventIds ? { ...completePage, events: completePage.events.filter(event => eventIds.includes(event.id)) } : completePage;
    authoritativeFailure = false;
    return page;
  })() : Promise.reject(new Error('API not configured'));
  const [live, local] = await Promise.allSettled([liveRead, archiveRead]);
  signal.throwIfAborted();
  if (live.status === 'fulfilled') return { page: live.value, source: 'api' };
  if (authoritativeFailure) throw new Error('Current timeline could not be verified');
  if (local.status === 'fulfilled') return { page: local.value, source: 'archive' };
  throw new Error('No available person timeline');
}
