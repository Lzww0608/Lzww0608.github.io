import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { filterSearch } from '../src/data.ts';
import { searchRelationshipNodes, relationshipsForPerson, relationshipNodes } from '../src/relationships.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';

const identities = [
  ['liang-zhu-youzhen-defei-zhang', '德妃張氏（朱友貞妻）'],
  ['liang-zhu-youzhen-consort-guo', '郭氏（朱友貞次妃）'],
  ['liang-zhu-youyong-wife-shi', '石氏（朱友雍妻）'],
  ['liang-zhu-youzhen-princess-shouchun', '壽春公主（後梁）'],
  ['liang-zhu-youzhen-princess-shouchang', '壽昌公主（後梁）'],
];

test('the last Liang family has distinct searchable identities and real sourced records and timelines', () => {
  const index = loadPersonPassageIndex(), timelines = loadPersonTimelines();
  for (const [id, traditional] of identities) {
    assert.equal(catalogPeople.filter(p => p.id === id).length, 1, id);
    assert.ok(filterSearch(traditional).some(p => p.id === id), traditional);
    assert.ok(searchRelationshipNodes(traditional).some(p => p.id === id), traditional);
    assert.ok(index.passages.some(p => p.people.some(q => q.personId === id)), id);
    assert.ok(timelines.find(d => d.personId === id)?.events.length, id);
    assert.ok(!Object.hasOwn(catalogPeople.find(p => p.id === id), 'reignStart'));
  }
});

test('Shi remains the wife of Zhu Youyong and is not turned into a third consort of the last emperor', () => {
  const edges = relationshipsForPerson('liang-zhu-youyong-wife-shi');
  assert.ok(edges.some(e => e.kind === 'kinship' && [e.from, e.to].includes('zhu-youyong')));
  assert.ok(!edges.some(e => e.kind === 'kinship' && [e.from, e.to].includes('zhu-youzhen')));
  assert.equal(relationshipNodes.find(p => p.id === 'zhu-youyong')?.external, true);
  assert.ok(!catalogPeople.some(p => p.id === 'zhu-youyong'));
});

test('the last emperor princesses retain sourced fatherhood without an invented mother', () => {
  const mothers = new Set(['liang-zhu-youzhen-defei-zhang', 'liang-zhu-youzhen-consort-guo', 'liang-zhu-wen-consort-zhang']);
  for (const [id] of identities.slice(3)) {
    const edges = relationshipsForPerson(id);
    assert.ok(edges.some(e => e.kind === 'kinship' && e.from === 'zhu-youzhen' && e.to === id));
    assert.ok(!edges.some(e => mothers.has(e.from) || mothers.has(e.to)));
    for (const e of edges) for (const endpoint of [e.from, e.to]) assert.equal(relationshipsForPerson(endpoint).filter(q => q.id === e.id).length, 1);
  }
});

test('Guo Guihou is distinct from the commander Zhang Guihou', () => {
  const id = 'liang-zhu-youzhen-consort-guo';
  const edges = relationshipsForPerson(id);
  assert.ok(edges.some(e => e.kind === 'kinship' && e.from === 'guo-guihou' && e.to === id));
  assert.ok(!edges.some(e => e.from === 'zhang-guihou' || e.to === 'zhang-guihou'));
  const passage = loadPersonPassageIndex().passages.find(p => p.id === 'passage-new-v13-p20');
  assert.ok(!passage.people.some(p => p.personId === 'zhang-guihou'));
});
