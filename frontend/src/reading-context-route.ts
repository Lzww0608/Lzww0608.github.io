import summary from './person-timeline-summary.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import { eventComparisons } from './event-comparison-data.ts';
import type { Route } from './types.ts';

export interface ReadingContextRoute {
  kind: 'timeline' | 'comparison';
  id: string;
  targetId?: string;
  returnTo?: Route;
  route: Route;
  leafRoute: Route;
}

// A return address is an internal, catalog-checked leaf. Pages may carry one
// such address; a Reader may return to that page, so the total depth is two.
// Keeping this parser separate avoids mutually recursive route resolvers.
export function resolveReadingContextRoute(route: string, allowReturn = true): ReadingContextRoute | null {
  if (route.length > 4096 || route.split('?').length > 2 || route.includes('#')) return null;
  const [path, query] = route.split('?', 2);
  const match = /^(person-timeline|event-comparison)\/([a-z0-9-]+)$/.exec(path ?? '');
  if (!match) return null;
  const kind = match[1] === 'person-timeline' ? 'timeline' : 'comparison';
  const id = match[2]!;
  const targetKey = kind === 'timeline' ? 'event' : 'stage';
  const parameters = new URLSearchParams(query);
  if ([...parameters.keys()].some(key => key !== targetKey && !(allowReturn && key === 'return'))
    || parameters.getAll(targetKey).length > 1 || parameters.getAll('return').length > 1) return null;
  const target = parameters.get(targetKey);
  if (kind === 'timeline') {
    const timeline = summary.people.find(person => person.personId === id && person.eventCount > 0);
    if (!timeline || !catalogPeople.some(person => person.id === id)
      || (target !== null && !timeline.eventIds.includes(target))) return null;
  } else {
    const comparison = eventComparisons.find(document => document.id === id);
    if (!comparison || (target !== null && !comparison.stages.some(stage => stage.id === target))) return null;
  }
  const canonical = new URLSearchParams();
  if (target !== null) canonical.set(targetKey, target);
  const leafRoute = `${path}${canonical.size ? `?${canonical}` : ''}` as Route;
  const returnValue = parameters.get('return');
  let returnTo: Route | undefined;
  if (returnValue !== null) {
    const resolved = resolveReadingContextRoute(returnValue, false);
    if (!resolved || resolved.leafRoute === leafRoute) return null;
    returnTo = resolved.leafRoute;
    canonical.set('return', returnTo);
  }
  return { kind, id, ...(target !== null ? { targetId: target } : {}), ...(returnTo ? { returnTo } : {}),
    leafRoute, route: `${path}${canonical.size ? `?${canonical}` : ''}` as Route };
}

export function readingContextLeafRoute(route: string): Route | undefined {
  return resolveReadingContextRoute(route)?.leafRoute;
}

export function appendReadingReturn(route: string, returnTo?: string): Route {
  const destination = resolveReadingContextRoute(route, false);
  if (!destination) throw new Error('Invalid reading context route');
  if (!returnTo) return destination.route;
  const origin = resolveReadingContextRoute(returnTo);
  if (!origin || origin.leafRoute === destination.leafRoute) throw new Error('Invalid reading return route');
  const [path, query] = destination.route.split('?', 2);
  const parameters = new URLSearchParams(query);
  parameters.set('return', origin.leafRoute);
  return `${path}?${parameters}` as Route;
}
