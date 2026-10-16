import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipNodes,relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
const ids=['yaofang-zhang','yide-wang','xuanyi-ma'].map(s=>'tang-li-cunxu-'+s);
test('remaining named office roles derive both service graph views without generic or later-reign attribution',()=>{
 const index=loadPersonPassageIndex(),timelines=loadPersonTimelines();
 for(const id of ids){
  assert.equal(relationshipNodes.filter(n=>n.id===id&&!n.external).length,1,id);
  const edge=relationshipsForPerson(id).find(e=>e.id===id+'-cunxu-inner-office');assert.equal(edge?.kind,'service',id);
  assert.ok(relationshipsForPerson('li-cunxu').some(e=>e.id===edge.id),id);
  assert.ok(!relationshipsForPerson(id).some(e=>e.kind==='spouse'),id);
  const paragraphs=index.passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId)).sort();
  assert.deepEqual(paragraphs,['huiyao-v001-p49','old-v049-p16'],id);
  const doc=timelines.find(d=>d.personId===id);assert.equal(doc.events.length,1);
  const event=doc.events[0];assert.equal(event.year,924);assert.equal(event.precision,'month');
  assert.ok(![...event.evidence,...event.variants.flatMap(v=>v.evidence)].some(e=>['old-v032-p14','new-v14-p21','huiyao-v001-p50'].includes(e.paragraphId)),id);
 }
});
test('source-specific Yaofang and Langya spellings remain separately bound',()=>{
 const timelines=loadPersonTimelines();
 for(const [id,oldText,huiyaoText] of [[ids[0],'瑤芳張氏封清河郡夫人','瑶芳張氏，〈封清河郡夫人。〉'],[ids[1],'懿德王氏封琅琊郡夫人','懿德王氏，〈封瑯琊郡夫人。〉']]){
  const event=timelines.find(d=>d.personId===id).events[0],refs=[...event.evidence,...event.variants.flatMap(v=>v.evidence)];
  assert.ok(refs.some(e=>e.paragraphId==='old-v049-p16'&&e.excerpt.includes(oldText)));
  assert.ok(refs.some(e=>e.paragraphId==='huiyao-v001-p49'&&e.excerpt.includes(huiyaoText)));
 }
});
test('Xuanyi Ma name, fief and common month remain distinct sentence clicks without changing the full text',async()=>{
 const paragraph=loadPublishedChapters(loadLibrary()).find(c=>c.id==='huiyao-v001').paragraphs.find(p=>p.id==='huiyao-v001-p49');
 const alignment=JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/huiyao-v001.json',import.meta.url)));
 const parts=await readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,archiveBase:'/',fetcher:async url=>String(url).includes('sentence-alignments')?Response.json(alignment):new Response('',{status:404})});
 assert.equal(paragraph.translation.id,'1398');assert.equal(paragraph.translation.version,1);
 const name=parts.findIndex(p=>p.original==='宣一馬氏。');assert.ok(name>=0);
 assert.deepEqual(parts.slice(name).map(p=>p.original),['宣一馬氏。','〈封扶風郡夫人。','並同光二年十一月敕。〉']);
 assert.ok(parts.slice(name).every(p=>p.translation));assert.equal(parts.map(p=>p.original).join(''),paragraph.original);assert.equal(parts.map(p=>p.translation).join(''),paragraph.translation.text);
});
