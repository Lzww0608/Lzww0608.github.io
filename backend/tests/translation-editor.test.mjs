import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { createTranslationEditor, TranslationEditorError } from '../src/translation-editor.mjs';

const config = loadConfig();
const suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_editor_test_${suffix}`;
const role = `history_editor_test_${suffix}`;
const password = randomBytes(32).toString('hex');
const token = randomBytes(48).toString('base64url');
const tokenSha256 = createHash('sha256').update(token).digest('hex');
let admin, owner, pool, editor, databaseCreated = false, roleCreated = false;
const initial = new Map();
const payload = (paragraphId, overrides = {}) => ({ paragraphId, expectedOriginalRevision: 1,
  expectedTranslationId: initial.get(paragraphId), text: '由网站所有者改写的白话文。', editorName: '网站所有者',
  reviewNotes: ['此处保留校核提示，尚未经专业审核。'], ...overrides });

before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); databaseCreated = true;
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  roleCreated = true;
  owner = new pg.Client({ ...adminDatabase(config), database });
  await owner.connect();
  await owner.query('BEGIN');
  try {
    await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
    await owner.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
    await owner.query(`INSERT INTO books (id,title,author,description,source_url,published) VALUES
      ('editor-visible','可见书','作者','说明','https://example.test',true),
      ('editor-hidden','不可见书','作者','说明','https://example.test',false);
      INSERT INTO editions (id,book_id,label,source_note) VALUES
      ('editor-visible','editor-visible','底本','说明'),('editor-hidden','editor-hidden','底本','说明');
      INSERT INTO chapters (id,edition_id,position,title,source_url,published) VALUES
      ('editor-visible','editor-visible',1,'可见篇','https://example.test',true),
      ('editor-hidden-chapter','editor-visible',2,'不可见篇','https://example.test',false),
      ('editor-hidden-book','editor-hidden',1,'不可见书的篇','https://example.test',true);`);
    for (let index = 1; index <= 8; index++) {
      const id = `editor-p${index}`;
      const chapter = index === 7 ? 'editor-hidden-book' : index === 8 ? 'editor-hidden-chapter' : 'editor-visible';
      await owner.query('INSERT INTO paragraphs (id,chapter_id,position,current_revision) VALUES ($1,$2,$3,1)', [id, chapter, index]);
      await owner.query('INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ($1,1,$2)', [id, `第${index}段底本，不应被译文编辑修改。`]);
      if (index !== 5) {
        const { rows } = await owner.query(`INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status,metadata)
          VALUES ($1,1,1,'AI 初译原版本。','Codex AI','published',$2::jsonb) RETURNING id::text`,
        [id, JSON.stringify({ origin: 'ai', batchId: 'editor-test-ai', humanReviewed: false, reviewNotes: ['AI 疑点。'] })]);
        initial.set(id, rows[0].id);
      }
    }
    await owner.query(`INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status)
      VALUES ('editor-p1',1,2,'已有草稿不能覆盖。','旧草稿译者','draft')`);
    await owner.query(readFileSync(new URL('../db/003-translation-editor.sql', import.meta.url), 'utf8'));
    await owner.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${role};
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT EXECUTE ON FUNCTION public.revise_published_translation(text,integer,bigint,text,text,jsonb) TO ${role};`);
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  pool = new pg.Pool({ ...config.database, database, user: role, password, max: 4 });
  editor = createTranslationEditor({ pool, tokenSha256 });
});
after(async () => {
  if (pool) await pool.end();
  if (owner) await owner.end();
  // The random names created above are the only database and role ever removed.
  assert.match(database, /^history_editor_test_[0-9]+_[a-f0-9]{10}$/);
  assert.match(role, /^history_editor_test_[0-9]+_[a-f0-9]{10}$/);
  if (databaseCreated) await admin.query(`DROP DATABASE ${database}`);
  if (roleCreated) await admin.query(`DROP ROLE ${role}`);
  if (admin) await admin.end();
});

test('authentication accepts only the configured Bearer key without exposing it', () => {
  assert.equal(editor.authenticate(`Bearer ${token}`), true);
  assert.equal(editor.authenticate(`bearer ${token}`), true);
  for (const header of [undefined, '', token, `Basic ${token}`, `Bearer ${randomBytes(48).toString('base64url')}`,
    `Bearer ${token} `, `Bearer ${token}\n`, `Bearer  ${token}`, 'Bearer ' + 'a'.repeat(1000)]) {
    assert.equal(editor.authenticate(header), false);
  }
  assert.throws(() => createTranslationEditor({ pool, tokenSha256: 'not-a-digest' }), TypeError);
});

test('strict payload validation rejects malformed, oversized or ambiguous fields before querying', async () => {
  let queries = 0;
  const unit = createTranslationEditor({ tokenSha256, pool: { query() { queries++; throw new Error('Must not query.'); } } });
  for (const input of [null, [], payload('editor-p1', { extra: true }), payload('editor-p1', { paragraphId: 'bad\n' }),
    payload('editor-p1', { paragraphId: "x' OR true--" }), payload('editor-p1', { expectedOriginalRevision: 1.1 }),
    payload('editor-p1', { expectedOriginalRevision: 0 }), payload('editor-p1', { expectedTranslationId: '9223372036854775808' }),
    payload('editor-p1', { expectedTranslationId: '1\n' }), payload('editor-p1', { expectedTranslationId: 9007199254740992 }),
    payload('editor-p1', { text: '\n\t ' }), payload('editor-p1', { text: '译'.repeat(20001) }),
    payload('editor-p1', { text: '带\0空字符' }), payload('editor-p1', { text: '\ud800' }),
    payload('editor-p1', { editorName: '名'.repeat(81) }), payload('editor-p1', { editorName: '名字\n换行' }),
    payload('editor-p1', { reviewNotes: null }), payload('editor-p1', { reviewNotes: {} }), payload('editor-p1', { reviewNotes: Array(21).fill('过多') }),
    payload('editor-p1', { reviewNotes: ['注'.repeat(2001)] }), payload('editor-p1', { reviewNotes: [1] })]) {
    await assert.rejects(unit.revise(input), error => error instanceof TranslationEditorError && error.status === 400);
  }
  assert.equal(queries, 0);
});

test('revision appends a published version, retains AI provenance and leaves originals and earlier versions intact', async () => {
  const beforeOriginals = (await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows;
  const beforeTranslations = (await owner.query("SELECT * FROM translations WHERE paragraph_id='editor-p1' ORDER BY version")).rows;
  const result = await editor.revise(payload('editor-p1', { text: "改写中含 ' 引号、分号 ; 也只是正文。" }));
  assert.equal(result.paragraphId, 'editor-p1');
  assert.equal(result.translation.version, 3);
  assert.equal(result.translation.language, 'zh-Hans');
  assert.equal(result.translation.origin, 'human');
  assert.equal(result.translation.reviewStatus, 'owner-edited');
  assert.equal(result.translation.translator, '网站所有者');
  assert.deepEqual(result.translation.reviewNotes, payload('editor-p1').reviewNotes);
  const after = (await owner.query("SELECT * FROM translations WHERE paragraph_id='editor-p1' ORDER BY version")).rows;
  assert.deepEqual(after.slice(0, 2), beforeTranslations);
  assert.equal(after[2].status, 'published');
  assert.equal(after[2].metadata.basedOnTranslationId, initial.get('editor-p1'));
  assert.equal(after[2].metadata.aiSourceTranslationId, initial.get('editor-p1'));
  assert.equal(after[2].metadata.professionalReview, false);
  assert.deepEqual((await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows, beforeOriginals);
  const second = await editor.revise(payload('editor-p1', { expectedTranslationId: result.translation.id, text: '第二次网站修订。' }));
  assert.equal(second.translation.version, 4);
  const provenance = (await owner.query('SELECT metadata FROM translations WHERE id=$1', [second.translation.id])).rows[0].metadata;
  assert.equal(provenance.basedOnTranslationId, result.translation.id);
  assert.equal(provenance.aiSourceTranslationId, initial.get('editor-p1'));
});

test('concurrent editors cannot silently replace each other and stale translation IDs conflict', async () => {
  const requests = await Promise.allSettled([editor.revise(payload('editor-p2', { text: '并发修改甲。' })),
    editor.revise(payload('editor-p2', { text: '并发修改乙。' }))]);
  assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = requests.find(result => result.status === 'rejected').reason;
  assert.equal(rejected.status, 409);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE paragraph_id='editor-p2'")).rows[0].n, 2);
  await assert.rejects(editor.revise(payload('editor-p2')), error => error.status === 409 && error.code === 'version-conflict');
});

test('a changed original revision blocks editing without creating a translation', async () => {
  await owner.query('BEGIN');
  try {
    await owner.query("INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ('editor-p3',2,'原文新修订。')");
    await owner.query("UPDATE paragraphs SET current_revision=2 WHERE id='editor-p3'");
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  await assert.rejects(editor.revise(payload('editor-p3')), error => error.status === 409);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE paragraph_id='editor-p3'")).rows[0].n, 1);
});

test('missing or unpublished books, chapters and translations are not editable', async () => {
  for (const id of ['editor-missing', 'editor-p5', 'editor-p7', 'editor-p8']) {
    await assert.rejects(editor.revise(payload(id, { expectedTranslationId: '1' })), error => error.status === 404);
  }
});

test('the editor role cannot change originals, insert directly or delete translations', async () => {
  for (const sql of ["UPDATE public.paragraph_revisions SET original='改写原文' WHERE paragraph_id='editor-p4'",
    "UPDATE public.paragraphs SET current_revision=1 WHERE id='editor-p4'",
    "DELETE FROM public.translations WHERE paragraph_id='editor-p4'",
    "INSERT INTO public.translations (paragraph_id,original_revision,version,text,translator) VALUES ('editor-p4',1,9,'绕过函数','攻击者')",
    "UPDATE public.books SET published=false WHERE id='editor-visible'",
    "CREATE TABLE public.editor_forbidden (id integer)"]) {
    await assert.rejects(pool.query(sql), error => error.code === '42501');
  }
  const definition = (await owner.query("SELECT proconfig,prosecdef,proacl,proowner FROM pg_proc WHERE oid='public.revise_published_translation(text,integer,bigint,text,text,jsonb)'::regprocedure")).rows[0];
  assert.equal(definition.prosecdef, true);
  assert.deepEqual(definition.proconfig, ['search_path=pg_catalog']);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_proc, LATERAL aclexplode(coalesce(proacl,acldefault('f',proowner))) AS permission WHERE oid='public.revise_published_translation(text,integer,bigint,text,text,jsonb)'::regprocedure AND permission.grantee=0 AND permission.privilege_type='EXECUTE'")).rows[0].n, 0);
});

test('temporary names cannot shadow public originals or translations', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE translations (id bigint); CREATE TEMP TABLE paragraphs (id text)');
    const temporaryEditor = createTranslationEditor({ pool: client, tokenSha256 });
    const result = await temporaryEditor.revise(payload('editor-p4', { text: '明确访问 public 表。' }));
    assert.equal(result.translation.version, 2);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE paragraph_id='editor-p4'")).rows[0].n, 1);
});

test('an insertion failure rolls back the function atomically', async () => {
  await owner.query(`CREATE FUNCTION public.editor_test_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.paragraph_id='editor-p6' THEN RAISE EXCEPTION 'editor test insert failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER editor_test_reject_insert AFTER INSERT ON public.translations
    FOR EACH ROW EXECUTE FUNCTION public.editor_test_reject_insert();`);
  try {
    await assert.rejects(editor.revise(payload('editor-p6')), /editor test insert failure/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE paragraph_id='editor-p6'")).rows[0].n, 1);
    assert.equal((await owner.query("SELECT current_revision FROM paragraphs WHERE id='editor-p6'")).rows[0].current_revision, 1);
  } finally {
    await owner.query('DROP TRIGGER editor_test_reject_insert ON public.translations; DROP FUNCTION public.editor_test_reject_insert()');
  }
});

test('direct function calls cannot bypass the database input checks', async () => {
  for (const [text, name, notes] of [['\n\t', '校订者', '[]'], ['文'.repeat(20001), '校订者', '[]'],
    ['有效正文', '名'.repeat(81), '[]'], ['有效正文', '校订者', '{}'],
    ['有效正文', '校订者', '[123]'], ['有效正文', '校订者', JSON.stringify(Array(21).fill('过多'))]]) {
    await assert.rejects(pool.query('SELECT public.revise_published_translation($1,1,$2,$3,$4,$5::jsonb)',
      ['editor-p4', initial.get('editor-p4'), text, name, notes]), error => error.code === 'PT400');
  }
});
