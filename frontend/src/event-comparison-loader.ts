import { parseChapter } from './chapter-schema.ts';
import { hasPublicReadingResponse, publicReadingFetch } from './public-reading-fetch.ts';
import { comparisonSourceCaption, parseEventComparisonDocument, resolveComparisonSource, resolveEventComparison } from './event-comparison-schema.ts';
import type { ComparisonSourceUnavailableReason, EventComparisonDocument, EventComparisonResponse, ResolvedComparisonSource } from './event-comparison-schema.ts';
import type { BookId, ChapterResponse } from './types.ts';

type ChapterRead = { source: 'api' | 'archive'; chapter: ChapterResponse } | {
  source: 'api' | 'archive' | 'none'; reason: ComparisonSourceUnavailableReason;
};

export interface ComparisonReadRequest {
  stageIds?: readonly string[];
  bookIds?: readonly BookId[];
  sourceIds?: readonly string[];
  differenceIds?: readonly string[];
}
export interface ComparisonReadProgress { page: EventComparisonResponse; complete: boolean }

function requestedSources(document: EventComparisonDocument, request?: ComparisonReadRequest): Set<string> {
  if (!request) return new Set(document.sources.map(source => source.id));
  if (Object.keys(request).some(key => !['stageIds', 'bookIds', 'sourceIds', 'differenceIds'].includes(key))) throw new Error('Invalid comparison request');
  const selections = [
    [request.stageIds, document.stages.map(stage => stage.id)],
    [request.bookIds, [...new Set(document.sources.map(source => source.bookId))]],
    [request.sourceIds, document.sources.map(source => source.id)],
    [request.differenceIds, document.differences.map(difference => difference.id)],
  ] as const;
  if (selections.some(([selection, allowed]) => selection !== undefined && (!Array.isArray(selection)
    || new Set(selection).size !== selection.length || selection.some(value => !(allowed as readonly string[]).includes(value))))) throw new Error('Invalid comparison request');
  const stageSources = request.stageIds ? new Set(document.stages.filter(stage => request.stageIds!.includes(stage.id)).flatMap(stage => stage.sourceIds)) : null;
  const ids = new Set<string>(request.sourceIds ?? []);
  if (request.stageIds !== undefined || request.bookIds !== undefined) for (const source of document.sources) {
    if ((!stageSources || stageSources.has(source.id)) && (!request.bookIds || request.bookIds.includes(source.bookId))) ids.add(source.id);
  }
  for (const difference of document.differences) if (request.differenceIds?.includes(difference.id)) {
    for (const evidence of difference.evidence) ids.add(evidence.sourceId);
  }
  return ids;
}

export async function readEventComparison({ document, apiBase, archiveBase, signal, fetcher = publicReadingFetch, request, onProgress, previousPage }: {
  document: unknown;
  apiBase: string;
  archiveBase: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
  request?: ComparisonReadRequest;
  onProgress?: (progress: ComparisonReadProgress) => void;
  // Only extend the same mounted reading page. Navigation/selection reloads
  // omit this snapshot and revalidate every requested source with the API.
  previousPage?: EventComparisonResponse;
}): Promise<{ page: EventComparisonResponse }> {
  signal.throwIfAborted();
  const checked = parseEventComparisonDocument(document);
  const requested = requestedSources(checked, request);
  const resolved = new Map<string, ResolvedComparisonSource>(checked.sources.map(reference => [reference.id, {
    ...comparisonSourceCaption(reference), status: 'pending', source: 'none', reason: requested.has(reference.id) ? 'loading' : 'not-requested',
  }]));
  if (previousPage) {
    if (JSON.stringify(parseEventComparisonDocument(previousPage.document)) !== JSON.stringify(checked)) throw new Error('Mismatched comparison snapshot');
    const previous = await resolveEventComparison(checked, await Promise.all(previousPage.sources.map(source => source.status === 'available'
      ? resolveComparisonSource(source, source.paragraph, source.source) : source)));
    for (const source of previous.sources) if (source.status !== 'pending') {
      resolved.set(source.id, source);
      if (source.status === 'available') requested.delete(source.id);
    }
  }
  const chapterInputs = [...new Map(checked.sources.filter(source => requested.has(source.id)).map(source => [source.chapterId, { chapterId: source.chapterId, bookId: source.bookId }])).values()];
  let publication = Promise.resolve();
  function publish(complete: boolean) {
    const snapshot = checked.sources.map(reference => resolved.get(reference.id)!);
    publication = publication.then(async () => {
      signal.throwIfAborted();
      const page = await resolveEventComparison(checked, snapshot);
      signal.throwIfAborted(); onProgress?.({ page, complete });
    });
    return publication;
  }
  if (onProgress) await publish(false);

  async function parseResponse(response: Response, bookId: BookId, chapterId: string, origin: 'api' | 'archive'): Promise<ChapterRead> {
    signal.throwIfAborted();
    if (!response.ok) return { source: origin, reason: origin === 'api' ? 'api-unavailable' : 'archive-unavailable' };
    try {
      const chapter = parseChapter(await response.json() as unknown, bookId, chapterId);
      if (new Set(chapter.paragraphs.map(paragraph => paragraph.id)).size !== chapter.paragraphs.length
        || new Set(chapter.paragraphs.map(paragraph => paragraph.position)).size !== chapter.paragraphs.length
        || chapter.paragraphs.some(paragraph => !new RegExp(`^${chapterId}-p[1-9][0-9]*$`).test(paragraph.id))) {
        return { source: origin, reason: 'invalid-chapter' };
      }
      signal.throwIfAborted();
      return { source: origin, chapter };
    } catch {
      signal.throwIfAborted();
      return { source: origin, reason: 'invalid-chapter' };
    }
  }

  async function readOneChapter(bookId: BookId, chapterId: string): Promise<ChapterRead> {
    if (apiBase.trim()) {
      let response: Response | undefined;
      try {
        response = await fetcher(`${apiBase.trim().replace(/\/$/, '')}/api/chapters/${encodeURIComponent(chapterId)}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit',
        });
      } catch (error) {
        signal.throwIfAborted();
        if (hasPublicReadingResponse(error)) return { source: 'api', reason: 'invalid-chapter' };
        // Only a failed network request permits a static chapter. Once the API
        // responds, HTTP errors, missing paragraphs and invalid content pause
        // that source rather than restoring an older deployed version.
      }
      if (response) return parseResponse(response, bookId, chapterId, 'api');
    }
    try {
      const response = await fetcher(`${archiveBase}history/chapters/${encodeURIComponent(chapterId)}.json`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit',
      });
      return parseResponse(response, bookId, chapterId, 'archive');
    } catch {
      signal.throwIfAborted();
      return { source: 'none', reason: 'archive-unavailable' };
    }
  }

  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, chapterInputs.length) }, async () => {
    while (cursor < chapterInputs.length) {
      signal.throwIfAborted();
      const { bookId, chapterId } = chapterInputs[cursor++]!;
      const result = await readOneChapter(bookId, chapterId);
      // A new response is authoritative for other paragraphs already read in
      // that chapter too, including a failed/empty/changed responding API.
      const references = checked.sources.filter(reference => reference.chapterId === chapterId
        && (requested.has(reference.id) || resolved.get(reference.id)?.status !== 'pending'));
      const sources = await Promise.all(references.map(reference => 'reason' in result
        ? { ...comparisonSourceCaption(reference), status: 'unavailable' as const, source: result.source, reason: result.reason }
        : resolveComparisonSource(reference, result.chapter.paragraphs.find(paragraph => paragraph.id === reference.paragraphId), result.source)));
      for (const source of sources) resolved.set(source.id, source);
      if (onProgress) await publish(false);
    }
  }));
  signal.throwIfAborted();
  await publication;
  const page = await resolveEventComparison(checked, checked.sources.map(reference => resolved.get(reference.id)!));
  signal.throwIfAborted();
  onProgress?.({ page, complete: true });
  return { page };
}
