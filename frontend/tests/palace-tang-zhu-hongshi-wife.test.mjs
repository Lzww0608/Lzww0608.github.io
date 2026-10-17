import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPeople } from '../src/person-catalog.ts';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipsForPerson, relationshipNodes } from '../src/relationships.ts';

const id = 'tang-zhu-hongshi-wife-unnamed';
test('Zhu Hongshi wife is one source-qualified unnamed wife with a direct palace-conversation record', () => {
  const person = catalogPeople.find(p => p.id === id); assert.ok(person);
  assert.equal(person.name, '朱洪实妻（失名）'); assert.equal(person.birthYear, undefined); assert.equal(person.deathYear, undefined);
  assert.ok(!person.aliases.split(/\s+/u).includes('朱氏'));
  assert.deepEqual(person.readingStarts, { tongjian: 'tongjian-v278' });
  const rows = loadPersonPassageIndex().passages.filter(p => p.people.some(q => q.personId === id));
  assert.deepEqual(rows.flatMap(p => p.spans.map(s => s.paragraphId)), ['tongjian-v278-p82']);
  assert.ok(rows.every(p => p.people.find(q => q.personId === id).kind === 'record'));
  assert.ok(catalogPeople.some(p => p.id === 'tang-li-siyuan-shufei-wang'));
  assert.ok(catalogPeople.some(p => p.id === 'tang-li-siyuan-siyi-wang'));
  assert.match(person.intro, /朱洪实与康义诚/u); assert.match(person.intro, /未.*妻子.*上告/u);
  assert.ok(person.sourceNotes.some(n => /司衣王氏/u.test(n) && /不.*妻子/u.test(n)));
});
test('wife conversation is year-only933 while reciprocal spouse edge does not transfer husband military events', () => {
  const timeline = loadPersonTimelines().find(d => d.personId === id); assert.ok(timeline); assert.equal(timeline.events.length, 1);
  const event = timeline.events[0]; assert.equal(event.year, 933); assert.equal(event.precision, 'year'); assert.equal(event.phase, 'later');
  assert.deepEqual(event.evidence.map(s => s.paragraphId), ['tongjian-v278-p82', 'tongjian-v278-p32', 'tongjian-v278-p81', 'old-v045-p4']);
  assert.ok(event.notes.some(n => /十二月/u.test(n) && /934/u.test(n)));
  assert.ok(event.notes.some(n => /未|不/u.test(n) && /日/u.test(n)));
  const edges = relationshipsForPerson(id); assert.equal(edges.length, 1); const edge = edges[0];
  assert.deepEqual([edge.from, edge.to, edge.kind, edge.label], ['zhu-hongshi', id, 'kinship', '亲属：夫妻（据通鉴）']);
  assert.ok(relationshipsForPerson('zhu-hongshi').some(e => e.id === edge.id));
  assert.deepEqual(edge.sources.map(s => s.paragraphId), ['tongjian-v278-p82']);
  const husband = relationshipNodes.find(n => n.id === 'zhu-hongshi'); assert.ok(husband?.external);
  assert.ok(husband.aliases.includes('朱弘實')); assert.ok(!husband.aliases.includes('朱弘昭'));
  assert.match(husband.note, /不.*妻子/u);
});
