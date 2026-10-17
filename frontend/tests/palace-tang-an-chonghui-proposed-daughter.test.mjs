import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson,relationshipNodes} from '../src/relationships.ts';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root))),id='tang-an-chonghui-daughter-unnamed';
test('An daughter is a source-qualified uncompleted royal proposal, with no inferred prince, spouse or mother',()=>{
 const person=read('content/five-dynasties/palace-people.json').people.find(p=>p.id===id);assert.ok(person);assert.equal(loadPassagePeople().filter(p=>p.id===id).length,1);assert.match(person.intro,/未载|未記|未记/);
 const doc=loadPersonTimelines().find(d=>d.personId===id);assert.equal(doc.events.length,1);const e=doc.events[0];assert.equal(e.year,null);assert.equal(e.precision,'undated');assert.equal(e.phase,'uncertain');assert.deepEqual(e.evidence.map(s=>s.paragraphId),['tongjian-v276-p38','new-v43-p33']);assert.match(e.summary,/安重诲/);assert.match(e.summary,/辞|止/);
 const index=loadPersonPassageIndex();assert.deepEqual(index.passages.filter(p=>p.people.some(x=>x.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId)).sort(),['new-v43-p33','tongjian-v276-p38']);assert.deepEqual(read('content/person-passages/rules.json').people.find(p=>p.personId===id).names,[]);
 const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.deepEqual([edges[0].from,edges[0].to,edges[0].kind],['an-chonghui',id,'kinship']);assert.match(edges[0].label,/父女/);assert.ok(relationshipsForPerson('an-chonghui').some(e=>e.id===edges[0].id));assert.ok(relationshipNodes.find(n=>n.id==='an-chonghui')?.external);
});
test('Mingzong and Wang retain only their distinct sourced actions, without transferring other marriage or political events',()=>{
 const docs=loadPersonTimelines(),ming=docs.find(d=>d.personId==='li-siyuan'),wang=docs.find(d=>d.personId==='tang-li-siyuan-shufei-wang');const me=ming.events.find(e=>e.id==='li-siyuan-an-chonghui-daughter-marriage-proposal');assert.ok(me);assert.equal(me.year,null);assert.equal(me.precision,'undated');assert.deepEqual(me.evidence.map(s=>s.paragraphId),['tongjian-v276-p38','new-v43-p33']);
 const addedWang=wang.events.filter(e=>e.evidence.some(s=>s.paragraphId==='tongjian-v276-p38'));assert.ok(addedWang.some(e=>e.year===null&&e.precision==='undated'));assert.ok(addedWang.some(e=>/孔循|孔氏/.test(e.summary)));const index=loadPersonPassageIndex(),p=index.passages.find(p=>p.spans.some(s=>s.paragraphId==='tongjian-v276-p38'));assert.ok(p.people.some(x=>x.personId===wang.personId&&x.kind==='record'));
 assert.ok(!relationshipsForPerson(id).some(e=>e.from==='li-conghou'||e.to==='li-conghou'));assert.ok(!read('content/five-dynasties/palace-people.json').people.some(p=>p.id==='h27-zhang-yanlang-daughter-pending'));assert.ok(read('content/owner-review-subjects.json').some(p=>p.id===id));
});
