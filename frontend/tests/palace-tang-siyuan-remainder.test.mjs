import test from 'node:test';import assert from 'node:assert/strict';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';
import {catalogPeople} from '../src/person-catalog.ts';
const base='tang-li-siyuan-',kang=base+'siyi-kang',shouan=base+'princess-shouan',yongle=base+'princess-yongle',gaozu=base+'ancestress-gaozu',zengzu=base+'ancestress-zengzu',zu=base+'ancestress-zu',mother=base+'mother-liu',office=base+'zhaoyi-wang';
const spansFor=id=>loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
test('Siyi Kang remains a distinct office holder and her death crosses into934',()=>{
 const people=loadPassagePeople();assert.ok(people.some(p=>p.id===kang));assert.ok(people.some(p=>p.id===base+'siyi-wang'));
 const doc=loadPersonTimelines().find(d=>d.personId===kang);assert.ok(doc.events.some(e=>e.year===934&&e.sourceDate.includes('乙卯')));
 assert.ok(!doc.events.some(e=>e.year===933));const edges=relationshipsForPerson(kang);assert.ok(edges.some(e=>e.kind==='conflict'&&(e.from==='li-conghou'||e.to==='li-conghou')));assert.ok(!edges.some(e=>e.kind==='service'&&(e.from==='li-siyuan'||e.to==='li-siyuan')));
 assert.deepEqual(new Set(spansFor(kang)),new Set(['old-v045-p4','new-v07-p2']));
 const conghou=loadPersonTimelines().find(d=>d.personId==='li-conghou'),event=conghou.events.filter(e=>e.id==='li-conghou-kill-siyi-kang');assert.equal(event.length,1);assert.equal(event[0].year,934);assert.equal(conghou.events.length,33);assert.deepEqual(new Set(event[0].evidence.map(e=>e.paragraphId)),new Set(['old-v045-p4','new-v07-p2']));
});
test('the two Mingzong princesses do not inherit the Later Zhou Shouan identity or an invented mother',()=>{
 for(const id of [shouan,yongle]){const edges=relationshipsForPerson(id);assert.ok(edges.some(e=>e.kind==='kinship'&&(e.from==='li-siyuan'||e.to==='li-siyuan')));assert.equal(edges.length,1);const spans=spansFor(id);assert.ok(spans.includes('old-v044-p6'));assert.ok(spans.includes('huiyao-v002-p19'));assert.ok(!spans.some(p=>['old-v111-p3','old-v114-p8','huiyao-v002-p22','tongjian-v267-p115'].includes(p)));}
 assert.notEqual(shouan,yongle);
});
test('one high-grandmother identity retains Cui/Liu disagreement while all four posthumous timelines use the verified western year',()=>{
 const people=loadPassagePeople(),high=catalogPeople.find(p=>p.id===gaozu);assert.ok(high);const text=JSON.stringify(high);assert.match(text,/崔/);assert.match(text,/刘|劉/);
 assert.notEqual(gaozu,mother);assert.ok(people.some(p=>p.id===mother));const docs=loadPersonTimelines();
 for(const id of [gaozu,zengzu,zu,mother]){const doc=docs.find(d=>d.personId===id);assert.ok(doc.events.some(e=>e.year===928&&e.evidence.some(s=>s.paragraphId==='new-v06-p12')));assert.ok(!doc.events.some(e=>e.year===927&&e.sourceDate.includes('丙午')));}
});
test('Zhaoyi Wang remains separate from Shufei Wang and the wetnurse, with one reciprocal service edge',()=>{
 const people=loadPassagePeople();for(const id of [office,base+'shufei-wang',base+'siyi-wang'])assert.equal(people.filter(p=>p.id===id).length,1);
 const edge=relationshipsForPerson(office).find(e=>e.kind==='service');assert.ok(edge);assert.ok(relationshipsForPerson('li-siyuan').some(e=>e.id===edge.id));assert.ok(!relationshipsForPerson(office).some(e=>e.kind==='adoption'));
 assert.deepEqual(new Set(spansFor(office)),new Set(['huiyao-v001-p50','old-v049-p23']));
});
