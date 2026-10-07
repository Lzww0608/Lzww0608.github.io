import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';

export const textHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid translation batch: ${message}`); };
const nonempty = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const canonicalJson = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});

export function validateTranslationBatch(batch, library = loadLibrary()) {
  requireValue(batch?.schemaVersion === 1 && typeof batch.id === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(batch.id), 'identity');
  requireValue(batch.status === 'draft' && batch.language === 'zh-Hans', 'only private Simplified Chinese drafts are accepted');
  requireValue(nonempty(batch.translator, 200), 'translator');
  requireValue(batch.generation?.humanReviewed === false && nonempty(batch.generation.assistant, 200)
    && nonempty(batch.generation.method, 1000) && nonempty(batch.generation.standardVersion, 200)
    && typeof batch.generation.generatedAt === 'string' && Number.isFinite(Date.parse(batch.generation.generatedAt)), 'AI provenance');
  requireValue(Array.isArray(batch.standards) && batch.standards.length > 0 && batch.standards.every(value => nonempty(value, 2000)), 'translation standards');
  requireValue(library.catalog.books.some(book => book.id === batch.bookId), 'book');
  requireValue(Array.isArray(batch.chapterIds) && batch.chapterIds.length > 0
    && new Set(batch.chapterIds).size === batch.chapterIds.length, 'chapter list');
  const chapters = batch.chapterIds.map(id => {
    const chapter = library.chapters.find(item => item.id === id && item.bookId === batch.bookId);
    requireValue(chapter, `chapter ${id}`);
    return chapter;
  });
  const paragraphs = chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => ({ chapter, paragraph })));
  requireValue(Array.isArray(batch.entries) && batch.entries.length === paragraphs.length, 'every selected paragraph must be translated');
  const digest = textHash(canonicalJson(batch));
  const entries = batch.entries.map((entry, index) => {
    const { chapter, paragraph } = paragraphs[index];
    requireValue(entry?.paragraphId === paragraph.id, `paragraph order ${paragraph.id}`);
    requireValue(entry.originalRevision === paragraph.revision && entry.originalSha256 === textHash(paragraph.original), `original version ${paragraph.id}`);
    requireValue(nonempty(entry.text, 20000), `translation ${paragraph.id}`);
    requireValue(Array.isArray(entry.reviewNotes) && entry.reviewNotes.length <= 20
      && entry.reviewNotes.every(value => nonempty(value, 2000)), `review notes ${paragraph.id}`);
    return { ...entry, metadata: {
      origin: 'ai', batchId: batch.id, batchSha256: digest,
      generation: batch.generation, standards: batch.standards,
      humanReviewed: false, reviewNotes: entry.reviewNotes,
      source: { chapterId: chapter.id, originalSha256: entry.originalSha256, sourceUrl: chapter.sourceUrl },
    } };
  });
  return { ...batch, entries, digest };
}
