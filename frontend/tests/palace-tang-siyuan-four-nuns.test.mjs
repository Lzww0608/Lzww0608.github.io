import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipsForPerson } from '../src/relationships.ts';

const ids = ['tang-nun-huiying', 'tang-nun-huideng', 'tang-nun-huineng', 'tang-nun-huiyan'];
test('four named nuns retain one shared edict and two-source chronology without inheriting male offices or burial', () => {
  const index = loadPersonPassageIndex(), docs = loadPersonTimelines();
  for (const id of ids) {
    const person = catalogPeople.find(p => p.id === id); assert.ok(person, id);
    assert.match(person.name, /尼.+（明宗亲属）/);
    assert.equal(person.birthYear, undefined); assert.equal(person.deathYear, undefined);
    const rows = index.passages.filter(p => p.people.some(q => q.personId === id));
    assert.equal(rows.length, 1, id); assert.equal(rows[0].people.find(q => q.personId === id).kind, 'record');
    assert.deepEqual(rows[0].spans.map(s => s.paragraphId), ['old-v112-p2']);
    const doc = docs.find(d => d.personId === id); assert.ok(doc, id); assert.equal(doc.events.length, 1);
    const event = doc.events[0]; assert.equal(event.year, 951); assert.equal(event.precision, 'day');
    assert.equal(event.sourceDate, '广顺元年十一月丁亥');
    assert.deepEqual(event.evidence.map(s => s.paragraphId), ['old-v112-p1', 'old-v112-p2']);
    assert.ok(event.summary.includes('同诏具名对象之一')); assert.ok(event.summary.includes('未记实际交付与个人份额'));
    assert.ok(person.sourceNotes.some(n => n.includes('四次诏令') && n.includes('不')));
    assert.ok(person.sourceNotes.some(n => n.includes('李重玉') && n.includes('不移给四尼')));
    assert.ok(person.sourceNotes.some(n => n.includes('不写四尼迁葬')));
    assert.ok(person.sourceNotes.some(n => n.includes('不补俗姓李')));
  }
  assert.equal(new Set(ids.map(id => catalogPeople.find(p => p.id === id).id)).size, 4);
});
test('four reciprocal edges preserve unspecified Mingzong kinship without invented parental or service links', () => {
  const edges = [...new Map(ids.flatMap(id => relationshipsForPerson(id)).map(e => [e.id, e])).values()];
  assert.equal(edges.length, 4);
  for (const id of ids) {
    const found = edges.filter(e => e.to === id); assert.equal(found.length, 1);
    const edge = found[0]; assert.equal(edge.from, 'li-siyuan'); assert.equal(edge.kind, 'kinship');
    assert.equal(edge.label, '亲属（具体关系未载）');
    assert.deepEqual(edge.sources.map(s => s.paragraphId), ['old-v112-p2']);
    assert.ok(edge.note.includes('不据此断为女儿、侄女、姊妹或同母'));
    for (const who of [edge.from, edge.to]) assert.ok(relationshipsForPerson(who).some(e => e.id === edge.id));
    assert.ok(!relationshipsForPerson(id).some(e => e.kind === 'service'));
  }
});

// Render the production graph with only browser hooks disabled; real nodes,
// relationship facts and JSX rendering remain in use.
const { readFileSync } = await import('node:fs');
const { createRequire } = await import('node:module');
const { default: vm } = await import('node:vm');
const { transform } = await import('esbuild');
const React = await import('react');
const graphRelationships = await import('../src/relationships.ts');
const graphSource = await transform(readFileSync(new URL('../src/PeopleRelationshipGraph.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic',
});
function graphModule() {
  const modules = {
    react: { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {}, useMemo: callback => callback(), useRef: value => ({ current: value }), useId: () => 'direction-fixture' },
    './relationships.ts': graphRelationships,
    './use-original-script.ts': { useOriginalScript: () => ({ script: 'traditional', displayScript: 'traditional', selectScript: () => {} }) },
    './relationships.css': {},
  };
  const module = { exports: {} }, nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(graphSource.code, { module, exports: module.exports, require: name => modules[name] ?? nativeRequire(name) });
  return module.exports;
}
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
test('unspecified kinship uses no SVG arrow, directional title or card arrow in each real nun graph', () => {
  const { PeopleRelationshipGraph } = graphModule();
  const before = structuredClone(graphRelationships.personRelationships);
  for (const id of ids) {
    const elements = graphElements(PeopleRelationshipGraph({ people: catalogPeople, selectedPersonId: id, onOpenPerson: () => {} }));
    const paths = elements.filter(e => e.type === 'path' && e.props.className === 'relationship-edge-line');
    assert.equal(paths.length, 1); assert.equal(paths[0].props.markerEnd, undefined, id);
    const edge = elements.find(e => e.props?.className === 'relationship-edge kind-kinship'); assert.ok(edge);
    const title = graphElements(edge).find(e => e.type === 'title'); assert.match(graphText(title), /^李嗣源 ↔ 尼惠/u);
    assert.match(edge.props['aria-label'], /^李嗣源与尼惠/u);
    const symbol = elements.find(e => e.props?.className === 'relationship-direction'); assert.equal(graphText(symbol), '↔');
    const caption = elements.find(e => e.type === 'figcaption'); assert.match(graphText(caption), /不表示辈分/u);
  }
  assert.deepEqual(graphRelationships.personRelationships, before);
});
test('one direction rule keeps directed facts while treating generic kinship and sibling labels as unordered', () => {
  const { isRelationshipDirected, PeopleRelationshipGraph } = graphModule(); assert.equal(typeof isRelationshipDirected, 'function');
  const siblingLabels = new Set(['兄弟', '兄妹', '姐妹', '姊妹', '姊弟', '同母兄弟', '异母兄弟', '同母异父兄弟',
    '兄妹（按源）', '兄弟（长幼异说）', '兄弟（新史记载）', '兄弟（养亲）', '兄弟，徐锴为弟', '姊妹（长幼有异说）',
    '兄弟（道规为弟）', '兄弟（道怜为弟）']);
  for (const relationship of graphRelationships.personRelationships) {
    const oldDirection = relationship.kind !== 'conflict' && relationship.label !== '兄弟';
    const genericKinship = relationship.kind === 'kinship' && relationship.label.includes('亲属');
    const siblingKinship = relationship.kind === 'kinship' && siblingLabels.has(relationship.label);
    assert.equal(isRelationshipDirected(relationship), genericKinship || siblingKinship ? false : oldDirection, relationship.id);
  }
  for (const [kind, label] of [['kinship', '父女'], ['kinship', '母子'], ['adoption', '养育'], ['service', '任职'], ['succession', '帝位交接']])
    assert.equal(isRelationshipDirected({ kind, label }), true, kind + '/' + label);
  for (const [kind, label] of [['kinship', '兄弟'], ['conflict', '冲突'], ['kinship', '亲属（具体关系未载）'], ['kinship', '同族亲属（亲疏异说）']])
    assert.equal(isRelationshipDirected({ kind, label }), false, kind + '/' + label);
  const elements = graphElements(PeopleRelationshipGraph({ people: catalogPeople, selectedPersonId: 'li-cunxu', onOpenPerson: () => {} }));
  const parentEdge = elements.find(e => e.props?.['aria-label'] === '李克用指向李存勖：父子，查看原文依据'); assert.ok(parentEdge);
  const parentPath = graphElements(parentEdge).find(e => e.props?.className === 'relationship-edge-line');
  assert.equal(parentPath.props.markerEnd, 'url(#direction-fixture-arrow-kinship)');
  const parentTitle = graphElements(parentEdge).find(e => e.type === 'title'); assert.equal(graphText(parentTitle), '李克用 → 李存勖：父子');
});
