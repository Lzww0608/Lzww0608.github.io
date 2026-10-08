import { libraryBooks, libraryChapters } from './library.ts';
import { catalogPeople } from './person-catalog.ts';
import { parseChapterParagraph } from './chapter-schema.ts';
import type { BookId, PassageSpan, PersonPassage, PersonPassageIndex, PersonPassageKind, PersonPassagesResponse } from './types';

const chapters = new Map(libraryChapters.map(chapter => [chapter.id, chapter]));
const books = new Map(libraryBooks.map(book => [book.id, book]));
const people = new Map(catalogPeople.map(person => [person.id, person]));
const kinds: readonly PersonPassageKind[] = ['biography', 'record', 'mention'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function fail(): never { throw new Error('Invalid person passage data'); }

export async function originalHash(original: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(original));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function coverage(value: unknown): PersonPassagesResponse['coverage'] {
  if (!record(value) || !integer(value.bookCount,1) || !integer(value.chapterCount,1) || !integer(value.paragraphCount,1)) fail();
  return {bookCount:value.bookCount,chapterCount:value.chapterCount,paragraphCount:value.paragraphCount};
}

function span(value: unknown, chapterId: string): PassageSpan {
  if (!record(value) || !text(value.paragraphId) || !value.paragraphId.startsWith(`${chapterId}-p`)
    || !integer(value.originalRevision,1) || typeof value.originalSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.originalSha256)
    || !integer(value.start) || !integer(value.end,1) || value.end <= value.start) fail();
  return {paragraphId:value.paragraphId,originalRevision:value.originalRevision,originalSha256:value.originalSha256,start:value.start,end:value.end};
}

export function parsePersonPassageIndex(value: unknown): PersonPassageIndex {
  if (!record(value) || value.schemaVersion !== 1 || value.scope !== 'current-archive' || !Array.isArray(value.people) || !Array.isArray(value.passages)) fail();
  const known = new Set<string>();
  for (const item of value.people) {
    if (!record(item) || !text(item.id) || !text(item.name) || people.get(item.id)?.name !== item.name || known.has(item.id)) fail();
    known.add(item.id);
  }
  const ids = new Set<string>();
  const allParagraphIds = new Set<string>();
  for (const item of value.passages) {
    if (!record(item) || !text(item.id) || !/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id) || !text(item.chapterId) || !chapters.has(item.chapterId)
      || !text(item.title) || !Array.isArray(item.spans) || !item.spans.length || !Array.isArray(item.people) || !item.people.length) fail();
    ids.add(item.id);
    const paragraphIds = new Set<string>();
    for (const raw of item.spans) {
      const checked=span(raw,item.chapterId);
      if (paragraphIds.has(checked.paragraphId) || allParagraphIds.has(checked.paragraphId)) fail();
      paragraphIds.add(checked.paragraphId);
      allParagraphIds.add(checked.paragraphId);
    }
    const personIds = new Set<string>();
    for (const association of item.people) {
      if (!record(association) || !text(association.personId) || !known.has(association.personId) || personIds.has(association.personId)
        || !kinds.includes(association.kind as PersonPassageKind)) fail();
      personIds.add(association.personId);
    }
  }
  coverage(value.coverage);
  return value as unknown as PersonPassageIndex;
}

async function passage(value: unknown, requestedBook?: BookId): Promise<PersonPassage> {
  if (!record(value) || !text(value.id) || !text(value.title) || !kinds.includes(value.kind as PersonPassageKind)
    || !text(value.bookId) || !books.has(value.bookId as BookId) || (requestedBook && value.bookId !== requestedBook)
    || !text(value.chapterId) || chapters.get(value.chapterId)?.bookId !== value.bookId
    || value.chapterTitle !== chapters.get(value.chapterId)?.title || value.chapterPosition !== chapters.get(value.chapterId)?.position
    || value.bookTitle !== books.get(value.bookId as BookId)?.title || !text(value.edition)
    || value.sourceUrl !== chapters.get(value.chapterId)?.provenance.sourceUrl
    || !Array.isArray(value.spans) || !value.spans.length || !Array.isArray(value.paragraphs) || value.paragraphs.length !== value.spans.length) fail();
  const ids = new Set<string>();
  for (let index=0;index<value.spans.length;index++) {
    const location=span(value.spans[index],value.chapterId);
    const paragraph=parseChapterParagraph(value.paragraphs[index]);
    // Published translations are bound to whole paragraphs. Partial source/translation alignment is not available yet.
    if (paragraph.id !== location.paragraphId || paragraph.revision !== location.originalRevision || ids.has(paragraph.id)
      || location.start !== 0 || location.end !== Array.from(paragraph.original).length
      || location.originalSha256 !== await originalHash(paragraph.original)) fail();
    ids.add(paragraph.id);
  }
  return value as unknown as PersonPassage;
}

export async function parsePersonPassagesPage(value: unknown, personId: string, bookId?: BookId, cursor = '0', limit = 50): Promise<PersonPassagesResponse> {
  if (!record(value) || value.schemaVersion !== 1 || value.scope !== 'current-archive' || value.personId !== personId || !people.has(personId)
    || value.bookId !== (bookId ?? null) || !integer(value.total) || !integer(value.unavailableCount)
    || typeof value.resultSetRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.resultSetRevision)
    || !Array.isArray(value.items) || !/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))
    || value.items.length !== Math.min(limit,Math.max(0,value.total-Number(cursor)))
    || (value.nextCursor === null && Number(cursor)+value.items.length < value.total)
    || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^\d+$/.test(value.nextCursor)
      || !Number.isSafeInteger(Number(value.nextCursor)) || Number(value.nextCursor) !== Number(cursor)+value.items.length
      || Number(value.nextCursor) >= value.total || value.items.length === 0))
    || value.items.length > Math.max(0,value.total-Number(cursor))) fail();
  const items=await Promise.all(value.items.map(item=>passage(item,bookId)));
  const paragraphIds=items.flatMap(item=>item.paragraphs.map(paragraph=>paragraph.id));
  if (new Set(items.map(item=>item.id)).size !== items.length || new Set(paragraphIds).size!==paragraphIds.length) fail();
  return {schemaVersion:1,scope:'current-archive',personId,bookId:bookId??null,coverage:coverage(value.coverage),total:value.total,unavailableCount:value.unavailableCount,resultSetRevision:value.resultSetRevision,nextCursor:value.nextCursor as string|null,items};
}
