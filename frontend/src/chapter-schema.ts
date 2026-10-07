import type { BookId, ChapterParagraph, ChapterResponse, PublishedTranslation } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTranslation(value: unknown): value is PublishedTranslation {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.text === 'string'
    && typeof value.language === 'string'
    && typeof value.translator === 'string'
    && (value.origin === undefined || value.origin === 'ai' || value.origin === 'human')
    && (value.reviewStatus === undefined || typeof value.reviewStatus === 'string' && ['pending', 'owner-edited', 'reviewed'].includes(value.reviewStatus))
    && (value.reviewNotes === undefined || Array.isArray(value.reviewNotes) && value.reviewNotes.every(note => typeof note === 'string'))
    && isPositiveInteger(value.version);
}

function isParagraph(value: unknown): value is ChapterParagraph {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.original === 'string' && value.original.trim().length > 0
    && isPositiveInteger(value.position)
    && isPositiveInteger(value.revision)
    && (value.translation === null || isTranslation(value.translation));
}

function isChapter(value: unknown, bookId: BookId, chapterId?: string): value is ChapterResponse {
  return isRecord(value)
    && value.bookId === bookId
    && typeof value.id === 'string'
    && (chapterId === undefined || value.id === chapterId)
    && typeof value.title === 'string'
    && isPositiveInteger(value.position)
    && (value.scope === 'full' || value.scope === 'excerpt')
    && typeof value.sourceUrl === 'string'
    && typeof value.bookTitle === 'string'
    && typeof value.author === 'string'
    && typeof value.editionId === 'string'
    && typeof value.edition === 'string'
    && Array.isArray(value.notes)
    && value.notes.every((note: unknown) => typeof note === 'string')
    && Array.isArray(value.paragraphs)
    && value.paragraphs.length > 0
    && value.paragraphs.every(isParagraph);
}

export function parseChapter(value: unknown, bookId: BookId, chapterId?: string): ChapterResponse {
  if (!isChapter(value, bookId, chapterId)) throw new Error('Invalid chapter');
  return value;
}
