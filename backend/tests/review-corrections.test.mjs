import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { applyReviewCorrections, validateReviewCorrectionBatch } from '../scripts/apply-review-corrections.mjs';

const config = loadConfig(), database = `history_corrections_test_${process.pid}_${randomBytes(5).toString('hex')}`;
let admin, owner, created = false;
const originals = new Map(), parents = new Map();
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const entry = (id, extra = {}) => ({ paragraphId: id, expectedOriginalRevision: 1, originalSha256: hash(originals.get(id)),
  expectedTranslationId: parents.get(id), translationSha256: hash(`第${id}段原译。`), text: `第${id}段依据原文的修订。`,
  reviewNotes: ['保留底本中尚未确定的异文。'], resolution: '把无依据的确定判断改为来源实际措辞。', ...extra });
const batch = (batchId, entries) => ({ schemaVersion: 1, batchId, entries });
async function apply(input) {
  await owner.query('BEGIN');
  try { const result = await applyReviewCorrections(owner, input); await owner.query('COMMIT'); return result; }
  catch (error) { await owner.query('ROLLBACK'); throw error; }
}
before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' }); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
  await owner.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
  await owner.query(`INSERT INTO books(id,title,author,description,source_url,published) VALUES ('correction-book','测试书','作者','说明','https://example.test',true);
    INSERT INTO editions(id,book_id,label,source_note) VALUES ('correction-edition','correction-book','底本','来源');
    INSERT INTO chapters(id,edition_id,position,title,source_url,published) VALUES ('correction-chapter','correction-edition',1,'测试章','https://example.test',true);`);
  for (let number = 1; number <= 8; number++) {
    const id = `correction-p${number}`, original = `第${number}段繁體原文，不能覆寫。`;
    originals.set(id, original);
    await owner.query('INSERT INTO paragraphs(id,chapter_id,position,current_revision) VALUES ($1,\'correction-chapter\',$2,1)', [id, number]);
    await owner.query('INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES ($1,1,$2)', [id, original]);
    const metadata = number === 5 ? { origin: 'human', reviewStatus: 'owner-edited', humanReviewed: false }
      : { origin: 'ai', humanReviewed: false, batchId: 'initial-batch', batchSha256: 'a'.repeat(64), reviewNotes: ['旧疑点。'] };
    const row = (await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
      VALUES ($1,1,1,$2,'Codex','published',$3::jsonb) RETURNING id::text`, [id, `第${id}段原译。`, JSON.stringify(metadata)])).rows[0];
    parents.set(id, row.id);
  }
  await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
    VALUES ('correction-p1',1,2,'不可覆盖的私人草稿。','旧译者','draft','{}')`);
  await owner.query('COMMIT');
});
after(async () => {
  if (owner) await owner.end(); assert.match(database, /^history_corrections_test_[0-9]+_[a-f0-9]{10}$/);
  if (created) await admin.query(`DROP DATABASE ${database}`); if (admin) await admin.end();
});

test('small corrections append only changed published rows and retain every original and earlier version', async () => {
  const previous = (await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows;
  const oldOriginals = (await owner.query('SELECT row_to_json(r) AS record FROM paragraph_revisions r ORDER BY paragraph_id,revision')).rows;
  const input = batch('correction-test-first', [entry('correction-p1'), entry('correction-p2')]);
  const result = await apply(input); assert.equal(result.inserted, 2); assert.equal(result.unchanged, 0);
  assert.equal(result.translations.find(row => row.paragraphId === 'correction-p1').version, 3);
  const after = (await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows;
  assert.deepEqual(after.slice(0, previous.length), previous);
  assert.deepEqual((await owner.query('SELECT row_to_json(r) AS record FROM paragraph_revisions r ORDER BY paragraph_id,revision')).rows, oldOriginals);
  for (const saved of after.slice(previous.length).map(x => x.record)) {
    assert.equal(saved.status, 'published'); assert.equal(saved.metadata.origin, 'ai');
    assert.equal(saved.metadata.humanReviewed, false); assert.equal(saved.metadata.professionalReview, false);
    assert.equal(saved.metadata.reviewStatus, 'pending'); assert.equal(saved.metadata.sourceBatchId, 'initial-batch');
    assert.equal(saved.metadata.basedOnTranslationId, parents.get(saved.paragraph_id));
    assert.equal(saved.metadata.aiSourceTranslationId, parents.get(saved.paragraph_id));
    assert.equal(saved.metadata.reviewCorrectionBatchId, input.batchId); assert.match(saved.metadata.batchSha256, /^[a-f0-9]{64}$/);
  }
  const repeat = await apply(input); assert.equal(repeat.inserted, 0); assert.equal(repeat.unchanged, 2);
  assert.deepEqual(repeat.translations.map(x => x.id).sort(), result.translations.map(x => x.id).sort());
  await assert.rejects(apply({ ...input, entries: [entry('correction-p1', { text: '改输入。' }), entry('correction-p2')] }), error => error.code === 'batch_conflict');
});

test('stale originals/translations, human edits and unnecessary text changes prevent any batch insert', async () => {
  for (const [id, extra, code] of [
    ['correction-p3', { originalSha256: '0'.repeat(64) }, 'current_binding_changed'],
    ['correction-p3', { expectedTranslationId: '999999999' }, 'current_binding_changed'],
    ['correction-p3', { translationSha256: '0'.repeat(64) }, 'current_binding_changed'],
    ['correction-p3', { expectedOriginalRevision: 2 }, 'current_binding_changed'],
    ['correction-p5', {}, 'owner_revision_protected'],
    ['correction-p3', { text: '第correction-p3段原译。' }, 'unchanged_translation'],
  ]) {
    const count = (await owner.query('SELECT count(*)::int AS n FROM translations')).rows[0].n;
    await assert.rejects(apply(batch(`correction-reject-${randomBytes(4).toString('hex')}`, [entry('correction-p4'), entry(id, extra)])), error => error.code === code);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM translations')).rows[0].n, count);
  }
});

test('a later insertion failure rolls back already inserted earlier entries and their publication metadata', async () => {
  const before = (await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows;
  await owner.query(`CREATE FUNCTION public.corrections_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.paragraph_id='correction-p7' THEN RAISE EXCEPTION 'test rejection'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER corrections_test_fail AFTER INSERT ON public.translations FOR EACH ROW EXECUTE FUNCTION public.corrections_test_fail();`);
  try {
    await assert.rejects(apply(batch('correction-late-failure', [entry('correction-p6'), entry('correction-p7')])), /test rejection/);
    assert.deepEqual((await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows, before);
  } finally { await owner.query('DROP TRIGGER corrections_test_fail ON public.translations; DROP FUNCTION public.corrections_test_fail()'); }
});

test('newer published edits make old correction retries conflict instead of publishing stale content', async () => {
  const input = batch('correction-test-newer', [entry('correction-p8')]); const result = await apply(input);
  await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
    VALUES ('correction-p8',1,3,'所有者稍后编辑。','所有者','published','{"origin":"human","humanReviewed":false}')`);
  await assert.rejects(apply(input), error => error.code === 'current_binding_changed');
  assert.equal(result.inserted, 1);
});

test('strict batch validation rejects duplicate paragraphs, missing proof and falsified tool metadata', () => {
  for (const input of [null, {}, batch('bad', []), batch('bad', [entry('correction-p3'), entry('correction-p3')]),
    batch('bad', [entry('correction-p3', { humanReviewed: true })]), batch('bad', [entry('correction-p3', { text: '\ud800' })]),
    batch('bad', [entry('correction-p3', { resolution: '' })]), batch('bad', [entry('correction-p3', { reviewNotes: null })]),
    batch('bad', [entry('correction-p3', { expectedTranslationId: 9007199254740992 })])]) {
    assert.throws(() => validateReviewCorrectionBatch(input), error => error.code === 'invalid_batch');
  }
});
