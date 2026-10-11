import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { createApi } from '../src/http.mjs';

const origin = 'https://lzww0608.github.io';
const payload = { schemaVersion: 1, personId: 'zhu-wen', events: Array.from({ length: 147 }, (_, index) => ({
  id: `test-event-${index}`, original: '柏鄉原文，保留繁體與𠮷字。'.repeat(60), translation: '完整白话译文，不裁切任何记载。'.repeat(60),
})) };
const plainBytes = Buffer.from(JSON.stringify(payload));
const servers = [];
async function start(repository = { async personTimeline() { return payload; }, async health() { return { status: 'ok' }; } }, options = {}, factory = createApi) {
  const server = factory({ repository, allowedOrigins: [origin], log: () => {}, ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
after(async () => { for (const server of servers) await new Promise(resolve => server.close(resolve)); });

function raw(base, path = '/api/people/zhu-wen/timeline', { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject); req.end();
  });
}

test('actual HTTP gzip bytes decompress to the complete unchanged public JSON with CORS and both Vary dimensions', async () => {
  const base = await start();
  const result = await raw(base, undefined, { headers: { Origin: origin, 'Accept-Encoding': 'br, gzip, deflate' } });
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-encoding'], 'gzip');
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal(result.headers.vary, 'Origin, Accept-Encoding');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(gunzipSync(result.body), plainBytes);
  assert.ok(result.body.length < plainBytes.length / 5);
  assert.deepEqual(JSON.parse(gunzipSync(result.body)), payload);
});

test('absent or empty negotiation, explicit gzip prohibition and preferred identity remain unencoded', async () => {
  const base = await start();
  for (const value of [undefined, '', 'identity', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1', '*;q=0, identity;q=1',
    'gzip;q=0.5, identity;q=0.9', 'gzip;q=invalid, *;q=1', 'gzip;q=1.001, identity', 'gzip;q=0.5;q=1, identity', 'gzip;q=0, gzip;q=1']) {
    const result = await raw(base, undefined, { headers: value === undefined ? {} : { 'Accept-Encoding': value } });
    assert.equal(result.status, 200, value);
    assert.equal(result.headers['content-encoding'], undefined, value);
    assert.equal(result.headers.vary, 'Origin, Accept-Encoding', value);
    assert.deepEqual(result.body, plainBytes, value);
  }
});

test('positive gzip and wildcard weights work, specific values prevail and identity exclusions are honored', async () => {
  const base = await start();
  for (const value of ['gzip', '*', '*;q=0.2', 'GZIP; Q=0.500', 'gzip;q=0.2, *;q=0', 'gzip;q=0.8, identity;q=0.5', 'gzip;q=0.8, identity;q=0.8', 'gzip;q=0.1, identity;q=0']) {
    const result = await raw(base, undefined, { headers: { 'Accept-Encoding': value } });
    assert.equal(result.status, 200, value);
    assert.equal(result.headers['content-encoding'], 'gzip', value);
    assert.deepEqual(gunzipSync(result.body), plainBytes, value);
  }
  for (const value of ['*;q=0', 'gzip;q=0, identity;q=0', 'br, identity;q=0']) {
    const result = await raw(base, undefined, { headers: { 'Accept-Encoding': value } });
    assert.equal(result.status, 406, value);
    assert.equal(result.headers['content-encoding'], undefined, value);
    assert.deepEqual(JSON.parse(result.body), { error: 'encoding_not_acceptable' });
  }
});

test('small public JSON avoids compression overhead unless gzip is the only acceptable representation; HEAD remains bodyless', async () => {
  const base = await start();
  const plain = await raw(base, '/api/health', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(plain.body), { status: 'ok' });
  const required = await raw(base, '/api/health', { headers: { 'Accept-Encoding': 'gzip, identity;q=0' } });
  assert.equal(required.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(required.body)), { status: 'ok' });
  const head = await raw(base, undefined, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip', Origin: origin } });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-encoding'], undefined);
  assert.equal(head.headers.vary, 'Origin, Accept-Encoding');
  assert.equal(head.headers['access-control-allow-origin'], origin);
});

test('all existing public read endpoints retain their complete payload through the same gzip transport', async () => {
  const repository = {
    async health() { return payload; }, async books() { return [payload]; }, async chapter() { return payload; },
    async chapters() { return [payload]; }, async sentenceTranslations() { return payload; }, async personPassages() { return payload; },
    async personTimeline() { return payload; }, async passage() { return payload; }, async search() { return [payload]; },
  };
  const base = await start(repository);
  for (const [path, expected] of [['/api/health', payload], ['/api/books', { books: [payload] }], ['/api/chapters/old-v027', payload],
    ['/api/books/old/chapters', { chapters: [payload] }], ['/api/chapters/old-v027/sentence-translations', payload],
    ['/api/people/zhu-wen/passages', payload], ['/api/people/zhu-wen/timeline', payload], ['/api/passages/test-passage', payload], ['/api/search?q=柏乡', { results: [payload] }]]) {
    const result = await raw(base, path, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(result.status, 200, path);
    assert.equal(result.headers['content-encoding'], 'gzip', path);
    assert.deepEqual(JSON.parse(gunzipSync(result.body)), expected, path);
  }
});

test('preflights, errors and rejected writes are never compressed and retain their existing CORS and method semantics', async () => {
  const base = await start();
  for (const [path, options, status] of [
    ['/api/people/zhu-wen/timeline', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } }, 204],
    ['/api/missing', {}, 404], ['/api/people/zhu-wen/timeline?event=guess', {}, 400],
    ['/api/people/zhu-wen/timeline', { method: 'POST' }, 405], ['/api/health', { headers: { Origin: 'https://unrelated.invalid' } }, 403],
  ]) {
    const result = await raw(base, path, { ...options, headers: { 'Accept-Encoding': 'gzip', ...options.headers } });
    assert.equal(result.status, status, path);
    assert.equal(result.headers['content-encoding'], undefined, path);
    if (status === 204) {
      assert.equal(result.body.length, 0);
      assert.equal(result.headers['access-control-allow-methods'], 'GET, HEAD, OPTIONS');
      assert.equal(result.headers['access-control-allow-origin'], origin);
    }
  }
});

test('large authenticated private-editor responses bypass public compression entirely', async () => {
  const token = 'test-private-token';
  const privatePayload = { items: [{ id: 'test-private-review', detail: '受保护的校核记录。'.repeat(5000) }] };
  const base = await start(undefined, { editor: { authenticate: value => value === `Bearer ${token}`, async reviews() { return privatePayload; } } });
  const result = await raw(base, '/api/editor/reviews', { headers: { 'Accept-Encoding': 'gzip, identity;q=0', Origin: origin, Authorization: `Bearer ${token}` } });
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-encoding'], undefined);
  assert.equal(result.headers.vary, 'Origin');
  assert.deepEqual(JSON.parse(result.body), privatePayload);
  const denied = await raw(base, '/api/editor/reviews', { headers: { 'Accept-Encoding': 'gzip', Origin: origin } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers['content-encoding'], undefined);
});

test('an asynchronous gzip failure is awaited, bounded to a plain service error and never leaks compressor details', async () => {
  const logs = [];
  const patched = mock.method(zlib, 'gzip', (_body, _options, callback) => queueMicrotask(() => callback(Object.assign(new Error('private compressor diagnostics'), { code: 'Z_MEM_ERROR' }))));
  syncBuiltinESMExports();
  try {
    const { createApi: failingApi } = await import('../src/http.mjs?compression-failure-test');
    const base = await start(undefined, { log: message => logs.push(message) }, failingApi);
    const result = await raw(base, undefined, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(result.status, 503);
    assert.equal(result.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(result.body), { error: 'temporarily_unavailable' });
    assert.deepEqual(logs, ['API request failed (Z_MEM_ERROR)']);
    // An explicit identity request can still read the complete public content.
    assert.deepEqual((await raw(base, undefined, { headers: { 'Accept-Encoding': 'identity' } })).body, plainBytes);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); }
});
