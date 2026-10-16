import test from 'node:test';import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';
const base='tang-li-siyuan-',ids=['sishan-zhai','siyun-wu','jieyu-gao','meiren-shen','shunyu-zhu','sishi-liao','siyi-liu','siyao-meng'].map(id=>base+id),sources=new Set(['huiyao-v001-p50','old-v049-p23']);
const profile=id=>{const p=catalogPeople.find(p=>p.id===id);assert.ok(p,id);return p;};
const paragraphs=id=>loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
test('next eight Mingzong office roles keep the sourced ninth-month grant without invented exact days or biography',()=>{
 const docs=loadPersonTimelines();for(const id of ids){profile(id);const doc=docs.find(d=>d.personId===id);assert.ok(doc);assert.equal(doc.events.length,1);const e=doc.events[0];assert.equal(e.year,932);assert.equal(e.precision,'month');assert.match(e.sourceDate,/长兴三年九月/);assert.deepEqual(new Set(e.evidence.map(s=>s.paragraphId)),sources);}
});
test('Mingzong Siyi Liu never inherits later Jin or Zhou Pengcheng Liu passages or the Wang wetnurse role',()=>{
 const p=profile(base+'siyi-liu'),wang=profile(base+'siyi-wang');assert.notEqual(p.id,wang.id);assert.match(p.name,/刘|劉/);assert.match(wang.name,/王/);assert.deepEqual(new Set(paragraphs(p.id)),sources);assert.ok(!paragraphs(p.id).some(id=>['old-v117-p4','new-v12-p6','huiyao-v001-p52'].includes(id)));assert.ok((p.sourceNotes??[]).some(n=>/未|不|尚/.test(n)));
});
test('Sishi Liao retains the bottom-text surname 聊 and a court office is not inferred marriage',()=>{
 const p=profile(base+'sishi-liao');assert.match(p.name,/聊/);assert.doesNotMatch(p.name,/廖/);for(const id of ids){const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');}
});
test('the eight new roles have only their two reviewed source attributions and reciprocal sourced service relations',()=>{
 const reverse=relationshipsForPerson('li-siyuan');for(const id of ids){profile(id);assert.deepEqual(new Set(paragraphs(id)),sources);const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');assert.ok(reverse.some(e=>e.id===edges[0].id));assert.ok([edges[0].from,edges[0].to].includes('li-siyuan'));}
});
