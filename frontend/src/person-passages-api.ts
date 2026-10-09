import { historyApiBase } from './history-api';
import { readPersonPassages } from './person-passages-loader';
import type { BookId, PersonPassagesResponse, SearchField } from './types';

export function loadPersonPassages(
  personId: string,
  bookId: BookId | undefined,
  signal: AbortSignal,
  onArchive?: (page: PersonPassagesResponse) => void,
  cursor?: string,
  options: { query?: string; field?: SearchField } = {},
) {
  return readPersonPassages({personId,bookId,signal,onArchive,cursor,...options,apiBase:historyApiBase,archiveBase:import.meta.env.BASE_URL});
}
