import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipNodes,relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const id='tang-li-congrong-consort-liu';
test('Liu consort keeps marriage and death source roles separate from children and other Liu households',()=>{
  const person=catalogPeople.find(p=>p.id===id);assert.ok(person);
  assert.ok(person.sourceNotes.some(n=>/未見|未见/.test(n)&&/身份/.test(n)));
  assert.ok(person.sourceNotes.some(n=>/生母/.test(n)&&/不|未/.test(n)));
  const rows=loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id));
  const sourceIds=rows.flatMap(p=>p.spans.map(s=>s.paragraphId)).sort();
  assert.deepEqual(sourceIds,['old-v038-p14','new-v15-p31','tongjian-v278-p72'].sort());
  const doc=loadPersonTimelines().find(d=>d.personId===id);assert.ok(doc);assert.equal(doc.events.length,2);
  const marriage=doc.events.find(e=>e.id===id+'-marriage-source-role');assert.ok(marriage);assert.equal(marriage.year,927);assert.equal(marriage.precision,'day');
  const death=doc.events.find(e=>e.id===id+'-couple-palace-death');assert.ok(death);assert.equal(death.year,933);assert.equal(death.precision,'month');assert.match(death.sourceDate,/十一月/);
  assert.ok(death.notes.some(n=>/母系|生母/.test(n)));assert.ok(!doc.events.some(e=>/起兵|出兵|继嗣|掌兵/.test(e.title)));
});
test('Liu consort direct relationships preserve source-qualified father and distinguish An Congyi from Li Congyi',()=>{
  const edges=relationshipsForPerson(id);assert.equal(edges.length,3);
  for(const endpoint of ['li-congrong','liu-zhongyin','an-congyi-palace-official']){
    const edge=edges.find(e=>e.from===endpoint||e.to===endpoint);assert.ok(edge,endpoint);
    assert.ok(relationshipsForPerson(endpoint).some(e=>e.id===edge.id),endpoint);
  }
  const father=edges.find(e=>e.id===id+'-zhongyin-daughter-source');assert.ok(father);assert.equal(father.kind,'kinship');assert.match(father.label,/来源限定/);
  const actor=relationshipNodes.find(n=>n.id==='an-congyi-palace-official');assert.ok(actor);assert.equal(actor.name,'安从益');assert.equal(actor.external,true);
  assert.ok(relationshipNodes.some(n=>n.name==='李从益'&&n.id!==actor.id));
  assert.ok(!catalogPeople.some(p=>p.id===actor.id));
  assert.ok(!edges.some(e=>/生母|母子/.test(e.label)));
});
test('Tongjian couple-death popup binds the published plural-object correction across all31 literal units',async()=>{
  const chapter=JSON.parse(fs.readFileSync(new URL('../public/history/chapters/tongjian-v278.json',import.meta.url)));
  const p=chapter.paragraphs.find(p=>p.id==='tongjian-v278-p72');assert.ok(p);assert.ok(p.translation.version>=2);
  const fetcher=async url=>{const path=new URL(String(url),'https://static.test').pathname;try{return new Response(fs.readFileSync(new URL('../public'+path,import.meta.url)));}catch{return new Response('',{status:404});}};
  const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher});assert.equal(parts.length,31);assert.ok(parts.every(u=>u.kind==='sentence'));
  const couple=parts.find(u=>u.original.startsWith('從榮與妃劉氏匿床下'));assert.ok(couple);
  assert.match(couple.translation,/安从益前去杀了他们，并杀他的儿子/);assert.ok(!couple.translation.includes('杀了他，'));
  assert.equal(parts.map(u=>u.original).join(''),p.original);assert.equal(parts.map(u=>u.translation).join(''),p.translation.text);
  assert.deepEqual(p.translation.reviewNotes.slice(0,3),['本段朱弘昭有一处作‘弘照’，译文保留分处字形。','底本‘指衣起’中的‘指衣’字形及所指动作有疑，译文未推定提衣的具体动作。','‘王为则奉迎’的‘为’按如此行动理解，未无注校成‘来’字。']);
  assert.ok(p.translation.reviewNotes.some(n=>/其子/.test(n)&&/不据此/.test(n)));
});
