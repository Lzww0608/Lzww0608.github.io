import test from 'node:test';import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';
const base='tang-li-siyuan-',ids=['zhaorong-ge','zhaoyuan-liu','chu-furen-sun','yuzheng-zhang','sibao-guo','sizan-yu','shangfu-wang','siji-cui'].map(id=>base+id),sources=new Set(['huiyao-v001-p50','old-v049-p23']);
const profile=id=>{const p=catalogPeople.find(p=>p.id===id);assert.ok(p,id);return p;};
const paragraphs=id=>loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
test('Mingzong office titles retain the shared month decree without invented exact days or extra life events',()=>{
 const docs=loadPersonTimelines();for(const id of ids){profile(id);const doc=docs.find(d=>d.personId===id);assert.ok(doc);assert.equal(doc.events.length,1);const e=doc.events[0];assert.equal(e.year,932);assert.equal(e.precision,'month');assert.match(e.sourceDate,/长兴三年九月/);assert.deepEqual(new Set(e.evidence.map(s=>s.paragraphId)),sources);}
});
test('Sun has a sourced Chu title without inheriting the preceding Zhaoyuan office or an invented marriage',()=>{
 const p=profile(base+'chu-furen-sun');assert.match(JSON.stringify(p),/楚国夫人/);assert.doesNotMatch(p.name+' '+p.role+' '+p.intro,/昭媛孙|昭媛孫/);const edges=relationshipsForPerson(p.id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');assert.ok((p.sourceNotes??[]).some(n=>/职|職/.test(n)&&/未|不/.test(n)));
});
test('same office and surname do not merge Mingzong Yuzheng Zhang into the existing Chuzhen Zhang role',()=>{
 const current=profile(base+'yuzheng-zhang'),earlier=profile('tang-li-cunxu-chuzhen-zhang');assert.notEqual(current.id,earlier.id);assert.match(JSON.stringify(current),/曹国/);assert.match(JSON.stringify(earlier),/凉国/);assert.ok((current.sourceNotes??[]).some(n=>/张|張/.test(n)&&/未|不/.test(n)));assert.deepEqual(new Set(paragraphs(current.id)),sources);assert.ok(paragraphs(earlier.id).includes('old-v032-p6')||paragraphs(earlier.id).some(p=>p.startsWith('old-v032-p')));
});
test('each of the eight source roles is attributed only in its two reviewed passages and has one reciprocal court-service edge',()=>{
 const reverse=relationshipsForPerson('li-siyuan');for(const id of ids){profile(id);assert.deepEqual(new Set(paragraphs(id)),sources);const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');assert.ok(reverse.some(e=>e.id===edges[0].id));assert.ok([edges[0].from,edges[0].to].includes('li-siyuan'));}
});
