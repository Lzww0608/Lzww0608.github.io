import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { validateReviewBatch, reviewTextHash, OwnerReviewError } from '../src/owner-reviews.mjs';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export async function ensureOwnerReviewSchema(client) {
  await client.query(readFileSync(new URL('../db/006-owner-reviews.sql', import.meta.url), 'utf8'));
}

// Caller owns BEGIN/COMMIT. A savepoint keeps a rejected batch from leaving any
// findings or events behind. No original, full translation, or sentence is edited.
export async function importReviewItems(client, input) {
  const batch = validateReviewBatch(input);
  const sha256 = createHash('sha256').update(canonical(batch), 'utf8').digest('hex');
  await client.query('SAVEPOINT owner_review_import');
  try {
    await ensureOwnerReviewSchema(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ancient-history:owner-review-import'))");
    const previousBatch = (await client.query('SELECT sha256,item_count FROM public.owner_review_batches WHERE id=$1', [batch.batchId])).rows[0];
    if (previousBatch && previousBatch.sha256 !== sha256) throw new OwnerReviewError(409, 'batch_conflict');
    const paragraphIds = [...new Set(batch.items.flatMap(item => [item.paragraphId, ...item.evidence.map(ev => ev.paragraphId)]))].sort();
    // Serialize current identity validation against the existing paragraph-edit path.
    await client.query('SELECT id FROM public.paragraphs WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [paragraphIds]);
    const current = (await client.query(`SELECT p.id,p.chapter_id,p.current_revision,r.original,b.id AS book_id,
      b.published AND c.published AS visible,t.id::text AS translation_id,t.version,t.text
      FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      JOIN public.chapters c ON c.id=p.chapter_id JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
      LEFT JOIN LATERAL (SELECT tr.* FROM public.translations tr WHERE tr.paragraph_id=p.id
        AND tr.original_revision=p.current_revision AND tr.language='zh-Hans' AND tr.status='published'
        ORDER BY tr.version DESC LIMIT 1) t ON true WHERE p.id=ANY($1::text[])`, [paragraphIds])).rows;
    const byId = new Map(current.map(row => [row.id, row]));
    const prepared = batch.items.map(item => {
      const row = byId.get(item.paragraphId);
      if (!row?.visible || row.chapter_id !== item.chapterId || row.book_id !== item.bookId
        || row.current_revision !== item.originalRevision || reviewTextHash(row.original) !== item.originalSha256
        || (item.translationId !== null && (row.translation_id !== item.translationId || row.version !== item.translationVersion
          || reviewTextHash(row.text) !== item.translationSha256))) throw new OwnerReviewError(409, 'source_binding_changed');
      const evidence = item.evidence.map(ev => {
        const source = byId.get(ev.paragraphId);
        if (!source?.visible || source.chapter_id !== ev.chapterId || !source.original.includes(ev.excerpt)) {
          throw new OwnerReviewError(409, 'evidence_binding_changed');
        }
        return { ...ev, originalRevision: source.current_revision, originalSha256: reviewTextHash(source.original) };
      });
      return { ...item, evidence };
    });
    if (previousBatch) {
      await client.query('RELEASE SAVEPOINT owner_review_import');
      return { batchId: batch.batchId, inserted: 0, updated: 0, unchanged: previousBatch.item_count };
    }
    await client.query('INSERT INTO public.owner_review_batches(id,sha256,item_count) VALUES ($1,$2,$3)', [batch.batchId, sha256, batch.items.length]);
    let inserted = 0, updated = 0;
    for (const item of prepared) {
      const previous = (await client.query('SELECT * FROM public.owner_review_items WHERE id=$1 FOR UPDATE', [item.id])).rows[0];
      if (previous && (item.expectedVersion !== previous.version || previous.person_id !== item.personId)) {
        throw new OwnerReviewError(409, 'version_conflict');
      }
      if (!previous && item.expectedVersion !== undefined) throw new OwnerReviewError(409, 'version_conflict');
      const values = [item.id, item.personId, item.bookId, item.chapterId, item.paragraphId, item.category, item.status, item.severity,
        item.title, item.detail, JSON.stringify(item.evidence), item.originalRevision, item.originalSha256,
        item.translationId, item.translationVersion, item.translationSha256, item.checkedAt, item.resolution, batch.batchId];
      if (previous) {
        await client.query(`UPDATE public.owner_review_items SET person_id=$2,book_id=$3,chapter_id=$4,paragraph_id=$5,
          category=$6,status=$7,severity=$8,title=$9,detail=$10,evidence=$11::jsonb,original_revision=$12,
          original_sha256=$13,translation_id=$14,translation_version=$15,translation_sha256=$16,
          checked_at=$17,resolution=$18,batch_id=$19,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, values);
        updated++;
      } else {
        await client.query(`INSERT INTO public.owner_review_items(id,person_id,book_id,chapter_id,paragraph_id,category,status,severity,
          title,detail,evidence,original_revision,original_sha256,translation_id,translation_version,translation_sha256,
          checked_at,resolution,batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`, values);
        inserted++;
      }
      await client.query(`INSERT INTO public.owner_review_events(item_id,item_version,actor,previous_status,status,resolution,record)
        SELECT id,version,'batch',$2,status,resolution,to_jsonb(i) FROM public.owner_review_items i WHERE id=$1`, [item.id, previous?.status ?? null]);
    }
    await client.query('RELEASE SAVEPOINT owner_review_import');
    return { batchId: batch.batchId, inserted, updated, unchanged: 0 };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT owner_review_import');
    await client.query('RELEASE SAVEPOINT owner_review_import'); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw new Error('Provide one private review batch file.');
  const batch = validateReviewBatch(JSON.parse(readFileSync(file, 'utf8')));
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN');
    const result = await importReviewItems(client, batch);
    await client.query('COMMIT'); console.log(JSON.stringify(result));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Findings and SQL error details can be private; only known error codes escape.
    console.error(error instanceof OwnerReviewError ? error.code : 'Review import failed. No partial batch was saved.');
    process.exitCode = 1;
  } finally { await client.end(); }
}
