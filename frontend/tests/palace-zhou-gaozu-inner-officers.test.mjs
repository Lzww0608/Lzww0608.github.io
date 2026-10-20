import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {catalogPeople} from '../src/person-catalog.ts';
import {filterSearch} from '../src/data.ts';
import {relationshipsForPerson,searchRelationshipNodes} from '../src/relationships.ts';

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const cases=[
 ['shangyi-zhao','后周尚仪赵氏','後周尚儀趙氏'],
 ['shangfu-su','后周尚服苏氏','後周尚服蘇氏'],
 ['shanggong-fu','后周尚宫甫氏','後周尚宮甫氏'],
 ['sibin-gao','后周司宾高氏','後周司賓高氏'],
 ['sibin-chai','后周司宾柴氏','後周司賓柴氏'],
 ['sibin-ru','后周司宾茹氏','後周司賓茹氏'],
 ['siji-ding','后周司记丁氏','後周司記丁氏'],
].map(([suffix,simplified,traditional])=>({id:'zhou-guo-wei-'+suffix,simplified,traditional}));
const library=loadLibrary(),index=loadPersonPassageIndex(library),timelines=loadPersonTimelines(library);

test('Zhou palace officers are searchable by qualified simplified/traditional names without turning Fu into Huangfu',()=>{
 for(const {id,simplified,traditional}of cases){
  assert.equal(catalogPeople.filter(p=>p.id===id).length,1,id);
  for(const query of [simplified,traditional])for(const search of [filterSearch,searchRelationshipNodes])assert.deepEqual(search(query).map(p=>p.id),[id],query);
 }
 const fu='zhou-guo-wei-shanggong-fu';
 for(const query of ['后周尚宫皇甫氏','後周尚宮皇甫氏'])for(const search of [filterSearch,searchRelationshipNodes])assert.ok(!search(query).some(p=>p.id===fu),query);
 assert.doesNotMatch(catalogPeople.find(p=>p.id===fu).aliases,/皇甫/);
});

test('the seven local records stay in the named Huiyao clauses rather than inheriting annal groups or bare-surname matches',()=>{
 const rules=read('content/person-passages/rules.json');
 const annal=library.chapters.find(c=>c.id==='old-v111').paragraphs.find(p=>p.id==='old-v111-p6');
 assert.match(annal.original,/尚宮皇甫氏等三人/);
 for(const {id}of cases){
  const passages=index.passages.filter(p=>p.people.some(a=>a.personId===id));
  assert.deepEqual(passages.flatMap(p=>p.spans.map(s=>s.paragraphId)),['huiyao-v001-p53']);
  assert.equal(passages[0].people.find(a=>a.personId===id).kind,'record');
  const rule=rules.people.find(p=>p.personId===id);assert.ok(rule);
  for(const name of [...rule.names,...rule.shortNames,...rule.titles])assert.doesNotMatch(name,/^(?:[\p{Script=Han}]{1,2}氏|夫人|宫官|宮官)$/u);
 }
});

test('month-granular enfeoffments create reciprocal service links, not marriages or invented first appointments',()=>{
 const reverse=relationshipsForPerson('guo-wei');
 for(const {id}of cases){
  const document=timelines.find(t=>t.personId===id);assert.ok(document);assert.equal(document.events.length,1);
  const event=document.events[0];assert.equal(event.year,951);assert.equal(event.precision,'month');assert.equal(event.sourceDate,'广顺元年八月敕');assert.match(event.title,/^封/);
  assert.deepEqual(new Set(event.evidence.map(e=>e.paragraphId)),new Set(['huiyao-v001-p53']));
  assert.ok(event.evidence.some(e=>e.excerpt==='並廣順元年八月敕。'));
  const edges=relationshipsForPerson(id);assert.equal(edges.length,1);const edge=edges[0];assert.equal(edge.kind,'service');assert.deepEqual([edge.from,edge.to],['guo-wei',id]);assert.equal(reverse.filter(e=>e.id===edge.id).length,1);
  for(const key of ['reign','reignStart','reignEnd'])assert.equal(catalogPeople.find(p=>p.id===id)[key],undefined);
 }
});
