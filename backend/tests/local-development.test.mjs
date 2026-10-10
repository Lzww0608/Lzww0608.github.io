import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createApi } from '../src/http.mjs';
import { createEditorHandler } from '../src/editor-http.mjs';
import { validateLocalDevelopmentConfiguration } from '../src/dev-server.mjs';

const origin = 'http://localhost:5173';
const payload = { paragraphId: 'new-v04-p1', expectedOriginalRevision: 1,
  expectedTranslationId: '17', text: '本机校订。', editorName: '网站所有者', reviewNotes: [] };
function editorFor(calls) {
  return {
    authenticate(header) { calls.push(['authenticate', header]); return header === 'Bearer test-password'; },
    async reviews() { calls.push(['reviews']); return { items: [{ id: 'private-review' }] }; },
    async review(id) { calls.push(['review', id]); return { item: { id } }; },
    async reviewStatus(id, input) { calls.push(['status', id, input]); return { item: { id, ...input } }; },
    async revise(input) { calls.push(['revise', input]); return { paragraphId: input.paragraphId }; },
  };
}
async function start(t, development = false) {
  // Allocate an isolated port without touching either running local service.
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const calls = [];
  const server = createApi({ repository: { health: async () => ({ ok: true }) },
    editor: editorFor(calls), allowedOrigins: [origin, 'https://lzww0608.github.io'],
    ...(development ? { localDevelopment: { port } } : {}) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const send = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { Origin: origin, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString()) : null }));
    });
    req.on('error', reject); req.end(body);
  });
  return { port, calls, send };
}

test('production retains password requirements even when a bypass environment variable is present', async t => {
  const previous = process.env.HISTORY_DEVELOPMENT_BYPASS;
  process.env.HISTORY_DEVELOPMENT_BYPASS = 'true';
  t.after(() => { if (previous === undefined) delete process.env.HISTORY_DEVELOPMENT_BYPASS;
    else process.env.HISTORY_DEVELOPMENT_BYPASS = previous; });
  const { send } = await start(t);
  assert.deepEqual((await send('/api/editor/status')).body, { enabled: true });
  assert.equal((await send('/api/editor/session', { method: 'POST' })).status, 401);
  assert.equal((await send('/api/editor/reviews')).status, 401);
  assert.equal((await send('/api/editor/translations/new-v04-p1', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 401);
  assert.equal((await send('/api/editor/session', { method: 'POST',
    headers: { Authorization: 'Bearer test-password' } })).status, 200);
});

test('an explicit isolated development listener permits a local session and protected reads and writes', async t => {
  const { send, calls } = await start(t, true);
  const availability = await send('/api/editor/status');
  assert.equal(availability.status, 200);
  assert.deepEqual(availability.body, { enabled: true, developmentBypass: true });
  assert.equal(availability.headers['cache-control'], 'no-store');
  assert.deepEqual((await send('/api/editor/session', { method: 'POST' })).body,
    { authenticated: true, developmentBypass: true });
  assert.equal((await send('/api/editor/reviews')).status, 200);
  assert.equal((await send('/api/editor/reviews/private-review')).status, 200);
  assert.equal((await send('/api/editor/reviews/private-review/status', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, status: 'checked', resolution: '已核对。' }) })).status, 200);
  assert.equal((await send('/api/editor/translations/new-v04-p1', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 200);
  assert.equal(calls.some(([name]) => name === 'authenticate'), false);
  assert.deepEqual(calls.at(-1), ['revise', payload]);
});

test('development refuses remote Origins, missing Origins, substituted Hosts and all proxy headers', async t => {
  const { send, port, calls } = await start(t, true);
  const hostile = [
    { Origin: 'https://lzww0608.github.io' }, { Origin: 'http://localhost.evil.test:5173' },
    { Origin: 'http://127.0.0.2:5173' }, { Origin: 'null' }, { Origin: '' },
    { Origin: 'http://localhost:5173/path' }, { Host: `ancient-history.tail92934d.ts.net:${port}` },
    { Host: 'localhost:8787' }, { Host: `localhost.:${port}` },
    { Forwarded: 'for=127.0.0.1;host=localhost' }, { 'X-Forwarded-For': '127.0.0.1' },
    { 'X-Forwarded-Host': `localhost:${port}` }, { 'X-Forwarded-Proto': 'http' },
    { 'X-Forwarded-Unknown': '' }, { Via: '1.1 local' },
  ];
  for (const headers of hostile) {
    const response = await send('/api/editor/reviews', { headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(calls.length, 0);
  assert.equal((await send('/api/editor/status', { headers: { Host: `localhost:${port}` } })).status, 200);
});

test('development checks the real socket and port instead of trusting loopback request headers', async () => {
  const calls = [];
  const handler = createEditorHandler({ editor: editorFor(calls), allowedOrigins: [origin], localDevelopment: { port: 8791 } });
  for (const socket of [
    { remoteAddress: '192.168.1.4', localAddress: '127.0.0.1', localPort: 8791 },
    { remoteAddress: '127.0.0.1', localAddress: '0.0.0.0', localPort: 8791 },
    { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', localPort: 8787 },
    {},
  ]) {
    let status, result;
    const req = { method: 'GET', headers: { origin, host: '127.0.0.1:8791' },
      rawHeaders: ['Host', '127.0.0.1:8791', 'Origin', origin], socket };
    const res = { setHeader() {}, set statusCode(value) { status = value; }, end(text) { result = JSON.parse(text); } };
    assert.equal(await handler(req, res, '/api/editor/reviews'), true);
    assert.equal(status, 403); assert.ok(result.error);
  }
  assert.equal(calls.length, 0);
});

test('development cannot be configured on production port or with owner database credentials', () => {
  assert.throws(() => createApi({ repository: {}, allowedOrigins: [origin], localDevelopment: { port: 8787 } }), /development port/i);
  const config = { apiPort: 8787, database: { user: 'history_reader' } };
  const editorConfig = { database: { user: 'history_editor' }, tokenSha256: 'a'.repeat(64) };
  assert.equal(validateLocalDevelopmentConfiguration(config, editorConfig), 8791);
  assert.throws(() => validateLocalDevelopmentConfiguration({ ...config, apiPort: 8791 }, editorConfig), /separate/i);
  assert.throws(() => validateLocalDevelopmentConfiguration({ ...config, database: { user: 'owner' } }, editorConfig), /restricted/i);
  assert.throws(() => validateLocalDevelopmentConfiguration(config, { ...editorConfig, database: { user: 'owner' } }), /restricted/i);
});
