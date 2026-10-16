import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { filterSearch } from '../src/data.ts';
import { relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';

const ancestors = ['fan', 'yang', 'liu'].map(s => `liang-zhu-wen-ancestor-${s}`);
const concubine = 'liang-duan-ning-sister-meiren';
const nurse = 'liang-princes-nurse-kong-xun-mother';
const ids = [...ancestors, concubine, nurse];

test('Liang ancestors retain three distinct generations and posthumous titles', () => {
  const names = ['宣僖', '光孝', '昭懿'];
  for (const [i, id] of ancestors.entries()) {
    const person = catalogPeople.find(p => p.id === id);
    assert.match(person?.name ?? '', new RegExp(names[i]));
    assert.ok(!Object.hasOwn(person, 'reignStart'));
    assert.ok(relationshipsForPerson(id).some(e => [e.from, e.to].includes('zhu-wen')));
  }
  assert.equal(new Set(ancestors.map(id => catalogPeople.find(p => p.id === id)?.name)).size, 3);
});

test('Duan Ning sister is distinct from the unrelated Liang consorts', () => {
  const person = catalogPeople.find(p => p.id === concubine);
  assert.match(person?.name ?? '', /段/);
  assert.ok(relationshipsForPerson(concubine).some(e => [e.from, e.to].includes('duan-ning')));
  assert.ok(relationshipsForPerson(concubine).some(e => [e.from, e.to].includes('zhu-wen')));
  assert.ok(!/皇后|太后/.test(person.name));
});

test('the princes nurse is Kong Xun foster mother without an inferred Zhao surname', () => {
  const person = catalogPeople.find(p => p.id === nurse);
  assert.match(person?.name ?? '', /乳母|养母/);
  assert.ok(!/赵氏|趙氏|皇后|太后/.test(person.name));
  assert.ok(relationshipsForPerson(nurse).some(e => e.kind === 'adoption'));
  assert.ok(!relationshipsForPerson(nurse).some(e => e.kind === 'kinship' && [e.from, e.to].includes('zhu-wen') && /母子|婚配/.test(e.label)));
});

test('each added woman has source records, real events, searchable identity, and reciprocal graph views', () => {
  const index = loadPersonPassageIndex(), timelines = loadPersonTimelines();
  for (const id of ids) {
    const person = catalogPeople.find(p => p.id === id);
    assert.ok(person, id);
    assert.equal(catalogPeople.filter(p => p.id === id).length, 1);
    assert.ok(index.passages.some(p => p.people.some(q => q.personId === id)));
    assert.ok(timelines.find(d => d.personId === id)?.events.length);
    assert.ok(filterSearch(person.name).some(p => p.id === id));
    assert.ok(searchRelationshipNodes(person.name).some(p => p.id === id));
    for (const e of relationshipsForPerson(id)) for (const endpoint of [e.from, e.to]) assert.equal(relationshipsForPerson(endpoint).filter(q => q.id === e.id).length, 1);
  }
});
