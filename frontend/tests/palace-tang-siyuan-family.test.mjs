import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPassagePeople} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson,relationshipNodes} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
const prefix='tang-li-siyuan-',shufei=prefix+'shufei-wang',siyi=prefix+'siyi-wang',yongning=prefix+'princess-yongning',xingping=prefix+'princess-xingping',yongan=prefix+'princess-yongan';
const allEdges=()=>new Map([shufei,siyi,yongning,xingping,yongan,'li-congke'].flatMap(id=>relationshipsForPerson(id)).map(e=>[e.id,e]));
test('Mingzong mother, foster mother and wetnurse remain distinct and reciprocal',()=>{
 const people=loadPassagePeople();for(const id of [shufei,siyi])assert.equal(people.filter(p=>p.id===id).length,1);
 const edges=allEdges(),foster=edges.get(shufei+'-congyi-nurture'),nurse=edges.get(siyi+'-congyi-wetnurse');
 assert.equal(foster.kind,'adoption');assert.equal(nurse.label,'乳母');assert.notEqual(foster.from,nurse.from);
 assert.ok(relationshipsForPerson('li-congyi').some(e=>e.id===foster.id));assert.ok(relationshipsForPerson('li-congyi').some(e=>e.id===nurse.id));
 assert.ok(!relationshipsForPerson(siyi).some(e=>e.kind==='spouse'));
 const disputed=edges.get('li-siyuan-congke-adoption');assert.equal(disputed.kind,'adoption');assert.ok(disputed.sources.some(s=>s.paragraphId==='kaoyi-v028-p43'));
 assert.match(disputed.note,/实录/);assert.match(disputed.note,/养子/);
});
test('the two Zhao wives stay separate while Yongning and the Jin empress share one identity',()=>{
 const people=loadPassagePeople(),j=people.find(p=>p.id===yongning);assert.ok(j);assert.match(j.name,/后晋/);
 for(const id of [xingping,yongan]){assert.equal(relationshipNodes.filter(n=>n.id===id&&!n.external).length,1);const edge=relationshipsForPerson(id).find(e=>e.id===id+'-zhao-yanshou-spouse');assert.ok(edge);assert.ok(relationshipsForPerson('zhao-yanshou').some(e=>e.id===edge.id));}
 assert.equal(relationshipsForPerson(xingping).find(e=>e.id===xingping+'-zhao-yanshou-spouse').label,'前妻');assert.equal(relationshipsForPerson(yongan).find(e=>e.id===yongan+'-zhao-yanshou-spouse').label,'继妻');
 const doc=loadPersonTimelines().find(d=>d.personId===yongning);assert.ok(doc.events.some(e=>e.year===950));
 const field=doc.events.find(e=>e.id===yongning+'-ask-fields');assert.equal(field.year,948);assert.ok(field.variants.some(v=>v.sourceDate.includes('二年')&&v.evidence.some(e=>e.paragraphId==='tongjian-v288-p83')));
});
test('source disagreements and cross-year records remain attached to their actual evidence',()=>{
 const docs=loadPersonTimelines(),cao=docs.find(d=>d.personId===prefix+'consort-cao'),xia=docs.find(d=>d.personId===prefix+'consort-xia');assert.ok(cao&&xia);
 assert.equal(cao.events.find(e=>e.id.endsWith('-death')).year,937);assert.equal(docs.find(d=>d.personId===siyi).events.find(e=>e.id.endsWith('-death')).year,933);
 const post=xia.events.find(e=>e.id.endsWith('-posthumous-empress'));assert.equal(post.year,932);assert.ok(post.variants.some(v=>v.evidence.some(e=>e.paragraphId==='new-v15-p3')));assert.ok(post.variants.some(v=>v.evidence.some(e=>e.paragraphId==='huiyao-v001-p36')));
});
test('wedding correction keeps seven distinct clicks bound to the actual published parent',async()=>{
 const p=loadPublishedChapters(loadLibrary()).find(c=>c.id==='tongjian-v286').paragraphs.find(p=>p.id==='tongjian-v286-p55');
 const index=JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/tongjian-v286.json',import.meta.url)));
 const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,archiveBase:'/',fetcher:async u=>String(u).includes('sentence-alignments')?Response.json(index):new Response('',{status:404})});
 assert.equal(p.translation.version,2);assert.notEqual(String(p.translation.id),'5394');assert.equal(parts.length,7);assert.equal(parts[1].translation,'赵延寿娶明宗的女儿为妻，王淑妃到大梁参加婚礼。');
 assert.equal(parts.map(p=>p.original).join(''),p.original);assert.equal(parts.map(p=>p.translation).join(''),p.translation.text);assert.ok(parts.every(p=>p.kind==='sentence'));
 assert.match(p.translation.text,/威信/);assert.doesNotMatch(p.translation.text,/彰信/);
});
