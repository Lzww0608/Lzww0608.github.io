import { eventComparisons } from './event-comparison-data.ts';
import type { Route } from './types.ts';
import { appendReadingReturn, resolveReadingContextRoute } from './reading-context-route.ts';

export function resolveEventComparisonRoute(route: string) {
  const resolved = resolveReadingContextRoute(route);
  if (!resolved || resolved.kind !== 'comparison') return null;
  const document = eventComparisons.find(item => item.id === resolved.id)!;
  return { document, ...(resolved.targetId ? { stageId: resolved.targetId } : {}), ...(resolved.returnTo ? { returnTo: resolved.returnTo } : {}) };
}

export function eventComparisonRoute(comparisonId: string, stageId?: string, returnTo?: Route): Route {
  const parameters = new URLSearchParams();
  if (stageId) parameters.set('stage', stageId);
  const route = `event-comparison/${comparisonId}${parameters.size ? `?${parameters}` : ''}`;
  if (!resolveEventComparisonRoute(route)) throw new Error('Invalid event comparison route');
  return appendReadingReturn(route, returnTo);
}
