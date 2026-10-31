import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest } from '../src/backup-archive.mjs';
import { textHash } from '../src/translation-batch.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { freezeContentRelease, publishContentRelease, assertReleasePreserved } from '../src/content-release-batch.mjs';
import { validateTimelineDocumentGuards, readReleaseTimelineDocuments, assertReleaseTimelineDocuments,
  validateTimelineDocumentVerification } from '../src/content-release-timeline-guards.mjs';

// All rows and SQL clients below are synthetic in-memory fixtures. No config,
// pg client, connection, database, published translation ID or version is used.
const document = (personId, summary = 'before') => ({ schemaVersion: 1, scope: 'current-archive', personId,
  events: [{ id: `${personId}-one`, summary, evidence: [{ excerpt: 'fixture' }] },
    { id: `${personId}-two`, summary: 'preserve', evidence: [{ excerpt: 'old' }] }] });
const guarded = (before, after) => ({ timelines: after, timelineDocumentGuards: after.map(target => ({ personId: target.personId,
  expectedBefore: before.find(previous => previous.personId === target.personId) ?? null, expectedAfterSha256: digest(target) })) });
const rows = documents => documents.map(doc => ({ personId: doc.personId, document: structuredClone(doc),
  digest: textHash(JSON.stringify(doc)), staticSha256: digest({ person_id: doc.personId }) }));

test('guards bind the whole included person set and exact target, not top-level allowlists', () => {
  const content = guarded([document('person-one')], [document('person-one', 'after')]);
  assert.equal(validateTimelineDocumentGuards(content.timelines, content.timelineDocumentGuards).length, 1);
  assert.throws(() => validateTimelineDocumentGuards(content.timelines), /explicit guard/);
  for (const edit of [
    value => { value[0].personId = 'other-person'; },
    value => { value[0].expectedAfterSha256 = '0'.repeat(64); },
    value => { value[0].expectedBefore.personId = 'other-person'; },
    value => { value[0].unusedBeforeHash = '0'.repeat(64); },
    value => { value[0].expectedBefore.events.push(value[0].expectedBefore.events[0]); },
  ]) {
    const guards = structuredClone(content.timelineDocumentGuards); edit(guards);
    assert.throws(() => validateTimelineDocumentGuards(content.timelines, guards));
  }
  assert.throws(() => validateTimelineDocumentGuards(content.timelines, [...content.timelineDocumentGuards, ...content.timelineDocumentGuards]));
});

test('before accepts a complete baseline or complete applied batch, but rejects partial and stale states', () => {
  const before = [document('person-one'), document('person-two')];
  const after = before.map(value => ({ ...value, events: value.events.map(event => ({ ...event, summary: 'after' })) }));
  const content = guarded(before, after);
  assert.equal(assertReleaseTimelineDocuments(content, rows(before), 'before').mode, 'before');
  assert.equal(assertReleaseTimelineDocuments(content, rows(after), 'before').mode, 'already-applied');
  assert.throws(() => assertReleaseTimelineDocuments(content, rows([after[0], before[1]]), 'before'), /partial/);
  const stale = structuredClone(before); stale[0].events[0].evidence[0].excerpt = 'unapproved leaf';
  assert.throws(() => assertReleaseTimelineDocuments(content, rows(stale), 'before'), /write-before/);
  assert.throws(() => assertReleaseTimelineDocuments(content, rows([before[0]]), 'before'), /write-before/);
  assert.throws(() => assertReleaseTimelineDocuments(content, [...rows(before), rows(before)[0]], 'before'), /duplicate/);
  assert.throws(() => assertReleaseTimelineDocuments(content, [...rows(before), ...rows([document('other-person')])], 'before'), /unexpected/);
});

test('freeze protection rejects old event identity removal even if a caller rehashes the truncated target', () => {
  const before = [document('person-one')], after = structuredClone(before);
  after[0].events.pop();
  const content = guarded(before, after);
  assert.throws(() => validateTimelineDocumentGuards(content.timelines, content.timelineDocumentGuards), /old event identity removed/);
});

test('new documents must be absent initially and exact after, without a mixed partial retry', () => {
  const before = [document('person-one')], after = [document('person-one', 'after'), document('person-new', 'new')];
  const content = guarded(before, after);
  assert.equal(assertReleaseTimelineDocuments(content, rows(before), 'before').mode, 'before');
  assert.equal(assertReleaseTimelineDocuments(content, rows(after), 'after', { beforeRows: rows(before) }).mode, 'after');
  assert.throws(() => assertReleaseTimelineDocuments(content, rows([after[0]]), 'before'), /partial/);
  assert.throws(() => assertReleaseTimelineDocuments(content, rows([...before, document('person-new', 'different')]), 'before'), /partial/);
});

test('after rejects changed source leaves, metadata, old event removals and order changes', () => {
  const before = [document('person-one')], after = [document('person-one', 'after')], content = guarded(before, after);
  for (const edit of [
    value => { value[0].events[0].evidence[0].excerpt = 'wrong'; },
    value => { value[0].events.pop(); },
    value => { value[0].events.reverse(); },
    value => { value[0].unexpectedMetadata = 'wrong'; },
    value => { value[0].events[1].summary = 'unapproved'; },
  ]) {
    const changed = structuredClone(after); edit(changed);
    assert.throws(() => assertReleaseTimelineDocuments(content, rows(changed), 'after', { beforeRows: rows(before) }), /write-after/);
  }
});

test('canonical object key ordering is immaterial, while array ordering remains protected', () => {
  const before = [document('person-one')], after = [document('person-one', 'after')], content = guarded(before, after);
  const target = after[0];
  const reordered = { events: target.events, personId: target.personId, scope: target.scope, schemaVersion: target.schemaVersion };
  const stored = rows([reordered]); stored[0].digest = textHash(JSON.stringify(target));
  assert.equal(assertReleaseTimelineDocuments(content, stored, 'after', { beforeRows: rows(before) }).mode, 'after');
});

test('stored digest uses the existing importer serialization, not approval canonical digest', () => {
  const before = [document('person-one')], after = [document('person-one', 'after')], content = guarded(before, after);
  assert.notEqual(textHash(JSON.stringify(after[0])), digest(after[0]));
  const actual = rows(after); actual[0].digest = digest(after[0]);
  assert.throws(() => assertReleaseTimelineDocuments(content, actual, 'after', { beforeRows: rows(before) }), /stored digest/);
});

test('all previously existing static columns are protected through the row projection SHA', () => {
  const before = [document('person-one')], after = [document('person-one', 'after')], content = guarded(before, after);
  const old = rows(before), changed = rows(after);
  old[0].staticSha256 = digest({ person_id: 'person-one', synthetic_future_immutable_column: 'preserve' });
  changed[0].staticSha256 = digest({ person_id: 'person-one', synthetic_future_immutable_column: 'unapproved' });
  assert.throws(() => assertReleaseTimelineDocuments(content, changed, 'after', { beforeRows: old }), /static old row/);
  assert.throws(() => assertReleaseTimelineDocuments(content, rows(after), 'after'), /actual rows/);
});

test('empty and unchanged batches have explicit, repeatable receipt semantics', () => {
  const empty = { timelines: [] };
  assert.equal(assertReleaseTimelineDocuments(empty, [], 'before').mode, 'empty');
  assert.throws(() => assertReleaseTimelineDocuments(empty, rows([document('other-person')]), 'after'));
  const doc = document('person-one'), content = guarded([doc], [doc]);
  assert.equal(assertReleaseTimelineDocuments(content, rows([doc]), 'before').mode, 'already-applied');
});

test('read gate uses the supplied client, locks before reading, and handles a genuinely absent table', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ relation: 'person_timelines' }] };
    return { rows: [] };
  } };
  await readReleaseTimelineDocuments(client, [document('person-two'), document('person-one')], { lock: true });
  assert.equal(calls.length, 3);
  assert.match(calls[1].sql, /^LOCK TABLE public\.person_timelines IN SHARE ROW EXCLUSIVE MODE$/);
  assert.match(calls[2].sql, /FOR UPDATE$/);
  assert.match(calls[2].sql, /to_jsonb\(t\)-'document'-'digest'-'updated_at'/);
  assert.match(calls[2].sql, /AS "staticSha256"/);
  assert.deepEqual(calls[2].params, [['person-one', 'person-two']]);
  calls.length = 0;
  await readReleaseTimelineDocuments(client, [document('person-one')]);
  assert.equal(calls.length, 2); assert.doesNotMatch(calls[1].sql, /FOR UPDATE/);
  const absent = { query: async sql => { assert.match(sql, /to_regclass/); return { rows: [{ relation: null }] }; } };
  assert.deepEqual(await readReleaseTimelineDocuments(absent, [document('person-one')], { lock: true }), []);
  assert.deepEqual(await readReleaseTimelineDocuments({ query: () => { throw new Error('must not query'); } }, []), []);
});

test('formal proof requires first and repeat transaction receipts bound to exactly these guards and targets', () => {
  const before = [document('person-one')], after = [document('person-one', 'after')], content = guarded(before, after);
  const verification = { first: { before: assertReleaseTimelineDocuments(content, rows(before), 'before'),
    after: assertReleaseTimelineDocuments(content, rows(after), 'after', { beforeRows: rows(before) }) },
  repeated: { before: assertReleaseTimelineDocuments(content, rows(after), 'before'),
    after: assertReleaseTimelineDocuments(content, rows(after), 'after', { beforeRows: rows(after) }) } };
  assert.equal(validateTimelineDocumentVerification(content, verification), true);
  assert.throws(() => validateTimelineDocumentVerification(content), /verification/);
  for (const edit of [
    value => { value.repeated.before.mode = 'before'; },
    value => { value.first.after.targetsSha256 = '0'.repeat(64); },
    value => { value.first.before.guardsSha256 = '0'.repeat(64); },
    value => { value.repeated.after.people = 2; },
  ]) {
    const changed = structuredClone(verification); edit(changed);
    assert.throws(() => validateTimelineDocumentVerification(content, changed), /verification/);
  }
});

function publisherFixture() {
  const people = loadPassagePeople(), original = 'Fixture。';
  const paragraph = { id: 'guardfixture-v001-p1', position: 1, revision: 1, original };
  const chapter = { id: 'guardfixture-v001', bookId: 'guardfixture', editionId: 'guardfixture-local-wikisource', position: 1,
    title: 'Synthetic fixture', sourceUrl: 'https://example.invalid/guard', notes: [], scope: 'full', paragraphs: [paragraph] };
  const source = { chapterId: chapter.id, paragraphId: paragraph.id, originalRevision: 1, originalSha256: textHash(original), excerpt: original };
  const event = { id: 'zhu-wen-guard-fixture', title: 'Synthetic event', summary: 'Synthetic before', year: 907,
    sortOrder: 0, precision: 'year', sourceDate: 'Synthetic', phase: 'rule', evidence: [source] };
  const before = { schemaVersion: 1, scope: 'current-archive', personId: 'zhu-wen', events: [event] };
  const after = structuredClone(before); after.events[0].summary = 'Synthetic approved after';
  const content = { schemaVersion: 1, id: 'test-timeline-guard-transaction', humanReviewed: false, people,
    library: { catalog: { books: [{ id: chapter.bookId, title: 'Synthetic', author: 'Test', description: 'Synthetic test only', url: chapter.sourceUrl, defaultChapter: chapter.id }] }, chapters: [chapter] },
    translationBatches: [], sentenceBatches: [], alignments: [], reviewBatches: [], timelines: [after],
    passageIndex: { schemaVersion: 1, scope: 'current-archive', coverage: { bookCount: 1, chapterCount: 1, paragraphCount: 1 }, people, passages: [] },
    timelineDocumentGuards: [{ personId: 'zhu-wen', expectedBefore: before, expectedAfterSha256: digest(after) }] };
  return { content, before, after };
}

function mockTransaction(content, initial, { corruptStoredAfter = false, corruptDigestAfter = false, corruptStaticAfter = false } = {}) {
  let current = structuredClone(initial), saved, timelineDigest = textHash(JSON.stringify(initial)), immutableValue = 'preserve';
  const calls = [], p = content.library.chapters[0].paragraphs[0];
  const sourceRow = { id: p.id, chapter_id: 'guardfixture-v001', book_id: 'guardfixture', position: 1, current_revision: 1, original: p.original, visible: true, translation_id: null };
  const client = { calls, current: () => structuredClone(current),
    storedState: () => ({ document: structuredClone(current), digest: timelineDigest, synthetic_future_immutable_column: immutableValue }), query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('BEGIN')) { saved = { current: structuredClone(current), timelineDigest, immutableValue }; return { rows: [] }; }
    if (sql === 'ROLLBACK') { current = saved.current; timelineDigest = saved.timelineDigest; immutableValue = saved.immutableValue; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('current_database()')) return { rows: [{ name: 'history_content_release_test_mock' }] };
    if (sql.includes('FROM pg_tables')) return { rows: [{ tablename: 'person_timelines' }] };
    if (sql.includes('FROM pg_index i')) return { rows: [{ attname: 'person_id' }] };
    if (sql.includes('jsonb_build_array(t.')) return { rows: current ? [{ key: '["zhu-wen"]', hash: digest({ document: current, digest: timelineDigest, synthetic_future_immutable_column: immutableValue }) }] : [] };
    if (sql.includes('pg_sequences') || sql.includes('FROM pg_extension') || sql.includes('information_schema.columns')
      || sql.includes('FROM pg_constraint') || sql.includes('FROM pg_proc') || sql.includes('FROM pg_indexes')
      || sql.includes('pg_get_viewdef') || sql.includes('pg_get_triggerdef')) return { rows: [] };
    if (sql.includes('to_regclass')) return { rows: [{ relation: 'person_timelines' }] };
    if (sql.startsWith('SELECT t.person_id AS')) return { rows: current ? [{ ...rows([current])[0], digest: timelineDigest,
      staticSha256: digest({ person_id: current.personId, synthetic_future_immutable_column: immutableValue }) }] : [] };
    if (sql === 'SELECT id FROM public.passage_people') return { rows: content.people };
    if (sql.includes('FROM public.paragraphs p')) return { rows: [sourceRow] };
    if (sql.startsWith('SELECT digest FROM public.person_passage_index')) return { rows: [{ digest: textHash(JSON.stringify(content.passageIndex)) }] };
    if (sql.startsWith('SELECT digest FROM public.person_timelines')) return { rows: current ? [{ digest: timelineDigest }] : [] };
    if (sql.startsWith('INSERT INTO public.person_timelines')) {
      current = JSON.parse(params[1]); timelineDigest = params[2];
      if (corruptStoredAfter) current.events[0].evidence[0].excerpt += 'unapproved corruption';
      if (corruptDigestAfter) timelineDigest = '0'.repeat(64);
      if (corruptStaticAfter) immutableValue = 'unapproved static change';
      return { rows: [], rowCount: 1 };
    }
    if (/^(?:SET |LOCK |SAVEPOINT |RELEASE |ROLLBACK TO SAVEPOINT |SELECT pg_advisory|INSERT INTO (?:books|editions|chapters|paragraphs|paragraph_revisions)|-- Independent display index|-- Display references only)/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected mock SQL: ${sql.slice(0, 80)}`);
  } };
  return client;
}

test('real publisher calls the write-before gate before any importer write and rolls back mismatch', async () => {
  const { content, before } = publisherFixture(), stale = structuredClone(before); stale.events[0].summary = 'Unapproved existing change';
  const client = mockTransaction(content, stale);
  await assert.rejects(publishContentRelease(client, freezeContentRelease(content), { expectedDatabase: 'history_content_release_test_mock' }), /write-before/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(client.calls.some(call => /FOR UPDATE$/.test(call.sql)));
  assert.ok(!client.calls.some(call => /^(?:INSERT|UPDATE|DELETE|CREATE)/.test(call.sql)), 'no importer write before rejection');
  assert.deepEqual(client.current(), stale);
});

test('real publisher rejects a stored-after leaf corruption inside the outer transaction before COMMIT', async () => {
  const { content, before } = publisherFixture(), client = mockTransaction(content, before, { corruptStoredAfter: true });
  await assert.rejects(publishContentRelease(client, freezeContentRelease(content), { expectedDatabase: 'history_content_release_test_mock' }), /write-after/);
  assert.ok(client.calls.some(call => call.sql.startsWith('INSERT INTO public.person_timelines')));
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK'); assert.ok(!client.calls.some(call => call.sql === 'COMMIT'));
  assert.deepEqual(client.current(), before, 'in-memory client rollback restored its fixture, not a PostgreSQL claim');
});

for (const [option, expected] of [['corruptDigestAfter', /stored digest/], ['corruptStaticAfter', /static old row/]]) {
  test(`real publisher rolls back ${option} even when the approved document JSON is correct`, async () => {
    const { content, before } = publisherFixture(), client = mockTransaction(content, before, { [option]: true });
    const initial = client.storedState();
    await assert.rejects(publishContentRelease(client, freezeContentRelease(content), { expectedDatabase: 'history_content_release_test_mock' }), expected);
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK'); assert.ok(!client.calls.some(call => call.sql === 'COMMIT'));
    assert.deepEqual(client.storedState(), initial, 'only the in-memory mock state is asserted, not a PostgreSQL rollback');
  });
}

test('real publisher commits only after both reads and a repeated batch returns complete-after receipts', async () => {
  const { content, before, after } = publisherFixture(), client = mockTransaction(content, before), frozen = freezeContentRelease(content);
  const first = await publishContentRelease(client, frozen, { expectedDatabase: 'history_content_release_test_mock' });
  assert.equal(first.timelineDocumentGuards.before.mode, 'before'); assert.equal(first.timelineDocumentGuards.after.mode, 'after');
  assert.equal(client.calls.at(-1).sql, 'COMMIT'); assert.deepEqual(client.current(), after);
  const reads = client.calls.map((call, index) => call.sql.startsWith('SELECT t.person_id AS') ? index : -1).filter(index => index >= 0);
  const write = client.calls.findIndex(call => call.sql.startsWith('INSERT INTO public.person_timelines'));
  assert.ok(reads.length === 2 && reads[0] < write && write < reads[1] && reads[1] < client.calls.length - 1);
  const repeated = await publishContentRelease(client, frozen, { expectedDatabase: 'history_content_release_test_mock' });
  assert.equal(repeated.timelineDocumentGuards.before.mode, 'already-applied');
  assert.equal(validateTimelineDocumentVerification(content, { first: first.timelineDocumentGuards, repeated: repeated.timelineDocumentGuards }), true);
  assert.deepEqual(repeated.database, first.database);
});

test('the added post-gate fault is still handled by the original outer ROLLBACK', async () => {
  const { content, before } = publisherFixture(), client = mockTransaction(content, before);
  await assert.rejects(publishContentRelease(client, freezeContentRelease(content), { expectedDatabase: 'history_content_release_test_mock', faultAfter: 'timeline-documents' }), /Injected content release failure: timeline-documents/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(client.current(), before);
});

test('freeze refuses an inert oldTimelineChanges field and guards are included in the release fingerprint', () => {
  const { content } = publisherFixture();
  const frozen = freezeContentRelease(content), changed = structuredClone(frozen);
  changed.content.timelineDocumentGuards[0].expectedBefore.events[0].summary = 'unapproved';
  assert.notEqual(digest(changed.content), frozen.fingerprint);
  content.oldTimelineChanges = [];
  assert.throws(() => freezeContentRelease(content), /not a consumed protection contract/);
});

test('the existing inventory check still protects timelines outside the included document set', () => {
  const { content } = publisherFixture();
  const before = { inventory: { person_timelines: { '["zhu-wen"]': 'included-before', '["li-keyong"]': 'protected-old' } } };
  const after = { inventory: { person_timelines: { '["zhu-wen"]': 'included-after', '["li-keyong"]': 'protected-old' } } };
  assert.equal(assertReleasePreserved(before, after, content), true);
  after.inventory.person_timelines['["li-keyong"]'] = 'unapproved-change';
  assert.throws(() => assertReleasePreserved(before, after, content), /protected old row differs/);
});

test('isolated verifier and implementation fingerprint actually consume the new module and receipts', () => {
  const implementation = readFileSync(new URL('../src/content-release-implementation.mjs', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/release-content-batch.mjs', import.meta.url), 'utf8');
  assert.match(implementation, /'src\/content-release-timeline-guards\.mjs'/);
  assert.match(runner, /validateTimelineDocumentVerification\(content, timelineDocumentGuards\)/);
  assert.match(runner, /fullInserts, eventInserts, timelineDocumentGuards, rebound/);
});
