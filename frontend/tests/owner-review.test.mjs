import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  loadOwnerReviews, loadOwnerReviewDetail, parseOwnerReviewResponse, updateOwnerReviewStatus,
} from '../src/owner-review-api.ts';
import { authenticateEditorSession, clearEditorSession, hasEditorSession } from '../src/translation-editor-api.ts';
import { ownerReviewRoute, resolveOwnerReviewRoute } from '../src/owner-review-route.ts';
import { chapterRoute, libraryChapters, resolveReadingRoute, resolveRoute } from '../src/library.ts';

const apiBase = 'https://private-api.example';
const token = 'isolated-test-password';
const filters = { personId: '', bookId: '', status: '', category: '', offset: 0 };
const translation = { id: '500', version: 1, text: '武皇。', language: 'zh-Hans', translator: '测试', origin: 'ai' };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const item = { id: 'review-test-1', personId: 'li-keyong', personName: '李克用', bookId: 'old', chapterId: 'old-v26', paragraphId: 'old-v26-p1', category: 'translation', status: 'open', severity: 'warning', title: '核对标题', detail: '仅测试使用的依据。', evidence: [{ chapterId: 'old-v26', paragraphId: 'old-v26-p1', excerpt: '武皇。' }], originalRevision: 1, originalSha256: sha256('武皇。'), translationId: '500', translationVersion: 1, translationSha256: sha256(translation.text), checkedAt: '2026-10-11T08:00:00Z', resolution: '', batchId: 'test-batch', version: 1, currentBinding: true };
const page = { schemaVersion: 1, subjects: [{ id: 'li-keyong', name: '李克用' }], total: 1, summary: { open: 1, resolved: 0, retained: 0, checked: 0, stale: 0 }, items: [item], nextOffset: null, resultSetRevision: 'test-version' };
const respond = (value, status = 200) => new Response(JSON.stringify(value), { status });
const signIn = () => authenticateEditorSession({ apiBase, token, fetcher: async () => respond({ authenticated: true }) });
beforeEach(clearEditorSession);
afterEach(clearEditorSession);

test('private review data cannot be requested before authentication or from another API host', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return respond(page); };
  await assert.rejects(loadOwnerReviews({ apiBase, filters, fetcher }), error => error.status === 401);
  await signIn();
  await assert.rejects(loadOwnerReviews({ apiBase: 'https://other.example', filters, fetcher }), error => error.status === 401);
  assert.equal(calls, 0);
});

test('authenticated reads use no-store, omit cookies, and keep the credential out of URLs and bodies', async () => {
  await signIn(); let request;
  const value = await loadOwnerReviews({ apiBase, filters: { ...filters, personId: 'li-keyong' }, fetcher: async (url, init) => { request = { url, init }; return respond(page); } });
  assert.deepEqual(value.items, [item]);
  assert.equal(request.url, `${apiBase}/api/editor/reviews?limit=50&offset=0&personId=li-keyong`);
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.body, undefined);
  assert.equal(request.url.includes(token), false);
});

test('successful empty responses and network failure have no public archive fallback', async () => {
  await signIn(); let calls = 0;
  const empty = { ...page, total: 0, items: [], summary: { open: 0, resolved: 0, retained: 0, checked: 0, stale: 0 } };
  const result = await loadOwnerReviews({ apiBase, filters, fetcher: async () => { calls++; return respond(empty); } });
  assert.equal(result.total, 0); assert.equal(calls, 1);
  await assert.rejects(loadOwnerReviews({ apiBase, filters, fetcher: async () => { calls++; throw new Error('private diagnostic'); } }), error => !error.message.includes('private diagnostic'));
  assert.equal(calls, 2);
});

test('private list schema rejects duplicate identities, wrong filters, and invalid pagination', () => {
  for (const value of [
    { ...page, items: [item, item] },
    { ...page, nextOffset: 1 },
    { ...page, total: -1 },
    { ...page, items: [{ ...item, currentBinding: 'true' }] },
    { ...page, items: [{ ...item, translationId: null }] },
    { ...page, items: [{ ...item, originalSha256: 'short' }] },
    { ...page, items: [{ ...item, status: 'stale' }] },
    { ...page, subjects: [] },
  ]) assert.throws(() => parseOwnerReviewResponse(value, filters));
  assert.throws(() => parseOwnerReviewResponse(page, { ...filters, personId: 'zhu-wen' }));
  assert.throws(() => parseOwnerReviewResponse(page, { ...filters, status: 'stale' }));
  assert.equal(parseOwnerReviewResponse({ ...page, items: [{ ...item, currentBinding: false }] }, { ...filters, status: 'stale' }).items[0].currentBinding, false);
});

test('fixed fifty-item pagination rejects empty or partial pages and missing next offsets', () => {
  const fiftyItems = Array.from({ length: 50 }, (_, index) => ({ ...item, id: `review-test-${index + 1}` }));
  const hundred = { ...page, total: 100, items: fiftyItems, nextOffset: 50 };
  assert.equal(parseOwnerReviewResponse(hundred, filters).nextOffset, 50);
  for (const invalid of [
    { ...hundred, items: [], nextOffset: null },
    { ...hundred, items: fiftyItems.slice(0, 49), nextOffset: 49 },
    { ...hundred, items: fiftyItems.slice(0, 49), nextOffset: 50 },
    { ...hundred, nextOffset: null }, { ...hundred, nextOffset: 51 },
  ]) assert.throws(() => parseOwnerReviewResponse(invalid, filters));
  assert.equal(parseOwnerReviewResponse({ ...hundred, nextOffset: null }, { ...filters, offset: 50 }).items.length, 50);
  assert.throws(() => parseOwnerReviewResponse({ ...hundred, items: fiftyItems.slice(0, 49), nextOffset: null }, { ...filters, offset: 50 }));
  assert.equal(parseOwnerReviewResponse({ ...page, total: 101 }, { ...filters, offset: 100 }).items.length, 1);
  assert.equal(parseOwnerReviewResponse({ ...page, total: 100, items: [] }, { ...filters, offset: 150 }).items.length, 0);
});

test('status changes are version-bound and stale bindings cannot be marked checked', async () => {
  await signIn(); let request;
  const saved = { ...item, version: 2, status: 'checked', resolution: '已核对原文。' };
  const result = await updateOwnerReviewStatus({ apiBase, item, status: 'checked', resolution: saved.resolution, fetcher: async (url, init) => { request = { url, init }; return respond({ item: saved }); } });
  assert.deepEqual(result, saved);
  assert.equal(request.url, `${apiBase}/api/editor/reviews/review-test-1/status`);
  assert.deepEqual(JSON.parse(request.init.body), { expectedVersion: 1, status: 'checked', resolution: '已核对原文。' });
  assert.equal(request.init.body.includes(token), false);
  let calls = 0;
  await assert.rejects(updateOwnerReviewStatus({ apiBase, item: { ...item, currentBinding: false }, status: 'checked', resolution: '已核对', fetcher: async () => { calls++; return respond({}); } }), error => error.status === 409);
  assert.equal(calls, 0);
  await assert.rejects(updateOwnerReviewStatus({ apiBase, item, status: 'checked', resolution: '已核对', fetcher: async () => respond({ item: { ...saved, version: 1 } }) }), /无法核验/);
});

test('detail validates exact paragraph, original revision, and published translation identity', async () => {
  await signIn();
  const paragraph = { id: item.paragraphId, position: 1, revision: 1, original: '武皇。', translation };
  const value = await loadOwnerReviewDetail({ apiBase, id: item.id, fetcher: async () => respond({ item, paragraph }) });
  assert.equal(value.paragraph.translation.id, item.translationId);
  for (const invalid of [{ ...paragraph, id: 'wrong' }, { ...paragraph, revision: 2 }, { ...paragraph, original: '原文被改。' }, { ...paragraph, translation: { ...translation, text: '不对应的译文。' } }, { ...paragraph, translation: { ...translation, id: '501' } }]) {
    await assert.rejects(loadOwnerReviewDetail({ apiBase, id: item.id, fetcher: async () => respond({ item, paragraph: invalid }) }), /无法核验/);
  }
  const stale = await loadOwnerReviewDetail({ apiBase, id: item.id, fetcher: async () => respond({ item: { ...item, currentBinding: false }, paragraph: { ...paragraph, revision: 2 } }) });
  assert.equal(stale.item.currentBinding, false);
});

test('401 clears the session, while aborting or logging out blocks a delayed private response', async () => {
  await signIn();
  await assert.rejects(loadOwnerReviews({ apiBase, filters, fetcher: async () => respond({ diagnostic: token }, 401) }), error => error.status === 401 && !error.message.includes(token));
  assert.equal(hasEditorSession(apiBase), false);
  await signIn();
  const controller = new AbortController();
  await assert.rejects(loadOwnerReviews({ apiBase, filters, signal: controller.signal, fetcher: async () => { controller.abort(); return respond(page); } }), error => error.name === 'AbortError');
  await assert.rejects(loadOwnerReviews({ apiBase, filters, fetcher: async () => { clearEditorSession(); return respond(page); } }), error => error.status === 401);
});

test('owner route and full-reader return preserve filters but reject external and malformed returns', () => {
  const selected = { personId: 'li-keyong', bookId: 'old', status: 'open', category: 'translation', offset: 50 };
  const route = ownerReviewRoute(selected);
  assert.equal(resolveRoute(`#${route}`), route);
  assert.deepEqual(resolveOwnerReviewRoute(route), selected);
  const chapter = libraryChapters.find(chapter => chapter.bookId === 'old');
  const paragraphId = `${chapter.id}-p1`;
  const reading = chapterRoute(chapter, { query: '', field: 'both', paragraphId, returnTo: route });
  assert.equal(resolveReadingRoute(reading).returnTo, route);
  assert.equal(resolveReadingRoute(reading).focusParagraphId, paragraphId);
  for (const invalid of ['https://evil.example', 'owner-review?token=secret', 'owner-review?personId=not-real', 'owner-review?offset=-1', 'owner-review?status=reviewed', 'owner-review?personId=li-keyong&personId=zhu-wen']) {
    assert.equal(resolveOwnerReviewRoute(invalid), null);
    assert.equal(resolveReadingRoute(`read-old/${chapter.id}?return=${encodeURIComponent(invalid)}`).returnTo, undefined);
  }
});
