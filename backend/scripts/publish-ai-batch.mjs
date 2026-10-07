import pg from 'pg';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { validateTranslationBatch, textHash } from '../src/translation-batch.mjs';

// Explicit release of an AI initial translation is separate from human review.
export async function publishAiBatch(client, input) {
  const batch = validateTranslationBatch(input);
  await client.query('SAVEPOINT publish_ai_batch');
  try {
    const { rows } = await client.query(`SELECT t.*,p.current_revision,r.original FROM translations t
      JOIN paragraphs p ON p.id=t.paragraph_id
      JOIN paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      WHERE t.metadata->>'batchId'=$1 ORDER BY t.id FOR UPDATE OF t,p`, [batch.id]);
    if (rows.length !== batch.entries.length) throw new Error('The complete AI batch must be imported before release.');
    for (const entry of batch.entries) {
      const row = rows.find(item => item.paragraph_id === entry.paragraphId);
      if (!row || row.metadata.origin !== 'ai' || row.metadata.humanReviewed !== false
        || row.metadata.batchSha256 !== batch.digest || row.text !== entry.text
        || row.current_revision !== entry.originalRevision || textHash(row.original) !== entry.originalSha256
        || !['draft', 'published'].includes(row.status)) throw new Error(`AI release identity or source differs: ${entry.paragraphId}`);
      const other = await client.query("SELECT id FROM translations WHERE paragraph_id=$1 AND original_revision=$2 AND language=$3 AND status='published' AND id<>$4", [entry.paragraphId, entry.originalRevision, batch.language, row.id]);
      if (other.rowCount) throw new Error('An existing published translation must not be replaced by an AI batch.');
    }
    const result = await client.query(`UPDATE translations SET status='published',metadata=metadata||jsonb_build_object(
      'publication',jsonb_build_object('kind','ai-initial','authorizedBy','project-owner','releasedAt',now(),'humanReviewed',false))
      WHERE metadata->>'batchId'=$1 AND status='draft' RETURNING id`, [batch.id]);
    await client.query('RELEASE SAVEPOINT publish_ai_batch');
    return { batchId: batch.id, released: result.rowCount, total: rows.length, label: 'AI 初译，待修订', humanReviewed: false };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT publish_ai_batch');
    await client.query('RELEASE SAVEPOINT publish_ai_batch');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Provide the AI batch explicitly authorized for public release.');
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN');
    const result = await publishAiBatch(client, input); await client.query('COMMIT'); console.log(JSON.stringify(result));
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error(error.message); process.exitCode = 1; }
  finally { await client.end(); }
}
