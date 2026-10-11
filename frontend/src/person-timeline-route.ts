import summary from './person-timeline-summary.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import type { HistoryPerson, Route } from './types.ts';

interface TimelineSummary {
  schemaVersion: 1;
  scope: 'current-archive';
  people: { personId: string; eventCount: number; eventIds: string[] }[];
}

const timelines = (summary as TimelineSummary).people;

export function hasPersonTimeline(personId: string): boolean {
  return timelines.some(person => person.personId === personId && person.eventCount > 0);
}

export function resolvePersonTimelineRoute(route: string): { person: HistoryPerson; eventId?: string } | null {
  const [path, query] = route.split('?', 2);
  const match = /^person-timeline\/([a-z0-9-]+)$/.exec(path ?? '');
  if (!match || route.split('?').length > 2) return null;
  const timeline = timelines.find(person => person.personId === match[1] && person.eventCount > 0);
  const person = catalogPeople.find(person => person.id === match[1]);
  if (!timeline || !person) return null;
  const parameters = new URLSearchParams(query);
  if ([...parameters.keys()].some(key => key !== 'event') || parameters.getAll('event').length > 1) return null;
  const eventId = parameters.get('event');
  if (eventId !== null && (!/^[a-z0-9-]+$/.test(eventId) || !timeline.eventIds.includes(eventId))) return null;
  return { person, ...(eventId ? { eventId } : {}) };
}

export function personTimelineRoute(personId: string, eventId?: string): Route {
  const parameters = new URLSearchParams();
  if (eventId) parameters.set('event', eventId);
  const route = `person-timeline/${personId}${parameters.size ? `?${parameters}` : ''}`;
  if (!resolvePersonTimelineRoute(route)) throw new Error('Invalid person timeline route');
  return route as Route;
}
