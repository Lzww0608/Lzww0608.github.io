import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { validatePersonTimeline } from '../../content/person-timelines.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { buildPersonPassageIndex } from '../../scripts/index-person-passages.mjs';
import { validateMilitaryTopic } from '../../content/military-people.mjs';
import { catalogPeople, peopleForGroup, personTopicRelationships } from '../src/person-catalog.ts';
import { people, filterSearch } from '../src/data.ts';
import { personRelationships, relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const topic = read('../../content/five-dynasties/military-people.json');
const canonicalOwner = read('../../content/five-dynasties/zhu-wen-generals.json');
const timeline = read('../../content/person-timelines/ge-congzhou.json');
const index = read('../../content/person-passages/index.json');
const rules = read('../../content/person-passages/rules.json');
const military = read('../../content/person-relationships/military.json');
const library = loadLibrary();
const event = id => timeline.events.find(item => item.id === `ge-congzhou-${id}`);
const allRefs = e => [...e.evidence, ...(e.variants ?? []).flatMap(v => v.evidence)];
const oldIds = ['join', 'save-zhu', 'heyang', 'luzhou', 'weisu', 'shifoshan', 'xintai', 'yanzhou-ambush',
  'luoluo', 'yunyanzhou', 'huainan', 'three-prefectures', 'zhanggongqiao', 'wei-rescue', 'lu-aid',
  'laoyadi', 'taiyuan', 'liuxun', 'chenliu', 'early-campaigns', 'recruit', 'xuzhou-huainan',
  'prefectures', 'retire', 'death'];
const newFacts = [
  ['zhu-zhen-ge-congzhou-service', 'zhu-zhen', 'ge-congzhou', 'service'],
  ['pang-shigu-ge-congzhou-service', 'pang-shigu', 'ge-congzhou', 'service'],
  ['ge-congzhou-zhang-guiba-service', 'ge-congzhou', 'zhang-guiba', 'service'],
  ['ge-congzhou-zhang-guibian-service', 'ge-congzhou', 'zhang-guibian', 'service'],
  ['ge-congzhou-huang-wenjing-service', 'ge-congzhou', 'huang-wenjing', 'service'],
  ['ge-congzhou-hu-gui-service', 'ge-congzhou', 'hu-gui', 'service'],
  ['ge-congzhou-fang-zhiwen-service', 'ge-congzhou', 'fang-zhiwen', 'service'],
  ['ge-congzhou-zhang-cunjing-service', 'ge-congzhou', 'zhang-cunjing', 'service'],
  ['ge-congzhou-li-cunxin-conflict', 'ge-congzhou', 'li-cunxin', 'conflict'],
  ['ge-congzhou-zhou-dewei-conflict', 'ge-congzhou', 'zhou-dewei', 'conflict'],
  ['ge-congzhou-li-sizhao-conflict', 'ge-congzhou', 'li-sizhao', 'conflict'],
  ['ge-congzhou-liu-xun-conflict', 'ge-congzhou', 'liu-xun', 'conflict'],
];

test('Ge reuses one canonical identity and serves Zhu Wen in the late Tang before Liang retirement', () => {
  for (const catalog of [catalogPeople, people, loadPassagePeople()])
    assert.equal(catalog.filter(p => p.id === 'ge-congzhou').length, 1);
  assert.equal(canonicalOwner.people.filter(p => p.id === 'ge-congzhou').length, 1);
  assert.deepEqual(topic.people, []);
  assert.ok(topic.memberIds.includes('niu-cunjie') && topic.memberIds.includes('ge-congzhou'));
  assert.equal(topic.relationshipSubject, undefined);
  assert.equal(peopleForGroup(people, topic.id).filter(p => p.id === 'ge-congzhou').length, 1);
  assert.ok(filterSearch('通美').some(p => p.id === 'ge-congzhou'));
  assert.ok(searchRelationshipNodes('葛從周').some(p => p.id === 'ge-congzhou'));
  const relation = personTopicRelationships(people.find(p => p.id === 'ge-congzhou')).find(r => r.groupId === topic.id);
  assert.equal(relation.subject, '朱温（晚唐任职阶段）');
  assert.match(relation.relation, /晚唐.*领军.*后梁.*致仕.*居家食俸/);
  assert.equal(topic.memberServiceEvidence['ge-congzhou'][0].paragraphId, 'old-v016-p5');
  assert.equal(validateMilitaryTopic(topic, library, loadPassagePeople(), index), topic);
  const retiredEvidence = structuredClone(topic);
  const paragraph = library.chapters.find(c => c.id === 'old-v016').paragraphs.find(p => p.id === 'old-v016-p7');
  retiredEvidence.memberServiceEvidence['ge-congzhou'][0].excerpt = '太祖以從周抱疾既久';
  assert.equal(paragraph.original.includes(retiredEvidence.memberServiceEvidence['ge-congzhou'][0].excerpt), true);
  assert.throws(() => validateMilitaryTopic(retiredEvidence, library, loadPassagePeople(), index), /excerpt/);
});

test('Ge retains all 25 old event identities, source-specific variants and genuinely undated events', () => {
  validatePersonTimeline(timeline, library, loadPassagePeople());
  assert.equal(timeline.events.length, 32);
  assert.equal(new Set(timeline.events.map(e => e.id)).size, 32);
  assert(oldIds.every(id => event(id)));
  assert.equal(event('lu-aid').year, 899);
  assert.equal(event('taiyuan').year, 901);
  assert.equal(allRefs(event('taiyuan')).some(r => r.paragraphId === 'old-v061-p4'), false,
    'undated Maling source cannot be assigned to the 901 march');
  assert.equal(timeline.events.some(e => allRefs(e).some(r => r.paragraphId === 'old-v061-p4')), false);
  const retire = event('retire');
  assert.equal(retire.year, null); assert.equal(retire.precision, 'undated');
  assert.equal(retire.variants.find(v => v.evidence.some(r => r.paragraphId === 'new-v21-p35')).year, 907);
  assert.equal(event('chenliu').year, 913); assert.equal(event('death').year, 916);
  const luoluo = event('luoluo');
  assert.ok(luoluo.evidence.some(r => r.paragraphId === 'old-v016-p5'));
  assert.ok(luoluo.variants.some(v => v.evidence.some(r => r.paragraphId === 'new-v21-p32')));
  assert.ok(luoluo.variants.some(v => v.evidence.some(r => r.paragraphId === 'new-v22-p30')));
  const counts = event('laoyadi').variants.find(v => v.evidence.some(r => r.paragraphId === 'old-v020-p16'));
  assert.ok(counts.evidence.some(r => r.paragraphId === 'old-v002-p3'));
  assert.equal(allRefs(event('three-prefectures')).some(r => r.paragraphId === 'old-v026-p21'), true);
});

test('Ge keeps true short-name acts while rejecting From Zhou, cited titles and pure biography headings', () => {
  const generated = buildPersonPassageIndex(library);
  const ge = new Map(generated.passages.flatMap(p => p.people.filter(a => a.personId === 'ge-congzhou')
    .map(a => [p.spans[0].paragraphId, a.kind])));
  assert.equal(ge.size, 108);
  assert.deepEqual(Object.fromEntries(['biography', 'record', 'mention'].map(k => [k, [...ge.values()].filter(v => v === k).length])),
    { biography: 12, record: 94, mention: 2 });
  for (const id of ['huiyao-v002-p61', 'kaoyi-v028-p32', 'kaoyi-v030-p49', 'kaoyi-v030-p53',
    'new-v21-p29', 'new-v25-p11', 'old-v016-p1', 'old-v052-p21', 'old-v053-p19',
    'old-v056-p15', 'old-v059-p18', 'old-v070-p3', 'old-v133-p8']) assert.equal(ge.has(id), false, id);
  assert.equal(ge.get('jiuguozhi-v002-p29'), 'record'); assert.equal(ge.get('old-v059-p3'), 'record');
  assert.equal(ge.get('huiyao-v001-p3'), 'mention'); assert.equal(ge.get('old-v016-p24'), 'mention');
  assert.equal(ge.get('old-v016-p2'), 'biography'); assert.equal(ge.get('new-v21-p30'), 'biography');
  const stale = structuredClone(rules);
  const exclusion = stale.titleExclusions.find(e => e.personId === 'ge-congzhou' && e.paragraphId === 'new-v25-p11');
  assert.ok(exclusion); exclusion.originalSha256 = '0'.repeat(64);
  assert.throws(() => buildPersonPassageIndex(library, stale), /title exclusion version/);
});

test('Ge new fact directions derive once on both endpoints while three old facts remain', () => {
  assert.equal(military.length, 34);
  assert.equal(relationshipsForPerson('ge-congzhou').length, 15);
  for (const [id, from, to, kind] of newFacts) {
    const edges = personRelationships.filter(e => e.id === id); assert.equal(edges.length, 1, id);
    assert.deepEqual([edges[0].from, edges[0].to, edges[0].kind], [from, to, kind], id);
    for (const endpoint of [from, to]) assert.equal(relationshipsForPerson(endpoint).filter(e => e.id === id).length, 1);
    for (const source of edges[0].sources) {
      const paragraph = library.chapters.find(c => c.id === source.chapterId)?.paragraphs.find(p => p.id === source.paragraphId);
      assert.ok(paragraph?.original.includes(source.excerpt), id);
    }
  }
  for (const id of ['ge-congzhou-niu-cunjie-service', 'zhu-wen-ge-congzhou-service', 'ge-congzhou-xie-yanzhang-adoption'])
    assert.equal(personRelationships.filter(e => e.id === id).length, 1, id);
  assert.equal(personRelationships.find(e => e.id === 'ge-congzhou-xie-yanzhang-adoption').kind, 'adoption');
});
