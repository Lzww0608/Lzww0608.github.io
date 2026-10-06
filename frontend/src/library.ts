import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import type { Book, BookId, ChapterSummary, LibraryCatalog, Route } from './types.ts';

const library = catalog as LibraryCatalog;
export const libraryBooks = library.books;
export const libraryChapters = library.chapters;
export const chaptersForBook = (bookId: BookId): ChapterSummary[] => libraryChapters.filter(chapter => chapter.bookId === bookId);
export const chaptersForPerson = (personId: string): ChapterSummary[] => libraryChapters.filter(chapter => chapter.subjects.includes(personId));
export const chapterRoute = (chapter: ChapterSummary): Route => `read-${chapter.bookId}/${chapter.id}`;

export function resolveReadingRoute(route: string): { book: Book; chapter: ChapterSummary } | null {
  for (const book of libraryBooks) {
    const prefix = `read-${book.id}`;
    const chapterId = route === prefix ? book.defaultChapter : route.startsWith(`${prefix}/`) ? route.slice(prefix.length + 1) : null;
    const chapter = libraryChapters.find(item => item.id === chapterId && item.bookId === book.id);
    if (chapter) return { book, chapter };
  }
  return null;
}

export function resolveRoute(hash: string): Route {
  const route = hash.replace(/^#/, '');
  const pages: Route[] = ['overview', 'timeline', 'sources', 'people', 'map'];
  return pages.find(page => page === route) ?? (resolveReadingRoute(route) ? route as Route : 'overview');
}
