import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import { parseChapterParagraph } from './chapter-schema.ts';
import type { BookId, ChapterParagraph, LibraryCatalog, TextRange } from './types.ts';

export interface ComparisonSource {
  id: string;
  label: string;
  bookId: BookId;
  chapterId: string;
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
}
export interface ComparisonStage {
  id: string;
  title: string;
  summary?: string;
  sourceIds: string[];
}
export interface ComparisonEvidence { sourceId: string; excerpt: string }
export type ComparisonDifferenceKind = 'conflict' | 'detail' | 'perspective' | 'dating';
export interface ComparisonDifference {
  id: string;
  title: string;
  stageId: string | null;
  kind: ComparisonDifferenceKind;
  summary: string;
  evidence: ComparisonEvidence[];
}
export interface EventComparisonDocument {
  schemaVersion: 1;
  scope: 'current-archive';
  id: string;
  title: string;
  summary: string;
  dateLabel: string;
  personIds: string[];
  stages: ComparisonStage[];
  sources: ComparisonSource[];
  differences: ComparisonDifference[];
}

interface SourceCaption extends ComparisonSource { bookTitle: string; chapterTitle: string }
export type ComparisonSourceOrigin = 'api' | 'archive' | 'none';
export type ComparisonSourceUnavailableReason = 'api-unavailable' | 'invalid-chapter' | 'archive-unavailable' | 'stale-original' | 'missing-translation';
export interface AvailableComparisonSource extends SourceCaption {
  status: 'available';
  source: 'api' | 'archive';
  paragraph: ChapterParagraph;
}
export interface UnavailableComparisonSource extends SourceCaption {
  status: 'unavailable';
  source: ComparisonSourceOrigin;
  reason: ComparisonSourceUnavailableReason;
}
export type ResolvedComparisonSource = AvailableComparisonSource | UnavailableComparisonSource;
export interface ResolvedComparisonStage extends Omit<ComparisonStage, 'summary'> {
  status: 'available' | 'partial' | 'unavailable';
  summary?: string;
  availableSourceIds: string[];
  unavailableCount: number;
}
export interface ResolvedComparisonEvidence extends ComparisonEvidence { originalRanges: TextRange[] }
export interface AvailableComparisonDifference extends Omit<ComparisonDifference, 'evidence'> {
  status: 'available';
  evidence: ResolvedComparisonEvidence[];
}
export interface UnavailableComparisonDifference extends Omit<ComparisonDifference, 'summary'> {
  status: 'unavailable';
  unavailableSourceIds: string[];
  reason: 'source-unavailable' | 'stale-evidence';
}
export type ResolvedComparisonDifference = AvailableComparisonDifference | UnavailableComparisonDifference;
export interface EventComparisonResponse {
  document: EventComparisonDocument;
  sources: ResolvedComparisonSource[];
  stages: ResolvedComparisonStage[];
  differences: ResolvedComparisonDifference[];
  resultSetRevision: string;
}

// Read the canonical catalog directly: importing route-aware library helpers
// here would make data -> schema -> library -> comparison route -> data cycle.
const books = new Map((catalog as LibraryCatalog).books.map(book => [book.id, book]));
const chapters = new Map((catalog as LibraryCatalog).chapters.map(chapter => [chapter.id, chapter]));
const people = new Set(catalogPeople.map(person => person.id));
const kinds: readonly ComparisonDifferenceKind[] = ['conflict', 'detail', 'perspective', 'dating'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum = 3000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const id = (value: unknown): value is string => text(value, 150) && /^[a-z0-9-]+$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(): never { throw new Error('Invalid event comparison data'); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function source(value: unknown): ComparisonSource {
  if (!record(value) || !keys(value, ['id', 'label', 'bookId', 'chapterId', 'paragraphId', 'originalRevision', 'originalSha256'])
    || !id(value.id) || !text(value.label, 300) || !id(value.chapterId)
    || !id(value.paragraphId) || !new RegExp(`^${value.chapterId}-p[1-9][0-9]*$`).test(value.paragraphId)
    || !integer(value.originalRevision) || !hash(value.originalSha256)) fail();
  const chapter = chapters.get(value.chapterId);
  if (!chapter || value.bookId !== chapter.bookId) fail();
  return { id: value.id, label: value.label, bookId: chapter.bookId, chapterId: value.chapterId,
    paragraphId: value.paragraphId, originalRevision: value.originalRevision, originalSha256: value.originalSha256 };
}

export function parseEventComparisonDocument(value: unknown, expectedId?: string): EventComparisonDocument {
  if (!record(value) || !keys(value, ['schemaVersion', 'scope', 'id', 'title', 'summary', 'dateLabel', 'personIds', 'stages', 'sources', 'differences'])
    || value.schemaVersion !== 1 || value.scope !== 'current-archive' || !id(value.id)
    || (expectedId !== undefined && value.id !== expectedId) || !text(value.title, 200) || !text(value.summary, 5000)
    || !text(value.dateLabel, 600) || !Array.isArray(value.personIds) || !value.personIds.length
    || value.personIds.length > 100 || !value.personIds.every(personId => id(personId) && people.has(personId))
    || new Set(value.personIds).size !== value.personIds.length || !Array.isArray(value.sources)
    || value.sources.length < 2 || value.sources.length > 300) fail();
  const sources = value.sources.map(source), sourceIds = new Set(sources.map(item => item.id));
  if (sourceIds.size !== sources.length || new Set(sources.map(item => item.paragraphId)).size !== sources.length
    || new Set(sources.map(item => item.bookId)).size < 2 || !Array.isArray(value.stages)
    || !value.stages.length || value.stages.length > 40) fail();
  const stages = value.stages.map(item => {
    if (!record(item) || !keys(item, ['id', 'title', 'summary', 'sourceIds']) || !id(item.id) || !text(item.title, 200)
      || (item.summary !== undefined && !text(item.summary, 3000)) || !Array.isArray(item.sourceIds)
      || !item.sourceIds.length || !item.sourceIds.every(sourceId => typeof sourceId === 'string' && sourceIds.has(sourceId))
      || new Set(item.sourceIds).size !== item.sourceIds.length) fail();
    return { id: item.id, title: item.title, ...(item.summary !== undefined ? { summary: item.summary } : {}), sourceIds: [...item.sourceIds] as string[] };
  });
  const stageIds = new Set(stages.map(item => item.id));
  if (stageIds.size !== stages.length || new Set(stages.flatMap(item => item.sourceIds)).size !== sources.length
    || !Array.isArray(value.differences) || value.differences.length > 100) fail();
  const differences = value.differences.map(item => {
    if (!record(item) || !keys(item, ['id', 'title', 'stageId', 'kind', 'summary', 'evidence'])
      || !id(item.id) || !text(item.title, 300) || !text(item.summary, 5000)
      || (item.stageId !== null && (typeof item.stageId !== 'string' || !stageIds.has(item.stageId)))
      || !kinds.includes(item.kind as ComparisonDifferenceKind) || !Array.isArray(item.evidence)
      || !item.evidence.length || item.evidence.length > 100) fail();
    const evidence = item.evidence.map(entry => {
      if (!record(entry) || !keys(entry, ['sourceId', 'excerpt']) || typeof entry.sourceId !== 'string'
        || !sourceIds.has(entry.sourceId) || !text(entry.excerpt, 20000)) fail();
      return { sourceId: entry.sourceId, excerpt: entry.excerpt };
    });
    if (new Set(evidence.map(entry => `${entry.sourceId}/${entry.excerpt}`)).size !== evidence.length) fail();
    return { id: item.id, title: item.title, stageId: item.stageId, kind: item.kind as ComparisonDifferenceKind, summary: item.summary, evidence };
  });
  if (new Set(differences.map(item => item.id)).size !== differences.length) fail();
  return { schemaVersion: 1, scope: 'current-archive', id: value.id, title: value.title, summary: value.summary,
    dateLabel: value.dateLabel, personIds: [...value.personIds] as string[], stages, sources, differences };
}

export async function comparisonHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function comparisonSourceCaption(reference: ComparisonSource): SourceCaption {
  const chapter = chapters.get(reference.chapterId), book = books.get(reference.bookId);
  if (!chapter || !book || chapter.bookId !== reference.bookId) fail();
  return { ...reference, bookTitle: book.title, chapterTitle: chapter.title };
}

export async function resolveComparisonSource(reference: ComparisonSource, value: unknown, origin: 'api' | 'archive'): Promise<ResolvedComparisonSource> {
  const caption = comparisonSourceCaption(reference);
  let paragraph: ChapterParagraph;
  try { paragraph = parseChapterParagraph(value); }
  catch { return { ...caption, status: 'unavailable', source: origin, reason: 'stale-original' }; }
  if (paragraph.id !== reference.paragraphId || paragraph.revision !== reference.originalRevision
    || await comparisonHash(paragraph.original) !== reference.originalSha256) {
    return { ...caption, status: 'unavailable', source: origin, reason: 'stale-original' };
  }
  // The chapter API supplies only the latest published translation matching this
  // original revision. Keep that complete paragraph; never crop a translation
  // using offsets from the classical original.
  if (!paragraph.translation?.text.trim() || !paragraph.translation.id.trim() || paragraph.translation.language !== 'zh-Hans') {
    return { ...caption, status: 'unavailable', source: origin, reason: 'missing-translation' };
  }
  return { ...caption, status: 'available', source: origin, paragraph };
}

function excerptRanges(original: string, excerpt: string): TextRange[] {
  const ranges: TextRange[] = [];
  let start = 0;
  while (start < original.length) {
    const match = original.indexOf(excerpt, start);
    if (match < 0) break;
    const unicodeStart = Array.from(original.slice(0, match)).length;
    ranges.push({ start: unicodeStart, end: unicodeStart + Array.from(excerpt).length });
    start = match + excerpt.length;
  }
  return ranges;
}

export async function resolveEventComparison(document: EventComparisonDocument, sources: ResolvedComparisonSource[]): Promise<EventComparisonResponse> {
  const checked = parseEventComparisonDocument(document);
  const sourceMap = new Map(sources.map(item => [item.id, item]));
  if (sourceMap.size !== checked.sources.length || sources.length !== checked.sources.length
    || checked.sources.some(reference => {
      const item = sourceMap.get(reference.id);
      return !item || Object.entries(reference).some(([key, value]) => item[key as keyof ComparisonSource] !== value);
    })) fail();
  const stages = checked.stages.map(stage => {
    const availableSourceIds = stage.sourceIds.filter(sourceId => sourceMap.get(sourceId)?.status === 'available');
    const unavailableCount = stage.sourceIds.length - availableSourceIds.length;
    const { summary, ...data } = stage;
    return { ...data, status: unavailableCount === 0 ? 'available' as const : availableSourceIds.length ? 'partial' as const : 'unavailable' as const,
      ...(!unavailableCount && summary !== undefined ? { summary } : {}), availableSourceIds, unavailableCount };
  });
  const differences: ResolvedComparisonDifference[] = checked.differences.map(difference => {
    const unavailable = new Set<string>();
    let invalidExcerpt = false;
    const evidence = difference.evidence.map(entry => {
      const source = sourceMap.get(entry.sourceId)!;
      const originalRanges = source.status === 'available' ? excerptRanges(source.paragraph.original, entry.excerpt) : [];
      if (!originalRanges.length) {
        unavailable.add(entry.sourceId);
        if (source.status === 'available') invalidExcerpt = true;
      }
      return { ...entry, originalRanges };
    });
    if (unavailable.size) {
      const { summary: _summary, ...data } = difference;
      return { ...data, status: 'unavailable', unavailableSourceIds: [...unavailable], reason: invalidExcerpt ? 'stale-evidence' : 'source-unavailable' };
    }
    return { ...difference, status: 'available', evidence };
  });
  const page = { document: checked, sources, stages, differences };
  return { ...page, resultSetRevision: await comparisonHash(JSON.stringify(page)) };
}
