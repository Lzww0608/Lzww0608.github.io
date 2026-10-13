import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from '../scripts/runtime.mjs';
import { importLibrary } from '../scripts/import-library.mjs';
import { ensurePersonTimelineSchema, importPersonTimelines } from '../scripts/import-person-timelines.mjs';
import { createRepository } from '../src/repository.mjs';
import { createPersonTimelinesRepository } from '../src/person-timelines.mjs';
import { createApi } from '../src/http.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { loadPersonTimelines, timelineEvidence, timelineHash } from '../../content/person-timelines.mjs';

const config = loadConfig(), suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
const database = `history_timelines_test_${suffix}`;
const readerRole = `history_timelines_reader_${suffix}`, editorRole = `history_timelines_editor_${suffix}`;
const password = randomBytes(32).toString('hex');
const library = loadLibrary(), documents = loadPersonTimelines(library);
const published = new Map(loadPublishedChapters(library).flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
const referencedIds = [...new Set(documents.flatMap(document => document.events.flatMap(timelineEvidence).map(ref => ref.paragraphId)))];
const people = new Map(loadPassagePeople().map(person => [person.id, person]));
const coreTables = ['books', 'editions', 'chapters', 'paragraphs', 'paragraph_revisions', 'translations', 'passage_people'];
let admin, owner, readerPool, editorPool, server, base;
let databaseCreated = false, readerCreated = false, editorCreated = false;
const allEvents = documents.reduce((sum, document) => sum + document.events.length, 0);
const primary = documents[0].events[0].evidence[0];
const variant = documents.flatMap(document => document.events).find(event => event.variants?.length)?.variants[0].evidence[0];

async function timelineRows() {
  return (await owner.query('SELECT * FROM public.person_timelines ORDER BY person_id')).rows;
}
async function coreHashes() {
  const hashes = {};
  for (const table of coreTables) {
    const { rows } = await owner.query(`SELECT to_jsonb(t)::text AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`);
    hashes[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  return hashes;
}
async function rollbackTest(run) {
  await owner.query('BEGIN');
  try { return await run(createRepository(owner)); }
  finally { await owner.query('ROLLBACK'); }
}
function affectedEvents(document, predicate) {
  return document.events.filter(event => timelineEvidence(event).some(predicate)).map(event => event.id);
}
async function assertSuspended(repository, before, predicate) {
  for (const document of documents) {
    const affected = affectedEvents(document, predicate);
    const result = await repository.personTimeline(document.personId);
    assert.equal(result.unavailableCount, affected.length, document.personId);
    assert.deepEqual(result.events.map(event => event.id), document.events.filter(event => !affected.includes(event.id)).map(event => event.id));
    if (affected.length) assert.notEqual(result.resultSetRevision, before.get(document.personId).resultSetRevision);
    else assert.equal(result.resultSetRevision, before.get(document.personId).resultSetRevision);
  }
}
async function beforeTimelines(repository) {
  return new Map(await Promise.all(documents.map(async document => [document.personId, await repository.personTimeline(document.personId)])));
}

before(async () => {
  admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`); databaseCreated = true;
  for (const role of [readerRole, editorRole]) {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    if (role === readerRole) readerCreated = true; else editorCreated = true;
  }
  owner = new pg.Client({ ...adminDatabase(config), database }); await owner.connect();
  await owner.query('BEGIN');
  try {
    for (const migration of ['001-initial.sql', '002-translation-metadata.sql', '004-person-passages.sql']) {
      await owner.query(readFileSync(new URL(`../db/${migration}`, import.meta.url), 'utf8'));
    }
    await importLibrary(owner, library);
    for (const document of documents) {
      await owner.query('INSERT INTO public.passage_people(id,name) VALUES($1,$2)', [document.personId, people.get(document.personId).name]);
    }
    // Use the actual full published translations for every cited primary and alternative source.
    // Identity values are local to this isolated database; timeline references bind only originals.
    for (const paragraphId of referencedIds) {
      const paragraph = published.get(paragraphId), translation = paragraph?.translation;
      assert.ok(translation, `Published translation required for ${paragraphId}`);
      await owner.query(`INSERT INTO public.translations(paragraph_id,original_revision,version,text,translator,status,metadata)
        VALUES($1,$2,$3,$4,$5,'published',$6::jsonb)`, [paragraphId, paragraph.revision, translation.version,
        translation.text, translation.translator, JSON.stringify({ origin: translation.origin, humanReviewed: translation.origin !== 'ai',
          reviewStatus: translation.reviewStatus, reviewNotes: translation.reviewNotes })]);
    }
    const before = await coreHashes();
    const imported = await importPersonTimelines(owner, documents, library);
    assert.deepEqual(imported, { people: documents.length, events: allEvents, inserted: documents.length, updated: 0, unchanged: 0 });
    assert.deepEqual(await coreHashes(), before, 'initial import must not edit any existing source or identity rows');
    await owner.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${database} TO ${readerRole},${editorRole};
      GRANT USAGE ON SCHEMA public TO ${readerRole},${editorRole};
      GRANT SELECT ON public.books,public.editions,public.chapters,public.paragraphs,public.paragraph_revisions,
        public.translations,public.person_timelines TO ${readerRole}`);
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  readerPool = new pg.Pool({ ...config.database, database, user: readerRole, password, max: 2 });
  editorPool = new pg.Pool({ ...config.database, database, user: editorRole, password, max: 1 });
  server = createApi({ repository: createRepository(readerPool), allowedOrigins: ['https://lzww0608.github.io'], log: () => {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (readerPool) await readerPool.end(); if (editorPool) await editorPool.end();
  if (owner) await owner.end();
  assert.match(database, /^history_timelines_test_[0-9]+_[a-f0-9]{10}$/);
  if (databaseCreated) await admin.query(`DROP DATABASE ${database}`);
  if (readerCreated) await admin.query(`DROP ROLE ${readerRole}`);
  if (editorCreated) await admin.query(`DROP ROLE ${editorRole}`);
  if (admin) await admin.end();
});

test('every actual event resolves all primary and alternative sources using the complete chapter paragraph model', async () => {
  assert.ok(documents.some(document => document.personId === 'li-keyong'));
  assert.ok(documents.some(document => document.personId === 'li-cunxu'));
  for (const document of documents) {
    const response = await fetch(`${base}/api/people/${document.personId}/timeline`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.personId, document.personId); assert.equal(result.schemaVersion, 1); assert.equal(result.scope, 'current-archive');
    assert.equal(result.unavailableCount, 0); assert.equal(result.events.length, document.events.length);
    assert.match(result.resultSetRevision, /^[a-f0-9]{64}$/);
    const chapters = new Map();
    for (const event of result.events) {
      const original = document.events.find(item => item.id === event.id);
      assert.equal(event.title, original.title); assert.equal(event.year, original.year); assert.equal(event.sourceDate, original.sourceDate);
      assert.equal(event.summary, original.summary);
      assert.deepEqual(event.variants?.map(item => ({ label: item.label, sourceDate: item.sourceDate, year: item.year })),
        original.variants?.map(item => ({ label: item.label, sourceDate: item.sourceDate, year: item.year })));
      for (const evidence of timelineEvidence(event)) {
        if (!chapters.has(evidence.chapterId)) {
          chapters.set(evidence.chapterId, await (await fetch(`${base}/api/chapters/${evidence.chapterId}`)).json());
        }
        const chapter = chapters.get(evidence.chapterId);
        const paragraph = chapter.paragraphs.find(item => item.id === evidence.paragraphId);
        assert.deepEqual(evidence.paragraph, paragraph, evidence.paragraphId);
        assert.equal(evidence.bookId, chapter.bookId); assert.equal(evidence.chapterTitle, chapter.title);
        assert.equal(timelineHash(paragraph.original), evidence.originalSha256);
        assert.ok(paragraph.original.includes(evidence.excerpt));
        assert.equal(paragraph.translation.text, published.get(evidence.paragraphId).translation.text);
      }
    }
  }
});

test('timeline HTTP is read-only, rejects unrelated query parameters and keeps unknown people unavailable', async () => {
  const route = `${base}/api/people/${documents[0].personId}/timeline`;
  assert.equal((await fetch(`${base}/api/people/unknown/timeline`)).status, 404);
  assert.equal((await fetch(`${base}/api/people/zhu-wen/timeline`)).status, 200, 'canonical people now have registered timelines');
  await rollbackTest(async repository => {
    await owner.query('DELETE FROM public.person_timelines WHERE person_id=$1', ['zhu-wen']);
    assert.equal(await repository.personTimeline('zhu-wen'), null, 'a missing index stays unavailable instead of inventing events');
  });
  for (const query of ['event=anything', 'personId=li-cunxu', 'limit=1', 'x=', 'x=1&x=2', 'q=%27%3BDROP+TABLE+person_timelines']) {
    assert.equal((await fetch(`${route}?${query}`)).status, 400, query);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(route, { method })).status, 405, method);
  const head = await fetch(route, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await fetch(route, { method: 'OPTIONS' })).status, 204);
  assert.equal((await fetch(route, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.person_timelines')).rows[0].n, documents.length);
});

test('selected events retain canonical order and complete current main/variant evidence from one database snapshot', async () => {
  const document=documents.find(document=>document.events.length>=3 && document.events.some(event=>event.variants?.length)), selectedIds=[document.events[2].id,document.events[0].id];
  const full=await (await fetch(`${base}/api/people/${document.personId}/timeline`)).json();
  const params=new URLSearchParams(); selectedIds.forEach(id=>params.append('eventId',id));
  const selected=await (await fetch(`${base}/api/people/${document.personId}/timeline?${params}`)).json();
  assert.deepEqual(selected.events,full.events.filter(event=>selectedIds.includes(event.id)));
  assert.equal(selected.unavailableCount,0); assert.match(selected.resultSetRevision,/^[a-f0-9]{64}$/);
  const calls=[]; const repository=createPersonTimelinesRepository({ query(sql,params){calls.push({sql,params});return readerPool.query(sql,params);} });
  assert.deepEqual((await repository.personTimeline(document.personId,{eventIds:selectedIds})).events,selected.events);
  assert.equal(calls.length,1); assert.deepEqual(calls[0].params,[document.personId,selectedIds]);
  assert.deepEqual((await repository.personTimeline(document.personId,{eventIds:['unknown-event']})).events,[]);
});

test('a single database statement supplies all event originals and latest published translations', async () => {
  const calls = [];
  const repository = createPersonTimelinesRepository({ query(sql, params) { calls.push({ sql, params }); return readerPool.query(sql, params); } });
  const result = await repository.personTimeline(documents[0].personId);
  assert.equal(result.events.length, documents[0].events.length);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].params, [documents[0].personId]);
  assert.equal(await repository.personTimeline("li-keyong'; DELETE FROM person_timelines; --"), null);
  assert.deepEqual(calls[1].params, ["li-keyong'; DELETE FROM person_timelines; --"]);
  assert.equal((await timelineRows()).length, documents.length);
});

test('repeated whole-batch imports preserve timestamps, source identities and all full translation history', async () => {
  await rollbackTest(async () => {
    const rows = await timelineRows(), before = await coreHashes();
    const result = await importPersonTimelines(owner, documents, library);
    assert.deepEqual(result, { people: documents.length, events: allEvents, inserted: 0, updated: 0, unchanged: documents.length });
    assert.deepEqual(await timelineRows(), rows); assert.deepEqual(await coreHashes(), before);
  });
});

test('invalid members anywhere in a batch are rejected before any timeline or source row changes', async () => {
  await rollbackTest(async () => {
    const rows = await timelineRows(), before = await coreHashes();
    const invalid = structuredClone(documents); invalid[0].events[0].title = '不可部分写入的新题名';
    invalid.at(-1).events.at(-1).evidence[0].originalSha256 = '0'.repeat(64);
    await assert.rejects(importPersonTimelines(owner, invalid, library), /Invalid person timeline/);
    await assert.rejects(importPersonTimelines(owner, [documents[0], documents[0]], library), /batch identity/);
    assert.deepEqual(await timelineRows(), rows); assert.deepEqual(await coreHashes(), before);
    assert.equal((await owner.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
  });
});

test('a database-source mismatch rejects the complete batch without leaving a failed caller transaction', async () => {
  await rollbackTest(async () => {
    const rows = await timelineRows();
    await owner.query('UPDATE public.paragraph_revisions SET original=original || $1 WHERE paragraph_id=$2 AND revision=$3',
      ['隔离测试改变底本', primary.paragraphId, primary.originalRevision]);
    const before = await coreHashes();
    await assert.rejects(importPersonTimelines(owner, documents, library), /Current timeline source differs/);
    assert.deepEqual(await timelineRows(), rows); assert.deepEqual(await coreHashes(), before);
    assert.equal((await owner.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
  });
});

test('a late second-person write failure rolls back the first updated document and its timestamp', async () => {
  await rollbackTest(async () => {
    const rows = await timelineRows(), before = await coreHashes();
    await owner.query(`CREATE FUNCTION public.reject_second_timeline_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.person_id='${documents[1].personId}' THEN RAISE EXCEPTION 'late timeline test failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_second_timeline_test BEFORE INSERT OR UPDATE ON public.person_timelines
        FOR EACH ROW EXECUTE FUNCTION public.reject_second_timeline_test()`);
    const changed = structuredClone(documents);
    changed[0].events[0].title += '（隔离测试）'; changed[1].events[0].title += '（隔离测试）';
    await assert.rejects(importPersonTimelines(owner, changed, library), /late timeline test failure/);
    assert.deepEqual(await timelineRows(), rows); assert.deepEqual(await coreHashes(), before);
    assert.equal((await owner.query('SELECT 1 AS healthy')).rows[0].healthy, 1);
  });
});

test('newest matching published full versions win over later private drafts and change result revisions', async () => {
  await rollbackTest(async repository => {
    const before = await beforeTimelines(repository), old = published.get(primary.paragraphId).translation;
    await owner.query(`INSERT INTO public.translations(paragraph_id,original_revision,version,text,translator,status,metadata) VALUES
      ($1,$2,$3,'最新公开独立库译文','所有者','published','{"origin":"human","reviewStatus":"owner-edited","reviewNotes":["校核说明"]}'),
      ($1,$2,$4,'不能泄露的后续私有草稿','草稿者','draft','{}')`,
      [primary.paragraphId, primary.originalRevision, old.version + 1, old.version + 2]);
    for (const document of documents) {
      const result = await repository.personTimeline(document.personId);
      assert.equal(JSON.stringify(result).includes('不能泄露'), false);
      const evidence = result.events.flatMap(timelineEvidence).filter(ref => ref.paragraphId === primary.paragraphId);
      for (const ref of evidence) {
        assert.equal(ref.paragraph.translation.text, '最新公开独立库译文');
        assert.equal(ref.paragraph.translation.version, old.version + 1);
        assert.equal(ref.paragraph.translation.reviewStatus, 'owner-edited');
        assert.deepEqual(ref.paragraph.translation.reviewNotes, ['校核说明']);
      }
      if (evidence.length) assert.notEqual(result.resultSetRevision, before.get(document.personId).resultSetRevision);
    }
  });
});

test('a changed primary original hash pauses complete affected events instead of leaking stale readings', async () => {
  await rollbackTest(async repository => {
    const before = await beforeTimelines(repository);
    await owner.query('UPDATE public.paragraph_revisions SET original=original || $1 WHERE paragraph_id=$2 AND revision=$3',
      ['隔离测试原文变化', primary.paragraphId, primary.originalRevision]);
    await assertSuspended(repository, before, ref => ref.paragraphId === primary.paragraphId);
  });
});

test('an invalid alternative source pauses its whole event and all shared references', async () => {
  assert.ok(variant, 'real source disagreements must be tested');
  await rollbackTest(async repository => {
    const before = await beforeTimelines(repository);
    await owner.query('UPDATE public.paragraph_revisions SET original=original || $1 WHERE paragraph_id=$2 AND revision=$3',
      ['异说底本已变', variant.paragraphId, variant.originalRevision]);
    await assertSuspended(repository, before, ref => ref.paragraphId === variant.paragraphId);
  });
});

test('an original revision update suspends old evidence even when a new matching full translation is published', async () => {
  await rollbackTest(async repository => {
    const before = await beforeTimelines(repository);
    const nextRevision = primary.originalRevision + 1;
    await owner.query('INSERT INTO public.paragraph_revisions(paragraph_id,revision,original) VALUES($1,$2,$3)',
      [primary.paragraphId, nextRevision, published.get(primary.paragraphId).original + '新的原文修订']);
    await owner.query('UPDATE public.paragraphs SET current_revision=$2 WHERE id=$1', [primary.paragraphId, nextRevision]);
    await owner.query(`INSERT INTO public.translations(paragraph_id,original_revision,version,text,translator,status)
      VALUES($1,$2,1,'新的原文对应译文','所有者','published')`, [primary.paragraphId, nextRevision]);
    await assertSuspended(repository, before, ref => ref.paragraphId === primary.paragraphId);
  });
});

test('missing public full translations pause all affected events; drafts do not replace them', async () => {
  await rollbackTest(async repository => {
    const before = await beforeTimelines(repository);
    await owner.query("UPDATE public.translations SET status='draft' WHERE paragraph_id=$1", [primary.paragraphId]);
    await assertSuspended(repository, before, ref => ref.paragraphId === primary.paragraphId);
  });
});

test('unpublished chapters and books never expose their event evidence or translations', async () => {
  for (const kind of ['chapter', 'book']) {
    await rollbackTest(async repository => {
      const before = await beforeTimelines(repository);
      const chapter = library.chapters.find(item => item.id === primary.chapterId);
      if (kind === 'chapter') await owner.query('UPDATE public.chapters SET published=false WHERE id=$1', [chapter.id]);
      else await owner.query('UPDATE public.books SET published=false WHERE id=$1', [chapter.bookId]);
      await assertSuspended(repository, before, ref => kind === 'chapter' ? ref.chapterId === chapter.id
        : library.chapters.find(item => item.id === ref.chapterId).bookId === chapter.bookId);
      const rows = await timelineRows();
      await assert.rejects(importPersonTimelines(owner, documents, library), /Current timeline source differs/);
      assert.deepEqual(await timelineRows(), rows);
    });
  }
});

test('a registered timeline with all sources paused returns an authoritative HTTP 200 empty result', async () => {
  await rollbackTest(async repository => {
    const before = await repository.personTimeline(documents[0].personId);
    await owner.query('UPDATE public.books SET published=false');
    const handler = createApi({ repository, allowedOrigins: [], log: () => {} });
    const response = await new Promise(resolve => {
      const outgoing = { statusCode: 200, setHeader() {}, end(body) {
        resolve({ status: this.statusCode, document: body ? JSON.parse(body) : null });
      } };
      handler.emit('request', { url: `/api/people/${documents[0].personId}/timeline`, method: 'GET', headers: {} }, outgoing);
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.document.events, []);
    assert.equal(response.document.unavailableCount, documents[0].events.length);
    assert.notEqual(response.document.resultSetRevision, before.resultSetRevision);
  });
});

test('timeline SQL index rejects missing document fields and mismatched identities', async () => {
  await rollbackTest(async () => {
    for (const document of [{}, { schemaVersion: 1, scope: 'current-archive', personId: documents[0].personId },
      { schemaVersion: 1, scope: 'current-archive', personId: documents[0].personId, events: [] },
      { schemaVersion: 1, scope: 'current-archive', personId: 'other', events: [] }]) {
      await owner.query('SAVEPOINT invalid_timeline_document_test');
      await assert.rejects(owner.query('UPDATE public.person_timelines SET document=$2::jsonb WHERE person_id=$1',
        [documents[0].personId, JSON.stringify(document)]), error => error.code === '23514');
      await owner.query('ROLLBACK TO SAVEPOINT invalid_timeline_document_test');
      await owner.query('RELEASE SAVEPOINT invalid_timeline_document_test');
    }
  });
});

test('reader can only select the timeline index and the editor receives no direct access', async () => {
  assert.equal((await readerPool.query('SELECT * FROM public.person_timelines')).rowCount, documents.length);
  for (const statement of ['DELETE FROM public.person_timelines WHERE false',
    'UPDATE public.person_timelines SET digest=digest WHERE false',
    "INSERT INTO public.person_timelines(person_id,document,digest) VALUES('bad','{}',repeat('a',64))"]) {
    await assert.rejects(readerPool.query(statement), error => error.code === '42501');
  }
  for (const statement of ['SELECT * FROM public.person_timelines', 'DELETE FROM public.person_timelines WHERE false']) {
    await assert.rejects(editorPool.query(statement), error => error.code === '42501');
  }
  await rollbackTest(async () => {
    await ensurePersonTimelineSchema(owner);
    const publicAccess = (await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.person_timelines'::regclass AND a.grantee=0) AS allowed`)).rows[0].allowed;
    assert.equal(publicAccess, false);
    for (const [role, canRead] of [['history_reader', true], ['history_editor', false]]) {
      if (!(await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) continue;
      const privileges = (await owner.query(`SELECT has_table_privilege($1,'public.person_timelines','SELECT') AS read,
        has_table_privilege($1,'public.person_timelines','INSERT,UPDATE,DELETE,TRUNCATE') AS write`, [role])).rows[0];
      assert.equal(privileges.read, canRead); assert.equal(privileges.write, false);
    }
  });
});
