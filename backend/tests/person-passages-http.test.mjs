import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/http.mjs';
import { parsePersonPassagePagination } from '../src/person-passages.mjs';

// Drive the native request handler without opening a port or accessing the database.
function request(repository, url, method = 'GET') {
  const server = createApi({ repository, allowedOrigins: [], log: () => {} });
  return new Promise(resolve => {
    const response = { statusCode: 200, setHeader() {}, end(body) {
      resolve({ status: this.statusCode, body: body ? JSON.parse(body) : null });
    } };
    server.emit('request', { url, method, headers: {} }, response);
  });
}

test('strict pagination rejects malformed or ambiguous inputs', () => {
  assert.deepEqual(parsePersonPassagePagination(new URLSearchParams()), { limit: 50, cursor: 0, bookId: null });
  assert.deepEqual(parsePersonPassagePagination(new URLSearchParams('limit=100&cursor=23&bookId=new')), { limit: 100, cursor: 23, bookId: 'new' });
  for (const query of ['limit=0', 'limit=101', 'limit=1.0', 'limit=+1', 'limit=', 'limit=01',
    'cursor=-1', 'cursor=1.5', 'cursor=1e2', 'cursor=+1', 'cursor=01', 'cursor=9007199254740992',
    'cursor=', 'cursor=0&cursor=1', 'limit=1&limit=2', 'bookId=', 'bookId=new&bookId=old', 'bookId=%27']) {
    assert.throws(() => parsePersonPassagePagination(new URLSearchParams(query)), TypeError, query);
  }
});

test('HTTP rejects invalid pagination without calling the repository', async () => {
  let queries = 0;
  const repository = { async personPassages() { queries++; return {}; } };
  for (const query of ['limit=101', 'cursor=-1', 'cursor=NaN', 'cursor=1%0A', 'bookId=new&bookId=old']) {
    assert.equal((await request(repository, `/api/people/zhu-wen/passages?${query}`)).status, 400);
  }
  assert.equal(queries, 0);
});

test('new routes pass validated options and retain existing chapter routes', async () => {
  const calls = [];
  const repository = {
    async personPassages(personId, options) { calls.push({ personId, options }); return personId === 'missing' ? null : { personId }; },
    async passage(id) { return id === 'missing' ? null : { schemaVersion: 1, passage: { id } }; },
  };
  assert.deepEqual(await request(repository, '/api/people/zhu-wen/passages?bookId=new&limit=7&cursor=4'), { status: 200, body: { personId: 'zhu-wen' } });
  assert.deepEqual(calls[0], { personId: 'zhu-wen', options: { bookId: 'new', limit: 7, cursor: 4 } });
  assert.equal((await request(repository, '/api/people/missing/passages')).status, 404);
  assert.equal((await request(repository, '/api/passages/missing')).status, 404);
  assert.equal((await request(repository, '/api/passages/passage-new-v01-p2', 'HEAD')).body, null);
  const existingOnly = { async chapter(id) { return { id, paragraphs: [] }; } };
  assert.deepEqual(await request(existingOnly, '/api/chapters/old-1'), { status: 200, body: { id: 'old-1', paragraphs: [] } });
});
