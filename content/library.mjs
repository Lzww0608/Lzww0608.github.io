import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const libraryRoot = new URL('./five-dynasties/', import.meta.url);
const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid library: ${message}`); };
const hash = data => createHash('sha256').update(data).digest('hex');

// Validate the entire public snapshot before copying it or starting a DB transaction.
export function loadLibrary() {
  const catalog = JSON.parse(readFileSync(new URL('catalog.json', libraryRoot), 'utf8'));
  requireValue(catalog.schemaVersion === 1 && Array.isArray(catalog.books) && Array.isArray(catalog.chapters), 'catalog');
  const bookIds = new Set();
  const editionPositions = new Set();
  const chapterIds = new Set();
  for (const book of catalog.books) {
    requireValue(typeof book.id === 'string' && !bookIds.has(book.id), 'duplicate book');
    requireValue(['title', 'author', 'description', 'url', 'defaultChapter'].every(key => typeof book[key] === 'string' && book[key]), `book ${book.id}`);
    bookIds.add(book.id);
  }
  const chapters = catalog.chapters.map(summary => {
    requireValue(/^[a-z]+-v\d+$/.test(summary.id) && !chapterIds.has(summary.id), 'chapter ID');
    requireValue(bookIds.has(summary.bookId) && Number.isSafeInteger(summary.position) && summary.position > 0, `chapter ${summary.id}`);
    const position = `${summary.bookId}/${summary.position}`;
    requireValue(!editionPositions.has(position), `duplicate position ${position}`);
    editionPositions.add(position); chapterIds.add(summary.id);
    const contents = readFileSync(new URL(`chapters/${summary.id}.json`, libraryRoot));
    const source = readFileSync(new URL(`sources/${summary.id}.json`, libraryRoot));
    requireValue(hash(contents) === summary.provenance.chapterSha256 && hash(source) === summary.provenance.sourceSha256, `checksum ${summary.id}`);
    const capture = JSON.parse(source);
    requireValue(capture.response.parse.revid === summary.provenance.revisionId, `source revision ${summary.id}`);
    const chapter = JSON.parse(contents);
    requireValue(chapter.id === summary.id && chapter.bookId === summary.bookId && chapter.position === summary.position && chapter.scope === 'full', `metadata ${summary.id}`);
    requireValue(chapter.sourceUrl === summary.provenance.sourceUrl && Array.isArray(chapter.notes) && chapter.notes.every(note => typeof note === 'string'), `provenance ${summary.id}`);
    requireValue(chapter.paragraphs.length === summary.paragraphCount && chapter.paragraphs.length > 0, `paragraph count ${summary.id}`);
    chapter.paragraphs.forEach((paragraph, index) => {
      requireValue(paragraph.id === `${chapter.id}-p${index + 1}` && paragraph.position === index + 1 && paragraph.revision === 1, `paragraph order ${summary.id}`);
      requireValue(typeof paragraph.original === 'string' && paragraph.original.trim() && paragraph.translation === null, `original ${paragraph.id}`);
    });
    // Count Unicode characters rather than UTF-16 code units, including rare CJK glyphs.
    const characters = chapter.paragraphs.reduce((sum, paragraph) => sum + [...paragraph.original].length, 0);
    requireValue(characters === summary.characterCount, `character count ${summary.id}`);
    return chapter;
  });
  for (const book of catalog.books) requireValue(chapters.some(chapter => chapter.id === book.defaultChapter && chapter.bookId === book.id), `default chapter ${book.id}`);
  return { catalog, chapters };
}
