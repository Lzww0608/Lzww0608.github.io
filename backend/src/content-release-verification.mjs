// One formal-proof contract for both the CLI and the exported transaction owner.
import { digest } from './backup-archive.mjs';
import { releaseImplementationFingerprint } from './content-release-implementation.mjs';
import { validateTimelineDocumentVerification } from './content-release-timeline-guards.mjs';

export const releaseFaultStages = Object.freeze(['sources', 'drafts', 'publication', 'corrections', 'sentences', 'passages', 'timelines', 'reviews', 'timeline-documents']);
const check = (ok, message) => { if (!ok) throw new Error(`Content release verification: ${message}`); };
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const parent = (value, identity, version) => typeof value[identity] === 'string' && /^[1-9][0-9]*$/.test(value[identity])
  && Number.isSafeInteger(value[version]) && value[version] > 0;
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

function validateRebound(content, rebound) {
  check(plain(rebound) && ['alignments', 'sentenceBatches', 'reviewBatches'].every(key => Array.isArray(rebound[key])
    && rebound[key].length === content[key].length), 'successful rebound coverage differs');
  const alignments = rebound.alignments.map(value => {
    check(plain(value) && parent(value, 'translationId', 'translationVersion'), 'successful alignment parent binding missing');
    return without(value, ['translationId', 'translationVersion']);
  });
  check(digest(alignments) === digest(content.alignments.map(value => without(value, ['translationId', 'translationVersion']))), 'successful alignment content differs');
  const sentenceBatches = rebound.sentenceBatches.map(batch => {
    check(plain(batch) && Array.isArray(batch.entries), 'successful sentence batch missing');
    return { ...batch, entries: batch.entries.map(value => {
      check(plain(value) && parent(value, 'parentTranslationId', 'parentTranslationVersion'), 'successful sentence parent binding missing');
      return without(value, ['parentTranslationId', 'parentTranslationVersion']);
    }) };
  });
  check(digest(sentenceBatches) === digest(content.sentenceBatches.map(batch => ({ ...batch,
    entries: batch.entries.map(value => without(value, ['parentTranslationId', 'parentTranslationVersion'])) }))), 'successful sentence content differs');
  const reviewBatches = rebound.reviewBatches.map(batch => {
    check(plain(batch) && Array.isArray(batch.items), 'successful review batch missing');
    return { ...batch, items: batch.items.map(value => {
      check(plain(value) && (value.translationSha256 === null
        ? value.translationId === null && value.translationVersion === null : parent(value, 'translationId', 'translationVersion')), 'successful review parent binding missing');
      return without(value, ['translationId', 'translationVersion']);
    }) };
  });
  check(digest(reviewBatches) === digest(content.reviewBatches.map(batch => ({ ...batch,
    items: batch.items.map(value => without(value, ['translationId', 'translationVersion'])) }))), 'successful review content differs');
}

export function validateFormalReleaseVerification(frozen, verification, { baselineStateSha256, faultAfter = null } = {}) {
  check(plain(verification) && verification.schemaVersion === 1 && verification.verified === true
    && verification.actualDumpRestoredForEveryAttempt === true && verification.formalDatabaseWritten === false
    && verification.humanReviewed === false, 'actual isolated verification with explicit provenance is required');
  check(plain(frozen) && frozen.schemaVersion === 1 && checksum(frozen.fingerprint) && plain(frozen.content)
    && frozen.content.schemaVersion === 1 && frozen.content.humanReviewed === false
    && digest(frozen.content) === frozen.fingerprint && verification.fingerprint === frozen.fingerprint, 'frozen release fingerprint differs');
  const content = frozen.content;
  check(checksum(content.baseline?.dumpSha256) && checksum(content.baseline?.databaseSha256) && checksum(baselineStateSha256)
    && verification.baselineDumpSha256 === content.baseline.dumpSha256
    && verification.baselineDatabaseSha256 === content.baseline.databaseSha256
    && verification.baselineDatabaseSha256 === baselineStateSha256, 'actual baseline dump/database binding differs');
  check(typeof verification.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(verification.checkedAt)
    && Number.isFinite(Date.parse(verification.checkedAt)) && new Date(verification.checkedAt).toISOString() === verification.checkedAt,
  'verification timestamp is missing or invalid');
  check(faultAfter === null, 'formal publication cannot inject a failure');
  check(Array.isArray(verification.failures) && verification.failures.length === releaseFaultStages.length
    && new Set(verification.failures.map(value => value?.stage)).size === releaseFaultStages.length
    && verification.failures.every(value => plain(value) && releaseFaultStages.includes(value.stage) && value.verified === true
      && value.oldRowsAndSchemaPreserved === true && value.sequenceGapsPossible === true), 'complete unique failure-stage verification is required');
  const success = verification.success;
  check(plain(success) && success.verified === true && success.oldRowsPreserved === true && success.sequenceDeltasVerified === true
    && success.idempotent === true && success.permissionsVerified === true && checksum(success.finalDatabaseSha256)
    && count(success.newParagraphs) && count(success.fullInserts) && count(success.eventInserts), 'complete successful idempotence/permissions verification is required');
  check(success.newParagraphs <= content.library.chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0)
    && success.fullInserts <= content.translationBatches.reduce((total, batch) => total + batch.entries.length, 0) + (content.correctionBatch?.entries.length ?? 0)
    && success.eventInserts <= content.reviewBatches.reduce((total, batch) => total + batch.items.length, 0), 'successful insertion counts exceed frozen inputs');
  check(plain(verification.implementation) && checksum(verification.implementation.sha256) && plain(verification.implementation.files)
    && digest(verification.implementation) === digest(releaseImplementationFingerprint()), 'verified implementation differs');
  validateRebound(content, success.rebound);
  validateTimelineDocumentVerification(content, success.timelineDocumentGuards);
  return true;
}
