import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { catalogPeople } from '../src/person-catalog.ts';
import { relationshipNodes, personRelationships, relationshipsForPerson } from '../src/relationships.ts';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const document = readJson('../../content/person-timelines/niu-cunjie.json');
const military = readJson('../../content/person-relationships/military.json');
const context = readJson('../../content/person-relationships/military-context.json');
const ownerSubjects = readJson('../../content/owner-review-subjects.json');
const attributions = readJson('../../content/person-passages/verified-attributions.json');
const passageIndex = readJson('../../content/person-passages/index.json');
const oldIds = [
  'niu-cunjie-heyang', 'niu-cunjie-ehou', 'niu-cunjie-xuzhou', 'niu-cunjie-yun-bridge',
  'niu-cunjie-yunzhou', 'niu-cunjie-huainan', 'niu-cunjie-bodyguard-907', 'niu-cunjie-zezhou',
  'niu-cunjie-longhu-908', 'niu-cunjie-tongzhou', 'niu-cunjie-yun-governor',
  'niu-cunjie-xuzhou-revolt', 'niu-cunjie-death', 'niu-cunjie-join',
  'niu-cunjie-early-campaigns', 'niu-cunjie-wei-late-tang', 'niu-cunjie-laocheng',
  'niu-cunjie-xuzhou-relief', 'niu-cunjie-lu-appointment', 'niu-cunjie-lu-to-xing',
  'niu-cunjie-xingzhou', 'niu-cunjie-wells', 'niu-cunjie-huai-command',
  'niu-cunjie-xu-expedition',
];

test('Niu keeps his canonical identity and original event IDs with the approved dated distinctions', () => {
  assert.equal(catalogPeople.filter(person => person.id === 'niu-cunjie').length, 1);
  assert.ok(oldIds.every(id => document.events.some(event => event.id === id)));
  assert.equal(new Set(document.events.map(event => event.id)).size, document.events.length);
  assert.equal(document.events.length, oldIds.length + 12);
  assert.deepEqual(document.events.map(event => event.sortOrder), document.events.map((_, index) => index));
  assert.equal(createHash('sha256').update(JSON.stringify(document)).digest('hex'),
    '2045bc13e826a19c93ab79ad4b32274f32108523e7bc7f59967a467be4325fbc');
  const event = id => document.events.find(item => item.id === id);
  assert.deepEqual(event('niu-cunjie-xingzhou').yearRange, { start: 904, end: 905 });
  assert.equal(event('niu-cunjie-xingzhou').year, null);
  assert.equal(event('niu-cunjie-qingshan-906').year, 906);
  assert.ok(event('niu-cunjie-xingzhou').evidence.some(ref => ref.chapterId === 'old-v022'));
  assert.ok(event('niu-cunjie-qingshan-906').evidence.some(ref => ref.chapterId === 'old-v026'));
  assert.ok(event('niu-cunjie-yunzhou').variants?.some(variant =>
    variant.evidence.some(ref => ref.chapterId === 'old-v016' || ref.chapterId === 'old-v021')));
  assert.ok(event('niu-cunjie-xuzhou-revolt').notes.some(note => note.includes('刘鄩')));
  assert.ok(event('niu-cunjie-xuzhou-revolt').variants.some(variant =>
    variant.evidence.some(ref => ref.chapterId === 'old-v008' && ref.paragraphId === 'old-v008-p23')));
});

test('all added military facts cite current originals and derive once for each endpoint', () => {
  assert.equal(military.length, 22);
  assert.equal(new Set(military.map(edge => edge.id)).size, military.length);
  const originals = new Map(loadLibrary().chapters.map(chapter => [chapter.id, chapter]));
  for (const edge of military) {
    assert.deepEqual(Object.keys(edge).sort(),
      ['from', 'id', 'kind', 'label', 'note', 'sources', 'to'].sort(), edge.id);
    assert.ok(edge.sources.length, edge.id);
    assert.equal(personRelationships.filter(item => item.id === edge.id).length, 1, edge.id);
    for (const endpoint of [edge.from, edge.to]) {
      assert.equal(relationshipsForPerson(endpoint).filter(item => item.id === edge.id).length, 1,
        `${edge.id}: ${endpoint}`);
    }
    for (const source of edge.sources) {
      const paragraph = originals.get(source.chapterId)?.paragraphs.find(item => item.id === source.paragraphId);
      assert.ok(paragraph?.original.includes(source.excerpt), `${edge.id}: exact current source`);
    }
  }
  for (const id of ['zhu-wen-niu-cunjie-service', 'zhu-yougui-niu-cunjie-service',
    'zhu-youzhen-niu-cunjie-service']) {
    assert.equal(personRelationships.filter(edge => edge.id === id).length, 1, id);
  }
  const wang = military.find(edge => edge.id === 'niu-cunjie-wang-yan-niu-cunjie-service');
  assert.equal(wang.from, 'niu-cunjie');
  assert.equal(wang.to, 'wang-yan-niu-cunjie');
  assert.equal(wang.kind, 'service');
  assert.ok(military.some(edge => edge.to === 'zhu-jin-yanzhou'));
  assert.ok(military.some(edge => edge.to === 'kang-junli'));
});

test('bounded military context remains outside canonical people and review subjects', () => {
  assert.equal(context.length, 9);
  const canonical = new Set(catalogPeople.map(person => person.id));
  const owners = new Set(ownerSubjects.map(subject => subject.id));
  assert.ok(owners.has('niu-cunjie'));
  for (const node of context) {
    assert.equal(canonical.has(node.id), false, node.id);
    assert.equal(owners.has(node.id), false, node.id);
    assert.equal(relationshipNodes.filter(item => item.id === node.id).length, 1, node.id);
  }
  assert.equal(context.find(node => node.id === 'wang-yan-niu-cunjie').identityKind, undefined);
  assert.equal(context.some(node => node.id === 'zhu-jin-yanzhou' || node.id === 'kang-junli'), false);
});

test('the annal continuation is attributed only to Niu through its bound local source', () => {
  const entries = attributions.entries.filter(entry => entry.paragraphId === 'new-v03-p13');
  assert.equal(entries.filter(entry => entry.personId === 'niu-cunjie').length, 1);
  const [entry] = entries.filter(item => item.personId === 'niu-cunjie');
  assert.equal(entry.originalRevision, 1);
  assert.equal(entry.originalSha256, '4eabfa8d5f68d7f2a3106d80b9a4ea65134a24dbb75ec23557f8feb9695990cf');
  assert.ok(entry.reason.includes('new-v03-p11'));
  const passage = passageIndex.passages.find(item => item.spans.some(span => span.paragraphId === 'new-v03-p13'));
  assert.equal(passage.people.filter(person => person.personId === 'niu-cunjie').length, 1);
  assert.equal(passage.people.some(person => person.personId === 'li-cunjie'), false);
});
