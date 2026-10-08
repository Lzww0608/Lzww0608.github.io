import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { createRepository } from '../src/repository.mjs';
import { createApi } from '../src/http.mjs';
import { adminDatabase, localDir, backendDir } from '../scripts/runtime.mjs';
import { seed } from '../scripts/seed.mjs';
import { importLibrary } from '../scripts/import-library.mjs';
import { importTranslationBatch } from '../scripts/import-translations.mjs';
import { publishAiBatch } from '../scripts/publish-ai-batch.mjs';
import { fixtureBatch } from './fixtures/translation-batch.mjs';
const config = loadConfig();
const database = `history_test_${process.pid}_${randomBytes(4).toString('hex')}`;
let admin, owner, pool, server, base, created = false;
before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN'); await seed(owner);
  await owner.query(`INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status) VALUES
    ('old-1-p1',1,1,'已发布译文第一版','测试译者','published'),
    ('old-1-p1',1,2,'已发布译文第二版','测试译者','published'),
    ('old-1-p1',1,3,'未审核草稿不可公开','测试译者','draft'),
    ('new-1-p1',1,1,'旧原文版本的译文不可错配','测试译者','published');
    INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ('new-1-p1',2,'新修订的原文');
    UPDATE paragraphs SET current_revision=2 WHERE id='new-1-p1';
    UPDATE books SET published=false WHERE id='new';
    GRANT USAGE ON SCHEMA public TO history_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO history_reader;`);
  await owner.query('COMMIT');
  pool = new pg.Pool({ ...config.database, database, max: 2 });
  server = createApi({ repository: createRepository(pool), allowedOrigins: ['https://lzww0608.github.io'], log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  if (owner) await owner.end();
  if (created) await admin.query(`DROP DATABASE ${database}`);
  if (admin) await admin.end();
});
test('chapter returns ordered originals and only the latest published translation', async () => {
  const response = await fetch(`${base}/api/chapters/old-1`);
  assert.equal(response.status, 200);
  const chapter = await response.json();
  assert.deepEqual(chapter.paragraphs.map(p => p.id), ['old-1-p1', 'old-1-p2']);
  assert.equal(chapter.paragraphs[0].translation.text, '已发布译文第二版');
  assert.equal(chapter.paragraphs[1].translation, null);
  assert.equal(chapter.scope, 'excerpt');
});
test('unpublished books and chapters never appear in API or search', async () => {
  assert.deepEqual((await (await fetch(`${base}/api/books`)).json()).books.map(b => b.id).sort(), ['beimeng', 'chunqiu', 'huiyao', 'kaoyi', 'old', 'quewen', 'shibu', 'tongjian']);
  assert.equal((await fetch(`${base}/api/chapters/new-1`)).status, 404);
  assert.equal((await fetch(`${base}/api/books/new/chapters`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/search?q=新修订`)).json()).results.length, 0);
});
test('a translation for an older original revision is not shown after revision', async () => {
  await owner.query("UPDATE books SET published=true WHERE id='new'");
  const chapter = await (await fetch(`${base}/api/chapters/new-1`)).json();
  assert.equal(chapter.paragraphs[0].revision, 2);
  assert.equal(chapter.paragraphs[0].translation, null);
  await owner.query("UPDATE books SET published=false WHERE id='new'");
});
test('CORS allows the website and refuses other browser origins', async () => {
  const response = await fetch(`${base}/api/books`, { headers: { Origin: 'https://lzww0608.github.io' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://lzww0608.github.io');
  const blocked = await fetch(`${base}/api/books`, { headers: { Origin: 'https://unrelated.example' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${base}/api/books`, { method: 'OPTIONS', headers: { Origin: 'https://lzww0608.github.io', 'Access-Control-Request-Method': 'GET' } })).status, 204);
});
test('HTTP writes are rejected; HEAD does not send a response body', async () => {
  assert.equal((await fetch(`${base}/api/chapters/old-1`, { method: 'POST', body: '{}' })).status, 405);
  const head = await fetch(`${base}/api/health`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('search treats SQL and LIKE metacharacters as literal text', async () => {
  for (const q of ["' OR true--", '%', '_']) {
    const response = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
    assert.equal(response.status, 200); assert.equal((await response.json()).results.length, 0);
  }
  assert.ok((await (await fetch(`${base}/api/search?q=${encodeURIComponent('朱氏')}`)).json()).results.length > 0);
});
test('API database role cannot modify stored content even when read-only setting is disabled', async () => {
  const client = await pool.connect();
  try {
    await client.query('SET default_transaction_read_only = off');
    await assert.rejects(client.query("UPDATE books SET title='modified' WHERE id='old'"), error => error.code === '42501');
    await client.query('SET default_transaction_read_only = on');
  } finally { client.release(); }
});
test('local content commands keep drafts private, publish reviewed translations and retain originals', async () => {
  const folder = mkdtempSync(join(localDir, 'content-test-'));
  const configFile = join(folder, 'config.json');
  const textFile = join(folder, 'text.txt');
  writeFileSync(configFile, JSON.stringify({ ...config, database: { ...config.database, database } }), { mode: 0o600 });
  const content = (...args) => spawnSync(process.execPath, [join(backendDir, 'scripts/content.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, HISTORY_CONFIG_FILE: configFile } });
  try {
    writeFileSync(textFile, '本机导入的测试译文');
    let result = content('translation', 'old-1-p2', textFile, '--translator', '测试译者');
    assert.equal(result.status, 0, result.stderr);
    const draft = (await owner.query("SELECT id FROM translations WHERE paragraph_id='old-1-p2' ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal((await (await fetch(`${base}/api/chapters/old-1`)).json()).paragraphs[1].translation, null);
    result = content('publish', String(draft.id)); assert.equal(result.status, 1);
    result = content('review', String(draft.id)); assert.equal(result.status, 0, result.stderr);
    result = content('publish', String(draft.id)); assert.equal(result.status, 0, result.stderr);
    assert.equal((await (await fetch(`${base}/api/chapters/old-1`)).json()).paragraphs[1].translation.text, '本机导入的测试译文');
    writeFileSync(textFile, '修订后的测试原文');
    result = content('original', 'old-1-p2', textFile); assert.equal(result.status, 0, result.stderr);
    const paragraph = (await (await fetch(`${base}/api/chapters/old-1`)).json()).paragraphs[1];
    assert.equal(paragraph.original, '修订后的测试原文'); assert.equal(paragraph.translation, null);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM paragraph_revisions WHERE paragraph_id='old-1-p2'")).rows[0].n, 2);
  } finally { rmSync(folder, { recursive: true }); }
});

test('full archived chapters are available through the read-only API', async () => {
  const chapter = await (await fetch(`${base}/api/chapters/old-v110`)).json();
  assert.equal(chapter.scope, 'full');
  assert.ok(chapter.paragraphs.length > 20);
  assert.ok(chapter.paragraphs.some(paragraph => paragraph.original.includes('郭氏')));
  assert.ok(chapter.paragraphs.every(paragraph => paragraph.translation === null));
  const directory = (await (await fetch(`${base}/api/books/tongjian/chapters`)).json()).chapters;
  assert.equal(directory.length, 29);
  assert.equal(directory[0].id, 'tongjian-v266');
  assert.equal(directory.at(-1).id, 'tongjian-v294');
});

test('repeat imports preserve local original revisions, translations and publication choices', async () => {
  await owner.query('BEGIN');
  try {
    await owner.query("INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ('old-v110-p1',2,'本机校订原文'); UPDATE paragraphs SET current_revision=2 WHERE id='old-v110-p1'; INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status) VALUES ('old-v110-p1',2,1,'本机校订译文','校订者','published')");
    await importLibrary(owner);
    const { rows } = await owner.query("SELECT p.current_revision,r.original FROM paragraphs p JOIN paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision WHERE p.id='old-v110-p1'");
    assert.deepEqual(rows[0], { current_revision: 2, original: '本机校订原文' });
    assert.equal((await owner.query("SELECT text FROM translations WHERE paragraph_id='old-v110-p1'")).rows[0].text, '本机校订译文');
    assert.equal((await owner.query("SELECT published FROM books WHERE id='new'")).rows[0].published, false);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM chapters WHERE scope='full'")).rows[0].n, 151);
  } finally { await owner.query('ROLLBACK'); }
});


test('new sources expose ordered prefaces and selected volumes through the API', async () => {
  for (const [id, count, first, last] of [['shibu',6,'shibu-v000','shibu-v005'], ['chunqiu',3,'chunqiu-v000','chunqiu-v002'], ['huiyao',31,'huiyao-v000','huiyao-v030'], ['beimeng',5,'beimeng-v000','beimeng-v020'], ['kaoyi',3,'kaoyi-v028','kaoyi-v030']]) {
    const directory = (await (await fetch(`${base}/api/books/${id}/chapters`)).json()).chapters;
    assert.equal(directory.length, count);
    assert.equal(directory[0].id, first);
    assert.equal(directory.at(-1).id, last);
    const chapter = await (await fetch(`${base}/api/chapters/${last}`)).json();
    assert.equal(chapter.bookId, id);
    assert.equal(chapter.scope, 'full');
    assert.ok(chapter.paragraphs.length > 3);
    assert.ok(chapter.paragraphs.every(p => p.translation === null));
  }
});

test('AI batch imports preserve published human versions, stay private and are idempotent', async () => {
  await owner.query('BEGIN');
  try {
    const batch = fixtureBatch('test-ai-import');
    const first = batch.entries[0];
    await owner.query(`INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status)
      VALUES ($1,1,1,'已发布的人工译文','人工译者','published')`, [first.paragraphId]);
    const originalsBefore = (await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows;
    const result = await importTranslationBatch(owner, batch);
    assert.equal(result.inserted, 76);
    const drafts = (await owner.query("SELECT * FROM translations WHERE metadata->>'batchId'=$1", [batch.id])).rows;
    assert.equal(drafts.length, 76);
    assert.ok(drafts.every(row => row.status === 'draft' && row.metadata.origin === 'ai' && row.metadata.humanReviewed === false));
    assert.equal(drafts.find(row => row.paragraph_id === first.paragraphId).version, 2);
    assert.deepEqual(drafts[0].metadata.reviewNotes, ['测试疑点，尚未人工校订。']);
    assert.deepEqual((await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows, originalsBefore);
    // Read through the same transaction to see drafts, then enforce the public repository filter.
    const chapter = await createRepository(owner).chapter('chunqiu-v000');
    assert.equal(chapter.paragraphs[0].translation.text, '已发布的人工译文');
    assert.equal(chapter.paragraphs[1].translation, null);
    await owner.query("UPDATE translations SET status='reviewed' WHERE id=$1", [result.ids[1]]);
    const again = await importTranslationBatch(owner, batch);
    assert.equal(again.inserted, 0); assert.equal(again.unchanged, 76);
    assert.equal((await owner.query('SELECT status FROM translations WHERE id=$1', [result.ids[1]])).rows[0].status, 'reviewed');
    const changed = structuredClone(batch); changed.entries[0].text = '改过的内容';
    await assert.rejects(importTranslationBatch(owner, changed), /different content/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE metadata->>'batchId'=$1", [batch.id])).rows[0].n, 76);
  } finally { await owner.query('ROLLBACK'); }
});

test('stale database originals and a late insert failure cannot leave a partial batch', async () => {
  await owner.query('BEGIN');
  try {
    const batch = fixtureBatch('test-ai-atomic');
    const id = batch.entries.at(-1).paragraphId;
    await owner.query('INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ($1,2,$2)', [id, '测试修订原文']);
    await owner.query('UPDATE paragraphs SET current_revision=2 WHERE id=$1', [id]);
    await assert.rejects(importTranslationBatch(owner, batch), /Current database original differs/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE metadata->>'batchId'=$1", [batch.id])).rows[0].n, 0);
    await owner.query('UPDATE paragraphs SET current_revision=1 WHERE id=$1', [id]);
    await owner.query(`CREATE FUNCTION test_reject_ai_translation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.paragraph_id='chunqiu-v002-p39' THEN RAISE EXCEPTION 'test late insert failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_ai_translation BEFORE INSERT ON translations FOR EACH ROW EXECUTE FUNCTION test_reject_ai_translation();`);
    await assert.rejects(importTranslationBatch(owner, batch), /test late insert failure/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM translations WHERE metadata->>'batchId'=$1", [batch.id])).rows[0].n, 0);
  } finally { await owner.query('ROLLBACK'); }
});

test('an explicit AI release is public without pretending human review and cannot replace a human translation', async () => {
  await owner.query('BEGIN');
  try {
    const batch = fixtureBatch('test-ai-release');
    await importTranslationBatch(owner,batch);
    assert.equal((await publishAiBatch(owner,batch)).released,76);
    const translated = (await createRepository(owner).chapter('chunqiu-v001')).paragraphs;
    assert.ok(translated.every(p=>p.translation.origin==='ai' && p.translation.reviewStatus==='pending'));
    assert.deepEqual(translated[0].translation.reviewNotes,['测试疑点，尚未人工校订。']);
    const metadata=(await owner.query("SELECT metadata FROM translations WHERE metadata->>'batchId'=$1 LIMIT 1",[batch.id])).rows[0].metadata;
    assert.equal(metadata.humanReviewed,false);assert.equal(metadata.publication.humanReviewed,false);
    assert.equal((await publishAiBatch(owner,batch)).released,0);
    await owner.query(`INSERT INTO translations (paragraph_id,original_revision,language,version,text,translator,status)
      VALUES ($1,1,'zh-Hans',2,'人工修订','校订者','published')`,[batch.entries[0].paragraphId]);
    await assert.rejects(publishAiBatch(owner,batch),/must not be replaced/);
    assert.equal((await createRepository(owner).chapter('chunqiu-v000')).paragraphs[0].translation.text,'人工修订');
  } finally { await owner.query('ROLLBACK'); }
});
