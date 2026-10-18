import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipNodes, relationshipsForPerson } from '../src/relationships.ts';

const sister = 'tang-li-chongjun-sister', wife = 'tang-sun-hanrong-wife', maid = 'tang-li-chongjun-maid-killed';
const chongjun = 'li-chongjun-congzhang-son', sun = 'sun-hanrong';
test('three source roles keep exact2+2+1 records and three undated female experiences separate from male punishment', () => {
  const index = loadPersonPassageIndex(), timelines = loadPersonTimelines();
  const expected = new Map([[sister, ['new-v15-p42', 'old-v084-p18']],
    [wife, ['new-v15-p42', 'old-v084-p18']], [maid, ['old-v084-p18']]]);
  for (const [id, paragraphIds] of expected) {
    const person = catalogPeople.find(p => p.id === id); assert.ok(person, id);
    assert.equal(person.birthYear, undefined); assert.equal(person.deathYear, undefined);
    const rows = index.passages.filter(p => p.people.some(q => q.personId === id));
    assert.equal(rows.length, paragraphIds.length, id);
    assert.deepEqual(rows.flatMap(p => p.spans.map(s => s.paragraphId)).sort(), [...paragraphIds].sort(), id);
    for (const row of rows) assert.equal(row.people.find(q => q.personId === id).kind, 'record');
    const doc = timelines.find(d => d.personId === id); assert.ok(doc, id); assert.equal(doc.events.length, 1);
    const event = doc.events[0]; assert.equal(event.year, null); assert.equal(event.precision, 'undated');
    assert.equal(event.phase, 'uncertain'); assert.equal(event.yearRange, undefined);
    const sources = [...event.evidence, ...(event.variants ?? []).flatMap(v => v.evidence)];
    assert.deepEqual([...new Set(sources.map(s => s.paragraphId))].sort(), [...paragraphIds].sort());
    assert.ok(person.sourceNotes.some(n => /乙未|受刑|男方被杀/.test(n) && /不|未|非/.test(n)), id);
    for (const pid of ['new-v15-p35', 'new-v15-p37', 'new-v15-p38', 'new-v15-p41', 'old-v084-p1', 'old-v084-p7', 'old-v084-p10'])
      assert.ok(!rows.some(p => p.spans.some(s => s.paragraphId === pid)), id + '/' + pid);
  }
  const sisterPerson = catalogPeople.find(p => p.id === sister), wifePerson = catalogPeople.find(p => p.id === wife);
  assert.match(sisterPerson.name, /妹/); assert.ok(!/姊|姐姐/.test(sisterPerson.name));
  assert.ok(!/孙氏|孫氏/.test(wifePerson.name)); assert.ok(wifePerson.sourceNotes.some(n => /孙|孫/.test(n) && /姓/.test(n) && /不/.test(n)));
  const maidDoc = timelines.find(d => d.personId === maid); assert.match(maidDoc.events[0].summary, /斫杀|斫殺/);
  assert.deepEqual(maidDoc.events[0].evidence.map(s => s.paragraphId), ['old-v084-p18']);
  const yongning = 'tang-li-siyuan-princess-yongning';
  for (const pid of ['new-v15-p41', 'new-v15-p42']) {
    const row = index.passages.find(p => p.spans.some(s => s.paragraphId === pid));
    assert.equal(row?.people.find(q => q.personId === yongning)?.kind, 'record', pid);
  }
  const yongningDoc = timelines.find(d => d.personId === yongning); assert.ok(yongningDoc.events.length >= 19);
  const appended = yongningDoc.events.filter(e => [...e.evidence, ...(e.variants ?? []).flatMap(v => v.evidence)].some(s => s.paragraphId === 'new-v15-p41'));
  assert.equal(appended.length, 1); assert.equal(appended[0].year, null); assert.equal(appended[0].precision, 'undated');
  assert.deepEqual([...new Set([...appended[0].evidence, ...(appended[0].variants ?? []).flatMap(v => v.evidence)].map(s => s.paragraphId))], ['new-v15-p41']);
  // Later source reviews may enrich these events. This earlier-family regression
  // preserves their stable identities and relative order without freezing all future content.
  const suffixes = ['saved-kongxun', 'yongning-title', 'certificate', 'wei-title', 'advise-conghou',
    'intercede-shi', 'jin-title', 'birthday-return', 'jin-empress', 'nurture-congyi', 'mourn-sister',
    'surrender', 'detained-kaifeng', 'follow-son-north', 'ask-fields', 'death', 'marriage', 'dowager'];
  const oldIds = suffixes.map(suffix => `${yongning}-${suffix}`);
  assert.deepEqual(yongningDoc.events.filter(e => oldIds.includes(e.id)).map(e => e.id), oldIds);
});
test('four source-bound reciprocal edges retain sibling/spouse/assault distinctions and reject shared-name or emperor-parent merges', () => {
  const newIds = new Set([sister, wife, maid]);
  const edges = [...new Map([...newIds].flatMap(id => relationshipsForPerson(id)).map(e => [e.id, e])).values()];
  assert.equal(edges.length, 4); assert.equal(edges.filter(e => e.kind === 'kinship').length, 2);
  assert.equal(edges.filter(e => e.kind === 'conflict').length, 2);
  const sibling = edges.find(e => e.from === chongjun && e.to === sister); assert.ok(sibling); assert.equal(sibling.kind, 'kinship'); assert.match(sibling.label, /兄妹/);
  const spouse = edges.find(e => e.from === sun && e.to === wife); assert.ok(spouse); assert.equal(spouse.kind, 'kinship'); assert.match(spouse.label, /夫妻/);
  const assault = edges.find(e => e.from === chongjun && e.to === wife); assert.ok(assault); assert.equal(assault.kind, 'conflict');
  const attack = edges.find(e => e.from === chongjun && e.to === maid); assert.ok(attack); assert.equal(attack.kind, 'conflict');
  assert.deepEqual(attack.sources.map(s => s.paragraphId), ['old-v084-p18']);
  for (const edge of edges) {
    assert.ok(relationshipsForPerson(edge.from).some(e => e.id === edge.id));
    assert.ok(relationshipsForPerson(edge.to).some(e => e.id === edge.id));
    assert.ok(![edge.from, edge.to].includes('li-siyuan')); assert.ok(![edge.from, edge.to].includes('li-cunxian'));
  }
  const offender = relationshipNodes.find(n => n.id === chongjun); assert.ok(offender?.external);
  assert.match(offender.note, /李俊/); assert.match(offender.note, /子良/); assert.match(offender.note, /李存贤/);
  assert.ok(relationshipNodes.find(n => n.id === sun)?.external);
  assert.ok(!catalogPeople.some(p => p.id === chongjun)); assert.ok(!catalogPeople.some(p => p.id === sun));
  assert.equal(catalogPeople.filter(p => p.id === 'li-cunxian').length, 1);
});
