import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';

const id='tang-li-conghou-empress-kong';
test('Kong empress separates establishment, uncompleted investiture and later Jin rites across calendar years',()=>{
  const doc=loadPersonTimelines().find(d=>d.personId===id);assert.ok(doc);
  const event=suffix=>{const e=doc.events.find(e=>e.id===id+suffix);assert.ok(e,suffix);return e;};
  assert.equal(event('-marriage').year,929);
  const queen=event('-queen-before-ceremony');assert.equal(queen.year,null);assert.deepEqual(queen.yearRange,{start:933,end:934});assert.match(queen.summary,/未|尚未/);
  const death=event('-palace-death');assert.equal(death.year,934);assert.equal(death.precision,'month');assert.match(death.summary,/四子/);
  const edict=event('-jin-investiture-burial-edict');assert.equal(edict.year,937);assert.match(edict.summary,/不能据此断言已经执行/);
  const temple=event('-temple-proposal');assert.equal(temple.year,null);assert.deepEqual(temple.yearRange,{start:939,end:940});assert.match(temple.title,/祔庙/);
  const title=event('-posthumous-name');assert.equal(title.year,940);assert.ok(title.variants.some(v=>v.evidence.some(s=>s.paragraphId==='old-v049-p26')));
});
test('Kong empress uses contextual family evidence without merging unrelated Kong, Lu titles or unnamed sons',()=>{
  const person=catalogPeople.find(p=>p.id===id);assert.ok(person);assert.match(person.intro,/孔循之女/);
  const rows=loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id));
  const paragraphIds=new Set(rows.flatMap(p=>p.spans.map(s=>s.paragraphId)));
  for(const p of ['new-v15-p15','tongjian-v276-p74','huiyao-v003-p4','old-v079-p1'])assert.ok(paragraphIds.has(p),p);
  for(const p of ['new-v15-p5','new-v43-p29','new-v43-p30','shibu-v005-p8','old-v091-p12'])assert.ok(!paragraphIds.has(p),p);
  const edges=relationshipsForPerson(id);
  for(const endpoint of ['kong-xun','li-conghou','li-congke','shi-jingtang']){
    const edge=edges.find(e=>e.from===endpoint||e.to===endpoint);assert.ok(edge,endpoint);
    assert.ok(relationshipsForPerson(endpoint).some(e=>e.id===edge.id),endpoint);
  }
  assert.ok(!edges.some(e=>e.label==='生母'||e.label==='四子'));
});
