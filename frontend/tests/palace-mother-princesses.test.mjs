import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { filterSearch } from '../src/data.ts';
import { relationshipNodes, relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';

const mother = 'liang-zhu-yougui-mother-unknown';
const sister = 'liang-zhu-wen-sister-wanan';
const daughters = ['anyang', 'changle', 'puning', 'jinhua', 'zhenning'].map(name => 'liang-zhu-wen-princess-' + name);
const identities = [
  [mother, '朱友珪生母（失姓）'],
  [daughters[0], '安陽公主（朱溫女）'],
  [daughters[1], '長樂公主（朱溫女）'],
  [daughters[2], '普寧公主（朱溫女）'],
  [daughters[3], '金華公主（朱溫女）'],
  [daughters[4], '真寧公主（朱溫女）'],
  [sister, '萬安大長公主（朱溫妹）'],
];

test('the unnamed mother and princesses have distinct searchable canonical identities', () => {
  for (const [id, query] of identities) {
    assert.equal(catalogPeople.filter(p => p.id === id).length, 1, id);
    assert.ok(filterSearch(query).some(p => p.id === id), query);
    assert.ok(searchRelationshipNodes(query).some(p => p.id === id), query);
    assert.ok(!Object.hasOwn(catalogPeople.find(p => p.id === id), 'reignStart'));
  }
});

test('Zhu Wen five daughters and his sister Wanan remain different generations', () => {
  const unprovedMothers = new Set(['liang-zhu-wen-mother-wang', 'liang-zhu-wen-consort-zhang', mother]);
  for (const id of daughters) {
    const edges = relationshipsForPerson(id);
    assert.ok(edges.some(e => e.kind === 'kinship' && e.from === 'zhu-wen' && e.to === id), id);
    assert.ok(!edges.some(e => unprovedMothers.has(e.from) && e.to === id), id);
  }
  const edges = relationshipsForPerson(sister);
  assert.ok(edges.some(e => e.kind === 'kinship' && [e.from, e.to].includes('zhu-wen') && /兄妹/.test(e.label)));
  assert.ok(!edges.some(e => e.from === 'zhu-wen' && e.to === sister && /父女|女儿/.test(e.label)));
  assert.ok(edges.some(e => e.kind === 'kinship' && e.from === sister && e.to === 'yuan-xiangxian'));
  assert.ok(!edges.some(e => unprovedMothers.has(e.from) && e.to === sister));
});

test('Yougui mother keeps her unnamed identity and her documented maternal relationship', () => {
  const person = catalogPeople.find(p => p.id === mother);
  assert.match(person?.name ?? '', /失姓|姓氏不详/);
  assert.ok(relationshipsForPerson(mother).some(e => e.kind === 'kinship' && e.from === mother && e.to === 'zhu-yougui'));
  assert.ok(!/皇后|太后/.test(person?.name ?? ''));
});

test('Luo marriage identities preserve two princesses without merging Tinggui into Zhouhan', () => {
  const husband = relationshipNodes.find(p => p.id === 'luo-tinggui');
  assert.equal(husband?.external, true);
  assert.ok(![husband?.name, ...(husband?.aliases ?? [])].some(name => /周翰/.test(name ?? '')));
  for (const id of [daughters[0], daughters[3]]) assert.ok(relationshipsForPerson(id).some(e => e.kind === 'kinship' && [e.from, e.to].includes('luo-tinggui')), id);
  assert.notEqual(daughters[0], daughters[3]);
});

test('each new woman has real records and a nonempty timeline and each relationship derives both ways once', () => {
  const index = loadPersonPassageIndex(), timelines = loadPersonTimelines();
  for (const [id] of identities) {
    assert.ok(index.passages.some(p => p.people.some(q => q.personId === id)), id);
    assert.ok(timelines.find(d => d.personId === id)?.events.length, id);
    for (const edge of relationshipsForPerson(id)) for (const endpoint of [edge.from, edge.to]) assert.equal(relationshipsForPerson(endpoint).filter(e => e.id === edge.id).length, 1);
  }
});
