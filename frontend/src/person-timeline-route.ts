import summary from './person-timeline-summary.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import type { HistoryPerson, Route } from './types.ts';
import { appendReadingReturn, resolveReadingContextRoute } from './reading-context-route.ts';

interface TimelineSummary {
  schemaVersion: 1;
  scope: 'current-archive';
  people: { personId: string; eventCount: number; eventIds: string[] }[];
}

const timelines = (summary as TimelineSummary).people;

export function hasPersonTimeline(personId: string): boolean {
  return timelines.some(person => person.personId === personId && person.eventCount > 0);
}

export function resolvePersonTimelineRoute(route: string): { person: HistoryPerson; eventId?: string; returnTo?: Route } | null {
  const resolved = resolveReadingContextRoute(route);
  if (!resolved || resolved.kind !== 'timeline') return null;
  const person = catalogPeople.find(person => person.id === resolved.id)!;
  return { person, ...(resolved.targetId ? { eventId: resolved.targetId } : {}), ...(resolved.returnTo ? { returnTo: resolved.returnTo } : {}) };
}

export function personTimelineRoute(personId: string, eventId?: string, returnTo?: Route): Route {
  const parameters = new URLSearchParams();
  if (eventId) parameters.set('event', eventId);
  const route = `person-timeline/${personId}${parameters.size ? `?${parameters}` : ''}`;
  if (!resolvePersonTimelineRoute(route)) throw new Error('Invalid person timeline route');
  return appendReadingReturn(route, returnTo);
}
