import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipNodes,relationshipsForPerson} from '../src/relationships.ts';
const guan='tang-li-congwen-wife-guan',husband='li-congwen';
test('Guan keeps the direct yamen speech undated and does not inherit her husband offices or marriage arrangements',()=>{
 const person=catalogPeople.find(p=>p.id===guan);assert.ok(person);assert.match(person.name,/关氏/);assert.equal(person.birthYear,undefined);assert.equal(person.deathYear,undefined);
 assert.ok(person.sourceNotes.some(n=>/诸子/.test(n)&&/侄|从子/.test(n)));assert.ok(person.sourceNotes.some(n=>/欲反/.test(n)&&/不把|不补/.test(n)));
 const timeline=loadPersonTimelines().find(d=>d.personId===guan);assert.ok(timeline);assert.equal(timeline.events.length,1);const event=timeline.events[0];assert.equal(event.year,null);assert.equal(event.precision,'undated');assert.equal(event.phase,'uncertain');assert.match(event.summary,/关氏.*牙门/);assert.match(event.summary,/毁/);assert.deepEqual(event.evidence.map(s=>s.paragraphId),['new-v15-p40']);
 const rows=loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===guan));assert.equal(rows.length,1);assert.equal(rows[0].people.find(q=>q.personId===guan).kind,'record');assert.deepEqual(rows[0].spans.map(s=>s.paragraphId),['new-v15-p40']);
 for(const pid of ['new-v15-p35','new-v15-p39','new-v15-p41','old-v032-p11','new-v06-p18','tongjian-v275-p24','huiyao-v011-p88','old-v076-p7','old-v048-p5'])assert.ok(!rows.some(p=>p.spans.some(s=>s.paragraphId===pid)),pid);
});
test('Guan and Congwen have the same source-bound spouse edge in both directions without asserting a Mingzong daughter-in-law',()=>{
 const edges=relationshipsForPerson(guan);assert.equal(edges.length,1);const edge=edges[0];assert.equal(edge.kind,'kinship');assert.equal(edge.from,husband);assert.equal(edge.to,guan);assert.match(edge.label,/夫妻/);assert.deepEqual(edge.sources.map(s=>s.paragraphId),['new-v15-p40']);assert.ok(relationshipsForPerson(husband).some(e=>e.id===edge.id));
 const node=relationshipNodes.find(n=>n.id===husband);assert.ok(node?.external);assert.match(node.note,/侄|从子/);assert.match(node.note,/诸子/);assert.ok(!catalogPeople.some(p=>p.id===husband));assert.ok(!edges.some(e=>[e.from,e.to].includes('li-siyuan')));
});
