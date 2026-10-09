import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { createPersonPassagesRepository, parsePersonPassagePagination } from '../src/person-passages.mjs';
import { createApi } from '../src/http.mjs';

const config = loadConfig();
const suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_passage_search_test_${suffix}`;
const readerRole = `history_search_reader_${suffix}`;
const password = randomBytes(32).toString('hex');
const hash = text => createHash('sha256').update(text).digest('hex');
const hazardousLiteral = "%' OR 1=1 -- <script>alert(1)</script>_";
const fixtures = [
  ...Array.from({ length: 70 }, (_, index) => ({ id: `old-v999-p${index + 1}`, chapterId: 'old-v999',
    position: index + 1, original: `第 ${index + 1} 段普通史事。`, translation: `第 ${index + 1} 段的普通译文。` })),
  { id: 'old-v999-p71', chapterId: 'old-v999', position: 71, original: '𠀀潞州軍將李存勖。潞州攻守。', translation: '在潞州统军，驻守上党。' },
  { id: 'old-v999-p72', chapterId: 'old-v999', position: 72, original: '只見原文史事。', translation: '仅译文说及柳营测试词。' },
  { id: 'old-v999-p73', chapterId: 'old-v999', position: 73, original: hazardousLiteral, translation: `原句包含 ${hazardousLiteral}` },
  { id: 'old-v999-p74', chapterId: 'old-v999', position: 74, original: '天下稱帝。', translation: '天下称帝。' },
  { id: 'old-v999-p75', chapterId: 'old-v999', position: 75, original: '乾祐年，見衞州軍。', translation: '乾祐年，他见到卫州军队。' },
  { id: 'new-v999-p1', chapterId: 'new-v999', position: 1, original: '潞州城下。', translation: '记载上党城下之事。' },
  { id: 'new-v999-p2', chapterId: 'new-v999', position: 2, original: '其他記載。', translation: '另外一段记载。' },
];
let admin, owner, readerPool, repository, server, base, createdDatabase = false, createdReader = false;

before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' }); await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); createdDatabase = true;
  await admin.query(`CREATE ROLE ${readerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); createdReader = true;
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  try {
    for (const file of ['001-initial.sql', '002-translation-metadata.sql', '004-person-passages.sql']) {
      await owner.query(readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    }
    await owner.query(`INSERT INTO books(id,title,author,description,source_url,published)
      VALUES('old','旧史测试','作者','测试','https://example.org/old',true),('new','新史测试','作者','测试','https://example.org/new',true);
      INSERT INTO editions(id,book_id,label,source_note) VALUES('old-test','old','测试版','测试'),('new-test','new','测试版','测试');
      INSERT INTO chapters(id,edition_id,position,title,source_url,scope,published)
      VALUES('old-v999','old-test',1,'测试旧史','https://example.org/old/999','full',true),
        ('new-v999','new-test',1,'测试新史','https://example.org/new/999','full',true);
      INSERT INTO passage_people(id,name) VALUES('search-person','检索人物'),('empty-person','无记载人物');
      INSERT INTO person_passage_index(id,schema_version,scope,book_count,chapter_count,paragraph_count,digest)
      VALUES(true,1,'current-archive',2,2,77,repeat('0',64));`);
    for (const paragraph of fixtures) {
      await owner.query('INSERT INTO paragraphs(id,chapter_id,position,current_revision) VALUES($1,$2,$3,1)',
        [paragraph.id, paragraph.chapterId, paragraph.position]);
      await owner.query('INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES($1,1,$2)', [paragraph.id, paragraph.original]);
      await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status,metadata)
        VALUES($1,1,1,$2,'署名专属检索词','published','{"reviewNotes":["疑点专属检索词"]}')`, [paragraph.id, paragraph.translation]);
      await owner.query('INSERT INTO passages(id,chapter_id,title) VALUES($1,$2,$3)', [`passage-${paragraph.id}`, paragraph.chapterId, '检索测试片段']);
      await owner.query(`INSERT INTO passage_spans(passage_id,position,paragraph_id,original_revision,original_sha256,start_offset,end_offset)
        VALUES($1,1,$2,1,$3,0,$4)`, [`passage-${paragraph.id}`, paragraph.id, hash(paragraph.original), [...paragraph.original].length]);
      await owner.query("INSERT INTO person_passages(person_id,passage_id,kind) VALUES('search-person',$1,'record')", [`passage-${paragraph.id}`]);
    }
    await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status)
      VALUES('old-v999-p71',1,2,'在潞州统军，驻守上党。版本专属词。','测试译者','published'),
        ('old-v999-p71',1,3,'草稿专属检索词','草稿译者','draft');
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${readerRole};
      GRANT USAGE ON SCHEMA public TO ${readerRole};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${readerRole};`);
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  readerPool = new pg.Pool({ ...config.database, database, user: readerRole, password, max: 2 });
  repository = createPersonPassagesRepository(readerPool);
  server = createApi({ repository, allowedOrigins: ['https://lzww0608.github.io'], log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (readerPool) await readerPool.end(); if (owner) await owner.end();
  assert.match(database, /^history_passage_search_test_[0-9]+_[a-f0-9]{10}$/);
  if (createdDatabase) await admin.query(`DROP DATABASE ${database}`);
  if (createdReader) await admin.query(`DROP ROLE ${readerRole}`);
  if (admin) await admin.end();
});
const request = async params => {
  const response = await fetch(`${base}/api/people/search-person/passages?${new URLSearchParams(params)}`);
  assert.equal(response.status, 200); return response.json();
};
const sliced = (text, ranges) => ranges.map(range => [...text].slice(range.start, range.end).join(''));

test('search filters the whole person collection before counting and pagination, with book filtering', async () => {
  const normal = await request({ limit: '50' });
  assert.equal(normal.total, 77); assert.equal(normal.items.length, 50);
  assert.equal(normal.items.some(item => item.id === 'passage-old-v999-p71'), false);
  assert.equal('search' in normal, false); assert.ok(normal.items.every(item => !('searchMatches' in item)));
  const first = await request({ q: '  潞州  ', limit: '1' });
  assert.deepEqual(first.search, { query: '潞州', normalizedQuery: '潞州', field: 'both' });
  assert.equal(first.total, 2); assert.equal(first.nextCursor, '1'); assert.equal(first.items[0].bookId, 'new');
  const last = await request({ q: '潞州', limit: '1', cursor: '1' });
  assert.equal(last.items[0].id, 'passage-old-v999-p71'); assert.equal(last.nextCursor, null);
  assert.equal(last.resultSetRevision, first.resultSetRevision);
  const byBook = await request({ q: '潞州', bookId: 'old', limit: '1' });
  assert.equal(byBook.total, 1); assert.equal(byBook.items[0].id, last.items[0].id);
  assert.notEqual(byBook.resultSetRevision, first.resultSetRevision);
});

test('traditional and simplified queries produce Unicode ranges in original and published translation text', async () => {
  for (const q of ['军', '軍']) {
    const result = await request({ q, bookId: 'old' });
    assert.equal(result.total, 2);
    for (const item of result.items) {
      const paragraph = item.paragraphs[0], match = item.searchMatches[0];
      assert.equal(match.paragraphId, paragraph.id);
      assert.deepEqual(sliced(paragraph.original, match.original), ['軍']);
      assert.deepEqual(sliced(paragraph.translation.text, match.translation), ['军']);
    }
  }
  const result = await request({ q: '潞州', bookId: 'old' });
  const paragraph = result.items[0].paragraphs[0], match = result.items[0].searchMatches[0];
  assert.deepEqual(match.original, [{ start: 1, end: 3 }, { start: 9, end: 11 }]);
  assert.deepEqual(sliced(paragraph.original, match.original), ['潞州', '潞州']);
  const variants = await request({ q: '卫州', field: 'original' });
  assert.equal(variants.total, 1); assert.deepEqual(sliced(variants.items[0].paragraphs[0].original, variants.items[0].searchMatches[0].original), ['衞州']);
});

test('field selection searches only the intended body, excludes drafts, translator names and review notes', async () => {
  const onlyTranslation = await request({ q: '柳营测试词', field: 'translation' });
  assert.equal(onlyTranslation.total, 1); assert.deepEqual(onlyTranslation.items[0].searchMatches[0].original, []);
  assert.deepEqual(sliced(onlyTranslation.items[0].paragraphs[0].translation.text, onlyTranslation.items[0].searchMatches[0].translation), ['柳营测试词']);
  assert.equal((await request({ q: '柳营测试词', field: 'original' })).total, 0);
  for (const q of ['署名专属检索词', '疑点专属检索词', '草稿专属检索词']) assert.equal((await request({ q })).total, 0);
  assert.equal((await request({ q: '版本专属词', field: 'translation' })).total, 1);
  const original = await request({ q: '潞州', field: 'original' });
  assert.ok(original.items.every(item => item.searchMatches.every(match => match.translation.length === 0)));
});

test('SQL, wildcard and markup characters are literal search content, and routes stay read-only', async () => {
  const result = await request({ q: hazardousLiteral });
  assert.equal(result.total, 1); assert.equal(result.items[0].id, 'passage-old-v999-p73');
  assert.deepEqual(sliced(result.items[0].paragraphs[0].original, result.items[0].searchMatches[0].original), [hazardousLiteral]);
  assert.equal((await request({ q: "%' OR 1=1 -- unrelated" })).total, 0);
  const path = `${base}/api/people/search-person/passages?q=${encodeURIComponent('潞州')}`;
  const allowed = await fetch(path, { headers: { Origin: 'https://lzww0608.github.io' } });
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://lzww0608.github.io');
  assert.equal(allowed.headers.get('Cache-Control'), 'no-store');
  assert.equal((await fetch(path, { method: 'POST' })).status, 405);
  const head = await fetch(path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  await assert.rejects(readerPool.query('UPDATE public.translations SET text=text WHERE false'), error => error.code === '42501');
});

test('invalid query and field parameters reject duplicate, blank and overlong Unicode input', async () => {
  for (const query of ['q=', 'q=%20%20', 'q=1&q=2', 'field=original&field=translation', 'field=invalid', 'field=', 'q=test%00query',
    `q=${encodeURIComponent('𠀀'.repeat(101))}`]) {
    assert.equal((await fetch(`${base}/api/people/search-person/passages?${query}`)).status, 400, query);
  }
  assert.equal(parsePersonPassagePagination(new URLSearchParams({ q: '𠀀'.repeat(100) })).q.length, 200);
  assert.equal((await fetch(`${base}/api/people/unknown/passages?q=潞州`)).status, 404);
  assert.equal((await fetch(`${base}/api/people/search-person/passages?q=潞州&bookId=unknown`)).status, 404);
});

test('query, field and actual published versions bind the revision; paused originals and unpublished sources are excluded', async () => {
  await owner.query('BEGIN');
  try {
    const ownRepository = createPersonPassagesRepository(owner);
    const initial = await ownRepository.personPassages('search-person', { q: '潞州', field: 'both' });
    const otherQuery = await ownRepository.personPassages('search-person', { q: '軍', field: 'both' });
    const otherScriptQuery = await ownRepository.personPassages('search-person', { q: '军', field: 'both' });
    assert.notEqual(otherQuery.resultSetRevision, otherScriptQuery.resultSetRevision);
    assert.notEqual(initial.resultSetRevision, (await ownRepository.personPassages('search-person', { q: '潞州', field: 'original' })).resultSetRevision);
    await owner.query(`INSERT INTO translations(paragraph_id,original_revision,version,text,translator,status)
      VALUES('old-v999-p71',1,4,'潞州的新校订译文。','校订者','published')`);
    const updated = await ownRepository.personPassages('search-person', { q: '潞州' });
    assert.equal(updated.total, 2); assert.notEqual(updated.resultSetRevision, initial.resultSetRevision);
    assert.equal(updated.items.find(item => item.bookId === 'old').paragraphs[0].translation.version, 4);
    await owner.query("UPDATE translations SET status='draft' WHERE paragraph_id='old-v999-p71'");
    const translationPaused = await ownRepository.personPassages('search-person', { q: '潞州', field: 'translation' });
    assert.equal(translationPaused.total, 0);
    const originalStillVisible = await ownRepository.personPassages('search-person', { q: '潞州', field: 'original' });
    assert.equal(originalStillVisible.total, 2);
    assert.equal(originalStillVisible.items.find(item => item.bookId === 'old').paragraphs[0].translation, null);
    await owner.query(`INSERT INTO paragraph_revisions(paragraph_id,revision,original) VALUES('old-v999-p71',2,'新的原文，不沿用旧人物关联');
      UPDATE paragraphs SET current_revision=2 WHERE id='old-v999-p71'`);
    const originalPaused = await ownRepository.personPassages('search-person', { q: '潞州' });
    assert.equal(originalPaused.total, 1); assert.equal(originalPaused.unavailableCount, 1);
    assert.notEqual(originalPaused.resultSetRevision, updated.resultSetRevision);
    await owner.query("UPDATE chapters SET published=false WHERE id='new-v999'");
    const chapterPaused = await ownRepository.personPassages('search-person', { q: '潞州' });
    assert.equal(chapterPaused.total, 0); assert.deepEqual(chapterPaused.items, []);
    await owner.query("UPDATE books SET published=false WHERE id='old'");
    assert.equal(await ownRepository.personPassages('search-person', { q: '潞州', bookId: 'old' }), null);
  } finally { await owner.query('ROLLBACK'); }
});

test('all candidates and versions are read by one statement; search never mutates source or translation rows', async () => {
  let queries = 0;
  const oneSnapshot = createPersonPassagesRepository({ query: (...args) => { queries++; return readerPool.query(...args); } });
  const sourceBefore = (await readerPool.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows;
  const translationBefore = (await readerPool.query('SELECT * FROM translations ORDER BY id')).rows;
  const result = await oneSnapshot.personPassages('search-person', { q: '潞州', limit: 1 });
  assert.equal(queries, 1); assert.equal(result.total, 2);
  assert.deepEqual((await readerPool.query('SELECT * FROM paragraph_revisions ORDER BY paragraph_id,revision')).rows, sourceBefore);
  assert.deepEqual((await readerPool.query('SELECT * FROM translations ORDER BY id')).rows, translationBefore);
});
