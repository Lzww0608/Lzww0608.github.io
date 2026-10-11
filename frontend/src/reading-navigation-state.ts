import { readingContextLeafRoute } from './reading-context-route.ts';
import type { Route } from './types.ts';

export interface ReadingPosition {
  scrollY: number;
  anchorId?: string;
  offset?: number;
  details: Record<string, boolean>;
}

export interface ReadingEntry {
  id: string;
  route: Route;
  view?: object;
  position?: ReadingPosition;
  intent: 'target' | 'restore';
  activation: number;
  cancelled: boolean;
  positioningStarted: boolean;
}

export function readingPageKey(route: string): string {
  return route.split('?', 1)[0] ?? route;
}

const clone = <T>(value: T): T => structuredClone(value);

// A bounded tab-local history, never serialized to storage. The browser history
// carries only an opaque entry ID, not content, credentials or reading state.
export function createReadingNavigationSession(limit = 64) {
  const capacity = Math.max(2, Math.min(128, Math.trunc(limit) || 64));
  const sessionId = globalThis.crypto.randomUUID();
  const entries = new Map<string, ReadingEntry>();
  let trail: string[] = [], currentIndex = -1, sequence = 0, activation = 0;
  const current = () => entries.get(trail[currentIndex] ?? '');
  function activate(route: Route, existingId?: string): ReadingEntry {
    const known = existingId && entries.get(existingId);
    if (known && known.route === route) {
      currentIndex = trail.indexOf(known.id);
      known.intent = 'restore'; known.activation = ++activation;
      known.cancelled = false; known.positioningStarted = false;
      return known;
    }
    // Traversing to an entry whose snapshot has expired (or predates a reload)
    // invalidates our history distances. Never append it as a fictitious push.
    if (existingId) { entries.clear(); trail = []; currentIndex = -1; }
    const previous = current();
    const id = `reading-${sessionId}-${++sequence}`;
    const entry: ReadingEntry = { id, route, intent: 'target', activation: ++activation,
      cancelled: false, positioningStarted: false,
      ...(previous?.view && readingPageKey(previous.route) === readingPageKey(route) ? { view: clone(previous.view) } : {}) };
    for (const discarded of trail.slice(currentIndex + 1)) entries.delete(discarded);
    trail = [...trail.slice(0, currentIndex + 1), id];
    entries.set(id, entry);
    while (trail.length > capacity) entries.delete(trail.shift()!);
    currentIndex = trail.length - 1;
    return entry;
  }
  function savePosition(position: ReadingPosition) {
    const entry = current();
    if (entry) entry.position = clone(position);
  }
  function rememberView(route: Route, value: object, entryId?: string) {
    const entry = current();
    if (entry?.route === route && (!entryId || entry.id === entryId)) entry.view = clone(value);
  }
  function readView<T extends object>(route: Route, fallback: T): T {
    const entry = current();
    return clone(entry?.route === route && entry.view ? entry.view as T : fallback);
  }
  function returnDistance(target: Route, expectedReturn?: Route): number | null {
    if (!expectedReturn) return null;
    const normalizedTarget = readingContextLeafRoute(target) ?? target;
    const normalizedReturn = readingContextLeafRoute(expectedReturn) ?? expectedReturn;
    if (normalizedTarget !== normalizedReturn) return null;
    for (let index = currentIndex - 1; index >= 0; index--) {
      const entry = entries.get(trail[index]!);
      if (entry && readingPageKey(entry.route) === readingPageKey(target)) return index - currentIndex;
    }
    return null;
  }
  function distanceToEntry(id?: string): number | null {
    const index = id ? trail.indexOf(id) : -1;
    return index >= 0 ? index - currentIndex : null;
  }
  function retainCurrentOnly() {
    const entry = current();
    entries.clear();
    trail = entry ? [entry.id] : [];
    currentIndex = entry ? 0 : -1;
    if (entry) entries.set(entry.id, entry);
  }
  return { activate, current, savePosition, rememberView, readView, returnDistance,
    distanceToEntry, retainCurrentOnly,
    cancel: () => { const entry = current(); if (entry) entry.cancelled = true; },
    size: () => entries.size };
}

export const readingNavigation = createReadingNavigationSession();

export function readReadingView<T extends object>(route: Route, fallback: T): T {
  return readingNavigation.readView(route, fallback);
}

export function rememberReadingView(route: Route, value: object, entryId?: string): void {
  readingNavigation.rememberView(route, value, entryId);
}

export type ReadingPositionDecision = { kind: 'cancel' | 'top' } |
  { kind: 'target'; anchorId: string } | { kind: 'restore'; position: ReadingPosition };

export function readingPositionDecision(entry: Pick<ReadingEntry, 'intent' | 'position' | 'cancelled'>, targetId?: string): ReadingPositionDecision {
  if (entry.cancelled) return { kind: 'cancel' };
  if (entry.intent === 'restore' && entry.position) return { kind: 'restore', position: clone(entry.position) };
  return targetId ? { kind: 'target', anchorId: targetId } : { kind: 'top' };
}

export function chooseReadingAnchor(candidates: { id: string; top: number; bottom: number }[], viewportTop = 24) {
  const crossing = candidates.filter(candidate => candidate.top <= viewportTop && candidate.bottom > viewportTop);
  if (crossing.length) return crossing.sort((a, b) => b.top - a.top)[0];
  return candidates.filter(candidate => candidate.bottom > 0).sort((a, b) => Math.abs(a.top - viewportTop) - Math.abs(b.top - viewportTop))[0];
}
