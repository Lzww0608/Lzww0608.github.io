import { eventComparisons } from './event-comparison-data.ts';
import type { Route } from './types.ts';

export function resolveEventComparisonRoute(route: string) {
  if (route.split('?').length > 2) return null;
  const [path, query] = route.split('?', 2);
  const match = /^event-comparison\/([a-z0-9-]+)$/.exec(path ?? '');
  const document = match && eventComparisons.find(item => item.id === match[1]);
  if (!document) return null;
  const parameters = new URLSearchParams(query);
  if ([...parameters.keys()].some(key => key !== 'stage') || parameters.getAll('stage').length > 1) return null;
  const stageId = parameters.get('stage');
  if (stageId !== null && !document.stages.some(stage => stage.id === stageId)) return null;
  return { document, ...(stageId ? {stageId} : {}) };
}

export function eventComparisonRoute(comparisonId: string, stageId?: string): Route {
  const parameters = new URLSearchParams();
  if (stageId) parameters.set('stage', stageId);
  const route = `event-comparison/${comparisonId}${parameters.size ? `?${parameters}` : ''}`;
  if (!resolveEventComparisonRoute(route)) throw new Error('Invalid event comparison route');
  return route as Route;
}
