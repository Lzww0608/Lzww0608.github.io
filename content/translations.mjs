import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const publicTranslationsRoot = new URL('./published-translations/', import.meta.url);
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
export function applyPublishedTranslations(library, snapshots) {
  const chapters = structuredClone(library.chapters);
  const paragraphs = new Map(chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, {paragraph, bookId:chapter.bookId}])));
  const seen = new Set();
  for (const snapshot of snapshots) {
    if (snapshot?.schemaVersion !== 1 || snapshot.status !== 'published' || !Array.isArray(snapshot.entries)
      || !library.catalog.books.some(book => book.id === snapshot.bookId)) throw new Error('Invalid published translation snapshot');
    for (const entry of snapshot.entries) {
      const match = paragraphs.get(entry.paragraphId), paragraph = match?.paragraph, t = entry.translation;
      if (!paragraph || match.bookId !== snapshot.bookId || seen.has(paragraph.id) || paragraph.revision !== entry.originalRevision || hash(paragraph.original) !== entry.originalSha256) throw new Error(`Published translation original differs: ${entry.paragraphId}`);
      if (!t || typeof t.id !== 'string' || typeof t.text !== 'string' || !t.text.trim() || t.language !== 'zh-Hans'
        || !Number.isSafeInteger(t.version) || t.version < 1 || typeof t.translator !== 'string'
        || !['ai', 'human'].includes(t.origin) || !['pending', 'owner-edited', 'reviewed'].includes(t.reviewStatus)
        || !Array.isArray(t.reviewNotes) || !t.reviewNotes.every(note => typeof note === 'string')
        || (t.origin === 'ai' && t.reviewStatus !== 'pending')) throw new Error(`Invalid published translation: ${entry.paragraphId}`);
      seen.add(paragraph.id); paragraph.translation = t;
    }
  }
  return chapters;
}

export function loadPublishedChapters(library, root = publicTranslationsRoot) {
  const snapshots = existsSync(root) ? readdirSync(root).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(readFileSync(new URL(name, root), 'utf8'))) : [];
  return applyPublishedTranslations(library, snapshots);
}
