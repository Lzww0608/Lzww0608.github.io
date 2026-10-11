import { inferReadingPerson, normalizeReadingShelfRoute, readingProgressId } from './reading-shelf-schema.ts';
import type { Route } from './types.ts';

type Context = { entryId: string; route: Route; personId?: string };
const key = 'ancient-history-reading-context-v1';
const validId = (value: unknown): value is string => typeof value === 'string' && /^reading-[a-f0-9-]{36}-[1-9][0-9]{0,8}$/.test(value);
function storage(): Storage | null { try { return window.sessionStorage; } catch { return null; } }
function read(): Context[] {
  try {
    const raw = storage()?.getItem(key);
    if (!raw || raw.length > 65536) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 64) return [];
    return value.filter((item): item is Context => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      if (Object.keys(row).some(name => !['entryId', 'route', 'personId'].includes(name)) || !validId(row.entryId) || typeof row.route !== 'string') return false;
      if (normalizeReadingShelfRoute(row.route) !== row.route) return false;
      return row.personId === undefined || typeof row.personId === 'string' && inferReadingPerson(row.route, row.personId) === row.personId;
    });
  } catch { return []; }
}

// Only public routing metadata accompanies the opaque tab history ID. It lets
// two tabs read the same chapter for different people without swapping context.
export function rememberReadingContext(entryId: string, route: Route, personId?: string): void {
  const canonical = normalizeReadingShelfRoute(route);
  if (!validId(entryId) || !canonical || personId !== undefined && inferReadingPerson(canonical, personId) !== personId) return;
  const rows = read().filter(item => item.entryId !== entryId);
  rows.push({ entryId, route: canonical, ...(personId ? { personId } : {}) });
  try { storage()?.setItem(key, JSON.stringify(rows.slice(-64))); } catch { /* Progress itself has its own visible storage fallback. */ }
}

export function savedReadingContext(entryId: unknown, route: Route): Context | undefined {
  if (!validId(entryId) || !normalizeReadingShelfRoute(route)) return;
  return read().find(item => item.entryId === entryId && readingProgressId(item.route, item.personId) === readingProgressId(route, item.personId));
}
