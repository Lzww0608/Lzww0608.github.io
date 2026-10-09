import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from './library.mjs';
import { loadPublishedChapters } from './translations.mjs';
import { splitPeriodSpans } from '../frontend/src/sentence-alignment.ts';

export const sentenceTranslationsRoot = new URL('./published-sentence-translations/', import.meta.url);
export const sentenceTextHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const requireValue = (ok, message) => { if (!ok) throw new Error(`Invalid published sentence translation: ${message}`); };

export function validatePublishedSentenceTranslations(document, chapters = loadPublishedChapters(loadLibrary())) {
  requireValue(document?.schemaVersion === 1 && document.status === 'published' && Array.isArray(document.entries), 'document');
  const chapter = chapters.find(c => c.id === document.chapterId);
  requireValue(chapter, 'chapter');
  const seen = new Set(), spans = new Set();
  for (const entry of document.entries) {
    const paragraph = chapter.paragraphs.find(p => p.id === entry.paragraphId);
    const original = paragraph && splitPeriodSpans(paragraph.original).find(s => s.start === entry.originalStart && s.end === entry.originalEnd);
    const key = `${entry.paragraphId}/${entry.originalStart}/${entry.originalEnd}`;
    requireValue(typeof entry.id === 'string' && /^sentence-[a-z0-9-]+$/.test(entry.id) && !seen.has(entry.id) && !spans.has(key), 'identity');
    requireValue(paragraph?.translation && original && entry.originalRevision === paragraph.revision
      && entry.originalSha256 === sentenceTextHash(paragraph.original), 'original binding');
    requireValue(entry.parentTranslationId === paragraph.translation.id && entry.parentTranslationVersion === paragraph.translation.version
      && entry.parentTranslationSha256 === sentenceTextHash(paragraph.translation.text), 'full translation binding');
    requireValue(Number.isSafeInteger(entry.version) && entry.version > 0 && typeof entry.text === 'string'
      && entry.text.trim() && [...entry.text].length <= 20000, 'translation');
    requireValue(entry.textSha256 === sentenceTextHash(entry.text), 'sentence text checksum');
    requireValue(['ai', 'human'].includes(entry.origin) && typeof entry.humanReviewed === 'boolean' && (entry.origin !== 'ai' || entry.humanReviewed === false), 'accurate provenance');
    requireValue(Array.isArray(entry.reviewNotes ?? []) && (entry.reviewNotes ?? []).length <= 20
      && (entry.reviewNotes ?? []).every(note => typeof note === 'string' && note.trim() && [...note].length <= 2000), 'review notes');
    seen.add(entry.id); spans.add(key);
  }
  return document;
}

export function loadPublishedSentenceTranslations(chapters = loadPublishedChapters(loadLibrary())) {
  if (!existsSync(sentenceTranslationsRoot)) return [];
  return readdirSync(sentenceTranslationsRoot).filter(f => f.endsWith('.json')).sort().map(file =>
    validatePublishedSentenceTranslations(JSON.parse(readFileSync(new URL(file, sentenceTranslationsRoot), 'utf8')), chapters));
}
