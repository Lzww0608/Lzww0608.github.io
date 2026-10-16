import test from 'node:test';
import assert from 'node:assert/strict';
import palace from '../../content/five-dynasties/palace-people.json' with { type: 'json' };
import { catalogPeople, peopleForGroup } from '../src/person-catalog.ts';
import { people, filterSearch } from '../src/data.ts';
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipNodes, relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';

const firstFamily = [
  'liang-zhu-wen-mother-wang', 'liang-zhu-wen-consort-zhang',
  'liang-zhu-wen-zhaoyi-chen', 'liang-zhu-wen-zhaorong-li',
];

test('palace identities are searchable full profiles with real records and events', () => {
  const library = loadLibrary();
  const index = loadPersonPassageIndex(library);
  const timelines = loadPersonTimelines(library);
  assert.equal(palace.id, 'palace-people');
  assert.deepEqual(peopleForGroup(people, palace.id).map(p => p.id), palace.memberIds);
  const traditionalLabels = {'liang-zhu-wen-zhaoyi-chen':'昭儀陳氏（後梁）','liang-zhu-wen-zhaorong-li':'昭容李氏（後梁）','liang-zhu-jin-wife':'朱瑾妻（被納後為尼）','liang-zhu-yougui-wife-zhang':'張氏（朱友珪妻）'};
  for (const [id, label] of Object.entries(traditionalLabels)) {
    assert.ok(filterSearch(label).some(p => p.id === id), label);
    assert.ok(searchRelationshipNodes(label).some(p => p.id === id), label);
  }
  for (const id of firstFamily) assert.ok(palace.memberIds.includes(id), id);
  for (const person of palace.people) {
    for (const list of [catalogPeople, people, loadPassagePeople(), relationshipNodes]) {
      assert.equal(list.filter(p => p.id === person.id).length, 1, person.id);
    }
    assert.ok(filterSearch(person.name).some(p => p.id === person.id), person.name);
    assert.ok(searchRelationshipNodes(person.name).some(p => p.id === person.id), person.name);
    assert.ok(index.passages.some(p => p.people.some(q => q.personId === person.id)), person.id);
    assert.ok(timelines.find(t => t.personId === person.id)?.events.length > 0, person.id);
    for (const key of ['reign', 'reignStart', 'reignEnd']) assert.equal(person[key], undefined);
  }
});

test('palace relationships retain evidence and occur once at each endpoint', () => {
  const original = new Map(loadLibrary().chapters.flatMap(c => c.paragraphs.map(p => [p.id, p.original])));
  for (const id of firstFamily) {
    const edges = relationshipsForPerson(id);
    assert.ok(edges.length > 0, id);
    for (const edge of edges) {
      for (const endpoint of [edge.from, edge.to]) {
        assert.equal(relationshipsForPerson(endpoint).filter(q => q.id === edge.id).length, 1);
      }
      for (const source of edge.sources) assert.ok(original.get(source.paragraphId)?.includes(source.excerpt), edge.id);
    }
  }
  assert.equal(relationshipsForPerson('liang-zhu-wen-mother-wang').filter(e => e.from === 'liang-zhu-wen-mother-wang' && e.to === 'zhu-wen' && e.kind === 'kinship').length, 1);
  assert.ok(!relationshipsForPerson('liang-zhu-wen-consort-zhang').some(e => e.kind === 'adoption' && e.to === 'zhu-youzhen'));
});

test('same-surname palace women are not attributed by a global surname rule', async () => {
  const { readFileSync } = await import('node:fs');
  const rules = JSON.parse(readFileSync(new URL('../../content/person-passages/rules.json', import.meta.url)));
  const unsafe = new Set(['王氏', '張氏', '李氏', '陳氏', '太后', '皇后', '夫人', '妃']);
  for (const person of palace.people) {
    const rule = rules.people.find(r => r.personId === person.id);
    assert.ok(rule, person.id);
    for (const value of [...rule.names, ...rule.titles, ...(rule.shortNames ?? [])]) assert.ok(!unsafe.has(value), `${person.id}/${value}`);
  }
});

test('a mother, daughters-in-law and Zhu Jin\'s later wife retain different identities', () => {
  const index = loadPersonPassageIndex();
  const attributed = (personId, paragraphId) => index.passages.some(p => p.spans.some(s => s.paragraphId === paragraphId)
    && p.people.some(q => q.personId === personId));
  assert.ok(attributed('liang-zhu-wen-mother-wang', 'new-v13-p3'));
  assert.ok(!attributed('liang-zhu-wen-mother-wang', 'new-v13-p45'));
  assert.ok(attributed('liang-zhu-youwen-wife-wang', 'new-v13-p45'));
  assert.ok(attributed('liang-zhu-yougui-wife-zhang', 'new-v13-p47'));
  assert.ok(attributed('liang-zhu-jin-wife', 'new-v13-p11'));
  assert.ok(!attributed('liang-zhu-jin-wife', 'tongjian-v270-p38'));
  assert.ok(!attributed('liu-min-northern-han', 'old-v011-p2'));
  assert.ok(!attributed('liu-min-northern-han', 'beimeng-v017-p5'));
  const kind = (id, pid) => index.passages.find(p => p.spans.some(s => s.paragraphId === pid))?.people.find(p => p.personId === id)?.kind;
  assert.equal(kind('zhu-yougui', 'old-v011-p4'), 'mention');
  assert.equal(kind('zhu-wen', 'old-v011-p6'), 'mention');
  const patron = relationshipNodes.find(p => p.id === 'liu-chong-xiaoxian');
  assert.equal(patron?.external, true);
  assert.ok(!catalogPeople.some(p => p.id === patron.id));
  assert.ok(!relationshipsForPerson('liang-liu-chong-mother').some(e => e.to === 'liu-min-northern-han' || e.from === 'liu-min-northern-han'));
});
