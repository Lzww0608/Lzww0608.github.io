import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipsForPerson, relationshipNodes } from '../src/relationships.ts';

const id = 'tang-cunba-wife-zhang-jingxun-daughter';
test('Zhang Jingxun daughter has one specific marriage record and retains unknown personal name and dates', () => {
  const person = catalogPeople.find(p => p.id === id); assert.ok(person);
  assert.equal(person.name, '张敬询女（李存霸妻）');
  assert.ok(person.intro.includes('本名') && person.intro.includes('母系') && person.intro.includes('未明'));
  assert.equal(person.birthYear, undefined); assert.equal(person.deathYear, undefined);
  assert.ok(!person.aliases.split(/\s+/u).some(n => ['张氏', '李氏', '李存沼'].includes(n)));
  const rows = loadPersonPassageIndex().passages.filter(p => p.people.some(q => q.personId === id));
  assert.deepEqual(rows.flatMap(p => p.spans.map(s => s.paragraphId)), ['old-v061-p11']);
  assert.ok(rows.every(p => p.people.find(q => q.personId === id).kind === 'record'));
  assert.deepEqual(person.readingStarts, { old: 'old-v061' });
  assert.ok(person.sourceNotes.some(n => n.includes('父亲') && /不|未/u.test(n)));
  assert.ok(person.sourceNotes.some(n => n.includes('张延朗') && n.includes('另一')));
});
test('undated marriage and reciprocal father-spouse edges preserve existing people without inventing wife offices or death', () => {
  const doc = loadPersonTimelines().find(d => d.personId === id); assert.ok(doc); assert.equal(doc.events.length, 1);
  const event = doc.events[0]; assert.equal(event.year, null); assert.equal(event.precision, 'undated'); assert.equal(event.phase, 'uncertain');
  assert.deepEqual(event.evidence.map(s => s.paragraphId), ['old-v061-p11']);
  assert.ok(event.evidence[0].excerpt.includes('復以女為武皇子存霸妻'));
  assert.ok(event.notes.some(n => n.includes('益见亲信') && n.includes('父亲')));
  assert.ok(event.notes.some(n => n.includes('婚期') && n.includes('死亡') && /不|未/u.test(n)));
  const edges = relationshipsForPerson(id); assert.equal(edges.length, 2);
  const father = edges.find(e => e.from === 'zhang-jingxun'); const husband = edges.find(e => e.from === 'li-cunba');
  assert.ok(father && husband); assert.equal(father.label, '父女（旧史）'); assert.equal(husband.label, '夫妻');
  for (const edge of [father, husband]) {
    assert.equal(edge.to, id); assert.equal(edge.kind, 'kinship');
    assert.deepEqual(edge.sources.map(s => s.paragraphId), ['old-v061-p11']);
    assert.ok(relationshipsForPerson(edge.from).some(e => e.id === edge.id));
  }
  assert.ok(catalogPeople.some(p => p.id === father.from));
  assert.ok(relationshipNodes.find(n => n.id === husband.from)?.external);
});
