// Explicit local administration. Never called by the public API or a scheduler.
import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase, localDir, pgBin } from './runtime.mjs';
import { digest, sha256 } from '../src/backup-archive.mjs';
import { verifyOwnerReviewPermissions } from '../src/owner-reviews.mjs';
import { ensureOwnerReviewSchema } from './import-review-items.mjs';
import { freezeContentRelease, validateContentRelease, publishContentRelease, snapshotReleaseDatabase, releaseFaultStages } from '../src/content-release-batch.mjs';
import { releaseImplementationFingerprint, validateMilitaryReleaseQualification } from '../src/content-release-implementation.mjs';
import { validateTimelineDocumentVerification } from '../src/content-release-timeline-guards.mjs';
import { validateFormalReleaseVerification } from '../src/content-release-verification.mjs';
export { releaseImplementationFingerprint, validateMilitaryReleaseQualification } from '../src/content-release-implementation.mjs';

const check = (ok, message) => { if (!ok) throw new Error(`Content release runner: ${message}`); };
const same = (a, b, message) => check(digest(a) === digest(b), message);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function privateOutput(path) {
  const output = resolve(path), rel = relative(localDir, output);
  check(rel && !rel.startsWith('..') && !rel.startsWith('/'), 'receipts and private drafts must stay inside backend/.local');
  check(!existsSync(output), 'output already exists; preserve prior frozen inputs and receipts');
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  return output;
}
function put(path, value) {
  const output = privateOutput(path);
  writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}

export async function verifyContentReleaseFromDump(frozen, dumpFile, { config = loadConfig(), progress = () => {} } = {}) {
  const content = validateContentRelease(frozen);
  validateMilitaryReleaseQualification(content);
  const bytes = readFileSync(dumpFile), dumpSha256 = sha256(bytes);
  check(bytes.subarray(0, 5).toString('ascii') === 'PGDMP', 'expected actual PostgreSQL custom backup');
  check(content.baseline?.dumpSha256 === dumpSha256 && /^[a-f0-9]{64}$/.test(content.baseline?.databaseSha256 ?? ''), 'frozen actual baseline dump/state binding');
  const implementation = releaseImplementationFingerprint();
  const admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
  await admin.connect();
  const failures = [];
  let success;
  const withRestore = async (label, action) => {
    const database = `history_content_release_test_${process.pid}_${randomBytes(5).toString('hex')}`;
    let created = false, client;
    try {
      await admin.query(`CREATE DATABASE ${quote(database)} TEMPLATE template0`); created = true;
      await admin.query(`REVOKE CONNECT ON DATABASE ${quote(database)} FROM PUBLIC`);
      execFileSync(join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '-h', config.socketDir, '-p', String(config.database.port),
        '-U', userInfo().username, '-d', database, resolve(dumpFile)], { stdio: 'pipe' });
      client = new pg.Client({ ...adminDatabase(config), database }); await client.connect();
      const before = await snapshotReleaseDatabase(client);
      check(before.sha256 === content.baseline.databaseSha256, 'actual restored baseline differs from frozen inventory');
      // --no-acl restores functions with default PUBLIC EXECUTE. Empty-review
      // releases do not run the importer that reapplies these private ACLs.
      if (content.reviewBatches.length === 0 && before.tables.owner_review_subjects) {
        await ensureOwnerReviewSchema(client);
        same(await snapshotReleaseDatabase(client), before, 'restored private permission setup changed baseline inventory');
        await verifyOwnerReviewPermissions(client);
      }
      const result = await action(client, database, before);
      progress({ stage: label, verified: true }); return result;
    } finally {
      if (client) await client.end();
      if (created) { check(/^history_content_release_test_\d+_[a-f0-9]{10}$/.test(database), 'unsafe isolated database cleanup'); await admin.query(`DROP DATABASE ${quote(database)}`); }
    }
  };
  try {
    for (const stage of releaseFaultStages) failures.push(await withRestore(stage, async (client, database, before) => {
      let caught;
      try { await publishContentRelease(client, frozen, { expectedDatabase: database, baselineStateSha256: before.sha256, faultAfter: stage }); }
      catch (error) { caught = error; }
      check(caught?.message === `Injected content release failure: ${stage}`, `did not reach intended failure stage ${stage}`);
      const after = await snapshotReleaseDatabase(client);
      same(before.tables, after.tables, `failed batch changed old rows at ${stage}`);
      same(before.schemaSha256, after.schemaSha256, `failed batch changed schema at ${stage}`);
      // nextval is not transactional. Each fault gets a fresh actual restore;
      // no production sequence is reset to hide gaps created by a failure.
      for (const [name, value] of Object.entries(before.sequences)) {
        const afterValue = after.sequences[name]; check(afterValue, 'old sequence removed');
        if (name === 'translations_id_seq' || name === 'owner_review_events_id_seq') check(BigInt(afterValue.last_value) >= BigInt(value.last_value), 'identity sequence regressed');
        else same(value, afterValue, `unrelated sequence changed ${name}`);
      }
      return { stage, verified: true, oldRowsAndSchemaPreserved: true, sequenceGapsPossible: true };
    }));
    success = await withRestore('publication-and-idempotence', async (client, database, before) => {
      const first = await publishContentRelease(client, frozen, { expectedDatabase: database, baselineStateSha256: before.sha256 });
      const repeated = await publishContentRelease(client, frozen, { expectedDatabase: database });
      same(first.database, repeated.database, 'duplicate import changed any row, schema or sequence');
      const timelineDocumentGuards = { first: first.timelineDocumentGuards, repeated: repeated.timelineDocumentGuards };
      validateTimelineDocumentVerification(content, timelineDocumentGuards);
      await verifyOwnerReviewPermissions(client);
      const fullInserts = first.drafts.reduce((n, b) => n + b.inserted, 0) + (first.corrections?.inserted ?? 0);
      const eventInserts = first.reviews.reduce((n, b) => n + b.inserted + b.updated, 0);
      for (const [name, value] of Object.entries(before.sequences)) {
        const delta = name === 'translations_id_seq' ? fullInserts : name === 'owner_review_events_id_seq' ? eventInserts : 0;
        const after = first.database.sequences[name];
        check(BigInt(after.last_value) === BigInt(value.last_value) + BigInt(delta), `unexpected sequence increment ${name}`);
        check(after.is_called === (delta > 0 ? true : value.is_called), `unexpected sequence call state ${name}`);
      }
      return { verified: true, oldRowsPreserved: true, sequenceDeltasVerified: true, idempotent: true, permissionsVerified: true,
        newParagraphs: first.newParagraphs, fullInserts, eventInserts, timelineDocumentGuards, rebound: first.rebound, finalDatabaseSha256: first.database.sha256 };
    });
    same(releaseImplementationFingerprint(), implementation, 'implementation changed during isolated verification');
    const verified = { schemaVersion: 1, verified: true, checkedAt: new Date().toISOString(), fingerprint: frozen.fingerprint, implementation,
      baselineDumpSha256: dumpSha256, baselineDatabaseSha256: content.baseline.databaseSha256, failures, success,
      actualDumpRestoredForEveryAttempt: true, formalDatabaseWritten: false, humanReviewed: false };
    validateFormalReleaseVerification(frozen, verified, { baselineStateSha256: content.baseline.databaseSha256 });
    return verified;
  } finally { await admin.end(); }
}

export async function runContentReleaseCli(args) {
  process.umask(0o077);
  const [command, input, ...rest] = args;
  if (command === 'prepare') {
    check(input && rest.length === 1, 'prepare CONTENT.json FROZEN.json');
    const frozen = freezeContentRelease(read(input)); put(rest[0], frozen);
    return { prepared: true, fingerprint: frozen.fingerprint };
  }
  if (command === 'verify') {
    check(input && rest.length === 2, 'verify FROZEN.json BASELINE.dump RECEIPT.json');
    privateOutput(rest[1]);
    const result = await verifyContentReleaseFromDump(read(input), rest[0], { progress: value => console.error(JSON.stringify(value)) });
    put(rest[1], result); return { verified: true, fingerprint: result.fingerprint, failureStages: result.failures.length };
  }
  if (command === 'publish') {
    check(input && rest.length === 4 && rest[3] === '--allow-formal', 'publish FROZEN.json VERIFIED.json DATABASE RECEIPT.json --allow-formal');
    const frozen = read(input), content = validateContentRelease(frozen), verified = read(rest[0]);
    validateFormalReleaseVerification(frozen, verified, { baselineStateSha256: content.baseline?.databaseSha256 });
    validateMilitaryReleaseQualification(content);
    const config = loadConfig();
    check(rest[1] === config.database.database, 'formal database must exactly match configured database');
    check(!existsSync(resolve(rest[2])), 'formal publication receipt already exists; inspect it rather than overwriting');
    privateOutput(rest[2]);
    const client = new pg.Client(adminDatabase(config));
    try {
      await client.connect();
      const result = await publishContentRelease(client, frozen, { expectedDatabase: rest[1], allowFormal: true, baselineStateSha256: verified.baselineDatabaseSha256, verification: verified });
      put(rest[2], { ...result, implementation: verified.implementation, isolatedVerificationSha256: sha256(readFileSync(rest[0])) });
      return { committed: true, fingerprint: result.fingerprint, newParagraphs: result.newParagraphs };
    } finally { await client.end(); }
  }
  throw new Error('Use prepare, verify, or explicit publish. No default action writes a database.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runContentReleaseCli(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
