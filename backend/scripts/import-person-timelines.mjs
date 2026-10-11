import pg from 'pg';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPersonTimelines, validatePersonTimeline, timelineEvidence, timelineHash } from '../../content/person-timelines.mjs';

export async function ensurePersonTimelineSchema(client) {
  await client.query(readFileSync(new URL('../db/007-person-timelines.sql', import.meta.url), 'utf8'));
}

// Caller owns the transaction; a rejected member rolls back the entire index import.
export async function importPersonTimelines(client, input = loadPersonTimelines(), library = loadLibrary()) {
  if (!Array.isArray(input) || !input.length || new Set(input.map(d => d.personId)).size !== input.length) throw new Error('Invalid timeline batch identity');
  const documents = input.map(d => validatePersonTimeline(d, library));
  const refs = documents.flatMap(d => d.events.flatMap(timelineEvidence));
  const ids = [...new Set(refs.map(e => e.paragraphId))].sort();
  await client.query('SAVEPOINT person_timeline_import');
  try {
    await ensurePersonTimelineSchema(client);
    await client.query('LOCK TABLE public.person_timelines IN SHARE ROW EXCLUSIVE MODE');
    const rows = (await client.query(`SELECT p.id,p.chapter_id,p.current_revision,r.original,
      b.published AND c.published AS visible FROM public.paragraphs p
      JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      JOIN public.chapters c ON c.id=p.chapter_id JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
      WHERE p.id=ANY($1::text[]) ORDER BY p.id FOR SHARE OF p,r,c,b`, [ids])).rows;
    const current = new Map(rows.map(p => [p.id, p]));
    for (const ref of refs) {
      const p = current.get(ref.paragraphId);
      if (!p?.visible || p.chapter_id !== ref.chapterId || p.current_revision !== ref.originalRevision
        || timelineHash(p.original) !== ref.originalSha256 || !p.original.includes(ref.excerpt)) throw new Error(`Current timeline source differs: ${ref.paragraphId}`);
    }
    let inserted = 0, updated = 0, unchanged = 0;
    for (const document of documents) {
      const digest = timelineHash(JSON.stringify(document));
      const old = (await client.query('SELECT digest FROM public.person_timelines WHERE person_id=$1', [document.personId])).rows[0];
      if (old?.digest === digest) { unchanged++; continue; }
      await client.query(`INSERT INTO public.person_timelines(person_id,document,digest) VALUES($1,$2::jsonb,$3)
        ON CONFLICT(person_id) DO UPDATE SET document=excluded.document,digest=excluded.digest,updated_at=clock_timestamp()`,
      [document.personId, JSON.stringify(document), digest]);
      if (old) updated++; else inserted++;
    }
    await client.query('RELEASE SAVEPOINT person_timeline_import');
    return { people: documents.length, events: documents.reduce((n,d) => n+d.events.length, 0), inserted, updated, unchanged };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT person_timeline_import'); await client.query('RELEASE SAVEPOINT person_timeline_import'); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new pg.Client(adminDatabase(loadConfig()));
  try { await client.connect(); await client.query('BEGIN'); const result=await importPersonTimelines(client); await client.query('COMMIT'); console.log(JSON.stringify(result)); }
  catch (error) { await client.query('ROLLBACK').catch(()=>{}); console.error(error.code ? `Timeline import failed (${error.code})` : error.message); process.exitCode=1; }
  finally { await client.end(); }
}
