import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { importLibrary } from '../scripts/import-library.mjs';
import { importSentenceTranslationBatch, validateSentenceTranslationBatch } from '../scripts/import-sentence-translations.mjs';
import { createRepository } from '../src/repository.mjs';
import { createApi } from '../src/http.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { sentenceTextHash } from '../../content/sentence-translations.mjs';
import { splitPeriodSpans } from '../../frontend/src/sentence-alignment.ts';

const config = loadConfig(), nonce = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_sentences_test_${nonce}`, reader = `history_sentences_reader_${nonce}`, editor = `history_sentences_editor_${nonce}`;
const password = randomBytes(32).toString('hex');
let admin, owner, pool, server, base, batch, fixtureChapters, created = false, readerCreated = false, editorCreated = false;
before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' }); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  for (const role of [reader, editor]) {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    if (role === reader) readerCreated = true; else editorCreated = true;
  }
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
  await owner.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
  await owner.query(readFileSync(new URL('../db/005-sentence-translations.sql', import.meta.url), 'utf8'));
  await importLibrary(owner);
  fixtureChapters = loadPublishedChapters(loadLibrary());
  const paragraph = fixtureChapters.find(c => c.id === 'new-v06').paragraphs.find(p => p.id === 'new-v06-p16');
  const result = await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
    VALUES ($1,1,1,$2,'测试译者','published','{"origin":"ai","humanReviewed":false}') RETURNING id`, [paragraph.id, paragraph.translation.text]);
  paragraph.translation.id = String(result.rows[0].id);
  const units = splitPeriodSpans(paragraph.original);
  batch = { schemaVersion: 1, id: 'sentence-test-batch', entries: units.slice(0,2).map((unit,i) => ({
    id: `sentence-test-${i+1}`, chapterId: 'new-v06', paragraphId: paragraph.id, originalRevision: paragraph.revision,
    originalSha256: sentenceTextHash(paragraph.original), originalStart: unit.start, originalEnd: unit.end,
    parentTranslationId: paragraph.translation.id, parentTranslationVersion: paragraph.translation.version,
    parentTranslationSha256: sentenceTextHash(paragraph.translation.text), version: 1, text: i ? '庚辰，达靼派列六薛娘居前来。' : '二年春正月戊辰，党项派折扎移前来。',
    origin: 'ai', humanReviewed: false, notes: ['真实版本绑定的测试补译'] })) };
  for (const entry of batch.entries) entry.textSha256=sentenceTextHash(entry.text);
  await owner.query(`GRANT CONNECT ON DATABASE ${database} TO ${reader},${editor};
    GRANT USAGE ON SCHEMA public TO ${reader},${editor}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${reader};`);
  await owner.query('COMMIT');
  pool = new pg.Pool({ ...config.database, database, user: reader, password, max: 2 });
  server = createApi({ repository: createRepository(pool), allowedOrigins: ['https://lzww0608.github.io'], log: () => {} });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (pool) await pool.end(); if (owner) await owner.end();
  assert.match(database,/^history_sentences_test_[0-9]+_[a-f0-9]{10}$/);
  if (created) await admin.query(`DROP DATABASE ${database}`);
  if (readerCreated) await admin.query(`DROP ROLE ${reader}`); if (editorCreated) await admin.query(`DROP ROLE ${editor}`);
  if (admin) await admin.end();
});

test('private drafts stay hidden; explicit publication is idempotent and leaves originals/full versions unchanged', async () => {
  const before = await owner.query('SELECT to_jsonb(t) AS row FROM translations t ORDER BY id');
  await owner.query('BEGIN');
  const imported = await importSentenceTranslationBatch(owner,batch,{chapters:fixtureChapters}); await owner.query('COMMIT');
  assert.equal(imported.inserted,2);
  assert.deepEqual((await (await fetch(`${base}/api/chapters/new-v06/sentence-translations`)).json()).entries,[]);
  await owner.query('BEGIN'); await importSentenceTranslationBatch(owner,batch,{publish:true,chapters:fixtureChapters}); await owner.query('COMMIT');
  const document = await (await fetch(`${base}/api/chapters/new-v06/sentence-translations`)).json();
  assert.equal(document.status,'published'); assert.equal(document.entries.length,2); assert.equal(document.entries[1].text,batch.entries[1].text);
  assert.ok(document.entries.every(entry=>entry.origin==='ai'&&entry.humanReviewed===false));
  assert.deepEqual(document.entries[1].reviewNotes,batch.entries[1].notes);
  await owner.query('BEGIN'); const repeated=await importSentenceTranslationBatch(owner,batch,{publish:true,chapters:fixtureChapters}); await owner.query('COMMIT');
  assert.equal(repeated.inserted,0); assert.equal(repeated.published,0); assert.equal(repeated.unchanged,2);
  assert.deepEqual((await owner.query('SELECT to_jsonb(t) AS row FROM translations t ORDER BY id')).rows,before.rows);
});
test('a newer full translation, changed original or unpublished chapter suspends old sentence records', async () => {
  await owner.query('BEGIN');
  try {
    await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status) VALUES ('new-v06-p16',1,2,'新的全文版本','所有者','published')`);
    assert.deepEqual((await createRepository(owner).sentenceTranslations('new-v06')).entries,[]);
    await assert.rejects(importSentenceTranslationBatch(owner,{...batch,id:'late-unit-batch'},{publish:true,chapters:fixtureChapters}),/changed/);
    await owner.query(`DELETE FROM translations WHERE paragraph_id='new-v06-p16' AND version=2;
      INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES ('new-v06-p16',2,'新的原文');
      UPDATE paragraphs SET current_revision=2 WHERE id='new-v06-p16'`);
    assert.deepEqual((await createRepository(owner).sentenceTranslations('new-v06')).entries,[]);
    await owner.query("UPDATE chapters SET published=false WHERE id='new-v06'");
    assert.equal(await createRepository(owner).sentenceTranslations('new-v06'),null);
  } finally { await owner.query('ROLLBACK'); }
});
test('stale ranges, false review and reused IDs with new bodies are rejected without partial writes', async () => {
  const bad=structuredClone(batch); bad.entries[0].originalEnd--;
  assert.throws(()=>validateSentenceTranslationBatch(bad,fixtureChapters),/binding/);
  const falseReview=structuredClone(batch); falseReview.entries[0].humanReviewed=true;
  assert.throws(()=>validateSentenceTranslationBatch(falseReview,fixtureChapters),/provenance/);
  for (const notes of [Array(21).fill('提示'),['𠮷'.repeat(2001)]]) {
    const oversized=structuredClone(batch);oversized.entries[0].notes=notes;
    assert.throws(()=>validateSentenceTranslationBatch(oversized,fixtureChapters),/provenance/);
  }
  await owner.query('BEGIN');
  try {
    const changed=structuredClone(batch); changed.entries[0].text='不同的正文'; changed.entries[0].textSha256=sentenceTextHash(changed.entries[0].text);
    await assert.rejects(importSentenceTranslationBatch(owner,changed,{publish:true,chapters:fixtureChapters}),/differs/);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM sentence_translations')).rows[0].n,2);
  } finally { await owner.query('ROLLBACK'); }
});
test('public GET/HEAD cannot write, reader is read-only and editor has no supplement-table permissions', async () => {
  assert.equal((await fetch(`${base}/api/chapters/new-v06/sentence-translations`,{method:'POST'})).status,405);
  assert.equal((await fetch(`${base}/api/chapters/new-v06/sentence-translations`,{headers:{Origin:'https://other.example'}})).status,403);
  const head=await fetch(`${base}/api/chapters/new-v06/sentence-translations`,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),'');
  await assert.rejects(pool.query("DELETE FROM sentence_translations"),error=>error.code==='42501');
  for (const permission of ['SELECT','INSERT','UPDATE','DELETE']) {
    assert.equal((await owner.query("SELECT has_table_privilege($1,'public.sentence_translations',$2) AS allowed",[editor,permission])).rows[0].allowed,false);
  }
});
test('a late supplement insert failure rolls back the entire independent batch', async () => {
  await owner.query('BEGIN');
  try {
    await owner.query(`CREATE FUNCTION public.fail_test_sentence() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='sentence-rollback-second' THEN RAISE EXCEPTION 'test insert failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_test_sentence BEFORE INSERT ON sentence_translations FOR EACH ROW EXECUTE FUNCTION public.fail_test_sentence()`);
    const failed=structuredClone(batch); failed.id='rollback-unit-batch';
    failed.entries.forEach((entry,index)=>{entry.id=index?'sentence-rollback-second':'sentence-rollback-first';entry.version=2;});
    await assert.rejects(importSentenceTranslationBatch(owner,failed,{publish:true,chapters:fixtureChapters}),/test insert failure/);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM sentence_translations WHERE id LIKE 'sentence-rollback-%'")).rows[0].n,0);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM sentence_translations')).rows[0].n,2);
  } finally { await owner.query('ROLLBACK'); }
});
