import { createHash, timingSafeEqual } from 'node:crypto';
import { createOwnerReviews } from './owner-reviews.mjs';

export class TranslationEditorError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'TranslationEditorError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}
const invalid = message => { throw new TranslationEditorError(400, 'invalid-input', message); };
const characterLength = value => Array.from(value).length;
function textValue(value, name, maximum, { singleLine = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || characterLength(value) > maximum
    || value.includes('\0') || !value.isWellFormed()
    || (singleLine && /[\u0000-\u001f\u007f]/u.test(value))) invalid(`Invalid ${name}.`);
  return value;
}

export function createTranslationEditor({ pool, tokenSha256 }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('An editor database pool is required.');
  if (typeof tokenSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(tokenSha256)) {
    throw new TypeError('A SHA256 editor credential digest is required.');
  }
  const expectedToken = Buffer.from(tokenSha256, 'hex');
  return {
    ...createOwnerReviews({ pool }),
    authenticate(header) {
      if (typeof header !== 'string' || header.length > 520) return false;
      const matched = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(header);
      if (!matched || header.trim() !== header) return false;
      const actualToken = createHash('sha256').update(matched[1], 'utf8').digest();
      return timingSafeEqual(expectedToken, actualToken);
    },
    async revise(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid('A revision object is required.');
      const permitted = new Set(['paragraphId', 'expectedOriginalRevision', 'expectedTranslationId', 'text', 'editorName', 'reviewNotes']);
      if (Object.keys(payload).some(key => !permitted.has(key))) invalid('Unexpected revision field.');
      const { paragraphId, expectedOriginalRevision, text, editorName } = payload;
      if (typeof paragraphId !== 'string' || paragraphId.length > 160
        || !/^[a-z0-9][a-z0-9_-]*$/u.test(paragraphId) || paragraphId.trim() !== paragraphId) {
        invalid('Invalid paragraph ID.');
      }
      if (!Number.isInteger(expectedOriginalRevision) || expectedOriginalRevision < 1 || expectedOriginalRevision > 2147483647) {
        invalid('Invalid original revision.');
      }
      const id = typeof payload.expectedTranslationId === 'number' && Number.isSafeInteger(payload.expectedTranslationId)
        ? String(payload.expectedTranslationId) : payload.expectedTranslationId;
      if (typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(id) || id.trim() !== id || BigInt(id) > 9223372036854775807n) {
        invalid('Invalid translation ID.');
      }
      textValue(text, 'translation text', 20000);
      textValue(editorName, 'editor name', 80, { singleLine: true });
      const reviewNotes = payload.reviewNotes === undefined ? [] : payload.reviewNotes;
      if (!Array.isArray(reviewNotes) || reviewNotes.length > 20) invalid('Invalid review notes.');
      for (const note of reviewNotes) textValue(note, 'review note', 2000);
      try {
        const { rows } = await pool.query(
          'SELECT public.revise_published_translation($1::text,$2::integer,$3::bigint,$4::text,$5::text,$6::jsonb) AS result',
          [paragraphId, expectedOriginalRevision, id, text, editorName, JSON.stringify(reviewNotes)]
        );
        return rows[0].result;
      } catch (error) {
        if (error.code === 'PT400' || error.code === '22003' || error.code === '22P02') {
          throw new TranslationEditorError(400, 'invalid-input', 'Invalid translation revision input.');
        }
        if (error.code === 'PT404') throw new TranslationEditorError(404, 'not-found', 'Published paragraph or translation not found.');
        if (error.code === 'PT409' || error.code === '23505' || error.code === '40001' || error.code === '40P01') {
          throw new TranslationEditorError(409, 'version-conflict', 'The original or translation changed. Reload before editing.');
        }
        throw error;
      }
    },
  };
}
