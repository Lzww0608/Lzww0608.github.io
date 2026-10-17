import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson,relationshipNodes} from '../src/relationships.ts';
// Reuse the registered four-nuns test's actual TSX loader; Node strip-types does not load .tsx directly.
const {readFileSync}=await import('node:fs');
const {createRequire}=await import('node:module');
const {default:vm}=await import('node:vm');
const {transform}=await import('esbuild');
const React=await import('react');
const graphRelationships=await import('../src/relationships.ts');
const graphSource=await transform(readFileSync(new URL('../src/PeopleRelationshipGraph.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'});
function graphModule(){
 const modules={react:{...React,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{},useMemo:callback=>callback(),useRef:value=>({current:value}),useId:()=>'direction-fixture'},'./relationships.ts':graphRelationships,'./use-original-script.ts':{useOriginalScript:()=>({script:'traditional',displayScript:'traditional',selectScript:()=>{}})},'./relationships.css':{}};
 const module={exports:{}},nativeRequire=createRequire(import.meta.url);
 vm.runInNewContext(graphSource.code,{module,exports:module.exports,require:name=>modules[name]??nativeRequire(name)});
 return module.exports;
}
const {isRelationshipDirected}=graphModule();

const id='tang-cunxu-daughter-betrothed-wang-zhaohui';
const evidenceIds=['new-v39-p8','tongjian-v268-p15','old-v027-p23','old-v027-p18','tongjian-v268-p3','tongjian-v268-p13'];
test('unnamed promised daughter keeps2 direct records and1 qualified mention, with an uncompleted betrothal rather than a spouse',()=>{
 const person=catalogPeople.find(p=>p.id===id);assert.ok(person);assert.equal(person.name,'庄宗许配王昭诲的失名女');assert.equal(person.birthYear,undefined);assert.equal(person.deathYear,undefined);
 assert.ok(person.intro.includes('本名')&&person.intro.includes('生母')&&person.intro.includes('未明'));assert.ok(person.intro.includes('婚礼完成'));
 assert.ok(!person.aliases.split(/\s+/u).some(n=>['李氏','公主','义宁公主','宋氏','王昭诲妻'].includes(n)));assert.deepEqual(person.readingStarts,{new:'new-v39',old:'old-v027',tongjian:'tongjian-v268'});
 const entries=loadPersonPassageIndex().passages.flatMap(p=>{const owner=p.people.find(q=>q.personId===id);return owner?p.spans.map(s=>[s.paragraphId,owner.kind]):[];});
 assert.deepEqual(new Map(entries),new Map([['new-v39-p8','record'],['tongjian-v268-p15','record'],['old-v027-p23','mention']]));assert.equal(entries.length,3);
 const edges=relationshipsForPerson(id);assert.equal(edges.length,2);const parent=edges.find(e=>e.from==='li-cunxu'),promise=edges.find(e=>e.from==='wang-zhaohui');assert.ok(parent&&promise);assert.equal(parent.to,id);assert.equal(promise.to,id);
 assert.equal(parent.label,'父女（许配记载）');assert.equal(promise.label,'亲属：许配（未证成婚）');assert.equal(isRelationshipDirected(parent),true);assert.equal(isRelationshipDirected(promise),false);
 for(const e of edges){assert.equal(e.kind,'kinship');assert.deepEqual(e.sources.map(s=>s.paragraphId),['new-v39-p8','tongjian-v268-p15']);assert.ok(relationshipsForPerson(e.from).some(q=>q.id===e.id&&q.to===id));}
 const groom=relationshipNodes.find(n=>n.id==='wang-zhaohui');assert.ok(groom?.external);assert.ok(groom.aliases.includes('崇隐'));assert.ok(!edges.some(e=>[e.from,e.to].some(n=>['wang-zhaozuo','song-tinghao','tang-princess-yining-cunxu-daughter','tang-cunxu-third-aunt-song-yining'].includes(n))));
});
test('911 source-month promise is shared with the father while his26 existing events remain in relative order',()=>{
 const docs=loadPersonTimelines(),woman=docs.find(d=>d.personId===id),father=docs.find(d=>d.personId==='li-cunxu');assert.ok(woman&&father);assert.equal(woman.events.length,1);
 const female=woman.events[0],male=father.events.find(e=>e.id==='li-cunxu-chengtian-alliance-and-betrothal');assert.ok(male);
 for(const event of[female,male]){assert.equal(event.year,911);assert.equal(event.precision,'month');assert.equal(event.yearRange,undefined);assert.deepEqual(event.evidence.map(s=>s.paragraphId),evidenceIds);assert.ok(event.sourceDate.includes('天祐八年秋七月')&&event.sourceDate.includes('乾化元年秋七月'));assert.ok(event.notes.some(n=>n.includes('明年')));assert.ok(event.notes.some(n=>n.includes('未给许婚确日')));}
 assert.equal(female.phase,'early');assert.equal(male.phase,'jin');assert.deepEqual(female.evidence,male.evidence);assert.equal(father.events.filter(e=>e.id===male.id).length,1);
 const oldIds=['li-cunxu-birth','li-cunxu-follow-father','li-cunxu-succeed-jin','li-cunxu-lu-encampment','li-cunxu-baixiang','li-cunxu-youzhou','li-cunxu-yan-captives','li-cunxu-weibo','li-cunxu-yuancheng','li-cunxu-rescue-youzhou','li-cunxu-huliu','li-cunxu-desheng','li-cunxu-zhenzhou-siege','li-cunxu-wangdu','li-cunxu-zhenzhou-taken','li-cunxu-imperial-accession','li-cunxu-liang-falls','li-cunxu-arrive-luoyang','li-cunxu-performers-patronage','li-cunxu-conquer-shu','li-cunxu-guo-chongtao-killed','li-cunxu-purge-and-hunger','li-cunxu-weibo-revolt','li-cunxu-failed-march','li-cunxu-xingjiao-death','li-cunxu-burial'];
 assert.deepEqual(father.events.filter(e=>oldIds.includes(e.id)).map(e=>e.id),oldIds);const at=father.events.findIndex(e=>e.id===male.id);assert.equal(father.events[at-1].id,'li-cunxu-baixiang');assert.equal(father.events[at+1].id,'li-cunxu-youzhou');
});
