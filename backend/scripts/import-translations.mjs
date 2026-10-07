import pg from 'pg';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { validateTranslationBatch, textHash } from '../src/translation-batch.mjs';

// Caller owns the transaction. Source versions are checked before any drafts are inserted.
export async function importTranslationBatch(client, input) {
  const batch = validateTranslationBatch(input);
  await client.query('SAVEPOINT translation_batch_import');
  try {
    await client.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
    const { rows } = await client.query(`SELECT p.id, p.current_revision, r.original FROM paragraphs p
      JOIN paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      WHERE p.id=ANY($1::text[]) ORDER BY p.id FOR UPDATE OF p`, [batch.entries.map(entry => entry.paragraphId)]);
    const originals = new Map(rows.map(row => [row.id, row]));
    for (const entry of batch.entries) {
      const original = originals.get(entry.paragraphId);
      if (!original || original.current_revision !== entry.originalRevision || textHash(original.original) !== entry.originalSha256) {
        throw new Error(`Current database original differs: ${entry.paragraphId}. Re-translate the current revision.`);
      }
    }
    const existing = await client.query('SELECT * FROM translations WHERE metadata->>\'batchId\'=$1 ORDER BY id', [batch.id]);
    if (existing.rowCount) {
      const byParagraph = new Map(existing.rows.map(row => [row.paragraph_id, row]));
      if (existing.rowCount !== batch.entries.length) throw new Error('Incomplete existing batch; no translations were overwritten.');
      for (const entry of batch.entries) {
        const row = byParagraph.get(entry.paragraphId);
        if (!row || row.metadata.batchSha256 !== batch.digest || row.text !== entry.text
          || row.original_revision !== entry.originalRevision || row.language !== batch.language || row.translator !== batch.translator
          || JSON.stringify(row.metadata.reviewNotes) !== JSON.stringify(entry.reviewNotes)) {
          throw new Error('Batch ID already exists with different content. Use a new batch ID for a new version.');
        }
      }
      await client.query('RELEASE SAVEPOINT translation_batch_import');
      return { batchId: batch.id, inserted: 0, unchanged: existing.rowCount, ids: existing.rows.map(row => String(row.id)) };
    }
    const ids = [];
    for (const entry of batch.entries) {
      const result = await client.query(`INSERT INTO translations (paragraph_id,original_revision,language,version,text,translator,status,metadata)
        SELECT $1,$2,$3,coalesce(max(version),0)+1,$4,$5,'draft',$6::jsonb FROM translations
        WHERE paragraph_id=$1 AND original_revision=$2 AND language=$3 RETURNING id`,
      [entry.paragraphId, entry.originalRevision, batch.language, entry.text, batch.translator, JSON.stringify(entry.metadata)]);
      ids.push(String(result.rows[0].id));
    }
    await client.query('RELEASE SAVEPOINT translation_batch_import');
    return { batchId: batch.id, inserted: ids.length, unchanged: 0, ids };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT translation_batch_import');
    await client.query('RELEASE SAVEPOINT translation_batch_import');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Provide the local AI translation batch JSON file.');
  const batch = JSON.parse(readFileSync(file, 'utf8'));
  validateTranslationBatch(batch);
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN');
    const result = await importTranslationBatch(client, batch);
    await client.query('COMMIT');
    console.log(JSON.stringify({ ...result, status: 'draft', humanReviewed: false }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); console.error(error.message); process.exitCode = 1;
  } finally { await client.end(); }
}
