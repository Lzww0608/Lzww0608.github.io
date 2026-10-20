import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {filterSearch} from '../src/data.ts';
import {personRelationships,relationshipNodes,relationshipsForPerson,searchRelationshipNodes} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const fuqing='zhou-guo-wei-princess-fuqing',qionghua='tang-princess-qionghua',li='li-chongjin-zhou';

test('qualified Fuqing searches keep the two princesses separate and Li Chongjin remains a context node',()=>{
 for(const[id,other,queries]of [[fuqing,qionghua,['后周福庆长公主','後周福慶長公主']],[qionghua,fuqing,['福庆长公主（孟知祥妻）','福慶長公主（孟知祥妻）']]])for(const query of queries)for(const search of [filterSearch,searchRelationshipNodes]){
  const found=search(query).map(p=>p.id);assert.ok(found.includes(id),query);assert.ok(!found.includes(other),query);
 }
 assert.ok(!loadPassagePeople().some(p=>p.id===li));assert.ok(!loadPersonTimelines().some(d=>d.personId===li));
 const context=relationshipNodes.find(p=>p.id===li);assert.ok(context);assert.equal(context.external,true);assert.ok(searchRelationshipNodes('李重進').some(p=>p.id===li));
 const index=loadPersonPassageIndex();for(const pid of ['old-v112-p12','old-v114-p12','old-v113-p12','tongjian-v290-p118']){
  const passage=index.passages.find(p=>p.spans.some(s=>s.paragraphId===pid));assert.ok(passage?.people.some(p=>p.personId===fuqing),pid);assert.ok(!passage.people.some(p=>p.personId===qionghua),pid);
 }
});

test('the four sourced family relationships appear at both endpoints without inventing a husband or father',()=>{
 const expected=[[fuqing+'-guo-sibling',fuqing,'guo-wei'],[fuqing+'-li-mother',fuqing,li],[fuqing+'-chai-imperial-aunt',fuqing,'chai-rong'],['guo-wei-li-chongjin-zhou-nephew','guo-wei',li]],library=loadLibrary();
 const paragraphs=new Map(library.chapters.flatMap(c=>c.paragraphs.map(p=>[p.id,{...p,chapterId:c.id}])));
 for(const[id,from,to]of expected){const matches=personRelationships.filter(e=>e.id===id);assert.equal(matches.length,1,id);const edge=matches[0];assert.deepEqual([edge.from,edge.to,edge.kind],[from,to,'kinship']);for(const endpoint of [from,to])assert.equal(relationshipsForPerson(endpoint).filter(e=>e.id===id).length,1,id+'/'+endpoint);
  for(const source of edge.sources){const p=paragraphs.get(source.paragraphId);assert.ok(p&&p.chapterId===source.chapterId&&p.original.includes(source.excerpt),id);}
 }
 assert.deepEqual(new Set(relationshipsForPerson(fuqing).map(e=>e.id)),new Set(expected.slice(0,3).map(e=>e[0])));
 assert.deepEqual(new Set(relationshipsForPerson(li).map(e=>e.id)),new Set([expected[1][0],expected[3][0]]));
 assert.match(personRelationships.find(e=>e.id===expected[2][0]).label,/名义皇姑/);
});

test('the two grants remain posthumous with source-specific elder-sister and younger-sister testimony',()=>{
 const doc=loadPersonTimelines().find(d=>d.personId===fuqing);assert.ok(doc);assert.equal(doc.events.length,2);
 const [first,second]=doc.events;assert.deepEqual(doc.events.map(e=>[e.year,e.precision,e.phase]),[[952,'month','posthumous'],[954,'month','posthumous']]);assert.match(first.sourceDate,/九月癸未/);assert.match(second.sourceDate,/八月丙辰/);
 assert.ok(first.evidence.some(e=>e.paragraphId==='old-v112-p12'&&e.excerpt.includes('故第四姊')));assert.ok(first.variants.some(v=>v.evidence.some(e=>e.paragraphId==='tongjian-v290-p118'&&e.excerpt.includes('帝妹'))));
 assert.ok(second.evidence.some(e=>e.paragraphId==='old-v114-p12'&&e.excerpt.includes('李重進之母')));assert.ok(second.notes.some(n=>n.includes('壬申朔')));
});

test('all 25 actual corrected reading units bind the current parent and identify Li Chongjin as the older person',async()=>{
 const library=loadLibrary(),chapter=loadPublishedChapters(library).find(c=>c.id==='old-v113'),p=chapter.paragraphs.find(p=>p.id==='old-v113-p12'),index=read('content/sentence-alignments/chapters/old-v113.json');
 const bound=read('content/sentence-alignments/period-overrides/backfill-old-v113.json').paragraphs.find(p=>p.paragraphId==='old-v113-p12');assert.notEqual(p.translation.id,'1346');assert.ok(p.translation.version>1);assert.equal(bound.translationId,p.translation.id);assert.equal(bound.translationVersion,p.translation.version);
 const fetcher=async url=>{assert.match(String(url),/\/sentence-alignments\/old-v113\.json$/);return Response.json(index);};
 const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,archiveBase:'/',fetcher});assert.equal(parts.length,25);assert.ok(parts.every(x=>x.kind==='sentence'&&x.translation?.trim()));assert.equal(parts.map(x=>x.original).join(''),p.original);assert.equal(parts.map(x=>x.translation).join(''),p.translation.text);
 assert.match(parts[11].original,/母即福慶長公主。$/);assert.match(parts[11].translation,/其母即福庆长公主。$/);assert.match(parts[12].original,/^重進年長於世宗/);assert.match(parts[12].translation,/^李重进年长于世宗。/);assert.equal(p.translation.reviewNotes.length,2);
 const oldParent={...p,translation:{...p.translation,id:'1346',version:1}},stale=await readSentenceTranslationParts({paragraph:oldParent,displayedOriginal:p.original,archiveBase:'/',fetcher});assert.ok(stale.every(x=>x.kind==='unaligned'&&x.translation===null),'the old parent must not reuse the corrected ranges');
});
