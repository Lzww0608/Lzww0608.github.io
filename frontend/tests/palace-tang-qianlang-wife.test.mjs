import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipsForPerson, relationshipNodes } from '../src/relationships.ts';

const id = 'tang-yang-qianlang-wife';
test('Yang Qianlang wife keeps two direct records and her unknown name separate from Cunyi wife', () => {
  const person = catalogPeople.find(p => p.id === id); assert.ok(person);
  const guo = catalogPeople.find(p => p.id === 'tang-cunyi-wife-guo'); assert.ok(guo); assert.notEqual(person.id, guo.id);
  assert.equal(person.name, '杨千郎妻（失名）'); assert.ok(person.intro.includes('姓氏') && person.intro.includes('未明'));
  assert.equal(person.birthYear, undefined); assert.equal(person.deathYear, undefined); assert.ok(!person.aliases.split(/\s+/u).includes('杨氏'));
  const rows = loadPersonPassageIndex().passages.filter(p => p.people.some(q => q.personId === id));
  assert.deepEqual(rows.flatMap(p => p.spans.map(s => s.paragraphId)).sort(), ['new-v14-p38', 'beimeng-v018-p5'].sort());
  assert.ok(rows.every(p => p.people.find(q => q.personId === id).kind === 'record'));
  assert.deepEqual(person.readingStarts, { new: 'new-v14', beimeng: 'beimeng-v018' });
  assert.ok(person.sourceNotes.some(n => n.includes('郭崇韬女') && n.includes('不能')));
  assert.ok(person.sourceNotes.some(n => n.includes('妇翁') && n.includes('存乂') && n.includes('杨')));
});
test('one undated palace episode and one reciprocal spouse edge do not invent office or wife death', () => {
  const timeline = loadPersonTimelines().find(d => d.personId === id); assert.ok(timeline); assert.equal(timeline.events.length, 1);
  const event = timeline.events[0]; assert.equal(event.year, null); assert.equal(event.precision, 'undated'); assert.equal(event.phase, 'uncertain');
  assert.deepEqual(event.evidence.map(s => s.paragraphId), ['new-v14-p38', 'beimeng-v018-p5']);
  assert.ok(event.summary.includes('士人') && event.summary.includes('求官'));
  assert.ok(event.notes.some(n => n.includes('宫职') && /不|未|非/u.test(n)));
  assert.ok(event.notes.some(n => n.includes('男方') && /不|未|非/u.test(n)));
  const edges = relationshipsForPerson(id); assert.equal(edges.length, 1);
  const edge = edges[0]; assert.deepEqual([edge.from, edge.to, edge.kind, edge.label], ['yang-qianlang', id, 'kinship', '夫妻']);
  assert.ok(relationshipsForPerson('yang-qianlang').some(e => e.id === edge.id));
  assert.deepEqual(edge.sources.map(s => s.paragraphId), ['new-v14-p38', 'beimeng-v018-p5']);
  const husband = relationshipNodes.find(n => n.id === 'yang-qianlang'); assert.ok(husband?.external);
  assert.ok(husband.note.includes('自称') && husband.note.includes('不转'));
});
