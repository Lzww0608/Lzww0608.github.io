import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { validatePublishedSentenceTranslations, sentenceTextHash } from '../../content/sentence-translations.mjs';

export function validateSentenceTranslationBatch(batch, chapters = loadPublishedChapters(loadLibrary())) {
  if (batch?.schemaVersion !== 1 || !/^[a-z0-9-]{1,120}$/.test(batch.id ?? '') || !Array.isArray(batch.entries) || !batch.entries.length) {
    throw new Error('Invalid sentence translation batch.');
  }
  const ids = new Set();
  for (const chapterId of new Set(batch.entries.map(e => e.chapterId))) {
    validatePublishedSentenceTranslations({ schemaVersion: 1, status: 'published', chapterId,
      entries: batch.entries.filter(e => e.chapterId === chapterId) }, chapters);
  }
  for (const entry of batch.entries) {
    if (ids.has(entry.id) || entry.origin !== 'ai' || entry.humanReviewed !== false || !Array.isArray(entry.notes)
      || entry.notes.length > 20 || entry.notes.some(note => typeof note !== 'string' || !note.trim() || [...note].length > 2000)) throw new Error('Invalid sentence supplement provenance.');
    ids.add(entry.id);
  }
  return batch;
}

// The caller owns the transaction. This writes only the independent supplement table.
export async function importSentenceTranslationBatch(client, input, { publish = false, chapters } = {}) {
  const batch = validateSentenceTranslationBatch(input, chapters);
  const digest = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
  await client.query('SAVEPOINT sentence_translation_import');
  try {
    await client.query(readFileSync(new URL('../db/005-sentence-translations.sql', import.meta.url), 'utf8'));
    const { rows } = await client.query(`SELECT p.id,p.current_revision,r.original,t.id::text AS translation_id,t.version,t.text
      FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
      JOIN public.translations t ON t.paragraph_id=p.id AND t.original_revision=p.current_revision
      WHERE p.id=ANY($1::text[]) AND t.id=ANY($2::bigint[]) AND t.status='published' AND t.language='zh-Hans'
        AND t.version=(SELECT max(other.version) FROM public.translations other
          WHERE other.paragraph_id=p.id AND other.original_revision=p.current_revision AND other.status='published' AND other.language='zh-Hans')
      FOR SHARE OF p,r,t`, [[...new Set(batch.entries.map(e => e.paragraphId))], [...new Set(batch.entries.map(e => e.parentTranslationId))]]);
    const current = new Map(rows.map(r => [`${r.id}/${r.translation_id}`, r]));
    for (const entry of batch.entries) {
      const row = current.get(`${entry.paragraphId}/${entry.parentTranslationId}`);
      if (!row || row.current_revision !== entry.originalRevision || sentenceTextHash(row.original) !== entry.originalSha256
        || row.version !== entry.parentTranslationVersion || sentenceTextHash(row.text) !== entry.parentTranslationSha256) {
        throw new Error(`Current source or full translation changed: ${entry.paragraphId}`);
      }
    }
    const { rows: existing } = await client.query('SELECT * FROM public.sentence_translations WHERE id=ANY($1::text[])', [batch.entries.map(e => e.id)]);
    const previous = new Map(existing.map(row => [row.id, row]));
    let inserted = 0, published = 0, promoted = 0;
    for (const entry of batch.entries) {
      const old = previous.get(entry.id);
      if (old) {
        if (old.metadata.batchSha256 !== digest || old.text !== entry.text) throw new Error('Existing sentence supplement differs; use a new version.');
        if (publish && old.status !== 'published') {
          await client.query("UPDATE public.sentence_translations SET status='published' WHERE id=$1 AND status='draft'", [entry.id]); published++; promoted++;
        }
        continue;
      }
      await client.query(`INSERT INTO public.sentence_translations
        (id,paragraph_id,original_revision,original_sha256,original_start,original_end,parent_translation_id,
          parent_translation_version,parent_translation_sha256,version,text,status,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [entry.id, entry.paragraphId, entry.originalRevision, entry.originalSha256, entry.originalStart, entry.originalEnd,
        entry.parentTranslationId, entry.parentTranslationVersion, entry.parentTranslationSha256, entry.version, entry.text,
        publish ? 'published' : 'draft', JSON.stringify({ origin: 'ai', humanReviewed: false, reviewStatus: 'pending',
          batchId: batch.id, batchSha256: digest, reviewNotes: entry.notes, method: '独立核对具体原文句号单位及全文语境；补译单独保存，不改写既有全文译文。' })]);
      inserted++; if (publish) published++;
    }
    await client.query('RELEASE SAVEPOINT sentence_translation_import');
    return { batchId: batch.id, inserted, published, unchanged: existing.length - promoted, humanReviewed: false };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT sentence_translation_import');
    await client.query('RELEASE SAVEPOINT sentence_translation_import'); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]; if (!file) throw new Error('Provide a private sentence translation batch.');
  const batch = JSON.parse(readFileSync(file, 'utf8')); validateSentenceTranslationBatch(batch);
  const client = new pg.Client(adminDatabase(loadConfig()));
  try {
    await client.connect(); await client.query('BEGIN');
    const result = await importSentenceTranslationBatch(client, batch, { publish: process.argv.includes('--publish') });
    await client.query('COMMIT'); console.log(JSON.stringify(result));
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error(error.message); process.exitCode = 1; }
  finally { await client.end(); }
}
