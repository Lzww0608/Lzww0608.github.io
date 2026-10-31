import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, resolveReadingRoute } from '../src/library.ts';
import * as data from '../src/data.ts';
import * as relationships from '../src/relationships.ts';
import * as shelf from '../src/reading-shelf-schema.ts';

test('the root chooses an era while existing Five Dynasties and reading addresses remain stable', () => {
  for (const hash of ['', '#', '#eras', '#unknown']) assert.equal(resolveRoute(hash), 'eras');
  assert.equal(resolveRoute('#people'), 'people');
  assert.equal(resolveRoute('#people/southern-northern'), 'people/southern-northern');
  assert.equal(resolveRoute('#people/unregistered-era'), 'eras');
  const old = 'read-old/old-v028?paragraph=old-v028-p16';
  assert.equal(resolveRoute(`#${old}`), old);
  assert.equal(resolveReadingRoute(old).chapter.id, 'old-v028');
});

test('era person and public search lists have no identities from the other era or hidden Song dynasty', () => {
  assert.equal(typeof data.peopleForEra, 'function');
  const five = data.peopleForEra('five-dynasties');
  const south = data.peopleForEra('southern-northern');
  assert.ok(five.length > 0);
  assert.ok(five.every(person => !['刘宋', '南齐', '南梁', '南陈', '宋'].includes(person.dynasty)));
  assert.ok(south.every(person => ['刘宋', '南齐', '南梁', '南陈'].includes(person.dynasty)));
  assert.deepEqual(data.filterSearch('', 'person', 'five-dynasties').map(person => person.id), five.map(person => person.id));
  assert.deepEqual(data.filterSearch('', 'person', 'southern-northern').map(person => person.id), south.map(person => person.id));
  assert.deepEqual(data.filterSearch('朱温', 'person', 'southern-northern'), []);
  assert.ok(data.filterSearch('朱温', 'person', 'five-dynasties').length > 0);
});

test('a scoped relationship graph includes only context nodes attached to its canonical people', () => {
  assert.equal(typeof relationships.relationshipNodesForPeople, 'function');
  const people = [{ id: 'south', name: '南朝人物', dynasty: '刘宋' }];
  const nodes = [{ id: 'south-parent', name: '南朝亲属', external: true }, { id: 'five-parent', name: '五代亲属', external: true }];
  const edges = [{ id: 'a', from: 'south-parent', to: 'south' }, { id: 'b', from: 'five-parent', to: 'five' }];
  assert.deepEqual(relationships.relationshipNodesForPeople(people, nodes, edges).map(node => node.id), ['south', 'south-parent']);
  assert.deepEqual(relationships.relationshipNodesForPeople([], nodes, edges), []);
});

test('context-to-context relationships remain searchable within the same era without reaching another canonical era', () => {
  const people = [{ id: 'south', name: '南朝人物', dynasty: '刘宋' }];
  const nodes = ['parent', 'sibling', 'unrelated'].map(id => ({ id, name: id, external: true }));
  const edges = [{ from: 'south', to: 'parent' }, { from: 'parent', to: 'sibling' }, { from: 'five', to: 'unrelated' }];
  assert.deepEqual(relationships.relationshipNodesForPeople(people, nodes, edges).map(node => node.id), ['south', 'parent', 'sibling']);
});

test('era shelf filtering classifies public route, person and chapter identities without losing unassigned reader entries', () => {
  assert.equal(typeof shelf.readingShelfEra, 'function');
  assert.equal(shelf.readingShelfEra({ route: 'person-timeline/li-cunxu', personId: 'li-cunxu' }), 'five-dynasties');
  assert.equal(shelf.readingShelfEra({ route: 'read-old/old-v028' }), 'five-dynasties');
  assert.equal(shelf.readingShelfEra({ chapterId: 'old-v028', kind: 'paragraph' }), 'five-dynasties');
  assert.equal(shelf.readingShelfEra({ route: 'event-comparison/huliu' }), 'five-dynasties');
  assert.equal(shelf.readingShelfEra({ route: 'owner-review' }), undefined);
  assert.equal(shelf.readingShelfEra({ chapterId: 'unknown', kind: 'paragraph' }), undefined);
});
