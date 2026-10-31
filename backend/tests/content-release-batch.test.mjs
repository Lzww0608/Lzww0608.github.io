import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeContentRelease, validateContentRelease, rebindReleaseParents, publishContentRelease, snapshotReleaseDatabase, releaseFaultStages } from '../src/content-release-batch.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { textHash } from '../src/translation-batch.mjs';
import { verifyContentReleaseFromDump, runContentReleaseCli, releaseImplementationFingerprint, validateMilitaryReleaseQualification } from '../scripts/release-content-batch.mjs';

export function releaseFixture() {
  const original = '朱溫立。王氏問？', text = '朱温即位。王氏询问？';
  const paragraph = { id: 'releasefixture-v001-p1', position: 1, revision: 1, original, translation: null };
  const chapter = { id: 'releasefixture-v001', bookId: 'releasefixture', editionId: 'releasefixture-local-wikisource', position: 1,
    title: '测试新卷', sourceUrl: 'https://example.invalid/source', notes: [], scope: 'full', paragraphs: [paragraph] };
  const library = { catalog: { schemaVersion: 1, license: 'CC BY-SA', books: [{ id: chapter.bookId, title: '测试史料', author: '测试', description: '仅测试', url: chapter.sourceUrl, defaultChapter: chapter.id }] }, chapters: [chapter] };
  const originalSha256 = textHash(original), translationSha256 = textHash(text);
  const source = { chapterId: chapter.id, paragraphId: paragraph.id, originalRevision: 1, originalSha256, excerpt: '朱溫立。' };
  return { schemaVersion: 1, id: 'test-content-release', humanReviewed: false, library, people: loadPassagePeople(),
    translationBatches: [{ schemaVersion: 1, id: 'test-content-release-full', bookId: chapter.bookId, chapterIds: [chapter.id], language: 'zh-Hans', status: 'draft', translator: '测试',
      generation: { assistant: 'test', method: '独立测试', standardVersion: 'test-v1', generatedAt: '2026-10-16T00:00:00Z', humanReviewed: false }, standards: ['保留底本。'],
      entries: [{ paragraphId: paragraph.id, originalRevision: 1, originalSha256, text, reviewNotes: [] }] }],
    alignments: [{ paragraphId: paragraph.id, originalRevision: 1, originalSha256, translationSha256,
      sentences: [{ originalStart: 0, originalEnd: 4, translationStart: 0, translationEnd: 5 }, { originalStart: 4, originalEnd: 8, translationStart: 5, translationEnd: 10 }],
      tailSentences: [{ originalStart: 4, originalEnd: 8, translationStart: 5, translationEnd: 10 }], reason: '测试独立对应。' }],
    sentenceBatches: [{ schemaVersion: 1, id: 'test-release-sentences', entries: [{ id: 'sentence-releasefixture-v001-p1-1', chapterId: chapter.id, paragraphId: paragraph.id,
      originalRevision: 1, originalSha256, originalStart: 0, originalEnd: 4, parentTranslationId: null, parentTranslationVersion: null,
      parentTranslationSha256: translationSha256, version: 1, text: '朱温即位。', textSha256: textHash('朱温即位。'), origin: 'ai', humanReviewed: false, notes: [] }] }],
    passageIndex: { schemaVersion: 1, scope: 'current-archive', coverage: { bookCount: 1, chapterCount: 1, paragraphCount: 1 }, people: loadPassagePeople(),
      passages: [{ id: `passage-${paragraph.id}`, chapterId: chapter.id, title: '测试记载', spans: [{ paragraphId: paragraph.id, originalRevision: 1, originalSha256, start: 0, end: 8 }], people: [{ personId: 'zhu-wen', kind: 'record' }] }] },
    timelines: [{ schemaVersion: 1, scope: 'current-archive', personId: 'zhu-wen', events: [{ id: 'zhu-wen-release-fixture', title: '测试即位', summary: '仅供独立数据库测试。', year: 907, sortOrder: 0, precision: 'year', sourceDate: '测试', phase: 'rule', evidence: [source] }] }],
    reviewBatches: [{ schemaVersion: 1, batchId: 'test-content-release-reviews', subjects: [{ id: 'zhu-wen', name: '朱温' }], items: [{ id: 'test-content-release-item', personId: 'zhu-wen', personName: '朱温', bookId: chapter.bookId,
      chapterId: chapter.id, paragraphId: paragraph.id, category: 'translation', status: 'checked', severity: 'info', title: '测试', detail: '独立测试', evidence: [{ chapterId: chapter.id, paragraphId: paragraph.id, excerpt: source.excerpt }], originalRevision: 1, originalSha256,
      translationId: null, translationVersion: null, translationSha256, checkedAt: '2026-10-16T00:00:00Z', resolution: '测试', batchId: 'test-content-release-reviews' }] }] };
}

test('frozen release rejects any changed input and never assumes nine books or fixed population', () => {
  const frozen = freezeContentRelease(releaseFixture());
  assert.equal(validateContentRelease(frozen).id, 'test-content-release');
  frozen.content.translationBatches[0].entries[0].text += '变更';
  assert.throws(() => validateContentRelease(frozen), /fingerprint/);
});

test('rebinds actual published IDs without changing approved source, text or ranges', () => {
  const content = releaseFixture(), p = content.library.chapters[0].paragraphs[0];
  const rows = [{ id: p.id, chapter_id: 'releasefixture-v001', book_id: 'releasefixture', current_revision: 1, original: p.original,
    translation_id: '99999', version: 7, text: content.translationBatches[0].entries[0].text }];
  const rebound = rebindReleaseParents(content, rows);
  assert.equal(rebound.alignments[0].translationId, '99999');
  assert.equal(rebound.alignments[0].translationVersion, 7);
  assert.equal(rebound.reviewBatches[0].items[0].translationId, '99999');
  assert.deepEqual(rebound.alignments[0].sentences, content.alignments[0].sentences);
  assert.equal(content.alignments[0].translationId, undefined);
  assert.throws(() => rebindReleaseParents(content, [{ ...rows[0], text: '所有者新修订' }]), /translation/);
});

test('unapproved registries, duplicate full batches and missing sentence units are rejected', () => {
  const registry = releaseFixture(); registry.people.push({ id: 'unapproved-person', name: '未授权' });
  assert.throws(() => freezeContentRelease(registry), /registry/);
  const duplicate = releaseFixture(); duplicate.translationBatches.push(duplicate.translationBatches[0]);
  assert.throws(() => freezeContentRelease(duplicate), /duplicate/);
  const incomplete = releaseFixture(); incomplete.alignments = []; incomplete.sentenceBatches = [];
  assert.throws(() => freezeContentRelease(incomplete), /sentence coverage/);
  const arbitraryBook = releaseFixture();
  arbitraryBook.allowedOldRowChanges = [{ table: 'books', key: '["releasefixture"]', beforeSha256: '1'.repeat(64), afterSha256: '2'.repeat(64) }];
  assert.throws(() => freezeContentRelease(arbitraryBook), /unapproved book row exception/);
  const missingHash = releaseFixture();
  missingHash.bookMetadataUpdates = [{ id: 'releasefixture', expectedDescription: '旧简介', description: '仅测试' }];
  assert.throws(() => freezeContentRelease(missingHash), /one exact row exception/);
  const otherField = releaseFixture();
  otherField.bookMetadataUpdates = [{ id: 'releasefixture', expectedDescription: '旧简介', description: '仅测试', title: '不可改标题' }];
  assert.throws(() => freezeContentRelease(otherField), /book description update/);
});

test('runner has no implicit write command and binds every importer/security input', async () => {
  await assert.rejects(runContentReleaseCli([]), /No default action writes/);
  await assert.rejects(runContentReleaseCli(['publish']), /--allow-formal/);
  const implementation = releaseImplementationFingerprint();
  assert.ok(Object.keys(implementation.files).length >= 44);
  assert.match(implementation.files['db/008-owner-review-subjects.sql'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/five-dynasties/palace-people.json'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/southern-northern/emperors.json'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../scripts/index-person-passages.mjs'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/person-passages/rules.json'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/person-passages/chronology-subjects.json'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/person-relationships/palace-context.json'], /^[a-f0-9]{64}$/);
  assert.match(implementation.files['../content/military-people.mjs'], /^[a-f0-9]{64}$/);
  await assert.rejects(publishContentRelease({}, freezeContentRelease(releaseFixture()), { expectedDatabase: 'ancient_history', allowFormal: true }), /actual isolated verification/);
});

test('military release qualification reads the frozen library and people', async () => {
  const { loadLibrary } = await import('../../content/library.mjs');
  const { loadPersonPassageIndex } = await import('../../content/person-passages.mjs');
  const library = loadLibrary();
  const content = { library, people: loadPassagePeople(), passageIndex: loadPersonPassageIndex(library) };
  assert.equal(validateMilitaryReleaseQualification(content).id, 'military-people');
  const stale = structuredClone(content);
  stale.library.chapters.find(chapter => chapter.id === 'new-v22').paragraphs.find(paragraph => paragraph.id === 'new-v22-p21').original += '异文';
  assert.throws(() => validateMilitaryReleaseQualification(stale), /SHA mismatch/);
  const missingPerson = structuredClone(content);
  missingPerson.people = missingPerson.people.filter(person => person.id !== 'niu-cunjie');
  assert.throws(() => validateMilitaryReleaseQualification(missingPerson), /unknown member/);
  const missingAttribution = structuredClone(content);
  missingAttribution.passageIndex.passages.find(passage => passage.id === 'passage-new-v22-p21').people = [{ personId: 'zhu-wen', kind: 'record' }];
  assert.throws(() => validateMilitaryReleaseQualification(missingAttribution), /association/);
});

test('direct formal publication rejects stale implementation and missing military attribution before BEGIN', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadLibrary } = await import('../../content/library.mjs');
  const currentLibrary = loadLibrary();
  const topic = JSON.parse(readFileSync(new URL('../../content/five-dynasties/military-people.json', import.meta.url), 'utf8'));
  const currentIndex = JSON.parse(readFileSync(new URL('../../content/person-passages/index.json', import.meta.url), 'utf8'));
  const qualificationSources = Object.values(topic.memberServiceEvidence).flat();
  const chapterIds = new Set(qualificationSources.map(source => source.chapterId));
  const sourceChapters = currentLibrary.chapters.filter(chapter => chapterIds.has(chapter.id));
  assert.equal(sourceChapters.length, chapterIds.size);
  const content = releaseFixture();
  for (const bookId of new Set(sourceChapters.map(chapter => chapter.bookId))) {
    const book = currentLibrary.catalog.books.find(book => book.id === bookId);
    content.library.catalog.books.push({ ...book, defaultChapter: sourceChapters.find(chapter => chapter.bookId === bookId).id });
  }
  content.library.chapters.push(...sourceChapters);
  content.passageIndex.coverage = { bookCount: content.library.catalog.books.length,
    chapterCount: content.library.chapters.length,
    paragraphCount: content.library.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0) };
  const qualificationParagraphs = new Set(qualificationSources.map(source => source.paragraphId));
  for (const paragraphId of qualificationParagraphs) {
    const actual = currentIndex.passages.find(passage => passage.spans.some(span => span.paragraphId === paragraphId));
    assert.ok(actual, `current qualification attribution: ${paragraphId}`);
    content.passageIndex.passages.push(structuredClone(actual));
  }
  const frozen = freezeContentRelease(content);
  const baselineStateSha256 = 'a'.repeat(64);
  const proof = { verified: true, fingerprint: frozen.fingerprint, baselineDatabaseSha256: baselineStateSha256,
    actualDumpRestoredForEveryAttempt: true, formalDatabaseWritten: false, success: { idempotent: true }, implementation: { sha256: '0'.repeat(64) } };
  let queryCount = 0;
  const client = { query: async () => { queryCount++; throw new Error('BEGIN reached'); } };
  const options = { expectedDatabase: 'ancient_history', allowFormal: true, baselineStateSha256, verification: proof };
  await assert.rejects(publishContentRelease(client, frozen, options), /implementation/i);
  assert.equal(queryCount, 0);

  content.passageIndex.passages = content.passageIndex.passages.map(passage => ({ ...passage,
    people: passage.people.filter(person => person.personId !== 'niu-cunjie'),
  })).filter(passage => passage.people.length > 0);
  const unattributed = freezeContentRelease(content);
  const matchingProof = { ...proof, fingerprint: unattributed.fingerprint, implementation: releaseImplementationFingerprint() };
  await assert.rejects(publishContentRelease(client, unattributed, { ...options, verification: matchingProof }), /association|attribution/i);
  assert.equal(queryCount, 0);

  const validProof = { ...matchingProof, fingerprint: frozen.fingerprint };
  await assert.rejects(publishContentRelease(client, frozen, { ...options, verification: validProof }), /BEGIN reached/);
  assert.equal(queryCount, 1, 'a valid proof reaches the transaction owner');
});

test('actual PostgreSQL batch rolls back every stage, publishes once and preserves old identities', async t => {
  const { default: pg } = await import('pg');
  const { randomBytes } = await import('node:crypto');
  const { readFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { loadConfig } = await import('../src/config.mjs');
  const { adminDatabase, pgBin } = await import('../scripts/runtime.mjs');
  const { sha256 } = await import('../src/backup-archive.mjs');
  const { loadLibrary } = await import('../../content/library.mjs');
  const { importLibrary } = await import('../scripts/import-library.mjs');
  const { importPersonPassages } = await import('../scripts/import-person-passages.mjs');
  const database = `history_content_release_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ ...adminDatabase(loadConfig()), database: 'postgres' });
  const client = new pg.Client({ ...adminDatabase(loadConfig()), database });
  let created = false, connected = false;
  const temporary = mkdtempSync('/private/tmp/history-release-test-');
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${database}`); created = true;
    await client.connect(); connected = true;
    const currentLibrary = loadLibrary(), oldIndex = JSON.parse(readFileSync(new URL('../../content/person-passages/index.json', import.meta.url), 'utf8'));
    // Other agents may have staged a new source/catalog before its generated
    // global index. This fixture uses those unchanged old associations with the
    // current full source/identity coverage, without writing shared files.
    oldIndex.coverage = { bookCount: currentLibrary.catalog.books.length, chapterCount: currentLibrary.chapters.length,
      paragraphCount: currentLibrary.chapters.reduce((n, ch) => n + ch.paragraphs.length, 0) };
    oldIndex.people = loadPassagePeople();
    await client.query('BEGIN');
    for (const file of ['001-initial.sql', '002-translation-metadata.sql', '003-translation-editor.sql']) await client.query(readFileSync(new URL(`../db/${file}`, import.meta.url), 'utf8'));
    await importLibrary(client, currentLibrary); await importPersonPassages(client, oldIndex, currentLibrary);
    await client.query("INSERT INTO translations(paragraph_id,original_revision,language,version,text,translator,status,metadata) VALUES ('beimeng-v017-p5',1,'zh-Hans',1,'既有公开译文','保留旧译','published','{\"origin\":\"ai\",\"humanReviewed\":false,\"reviewStatus\":\"pending\"}')");
    await client.query('CREATE TABLE release_test_sentinel(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text); INSERT INTO release_test_sentinel(value) VALUES (\'旧身份\')');
    await client.query('COMMIT');
    const content = releaseFixture();
    content.library.catalog.books.unshift(...currentLibrary.catalog.books);
    content.library.chapters.unshift(...currentLibrary.chapters);
    content.passageIndex.coverage = { bookCount: content.library.catalog.books.length, chapterCount: content.library.chapters.length,
      paragraphCount: content.library.chapters.reduce((n, ch) => n + ch.paragraphs.length, 0) };
    content.passageIndex.passages.unshift(...oldIndex.passages);
    const frozen = freezeContentRelease(content);
    await client.query("SET TIME ZONE 'UTC'");
    const oldFull = (await client.query('SELECT to_jsonb(t) AS record FROM translations t')).rows;
    const oldOriginal = currentLibrary.chapters.find(c => c.id === 'beimeng-v017').paragraphs[4];
    assert.doesNotMatch(oldOriginal.original, /[。？！]/u);
    content.correctionBatch = { schemaVersion: 1, batchId: 'test-release-correction', entries: [{ paragraphId: oldOriginal.id, expectedOriginalRevision: 1,
      originalSha256: textHash(oldOriginal.original), expectedTranslationId: '1', translationSha256: textHash('既有公开译文'), text: '追加校订，旧版本保持。', reviewNotes: [], resolution: '测试追加校订' }] };
    const oldBook = content.library.catalog.books.find(b => b.id === 'old');
    const expectedDescription = oldBook.description, description = expectedDescription + '；独立测试新增卷册。';
    const beforeBook = (await client.query(`SELECT to_jsonb(b) AS record,
      encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') AS before_hash,
      encode(sha256(convert_to((to_jsonb(b)||jsonb_build_object('description',$1::text))::text,'UTF8')),'hex') AS after_hash FROM books b WHERE id='old'`, [description])).rows[0];
    oldBook.description = description;
    content.bookMetadataUpdates = [{ id: 'old', expectedDescription, description }];
    content.allowedOldRowChanges = [{ table: 'books', key: '["old"]', beforeSha256: beforeBook.before_hash, afterSha256: beforeBook.after_hash }];
    const beforeMetadata = await snapshotReleaseDatabase(client);
    const wrongDescription = structuredClone(content); wrongDescription.bookMetadataUpdates[0].expectedDescription = '并非当前正式旧值';
    await assert.rejects(publishContentRelease(client, freezeContentRelease(wrongDescription), { expectedDatabase: database }), /book description conflict/);
    assert.deepEqual(await snapshotReleaseDatabase(client), beforeMetadata);
    const wrongAfterHash = structuredClone(content); wrongAfterHash.allowedOldRowChanges[0].afterSha256 = '0'.repeat(64);
    await assert.rejects(publishContentRelease(client, freezeContentRelease(wrongAfterHash), { expectedDatabase: database }), /book metadata after hash differs/);
    assert.deepEqual(await snapshotReleaseDatabase(client), beforeMetadata, 'wrong after hash rolls description update back');
    const baseline = await snapshotReleaseDatabase(client), dump = join(temporary, 'baseline.dump'), cfg = loadConfig();
    execFileSync(join(pgBin, 'pg_dump'), ['-Fc', '-h', cfg.socketDir, '-p', String(cfg.database.port), '-d', database, '-f', dump], { stdio: 'pipe' });
    content.baseline = { dumpSha256: sha256(readFileSync(dump)), databaseSha256: baseline.sha256 };
    const frozenWithCorrection = freezeContentRelease(content);
    const restoreVerified = await verifyContentReleaseFromDump(frozenWithCorrection, dump);
    assert.equal(restoreVerified.verified, true); assert.equal(restoreVerified.failures.length, 8);
    assert.equal(restoreVerified.success.fullInserts, 2); assert.equal(restoreVerified.success.permissionsVerified, true);
    assert.equal(restoreVerified.actualDumpRestoredForEveryAttempt, true); assert.equal(restoreVerified.formalDatabaseWritten, false);
    assert.deepEqual(await snapshotReleaseDatabase(client), baseline, 'restore verification never writes even its independent source database');
    for (const stage of releaseFaultStages) {
      const before = await snapshotReleaseDatabase(client);
      await assert.rejects(publishContentRelease(client, frozenWithCorrection, { expectedDatabase: database, faultAfter: stage }), new RegExp(`Injected content release failure: ${stage}`));
      const after = await snapshotReleaseDatabase(client);
      assert.deepEqual(after.tables, before.tables, `all old tables restored after ${stage}`);
      assert.deepEqual((await client.query('SELECT to_jsonb(t) AS record FROM translations t')).rows, oldFull);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM paragraphs WHERE id LIKE 'releasefixture-%'")).rows[0].n, 0);
      assert.deepEqual(after.sequences.release_test_sentinel_id_seq, before.sequences.release_test_sentinel_id_seq);
    }
    const first = await publishContentRelease(client, frozenWithCorrection, { expectedDatabase: database });
    const afterBook = (await client.query("SELECT to_jsonb(b) AS record FROM books b WHERE id='old'")).rows[0].record;
    assert.deepEqual(afterBook, { ...beforeBook.record, description }, 'only the approved description changes');
    assert.deepEqual(first.bookMetadataUpdates, [{ id: 'old', updated: true }]);
    assert.equal(first.newParagraphs, 1); assert.equal(first.publications[0].released, 1);
    assert.equal(first.sentences[0].inserted, 1);
    assert.equal(first.rebound.sentenceBatches[0].entries[0].parentTranslationId, first.rebound.alignments[0].translationId);
    const actualId = first.rebound.alignments[0].translationId;
    assert.notEqual(actualId, '1'); assert.equal(first.rebound.reviewBatches[0].items[0].translationId, actualId);
    const repeated = await publishContentRelease(client, frozenWithCorrection, { expectedDatabase: database });
    assert.equal(repeated.newParagraphs, 0); assert.equal(repeated.publications[0].released, 0);
    assert.equal(repeated.drafts[0].unchanged, 1); assert.equal(repeated.reviews[0].unchanged, 1);
    assert.deepEqual(repeated.bookMetadataUpdates, [{ id: 'old', updated: false }]);
    assert.deepEqual(repeated.database, first.database, 'idempotent retry preserves every row and sequence');
    assert.deepEqual((await client.query('SELECT to_jsonb(t) AS record FROM translations t WHERE id=1')).rows, oldFull);
    assert.deepEqual(first.database.sequences.release_test_sentinel_id_seq, { last_value: '1', is_called: true });
    await t.test('empty-review release restores private permissions without changing the existing baseline', async () => {
      const emptyBaseline = await snapshotReleaseDatabase(client), emptyDump = join(temporary, 'empty-review-baseline.dump');
      execFileSync(join(pgBin, 'pg_dump'), ['-Fc', '-h', cfg.socketDir, '-p', String(cfg.database.port), '-d', database, '-f', emptyDump], { stdio: 'pipe' });
      const empty = { schemaVersion: 1, id: 'test-content-release-empty-reviews', humanReviewed: false,
        baseline: { databaseSha256: emptyBaseline.sha256, dumpSha256: sha256(readFileSync(emptyDump)) },
        library: structuredClone(content.library), people: loadPassagePeople(), passageIndex: structuredClone(content.passageIndex),
        translationBatches: [], correctionBatch: null, alignments: [], sentenceBatches: [], timelines: [], reviewBatches: [] };
      const verified = await verifyContentReleaseFromDump(freezeContentRelease(empty), emptyDump);
      assert.equal(verified.verified, true);
      assert.equal(verified.failures.length, releaseFaultStages.length);
      assert.equal(verified.success.permissionsVerified, true);
      assert.equal(verified.success.idempotent, true);
      assert.equal(verified.success.fullInserts, 0);
      assert.equal(verified.success.eventInserts, 0);
      assert.deepEqual(verified.success.rebound.reviewBatches, []);
      assert.equal(verified.success.finalDatabaseSha256, emptyBaseline.sha256);
      assert.deepEqual(await snapshotReleaseDatabase(client), emptyBaseline, 'verification leaves its independent source database unchanged');
    });
    const beforeConflict = await snapshotReleaseDatabase(client);
    const lostIndex = structuredClone(content); lostIndex.passageIndex.passages.shift();
    await assert.rejects(publishContentRelease(client, freezeContentRelease(lostIndex), { expectedDatabase: database }), /protected old row differs/);
    assert.deepEqual(await snapshotReleaseDatabase(client), beforeConflict);
    const staleOwner = structuredClone(content); staleOwner.reviewBatches[0].items[0].translationSha256 = '0'.repeat(64);
    await assert.rejects(publishContentRelease(client, freezeContentRelease(staleOwner), { expectedDatabase: database }), /translation binding/);
    assert.deepEqual(await snapshotReleaseDatabase(client), beforeConflict);
    const conflict = structuredClone(content); conflict.library.chapters[0].paragraphs[0].original += '被改底本';
    // Existing source mismatch is rejected before importing, independently of
    // the complete index's own source checks.
    conflict.passageIndex.passages = conflict.passageIndex.passages.filter(p => !p.spans.some(s => s.paragraphId === conflict.library.chapters[0].paragraphs[0].id));
    await assert.rejects(publishContentRelease(client, freezeContentRelease(conflict), { expectedDatabase: database }), /existing original differs/);
    assert.deepEqual(await snapshotReleaseDatabase(client), beforeConflict);
  } finally {
    if (connected) await client.end();
    if (created) { assert.match(database, /^history_content_release_test_\d+_[a-f0-9]{10}$/); await admin.query(`DROP DATABASE ${database}`); }
    await admin.end();
    rmSync(temporary, { recursive: true, force: true });
  }
});
