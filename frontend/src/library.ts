import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import summaries from './person-passage-summary.json' with { type: 'json' };
import { validateSearchQuery } from '../../content/passage-search.mts';
import { ownerReviewRoute, resolveOwnerReviewRoute } from './owner-review-route.ts';
import type { Book, BookId, ChapterSummary, HistoryPerson, LibraryCatalog, PersonPassageSummary, Route, SearchField } from './types.ts';

export interface PassageSearchOptions { query: string; field: SearchField }
export interface ReadingSearchContext extends PassageSearchOptions { returnTo?: Route }

function searchOptions(parameters: URLSearchParams): PassageSearchOptions {
  const query = validateSearchQuery(parameters.get('q') ?? '');
  const field = parameters.get('field');
  return { query, field: field === 'original' || field === 'translation' ? field : 'both' };
}

function searchParameters(options?: PassageSearchOptions): URLSearchParams {
  const parameters = new URLSearchParams();
  if (options?.query.trim()) {
    parameters.set('q', validateSearchQuery(options.query));
    parameters.set('field', options.field);
  }
  return parameters;
}

const library = catalog as LibraryCatalog;
export const libraryBooks = library.books;
export const libraryChapters = library.chapters;
export const chaptersForBook = (bookId: BookId): ChapterSummary[] => libraryChapters.filter(chapter => chapter.bookId === bookId).sort((a, b) => a.position - b.position);
export const chaptersForPerson = (personId: string): ChapterSummary[] => libraryChapters.filter(chapter => chapter.subjects.includes(personId));
export function chapterRoute(chapter: ChapterSummary, context?: ReadingSearchContext & { paragraphId?: string }): Route {
  const parameters = searchParameters(context);
  if (context?.paragraphId?.startsWith(`${chapter.id}-p`)) parameters.set('paragraph', context.paragraphId);
  if (context?.returnTo && (resolvePersonSourcesRoute(context.returnTo) || resolveOwnerReviewRoute(context.returnTo))) parameters.set('return', context.returnTo);
  return `read-${chapter.bookId}/${chapter.id}${parameters.size ? `?${parameters}` : ''}`;
}

export function personPassageBooks(personId: string) {
  return (summaries as PersonPassageSummary).people.find(person => person.id === personId)?.books ?? [];
}

export function personSourcesRoute(personId: string, bookId?: BookId, options?: PassageSearchOptions): Route {
  const parameters = searchParameters(options);
  return `person-sources/${personId}${bookId ? `/${bookId}` : ''}${parameters.size ? `?${parameters}` : ''}`;
}

export function resolvePersonSourcesRoute(route: string): {person: HistoryPerson; book?: Book; search: PassageSearchOptions} | null {
  const [path, query] = route.split('?', 2);
  const match = /^person-sources\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path ?? '');
  if (!match) return null;
  const person = catalogPeople.find(item => item.id === match[1]);
  const book = match[2] ? libraryBooks.find(item => item.id === match[2]) : undefined;
  if (!person || (match[2] && !book)) return null;
  try { return {person,book,search:searchOptions(new URLSearchParams(query))}; }
  catch { return null; }
}

export function preferredChapterForPerson(bookId: BookId, personId: string): ChapterSummary | undefined {
  const preferred = catalogPeople.find(person => person.id === personId)?.readingStarts?.[bookId];
  const matches = chaptersForBook(bookId).filter(chapter => chapter.subjects.includes(personId));
  return matches.find(chapter => chapter.id === preferred) ?? matches.find(chapter => chapter.volume > 0) ?? matches[0];
}

export function resolveReadingRoute(route: string): { book: Book; chapter: ChapterSummary; search: PassageSearchOptions; focusParagraphId?: string; returnTo?: Route } | null {
  const [path = '', query] = route.split('?', 2);
  const parameters = new URLSearchParams(query);
  for (const book of libraryBooks) {
    const prefix = `read-${book.id}`;
    const chapterId = path === prefix ? book.defaultChapter : path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null;
    const chapter = libraryChapters.find(item => item.id === chapterId && item.bookId === book.id);
    if (chapter) {
      const paragraph = parameters.get('paragraph');
      const returnRoute = parameters.get('return');
      const resolvedReturn = returnRoute ? resolvePersonSourcesRoute(returnRoute) : null;
      const ownerReturn = returnRoute ? resolveOwnerReviewRoute(returnRoute) : null;
      try {
        return { book, chapter, search: searchOptions(parameters), focusParagraphId: paragraph && new RegExp(`^${chapter.id}-p[1-9][0-9]*$`).test(paragraph) ? paragraph : undefined,
          returnTo: resolvedReturn ? personSourcesRoute(resolvedReturn.person.id, resolvedReturn.book?.id, resolvedReturn.search) : ownerReturn ? ownerReviewRoute(ownerReturn) : undefined };
      } catch { return null; }
    }
  }
  return null;
}

export function resolveRoute(hash: string): Route {
  const route = hash.replace(/^#/, '');
  return resolveReadingRoute(route) || resolvePersonSourcesRoute(route) || resolveOwnerReviewRoute(route) ? route as Route : 'people';
}
