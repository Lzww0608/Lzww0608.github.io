import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../src/backup-archive.mjs';
import { timelineHash } from '../../content/person-timelines.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { freezeContentRelease, publishContentRelease } from '../src/content-release-batch.mjs';
import { releaseImplementationFingerprint } from '../src/content-release-implementation.mjs';
import { assertReleaseTimelineDocuments } from '../src/content-release-timeline-guards.mjs';
import { validateFormalReleaseVerification, releaseFaultStages } from '../src/content-release-verification.mjs';
import { runContentReleaseCli } from '../scripts/release-content-batch.mjs';

// This proof is a complete structural unit fixture, not a claim of actual
// restoration. It uses no pg client and contains no published translation IDs.
const library = loadLibrary();
const document = JSON.parse(readFileSync(new URL('../../content/person-timelines/zhu-wen.json', import.meta.url), 'utf8'));
const baselineDatabaseSha256 = 'a'.repeat(64), baselineDumpSha256 = 'b'.repeat(64);
const content = { schemaVersion: 1, id: 'test-complete-formal-proof', humanReviewed: false,
  library, people: loadPassagePeople(), passageIndex: loadPersonPassageIndex(library),
  translationBatches: [], sentenceBatches: [], alignments: [], reviewBatches: [], timelines: [document],
  timelineDocumentGuards: [{ personId: document.personId, expectedBefore: null, expectedAfterSha256: digest(document) }],
  baseline: { databaseSha256: baselineDatabaseSha256, dumpSha256: baselineDumpSha256 } };
const frozen = freezeContentRelease(content);
const targetRows = [{ personId: document.personId, document, digest: timelineHash(JSON.stringify(document)),
  staticSha256: digest({ person_id: document.personId }) }];
const firstBefore = assertReleaseTimelineDocuments(content, [], 'before');
const firstAfter = assertReleaseTimelineDocuments(content, targetRows, 'after', { beforeRows: [] });
const repeatBefore = assertReleaseTimelineDocuments(content, targetRows, 'before');
const repeatAfter = assertReleaseTimelineDocuments(content, targetRows, 'after', { beforeRows: targetRows });
const completeProof = { schemaVersion: 1, verified: true, checkedAt: '2026-10-31T00:00:00.000Z', humanReviewed: false,
  fingerprint: frozen.fingerprint, baselineDatabaseSha256, baselineDumpSha256,
  actualDumpRestoredForEveryAttempt: true, formalDatabaseWritten: false, implementation: releaseImplementationFingerprint(),
  failures: releaseFaultStages.map(stage => ({ stage, verified: true, oldRowsAndSchemaPreserved: true, sequenceGapsPossible: true })),
  success: { verified: true, oldRowsPreserved: true, sequenceDeltasVerified: true, idempotent: true, permissionsVerified: true,
    newParagraphs: 0, fullInserts: 0, eventInserts: 0, finalDatabaseSha256: 'c'.repeat(64),
    rebound: { alignments: [], sentenceBatches: [], reviewBatches: [] },
    timelineDocumentGuards: { first: { before: firstBefore, after: firstAfter }, repeated: { before: repeatBefore, after: repeatAfter } } } };

const invalidProofs = [
  ['missing-all-failures', proof => { delete proof.failures; }],
  ['missing-ninth-stage', proof => { proof.failures = proof.failures.filter(value => value.stage !== 'timeline-documents'); }],
  ['duplicate-nine-stages', proof => { proof.failures = releaseFaultStages.map(() => ({ stage: 'sources', verified: true, oldRowsAndSchemaPreserved: true, sequenceGapsPossible: true })); }],
  ['unknown-stage', proof => { proof.failures[0].stage = 'unknown'; }],
  ['unverified-stage', proof => { proof.failures[0].verified = false; }],
  ['unpreserved-stage', proof => { proof.failures[0].oldRowsAndSchemaPreserved = false; }],
  ['missing-stage-sequence-evidence', proof => { delete proof.failures[0].sequenceGapsPossible; }],
  ['missing-permissions', proof => { delete proof.success.permissionsVerified; }],
  ['false-permissions', proof => { proof.success.permissionsVerified = false; }],
  ['unverified-success', proof => { proof.success.verified = false; }],
  ['false-idempotence', proof => { proof.success.idempotent = false; }],
  ['missing-success-sequences', proof => { delete proof.success.sequenceDeltasVerified; }],
  ['false-old-row-preservation', proof => { proof.success.oldRowsPreserved = false; }],
  ['wrong-dump-binding', proof => { proof.baselineDumpSha256 = 'd'.repeat(64); }],
  ['missing-dump-binding', proof => { delete proof.baselineDumpSha256; }],
  ['wrong-database-binding', proof => { proof.baselineDatabaseSha256 = 'd'.repeat(64); }],
  ['wrong-frozen-fingerprint', proof => { proof.fingerprint = 'd'.repeat(64); }],
  ['no-actual-dump-restoration', proof => { proof.actualDumpRestoredForEveryAttempt = false; }],
  ['proof-already-wrote-formal-db', proof => { proof.formalDatabaseWritten = true; }],
  ['wrong-schema', proof => { proof.schemaVersion = 2; }],
  ['false-human-provenance', proof => { proof.humanReviewed = true; }],
  ['invalid-checked-at', proof => { proof.checkedAt = 'not-a-date'; }],
  ['stale-implementation', proof => { proof.implementation.sha256 = 'd'.repeat(64); }],
  ['missing-implementation', proof => { delete proof.implementation; }],
  ['invalid-final-state', proof => { proof.success.finalDatabaseSha256 = 'invalid'; }],
  ['impossible-insert-count', proof => { proof.success.fullInserts = 1; }],
  ['missing-rebound', proof => { delete proof.success.rebound; }],
  ['wrong-rebound-coverage', proof => { proof.success.rebound.alignments.push({}); }],
  ['missing-document-receipts', proof => { delete proof.success.timelineDocumentGuards; }],
  ['wrong-stored-digest-receipt', proof => { proof.success.timelineDocumentGuards.first.after.storedDigestsSha256 = 'd'.repeat(64); }],
  ['false-static-row-check', proof => { proof.success.timelineDocumentGuards.first.after.staticRowsPreserved = false; }],
  ['wrong-static-row-binding', proof => { proof.success.timelineDocumentGuards.first.after.staticRowsAfterSha256 = 'd'.repeat(64); }],
];

for (const [name, mutate] of invalidProofs) {
  test(`direct formal publisher rejects ${name} before BEGIN`, async () => {
    const proof = structuredClone(completeProof); mutate(proof);
    const calls = [];
    const client = { query: async sql => { calls.push(sql); throw new Error('SYNTHETIC_BEGIN_REACHED'); } };
    await assert.rejects(publishContentRelease(client, frozen, { expectedDatabase: 'synthetic_formal_identity', allowFormal: true,
      baselineStateSha256: baselineDatabaseSha256, verification: proof }), /Content release (?:verification|timeline guard)/);
    assert.deepEqual(calls, []);
  });
}

test('only a complete current structural fixture reaches the direct publisher BEGIN', async () => {
  assert.equal(validateFormalReleaseVerification(frozen, completeProof, { baselineStateSha256: baselineDatabaseSha256 }), true);
  const calls = [], client = { query: async sql => { calls.push(sql); throw new Error('SYNTHETIC_BEGIN_REACHED'); } };
  await assert.rejects(publishContentRelease(client, frozen, { expectedDatabase: 'synthetic_formal_identity', allowFormal: true,
    baselineStateSha256: baselineDatabaseSha256, verification: completeProof }), /SYNTHETIC_BEGIN_REACHED/);
  assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL SERIALIZABLE']);
});

test('the explicit formal baseline parameter and disabled fault injection are also checked before BEGIN', async () => {
  for (const overrides of [{ baselineStateSha256: 'd'.repeat(64) }, { baselineStateSha256: undefined }, { faultAfter: 'sources' }]) {
    let queries = 0;
    await assert.rejects(publishContentRelease({ query: async () => { queries++; throw new Error('SYNTHETIC_BEGIN_REACHED'); } }, frozen,
      { expectedDatabase: 'synthetic_formal_identity', allowFormal: true, baselineStateSha256: baselineDatabaseSha256,
        verification: completeProof, ...overrides }), /Content release verification/);
    assert.equal(queries, 0);
  }
});

test('CLI uses the same validator for the original six counterexamples before loading configuration', async () => {
  const local = new URL('../.local/', import.meta.url); mkdirSync(local, { recursive: true });
  const directory = mkdtempSync(new URL('verification-proof-', local));
  try {
    const frozenPath = join(directory, 'frozen.json'), proofPath = join(directory, 'proof.json');
    writeFileSync(frozenPath, JSON.stringify(frozen));
    for (const name of ['missing-all-failures', 'missing-ninth-stage', 'duplicate-nine-stages', 'missing-permissions', 'false-permissions', 'wrong-dump-binding']) {
      const proof = structuredClone(completeProof); invalidProofs.find(value => value[0] === name)[1](proof);
      writeFileSync(proofPath, JSON.stringify(proof));
      await assert.rejects(runContentReleaseCli(['publish', frozenPath, proofPath, 'not-configured-formal-fixture', join(directory, 'receipt.json'), '--allow-formal']),
        /Content release verification/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('all three proof consumers import the single validator and its fault-stage definition', () => {
  const publisher = readFileSync(new URL('../src/content-release-batch.mjs', import.meta.url), 'utf8');
  const runner = readFileSync(new URL('../scripts/release-content-batch.mjs', import.meta.url), 'utf8');
  const implementation = readFileSync(new URL('../src/content-release-implementation.mjs', import.meta.url), 'utf8');
  assert.match(publisher, /validateFormalReleaseVerification\(frozen, verification, \{ baselineStateSha256, faultAfter \}\)/);
  assert.match(runner, /validateFormalReleaseVerification\(frozen, verified, \{ baselineStateSha256: content\.baseline\.databaseSha256 \}\)/);
  assert.match(runner, /validateFormalReleaseVerification\(frozen, verified, \{ baselineStateSha256: content\.baseline\?\.databaseSha256 \}\)/);
  assert.match(implementation, /'src\/content-release-verification\.mjs'/);
  assert.equal(releaseFaultStages.length, 9); assert.equal(new Set(releaseFaultStages).size, 9);
});
