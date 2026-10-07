import { readChapter } from './history-loader';
import type { BookId, ChapterResponse } from './types';

export const historyApiBase = (import.meta.env.VITE_HISTORY_API_URL || '').trim().replace(/\/$/, '');
export function loadChapter(bookId: BookId, chapterId: string, signal: AbortSignal, onArchive: (chapter: ChapterResponse) => void) {
  return readChapter({ bookId, chapterId, apiBase: historyApiBase, archiveBase: import.meta.env.BASE_URL, signal, onArchive });
}
