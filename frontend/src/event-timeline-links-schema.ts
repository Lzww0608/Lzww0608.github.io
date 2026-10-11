import timelineSummary from './person-timeline-summary.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import { timelineHash } from './person-timeline-schema.ts';
import type { EventComparisonDocument, EventComparisonResponse } from './event-comparison-schema.ts';
import type { PersonTimelineEvent, PersonTimelineResponse, TimelineEvidence } from './person-timeline-schema.ts';

export interface EventTimelineLinkEvidence {
  stageId: string;
  sourceId: string;
  excerpt: string;
  timelineParagraphId: string;
  timelineExcerpt: string;
}
export interface EventTimelineLink {
  personId: string;
  eventId: string;
  eventSha256: string;
  stageIds: string[];
  evidence: EventTimelineLinkEvidence[];
}
export interface EventTimelineLinksDocument {
  schemaVersion: 1;
  scope: 'current-archive';
  comparisonId: string;
  links: EventTimelineLink[];
}
export interface ResolvedEventTimelineLink {
  person: (typeof catalogPeople)[number];
  event: PersonTimelineResponse['events'][number];
  comparisonId: string;
  stageIds: string[];
}
export interface EventTimelineLinksResponse {
  links: ResolvedEventTimelineLink[];
  unavailableCount: number;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 20000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
const id = (value: unknown): value is string => text(value, 150) && /^[a-z0-9-]+$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const knownEvents = new Map(timelineSummary.people.map(person => [person.personId, person.eventIds as readonly string[]]));
function fail(): never { throw new Error('Invalid event timeline links'); }
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).some(key => !expected.includes(key))) fail();
}

export function parseEventTimelineLinksDocument(value: unknown, comparison: EventComparisonDocument,
  eventIds: ReadonlyMap<string, readonly string[]> = knownEvents): EventTimelineLinksDocument {
  if (!object(value) || value.schemaVersion !== 1 || value.scope !== 'current-archive' || value.comparisonId !== comparison.id
    || !Array.isArray(value.links) || !value.links.length || value.links.length > 1000) fail();
  keys(value, ['schemaVersion', 'scope', 'comparisonId', 'links']);
  const links = value.links.map(item => {
    if (!object(item) || !id(item.personId) || !comparison.personIds.includes(item.personId)
      || !catalogPeople.some(person => person.id === item.personId) || !id(item.eventId)
      || !eventIds.get(item.personId)?.includes(item.eventId) || !hash(item.eventSha256)
      || !Array.isArray(item.stageIds) || !item.stageIds.length || item.stageIds.length > comparison.stages.length
      || !item.stageIds.every(stageId => id(stageId) && comparison.stages.some(stage => stage.id === stageId))
      || new Set(item.stageIds).size !== item.stageIds.length
      || !Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 100) fail();
    keys(item, ['personId', 'eventId', 'eventSha256', 'stageIds', 'evidence']);
    const stageIds = item.stageIds as string[];
    const evidence = item.evidence.map(reference => {
      if (!object(reference) || !id(reference.stageId) || !stageIds.includes(reference.stageId)
        || !id(reference.sourceId) || !comparison.stages.find(stage => stage.id === reference.stageId)?.sourceIds.includes(reference.sourceId)
        || !text(reference.excerpt) || !id(reference.timelineParagraphId) || !text(reference.timelineExcerpt)) fail();
      keys(reference, ['stageId', 'sourceId', 'excerpt', 'timelineParagraphId', 'timelineExcerpt']);
      return { stageId: reference.stageId, sourceId: reference.sourceId, excerpt: reference.excerpt,
        timelineParagraphId: reference.timelineParagraphId, timelineExcerpt: reference.timelineExcerpt };
    });
    if (stageIds.some(stageId => !evidence.some(reference => reference.stageId === stageId))
      || new Set(evidence.map(reference => JSON.stringify(reference))).size !== evidence.length) fail();
    return { personId: item.personId, eventId: item.eventId, eventSha256: item.eventSha256, stageIds, evidence };
  });
  if (new Set(links.map(link => `${link.personId}/${link.eventId}`)).size !== links.length) fail();
  return { schemaVersion: 1, scope: 'current-archive', comparisonId: comparison.id, links };
}

function canonicalEvidence(value: TimelineEvidence): TimelineEvidence {
  return { chapterId: value.chapterId, paragraphId: value.paragraphId, originalRevision: value.originalRevision,
    originalSha256: value.originalSha256, excerpt: value.excerpt };
}

// Match the canonical document parser's field order. Resolved source text and
// current translation versions are validated separately, never part of facts.
export function timelineEventIdentity(event: PersonTimelineEvent): string {
  return JSON.stringify({ id: event.id, year: event.year, ...(event.yearRange ? { yearRange: { start: event.yearRange.start, end: event.yearRange.end } } : {}),
    sortOrder: event.sortOrder, title: event.title, summary: event.summary, sourceDate: event.sourceDate, precision: event.precision, phase: event.phase,
    evidence: event.evidence.map(canonicalEvidence), ...(event.variants !== undefined ? { variants: event.variants.map(variant => ({
      label: variant.label, sourceDate: variant.sourceDate, ...(variant.year !== undefined ? { year: variant.year } : {}),
      ...(variant.summary !== undefined ? { summary: variant.summary } : {}), ...(variant.notes !== undefined ? { notes: variant.notes } : {}),
      evidence: variant.evidence.map(canonicalEvidence),
    })) } : {}), ...(event.notes !== undefined ? { notes: event.notes } : {}) });
}

export async function resolveEventTimelineLinks(document: EventTimelineLinksDocument,
  timelines: ReadonlyMap<string, PersonTimelineResponse>, comparison: EventComparisonResponse): Promise<EventTimelineLinksResponse> {
  if (document.comparisonId !== comparison.document.id) throw new Error('Mismatched comparison');
  const links: ResolvedEventTimelineLink[] = [];
  let unavailableCount = 0;
  for (const link of document.links) {
    const person = catalogPeople.find(person => person.id === link.personId);
    const timeline = timelines.get(link.personId);
    const event = timeline?.personId === link.personId ? timeline.events.find(event => event.id === link.eventId) : undefined;
    if (!person || !event || await timelineHash(timelineEventIdentity(event)) !== link.eventSha256) { unavailableCount++; continue; }
    const eventEvidence = [...event.evidence, ...(event.variants?.flatMap(variant => variant.evidence) ?? [])];
    const stageIds = link.stageIds.filter(stageId => link.evidence.filter(reference => reference.stageId === stageId).every(reference => {
      const source = comparison.sources.find(source => source.id === reference.sourceId);
      const timelineEvidence = eventEvidence.find(source => source.paragraphId === reference.timelineParagraphId && source.excerpt === reference.timelineExcerpt);
      return comparison.stages.some(stage => stage.id === stageId && stage.sourceIds.includes(reference.sourceId))
        && source?.status === 'available' && source.paragraph.original.includes(reference.excerpt)
        && !!timelineEvidence && timelineEvidence.paragraph.original.includes(reference.timelineExcerpt);
    }));
    if (stageIds.length !== link.stageIds.length) unavailableCount++;
    if (stageIds.length) links.push({ person, event, comparisonId: document.comparisonId, stageIds });
  }
  return { links, unavailableCount };
}
