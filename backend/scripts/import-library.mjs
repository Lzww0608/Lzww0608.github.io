import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../../content/library.mjs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';

export async function importLibrary(client, library = loadLibrary()) {
  const { catalog, chapters } = library;
  for (const book of catalog.books) {
    await client.query('INSERT INTO books (id,title,author,description,source_url,published) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING', [book.id, book.title, book.author, book.description, book.url]);
    await client.query('INSERT INTO editions (id,book_id,label,source_note) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [`${book.id}-local-wikisource`, book.id, '维基文库整理文本 · 本地归档', `公版古籍；维基文库贡献者整理文本按 ${catalog.license} 共享。固定来源版本、贡献者记录、原始响应及 SHA-256 见 content/five-dynasties/catalog.json。`]);
  }
  for (const chapter of chapters) {
    await client.query("INSERT INTO chapters (id,edition_id,position,title,source_url,notes,scope,published) VALUES ($1,$2,$3,$4,$5,$6,'full',true) ON CONFLICT DO NOTHING", [chapter.id, chapter.editionId, chapter.position, chapter.title, chapter.sourceUrl, JSON.stringify(chapter.notes)]);
    for (let offset = 0; offset < chapter.paragraphs.length; offset += 500) {
      const batch = JSON.stringify(chapter.paragraphs.slice(offset, offset + 500));
      await client.query(`INSERT INTO paragraphs (id,chapter_id,position,current_revision)
        SELECT id,$1,position,1 FROM jsonb_to_recordset($2::jsonb) AS p(id text,position integer)
        ON CONFLICT DO NOTHING`, [chapter.id, batch]);
      await client.query(`INSERT INTO paragraph_revisions (paragraph_id,revision,original)
        SELECT id,1,original FROM jsonb_to_recordset($1::jsonb) AS p(id text,original text)
        ON CONFLICT DO NOTHING`, [batch]);
    }
  }
  return { books: catalog.books.length, chapters: chapters.length, paragraphs: chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const library = loadLibrary();
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect();
    await client.query('BEGIN');
    const counts = await importLibrary(client, library);
    await client.query('COMMIT');
    console.log(`Local library available: ${counts.books} books, ${counts.chapters} full chapters, ${counts.paragraphs} paragraphs. Existing revisions and translations preserved.`);
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await client.end(); }
}
