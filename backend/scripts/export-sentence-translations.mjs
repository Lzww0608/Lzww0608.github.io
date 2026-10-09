import pg from 'pg';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { createSentenceTranslationsRepository } from '../src/sentence-translations.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { sentenceTranslationsRoot, validatePublishedSentenceTranslations } from '../../content/sentence-translations.mjs';

const client = new pg.Client(adminDatabase(loadConfig()));
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const repository = createSentenceTranslationsRepository(client), documents = [];
  for (const chapter of loadLibrary().chapters) {
    const document = await repository.sentenceTranslations(chapter.id);
    if (document?.entries.length) documents.push(validatePublishedSentenceTranslations(document));
  }
  await client.query('COMMIT');
  mkdirSync(sentenceTranslationsRoot, { recursive: true });
  const filenames = new Set(documents.map(document => `${document.chapterId}.json`));
  for (const filename of readdirSync(sentenceTranslationsRoot)) {
    if (/^[a-z]+-v[0-9]+\.json$/.test(filename) && !filenames.has(filename)) unlinkSync(new URL(filename, sentenceTranslationsRoot));
  }
  for (const document of documents) writeFileSync(new URL(`${document.chapterId}.json`, sentenceTranslationsRoot), JSON.stringify(document, null, 2)+'\n');
  console.log(JSON.stringify({ chapters: documents.length, entries: documents.reduce((n, d) => n+d.entries.length, 0), originalsAndFullTranslationsUnchanged: true }));
} finally { await client.end(); }
