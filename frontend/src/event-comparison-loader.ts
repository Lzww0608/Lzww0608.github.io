import { parseChapter } from './chapter-schema.ts';
import { comparisonSourceCaption, parseEventComparisonDocument, resolveComparisonSource, resolveEventComparison } from './event-comparison-schema.ts';
import type { ComparisonSourceUnavailableReason, EventComparisonResponse } from './event-comparison-schema.ts';
import type { BookId, ChapterResponse } from './types.ts';

type ChapterRead = { source: 'api' | 'archive'; chapter: ChapterResponse } | {
  source: 'api' | 'archive' | 'none'; reason: ComparisonSourceUnavailableReason;
};

export async function readEventComparison({ document, apiBase, archiveBase, signal, fetcher = fetch }: {
  document: unknown;
  apiBase: string;
  archiveBase: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ page: EventComparisonResponse }> {
  signal.throwIfAborted();
  const checked = parseEventComparisonDocument(document);
  const chapterInputs = [...new Map(checked.sources.map(source => [source.chapterId, { chapterId: source.chapterId, bookId: source.bookId }])).values()];
  const chapters = new Map<string, ChapterRead>();

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
      } catch {
        signal.throwIfAborted();
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
      chapters.set(chapterId, await readOneChapter(bookId, chapterId));
    }
  }));
  signal.throwIfAborted();
  const sources = await Promise.all(checked.sources.map(reference => {
    const result = chapters.get(reference.chapterId)!;
    if ('reason' in result) return { ...comparisonSourceCaption(reference), status: 'unavailable' as const, source: result.source, reason: result.reason };
    return resolveComparisonSource(reference, result.chapter.paragraphs.find(paragraph => paragraph.id === reference.paragraphId), result.source);
  }));
  signal.throwIfAborted();
  const page = await resolveEventComparison(checked, sources);
  signal.throwIfAborted();
  return { page };
}
