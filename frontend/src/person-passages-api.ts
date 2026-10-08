import { historyApiBase } from './history-api';
import { readPersonPassages } from './person-passages-loader';
import type { BookId, PersonPassagesResponse } from './types';

export function loadPersonPassages(
  personId: string,
  bookId: BookId | undefined,
  signal: AbortSignal,
  onArchive?: (page: PersonPassagesResponse) => void,
  cursor?: string,
) {
  return readPersonPassages({personId,bookId,signal,onArchive,cursor,apiBase:historyApiBase,archiveBase:import.meta.env.BASE_URL});
}
