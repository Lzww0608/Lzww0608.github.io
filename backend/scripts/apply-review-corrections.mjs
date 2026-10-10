import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';

export class ReviewCorrectionError extends Error {
  constructor(code) { super(code); this.name = 'ReviewCorrectionError'; this.code = code; }
}
const reject = code => { throw new ReviewCorrectionError(code); };
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const exactFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) reject('invalid_batch');
};
function string(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum || value.includes('\0') || !value.isWellFormed()) reject('invalid_batch');
}
export function validateReviewCorrectionBatch(batch) {
  exactFields(batch, ['schemaVersion', 'batchId', 'entries']);
  if (batch.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(batch.batchId ?? '')
    || !Array.isArray(batch.entries) || batch.entries.length < 1 || batch.entries.length > 200) reject('invalid_batch');
  const paragraphIds = new Set();
  const entries = batch.entries.map(entry => {
    exactFields(entry, ['paragraphId', 'expectedOriginalRevision', 'originalSha256', 'expectedTranslationId', 'translationSha256',
      'text', 'reviewNotes', 'resolution']);
    if (typeof entry.paragraphId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,159}$/.test(entry.paragraphId)
      || paragraphIds.has(entry.paragraphId) || !Number.isInteger(entry.expectedOriginalRevision)
      || entry.expectedOriginalRevision < 1 || entry.expectedOriginalRevision > 2147483647
      || !/^[a-f0-9]{64}$/.test(entry.originalSha256 ?? '') || !/^[a-f0-9]{64}$/.test(entry.translationSha256 ?? '')) reject('invalid_batch');
    paragraphIds.add(entry.paragraphId);
    const id = typeof entry.expectedTranslationId === 'number' && Number.isSafeInteger(entry.expectedTranslationId)
      ? String(entry.expectedTranslationId) : entry.expectedTranslationId;
    if (typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) reject('invalid_batch');
    string(entry.text, 20000); string(entry.resolution, 4000);
    if (!Array.isArray(entry.reviewNotes) || entry.reviewNotes.length > 20) reject('invalid_batch');
    for (const note of entry.reviewNotes) string(note, 2000);
    return { ...entry, expectedTranslationId: id };
  });
  return { ...batch, entries };
}

// Local administration only; never mounted in the public HTTP server. The caller
// owns the outer transaction. Every entry is checked before the first insertion.
export async function applyReviewCorrections(client, input) {
  const batch = validateReviewCorrectionBatch(input), batchSha256 = sha256(canonical(batch));
  await client.query('SAVEPOINT review_corrections');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ancient-history:review-corrections'))");
    const paragraphIds = batch.entries.map(entry => entry.paragraphId).sort();
    await client.query('SELECT id FROM public.paragraphs WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [paragraphIds]);
    const current = (await client.query(`SELECT p.id,p.current_revision,r.original,b.published AND c.published AS visible,
      t.id::text AS translation_id,t.version,t.text,t.metadata
      FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      JOIN public.chapters c ON c.id=p.chapter_id JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
      LEFT JOIN LATERAL (SELECT tr.* FROM public.translations tr WHERE tr.paragraph_id=p.id
        AND tr.original_revision=p.current_revision AND tr.language='zh-Hans' AND tr.status='published'
        ORDER BY tr.version DESC LIMIT 1) t ON true WHERE p.id=ANY($1::text[])`, [paragraphIds])).rows;
    const byId = new Map(current.map(row => [row.id, row]));
    const previousBatch = (await client.query(`SELECT id::text,paragraph_id,original_revision,version,text,metadata
      FROM public.translations WHERE metadata->>'reviewCorrectionBatchId'=$1 ORDER BY paragraph_id`, [batch.batchId])).rows;
    if (previousBatch.length) {
      const saved = new Map(previousBatch.map(row => [row.paragraph_id, row]));
      if (previousBatch.length !== batch.entries.length || saved.size !== batch.entries.length
        || previousBatch.some(row => row.metadata.batchSha256 !== batchSha256)) reject('batch_conflict');
      for (const entry of batch.entries) {
        const old = saved.get(entry.paragraphId), row = byId.get(entry.paragraphId);
        if (!old || old.text !== entry.text || old.metadata.basedOnTranslationId !== entry.expectedTranslationId) reject('batch_conflict');
        if (!row?.visible || row.current_revision !== entry.expectedOriginalRevision || sha256(row.original) !== entry.originalSha256
          || row.translation_id !== old.id || row.text !== old.text) reject('current_binding_changed');
      }
      await client.query('RELEASE SAVEPOINT review_corrections');
      return { batchId: batch.batchId, inserted: 0, unchanged: previousBatch.length,
        translations: previousBatch.map(row => ({ paragraphId: row.paragraph_id, id: row.id, version: row.version, textSha256: sha256(row.text) })) };
    }
    for (const entry of batch.entries) {
      const row = byId.get(entry.paragraphId);
      if (!row?.visible || row.current_revision !== entry.expectedOriginalRevision || sha256(row.original) !== entry.originalSha256
        || row.translation_id !== entry.expectedTranslationId || sha256(row.text ?? '') !== entry.translationSha256) reject('current_binding_changed');
      // A tool review never replaces an owner's published edits, nor pretends
      // the review was performed by the human owner or a professional reviewer.
      if (row.metadata?.origin !== 'ai' || row.metadata?.humanReviewed !== false
        || row.metadata?.reviewStatus === 'owner-edited' || row.metadata?.professionalReview === true) reject('owner_revision_protected');
      if (row.text === entry.text) reject('unchanged_translation');
    }
    const translations = [];
    for (const entry of batch.entries) {
      const previous = byId.get(entry.paragraphId);
      const version = (await client.query(`SELECT coalesce(max(version),0)+1 AS version FROM public.translations
        WHERE paragraph_id=$1 AND original_revision=$2 AND language='zh-Hans'`, [entry.paragraphId, entry.expectedOriginalRevision])).rows[0].version;
      const metadata = { ...previous.metadata, origin: 'ai', humanReviewed: false, professionalReview: false,
        reviewStatus: 'pending', batchId: batch.batchId, batchSha256, reviewCorrectionBatchId: batch.batchId,
        basedOnTranslationId: previous.translation_id,
        aiSourceTranslationId: previous.metadata.aiSourceTranslationId ?? previous.translation_id,
        sourceBatchId: previous.metadata.batchId ?? null, sourceOrigin: previous.metadata.origin,
        reviewNotes: entry.reviewNotes, reviewResolution: entry.resolution,
        method: '工具逐句复核既有底本与已发布译文；仅对有原文依据的错误追加修订版本，未经人工或专业审核。' };
      const inserted = (await client.query(`INSERT INTO public.translations(paragraph_id,original_revision,language,version,text,translator,status,metadata)
        VALUES ($1,$2,'zh-Hans',$3,$4,'Codex','published',$5::jsonb) RETURNING id::text,version`,
      [entry.paragraphId, entry.expectedOriginalRevision, version, entry.text, JSON.stringify(metadata)])).rows[0];
      translations.push({ paragraphId: entry.paragraphId, ...inserted, textSha256: sha256(entry.text) });
    }
    await client.query('RELEASE SAVEPOINT review_corrections');
    return { batchId: batch.batchId, inserted: translations.length, unchanged: 0, translations };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT review_corrections');
    await client.query('RELEASE SAVEPOINT review_corrections'); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const file = process.argv[2]; if (!file || process.argv.length !== 3) throw new Error('Provide one private review correction batch.');
  const batch = validateReviewCorrectionBatch(JSON.parse(readFileSync(file, 'utf8')));
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN'); const result = await applyReviewCorrections(client, batch);
    await client.query('COMMIT'); console.log(JSON.stringify(result));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error instanceof ReviewCorrectionError ? error.code : 'Review corrections failed. No partial batch was published.');
    process.exitCode = 1;
  } finally { await client.end(); }
}
