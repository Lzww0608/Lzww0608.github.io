import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import { isClickableReadingSpan, sliceCodePoints, splitReadingSpans } from './sentence-alignment.ts';
import type { ChapterParagraph, LibraryCatalog } from './types.ts';

export type ReadingAnnotationCategory = 'office' | 'military' | 'place';
export interface ReadingAnnotationReference {
  id: string;
  title: string;
  url: string;
  locator: string;
  evidence?: string;
}
export interface ReadingAnnotationEntry {
  id: string;
  term: string;
  kind: ReadingAnnotationCategory;
  explanation: string;
  uncertainty: string | null;
  referenceIds: string[];
}
export interface ReadingAnnotationOccurrence {
  entryId: string;
  sentenceIndex: number;
  originalStart: number;
  originalEnd: number;
}
export interface ReadingAnnotationParagraph {
  chapterId: string;
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  eventIds: string[];
  occurrences: ReadingAnnotationOccurrence[];
  noneReason?: string;
}
export interface ReadingAnnotationDocument {
  schemaVersion: 1;
  scope: 'current-archive';
  eventIds: string[];
  references: ReadingAnnotationReference[];
  entries: ReadingAnnotationEntry[];
  paragraphs: ReadingAnnotationParagraph[];
}
export interface ReadingAnnotationChapterDocument extends ReadingAnnotationDocument { chapterId: string }

const chapterIds = new Set((catalog as LibraryCatalog).chapters.map(chapter => chapter.id));
export const readingAnnotationEventIds: readonly string[] = ['baixiang', 'huliu', 'jinyang'];
const allowedEvents = new Set(readingAnnotationEventIds);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const id = (value: unknown): value is string => text(value, 150) && /^[a-z0-9-]+$/.test(value);
const offset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const integer = (value: unknown): value is number => offset(value) && value > 0;
const checksum = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
function fail(message: string): never { throw new Error(`Invalid reading annotations: ${message}`); }

// Only public HTTPS sources are clickable. The text is always rendered as text,
// and references cannot turn a citation into a local resource or credential URL.
export function safeReadingAnnotationUrl(value: unknown): value is string {
  if (!text(value, 2000) || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)
      && url.hostname.includes('.') && !url.hostname.endsWith('.')
      && !/^(?:\d+\.){3}\d+$/.test(url.hostname)
      && !/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(url.hostname);
  } catch { return false; }
}

function parseReference(value: unknown): ReadingAnnotationReference {
  if (!record(value) || !keys(value, ['id', 'title', 'url', 'locator', 'evidence']) || !id(value.id)
    || !text(value.title, 300) || !safeReadingAnnotationUrl(value.url) || !text(value.locator, 800)
    || value.evidence !== undefined && !text(value.evidence, 1200)) fail('reference');
  return { id: value.id, title: value.title, url: value.url, locator: value.locator,
    ...(value.evidence === undefined ? {} : { evidence: value.evidence as string }) };
}

function eventIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowedEvents.size
    || !value.every(eventId => typeof eventId === 'string' && allowedEvents.has(eventId))
    || new Set(value).size !== value.length) fail('event scope');
  return [...value];
}

export function parseReadingAnnotationDocument(input: unknown, expectedChapterId?: string): ReadingAnnotationDocument | ReadingAnnotationChapterDocument {
  if (!record(input) || !keys(input, ['schemaVersion', 'scope', 'eventIds', 'references', 'entries', 'paragraphs', ...(expectedChapterId === undefined ? [] : ['chapterId'])])
    || input.schemaVersion !== 1 || input.scope !== 'current-archive') fail('document');
  if (expectedChapterId !== undefined && (!chapterIds.has(expectedChapterId) || input.chapterId !== expectedChapterId)) fail('chapter identity');
  const events = eventIds(input.eventIds);
  if (!Array.isArray(input.references) || input.references.length > 1000 || !Array.isArray(input.entries)
    || input.entries.length > 2000 || !Array.isArray(input.paragraphs) || !input.paragraphs.length || input.paragraphs.length > 300) fail('collection size');
  const references = input.references.map(parseReference);
  const referenceIds = new Set(references.map(reference => reference.id));
  if (referenceIds.size !== references.length) fail('duplicate reference');
  const entries: ReadingAnnotationEntry[] = input.entries.map(value => {
    if (!record(value) || !keys(value, ['id', 'term', 'kind', 'explanation', 'uncertainty', 'referenceIds'])
      || !id(value.id) || !text(value.term, 80) || !['office', 'military', 'place'].includes(value.kind as string)
      || !text(value.explanation, 2000) || value.uncertainty !== null && !text(value.uncertainty, 1200)
      || !Array.isArray(value.referenceIds) || !value.referenceIds.length || value.referenceIds.length > 20
      || !value.referenceIds.every(referenceId => typeof referenceId === 'string' && referenceIds.has(referenceId))
      || new Set(value.referenceIds).size !== value.referenceIds.length) fail('entry');
    return { id: value.id, term: value.term, kind: value.kind as ReadingAnnotationCategory, explanation: value.explanation,
      uncertainty: value.uncertainty as string | null, referenceIds: [...value.referenceIds] as string[] };
  });
  const entryIds = new Set(entries.map(entry => entry.id));
  if (entryIds.size !== entries.length) fail('duplicate entry');
  const paragraphs: ReadingAnnotationParagraph[] = input.paragraphs.map(value => {
    if (!record(value) || !keys(value, ['chapterId', 'paragraphId', 'originalRevision', 'originalSha256', 'eventIds', 'occurrences', 'noneReason'])
      || typeof value.chapterId !== 'string' || !chapterIds.has(value.chapterId)
      || expectedChapterId !== undefined && value.chapterId !== expectedChapterId
      || typeof value.paragraphId !== 'string' || !new RegExp(`^${value.chapterId}-p[1-9][0-9]*$`).test(value.paragraphId)
      || !integer(value.originalRevision) || !checksum(value.originalSha256) || !Array.isArray(value.occurrences)
      || value.occurrences.length > 20_000 || value.noneReason !== undefined && !text(value.noneReason, 1000)) fail('paragraph');
    const paragraphEvents = eventIds(value.eventIds);
    if (paragraphEvents.some(eventId => !events.includes(eventId))) fail('paragraph scope');
    const occurrences: ReadingAnnotationOccurrence[] = value.occurrences.map(occurrence => {
      if (!record(occurrence) || !keys(occurrence, ['entryId', 'sentenceIndex', 'originalStart', 'originalEnd'])
        || typeof occurrence.entryId !== 'string' || !entryIds.has(occurrence.entryId)
        || !offset(occurrence.sentenceIndex) || !offset(occurrence.originalStart) || !integer(occurrence.originalEnd)
        || occurrence.originalEnd <= occurrence.originalStart) fail('occurrence');
      return { entryId: occurrence.entryId, sentenceIndex: occurrence.sentenceIndex,
        originalStart: occurrence.originalStart, originalEnd: occurrence.originalEnd };
    });
    const positions = occurrences.map(occurrence => `${occurrence.entryId}|${occurrence.sentenceIndex}|${occurrence.originalStart}|${occurrence.originalEnd}`);
    if (new Set(positions).size !== positions.length || !occurrences.length && !value.noneReason
      || occurrences.length > 0 && value.noneReason !== undefined) fail('occurrence audit');
    return { chapterId: value.chapterId, paragraphId: value.paragraphId, originalRevision: value.originalRevision,
      originalSha256: value.originalSha256, eventIds: paragraphEvents, occurrences,
      ...(value.noneReason === undefined ? {} : { noneReason: value.noneReason as string }) };
  });
  if (new Set(paragraphs.map(paragraph => paragraph.paragraphId)).size !== paragraphs.length) fail('duplicate paragraph');
  const usedEntries = new Set(paragraphs.flatMap(paragraph => paragraph.occurrences.map(occurrence => occurrence.entryId)));
  const usedReferences = new Set(entries.flatMap(entry => entry.referenceIds));
  if (usedEntries.size !== entries.length || usedReferences.size !== references.length
    || events.some(eventId => !paragraphs.some(paragraph => paragraph.eventIds.includes(eventId)))) fail('unreferenced content');
  const document: ReadingAnnotationDocument = { schemaVersion: 1, scope: 'current-archive', eventIds: events, references, entries, paragraphs };
  return expectedChapterId === undefined ? document : { ...document, chapterId: expectedChapterId };
}

export function matchesReadingAnnotationOccurrences(binding: ReadingAnnotationParagraph, paragraph: Pick<ChapterParagraph, 'id' | 'revision' | 'original'>,
  entries: readonly ReadingAnnotationEntry[]): boolean {
  if (binding.paragraphId !== paragraph.id || binding.originalRevision !== paragraph.revision) return false;
  const spans = splitReadingSpans(paragraph.original);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return binding.occurrences.every(occurrence => {
    const span = spans[occurrence.sentenceIndex];
    const entry = byId.get(occurrence.entryId);
    return !!span && !!entry && isClickableReadingSpan(span.text)
      && occurrence.originalStart >= span.start && occurrence.originalEnd <= span.end
      && sliceCodePoints(paragraph.original, occurrence.originalStart, occurrence.originalEnd) === entry.term;
  });
}
