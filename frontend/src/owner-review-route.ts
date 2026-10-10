import type { BookId, ReviewCategory, ReviewStatus, Route } from './types.ts';

export type OwnerReviewFilters = { personId: string; bookId: string; status: string; category: string; offset: number };
export const reviewStatuses: ReviewStatus[] = ['open', 'resolved', 'retained', 'checked'];
export const reviewCategories: ReviewCategory[] = ['translation', 'association', 'relationship', 'source-note'];
const subjectIds = ['li-keyong', 'li-cunxu', 'zhu-wen', 'chai-rong'];
const bookIds: BookId[] = ['old', 'new', 'tongjian', 'quewen', 'shibu', 'chunqiu', 'huiyao', 'beimeng', 'kaoyi'];

export function resolveOwnerReviewRoute(route: string): OwnerReviewFilters | null {
  const [path, query] = route.split('?', 2);
  if (path !== 'owner-review') return null;
  const parameters = new URLSearchParams(query);
  if ([...parameters.keys()].some(key => !['personId', 'bookId', 'status', 'category', 'offset'].includes(key))) return null;
  if ([...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) return null;
  const filters = { personId: parameters.get('personId') ?? '', bookId: parameters.get('bookId') ?? '', status: parameters.get('status') ?? '', category: parameters.get('category') ?? '', offset: Number(parameters.get('offset') ?? 0) };
  if (filters.personId && !subjectIds.includes(filters.personId)) return null;
  if (filters.bookId && !bookIds.includes(filters.bookId as BookId)) return null;
  if (filters.status && ![...reviewStatuses, 'stale'].includes(filters.status)) return null;
  if (filters.category && !reviewCategories.includes(filters.category as ReviewCategory)) return null;
  if (!Number.isSafeInteger(filters.offset) || filters.offset < 0 || filters.offset > 1000000) return null;
  return filters;
}

export function ownerReviewRoute(filters: OwnerReviewFilters): Route {
  const parameters = new URLSearchParams();
  for (const key of ['personId', 'bookId', 'status', 'category'] as const) if (filters[key]) parameters.set(key, filters[key]);
  if (filters.offset) parameters.set('offset', String(filters.offset));
  const route = `owner-review${parameters.size ? `?${parameters}` : ''}`;
  if (!resolveOwnerReviewRoute(route)) throw new Error('Invalid review route');
  return route as Route;
}
