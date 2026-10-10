import { createHash } from 'node:crypto';

export const reviewSubjects = Object.freeze([
  Object.freeze({ id: 'li-keyong', name: '李克用' }), Object.freeze({ id: 'li-cunxu', name: '李存勖' }),
  Object.freeze({ id: 'zhu-wen', name: '朱温' }), Object.freeze({ id: 'chai-rong', name: '柴荣' }),
]);
const subjects = new Map(reviewSubjects.map(subject => [subject.id, subject.name]));
export const reviewCategories = Object.freeze(['translation', 'association', 'relationship', 'source-note']);
export const reviewStatuses = Object.freeze(['open', 'resolved', 'retained', 'checked']);
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const itemIdPattern = /^[a-z0-9][a-z0-9-]{0,159}$/;
export const reviewTextHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
export class OwnerReviewError extends Error {
  constructor(status, code) { super(code); this.name = 'OwnerReviewError'; this.status = status; this.statusCode = status; this.code = code; }
}
const invalid = () => { throw new OwnerReviewError(400, 'invalid_review'); };
function text(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > maximum
    || value.includes('\0') || !value.isWellFormed()) invalid();
  return value;
}
function identifier(value, pattern = idPattern) {
  if (typeof value !== 'string' || !pattern.test(value)) invalid();
  return value;
}
const integer = (value, maximum = 2147483647) => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) invalid(); return value;
};
function bigint(value) {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string' || !/^[1-9][0-9]{0,18}$/.test(normalized) || BigInt(normalized) > 9223372036854775807n) invalid();
  return normalized;
}
const allowedFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) invalid();
};
function databaseError(error) {
  if (['PT400', '22003', '22P02'].includes(error.code)) throw new OwnerReviewError(400, 'invalid_review');
  if (error.code === 'PT404') throw new OwnerReviewError(404, 'not_found');
  if (['PT409', '23505', '40001', '40P01'].includes(error.code)) throw new OwnerReviewError(409, 'version_conflict');
  throw error;
}
export function createOwnerReviews({ pool }) {
  return {
    async reviews(params = new URLSearchParams()) {
      const keys = ['personId', 'bookId', 'status', 'category', 'limit', 'offset'];
      if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1)) invalid();
      const personId = params.get('personId') || null, bookId = params.get('bookId') || null;
      const status = params.get('status') || null, category = params.get('category') || null;
      if (personId !== null && !subjects.has(personId)) invalid();
      if (bookId !== null) identifier(bookId);
      if (status !== null && ![...reviewStatuses, 'stale'].includes(status)) invalid();
      if (category !== null && !reviewCategories.includes(category)) invalid();
      const parsed = (key, fallback, max) => {
        const value = params.get(key);
        if (value === null) return fallback;
        if (!/^(?:0|[1-9][0-9]*)$/.test(value)) invalid();
        const number = Number(value); if (!Number.isSafeInteger(number) || number > max) invalid(); return number;
      };
      const limit = parsed('limit', 50, 100), offset = parsed('offset', 0, 1000000);
      if (limit < 1) invalid();
      try {
        const { rows } = await pool.query('SELECT public.owner_review_list($1::text,$2::text,$3::text,$4::text,$5::integer,$6::integer) AS result',
          [personId, bookId, status, category, limit, offset]);
        return rows[0].result;
      } catch (error) { databaseError(error); }
    },
    async review(id) {
      identifier(id, itemIdPattern);
      try {
        const { rows } = await pool.query('SELECT public.owner_review_detail($1::text) AS result', [id]);
        if (!rows[0].result) throw new OwnerReviewError(404, 'not_found');
        return rows[0].result;
      } catch (error) { databaseError(error); }
    },
    async reviewStatus(id, payload) {
      identifier(id, itemIdPattern);
      allowedFields(payload, ['expectedVersion', 'status', 'resolution']);
      integer(payload.expectedVersion);
      if (!reviewStatuses.includes(payload.status)) invalid();
      text(payload.resolution, 4000);
      try {
        const { rows } = await pool.query('SELECT public.owner_review_set_status($1::text,$2::integer,$3::text,$4::text) AS result',
          [id, payload.expectedVersion, payload.status, payload.resolution]);
        return rows[0].result;
      } catch (error) { databaseError(error); }
    },
  };
}

// Also run after configuring a restored database: --no-acl restoration resets
// function privileges, so the public EXECUTE default must be revoked again.
export async function verifyOwnerReviewPermissions(client, { readerRole = 'history_reader', editorRole = 'history_editor' } = {}) {
  const tables = ['owner_review_subjects', 'owner_review_batches', 'owner_review_items', 'owner_review_events', 'owner_review_records'];
  const functions = ['owner_review_list(text,text,text,text,integer,integer)', 'owner_review_detail(text)', 'owner_review_set_status(text,integer,text,text)'];
  for (const role of [readerRole, editorRole]) {
    const { rows: roles } = await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [role]);
    if (roles.length !== 1 || Object.values(roles[0]).some(Boolean)) throw new Error('Private review role permissions are invalid.');
    const { rows } = await client.query(`SELECT table_name,has_table_privilege($1,'public.'||table_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed FROM unnest($2::text[]) AS table_name`, [role, tables]);
    if (rows.some(row => row.allowed)) throw new Error('Private review tables are directly accessible.');
    const sequence = (await client.query("SELECT has_sequence_privilege($1,'public.owner_review_events_id_seq','USAGE,SELECT,UPDATE') AS allowed", [role])).rows[0];
    if (sequence.allowed) throw new Error('Private review event sequence is directly accessible.');
    const privileges = (await client.query(`SELECT function_name,has_function_privilege($1,'public.'||function_name,'EXECUTE') AS allowed
      FROM unnest($2::text[]) AS function_name`, [role, functions])).rows;
    if (privileges.some(row => row.allowed !== (role === editorRole))) throw new Error('Private review function permissions are invalid.');
    if ((await client.query("SELECT has_function_privilege($1,'public.owner_review_json(public.owner_review_records)','EXECUTE') AS allowed", [role])).rows[0].allowed) {
      throw new Error('Private review helper function is directly accessible.');
    }
  }
  const { rows } = await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid=ANY(ARRAY[
      'public.owner_review_list(text,text,text,text,integer,integer)'::regprocedure,
      'public.owner_review_detail(text)'::regprocedure,'public.owner_review_set_status(text,integer,text,text)'::regprocedure])`);
  if (rows.length !== 3 || rows.some(row => !row.prosecdef || row.public_execute
    || row.proconfig?.length !== 1 || row.proconfig[0] !== 'search_path=pg_catalog')) {
    throw new Error('Private review function boundaries are invalid.');
  }
  return { verified: true, tables: tables.length, functions: functions.length };
}

export function validateReviewBatch(batch) {
  allowedFields(batch, ['schemaVersion', 'batchId', 'subjects', 'items']);
  if (batch.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(batch.batchId ?? '')
    || !Array.isArray(batch.subjects) || !batch.subjects.length || batch.subjects.length > 4
    || !Array.isArray(batch.items) || batch.items.length > 20000) invalid();
  const scope = new Set();
  for (const subject of batch.subjects) {
    allowedFields(subject, ['id', 'name']);
    if (subjects.get(subject.id) !== subject.name || scope.has(subject.id)) invalid(); scope.add(subject.id);
  }
  const ids = new Set();
  const items = batch.items.map(item => {
    allowedFields(item, ['id', 'personId', 'personName', 'bookId', 'chapterId', 'paragraphId', 'category', 'status', 'severity',
      'title', 'detail', 'evidence', 'originalRevision', 'originalSha256', 'translationId', 'translationVersion',
      'translationSha256', 'checkedAt', 'resolution', 'batchId', 'expectedVersion']);
    identifier(item.id, itemIdPattern); if (ids.has(item.id)) invalid(); ids.add(item.id);
    if (!scope.has(item.personId) || (item.personName !== undefined && subjects.get(item.personId) !== item.personName)
      || (item.batchId !== undefined && item.batchId !== batch.batchId)) invalid();
    for (const key of ['bookId', 'chapterId', 'paragraphId']) identifier(item[key]);
    if (!reviewCategories.includes(item.category) || !reviewStatuses.includes(item.status)
      || !['info', 'warning', 'error'].includes(item.severity)) invalid();
    text(item.title, 160); text(item.detail, 12000); integer(item.originalRevision);
    if (!hashPattern.test(item.originalSha256 ?? '')) invalid();
    if (typeof item.checkedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(item.checkedAt) || !Number.isFinite(Date.parse(item.checkedAt))) invalid();
    const resolution = item.resolution ?? ''; text(resolution, 4000, { empty: item.status === 'open' });
    if (item.expectedVersion !== undefined) integer(item.expectedVersion);
    const translationId = item.translationId === null ? null : bigint(item.translationId);
    if (translationId === null) {
      if (item.translationVersion !== null || item.translationSha256 !== null || item.category === 'translation') invalid();
    } else {
      integer(item.translationVersion); if (!hashPattern.test(item.translationSha256 ?? '')) invalid();
    }
    if (!Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 20) invalid();
    for (const evidence of item.evidence) {
      allowedFields(evidence, ['chapterId', 'paragraphId', 'excerpt']);
      identifier(evidence.chapterId); identifier(evidence.paragraphId); text(evidence.excerpt, 6000);
    }
    return { ...item, translationId, resolution };
  });
  return { ...batch, items };
}
