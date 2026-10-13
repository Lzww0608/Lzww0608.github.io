import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicReadingFetcher, hasPublicReadingResponse } from '../src/public-reading-fetch.ts';

const url = 'https://api.example/api/chapters/old-v048';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('overlapping public reads share transport and get independently consumable complete bodies; later reads revalidate', async () => {
  let calls = 0; const gate = deferred(), options = [];
  const read = createPublicReadingFetcher(async (_url, init) => { calls++; options.push(init); await gate.promise; return Response.json({ revision: calls }); });
  const first = read(url), second = read(url); gate.resolve();
  assert.deepEqual(await (await first).json(), { revision: 1 });
  assert.deepEqual(await (await second).json(), { revision: 1 }); assert.equal(calls, 1);
  assert.deepEqual(await (await read(url)).json(), { revision: 2 });
  assert.equal(options[0].cache, 'no-cache'); assert.equal(options[0].credentials, 'omit');
});
test('cancelling one reader does not cancel a shared consumer and aborting every reader stops transport', async () => {
  const gate = deferred(); let signal;
  const read = createPublicReadingFetcher(async (_url, init) => { signal = init.signal; await gate.promise; return Response.json({ ok: true }); });
  const a = new AbortController(), b = new AbortController();
  const first = read(url, { signal: a.signal }), second = read(url, { signal: b.signal }); a.abort();
  await assert.rejects(first, { name: 'AbortError' }); assert.equal(signal.aborted, false);
  gate.resolve(); assert.equal((await (await second).json()).ok, true);
  const c = new AbortController(), d = new AbortController(), gate2 = deferred(); let pendingSignal;
  const waiting = createPublicReadingFetcher(async (_url, init) => { pendingSignal = init.signal; await gate2.promise; return Response.json({}); });
  const third = waiting(url, { signal: c.signal }), fourth = waiting(url, { signal: d.signal }); c.abort(); d.abort();
  await Promise.all([assert.rejects(third, { name: 'AbortError' }), assert.rejects(fourth, { name: 'AbortError' })]);
  assert.equal(pendingSignal.aborted, true); gate2.resolve();
});
test('responding invalid and failed bodies remain authoritative responses; network failures are retried', async () => {
  let calls = 0;
  const read = createPublicReadingFetcher(async () => { calls++; if (calls === 1) throw new TypeError('offline');
    if (calls === 2) return new Response(new ReadableStream({ start(c) { c.error(new Error('truncated')); } }), { status: 200 });
    return new Response('invalid', { status: 503 }); });
  await assert.rejects(read(url), TypeError);
  const broken = await read(url); assert.equal(broken.status, 200); await assert.rejects(broken.json(), /truncated/);
  const unavailable = await read(url); assert.equal(unavailable.status, 503); assert.equal(await unavailable.text(), 'invalid');
});
test('private, authenticated, non-GET and arbitrary requests bypass public coalescing', async () => {
  let calls = 0; const initSeen = [];
  const read = createPublicReadingFetcher(async (_url, init) => { calls++; initSeen.push(init); return Response.json({}); });
  for (const [target, init] of [['https://api.example/api/editor/reviews', {}], [url, { headers: { Authorization: 'test' } }], [url, { method: 'POST' }], ['https://api.example/unrelated', {}]]) {
    await Promise.all([read(target, init), read(target, init)]);
  }
  assert.equal(calls, 8); assert.equal(initSeen[0].cache, undefined);
});
test('timeout after response headers keeps responding HTTP authority rather than claiming network offline', async () => {
  const gate = deferred(); const read=createPublicReadingFetcher(async()=>new Response(new ReadableStream({async start(c){await gate.promise;c.close();}})));
  const consumer=new AbortController(); const pending=read(url,{signal:consumer.signal});
  await new Promise(r=>setImmediate(r)); consumer.abort(new DOMException('Timeout','TimeoutError'));
  await assert.rejects(pending,error=>hasPublicReadingResponse(error)); gate.resolve();
});
