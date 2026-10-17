import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
const empress='tang-li-congke-empress-liu',nun='tang-li-congke-daughter-nun-youcheng';
test('Congke Liu and Youcheng keep mother unknown, distinct July/August rites, and decreed funeral source limits',()=>{
  const people=[empress,nun].map(id=>catalogPeople.find(p=>p.id===id));assert.ok(people.every(Boolean));
  assert.ok(people[0].sourceNotes.some(n=>/生母/.test(n)&&/不|未/.test(n)));assert.ok(people[1].sourceNotes.some(n=>/俗名/.test(n)&&/不|未/.test(n)));
  const docs=loadPersonTimelines(),liu=docs.find(d=>d.personId===empress),girl=docs.find(d=>d.personId===nun);assert.ok(liu&&girl);
  const july=liu.events.find(e=>e.id===empress+'-july-designated-empress'),august=liu.events.find(e=>e.id===empress+'-august-investiture');assert.ok(july&&august);assert.equal(july.year,934);assert.equal(august.year,934);assert.match(july.sourceDate,/七月/);assert.match(august.sourceDate,/八月/);
  const death=liu.events.find(e=>e.id===empress+'-tower-death'),burial=liu.events.find(e=>e.id===empress+'-family-burial-decree');assert.equal(death.year,937);assert.equal(burial.year,937);assert.equal(burial.phase,'posthumous');assert.match(burial.summary,/奏|获准/);assert.match(burial.summary,/不能|不据|未/);
  const rows=loadPersonPassageIndex().passages,kind=(id,pid)=>rows.find(p=>p.spans.some(s=>s.paragraphId===pid))?.people.find(p=>p.personId===id)?.kind;
  assert.equal(kind(empress,'old-v076-p7'),'mention');assert.equal(kind(nun,'new-v16-p5'),'record');assert.equal(kind(nun,'old-v046-p9'),'record');const summoned=girl.events.find(e=>e.id===nun+'-summoned-to-palace');assert.ok(summoned.evidence.some(e=>e.paragraphId==='old-v046-p9'));assert.match(summoned.sourceDate,/正月/);assert.ok(!/二月/.test(summoned.sourceDate));assert.ok(summoned.notes.some(n=>/二月/.test(n)&&/调|調/.test(n)&&/不把|不据|不能/.test(n)));for(const pid of['new-v16-p1','new-v16-p4','old-v049-p28'])assert.ok(!rows.some(p=>p.spans.some(s=>s.paragraphId===pid)&&p.people.some(q=>[empress,nun].includes(q.personId))));
  const killed=girl.events.find(e=>e.id===nun+'-killed-under-mindi');assert.equal(killed.year,934);assert.equal(killed.precision,'month');assert.ok(!/楚匡祚.*杀幼澄|宋州.*杀幼澄/.test(killed.summary));
});
test('Congke family graph keeps daughter father and same-father siblings without inventing Liu maternity',()=>{
  const liu=relationshipsForPerson(empress),girl=relationshipsForPerson(nun);assert.ok(![...liu,...girl].some(e=>[e.from,e.to].includes(empress)&&[e.from,e.to].includes(nun)));
  const relation=liu.find(e=>e.id===empress+'-yanhao-source-kinship');assert.ok(relation);assert.match(relation.label,/弟/);assert.match(relation.label,/侄/);
  for(const id of['li-congke','li-chongji-congke-son','li-chongmei-congke-son']){const edge=girl.find(e=>e.from===id||e.to===id);assert.ok(edge,id);assert.ok(relationshipsForPerson(id).some(e=>e.id===edge.id));}
  for(const e of girl.filter(e=>/same-father/.test(e.id))){assert.match(e.label,/同父/);assert.ok(!/同母/.test(e.label));}
});
test('Both Tongjian Huiming popups retain17 units and the earlier couples-pronoun correction remains readable',async()=>{
  const fetcher=async url=>{try{return new Response(fs.readFileSync(new URL('../public'+new URL(String(url),'https://static.test').pathname,import.meta.url)));}catch{return new Response('',{status:404});}};
  let count=0;for(const[cid,pid,length,index]of[['tongjian-v278','tongjian-v278-p97',6,4],['tongjian-v279','tongjian-v279-p14',11,10]]){
    const chapter=JSON.parse(fs.readFileSync(new URL('../public/history/chapters/'+cid+'.json',import.meta.url))),p=chapter.paragraphs.find(p=>p.id===pid);assert.ok(p);assert.ok(p.translation.version>=2);
    const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher});assert.equal(parts.length,length);assert.ok(parts.every(u=>u.kind==='sentence'));assert.match(parts[index].translation,/称作惠明/);assert.ok(!parts[index].translation.includes('李惠明'));
    assert.equal(parts.map(u=>u.original).join(''),p.original);assert.equal(parts.map(u=>u.translation).join(''),p.translation.text);assert.ok(p.translation.reviewNotes.some(n=>/幼澄/.test(n)&&/俗名/.test(n)));count+=parts.length;
  }assert.equal(count,17);
  const chapter=JSON.parse(fs.readFileSync(new URL('../public/history/chapters/tongjian-v278.json',import.meta.url))),prior=chapter.paragraphs.find(p=>p.id==='tongjian-v278-p72');assert.ok(prior.translation.version>=2);assert.match(prior.translation.text,/安从益前去杀了他们，并杀他的儿子/);assert.ok(prior.translation.reviewNotes.some(n=>/其子/.test(n)&&/不据此/.test(n)));
});
