import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createEditorHandler } from '../src/editor-http.mjs';

const origin = 'https://lzww0608.github.io';
const token = 'test-editor-key-'.repeat(4);
const payload = { paragraphId: 'new-v04-p1', expectedOriginalRevision: 1, expectedTranslationId: '17',
  text: '用户改写的白话文。', editorName: '网站所有者', reviewNotes: ['待继续核对。'] };
const calls = [], logs = [], servers = [];
const mockEditor = {
  authenticate(header) { return header === `Bearer ${token}`; },
  async reviews(params) {
    calls.push({ reviews: [...params] });
    return { schemaVersion: 1, subjects: [{ id: 'li-keyong', name: '李克用' }], total: 1,
      summary: { open: 1, resolved: 0, retained: 0, checked: 0, stale: 0 }, items: [{ id: 'review-private', detail: '受保护校核说明' }],
      nextOffset: null, resultSetRevision: 'a'.repeat(64) };
  },
  async review(id) {
    calls.push({ review: id });
    if (id === 'missing') throw Object.assign(new Error('Do not disclose private details'), { status: 404 });
    return { item: { id, detail: '受保护校核说明' }, paragraph: { id: 'new-v04-p1', original: '原文' } };
  },
  async reviewStatus(id, input) {
    calls.push({ reviewStatus: id, input });
    if (input.expectedVersion === 0) throw Object.assign(new Error('Private stale binding'), { status: 409 });
    return { item: { id, version: input.expectedVersion + 1, status: input.status } };
  },
  async revise(input) {
    calls.push(structuredClone(input));
    if (input.expectedTranslationId === 'stale') throw Object.assign(new Error('Do not expose stale details'), { statusCode: 409 });
    if (input.text === 'missing') throw Object.assign(new Error('Private record'), { status: 404 });
    if (input.text === 'invalid') throw Object.assign(new Error('Invalid secret-bearing input'), { status: 400 });
    if (input.text === 'fault') throw Object.assign(new Error(`SQL connection password=${token}`), { code: '08006' });
    if (input.text === 'unsafe-fault') throw Object.assign(new Error(`Bearer ${token}`), { code: `secret-${token}` });
    return { paragraphId: input.paragraphId, translation: { id: '18', text: input.text, language: 'zh-Hans',
      version: 2, translator: input.editorName, origin: 'human', reviewStatus: 'owner-edited', reviewNotes: input.reviewNotes } };
  },
};
let base;
async function startServer(editor = mockEditor) {
  const handler = createEditorHandler({ editor, allowedOrigins: [origin], log: message => logs.push(message) });
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (await handler(req, res, path)) return;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { res.statusCode = 405; res.end('{}'); return; }
      if (path === '/api/books') { res.statusCode = 200; res.end(JSON.stringify({ books: ['只读公开资料'] })); }
      else { res.statusCode = 404; res.end('{}'); }
    } catch { res.statusCode = 500; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const write = (path = '/api/editor/translations/new-v04-p1', options = {}) => {
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers };
  for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key];
  return fetch((options.base ?? base) + path, { method: options.method ?? 'POST', headers, body: options.body ?? JSON.stringify(payload) });
};
before(async () => { base = await startServer(); });
after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('status reports availability without credentials and disabled editor writes return 503', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/editor/status`)).json(), { enabled: true });
  const disabled = await startServer(null);
  assert.deepEqual(await (await fetch(`${disabled}/api/editor/status`)).json(), { enabled: false });
  assert.equal((await write('/api/editor/session', { base: disabled })).status, 503);
  assert.equal((await write(undefined, { base: disabled })).status, 503);
});

test('writes require an allowed Origin and ignore Cookie authentication', async () => {
  for (const badOrigin of [undefined, 'https://unrelated.example', 'null']) {
    const response = await write(undefined, { headers: { Origin: badOrigin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const noKey = await write(undefined, { headers: { Authorization: undefined, Cookie: `editor=${token}` } });
  assert.equal(noKey.status, 401);
  assert.equal((await write(undefined, { headers: { Authorization: 'Bearer wrong-password' } })).status, 401);
  assert.equal((await write('/api/editor/session', { headers: { Authorization: undefined } })).status, 401);
});

test('the authenticated session and a valid save return only the expected result', async () => {
  const session = await write('/api/editor/session', { body: '' });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true });
  const response = await write();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const data = await response.json();
  assert.equal(data.paragraphId, payload.paragraphId);
  assert.equal(data.translation.text, payload.text);
  assert.deepEqual(calls.at(-1), payload);
  assert.ok(!JSON.stringify(data).includes(token));
});

test('wrong path IDs, malformed JSON and non-object payloads cannot call the editor', async () => {
  const beforeCalls = calls.length;
  const cases = [
    { body: JSON.stringify({ ...payload, paragraphId: 'new-v04-p2' }) },
    { body: '{"paragraphId":' }, { body: 'null' }, { body: '[]' }, { body: '42' }, { body: '{}' },
    { headers: { 'Content-Type': 'text/plain' } }, { headers: { 'Content-Type': undefined } },
    { body: Buffer.from([0xc3, 0x28]) },
  ];
  for (const options of cases) assert.equal((await write(undefined, options)).status, 400);
  assert.equal(calls.length, beforeCalls);
});

test('body limit counts bytes and rejects both announced and chunked overflow', async () => {
  const beforeCalls = calls.length;
  const maximumBodyBytes = 256 * 1024;
  const oversized = JSON.stringify({ ...payload, text: '汉'.repeat(90_000) });
  assert.ok(Buffer.byteLength(oversized) > maximumBodyBytes);
  assert.equal((await write(undefined, { body: oversized })).status, 413);
  assert.equal(calls.length, beforeCalls);
  const chunked = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/editor/translations/${payload.paragraphId}`, { method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('{"paragraphId":"new-v04-p1","text":"');
    req.end('x'.repeat(maximumBodyBytes));
  });
  assert.equal(chunked, 413);
  assert.equal(calls.length, beforeCalls);
  const empty = { ...payload, text: '' };
  const exact = JSON.stringify({ ...empty, text: 'x'.repeat(maximumBodyBytes - Buffer.byteLength(JSON.stringify(empty))) });
  assert.equal(Buffer.byteLength(exact), maximumBodyBytes);
  assert.equal((await write(undefined, { body: exact })).status, 200);
});

test('a maximum-length Chinese translation and twenty maximum-length notes fit the request limit', async () => {
  for (const character of ['汉', '𠮷']) {
    const legal = { ...payload, text: character.repeat(20_000), editorName: character.repeat(80),
      reviewNotes: Array(20).fill(character.repeat(2_000)) };
    const body = JSON.stringify(legal);
    assert.equal(Array.from(legal.text).length, 20_000);
    assert.equal(Array.from(legal.editorName).length, 80);
    assert.equal(legal.reviewNotes.length, 20);
    assert.ok(legal.reviewNotes.every(note => Array.from(note).length === 2_000));
    assert.ok(Buffer.byteLength(body) > 100 * 1024, 'Regression must exceed the former request limit.');
    assert.ok(Buffer.byteLength(body) < 256 * 1024);
    const response = await write(undefined, { body });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), legal);
    const result = await response.json();
    assert.equal(result.translation.text, legal.text);
    assert.deepEqual(result.translation.reviewNotes, legal.reviewNotes);
  }
});

test('revision input, absence and stale versions map to 400, 404 and 409 without exposing error messages', async () => {
  for (const [body, status] of [[{ ...payload, text: 'invalid' }, 400], [{ ...payload, text: 'missing' }, 404],
    [{ ...payload, expectedTranslationId: 'stale' }, 409]]) {
    const response = await write(undefined, { body: JSON.stringify(body) });
    assert.equal(response.status, status);
    assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  }
});

test('unknown failures return 503 and log only a sanitized code', async () => {
  for (const text of ['fault', 'unsafe-fault']) {
    const response = await write(undefined, { body: JSON.stringify({ ...payload, text }) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'temporarily_unavailable' });
  }
  assert.deepEqual(logs, ['Translation editor request failed (08006)', 'Translation editor request failed (internal_error)']);
  assert.ok(!logs.some(line => line.includes(token) || /password|SQL|Bearer/.test(line)));
});

test('editor-only preflight permits Authorization and POST without authenticating', async () => {
  const response = await fetch(`${base}/api/editor/translations/${payload.paragraphId}`, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
  assert.equal(response.headers.get('allow'), 'GET, POST, OPTIONS');
  assert.equal((await fetch(`${base}/api/editor/session`, { method: 'OPTIONS' })).status, 403);
  assert.equal((await fetch(`${base}/api/editor/session`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'DELETE' } })).status, 405);
  assert.equal((await fetch(`${base}/api/editor/session`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Headers': 'X-Secret' } })).status, 400);
});

test('invalid authentication is rate limited while valid credentials keep working', async () => {
  const limited = await startServer();
  for (let index = 0; index < 12; index++) {
    assert.equal((await write('/api/editor/session', { base: limited, headers: { Authorization: 'Bearer invalid-password' } })).status, 401);
  }
  const blocked = await write('/api/editor/session', { base: limited, headers: { Authorization: 'Bearer invalid-password' } });
  assert.equal(blocked.status, 429);
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60);
  const valid = await write('/api/editor/session', { base: limited });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { authenticated: true });
  assert.equal((await write(undefined, { base: limited })).status, 200);
});

test('ordinary routes fall through and retain their read-only methods', async () => {
  const publicRead = await fetch(`${base}/api/books`);
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal((await write('/api/books')).status, 405);
  assert.equal((await fetch(`${base}/api/editorial`)).status, 404);
  assert.equal((await write('/api/editor/status')).status, 405);
  assert.equal((await fetch(`${base}/api/editor/session`)).status, 405);
  assert.equal((await write('/api/editor/unknown')).status, 404);
});

test('private review reads require Bearer and allowed Origin and never use cookies or public caches', async () => {
  const previousCalls = calls.length;
  for (const path of ['/api/editor/reviews', '/api/editor/reviews/review-private']) {
    for (const headers of [{}, { Origin: origin }, { Authorization: `Bearer ${token}` },
      { Origin: 'https://other.test', Authorization: `Bearer ${token}` }, { Origin: origin, Cookie: `editor=${token}` }]) {
      const response = await fetch(base + path, { headers });
      assert.ok([401, 403].includes(response.status));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!(await response.text()).includes('受保护校核说明'));
    }
  }
  assert.equal(calls.length, previousCalls);
  const response = await fetch(base + '/api/editor/reviews?personId=li-keyong&limit=50', { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).items[0].detail, '受保护校核说明');
  assert.deepEqual(calls.at(-1), { reviews: [['personId', 'li-keyong'], ['limit', '50']] });
  const detail = await fetch(base + '/api/editor/reviews/review-private', { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
  assert.equal(detail.status, 200); assert.equal((await detail.json()).item.id, 'review-private');
  const missing = await fetch(base + '/api/editor/reviews/missing', { headers: { Origin: origin, Authorization: `Bearer ${token}` } });
  assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { error: 'not_found' });
});

test('review status updates use the protected POST body path and GET preflights are allowed', async () => {
  const payload = { expectedVersion: 2, status: 'checked', resolution: '已核对并保留。' };
  const response = await write('/api/editor/reviews/review-private/status', { body: JSON.stringify(payload) });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).item, { id: 'review-private', version: 3, status: 'checked' });
  assert.deepEqual(calls.at(-1), { reviewStatus: 'review-private', input: payload });
  assert.equal((await write('/api/editor/reviews/review-private/status', { body: JSON.stringify({ ...payload, expectedVersion: 0 }) })).status, 409);
  assert.equal((await write('/api/editor/reviews/review-private/status', { headers: { Authorization: undefined } })).status, 401);
  assert.equal((await write('/api/editor/reviews')).status, 405);
  assert.equal((await fetch(base + '/api/editor/reviews/review-private/status', { headers: { Origin: origin, Authorization: `Bearer ${token}` } })).status, 405);
  for (const path of ['/api/editor/reviews', '/api/editor/reviews/review-private']) {
    const preflight = await fetch(base + path, { method: 'OPTIONS', headers: { Origin: origin,
      'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(preflight.status, 204);
  }
});

test('unfinished request bodies stop at the handler deadline', { timeout: 14_000 }, async () => {
  const beforeCalls = calls.length;
  const result = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/editor/translations/${payload.paragraphId}`, { method: 'POST', headers: {
      Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { req.destroy(); resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); });
    });
    req.on('error', reject);
    req.write('{"paragraphId":"new-v04-p1","text":"unfinished');
  });
  assert.equal(result.status, 408);
  assert.deepEqual(result.data, { error: 'request_timeout' });
  assert.equal(calls.length, beforeCalls);
});
