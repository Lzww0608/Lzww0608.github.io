import test from 'node:test';
import assert from 'node:assert/strict';
import { people, searchItems, filterSearch } from '../src/data.ts';
import { resolveRoute, resolveReadingRoute } from '../src/library.ts';

test('retired page addresses and the root resolve to people while original reading links remain valid', () => {
  for (const hash of ['', '#', '#overview', '#timeline', '#sources', '#map', '#unknown']) {
    assert.equal(resolveRoute(hash), 'people', hash);
  }
  assert.equal(resolveRoute('#people'), 'people');
  for (const route of ['read-old/old-v056', 'read-new/new-v36', 'read-tongjian/tongjian-v294']) {
    assert.equal(resolveRoute(`#${route}`), route);
    assert.ok(resolveReadingRoute(route));
  }
});

test('public search returns existing people without exposing retired events or source catalog entries', () => {
  assert.equal(searchItems.length, people.length);
  assert.ok(searchItems.every(item => item.type === 'person'));
  assert.deepEqual(new Set(filterSearch('').map(item => item.id)), new Set(people.map(person => person.id)));
  assert.deepEqual(filterSearch('资治通鉴'), []);
  assert.deepEqual(filterSearch('', 'book'), []);
  assert.deepEqual(filterSearch('', 'event'), []);
  assert.deepEqual(filterSearch('安敬思').map(person => person.id), ['li-cunxiao']);
});
