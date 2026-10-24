import { libraryBooks, libraryChapters } from './library.ts';
import { catalogPeople } from './person-catalog.ts';
import { matchesCatalogChapterTitle, parseChapterParagraph } from './chapter-schema.ts';
import type { BookId, ChapterParagraph } from './types.ts';

export type TimelinePhase = 'early' | 'campaigns' | 'rivalry' | 'late' | 'posthumous' | 'jin' | 'conquest' | 'imperial' | 'fall' | 'rule' | 'service' | 'later' | 'uncertain';
export interface TimelineEvidence {
  chapterId: string;
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  excerpt: string;
}
export interface ResolvedTimelineEvidence extends TimelineEvidence {
  bookId: BookId;
  bookTitle: string;
  chapterTitle: string;
  paragraph: ChapterParagraph;
}
export interface TimelineVariant<Evidence = TimelineEvidence> {
  label: string;
  sourceDate: string;
  year?: number;
  summary?: string;
  notes?: string[];
  evidence: Evidence[];
}
export interface PersonTimelineEvent<Evidence = TimelineEvidence> {
  id: string;
  year: number | null;
  yearRange?: { start: number; end: number };
  sortOrder: number;
  title: string;
  summary: string;
  sourceDate: string;
  precision: 'year' | 'month' | 'day' | 'range' | 'undated';
  phase: TimelinePhase;
  evidence: Evidence[];
  variants?: TimelineVariant<Evidence>[];
  notes?: string[];
}
export interface PersonTimelineDocument {
  schemaVersion: 1;
  scope: 'current-archive';
  personId: string;
  events: PersonTimelineEvent[];
}
export interface PersonTimelineResponse {
  schemaVersion: 1;
  scope: 'current-archive';
  personId: string;
  events: PersonTimelineEvent<ResolvedTimelineEvidence>[];
  unavailableCount: number;
  resultSetRevision: string;
}

const phases: readonly TimelinePhase[] = ['early', 'campaigns', 'rivalry', 'late', 'posthumous', 'jin', 'conquest', 'imperial', 'fall', 'rule', 'service', 'later', 'uncertain'];
const chapters = new Map(libraryChapters.map(chapter => [chapter.id, chapter]));
const books = new Map(libraryBooks.map(book => [book.id, book]));
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const text = (value: unknown, maximum = 3000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new Error('Invalid person timeline data'); }

export async function timelineHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function evidence(value: unknown): TimelineEvidence {
  if (!record(value) || !text(value.chapterId, 100) || !chapters.has(value.chapterId)
    || !text(value.paragraphId, 120) || !new RegExp(`^${value.chapterId}-p[1-9][0-9]*$`).test(value.paragraphId)
    || !integer(value.originalRevision, 1) || !hash(value.originalSha256) || !text(value.excerpt, 20000)) fail();
  return { chapterId: value.chapterId, paragraphId: value.paragraphId, originalRevision: value.originalRevision, originalSha256: value.originalSha256, excerpt: value.excerpt };
}

function evidenceList(value: unknown): TimelineEvidence[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) fail();
  const entries = value.map(evidence);
  if (new Set(entries.map(item => `${item.chapterId}/${item.paragraphId}/${item.excerpt}`)).size !== entries.length) fail();
  return entries;
}

function event(value: unknown): PersonTimelineEvent {
  if (!record(value) || !text(value.id, 150) || !/^[a-z0-9-]+$/.test(value.id)
    || !integer(value.sortOrder)
    || !text(value.title, 200) || !text(value.summary) || !text(value.sourceDate, 600)
    || !phases.includes(value.phase as TimelinePhase)) fail();
  let yearRange: { start: number; end: number } | undefined;
  if (value.year === null) {
    if (value.phase !== 'uncertain') fail();
    if (value.precision === 'range') {
      if (!record(value.yearRange) || !integer(value.yearRange.start, 1) || !integer(value.yearRange.end, 1)
        || value.yearRange.start > value.yearRange.end || value.yearRange.end > 2000) fail();
      yearRange = { start: value.yearRange.start, end: value.yearRange.end };
    } else if (value.precision !== 'undated' || value.yearRange !== undefined) fail();
  } else if (!integer(value.year, 1) || value.year > 2000 || value.yearRange !== undefined
    || !['year', 'month', 'day'].includes(value.precision as string)) fail();
  const entries = evidenceList(value.evidence);
  let variants: TimelineVariant[] | undefined;
  if (value.variants !== undefined) {
    if (!Array.isArray(value.variants) || value.variants.length > 20) fail();
    variants = value.variants.map(item => {
      if (!record(item) || !text(item.label, 1000) || !text(item.sourceDate, 600)
        || (item.year !== undefined && (!integer(item.year, 1) || item.year > 2000))
        || (item.summary !== undefined && !text(item.summary))
        || (item.notes !== undefined && (!Array.isArray(item.notes) || item.notes.length > 24 || !item.notes.every(note => text(note, 2000))))) fail();
      return { label: item.label, sourceDate: item.sourceDate, ...(item.year !== undefined ? { year: item.year } : {}),
        ...(item.summary !== undefined ? { summary: item.summary } : {}), ...(item.notes !== undefined ? { notes: item.notes as string[] } : {}), evidence: evidenceList(item.evidence) };
    });
  }
  let notes: string[] | undefined;
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length > 24 || !value.notes.every(note => text(note, 2000))) fail();
    notes = value.notes as string[];
  }
  return { id: value.id, year: value.year, ...(yearRange ? { yearRange } : {}), sortOrder: value.sortOrder, title: value.title, summary: value.summary,
    sourceDate: value.sourceDate, precision: value.precision as PersonTimelineEvent['precision'], phase: value.phase as TimelinePhase,
    evidence: entries, ...(variants !== undefined ? { variants } : {}), ...(notes !== undefined ? { notes } : {}) };
}

function events(value: unknown): PersonTimelineEvent[] {
  if (!Array.isArray(value) || value.length > 1000) fail();
  const entries = value.map(event);
  if (new Set(entries.map(item => item.id)).size !== entries.length) fail();
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1]!, current = entries[index]!;
    if ((current.year ?? Infinity) < (previous.year ?? Infinity) || current.year === previous.year && current.sortOrder <= previous.sortOrder) fail();
  }
  return entries;
}

export function parsePersonTimelineDocument(value: unknown, personId: string): PersonTimelineDocument {
  if (!record(value) || value.schemaVersion !== 1 || value.scope !== 'current-archive' || value.personId !== personId
    || !catalogPeople.some(person => person.id === personId)) fail();
  const entries = events(value.events);
  if (entries.some(entry => !entry.id.startsWith(`${personId}-`))) fail();
  return { schemaVersion: 1, scope: 'current-archive', personId, events: entries };
}

export async function resolveTimelineEvidence(reference: TimelineEvidence, value: unknown): Promise<ResolvedTimelineEvidence> {
  const paragraph = parseChapterParagraph(value), chapter = chapters.get(reference.chapterId);
  if (!chapter || paragraph.id !== reference.paragraphId || paragraph.revision !== reference.originalRevision
    || !paragraph.original.includes(reference.excerpt) || await timelineHash(paragraph.original) !== reference.originalSha256
    || !paragraph.translation?.text.trim()) fail();
  return { ...reference, bookId: chapter.bookId, bookTitle: books.get(chapter.bookId)!.title, chapterTitle: chapter.title, paragraph };
}

export async function parsePersonTimelineResponse(value: unknown, personId: string): Promise<PersonTimelineResponse> {
  const checked = parsePersonTimelineDocument(value, personId);
  if (!record(value) || !integer(value.unavailableCount) || !hash(value.resultSetRevision) || !Array.isArray(value.events)) fail();
  const rawEvents = value.events;
  async function resolvedList(references: TimelineEvidence[], raw: unknown): Promise<ResolvedTimelineEvidence[]> {
    if (!Array.isArray(raw) || references.length !== raw.length) fail();
    return Promise.all(references.map(async (reference, index) => {
      const item = raw[index];
      if (!record(item)) fail();
      const checked = await resolveTimelineEvidence(reference, item.paragraph);
      if (item.bookId !== checked.bookId || item.bookTitle !== checked.bookTitle
        || !matchesCatalogChapterTitle(item.chapterTitle, checked.bookTitle, checked.chapterTitle)) fail();
      return checked;
    }));
  }
  const resolved = await Promise.all(checked.events.map(async (entry, index) => {
    const raw = rawEvents[index];
    if (!record(raw)) fail();
    const entries = await resolvedList(entry.evidence, raw.evidence);
    const { variants: referenceVariants, ...eventData } = entry;
    const variants = referenceVariants ? await Promise.all(referenceVariants.map(async (variant, variantIndex) => {
      const rawVariant = Array.isArray(raw.variants) ? raw.variants[variantIndex] : null;
      if (!record(rawVariant)) fail();
      return { ...variant, evidence: await resolvedList(variant.evidence, rawVariant.evidence) };
    })) : undefined;
    return { ...eventData, evidence: entries, ...(variants !== undefined ? { variants } : {}) };
  }));
  return { schemaVersion: 1, scope: 'current-archive', personId, events: resolved, unavailableCount: value.unavailableCount, resultSetRevision: value.resultSetRevision };
}
