import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import summaries from './person-passage-summary.json' with { type: 'json' };
import type { Book, BookId, ChapterSummary, HistoryPerson, LibraryCatalog, PersonPassageSummary, Route } from './types.ts';

const library = catalog as LibraryCatalog;
export const libraryBooks = library.books;
export const libraryChapters = library.chapters;
export const chaptersForBook = (bookId: BookId): ChapterSummary[] => libraryChapters.filter(chapter => chapter.bookId === bookId).sort((a, b) => a.position - b.position);
export const chaptersForPerson = (personId: string): ChapterSummary[] => libraryChapters.filter(chapter => chapter.subjects.includes(personId));
export const chapterRoute = (chapter: ChapterSummary): Route => `read-${chapter.bookId}/${chapter.id}`;

export function personPassageBooks(personId: string) {
  return (summaries as PersonPassageSummary).people.find(person => person.id === personId)?.books ?? [];
}

export function personSourcesRoute(personId: string, bookId?: BookId): Route {
  return `person-sources/${personId}${bookId ? `/${bookId}` : ''}`;
}

export function resolvePersonSourcesRoute(route: string): {person: HistoryPerson; book?: Book} | null {
  const match = /^person-sources\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(route);
  if (!match) return null;
  const person = catalogPeople.find(item => item.id === match[1]);
  const book = match[2] ? libraryBooks.find(item => item.id === match[2]) : undefined;
  if (!person || (match[2] && !book)) return null;
  return {person,book};
}

export function preferredChapterForPerson(bookId: BookId, personId: string): ChapterSummary | undefined {
  const preferred = catalogPeople.find(person => person.id === personId)?.readingStarts?.[bookId];
  const matches = chaptersForBook(bookId).filter(chapter => chapter.subjects.includes(personId));
  return matches.find(chapter => chapter.id === preferred) ?? matches.find(chapter => chapter.volume > 0) ?? matches[0];
}

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
  return resolveReadingRoute(route) || resolvePersonSourcesRoute(route) ? route as Route : 'people';
}
