import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../../content/library.mjs';
import { loadPersonPassageIndex, validatePersonPassageIndex } from '../../content/person-passages.mjs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
export class PersonPassageSourceMismatchError extends Error {}
export async function ensurePersonPassageSchema(client) {
  await client.query(readFileSync(new URL('../db/004-person-passages.sql', import.meta.url), 'utf8'));
}

async function assertCurrentArchive(client, library) {
  const expected = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph =>
    [paragraph.id, { ...paragraph, chapterId: chapter.id }])));
  // Lock source rows until commit so a concurrent original revision cannot invalidate this import.
  const { rows } = await client.query(`SELECT p.id,p.chapter_id,p.position,p.current_revision,r.original
    FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
    WHERE p.chapter_id=ANY($1::text[]) ORDER BY p.id FOR SHARE OF p,r`, [library.chapters.map(chapter => chapter.id)]);
  if (rows.length !== expected.size) throw new PersonPassageSourceMismatchError('Current database archive paragraph count differs. No passage references were imported.');
  for (const row of rows) {
    const paragraph = expected.get(row.id);
    if (!paragraph || row.chapter_id !== paragraph.chapterId || row.position !== paragraph.position
      || row.current_revision !== paragraph.revision || row.original !== paragraph.original) {
      throw new PersonPassageSourceMismatchError(`Current database original differs: ${row.id}. Rebuild the passage index for the current source revision.`);
    }
  }
}

// Caller owns the transaction. Only the five passage-index tables are written.
export async function importPersonPassages(client, input = loadPersonPassageIndex(), library = loadLibrary()) {
  const index = validatePersonPassageIndex(input, library);
  const digest = sha256(JSON.stringify(index));
  await client.query('SAVEPOINT person_passage_import');
  try {
    await ensurePersonPassageSchema(client);
    await client.query('LOCK TABLE public.person_passage_index, public.passage_people, public.passages, public.passage_spans, public.person_passages IN SHARE ROW EXCLUSIVE MODE');
    await assertCurrentArchive(client, library);
    const current = (await client.query('SELECT digest FROM public.person_passage_index WHERE id')).rows[0];
    if (current?.digest === digest) {
      await client.query('RELEASE SAVEPOINT person_passage_import');
      return { people: index.people.length, passages: index.passages.length,
        associations: index.passages.reduce((count, passage) => count + passage.people.length, 0),
        imported: 0, unchanged: index.passages.length };
    }
    await client.query(`INSERT INTO public.passage_people(id,name)
      SELECT id,name FROM jsonb_to_recordset($1::jsonb) AS person(id text,name text)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE passage_people.name IS DISTINCT FROM excluded.name`, [JSON.stringify(index.people)]);
    // Synchronize display metadata atomically; historical source and translation tables stay intact.
    await client.query('DELETE FROM public.person_passages');
    await client.query('DELETE FROM public.passage_spans');
    await client.query('DELETE FROM public.passages WHERE NOT(id=ANY($1::text[]))', [index.passages.map(passage => passage.id)]);
    await client.query('DELETE FROM public.passage_people WHERE NOT(id=ANY($1::text[]))', [index.people.map(person => person.id)]);
    for (let offset = 0; offset < index.passages.length; offset += 500) {
      const batch = JSON.stringify(index.passages.slice(offset, offset + 500));
      await client.query(`INSERT INTO public.passages(id,chapter_id,title)
        SELECT id,"chapterId",title FROM jsonb_to_recordset($1::jsonb) AS passage(id text,"chapterId" text,title text)
        ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,title=excluded.title
        WHERE passages.chapter_id IS DISTINCT FROM excluded.chapter_id OR passages.title IS DISTINCT FROM excluded.title`, [batch]);
      await client.query(`INSERT INTO public.passage_spans(passage_id,position,paragraph_id,original_revision,original_sha256,start_offset,end_offset)
        SELECT passage.id,span.position::int,span.value->>'paragraphId',(span.value->>'originalRevision')::int,
          span.value->>'originalSha256',(span.value->>'start')::int,(span.value->>'end')::int
        FROM jsonb_to_recordset($1::jsonb) AS passage(id text,spans jsonb)
        CROSS JOIN LATERAL jsonb_array_elements(passage.spans) WITH ORDINALITY AS span(value,position)`, [batch]);
      await client.query(`INSERT INTO public.person_passages(person_id,passage_id,kind)
        SELECT person.value->>'personId',passage.id,person.value->>'kind'
        FROM jsonb_to_recordset($1::jsonb) AS passage(id text,people jsonb)
        CROSS JOIN LATERAL jsonb_array_elements(passage.people) AS person(value)`, [batch]);
    }
    await client.query(`INSERT INTO public.person_passage_index(id,schema_version,scope,book_count,chapter_count,paragraph_count,digest)
      VALUES(true,1,'current-archive',$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET
        book_count=excluded.book_count,chapter_count=excluded.chapter_count,paragraph_count=excluded.paragraph_count,digest=excluded.digest`,
    [index.coverage.bookCount,index.coverage.chapterCount,index.coverage.paragraphCount,digest]);
    await client.query('RELEASE SAVEPOINT person_passage_import');
    return { people: index.people.length, passages: index.passages.length,
      associations: index.passages.reduce((count, passage) => count + passage.people.length, 0),
      imported: index.passages.length, unchanged: 0 };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT person_passage_import');
    await client.query('RELEASE SAVEPOINT person_passage_import');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    const library = loadLibrary();
    const input = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : loadPersonPassageIndex(library);
    validatePersonPassageIndex(input, library);
    client = new pg.Client(adminDatabase(loadConfig()));
    await client.connect(); await client.query('BEGIN');
    const result = await importPersonPassages(client, input, library);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...result, scope: 'current-archive', originalsPreserved: true, translationsPreserved: true }));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    // Database errors are reduced to their code; connection details and credentials stay private.
    console.error(error.code ? `Passage index import failed (${error.code}).` : error.message);
    process.exitCode = 1;
  } finally { if (client) await client.end(); }
}
