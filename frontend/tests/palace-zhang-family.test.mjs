import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { relationshipsForPerson } from '../src/relationships.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';

test('Chang Yanqing in the Li Su family record is not indexed as Kou Yanqing', () => {
  const passage = loadPersonPassageIndex().passages.find(p => p.id === 'passage-tongjian-v288-p88');
  assert.ok(passage);
  assert.ok(!passage.people.some(p => p.personId === 'kou-yanqing'));
  assert.ok(passage.people.some(p => p.personId === 'liang-zhang-quanyi-daughter-li-su-wife'));
});

test('Zhang family daughters keep source-specific identities without inferred sibling or maternal ties', () => {
  const ids = ['liang-zhang-quanyi-daughter-fuwang-wife', 'liang-zhang-quanyi-daughter-li-su-wife'];
  for (const id of ids) {
    const person = catalogPeople.find(p => p.id === id);
    assert.ok(person, id);
    const notes = [person.intro, person.sourceNotes, person.statusNote].filter(Boolean).join(' ');
    assert.match(notes, /同一自然人/);
    assert.match(notes, /没有确证|待考|同异未定/);
    assert.ok(!relationshipsForPerson(id).some(e => [e.from, e.to].includes('liang-zhang-quanyi-wife-chu')));
    assert.ok(!relationshipsForPerson(id).some(e => [e.from, e.to].includes(ids.find(q => q !== id))));
  }
});

test('the Liang Taizu in Zhang family exchanges resolves to Zhu Wen', () => {
  const passages = loadPersonPassageIndex().passages;
  for (const id of ['passage-new-v45-p7', 'passage-new-v45-p8']) {
    const passage = passages.find(p => p.id === id);
    assert.ok(passage?.people.some(p => p.personId === 'zhu-wen'), id);
    assert.ok(!passage?.people.some(p => p.personId.startsWith('liang-zhang-quanyi-daughter-')), id);
  }
});
