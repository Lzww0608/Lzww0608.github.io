import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase, pgBin } from '../scripts/runtime.mjs';
import { createTranslationEditor } from '../src/translation-editor.mjs';
import { reviewSubjects, reviewTextHash, validateReviewBatch, verifyOwnerReviewPermissions } from '../src/owner-reviews.mjs';
import { importReviewItems, ensureOwnerReviewSchema } from '../scripts/import-review-items.mjs';

const config = loadConfig(), suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_reviews_test_${suffix}`, role = `history_reviews_editor_${suffix}`, reader = `history_reviews_reader_${suffix}`;
const password = randomBytes(32).toString('hex');
let admin, owner, pool, readerPool, editor, databaseCreated = false, rolesCreated = false, translationId;
const original = '武皇有子，嗣立為晉王。史書異說另存。';
const translated = '武皇有儿子，后来继位为晋王。史书的不同记载另行保存。';
const item = (id, personId = 'li-keyong', extra = {}) => ({ id, personId, bookId: 'review-book', chapterId: 'review-chapter',
  paragraphId: 'review-p1', category: 'translation', status: 'open', severity: 'warning', title: '核对人物身份',
  detail: '私有校核说明，不能出现在公开API或网站副本。', evidence: [{ chapterId: 'review-chapter', paragraphId: 'review-p1', excerpt: '嗣立為晉王。' }],
  originalRevision: 1, originalSha256: reviewTextHash(original), translationId, translationVersion: 1,
  translationSha256: reviewTextHash(translated), checkedAt: '2026-10-11T00:00:00.000Z', resolution: '', ...extra });
const batch = (batchId, items) => ({ schemaVersion: 1, batchId, subjects: reviewSubjects, items });
async function importing(input) {
  await owner.query('BEGIN');
  try { const result = await importReviewItems(owner, input); await owner.query('COMMIT'); return result; }
  catch (error) { await owner.query('ROLLBACK'); throw error; }
}
before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' }); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); databaseCreated = true;
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${reader} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); rolesCreated = true;
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
  await owner.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
  await owner.query(`INSERT INTO books(id,title,author,description,source_url,published) VALUES ('review-book','测试史料','作者','说明','https://example.test',true);
    INSERT INTO editions(id,book_id,label,source_note) VALUES ('review-edition','review-book','底本','来源');
    INSERT INTO chapters(id,edition_id,position,title,source_url,published) VALUES ('review-chapter','review-edition',1,'测试卷','https://example.test',true);
    INSERT INTO paragraphs(id,chapter_id,position,current_revision) VALUES ('review-p1','review-chapter',1,1),('review-p2','review-chapter',2,1);`);
  for (const id of ['review-p1', 'review-p2']) await owner.query('INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES ($1,1,$2)', [id, original]);
  translationId = (await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
    VALUES ('review-p1',1,1,$1,'Codex','published','{"origin":"ai","humanReviewed":false}') RETURNING id::text`, [translated])).rows[0].id;
  await owner.query(readFileSync(new URL('../db/003-translation-editor.sql', import.meta.url), 'utf8'));
  await ensureOwnerReviewSchema(owner);
  await owner.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${database} TO ${role},${reader};
    GRANT USAGE ON SCHEMA public TO ${role},${reader};
    GRANT SELECT ON public.books,public.chapters,public.paragraphs,public.paragraph_revisions,public.translations TO ${reader};
    GRANT EXECUTE ON FUNCTION public.owner_review_list(text,text,text,text,integer,integer),public.owner_review_detail(text),
      public.owner_review_set_status(text,integer,text,text),public.revise_published_translation(text,integer,bigint,text,text,jsonb) TO ${role};`);
  await owner.query('COMMIT');
  pool = new pg.Pool({ ...config.database, database, user: role, password, max: 3 });
  readerPool = new pg.Pool({ ...config.database, database, user: reader, password });
  editor = createTranslationEditor({ pool, tokenSha256: createHash('sha256').update('test-key').digest('hex') });
});
after(async () => {
  if (pool) await pool.end(); if (readerPool) await readerPool.end(); if (owner) await owner.end();
  assert.match(database, /^history_reviews_test_[0-9]+_[a-f0-9]{10}$/);
  if (databaseCreated) await admin.query(`DROP DATABASE ${database}`);
  if (rolesCreated) await admin.query(`DROP ROLE ${role}; DROP ROLE ${reader}`);
  if (admin) await admin.end();
});

test('batch imports checked bindings atomically and repeats without touching identity data', async () => {
  const identities = (await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows;
  const originals = (await owner.query('SELECT row_to_json(r) AS record FROM paragraph_revisions r ORDER BY paragraph_id,revision')).rows;
  const input = batch('review-test-first', [item('review-alpha'), item('review-beta', 'chai-rong', { category: 'source-note',
    translationId: null, translationVersion: null, translationSha256: null, status: 'retained', resolution: '保留底本异说。' })]);
  assert.deepEqual(await importing(input), { batchId: input.batchId, inserted: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(await importing(input), { batchId: input.batchId, inserted: 0, updated: 0, unchanged: 2 });
  assert.deepEqual((await owner.query('SELECT row_to_json(t) AS record FROM translations t ORDER BY id')).rows, identities);
  assert.deepEqual((await owner.query('SELECT row_to_json(r) AS record FROM paragraph_revisions r ORDER BY paragraph_id,revision')).rows, originals);
  const bound = (await owner.query("SELECT evidence FROM owner_review_items WHERE id='review-alpha'")).rows[0].evidence[0];
  assert.equal(bound.originalRevision, 1); assert.equal(bound.originalSha256, reviewTextHash(original));
  assert.equal((await owner.query('SELECT count(*)::int n FROM owner_review_events')).rows[0].n, 2);
  await assert.rejects(importing({ ...input, items: [item('review-alpha', 'li-keyong', { detail: 'changed' })] }), error => error.status === 409);
});

test('list filters before pagination, shares one snapshot and returns versioned details only through editor functions', async () => {
  const first = await editor.reviews(new URLSearchParams({ limit: '1' }));
  assert.equal(first.total, 2); assert.equal(first.nextOffset, 1); assert.equal(first.items.length, 1);
  assert.equal(first.summary.open, 1); assert.equal(first.summary.retained, 1); assert.equal(first.summary.stale, 0);
  assert.match(first.resultSetRevision, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.subjects.map(s => s.id).sort(), reviewSubjects.map(s => s.id).sort());
  const second = await editor.reviews(new URLSearchParams({ limit: '1', offset: '1' }));
  assert.equal(first.resultSetRevision, second.resultSetRevision); assert.equal(second.nextOffset, null);
  const filtered = await editor.reviews(new URLSearchParams({ personId: 'chai-rong', status: 'retained', category: 'source-note' }));
  assert.equal(filtered.total, 1); assert.equal(filtered.items[0].id, 'review-beta');
  const detail = await editor.review('review-alpha');
  assert.equal(detail.paragraph.original, original); assert.equal(detail.paragraph.revision, 1);
  assert.equal(detail.paragraph.translation.text, translated); assert.equal(detail.paragraph.translation.language, 'zh-Hans');
  assert.equal(detail.item.currentBinding, true); assert.equal(detail.item.personName, '李克用');
  await assert.rejects(editor.review('does-not-exist'), error => error.status === 404);
});

test('a rejected source/evidence member rolls back the whole batch and events', async () => {
  const before = (await owner.query('SELECT count(*)::int n FROM owner_review_items')).rows[0].n;
  await assert.rejects(importing(batch('review-test-rejected', [item('review-good'), item('review-bad', 'li-cunxu',
    { evidence: [{ chapterId: 'review-chapter', paragraphId: 'review-p1', excerpt: '不存在的引文。' }] })])), error => error.status === 409);
  assert.equal((await owner.query('SELECT count(*)::int n FROM owner_review_items')).rows[0].n, before);
  assert.equal((await owner.query("SELECT count(*)::int n FROM owner_review_batches WHERE id='review-test-rejected'")).rows[0].n, 0);
  await assert.rejects(importing(batch('review-wrong-original', [item('review-wrong', 'zhu-wen', { originalSha256: '0'.repeat(64) })])), error => error.status === 409);
});

test('status changes append audit events and protect concurrent versions without setting human-reviewed metadata', async () => {
  const outcomes = await Promise.allSettled([
    editor.reviewStatus('review-alpha', { expectedVersion: 1, status: 'checked', resolution: '已核对原文，保留该记载。' }),
    editor.reviewStatus('review-alpha', { expectedVersion: 1, status: 'resolved', resolution: '另一结论。' }),
  ]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.status, 409);
  const current = await editor.review('review-alpha'); assert.equal(current.item.version, 2);
  assert.equal((await owner.query("SELECT count(*)::int n FROM owner_review_events WHERE item_id='review-alpha'")).rows[0].n, 2);
  assert.equal((await owner.query('SELECT metadata FROM translations WHERE id=$1', [translationId])).rows[0].metadata.humanReviewed, false);
  await importing(batch('review-test-update', [item('review-alpha', 'li-keyong', { expectedVersion: 2, status: 'checked',
    detail: '第二批结论追加保留旧结论。', resolution: '确认版本绑定。' })]));
  assert.equal((await editor.review('review-alpha')).item.version, 3);
});

test('public reader and editor cannot directly read private findings or bypass narrow functions', async () => {
  for (const table of ['owner_review_subjects', 'owner_review_batches', 'owner_review_items', 'owner_review_events', 'owner_review_records']) {
    await assert.rejects(readerPool.query(`SELECT * FROM public.${table}`), error => error.code === '42501');
    await assert.rejects(pool.query(`SELECT * FROM public.${table}`), error => error.code === '42501');
  }
  for (const fn of ['owner_review_list(NULL,NULL,NULL,NULL,50,0)', "owner_review_detail('review-alpha')",
    "owner_review_set_status('review-alpha',3,'checked','绕过授权')"]) {
    await assert.rejects(readerPool.query(`SELECT public.${fn}`), error => error.code === '42501');
  }
  await assert.rejects(pool.query("UPDATE owner_review_items SET status='resolved' WHERE id='review-alpha'"), error => error.code === '42501');
  await assert.rejects(pool.query('INSERT INTO owner_review_batches(id,sha256,item_count) VALUES (\'evil\',repeat(\'a\',64),0)'), error => error.code === '42501');
  const functions = (await owner.query(`SELECT proname,prosecdef,proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc WHERE proname IN ('owner_review_list','owner_review_detail','owner_review_set_status')`)).rows;
  assert.equal(functions.length, 3);
  for (const fn of functions) { assert.equal(fn.prosecdef, true); assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']); assert.equal(fn.public_execute, false); }
  if ((await owner.query("SELECT 1 FROM pg_roles WHERE rolname='history_reader'")).rowCount) {
    assert.equal((await owner.query("SELECT has_table_privilege('history_reader','public.owner_review_items','SELECT') AS allowed")).rows[0].allowed, false);
  }
});

test('restoring without ACL requires private migration and least privilege grants before review access', async () => {
  const restoredDatabase = `history_reviews_restore_${suffix}`;
  const folder = mkdtempSync(join(tmpdir(), 'history-owner-reviews-'));
  let restored, created = false;
  try {
    const dump = join(folder, 'test.dump'), connection = adminDatabase(config);
    execFileSync(join(pgBin, 'pg_dump'), ['-h', connection.host, '-p', String(connection.port), '-U', connection.user,
      '-d', database, '-Fc', '-f', dump], { stdio: 'pipe' });
    await admin.query(`CREATE DATABASE ${restoredDatabase}`); created = true;
    execFileSync(join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '-h', connection.host,
      '-p', String(connection.port), '-U', connection.user, '-d', restoredDatabase, dump], { stdio: 'pipe' });
    restored = new pg.Client({ ...connection, database: restoredDatabase }); await restored.connect();
    await assert.rejects(verifyOwnerReviewPermissions(restored, { readerRole: reader, editorRole: role }), /permissions|accessible/);
    await ensureOwnerReviewSchema(restored);
    await restored.query(`GRANT EXECUTE ON FUNCTION public.owner_review_list(text,text,text,text,integer,integer),
      public.owner_review_detail(text),public.owner_review_set_status(text,integer,text,text) TO ${role}`);
    assert.deepEqual(await verifyOwnerReviewPermissions(restored, { readerRole: reader, editorRole: role }), { verified: true, tables: 5, functions: 3 });
    assert.equal((await restored.query("SELECT public.owner_review_detail('review-alpha') AS record")).rows[0].record.item.id, 'review-alpha');
  } finally {
    if (restored) await restored.end();
    assert.match(restoredDatabase, /^history_reviews_restore_[0-9]+_[a-f0-9]{10}$/);
    if (created) await admin.query(`DROP DATABASE ${restoredDatabase}`);
    rmSync(folder, { recursive: true, force: true });
  }
});

test('updated full translation or original makes findings stale and forbids completion until rechecked', async () => {
  const before = await editor.reviews();
  await editor.revise({ paragraphId: 'review-p1', expectedOriginalRevision: 1, expectedTranslationId: translationId,
    text: '新校订全文，旧校核项不能静默继承。', editorName: '所有者', reviewNotes: [] });
  assert.equal((await editor.review('review-alpha')).item.currentBinding, false);
  assert.equal((await editor.review('review-beta')).item.currentBinding, true, 'source-only finding ignores translation versions');
  const afterList = await editor.reviews(new URLSearchParams({ status: 'stale' }));
  assert.equal(afterList.total, 1); assert.equal(afterList.summary.stale, 1); assert.notEqual(before.resultSetRevision, afterList.resultSetRevision);
  await assert.rejects(editor.reviewStatus('review-alpha', { expectedVersion: 3, status: 'resolved', resolution: '错误地继承旧结论。' }), error => error.status === 409);
  assert.equal((await editor.reviewStatus('review-alpha', { expectedVersion: 3, status: 'open', resolution: '原译已变，重新核对。' })).item.version, 4);
  await owner.query('BEGIN');
  await owner.query("INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES ('review-p1',2,'原文改版。'); UPDATE paragraphs SET current_revision=2 WHERE id='review-p1'");
  await owner.query('COMMIT');
  assert.equal((await editor.review('review-beta')).item.currentBinding, false);
  await assert.rejects(editor.reviewStatus('review-beta', { expectedVersion: 1, status: 'checked', resolution: '旧原文绑定无效。' }), error => error.status === 409);
});

test('strict JS and SQL validation reject ambiguous filters, unsafe fields and invented evidence', async () => {
  for (const params of ['personId=unknown', 'field=anything', 'limit=0', 'limit=101', 'limit=01', 'offset=-1', 'personId=li-keyong&personId=chai-rong', 'status=published']) {
    await assert.rejects(editor.reviews(new URLSearchParams(params)), error => error.status === 400);
  }
  for (const payload of [{ expectedVersion: 1, status: 'checked', resolution: '' }, { expectedVersion: 0, status: 'open', resolution: '说明' },
    { expectedVersion: 1, status: 'checked', resolution: '说明', humanReviewed: true }]) {
    await assert.rejects(editor.reviewStatus('review-alpha', payload), error => error.status === 400);
  }
  for (const extra of [{ humanReviewed: true }, { translationId: null }, { evidence: [] }, { personId: 'other' }, { checkedAt: 'bad' }, { id: 'bad_id' }]) {
    assert.throws(() => validateReviewBatch(batch('bad-batch', [item('bad-item', 'li-keyong', extra)])), error => error.status === 400);
  }
  await assert.rejects(pool.query("SELECT public.owner_review_set_status('review-alpha',4,'published','假的状态')"), error => error.code === 'PT400');
  await assert.rejects(pool.query('SELECT public.owner_review_list(NULL,NULL,NULL,NULL,0,0)'), error => error.code === 'PT400');
});
