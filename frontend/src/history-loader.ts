import { parseChapter } from './chapter-schema.ts';
import type { BookId, ChapterResponse } from './types';

type Fetcher = typeof fetch;
export type ReadingResult = { chapter: ChapterResponse; source: 'api' | 'archive' };

// Start both reads together. A stopped Mac does not delay reading the static archive.
export async function readChapter({ bookId, chapterId, apiBase, archiveBase, signal, onArchive, fetcher = fetch }: {
  bookId: BookId;
  chapterId: string;
  apiBase: string;
  archiveBase: string;
  signal: AbortSignal;
  onArchive?: (chapter: ChapterResponse) => void;
  fetcher?: Fetcher;
}): Promise<ReadingResult> {
  let apiResponded = false;
  async function request(url: string, timeout: number, live = false): Promise<ChapterResponse> {
    const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]), credentials: 'omit' });
    if (live) apiResponded = true;
    if (!response.ok) throw new Error('Chapter unavailable');
    return parseChapter(await response.json() as unknown, bookId, chapterId);
  }
  const archive = request(`${archiveBase}history/chapters/${encodeURIComponent(chapterId)}.json`, 10000)
    .then(chapter => { if (!signal.aborted && !apiResponded) onArchive?.(chapter); return chapter; });
  // Attach both rejection handlers immediately, including cancellation on navigation.
  const api = apiBase ? request(`${apiBase}/api/chapters/${encodeURIComponent(chapterId)}`, 20000, true) : Promise.reject(new Error('API not configured'));
  const [live, local] = await Promise.allSettled([api, archive]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (live.status === 'fulfilled') return { chapter: live.value, source: 'api' };
  // An HTTP response is authoritative even if it is empty, malformed or its
  // body cannot be read. Only a connection failure may use the static archive.
  if (apiResponded) throw new Error('Current chapter could not be verified');
  if (local.status === 'fulfilled') return { chapter: local.value, source: 'archive' };
  throw new Error('No local or API chapter available');
}
