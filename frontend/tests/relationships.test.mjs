import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLibrary } from '../../content/library.mjs';
import { catalogPeople } from '../src/person-catalog.ts';
import {
  relationshipNodes, personRelationships, relationshipKindLabels,
  relationshipsForPerson, relationshipNeighborhood,
} from '../src/relationships.ts';

const nodeIds = new Set(relationshipNodes.map(node => node.id));
const originals = new Map(loadLibrary().chapters.map(chapter => [chapter.id, chapter]));

test('the graph preserves all 25 canonical people and identifies its two contextual nodes', () => {
  assert.equal(nodeIds.size, relationshipNodes.length);
  assert.equal(catalogPeople.length, 25);
  assert.deepEqual(
    relationshipNodes.filter(node => !node.external).map(node => node.id),
    catalogPeople.map(person => person.id),
  );
  for (const person of catalogPeople) {
    const node = relationshipNodes.find(item => item.id === person.id);
    assert.equal(node.name, person.name);
    assert.equal(node.group, person.dynasty);
    assert.ok(relationshipsForPerson(person.id).length > 0, person.id);
  }
  const contextual = relationshipNodes.filter(node => node.external);
  assert.deepEqual(contextual.map(node => node.id), ['li-keyong', 'li-kerou']);
  assert.ok(contextual.every(node => node.note && node.group === '河东 / 晋国'));
  assert.ok(contextual.every(node => !catalogPeople.some(person => person.id === node.id)));
});

test('every relationship cites a real archived paragraph with an unchanged, exact quotation', () => {
  assert.ok(personRelationships.length >= 20 && personRelationships.length <= 40);
  assert.equal(new Set(personRelationships.map(edge => edge.id)).size, personRelationships.length);
  for (const edge of personRelationships) {
    assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), edge.id);
    assert.notEqual(edge.from, edge.to, edge.id);
    assert.ok(Object.hasOwn(relationshipKindLabels, edge.kind), edge.id);
    assert.ok(edge.label.trim() && edge.sources.length, edge.id);
    for (const source of edge.sources) {
      const chapter = originals.get(source.chapterId);
      assert.ok(chapter, `${edge.id}: ${source.chapterId}`);
      const paragraph = chapter.paragraphs.find(item => item.id === source.paragraphId);
      assert.ok(paragraph, `${edge.id}: ${source.paragraphId}`);
      assert.ok(source.title.includes(chapter.bookTitle), `${edge.id}: source title`);
      assert.ok(source.excerpt.trim(), `${edge.id}: quotation`);
      assert.ok(paragraph.original.includes(source.excerpt), `${edge.id}: exact archived quotation`);
    }
  }
});

test('biological, adopted and military relationships retain the distinctions in the histories', () => {
  assert.ok(personRelationships.some(edge => edge.from === 'li-keyong' && edge.to === 'li-cunxu' && edge.kind === 'kinship' && edge.label === '父子'));
  assert.ok(personRelationships.some(edge => edge.from === 'li-keyong' && edge.to === 'li-siyuan' && edge.kind === 'adoption'));
  for (const id of ['kang-junli', 'shi-jingsi', 'fu-cunshen']) {
    const links = personRelationships.filter(edge => edge.from === 'li-keyong' && edge.to === id);
    assert.ok(links.some(edge => edge.kind === 'service'), id);
    assert.equal(links.some(edge => edge.kind === 'adoption' || edge.label === '父子'), false, id);
  }
  const sizhaoAdoption = personRelationships.filter(edge => edge.to === 'li-sizhao' && edge.kind === 'adoption');
  assert.equal(sizhaoAdoption.length, 1);
  assert.equal(sizhaoAdoption[0].from, 'li-kerou');
  assert.ok(sizhaoAdoption[0].sources.some(source => source.chapterId === 'old-v052'));
  assert.ok(sizhaoAdoption[0].sources.some(source => source.chapterId === 'new-v36'));
  assert.ok(sizhaoAdoption[0].note.includes('李克柔') && sizhaoAdoption[0].note.includes('李克用'));
  assert.ok(personRelationships.some(edge => edge.from === 'li-keyong' && edge.to === 'li-sizhao' && edge.kind === 'service'));
  const chonggui = personRelationships.filter(edge => edge.from === 'shi-jingtang' && edge.to === 'shi-chonggui');
  assert.ok(chonggui.some(edge => edge.kind === 'kinship' && edge.label === '叔侄'));
  assert.ok(chonggui.some(edge => edge.kind === 'adoption'));
});

test('imperial succession stays distinct from bloodlines and includes the short reign of Zhu Yougui', () => {
  const successions = personRelationships.filter(edge => edge.kind === 'succession');
  assert.equal(successions.length, 9);
  for (const edge of successions) assert.equal(edge.label, '皇位交接');
  for (const [from, to] of [
    ['zhu-wen', 'zhu-yougui'], ['zhu-yougui', 'zhu-youzhen'],
    ['li-cunxu', 'li-siyuan'], ['li-siyuan', 'li-conghou'], ['li-conghou', 'li-congke'],
    ['shi-jingtang', 'shi-chonggui'], ['liu-zhiyuan', 'liu-chengyou'],
    ['guo-wei', 'chai-rong'], ['chai-rong', 'chai-zongxun'],
  ]) assert.ok(successions.some(edge => edge.from === from && edge.to === to), `${from} -> ${to}`);
  assert.equal(personRelationships.some(edge => edge.from === 'li-cunxu' && edge.to === 'li-siyuan' && edge.label === '父子'), false);
});

test('person neighborhoods contain only the selected person and directly documented neighbors', () => {
  const selected = 'li-cunxin';
  const neighborhood = relationshipNeighborhood(selected);
  assert.deepEqual(new Set(neighborhood.nodes.map(node => node.id)), new Set([selected, 'li-keyong', 'li-cunxiao']));
  assert.deepEqual(neighborhood.relationships, relationshipsForPerson(selected));
  assert.ok(neighborhood.relationships.every(edge => edge.from === selected || edge.to === selected));
  const conflicts = relationshipNeighborhood(selected, ['conflict']);
  assert.deepEqual(new Set(conflicts.nodes.map(node => node.id)), new Set([selected, 'li-cunxiao']));
  assert.ok(conflicts.relationships.every(edge => edge.kind === 'conflict'));
  assert.deepEqual(relationshipNeighborhood(selected, []).nodes.map(node => node.id), [selected]);
  assert.deepEqual(relationshipsForPerson(selected, []), []);
  assert.deepEqual(relationshipsForPerson('missing-person'), []);
  assert.deepEqual(relationshipNeighborhood('missing-person'), { nodes: [], relationships: [] });
});
