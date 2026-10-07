import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { publicTranslationsRoot, applyPublishedTranslations } from '../../content/translations.mjs';
import { createRepository } from '../src/repository.mjs';
import { textHash } from '../src/translation-batch.mjs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';

const bookId = process.argv[2];
const library = loadLibrary();
if (!library.catalog.books.some(book => book.id === bookId)) throw new Error('Provide a library book ID.');
const client = new pg.Client(adminDatabase(loadConfig()));
await client.connect();
try {
  const repository = createRepository(client), entries = [];
  for (const original of library.chapters.filter(chapter => chapter.bookId === bookId)) {
    const live = await repository.chapter(original.id);
    for (const paragraph of original.paragraphs) {
      const current = live?.paragraphs.find(item => item.id === paragraph.id);
      if (!current?.translation) continue;
      if (current.revision !== paragraph.revision || current.original !== paragraph.original) throw new Error(`Update the static original before exporting: ${paragraph.id}`);
      entries.push({ paragraphId: paragraph.id, originalRevision: paragraph.revision, originalSha256: textHash(paragraph.original), translation: current.translation });
    }
  }
  const snapshot = { schemaVersion: 1, bookId, status: 'published', exportedAt: new Date().toISOString(), entries };
  applyPublishedTranslations(library, [snapshot]);
  mkdirSync(publicTranslationsRoot, { recursive: true });
  writeFileSync(new URL(`${bookId}.json`, publicTranslationsRoot), JSON.stringify(snapshot, null, 2)+'\n');
  console.log(`Exported ${entries.length} published translations for ${bookId}; canonical originals unchanged.`);
} finally { await client.end(); }
