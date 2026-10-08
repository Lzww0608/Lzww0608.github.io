import pg from 'pg';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { importLibrary } from './import-library.mjs';
import { importPersonPassages, ensurePersonPassageSchema, PersonPassageSourceMismatchError } from './import-person-passages.mjs';
const books = JSON.parse(readFileSync(new URL('../data/initial-excerpts.json', import.meta.url), 'utf8'));
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
export async function seed(client) {
  await client.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
  await client.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
  await ensurePersonPassageSchema(client);
  for (const book of books) {
    await client.query('INSERT INTO books (id,title,author,description,source_url,published) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING', [book.id, book.title, book.author, book.description, book.url]);
    await client.query('INSERT INTO editions (id,book_id,label,source_note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [`${book.id}-wikisource`, book.id, '维基文库整理文本', '公版古籍节选；现代整理、夹注及页面内容的授权以来源页面说明为准。保留来源链接。']);
    await client.query('INSERT INTO chapters (id,edition_id,position,title,source_url,notes,scope,published) VALUES ($1,$2,1,$3,$4,$5,\'excerpt\',true) ON CONFLICT DO NOTHING', [`${book.id}-1`, `${book.id}-wikisource`, book.chapter, book.chapterUrl, JSON.stringify(book.notes)]);
    for (let index = 0; index < book.paragraphs.length; index++) {
      const id = `${book.id}-1-p${index + 1}`;
      await client.query('INSERT INTO paragraphs (id,chapter_id,position,current_revision) VALUES ($1,$2,$3,1) ON CONFLICT DO NOTHING', [id, `${book.id}-1`, index + 1]);
      await client.query('INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ($1,1,$2) ON CONFLICT DO NOTHING', [id, book.paragraphs[index]]);
    }
  }
  await importLibrary(client);
  // Existing local original revisions take precedence. An explicit index import must validate them.
  if (!(await client.query('SELECT 1 FROM public.passages LIMIT 1')).rowCount) {
    try { await importPersonPassages(client); }
    catch (error) { if (!(error instanceof PersonPassageSourceMismatchError)) throw error; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN'); await seed(client); await client.query('COMMIT');
    console.log('Seed complete. Existing content was preserved; no translations were invented.');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await client.end(); }
}
