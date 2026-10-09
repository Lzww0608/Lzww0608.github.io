import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { importLibrary } from '../scripts/import-library.mjs';
import { seed } from '../scripts/seed.mjs';
import { importPersonPassages, ensurePersonPassageSchema, PersonPassageSourceMismatchError } from '../scripts/import-person-passages.mjs';
import { createRepository } from '../src/repository.mjs';
import { createApi } from '../src/http.mjs';

const config = loadConfig();
const suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_passages_test_${suffix}`;
const readerRole = `history_passages_reader_${suffix}`, editorRole = `history_passages_editor_${suffix}`;
const password = randomBytes(32).toString('hex');
const library = loadLibrary();
const people = loadPassagePeople();
const canonical = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, { ...paragraph, chapterId: chapter.id }])));
const resultSetRevision = ids => createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
const span = id => ({ paragraphId: id, originalRevision: 1,
  originalSha256: createHash('sha256').update(canonical.get(id).original).digest('hex'), start: 0, end: [...canonical.get(id).original].length });
const passage = (id, kind, extra = [], moreIds = []) => ({ id: `passage-${id}`, title: '人物史载片段',
  chapterId: canonical.get(id).chapterId, spans: [id, ...moreIds].map(span),
  people: [{ personId: 'zhu-wen', kind }, ...extra.map(personId => ({ personId, kind: 'mention' }))] });
const fixture = { schemaVersion: 1, scope: 'current-archive', coverage: { bookCount: library.catalog.books.length,
  chapterCount: library.chapters.length, paragraphCount: canonical.size }, people,
passages: [passage('old-v001-p3', 'biography', ['li-cunxu']), passage('new-v01-p3', 'record', [], ['new-v01-p4']),
  { ...passage('old-v110-p22', 'record'), people: [{ personId: 'guo-wei', kind: 'record' }] },
  passage('old-v002-p2', 'record'), passage('old-v001-p2', 'record'), passage('new-v01-p2', 'mention', ['li-cunxu'])] };
let admin, owner, readerPool, editorPool, server, base, createdDatabase = false, createdReader = false, createdEditor = false;

before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); createdDatabase = true;
  await admin.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); createdReader = true;
  await admin.query(`CREATE ROLE ${editorRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); createdEditor = true;
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  try {
    await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
    await owner.query(readFileSync(new URL('../db/002-translation-metadata.sql', import.meta.url), 'utf8'));
    await owner.query(readFileSync(new URL('../db/003-translation-editor.sql', import.meta.url), 'utf8'));
    await importLibrary(owner, library);
    await importPersonPassages(owner, fixture, library);
    await owner.query(`UPDATE chapters SET published=false WHERE id='old-v002';
      INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata) VALUES
      ('new-v01-p2',1,1,'已发布第一版','旧译者','published','{}'),
      ('new-v01-p2',1,2,'最新公开译文','校订者','published','{"origin":"human","reviewStatus":"owner-edited","reviewNotes":["保留疑点"]}'),
      ('new-v01-p2',1,3,'私有草稿不能公开','草稿者','draft','{}');
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${readerRole}, ${editorRole};
      GRANT USAGE ON SCHEMA public TO ${readerRole}, ${editorRole};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readerRole};
      GRANT EXECUTE ON FUNCTION public.revise_published_translation(text,integer,bigint,text,text,jsonb) TO ${editorRole};`);
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  readerPool = new pg.Pool({ ...config.database, database, user: readerRole, password, max: 2 });
  editorPool = new pg.Pool({ ...config.database, database, user: editorRole, password, max: 2 });
  server = createApi({ repository: createRepository(readerPool), allowedOrigins: ['https://lzww0608.github.io'], log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (readerPool) await readerPool.end(); if (editorPool) await editorPool.end();
  if (owner) await owner.end();
  assert.match(database, /^history_passages_test_[0-9]+_[a-f0-9]{10}$/);
  if (createdDatabase) await admin.query(`DROP DATABASE ${database}`);
  if (createdReader) await admin.query(`DROP ROLE ${readerRole}`);
  if (createdEditor) await admin.query(`DROP ROLE ${editorRole}`);
  if (admin) await admin.end();
});

test('person API has stable cross-book pagination and exposes current published translations only', async () => {
  const first = await fetch(`${base}/api/people/zhu-wen/passages?limit=1`);
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.equal(page.schemaVersion, 1); assert.equal(page.scope, 'current-archive');
  assert.deepEqual(page.coverage, fixture.coverage);
  assert.equal(page.personId, 'zhu-wen'); assert.equal(page.bookId, null);
  assert.equal(page.total, 4); assert.equal(page.unavailableCount, 0); assert.equal(page.nextCursor, '1');
  assert.equal(page.resultSetRevision, resultSetRevision(['passage-new-v01-p2', 'passage-new-v01-p3', 'passage-old-v001-p2', 'passage-old-v001-p3']));
  assert.equal(page.items[0].id, 'passage-new-v01-p2'); assert.equal(page.items[0].kind, 'mention');
  assert.equal(page.items[0].bookTitle, '新五代史'); assert.equal(page.items[0].chapterPosition, 1);
  const paragraph = page.items[0].paragraphs[0];
  assert.equal(paragraph.original, canonical.get(paragraph.id).original);
  assert.equal(paragraph.translation.text, '最新公开译文'); assert.equal(paragraph.translation.version, 2);
  assert.equal(paragraph.translation.reviewStatus, 'owner-edited'); assert.deepEqual(paragraph.translation.reviewNotes, ['保留疑点']);
  assert.equal(JSON.stringify(page).includes('私有草稿'), false);
  const rest = await (await fetch(`${base}/api/people/zhu-wen/passages?limit=100&cursor=1`)).json();
  assert.deepEqual(rest.items.map(item => item.id), ['passage-new-v01-p3', 'passage-old-v001-p2', 'passage-old-v001-p3']);
  assert.equal(rest.nextCursor, null);
  assert.equal(rest.resultSetRevision, page.resultSetRevision);
  assert.deepEqual(rest.items[0].paragraphs.map(item => item.id), ['new-v01-p3', 'new-v01-p4']);
  const byBook = await (await fetch(`${base}/api/people/zhu-wen/passages?bookId=old`)).json();
  assert.equal(byBook.bookId, 'old'); assert.equal(byBook.total, 2);
  assert.equal(byBook.resultSetRevision, resultSetRevision(['passage-old-v001-p2', 'passage-old-v001-p3']));
  assert.ok(byBook.items.every(item => item.bookId === 'old'));
  assert.equal((await (await fetch(`${base}/api/people/zhu-wen/passages?cursor=999`)).json()).items.length, 0);
});

test('single passage is shared by people and matches the complete chapter paragraph model', async () => {
  const response = await fetch(`${base}/api/passages/passage-new-v01-p2`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.schemaVersion, 1); assert.equal('kind' in result.passage, false);
  assert.deepEqual(result.passage.people, [{ personId: 'li-cunxu', kind: 'mention' }, { personId: 'zhu-wen', kind: 'mention' }]);
  assert.deepEqual(result.passage.spans, fixture.passages.at(-1).spans);
  const chapter = await (await fetch(`${base}/api/chapters/new-v01`)).json();
  assert.deepEqual(result.passage.paragraphs[0], chapter.paragraphs.find(paragraph => paragraph.id === 'new-v01-p2'));
  const secondPerson = await (await fetch(`${base}/api/people/li-cunxu/passages`)).json();
  assert.deepEqual(secondPerson.items.map(item => item.id), ['passage-new-v01-p2', 'passage-old-v001-p3']);
});

test('span offsets count supplementary Chinese characters as single Unicode characters', async () => {
  const result = await (await fetch(`${base}/api/passages/passage-old-v110-p22`)).json();
  const paragraph = result.passage.paragraphs[0], range = result.passage.spans[0];
  assert.ok(paragraph.original.length > [...paragraph.original].length);
  assert.equal(range.end, [...paragraph.original].length);
  assert.equal([...paragraph.original].slice(range.start, range.end).join(''), paragraph.original);
});

test('unknown entities return 404, invalid pagination returns 400, and unpublished chapters remain private', async () => {
  for (const path of ['/api/people/unknown/passages', '/api/people/zhu-wen/passages?bookId=unknown',
    '/api/passages/passage-missing', '/api/passages/passage-old-v002-p2']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  for (const query of ['limit=0', 'limit=101', 'cursor=-1', 'cursor=NaN', 'bookId=', 'cursor=1&cursor=2']) {
    assert.equal((await fetch(`${base}/api/people/zhu-wen/passages?${query}`)).status, 400, query);
  }
  assert.equal((await fetch(`${base}/api/people/zhu-wen/passages`, { method: 'POST' })).status, 405);
  const head = await fetch(`${base}/api/passages/passage-new-v01-p2`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const empty = await (await fetch(`${base}/api/people/chai-zongxun/passages`)).json();
  assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
  assert.equal(empty.resultSetRevision, resultSetRevision([]));
});

test('revision or source-hash changes suspend every span in a passage without reusing old translations', async () => {
  await owner.query('BEGIN');
  try {
    const repository = createRepository(owner);
    const initial = await repository.personPassages('zhu-wen');
    await owner.query(`INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES('new-v01-p2',2,'本机修订原文');
      UPDATE paragraphs SET current_revision=2 WHERE id='new-v01-p2'`);
    let result = await repository.personPassages('zhu-wen');
    assert.equal(result.total, 3); assert.equal(result.unavailableCount, 1);
    assert.notEqual(result.resultSetRevision, initial.resultSetRevision);
    assert.equal(result.resultSetRevision, resultSetRevision(['passage-new-v01-p3', 'passage-old-v001-p2', 'passage-old-v001-p3']));
    assert.equal(await repository.passage('passage-new-v01-p2'), null);
    assert.equal((await repository.chapter('new-v01')).paragraphs[1].translation, null);
    await owner.query("UPDATE paragraph_revisions SET original=original || '底本变化' WHERE paragraph_id='new-v01-p4' AND revision=1");
    result = await repository.personPassages('zhu-wen');
    assert.equal(result.total, 2); assert.equal(result.unavailableCount, 2);
    assert.equal(result.resultSetRevision, resultSetRevision(['passage-old-v001-p2', 'passage-old-v001-p3']));
    assert.equal(await repository.passage('passage-new-v01-p3'), null);
    const oldOnly = await repository.personPassages('zhu-wen', { bookId: 'old', limit: 1, cursor: 0 });
    assert.equal(oldOnly.total, 2); assert.equal(oldOnly.unavailableCount, 0); assert.equal(oldOnly.nextCursor, '1');
    assert.equal(oldOnly.resultSetRevision, result.resultSetRevision);
    await owner.query("UPDATE books SET published=false WHERE id='new'");
    assert.equal(await repository.personPassages('zhu-wen', { bookId: 'new' }), null);
    result = await repository.personPassages('zhu-wen');
    assert.equal(result.total, 2); assert.equal(result.unavailableCount, 0);
    assert.equal(result.resultSetRevision, oldOnly.resultSetRevision);
    await owner.query("DELETE FROM person_passages WHERE person_id='zhu-wen' AND passage_id='passage-old-v001-p2'");
    result = await repository.personPassages('zhu-wen');
    assert.notEqual(result.resultSetRevision, oldOnly.resultSetRevision);
    assert.equal(result.resultSetRevision, resultSetRevision(['passage-old-v001-p3']));
  } finally { await owner.query('ROLLBACK'); }
});

test('index import is idempotent and leaves all canonical and translation rows intact', async () => {
  await owner.query('BEGIN');
  try {
    const originalsBefore = (await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows;
    const paragraphsBefore = (await owner.query('SELECT * FROM paragraphs ORDER BY id')).rows;
    const translationsBefore = (await owner.query('SELECT * FROM translations ORDER BY id')).rows;
    const result = await importPersonPassages(owner, fixture, library);
    assert.equal(result.imported, 0); assert.equal(result.unchanged, 6); assert.equal(result.associations, 8);
    assert.deepEqual((await owner.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows, originalsBefore);
    assert.deepEqual((await owner.query('SELECT * FROM paragraphs ORDER BY id')).rows, paragraphsBefore);
    assert.deepEqual((await owner.query('SELECT * FROM translations ORDER BY id')).rows, translationsBefore);
    const invalid = structuredClone(fixture); invalid.passages[0].spans[0].originalSha256 = '0'.repeat(64);
    await assert.rejects(importPersonPassages(owner, invalid, library), /Invalid|invalid|checksum|version|hash|SHA/);
  } finally { await owner.query('ROLLBACK'); }
});

test('whole-archive validation rejects stale unrelated originals before any index changes', async () => {
  await owner.query('BEGIN');
  try {
    const before = (await owner.query('SELECT * FROM person_passages ORDER BY person_id,passage_id')).rows;
    await owner.query("UPDATE paragraph_revisions SET original=original || '变化' WHERE paragraph_id='tongjian-v294-p2' AND revision=1");
    await assert.rejects(importPersonPassages(owner, fixture, library), PersonPassageSourceMismatchError);
    assert.deepEqual((await owner.query('SELECT * FROM person_passages ORDER BY person_id,passage_id')).rows, before);
  } finally { await owner.query('ROLLBACK'); }
});

test('late insert failures roll back the full index synchronization', async () => {
  await owner.query('BEGIN');
  try {
    const before = (await owner.query('SELECT * FROM passage_spans ORDER BY passage_id,position')).rows;
    await owner.query(`CREATE FUNCTION public.test_reject_passage_span() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.paragraph_id='old-v001-p3' THEN RAISE EXCEPTION 'test late passage failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_passage_span BEFORE INSERT ON public.passage_spans FOR EACH ROW EXECUTE FUNCTION public.test_reject_passage_span();`);
    const changed = structuredClone(fixture); changed.passages[0].title = '修改展示题名';
    await assert.rejects(importPersonPassages(owner, changed, library), /test late passage failure/);
    assert.deepEqual((await owner.query('SELECT * FROM passage_spans ORDER BY passage_id,position')).rows, before);
    assert.equal((await owner.query('SELECT title FROM passages WHERE id=$1', [changed.passages[0].id])).rows[0].title, fixture.passages[0].title);
  } finally { await owner.query('ROLLBACK'); }
});

test('seed preserves revised originals and skips first-index initialization on a changed existing database', async () => {
  await owner.query('BEGIN');
  try {
    await owner.query(`DELETE FROM person_passages; DELETE FROM passage_spans; DELETE FROM passages; DELETE FROM person_passage_index;
      INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES('old-v001-p2',2,'既有本机修订不得覆盖');
      UPDATE paragraphs SET current_revision=2 WHERE id='old-v001-p2'`);
    await seed(owner);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM passages')).rows[0].n, 0);
    assert.equal((await owner.query("SELECT current_revision FROM paragraphs WHERE id='old-v001-p2'")).rows[0].current_revision, 2);
    assert.equal((await owner.query("SELECT original FROM paragraph_revisions WHERE paragraph_id='old-v001-p2' AND revision=2")).rows[0].original, '既有本机修订不得覆盖');
  } finally { await owner.query('ROLLBACK'); }
});

test('public reader is read-only and editor receives no direct passage-table permissions', async () => {
  await owner.query('BEGIN');
  try { await ensurePersonPassageSchema(owner); }
  finally { await owner.query('ROLLBACK'); }
  for (const table of ['person_passage_index', 'passage_people', 'passages', 'passage_spans', 'person_passages']) {
    assert.ok((await readerPool.query(`SELECT * FROM public.${table} LIMIT 1`)).rowCount);
    await assert.rejects(readerPool.query(`DELETE FROM public.${table} WHERE false`), error => error.code === '42501');
    await assert.rejects(editorPool.query(`SELECT * FROM public.${table} LIMIT 1`), error => error.code === '42501');
    await assert.rejects(editorPool.query(`DELETE FROM public.${table} WHERE false`), error => error.code === '42501');
    const privilege = (await owner.query(`SELECT has_table_privilege('history_reader',$1,'SELECT') AS can_read,
      has_table_privilege('history_reader',$1,'INSERT,UPDATE,DELETE') AS can_write`, [`public.${table}`])).rows[0];
    assert.equal(privilege.can_read, true); assert.equal(privilege.can_write, false);
  }
});
