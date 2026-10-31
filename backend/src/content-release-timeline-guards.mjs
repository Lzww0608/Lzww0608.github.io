// Local content administration only. The transaction owner supplies its same pg client.
import { digest } from './backup-archive.mjs';
import { timelineHash } from '../../content/person-timelines.mjs';

const check = (ok, message) => { if (!ok) throw new Error(`Content release timeline guard: ${message}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const personId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (left, right) => digest(left) === digest(right);
const documentIdentity = (document, identity) => plain(document) && document.personId === identity
  && document.schemaVersion === 1 && document.scope === 'current-archive'
  && Array.isArray(document.events) && document.events.length > 0 && document.events.length <= 500
  && document.events.every(event => plain(event) && typeof event.id === 'string' && event.id)
  && new Set(document.events.map(event => event.id)).size === document.events.length;

// expectedBefore is the full, finally reviewed JSON document from the actual
// release baseline, or null only for a new timeline. The target is already in
// content.timelines; bind it explicitly without duplicating another after copy.
export function validateTimelineDocumentGuards(timelines, guards) {
  check(Array.isArray(timelines), 'timelines must be an array');
  const documents = new Map();
  for (const document of timelines) {
    check(plain(document) && personId(document.personId) && !documents.has(document.personId)
      && documentIdentity(document, document.personId), 'duplicate or invalid target person');
    documents.set(document.personId, document);
  }
  if (guards === undefined && timelines.length === 0) return [];
  check(Array.isArray(guards) && guards.length === documents.size, 'one explicit guard per included timeline is required');
  const seen = new Set();
  for (const guard of guards) {
    check(plain(guard) && Object.keys(guard).length === 3
      && Object.keys(guard).every(key => ['personId', 'expectedBefore', 'expectedAfterSha256'].includes(key))
      && personId(guard.personId) && documents.has(guard.personId) && !seen.has(guard.personId), 'invalid or duplicate guard');
    seen.add(guard.personId);
    check(checksum(guard.expectedAfterSha256) && guard.expectedAfterSha256 === digest(documents.get(guard.personId)), `target document binding differs ${guard.personId}`);
    if (guard.expectedBefore !== null) {
      const before = guard.expectedBefore;
      check(documentIdentity(before, guard.personId), `invalid expectedBefore ${guard.personId}`);
      const targetIds = new Set(documents.get(guard.personId).events.map(event => event.id));
      check(before.events.every(event => targetIds.has(event.id)), `old event identity removed ${guard.personId}`);
    }
  }
  return guards;
}

// No BEGIN/COMMIT and no schema setup here. This is called only inside the
// publisher's existing outer SERIALIZABLE transaction. The table lock also
// protects missing included rows from concurrent insertion; FOR UPDATE locks
// the actual existing documents, rather than trusting static source files.
export async function readReleaseTimelineDocuments(client, timelines, { lock = false } = {}) {
  check(typeof client?.query === 'function', 'transaction client required');
  const ids = timelines.map(document => document.personId).sort();
  if (ids.length === 0) return [];
  const relation = (await client.query("SELECT to_regclass('public.person_timelines')::text AS relation")).rows[0]?.relation;
  if (relation === null) return [];
  check(typeof relation === 'string' && relation.length > 0, 'timeline table lookup failed');
  if (lock) await client.query('LOCK TABLE public.person_timelines IN SHARE ROW EXCLUSIVE MODE');
  return (await client.query(`SELECT t.person_id AS "personId",t.document,t.digest,
    encode(sha256(convert_to((to_jsonb(t)-'document'-'digest'-'updated_at')::text,'UTF8')),'hex') AS "staticSha256"
    FROM public.person_timelines t WHERE t.person_id=ANY($1::text[]) ORDER BY t.person_id${lock ? ' FOR UPDATE' : ''}`, [ids])).rows;
}

function actualDocuments(rows, target) {
  check(Array.isArray(rows), 'actual rows must be an array');
  const actual = new Map();
  for (const row of rows) {
    check(plain(row) && target.has(row.personId) && !actual.has(row.personId) && plain(row.document)
      && checksum(row.digest) && checksum(row.staticSha256), 'unexpected, duplicate or invalid actual document/row binding');
    actual.set(row.personId, row);
  }
  return actual;
}
const staticRowsHash = rows => digest([...rows.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))
  .map(([identity, row]) => [identity, row.staticSha256]));

export function assertReleaseTimelineDocuments(content, rows, stage, { beforeRows } = {}) {
  const guards = validateTimelineDocumentGuards(content.timelines, content.timelineDocumentGuards);
  check(['before', 'after'].includes(stage) && Array.isArray(rows), 'invalid stage or rows');
  const target = new Map(content.timelines.map(document => [document.personId, document]));
  const actual = actualDocuments(rows, target);
  // This is the importer's existing storage algorithm, deliberately distinct
  // from the canonical JSON digest used for approval and frozen input binding.
  const storedDigests = new Map(content.timelines.map(document => [document.personId, timelineHash(JSON.stringify(document))]));
  const binding = { people: guards.length, guardsSha256: digest(guards), targetsSha256: digest(content.timelines), storedDigestsSha256: digest([...storedDigests]) };
  const completeAfter = guards.every(guard => actual.has(guard.personId) && same(actual.get(guard.personId).document, target.get(guard.personId)));
  if (stage === 'after') {
    check(completeAfter, 'write-after document differs before COMMIT');
    const previous = actualDocuments(beforeRows ?? (guards.length === 0 ? [] : undefined), target);
    for (const [identity, row] of actual) check(row.digest === storedDigests.get(identity), `stored digest differs before COMMIT ${identity}`);
    const protectedAfter = new Map();
    for (const [identity, old] of previous) {
      const current = actual.get(identity);
      check(current?.staticSha256 === old.staticSha256, `static old row differs before COMMIT ${identity}`);
      protectedAfter.set(identity, current);
    }
    return { ...binding, stage, mode: guards.length === 0 ? 'empty' : 'after', existingRows: actual.size,
      protectedExistingRows: previous.size, staticRowsBeforeSha256: staticRowsHash(previous), staticRowsAfterSha256: staticRowsHash(protectedAfter),
      staticRowsPreserved: true, storedDigestsVerified: true };
  }
  const observed = { ...binding, stage, existingRows: actual.size, staticRowsSha256: staticRowsHash(actual) };
  if (guards.length === 0) return { ...observed, mode: 'empty' };
  // Prefer complete-after if before and after happen to be identical. This
  // permits a true no-op and produces the same repeat receipt as a changed batch.
  if (completeAfter) return { ...observed, mode: 'already-applied' };
  const completeBefore = guards.every(guard => guard.expectedBefore === null
    ? !actual.has(guard.personId) : actual.has(guard.personId) && same(actual.get(guard.personId).document, guard.expectedBefore));
  check(completeBefore, 'write-before document differs; partial before/after mixtures are not accepted');
  return { ...observed, mode: 'before' };
}

// Consumed by the isolated verifier and direct formal publisher. An old proof
// without both actual transaction receipts cannot attest the new protection.
export function validateTimelineDocumentVerification(content, verification) {
  const guards = validateTimelineDocumentGuards(content.timelines, content.timelineDocumentGuards);
  const binding = { people: guards.length, guardsSha256: digest(guards), targetsSha256: digest(content.timelines),
    storedDigestsSha256: digest(content.timelines.map(document => [document.personId, timelineHash(JSON.stringify(document))])) };
  const verify = (receipt, stage, modes) => {
    check(plain(receipt) && receipt.stage === stage && modes.includes(receipt.mode)
      && receipt.people === binding.people && receipt.guardsSha256 === binding.guardsSha256
      && receipt.targetsSha256 === binding.targetsSha256 && receipt.storedDigestsSha256 === binding.storedDigestsSha256,
    'actual isolated document verification is missing or differs');
  };
  const empty = guards.length === 0;
  verify(verification?.first?.before, 'before', empty ? ['empty'] : ['before', 'already-applied']);
  verify(verification?.first?.after, 'after', empty ? ['empty'] : ['after']);
  verify(verification?.repeated?.before, 'before', empty ? ['empty'] : ['already-applied']);
  verify(verification?.repeated?.after, 'after', empty ? ['empty'] : ['after']);
  for (const attempt of [verification.first, verification.repeated]) {
    const before = attempt.before, after = attempt.after;
    check(Number.isSafeInteger(before.existingRows) && before.existingRows >= 0 && before.existingRows <= guards.length
      && before.existingRows === (before.mode === 'before' ? guards.filter(guard => guard.expectedBefore !== null).length : guards.length)
      && checksum(before.staticRowsSha256) && after.existingRows === guards.length
      && after.protectedExistingRows === before.existingRows && after.staticRowsBeforeSha256 === before.staticRowsSha256
      && after.staticRowsAfterSha256 === before.staticRowsSha256 && after.staticRowsPreserved === true && after.storedDigestsVerified === true,
    'actual isolated static-row or stored-digest verification is missing or differs');
  }
  return true;
}
