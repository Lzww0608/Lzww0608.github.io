import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { catalogPeople } from '../src/person-catalog.ts';
import {
  relationshipNodes, personRelationships, relationshipKindLabels,
  relationshipsForPerson, relationshipNeighborhood,
  buildRelationshipNodes, getRelationshipNeighborhood, searchRelationshipNodes,
} from '../src/relationships.ts';

const nodeIds = new Set(relationshipNodes.map(node => node.id));
const originals = new Map(loadLibrary().chapters.map(chapter => [chapter.id, chapter]));
const tenKingdomRulers = JSON.parse(readFileSync(new URL('../../content/five-dynasties/ten-kingdoms-rulers.json', import.meta.url), 'utf8')).people;

test('the graph derives all canonical people and preserves contextual metadata', () => {
  assert.equal(nodeIds.size, relationshipNodes.length);
  assert.deepEqual(
    relationshipNodes.filter(node => !node.external).map(node => node.id),
    catalogPeople.map(person => person.id),
  );
  for (const person of catalogPeople) {
    const node = relationshipNodes.find(item => item.id === person.id);
    assert.equal(node.name, person.name);
    assert.equal(node.group, person.dynasty);
  }
  const contextual = relationshipNodes.filter(node => node.external);
  assert.ok(contextual.every(node => node.note && node.group));
  assert.ok(contextual.every(node => !catalogPeople.some(person => person.id === node.id)));
});

test('every relationship cites a real archived paragraph with an unchanged, exact quotation', () => {
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

test('every added Ten Kingdom ruler has a sourced direct graph and each shared fact reaches both endpoints', () => {
  assert.equal(tenKingdomRulers.length, 43);
  for (const person of tenKingdomRulers) {
    const neighborhood = relationshipNeighborhood(person.id);
    assert.ok(neighborhood.nodes.some(n => n.id === person.id && !n.external), person.id);
    assert.ok(neighborhood.relationships.length, `${person.id}: a verified direct fact`);
    for (const fact of neighborhood.relationships) {
      assert.ok(fact.from === person.id || fact.to === person.id, `${person.id}: direct only`);
      for (const endpoint of [fact.from, fact.to]) {
        assert.equal(relationshipsForPerson(endpoint).filter(edge => edge.id === fact.id).length, 1, `${endpoint}: ${fact.id}`);
      }
    }
  }
  assert.equal(relationshipKindLabels.succession, '君位交接');
  assert.ok(personRelationships.some(e => e.from === 'qian-hongzuo' && e.to === 'qian-hongcong' && e.kind === 'succession'));
  assert.ok(personRelationships.some(e => e.from === 'qian-hongcong' && e.to === 'qian-hongchu' && e.kind === 'succession'));
  assert.ok(!personRelationships.some(e => e.from === 'qian-hongzuo' && e.to === 'qian-hongchu' && e.kind === 'succession'));
  assert.ok(!personRelationships.some(e => e.from === 'wang-yanzheng' && e.to === 'zhuo-yanming' && e.kind === 'succession'),
    'a local usurpation does not imply a normal whole-state succession');
});

test('Ten Kingdom bloodlines retain adopted children and conflicting source genealogies', () => {
  for (const id of ['liu-jien', 'liu-jiyuan']) {
    assert.ok(personRelationships.some(e => e.from === 'liu-chengjun' && e.to === id && e.kind === 'adoption'), id);
    assert.ok(!personRelationships.some(e => e.from === 'liu-chengjun' && e.to === id && e.label === '父子'), id);
  }
  assert.ok(personRelationships.some(e => e.from === 'liu-jien' && e.to === 'liu-jiyuan' && e.label === '同母异父兄弟'));
  const discrepantFatherFacts = personRelationships.filter(e => e.to === 'gao-baoxu' && e.label.startsWith('父子'));
  assert.deepEqual(new Set(discrepantFatherFacts.map(e => e.label)), new Set(['父子（新史记载）', '父子（旧史记载）']));
  assert.ok(discrepantFatherFacts.every(e => e.note.includes('旧史') && e.note.includes('新史')));
  const minKinship = personRelationships.find(e => e.from === 'liu-zhiyuan' && e.to === 'liu-min-northern-han' && e.kind === 'kinship');
  assert.ok(minKinship.note.includes('同母弟') && minKinship.note.includes('从弟'));
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

test('Zhuangzong-era additions preserve actual commanders and adopted identities in both endpoint graphs', () => {
  const documented = [
    ['li-keyong', 'guo-chongtao', 'service'],
    ['li-cunxu', 'guo-chongtao', 'service'],
    ['li-siyuan', 'yuan-xingqin', 'adoption'],
    ['li-cunxu', 'yuan-xingqin', 'service'],
    ['li-jiji', 'ren-huan', 'service'],
    ['fu-xi', 'wu-zhen', 'service'],
    ['li-siyuan', 'gao-xingzhou', 'service'],
    ['li-siyuan', 'wang-jianli', 'service'],
    ['li-siyuan', 'shi-jingtang', 'service'],
    ['li-siyuan', 'liu-zhiyuan', 'service'],
    ['li-sizhao', 'shi-junli', 'service'],
  ];
  for (const [from, to, kind] of documented) {
    const matches = personRelationships.filter(edge => edge.from === from && edge.to === to && edge.kind === kind);
    assert.equal(matches.length, 1, `${from} -> ${to}: one documented ${kind} fact`);
    const [fact] = matches;
    for (const endpoint of [from, to]) {
      const neighborhood = relationshipNeighborhood(endpoint);
      assert.equal(neighborhood.relationships.filter(edge => edge.id === fact.id).length, 1, `${endpoint}: shared fact appears once`);
      assert.equal(neighborhood.relationships.find(edge => edge.id === fact.id), fact, `${endpoint}: preserves the canonical fact and direction`);
      assert.equal(neighborhood.nodes.filter(node => node.id === (endpoint === from ? to : from)).length, 1, `${endpoint}: commander or officer is a direct neighbor`);
    }
  }
  for (const commander of ['li-siyuan', 'li-cunxu']) {
    const links = personRelationships.filter(edge => edge.from === commander && edge.to === 'yuan-xingqin');
    assert.equal(links.some(edge => edge.kind === 'kinship' || edge.label === '父子'), false, `${commander}: Yuan Xingqin is not a biological son`);
  }
  assert.equal(personRelationships.some(edge => edge.from === 'li-cunxu' && edge.to === 'yuan-xingqin' && edge.kind === 'adoption'), false, 'Li Siyuan’s adopted son is not assigned a second, unsupported adoptive father');
  for (const officer of ['ren-huan', 'wu-zhen', 'gao-xingzhou', 'wang-jianli', 'shi-jingtang', 'liu-zhiyuan', 'shi-junli']) {
    assert.equal(personRelationships.some(edge => edge.from === 'li-cunxu' && edge.to === officer && edge.kind === 'service'), false, `${officer}: serving in this reign does not imply direct service under Li Cunxu`);
  }
});

test('Shi Junli keeps his documented commanders without an inferred direct Li Keyong edge', () => {
  assert.equal(personRelationships.some(edge => edge.id === 'li-keyong-shi-junli-service'), false);
  const topic = JSON.parse(readFileSync(new URL('../../content/five-dynasties/li-keyong-generals.json', import.meta.url), 'utf8'));
  assert.ok(topic.memberIds.includes('shi-junli'), 'a topic member remains in the people collection');
  for (const [commander, id] of [['li-kerou', 'li-kerou-shi-junli-service'], ['li-sizhao', 'li-sizhao-shi-junli-service']]) {
    const fact = personRelationships.find(edge => edge.id === id);
    assert.equal(fact?.from, commander);
    assert.equal(fact?.to, 'shi-junli');
    for (const endpoint of [commander, 'shi-junli']) {
      assert.ok(relationshipsForPerson(endpoint).includes(fact), `${endpoint}: the sourced fact reaches both graphs`);
    }
  }
});

test('imperial succession stays distinct from bloodlines and includes the short reign of Zhu Yougui', () => {
  const successions = personRelationships.filter(edge => edge.kind === 'succession');
  for (const edge of successions) assert.ok(['皇位交接', '君位交接'].includes(edge.label), edge.id);
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

test('new catalog people automatically become graph nodes without duplicate person or context IDs', () => {
  const people = Object.freeze([
    Object.freeze({ id: 'fixture-a', name: '测试人物甲', dynasty: '后梁' }),
    Object.freeze({ id: 'fixture-b', name: '测试人物乙', dynasty: '后唐' }),
    Object.freeze({ id: 'fixture-a', name: '重复的甲', dynasty: '后周' }),
  ]);
  const contextNodes = Object.freeze([
    Object.freeze({ id: 'fixture-a', name: '旧关联甲', external: true }),
    Object.freeze({ id: 'fixture-context', name: '测试关联人物', external: true }),
    Object.freeze({ id: 'fixture-context', name: '重复关联人物', external: true }),
  ]);
  assert.deepEqual(buildRelationshipNodes(people, contextNodes), [
    { id: 'fixture-a', name: '测试人物甲', group: '后梁' },
    { id: 'fixture-b', name: '测试人物乙', group: '后唐' },
    { id: 'fixture-context', name: '测试关联人物', external: true },
  ]);
  const added = { ...catalogPeople[0], id: 'fixture-new-person', name: '新增测试人物' };
  const nodes = buildRelationshipNodes([...catalogPeople, added]);
  assert.deepEqual(nodes.find(node => node.id === added.id), {
    id: 'fixture-new-person', name: '新增测试人物', group: added.dynasty,
  });
  assert.equal(catalogPeople.some(person => person.id === added.id), false);
});

const fixtureNodes = [
  { id: 'fixture-a', name: '测试人物甲' },
  { id: 'fixture-b', name: '测试人物乙' },
  { id: 'fixture-c', name: '测试人物丙' },
  { id: 'fixture-d', name: '测试人物丁' },
  { id: 'fixture-isolated', name: '暂无关系人物' },
];

function fixtureEdge(id, from, to, kind = 'service') {
  return { id, from, to, kind, label: '测试关系', sources: [] };
}

test('one newly added relationship immediately appears in both endpoint graphs and leaves unrelated graphs unchanged', () => {
  const previous = [fixtureEdge('fixture-c-d', 'fixture-c', 'fixture-d')];
  const newEdge = fixtureEdge('fixture-b-a', 'fixture-b', 'fixture-a');
  const updated = [...previous, newEdge];
  assert.deepEqual(getRelationshipNeighborhood('fixture-a', fixtureNodes, previous), {
    nodes: [fixtureNodes[0]], relationships: [],
  });
  for (const id of ['fixture-a', 'fixture-b']) {
    const neighborhood = getRelationshipNeighborhood(id, fixtureNodes, updated);
    assert.deepEqual(neighborhood.nodes.map(node => node.id), ['fixture-a', 'fixture-b']);
    assert.deepEqual(neighborhood.relationships.map(edge => edge.id), ['fixture-b-a']);
  }
  assert.deepEqual(getRelationshipNeighborhood('fixture-c', fixtureNodes, updated), {
    nodes: [fixtureNodes[2], fixtureNodes[3]], relationships: [previous[0]],
  });
  assert.deepEqual(getRelationshipNeighborhood('fixture-isolated', fixtureNodes, updated), {
    nodes: [fixtureNodes[4]], relationships: [],
  });
});

test('neighborhoods reject missing or self endpoints, deduplicate IDs and preserve distinct relationship kinds', () => {
  const service = fixtureEdge('fixture-service', 'fixture-b', 'fixture-a');
  const adoption = fixtureEdge('fixture-adoption', 'fixture-a', 'fixture-b', 'adoption');
  const conflict = fixtureEdge('fixture-conflict', 'fixture-a', 'fixture-c', 'conflict');
  const edges = [
    service, adoption, conflict,
    fixtureEdge('fixture-indirect', 'fixture-b', 'fixture-d'),
    fixtureEdge('fixture-self', 'fixture-a', 'fixture-a'),
    fixtureEdge('fixture-missing', 'missing-person', 'fixture-a'),
    service,
  ];
  const neighborhood = getRelationshipNeighborhood('fixture-a', [...fixtureNodes, fixtureNodes[0]], edges);
  assert.deepEqual(neighborhood.nodes.map(node => node.id), ['fixture-a', 'fixture-b', 'fixture-c']);
  assert.deepEqual(neighborhood.relationships.map(edge => edge.id), [
    'fixture-service', 'fixture-adoption', 'fixture-conflict',
  ]);
  assert.deepEqual(getRelationshipNeighborhood('fixture-a', fixtureNodes, edges, ['adoption']), {
    nodes: [fixtureNodes[0], fixtureNodes[1]], relationships: [adoption],
  });
  assert.deepEqual(getRelationshipNeighborhood('fixture-a', fixtureNodes, edges, []), {
    nodes: [fixtureNodes[0]], relationships: [],
  });
  for (const id of ['', '   ', 'missing-person']) {
    assert.deepEqual(getRelationshipNeighborhood(id, fixtureNodes, edges), { nodes: [], relationships: [] });
  }
});

test('graph search requires input, matches names and aliases, and offers contextual people without automatically selecting one', () => {
  for (const query of ['', '   ', '\n\t']) assert.deepEqual(searchRelationshipNodes(query), []);
  assert.deepEqual(searchRelationshipNodes(' 朱全忠 ').map(node => node.id), ['zhu-wen']);
  assert.deepEqual(searchRelationshipNodes('李克用').map(node => node.id), ['li-keyong']);
  assert.deepEqual(searchRelationshipNodes('克柔').map(node => node.id), ['li-kerou']);
  assert.equal(searchRelationshipNodes('李').length > 1, true);
  assert.deepEqual(searchRelationshipNodes('不存在的人物'), []);
  assert.deepEqual(searchRelationshipNodes('后唐'), []);
  const people = [
    { id: 'fixture-a', aliases: '曾用名甲' },
    { id: 'fixture-b', aliases: '曾用名乙' },
  ];
  assert.deepEqual(searchRelationshipNodes('曾用名乙', fixtureNodes, people).map(node => node.id), ['fixture-b']);
  assert.deepEqual(searchRelationshipNodes('曾用名', fixtureNodes, people).map(node => node.id), ['fixture-a', 'fixture-b']);
  assert.deepEqual(searchRelationshipNodes('测试人物', fixtureNodes, people).map(node => node.id), [
    'fixture-a', 'fixture-b', 'fixture-c', 'fixture-d',
  ]);
});
