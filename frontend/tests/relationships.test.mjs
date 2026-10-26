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
      // Both 《南唐书（陆游）》 and 《南唐书》（陆游） identify this edition.
      assert.ok(source.title.replace(/[《》]/gu, '').includes(chapter.bookTitle), `${edge.id}: source title`);
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
  for (const edge of successions) assert.ok(['皇位交接', '君位交接', '兵变代汉'].includes(edge.label), edge.id);
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
  assert.deepEqual(new Set(neighborhood.nodes.map(node => node.id)), new Set([selected, 'li-keyong', 'li-cunxiao', 'li-siyuan']));
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
    Object.freeze({ id: 'fixture-context', name: '测试关联人物' }),
    Object.freeze({ id: 'fixture-context', name: '重复关联人物', external: true }),
  ]);
  assert.deepEqual(buildRelationshipNodes(people, contextNodes), [
    { id: 'fixture-a', name: '测试人物甲', group: '后梁' },
    { id: 'fixture-b', name: '测试人物乙', group: '后唐' },
    { id: 'fixture-context', name: '测试关联人物', external: true, group: '关联人物' },
  ]);
  assert.equal(Object.hasOwn(contextNodes[1], 'external'), false);
  const added = { ...catalogPeople[0], id: 'fixture-new-person', name: '新增测试人物' };
  const nodes = buildRelationshipNodes([...catalogPeople, added]);
  assert.deepEqual(nodes.find(node => node.id === added.id), {
    id: 'fixture-new-person', name: '新增测试人物', group: added.dynasty,
  });
  assert.equal(catalogPeople.some(person => person.id === added.id), false);
});

test('actual ungrouped contexts get a display fallback without mutating frozen source nodes or overriding canonical groups', () => {
  const sourceUrl = new URL('../../content/person-relationships/palace-context.json', import.meta.url);
  const sourceBytes = readFileSync(sourceUrl);
  const ids = ['liu-maowei-yingzhou', 'liu-yanhao-yingzhou', 'li-chongji-congke-son', 'li-chongmei-congke-son'];
  const actual = JSON.parse(sourceBytes).filter(node => ids.includes(node.id));
  assert.equal(actual.length, 4);
  assert.ok(actual.every(node => !Object.hasOwn(node, 'group')));
  const frozen = Object.freeze(actual.map(node => Object.freeze({
    ...node, aliases: Object.freeze([...(node.aliases ?? [])]),
  })));
  const before = JSON.stringify(frozen);
  const nodes = buildRelationshipNodes([], frozen);
  for (const input of frozen) {
    assert.deepEqual(nodes.find(node => node.id === input.id), { ...input, group: '关联人物' });
    assert.ok(!Object.hasOwn(input, 'group'));
  }
  const explicit = Object.freeze({ ...frozen[0], id: 'fixture-explicit-group', group: '明确来源分组' });
  assert.deepEqual(buildRelationshipNodes([], [explicit]), [explicit]);
  assert.deepEqual(buildRelationshipNodes([
    { id: frozen[0].id, name: '统一目录人物', dynasty: '后唐' },
  ], [frozen[0], explicit]), [
    { id: frozen[0].id, name: '统一目录人物', group: '后唐' }, explicit,
  ]);
  assert.equal(JSON.stringify(frozen), before);
  assert.deepEqual(readFileSync(sourceUrl), sourceBytes);
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
  const keyongMatches = searchRelationshipNodes('李克用').map(node => node.id);
  assert.ok(keyongMatches.includes('li-keyong'));
  assert.ok(keyongMatches.includes('tang-li-keyong-wife-liu'));
  assert.equal(new Set(keyongMatches).size, keyongMatches.length);
  assert.deepEqual(searchRelationshipNodes('秦国夫人刘氏').map(node => node.id), ['tang-li-keyong-wife-liu']);
  assert.deepEqual(searchRelationshipNodes('克柔').map(node => node.id), ['li-kerou']);
  assert.equal(searchRelationshipNodes('李').length > 1, true);
  assert.deepEqual(searchRelationshipNodes('不存在的人物'), []);
  assert.deepEqual(searchRelationshipNodes('后唐', fixtureNodes.map(node => ({ ...node, group: '后唐' })), []), []);
  assert.ok(searchRelationshipNodes('后唐').some(node => node.id === 'tang-ancestor-zhiyi'));
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

const sourceRoleFixture = Object.freeze({ id: 'fixture-source-role-liu', name: '司记刘氏', group: '后周',
  identityKind: 'source-role', external: true, aliases: Object.freeze(['会要后周司记刘氏']),
  note: '《五代会要》卷一后周太祖名单按职姓分列；与其他刘氏同异未明。' });
const sourceRoleEdge = Object.freeze({ id: 'fixture-source-role-link', from: 'guo-wei', to: sourceRoleFixture.id,
  kind: 'service', label: '宫职记载', sources: Object.freeze([{ chapterId: 'huiyao-v001', paragraphId: 'huiyao-v001-p53',
    title: '五代会要 · 卷一', excerpt: '司記劉氏，〈封彭城郡夫人。〉' }]) });

test('source roles remain external searchable entries without acquiring a catalog identity or person reading route', async () => {
  const nodes = buildRelationshipNodes(catalogPeople, [sourceRoleFixture]);
  assert.deepEqual(nodes.filter(n => !n.external).map(n => n.id), catalogPeople.map(p => p.id));
  assert.equal(nodes.find(n => n.id === sourceRoleFixture.id).identityKind, 'source-role');
  assert.deepEqual(searchRelationshipNodes('會要後周司記劉氏', nodes).map(n => n.id), [sourceRoleFixture.id]);
  assert.equal(catalogPeople.some(p => p.id === sourceRoleFixture.id), false);
  const { inferReadingPerson } = await import('../src/reading-shelf-schema.ts');
  const { hasPersonTimeline } = await import('../src/person-timeline-route.ts');
  const { resolvePersonSourcesRoute } = await import('../src/library.ts');
  assert.equal(inferReadingPerson('read-huiyao/huiyao-v001', sourceRoleFixture.id), undefined);
  assert.equal(hasPersonTimeline(sourceRoleFixture.id), false);
  assert.equal(resolvePersonSourcesRoute(`person-sources/${sourceRoleFixture.id}`), null);
});

// Execute the production JSX and handlers. Only browser hooks and fixture data
// are controlled; node building, search, neighborhood and rendering stay real.
const { createRequire } = await import('node:module');
const { default: vm } = await import('node:vm');
const { transform } = await import('esbuild');
const React = await import('react');
const graphRelationships = await import('../src/relationships.ts');
const compiledGraph = await transform(readFileSync(new URL('../src/PeopleRelationshipGraph.tsx', import.meta.url), 'utf8'),
  { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
function graphElements(value) {
  if (Array.isArray(value)) return value.flatMap(graphElements);
  if (!value || typeof value !== 'object') return [];
  return [value, ...graphElements(value.props?.children)];
}
function graphText(value) {
  if (Array.isArray(value)) return value.map(graphText).join('');
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  return typeof value === 'object' ? graphText(value.props?.children) : String(value);
}
function sourceRoleGraph({ selectedPersonId, query = '', includeRole = true, sourceRole = sourceRoleFixture, sourceEdge = sourceRoleEdge } = {}) {
  const state = [], opened = [], selected = [], sources = [];
  const baseNodes = relationshipNodes.filter(node => node.identityKind !== 'source-role');
  const baseIds = new Set(baseNodes.map(node => node.id));
  const baseEdges = personRelationships.filter(edge => baseIds.has(edge.from) && baseIds.has(edge.to));
  let cursor = 0;
  const modules = {
    react: { ...React, useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = index === 4 ? query : typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    }, useEffect: () => {}, useMemo: callback => callback(), useRef: value => ({ current: value }), useId: () => 'source-role-fixture' },
    './relationships.ts': { ...graphRelationships,
      relationshipNodes: includeRole ? [...baseNodes, sourceRole] : baseNodes,
      personRelationships: includeRole ? [...baseEdges, sourceEdge] : baseEdges },
    './use-original-script.ts': { useOriginalScript: () => ({ script: 'traditional', displayScript: 'traditional', selectScript: () => {} }) },
    './relationships.css': {},
  };
  const module = { exports: {} }, nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(compiledGraph.code, { module, exports: module.exports, require: name => modules[name] ?? nativeRequire(name) });
  const render = () => { cursor = 0; return graphElements(module.exports.PeopleRelationshipGraph({ people: catalogPeople,
    selectedPersonId, onSelectPerson: id => selected.push(id), onOpenPerson: person => opened.push(person.id),
    onReadSource: (...args) => sources.push(args) })); };
  return { render, opened, selected, sources, exports: module.exports };
}

test('real graph search counts mixed role results as entries and selection never opens a role biography', () => {
  const graph = sourceRoleGraph({ query: '刘' }), elements = graph.render();
  const results = elements.find(e => e.props?.className === 'relationship-search-results');
  assert.match(graphText(results), /找到 \d+ 项/);
  assert.doesNotMatch(graphText(results), /位人物/);
  const role = graphElements(results).find(e => e.type === 'button' && graphText(e).includes('司记刘氏'));
  assert.match(graphText(role), /后周 · 来源角色/);
  role.props.onClick();
  assert.deepEqual(graph.selected, [sourceRoleFixture.id]);
  assert.deepEqual(graph.opened, []);
  assert.ok(graph.render().some(e => e.type === 'h2' && graphText(e) === '后周 · 司记刘氏的来源联系'));
  const canonical = sourceRoleGraph({ query: '朱全忠' }).render().find(e => e.props?.className === 'relationship-search-results');
  assert.match(graphText(canonical), /找到 1 位人物/);
});

test('real source-role graph uses undirected sourced links in SVG, cards and accessible labels', () => {
  const graph = sourceRoleGraph({ selectedPersonId: sourceRoleFixture.id }), elements = graph.render();
  const edge = elements.find(e => e.props?.className === 'relationship-edge kind-service');
  assert.ok(edge);
  assert.match(edge.props['aria-label'], /来源角色/);
  assert.doesNotMatch(edge.props['aria-label'], /指向/);
  assert.equal(graphElements(edge).find(e => e.props?.className === 'relationship-edge-line').props.markerEnd, undefined);
  assert.match(graphText(graphElements(edge).find(e => e.type === 'title')), /↔/);
  assert.equal(graphText(elements.find(e => e.props?.className === 'relationship-direction')), '↔');
  assert.equal(graphText(elements.find(e => e.props?.className === 'relationship-kind-label')), '来源记载');
  assert.ok(elements.some(e => e.type === 'button' && graphText(e).includes(relationshipKindLabels.service)));
  assert.match(graphText(elements.find(e => e.type === 'figcaption')), /不表示.*任命/);
  assert.doesNotMatch(graphText(elements.find(e => e.props?.className === 'relationship-context')), /没有独立人物传记|姓名可打开人物详情/);
  const node = elements.find(e => e.props?.className?.startsWith('relationship-node is-external'));
  assert.equal(graphText(graphElements(node).find(e => e.props?.className === 'relationship-node-name')), '司记刘氏');
  assert.equal(graphText(graphElements(node).find(e => e.props?.className === 'relationship-node-note')), '后周·来源角色');
  assert.match(node.props['aria-label'], /后周.*来源角色.*查看来源联系/);
  let prevented = false;
  node.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(graph.opened, []);
  elements.find(e => e.type === 'button' && graphText(e) === '阅读此处原文与白话译文').props.onClick();
  assert.deepEqual(graph.sources, [['huiyao-v001', 'huiyao-v001-p53']]);
});

test('a marriage source role uses generic provenance wording while keeping both sourced kinship labels', () => {
  const sourceRole = relationshipNodes.find(node => node.id === 'wu-yang-xingmi-daughter-jiang-yanhui-wife');
  assert.ok(sourceRole?.identityKind === 'source-role');
  const edges = personRelationships.filter(edge => edge.from === sourceRole.id || edge.to === sourceRole.id);
  assert.equal(edges.length, 2);
  for (const sourceEdge of edges) {
    assert.equal(sourceEdge.kind, 'kinship');
    const graph = sourceRoleGraph({ selectedPersonId: sourceRole.id, sourceRole, sourceEdge }), elements = graph.render();
    assert.equal(graphText(elements.find(e => e.props?.className === 'relationship-kind-label')), '来源记载');
    assert.equal(graphText(elements.find(e => e.props?.className === 'relationship-label')), sourceEdge.label);
    assert.doesNotMatch(graphText(elements.find(e => e.props?.className === 'relationship-context')), /职姓|宫职记载/);
    assert.match(graphText(elements.find(e => e.type === 'figcaption')), /具体含义以关系标签和原文依据为准/);
    elements.find(e => e.type === 'button' && graphText(e) === '阅读此处原文与白话译文').props.onClick();
    assert.deepEqual(graph.sources, [[sourceEdge.sources[0].chapterId, sourceEdge.sources[0].paragraphId]]);
  }
});

test('adding a role preserves every original canonical graph edge direction and person opening behavior', () => {
  const before = sourceRoleGraph({ selectedPersonId: 'guo-wei', includeRole: false }).render();
  const graph = sourceRoleGraph({ selectedPersonId: 'guo-wei' }), after = graph.render();
  const paths = elements => new Map(elements.filter(e => e.props?.className?.startsWith('relationship-edge kind-'))
    .map(e => [e.props['aria-label'], graphElements(e).find(x => x.props?.className === 'relationship-edge-line').props.markerEnd]));
  for (const [label, marker] of paths(before)) assert.equal(paths(after).get(label), marker, label);
  const rolePath = [...paths(after)].find(([label]) => label.includes('司记刘氏')); assert.ok(rolePath); assert.equal(rolePath[1], undefined);
  const person = after.find(e => e.props?.className?.startsWith('relationship-node') && e.props['aria-label'] === '郭威，打开人物详情');
  person.props.onClick(); assert.deepEqual(graph.opened, ['guo-wei']);
  assert.match(graphText(before.find(e => e.type === 'figcaption')), /虚线框为关联人物，当前没有独立传记/);
});

test('real sibling kinship paths are undirected in both endpoint graphs and their evidence cards', () => {
  const ids = [
    'wei-quanfeng-unnamed-elder-sister',
    'zhu-wen-wanan-siblings',
    'tang-li-siyuan-princess-yongning-xingping-sisters',
    'tang-li-chongjun-sister-brother',
    'ma-xifan-ma-xiguang-kinship-ten-kingdoms',
    'qian-hongcong-qian-hongchu-kinship-ten-kingdoms',
    'liu-jien-liu-jiyuan-kinship-ten-kingdoms',
    'wang-yanxi-wang-yanzheng-kinship-ten-kingdoms',
    'li-conghou-li-congke-sibling',
    'xu-xuan-xu-kai-kinship',
  ];
  for (const id of ids) {
    const fact = personRelationships.find(edge => edge.id === id);
    assert.equal(fact?.kind, 'kinship', id);
    for (const selectedPersonId of [fact.from, fact.to]) {
      const elements = sourceRoleGraph({ selectedPersonId, includeRole: false }).render();
      const edge = elements.find(e => e.key === id && e.props?.className === 'relationship-edge kind-kinship');
      assert.ok(edge, `${id}: visible from ${selectedPersonId}`);
      const line = graphElements(edge).find(e => e.props?.className === 'relationship-edge-line');
      assert.match(line.props.d, /^M .* C /, `${id}: actual rendered path`);
      assert.equal(line.props.markerEnd, undefined, `${id}: no arrow from ${selectedPersonId}`);
      assert.doesNotMatch(edge.props['aria-label'], /指向/, id);
      assert.match(graphText(graphElements(edge).find(e => e.type === 'title')), /↔/, id);
      const card = elements.find(e => e.key === id && e.props?.className === 'relationship-list-item kind-kinship');
      assert.equal(graphText(graphElements(card).find(e => e.props?.className === 'relationship-direction')), '↔', id);
      assert.equal(graphText(graphElements(card).find(e => e.props?.className === 'relationship-label')), fact.label, id);
    }
  }
  for (const options of [{ selectedPersonId: 'wu-wei-quanfeng', includeRole: false }, { selectedPersonId: sourceRoleFixture.id }]) {
    const elements = sourceRoleGraph(options).render();
    assert.match(graphText(elements.find(e => e.type === 'figcaption')), /兄弟姊妹、冲突和泛称亲属使用无箭头连线/);
  }
});

test('real parent, adoption, service and in-law paths retain their direction while conflict stays undirected', () => {
  for (const [id, directed] of [
    ['wei-quanfeng-unnamed-daughter-father-daughter', true],
    ['li-keyong-li-cunhao-adoption', true],
    ['li-keyong-guo-chongtao-service', true],
    ['wu-tian-jun-guo-congshi-brother-in-law', true],
    ['liu-sheng-liu-bin-southern-han-conflict-ten-kingdoms', false],
  ]) {
    const fact = personRelationships.find(edge => edge.id === id);
    assert.ok(fact, id);
    for (const selectedPersonId of [fact.from, fact.to]) {
      const elements = sourceRoleGraph({ selectedPersonId, includeRole: false }).render();
      const edge = elements.find(e => e.key === id && e.props?.className === `relationship-edge kind-${fact.kind}`);
      assert.ok(edge, id);
      const line = graphElements(edge).find(e => e.props?.className === 'relationship-edge-line');
      assert.equal(line.props.markerEnd, directed ? `url(#source-role-fixture-arrow-${fact.kind})` : undefined, id);
      assert.equal(edge.props['aria-label'].includes('指向'), directed, id);
      assert.equal(graphText(graphElements(edge).find(e => e.type === 'title')).includes('→'), directed, id);
      const card = elements.find(e => e.key === id && e.props?.className === `relationship-list-item kind-${fact.kind}`);
      assert.equal(graphText(graphElements(card).find(e => e.props?.className === 'relationship-direction')), directed ? '→' : '↔', id);
    }
  }
});

test('sibling direction recognizes qualified kinship labels without treating in-laws or actions as siblings', () => {
  const { isRelationshipDirected } = sourceRoleGraph().exports;
  for (const label of ['兄弟', '同母兄弟', '异母兄弟', '同母异父兄弟', '兄妹', '姐妹', '姊妹', '姐弟', '姊弟',
    '兄弟（新史记载）', '兄弟，徐锴为弟', '兄妹（按源）', '同父异母姐妹']) {
    assert.equal(isRelationshipDirected({ kind: 'kinship', label }), false, label);
  }
  for (const label of ['姻亲（妻弟）', '妻弟', '妹夫', '姐夫', '弑兄夺位', '兄弟共同出征']) {
    assert.equal(isRelationshipDirected({ kind: 'kinship', label }), true, label);
  }
  assert.equal(isRelationshipDirected({ kind: 'service', label: '与兄弟共事' }), true);
  assert.equal(isRelationshipDirected({ kind: 'adoption', label: '养父子' }), true);
  assert.equal(isRelationshipDirected({ kind: 'conflict', label: '弑兄夺位' }), false);
});
