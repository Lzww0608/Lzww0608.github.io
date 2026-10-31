import catalog from '../../content/five-dynasties/catalog.json' with { type: 'json' };
import timelineSummary from './person-timeline-summary.json' with { type: 'json' };
import { catalogPeople } from './person-catalog.ts';
import { eventComparisons } from './event-comparison-data.ts';
import { validateSearchQuery } from '../../content/passage-search.mts';
import { resolveReadingRoute, resolvePersonSourcesRoute } from './library.ts';
import { resolveReadingContextRoute } from './reading-context-route.ts';
import { eraForChapter, eraForComparison, eraForPerson } from './eras.ts';
import type { ReadingPosition } from './reading-navigation-state.ts';
import type { BookId, EraId, LibraryCatalog, Route } from './types.ts';

export const READING_SHELF_APP = 'ancient-history-reading' as const;
export const READING_SHELF_LIMITS = { bytes: 2 * 1024 * 1024, progress: 300, bookmarks: 1000, details: 300, translations: 1000, cursors: 300 } as const;
export interface ParagraphReadingBinding { kind: 'paragraph'; chapterId: string; paragraphId: string; originalRevision: number; originalSha256: string }
export interface EventReadingBinding { kind: 'event'; personId: string; eventId: string; eventSha256: string }
export interface StageReadingBinding { kind: 'stage'; comparisonId: string; stageId: string; sourceBindings: (Omit<ParagraphReadingBinding, 'kind'> & { sourceId: string })[] }
export type ReadingBinding = ParagraphReadingBinding | EventReadingBinding | StageReadingBinding;
export type ReadingProgressBinding = ReadingBinding;
export interface ReadingShelfView {
  fontSize?: number;
  selectedBooks?: BookId[];
  expandedTranslations?: Record<string, boolean>;
  passages?: { cursor: string; cursors: string[]; index: number; source: 'api' | 'archive'; resultSetRevision: string };
}
export interface ReadingProgress { id: string; route: Route; personId?: string; updatedAt: string; position: ReadingPosition; view: ReadingShelfView; binding?: ReadingBinding }
export interface ParagraphBookmark { id: string; kind: 'paragraph'; chapterId: string; paragraphId: string; personId?: string; originalRevision: number; originalSha256: string; savedAt: string }
export interface EventBookmark { id: string; kind: 'event'; personId: string; eventId: string; eventSha256: string; label: string; savedAt: string }
export type ReadingBookmark = ParagraphBookmark | EventBookmark;
export interface ReadingShelfDocument { schemaVersion: 1; app: typeof READING_SHELF_APP; progress: ReadingProgress[]; bookmarks: ReadingBookmark[] }
export interface ReadingShelfSnapshot extends ReadingShelfDocument { notice: string | null }

const library = catalog as LibraryCatalog;
const chapters = new Map(library.chapters.map(chapter => [chapter.id, chapter]));
const people = new Set(catalogPeople.map(person => person.id));
const events = new Map(timelineSummary.people.map(person => [person.personId, person.eventIds as readonly string[]]));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 160 && /^[a-z0-9-]+$/.test(value);
const plainText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f<>]/u.test(value);
function fail(): never { throw new Error('阅读资料文件无效：请使用本站导出的文件，且保留已登记的阅读位置。'); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail(); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value && Date.parse(value) >= 0 && Date.parse(value) <= Date.now() + 7 * 24 * 60 * 60 * 1000; }
function person(value: unknown): value is string { return typeof value === 'string' && people.has(value); }
function cursor(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)); }
export function validShelfParagraph(chapterId: string, paragraphId: string): boolean {
  const chapter = chapters.get(chapterId);
  if (!chapter || !paragraphId.startsWith(`${chapterId}-p`)) return false;
  const number = paragraphId.slice(chapterId.length + 2);
  return /^[1-9][0-9]*$/.test(number) && integer(Number(number), 1, chapter.paragraphCount);
}
export function validShelfEvent(personId: string, eventId: string): boolean { return people.has(personId) && !!events.get(personId)?.includes(eventId); }

export interface ShelfRoute { route: Route; path: string; kind: 'reader' | 'passages' | 'timeline' | 'comparison'; personId?: string; chapterId?: string; comparisonId?: string; targetId?: string; query?: string; field?: 'original' | 'translation' | 'both' }
// Live routes may have a valid bounded return; persistence keeps only the public
// destination and search conditions. Import accepts the canonical result only.
export function parseReadingShelfRoute(value: unknown, live = false): ShelfRoute | null {
  if (typeof value !== 'string' || !value.length || value.length > 8192 || value.includes('#') || value.split('?').length > 2) return null;
  const [rawPath = '', query] = value.split('?', 2);
  let path = rawPath;
  const parameters = new URLSearchParams(query);
  if ([...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) return null;
  const canonical = new URLSearchParams();
  const finish = (metadata: Omit<ShelfRoute, 'route' | 'path'>): ShelfRoute | null => {
    const route = `${path}${canonical.size ? `?${canonical}` : ''}` as Route;
    return !live && route !== value ? null : { route, path, ...metadata };
  };
  const reading = /^read-([a-z]+)(?:\/([a-z0-9-]+))?$/.exec(path);
  if (reading) {
    const resolved = resolveReadingRoute(value);
    const chapter = chapters.get(reading[2] ?? resolved?.chapter.id ?? '');
    if (!resolved || !chapter || chapter.bookId !== reading[1] || [...parameters.keys()].some(key => !['q', 'field', 'paragraph', ...(live ? ['return'] : [])].includes(key))) return null;
    if (parameters.has('return') && (!live || !resolved.returnTo || !parseReadingShelfRoute(parameters.get('return'), true))) return null;
    if (parameters.has('field') && !['original', 'translation', 'both'].includes(parameters.get('field')!)) return null;
    if (parameters.has('paragraph') && !validShelfParagraph(chapter.id, parameters.get('paragraph')!)) return null;
    path = `read-${chapter.bookId}/${chapter.id}`;
    let search: string;
    try { search = validateSearchQuery(parameters.get('q') ?? ''); } catch { return null; }
    if (search) { canonical.set('q', search); canonical.set('field', resolved.search.field); }
    if (parameters.has('paragraph')) canonical.set('paragraph', parameters.get('paragraph')!);
    return finish({ kind: 'reader', chapterId: chapter.id, ...(parameters.has('paragraph') ? { targetId: parameters.get('paragraph')! } : {}), ...(search ? { query: search, field: resolved.search.field } : {}) });
  }
  const passages = /^person-sources\/([a-z0-9-]+)(?:\/([a-z]+))?$/.exec(path);
  if (passages) {
    const resolved = resolvePersonSourcesRoute(value);
    if (!resolved || [...parameters.keys()].some(key => !['q', 'field'].includes(key)) || parameters.has('field') && !['original', 'translation', 'both'].includes(parameters.get('field')!)) return null;
    if (resolved.search.query) { canonical.set('q', resolved.search.query); canonical.set('field', resolved.search.field); }
    return finish({ kind: 'passages', personId: resolved.person.id, ...(resolved.search.query ? { query: resolved.search.query, field: resolved.search.field } : {}) });
  }
  const resolved = resolveReadingContextRoute(value, live);
  if (!resolved) return null;
  if (resolved.targetId) canonical.set(resolved.kind === 'timeline' ? 'event' : 'stage', resolved.targetId);
  return finish({ kind: resolved.kind, ...(resolved.kind === 'timeline' ? { personId: resolved.id } : { comparisonId: resolved.id }), ...(resolved.targetId ? { targetId: resolved.targetId } : {}) });
}
export function normalizeReadingShelfRoute(route: string): Route | undefined { return parseReadingShelfRoute(route, true)?.route; }
export function inferReadingPerson(route: string, context?: string): string | undefined {
  const resolved = parseReadingShelfRoute(route, true);
  if (!resolved) return;
  if (resolved.personId) return resolved.personId;
  if (!context || !people.has(context)) return;
  const contextPerson = catalogPeople.find(person => person.id === context)!;
  if (resolved.kind === 'reader') {
    const chapter = chapters.get(resolved.chapterId!)!;
    // Later historical works may preserve an earlier person's evidence. A
    // checked chapter association keeps that legitimate reading context, while
    // an unrelated person remembered from the previous era is not inherited.
    if (eraForPerson(contextPerson) !== eraForChapter(chapter) && !chapter.subjects.includes(context)) return;
  }
  if (resolved.kind === 'comparison' && !eventComparisons.find(document => document.id === resolved.comparisonId)?.personIds.includes(context)) return;
  return context;
}
export function readingShelfEra(item: ReadingProgress | ReadingBookmark): EraId | undefined {
  if ('route' in item) {
    const route = parseReadingShelfRoute(item.route, true);
    if (!route) return;
    const context = inferReadingPerson(item.route, item.personId);
    if (context) return eraForPerson(catalogPeople.find(person => person.id === context)!);
    if (route.personId) {
      const person = catalogPeople.find(person => person.id === route.personId);
      return person ? eraForPerson(person) : undefined;
    }
    if (route.chapterId) return eraForChapter(chapters.get(route.chapterId)!);
    if (route.comparisonId) {
      const document = eventComparisons.find(document => document.id === route.comparisonId);
      return document ? eraForComparison(document) : undefined;
    }
    return;
  }
  if (item.kind === 'paragraph') {
    const chapter = chapters.get(item.chapterId);
    const context = chapter && inferReadingPerson(`read-${chapter.bookId}/${chapter.id}`, item.personId);
    if (context) return eraForPerson(catalogPeople.find(person => person.id === context)!);
    return chapter ? eraForChapter(chapter) : undefined;
  }
  const person = catalogPeople.find(person => person.id === item.personId);
  return person ? eraForPerson(person) : undefined;
}
export function readingProgressId(route: string, personId?: string): string {
  const resolved = parseReadingShelfRoute(route, true);
  if (!resolved) fail();
  const search = resolved.query ? `?${new URLSearchParams({ q: resolved.query, field: resolved.field! })}` : '';
  return `progress:${personId ?? ''}:${resolved.path}${search}`;
}
export function paragraphBookmarkId(chapterId: string, paragraphId: string, personId?: string) { return `paragraph:${personId ?? ''}:${chapterId}:${paragraphId}`; }
export function eventBookmarkId(personId: string, eventId: string) { return `event:${personId}:${eventId}`; }

function knownAnchor(route: ShelfRoute, value: string): boolean {
  if (route.kind === 'reader') return validShelfParagraph(route.chapterId!, value);
  if (route.kind === 'passages') {
    const paragraphId = value.replace(/^person-passage-/, '');
    return value.startsWith('person-passage-') && library.chapters.some(chapter => validShelfParagraph(chapter.id, paragraphId))
      && (!route.path.split('/')[2] || chapters.get(paragraphId.replace(/-p[0-9]+$/, ''))?.bookId === route.path.split('/')[2]);
  }
  if (route.kind === 'timeline') return value.startsWith('timeline-event-') && validShelfEvent(route.personId!, value.slice('timeline-event-'.length));
  const comparison = eventComparisons.find(document => document.id === route.comparisonId)!;
  return comparison.stages.some(stage => value === `comparison-stage-${stage.id}` || stage.sourceIds.some(source => value === `comparison-paragraph-${comparison.id}-${stage.id}-${source}`));
}
function knownDetails(route: ShelfRoute, value: string): boolean {
  if (route.kind === 'passages' && value.endsWith('/provenance')) return knownAnchor(route, value.slice(0, -'/provenance'.length));
  const generic = /^(.*)\/details\/([0-9]+)$/.exec(value);
  if (generic && Number(generic[2]) < 20) return ['', 'root'].includes(generic[1]!) || knownAnchor(route, generic[1]!);
  if (route.kind === 'comparison') return eventComparisons.find(document => document.id === route.comparisonId)!.differences.some(difference => value === `difference/${difference.id}`);
  if (route.kind === 'timeline') {
    const eventId = value.split('/')[0]!;
    if (!validShelfEvent(route.personId!, eventId)) return false;
    return value === `${eventId}/variants` || new RegExp(`^${eventId}/(?:main|evidence|variant-[0-9]{1,2})/([a-z0-9-]+-p[1-9][0-9]*)$`).test(value)
      && library.chapters.some(chapter => validShelfParagraph(chapter.id, value.split('/').at(-1)!));
  }
  return false;
}
function boolRecord(value: unknown, maximum: number, check: (key: string) => boolean): Record<string, boolean> {
  if (!object(value) || Object.keys(value).length > maximum || Object.entries(value).some(([key, state]) => typeof state !== 'boolean' || !check(key))) fail();
  return Object.fromEntries(Object.entries(value)) as Record<string, boolean>;
}
function parsePosition(value: unknown, route: ShelfRoute): ReadingPosition {
  if (!object(value)) fail();
  keys(value, ['scrollY', 'anchorId', 'offset', 'details']);
  if (typeof value.scrollY !== 'number' || !Number.isFinite(value.scrollY) || value.scrollY < 0 || value.scrollY > 10000000
    || value.anchorId !== undefined && (typeof value.anchorId !== 'string' || !knownAnchor(route, value.anchorId))
    || value.offset !== undefined && (typeof value.offset !== 'number' || !Number.isFinite(value.offset) || Math.abs(value.offset) > 1000000 || value.anchorId === undefined)) fail();
  return { scrollY: value.scrollY, ...(value.anchorId !== undefined ? { anchorId: value.anchorId as string } : {}), ...(value.offset !== undefined ? { offset: value.offset as number } : {}), details: boolRecord(value.details, READING_SHELF_LIMITS.details, key => knownDetails(route, key)) };
}
function parseView(value: unknown, route: ShelfRoute): ReadingShelfView {
  if (!object(value)) fail();
  keys(value, ['fontSize', 'selectedBooks', 'expandedTranslations', 'passages']);
  const result: ReadingShelfView = {};
  if (value.fontSize !== undefined) { if (!integer(value.fontSize, 18, 30)) fail(); result.fontSize = value.fontSize; }
  if (value.selectedBooks !== undefined) {
    const comparison = eventComparisons.find(document => document.id === route.comparisonId);
    if (!comparison || !Array.isArray(value.selectedBooks) || value.selectedBooks.length < 1 || value.selectedBooks.length > 3 || new Set(value.selectedBooks).size !== value.selectedBooks.length || !value.selectedBooks.every(book => comparison.sources.some(source => source.bookId === book))) fail();
    result.selectedBooks = value.selectedBooks as BookId[];
  }
  if (value.expandedTranslations !== undefined) result.expandedTranslations = boolRecord(value.expandedTranslations, READING_SHELF_LIMITS.translations, key => {
    if (route.kind === 'reader') return validShelfParagraph(route.chapterId!, key);
    if (route.kind === 'passages') return library.chapters.some(chapter => validShelfParagraph(chapter.id, key));
    if (route.kind === 'comparison') return eventComparisons.find(document => document.id === route.comparisonId)!.stages.some(stage => stage.sourceIds.some(source => key === `${stage.id}/${source}`));
    return false;
  });
  if (value.passages !== undefined) {
    if (route.kind !== 'passages' || !object(value.passages)) fail();
    const page = value.passages;
    keys(page, ['cursor', 'cursors', 'index', 'source', 'resultSetRevision']);
    if (!cursor(page.cursor) || !Array.isArray(page.cursors) || !page.cursors.length || page.cursors.length > READING_SHELF_LIMITS.cursors || !page.cursors.every(cursor)
      || page.cursors[0] !== '0' || new Set(page.cursors).size !== page.cursors.length || !integer(page.index, 0, page.cursors.length - 1) || page.cursors[page.index] !== page.cursor
      || !['api', 'archive'].includes(page.source as string) || !hash(page.resultSetRevision)) fail();
    result.passages = { cursor: page.cursor, cursors: page.cursors as string[], index: page.index, source: page.source as 'api' | 'archive', resultSetRevision: page.resultSetRevision };
  }
  return result;
}
function paragraphBinding(value: Record<string, unknown>): Omit<ParagraphReadingBinding, 'kind'> {
  if (!id(value.chapterId) || !id(value.paragraphId) || !validShelfParagraph(value.chapterId, value.paragraphId) || !integer(value.originalRevision, 1) || !hash(value.originalSha256)) fail();
  return { chapterId: value.chapterId, paragraphId: value.paragraphId, originalRevision: value.originalRevision, originalSha256: value.originalSha256 };
}
function parseBinding(value: unknown, route: ShelfRoute, position: ReadingPosition): ReadingBinding {
  if (!object(value)) fail();
  if (value.kind === 'paragraph') {
    keys(value, ['kind', 'chapterId', 'paragraphId', 'originalRevision', 'originalSha256']);
    const binding = { kind: 'paragraph' as const, ...paragraphBinding(value) };
    if (route.kind === 'timeline' || route.kind === 'reader' && route.chapterId !== binding.chapterId) fail();
    if (position.anchorId && route.kind === 'reader' && position.anchorId !== binding.paragraphId || position.anchorId && route.kind === 'passages' && position.anchorId !== `person-passage-${binding.paragraphId}`) fail();
    if (route.kind === 'comparison') {
      const comparison = eventComparisons.find(document => document.id === route.comparisonId)!;
      const source = comparison.sources.find(source => source.chapterId === binding.chapterId && source.paragraphId === binding.paragraphId && source.originalRevision === binding.originalRevision && source.originalSha256 === binding.originalSha256);
      if (!source || position.anchorId && !comparison.stages.some(stage => stage.sourceIds.includes(source.id) && position.anchorId === `comparison-paragraph-${comparison.id}-${stage.id}-${source.id}`)) fail();
    }
    return binding;
  }
  if (value.kind === 'event') {
    keys(value, ['kind', 'personId', 'eventId', 'eventSha256']);
    if (route.kind !== 'timeline' || !person(value.personId) || value.personId !== route.personId || !id(value.eventId) || !validShelfEvent(value.personId, value.eventId) || !hash(value.eventSha256) || position.anchorId && position.anchorId !== `timeline-event-${value.eventId}`) fail();
    return { kind: 'event', personId: value.personId, eventId: value.eventId, eventSha256: value.eventSha256 };
  }
  if (value.kind === 'stage') {
    keys(value, ['kind', 'comparisonId', 'stageId', 'sourceBindings']);
    const comparison = eventComparisons.find(document => document.id === route.comparisonId);
    const stage = comparison?.stages.find(stage => stage.id === value.stageId);
    if (route.kind !== 'comparison' || !comparison || value.comparisonId !== comparison.id || !stage || position.anchorId && position.anchorId !== `comparison-stage-${stage.id}` || !Array.isArray(value.sourceBindings) || !value.sourceBindings.length || value.sourceBindings.length > stage.sourceIds.length) fail();
    const sourceBindings = value.sourceBindings.map(item => {
      if (!object(item)) fail();
      keys(item, ['sourceId', 'chapterId', 'paragraphId', 'originalRevision', 'originalSha256']);
      const source = comparison.sources.find(source => source.id === item.sourceId);
      const binding = paragraphBinding(item);
      if (!source || !stage.sourceIds.includes(source.id) || source.chapterId !== binding.chapterId || source.paragraphId !== binding.paragraphId || source.originalRevision !== binding.originalRevision || source.originalSha256 !== binding.originalSha256) fail();
      return { sourceId: source.id, ...binding };
    });
    if (new Set(sourceBindings.map(source => source.sourceId)).size !== sourceBindings.length) fail();
    return { kind: 'stage', comparisonId: comparison.id, stageId: stage.id, sourceBindings };
  }
  return fail();
}
export function parseReadingProgress(value: unknown): ReadingProgress {
  if (!object(value)) fail();
  keys(value, ['id', 'route', 'personId', 'updatedAt', 'position', 'view', 'binding']);
  const route = parseReadingShelfRoute(value.route);
  if (!route || !timestamp(value.updatedAt) || value.personId !== undefined && !person(value.personId)) fail();
  const personId = inferReadingPerson(route.route, value.personId as string | undefined);
  if (personId !== value.personId || value.id !== readingProgressId(route.route, personId)) fail();
  const position = parsePosition(value.position, route);
  const binding = value.binding === undefined ? undefined : parseBinding(value.binding, route, position);
  if (position.anchorId && !binding) fail();
  return { id: value.id as string, route: route.route, ...(personId ? { personId } : {}), updatedAt: value.updatedAt, position, view: parseView(value.view, route), ...(binding ? { binding } : {}) };
}
export function parseReadingBookmark(value: unknown): ReadingBookmark {
  if (!object(value) || !timestamp(value.savedAt)) fail();
  if (value.kind === 'paragraph') {
    keys(value, ['id', 'kind', 'chapterId', 'paragraphId', 'personId', 'originalRevision', 'originalSha256', 'savedAt']);
    const binding = paragraphBinding(value);
    const chapter = chapters.get(binding.chapterId)!;
    const personId = inferReadingPerson(`read-${chapter.bookId}/${chapter.id}`, value.personId as string | undefined);
    if (value.personId !== undefined && !person(value.personId) || personId !== value.personId
      || value.id !== paragraphBookmarkId(binding.chapterId, binding.paragraphId, personId)) fail();
    return { id: value.id as string, kind: 'paragraph', ...binding, ...(value.personId ? { personId: value.personId as string } : {}), savedAt: value.savedAt };
  }
  if (value.kind === 'event') {
    keys(value, ['id', 'kind', 'personId', 'eventId', 'eventSha256', 'label', 'savedAt']);
    if (!person(value.personId) || !id(value.eventId) || !validShelfEvent(value.personId, value.eventId) || !hash(value.eventSha256) || !plainText(value.label, 200) || value.id !== eventBookmarkId(value.personId, value.eventId)) fail();
    return { id: value.id as string, kind: 'event', personId: value.personId, eventId: value.eventId, eventSha256: value.eventSha256, label: value.label, savedAt: value.savedAt };
  }
  return fail();
}
export function parseReadingShelfDocument(value: unknown): ReadingShelfDocument {
  if (!object(value)) fail();
  keys(value, ['schemaVersion', 'app', 'progress', 'bookmarks']);
  if (value.schemaVersion !== 1 || value.app !== READING_SHELF_APP || !Array.isArray(value.progress) || value.progress.length > READING_SHELF_LIMITS.progress || !Array.isArray(value.bookmarks) || value.bookmarks.length > READING_SHELF_LIMITS.bookmarks) fail();
  const progress = value.progress.map(parseReadingProgress), bookmarks = value.bookmarks.map(parseReadingBookmark);
  if (new Set(progress.map(item => item.id)).size !== progress.length || new Set(bookmarks.map(item => item.id)).size !== bookmarks.length) fail();
  return { schemaVersion: 1, app: READING_SHELF_APP, progress, bookmarks };
}
export function parseReadingShelfJson(value: string): ReadingShelfDocument {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > READING_SHELF_LIMITS.bytes) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return fail(); }
  // JSON.parse silently accepts repeated object keys, including escaped aliases.
  // Reject these before admitting a metadata document into persistent storage.
  const stack: { object: boolean; expectingKey: boolean; keys: Set<string> }[] = [];
  const tokens = value.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  for (const token of tokens) {
    if (token === '{' || token === '[') { stack.push({ object: token === '{', expectingKey: token === '{', keys: new Set() }); continue; }
    if (token === '}' || token === ']') { stack.pop(); continue; }
    const current = stack.at(-1);
    if (token === ',') { if (current?.object) current.expectingKey = true; continue; }
    if (token.startsWith('"') && current?.object && current.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) fail();
      current.keys.add(key); current.expectingKey = false;
    }
  }
  return parseReadingShelfDocument(parsed);
}
