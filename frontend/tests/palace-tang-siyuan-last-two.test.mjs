import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';

const ids=['tang-li-siyuan-xianyang-tian','tang-li-siyuan-nanyang-bai'];
const sources=new Set(['huiyao-v001-p50','old-v049-p23']);
test('the last two Mingzong county-lady source roles keep the933 second-month grant without invented personal dates',()=>{
  for(const id of ids){
    const person=catalogPeople.find(p=>p.id===id);assert.ok(person,id);
    assert.equal(person.birthYear,undefined);assert.equal(person.deathYear,undefined);
    const doc=loadPersonTimelines().find(d=>d.personId===id);assert.ok(doc,id);assert.equal(doc.events.length,1);
    const event=doc.events[0];assert.equal(event.year,933);assert.equal(event.precision,'month');assert.match(event.sourceDate,/长兴四年二月/);
    assert.deepEqual(new Set(event.evidence.map(s=>s.paragraphId)),sources);
  }
});
test('Tian and Bai keep their source identities without inheriting a same-surname or same-place office',()=>{
  const index=loadPersonPassageIndex(),reverse=relationshipsForPerson('li-siyuan');
  for(const [id,fief] of [[ids[0],'咸阳县君'],[ids[1],'南阳县君']]){
    const person=catalogPeople.find(p=>p.id===id);assert.ok(person,id);assert.match(person.role,new RegExp(fief));
    const paragraphs=index.passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
    assert.deepEqual(new Set(paragraphs),sources);
    const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');assert.ok(reverse.some(e=>e.id===edges[0].id));
  }
  assert.ok(catalogPeople.some(p=>p.id==='tang-li-cunxu-zhaoyuan-bai'));
  assert.ok(catalogPeople.some(p=>p.id==='tang-li-siyuan-siyao-meng'));
});
