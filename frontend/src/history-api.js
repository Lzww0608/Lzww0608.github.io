const apiBase = (import.meta.env.VITE_HISTORY_API_URL || '').trim().replace(/\/$/, '');
export const historyApiConfigured = Boolean(apiBase);
export async function loadChapter(bookId, signal) {
  if (!apiBase) return null;
  const response = await fetch(`${apiBase}/api/chapters/${encodeURIComponent(bookId)}-1`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Chapter unavailable');
  const chapter = await response.json();
  if (chapter.bookId !== bookId || !Array.isArray(chapter.paragraphs) || !chapter.paragraphs.length || !chapter.paragraphs.every(p => typeof p.id === 'string' && typeof p.original === 'string')) throw new Error('Invalid chapter');
  return chapter;
}
