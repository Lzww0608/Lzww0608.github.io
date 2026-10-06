import { parseChapter } from './chapter-schema';
import type { BookId, ChapterResponse } from './types';

const apiBase = (import.meta.env.VITE_HISTORY_API_URL || '').trim().replace(/\/$/, '');
export const historyApiConfigured = Boolean(apiBase);
export async function loadChapter(bookId: BookId, signal: AbortSignal): Promise<ChapterResponse | null> {
  if (!apiBase) return null;
  const response = await fetch(`${apiBase}/api/chapters/${encodeURIComponent(bookId)}-1`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Chapter unavailable');
  const chapter: unknown = await response.json();
  return parseChapter(chapter, bookId);
}
