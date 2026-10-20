import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {catalogPeople} from '../src/person-catalog.ts';
import {filterSearch} from '../src/data.ts';
import {relationshipNodes,personRelationships,relationshipsForPerson,searchRelationshipNodes} from '../src/relationships.ts';
import {splitReadingSpans} from '../src/sentence-alignment.ts';
import {originalTextTag} from '../src/reading-headings.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const liu='zhou-chai-rong-empress-liu',fu='zhou-chai-rong-empress-fu-xuanyi',younger='zhou-chai-rong-empress-fu-younger',mother='zhou-fu-xuanyi-mother-unknown';
const ids=[liu,fu,younger,mother];
const library=loadLibrary(),timelines=loadPersonTimelines(library),timeline=id=>timelines.find(d=>d.personId===id);

test('Shizong household keeps four distinct nonreigning canonical identities with sourced events',()=>{
 const people=loadPassagePeople(),rules=read('content/person-passages/rules.json'),index=loadPersonPassageIndex(library);
 for(const id of ids){
  for(const list of [people,catalogPeople,relationshipNodes])assert.equal(list.filter(p=>p.id===id).length,1,id);
  const profile=catalogPeople.find(p=>p.id===id);assert.equal(profile.dynasty,'后周');
  for(const key of ['reign','reignStart','reignEnd'])assert.equal(profile[key],undefined);
  assert.ok(timeline(id)?.events.length>0);assert.ok(index.passages.some(p=>p.people.some(a=>a.personId===id)));
  const rule=rules.people.find(r=>r.personId===id);assert.ok(rule);
  for(const name of [...rule.names,...rule.shortNames,...rule.titles])assert.ok(!['刘氏','劉氏','符氏','皇后','太后','母'].includes(name));
 }
 assert.notEqual(catalogPeople.find(p=>p.id===fu).name,catalogPeople.find(p=>p.id===younger).name);
});

test('real global and relationship searches distinguish both Fu empresses in registered simplified/traditional forms',()=>{
 const cases=[[fu,['符氏（周世宗宣懿皇后）','周世宗宣懿符后','周世宗宣懿符後']],[younger,['符氏（周世宗后符皇后）','符氏（周世宗後符皇后）','周世宗后符皇后','周世宗後符皇后']]];
 for(const[id,queries]of cases)for(const query of queries)for(const search of [filterSearch,searchRelationshipNodes]){
  const result=search(query).map(p=>p.id);assert.ok(result.includes(id),query);assert.ok(!result.includes(id===fu?younger:fu),query);
 }
});

test('eleven sourced relationships are registered once and appear at both actual endpoints',()=>{
 const expected=[
  [liu+'-chai-marriage','chai-rong',liu,'kinship'],[fu+'-chai-marriage','chai-rong',fu,'kinship'],[younger+'-chai-marriage','chai-rong',younger,'kinship'],
  [fu+'-li-first-marriage','li-chongxun-han',fu,'kinship'],[fu+'-fu-father','fu-yanqing-zhou',fu,'kinship'],[younger+'-fu-father','fu-yanqing-zhou',younger,'kinship'],
  [fu+'-fu-grandfather','fu-cunshen',fu,'kinship'],[fu+'-guo-adoptive-father','guo-wei',fu,'adoption'],[fu+'-younger-sister',fu,younger,'kinship'],
  [mother+'-daughter',mother,fu,'kinship'],['zhou-guo-wei-empress-chai-adopted-chai-rong','zhou-guo-wei-empress-chai','chai-rong','adoption'],
 ];
 const originals=new Map(library.chapters.flatMap(c=>c.paragraphs.map(p=>[p.id,{p,c}])));
 for(const[id,from,to,kind]of expected){
  const matches=personRelationships.filter(e=>e.id===id);assert.equal(matches.length,1,id);const e=matches[0];assert.deepEqual([e.from,e.to,e.kind],[from,to,kind]);
  for(const endpoint of [from,to])assert.equal(relationshipsForPerson(endpoint).filter(e=>e.id===id).length,1,id+'/'+endpoint);
  assert.ok(e.sources.length);for(const s of e.sources){const bound=originals.get(s.paragraphId);assert.ok(bound&&bound.c.id===s.chapterId&&bound.p.original.includes(s.excerpt),id);}
 }
 // The new care/adoption evidence supplements rather than replaces the existing aunt and Guo adoption facts.
 assert.ok(relationshipsForPerson('chai-rong').some(e=>e.id==='zhou-guo-wei-empress-chai-chai-rong-aunt'));
 assert.ok(relationshipsForPerson('chai-rong').some(e=>e.id==='guo-wei-chai-rong-adoption'));
});

test('the unnamed mother is linked only to Xuanyi; the sisters do not acquire inferred children',()=>{
 const edges=relationshipsForPerson(mother);assert.equal(edges.length,1);assert.equal(edges[0].from,mother);assert.equal(edges[0].to,fu);assert.match(edges[0].label,/母女/);
 assert.ok(!edges.some(e=>e.from===younger||e.to===younger||e.from==='fu-yanqing-zhou'||e.to==='fu-yanqing-zhou'));
 for(const id of [liu,fu,younger]){
  assert.ok(!relationshipsForPerson(id).some(e=>e.from==='chai-zongxun'||e.to==='chai-zongxun'));
  assert.ok(!relationshipsForPerson(id).some(e=>e.from===id&&/母子|生母|嫡母|养母|養母/.test(e.label)));
 }
 const children=library.chapters.find(c=>c.id==='new-v20').paragraphs.find(p=>p.id==='new-v20-p11');assert.match(children.original,/皆不知其母為誰氏/);
 const event=timeline(mother).events[0];assert.ok(event.evidence.some(e=>e.paragraphId==='new-v20-p8'));assert.ok(event.evidence.some(e=>e.paragraphId==='shibu-v005-p26'));
});

test('Liu investiture days and Xuanyi death years remain separate source variants',()=>{
 const investiture=timeline(liu).events.find(e=>e.id===liu+'-posthumous-empress');assert.equal(investiture.year,957);assert.match(investiture.sourceDate,/壬午/);assert.match(investiture.sourceDate,/癸未/);
 assert.ok(investiture.evidence.some(e=>e.paragraphId==='old-v117-p4'&&e.excerpt.includes('壬午')));
 assert.ok(investiture.variants.some(v=>v.evidence.some(e=>e.paragraphId==='new-v12-p6'&&e.excerpt.includes('癸未'))));
 const death=timeline(fu).events.find(e=>e.id===fu+'-death');assert.equal(death.year,956);
 assert.ok(death.variants.some(v=>v.sourceDate.includes('显德二年七月二十一日')&&v.evidence.some(e=>e.paragraphId==='old-v121-p9'&&e.excerpt.includes('顯德二年七月二十一日'))));
 assert.match(library.chapters.find(c=>c.id==='old-v121').paragraphs.find(p=>p.id==='old-v121-p9').original,/顯德二年七月二十一日/);
});

test('complete new20 retains all four headings, three collation blocks and its independent final exclamation unit',()=>{
 const ch=library.chapters.find(c=>c.id==='new-v20');assert.equal(ch.paragraphs.length,17);assert.deepEqual(ch.paragraphs.slice(0,1).map(p=>p.original),['柴守禮']);
 assert.deepEqual([1,5,7,10].map(n=>ch.paragraphs[n-1].original),['柴守禮','皇后劉氏','皇后符氏','世宗七子']);
 const p=ch.paragraphs.find(p=>p.id==='new-v20-p4'),tail=splitReadingSpans(p.original).at(-1);assert.deepEqual(tail,{start:340,end:350,text:'世宗之知權，明矣夫！'});
 assert.match(ch.paragraphs[14].original,/「王」作「汪」/);assert.match(ch.paragraphs[15].original,/漢誅太祖家屬，后見殺/);assert.match(ch.paragraphs[16].original,/「吾」下均有「王」字/);
});

test('actual published parents give all 71 native units their own translations, including four headings and the final exclamation',async()=>{
 const ch=loadPublishedChapters(library).find(c=>c.id==='new-v20'),index=read('content/sentence-alignments/chapters/new-v20.json'),override=read('content/sentence-alignments/period-overrides/new-v20.json');
 assert.equal(ch.paragraphs.length,17);assert.equal(override.paragraphs.length,17);
 const fetcher=async url=>{assert.match(String(url),/\/sentence-alignments\/new-v20\.json$/);return Response.json(index);};
 let count=0;const loaded=new Map();
 for(const p of ch.paragraphs){
  const bound=override.paragraphs.find(x=>x.paragraphId===p.id);assert.equal(bound.translationId,p.translation.id);assert.equal(bound.translationVersion,p.translation.version);
  const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,archiveBase:'/',fetcher});
  assert.equal(parts.length,splitReadingSpans(p.original).length);assert.ok(parts.every(x=>x.kind==='sentence'&&typeof x.translation==='string'&&x.translation.trim()));
  assert.equal(parts.map(x=>x.original).join(''),p.original);assert.equal(parts.map(x=>x.translation).join(''),p.translation.text);count+=parts.length;loaded.set(p.id,parts);
 }
 assert.equal(count,71);
 for(const n of [1,5,7,10]){const p=ch.paragraphs[n-1];assert.equal(originalTextTag(p),'h2');assert.equal(loaded.get(p.id).length,1);}
 assert.deepEqual(loaded.get('new-v20-p4').slice(-1).map(x=>[x.original,x.translation]),[['世宗之知權，明矣夫！','世宗懂得权衡，这是很清楚的啊！']]);
 const p=ch.paragraphs[3],changed={...p,translation:{...p.translation,id:'999999999'}};
 const stale=await readSentenceTranslationParts({paragraph:changed,displayedOriginal:changed.original,archiveBase:'/',fetcher});
 assert.ok(stale.every(x=>x.kind==='unaligned'&&x.translation===null),'a different current parent must suspend these ranges');
});
