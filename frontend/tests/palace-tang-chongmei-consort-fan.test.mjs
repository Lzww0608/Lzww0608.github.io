import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
import {originalTextTag} from '../src/reading-headings.ts';
import {splitReadingSpans} from '../src/sentence-alignment.ts';

const root=new URL('../../',import.meta.url);
const read=p=>JSON.parse(readFileSync(new URL(p,root)));
const id='tang-li-chongmei-consort-fan-unnamed';

test('Chongmei consort belongs to the source-qualified Fan household without inheriting his death or Guan actions',()=>{
 const person=loadPassagePeople().find(p=>p.id===id);assert.ok(person);
 assert.match(person.name,/范/);assert.match(person.name,/重美/);
 assert.equal(person.birthYear??null,null);assert.equal(person.deathYear??null,null);
 const passages=loadPersonPassageIndex().passages.filter(p=>p.people.some(a=>a.personId===id));
 assert.deepEqual(passages.flatMap(p=>p.spans.map(s=>s.paragraphId)).sort(),['new-v51-p21','old-v048-p5'].sort());
 assert.deepEqual(read('content/person-passages/rules.json').people.find(p=>p.personId===id).names,[]);
 const edges=relationshipsForPerson(id);
 assert.equal(edges.length,2);
 assert.ok(edges.some(e=>e.kind==='kinship'&&(e.from==='li-chongmei-congke-son'||e.to==='li-chongmei-congke-son')));
 assert.ok(edges.every(e=>e.sources.some(s=>s.paragraphId==='new-v51-p21')));
 const timeline=loadPersonTimelines().find(t=>t.personId===id);assert.ok(timeline.events.length>0);
 assert.ok(timeline.events.every(e=>e.evidence.some(s=>['new-v51-p21','old-v048-p5'].includes(s.paragraphId))));
 assert.ok(timeline.events.every(e=>!/(自焚|赐死|賜死)/u.test(e.title)));
});

test('new shared biography disambiguates unrelated Liu Yan, Congzhou, Atan and Yanqing names',()=>{
 const index=loadPersonPassageIndex();
 const at=pid=>index.passages.filter(p=>p.spans.some(s=>s.paragraphId===pid)).flatMap(p=>p.people.map(a=>a.personId));
 assert.ok(!at('new-v51-p39').includes('liu-yan-southern-han'));
 assert.ok(!at('new-v51-p47').includes('ge-congzhou'));
 assert.ok(!at('new-v51-p47').includes('xue-atan'));
 assert.ok(at('new-v51-p47').includes('zhou-dewei'));
 assert.ok(!at('new-v51-p53').includes('kou-yanqing'));
 for(const n of[10,11,12])assert.ok(at(`new-v51-p${n}`).includes('dong-zhang'));
 assert.ok(at('new-v51-p17').includes('tang-li-siyuan-shufei-wang'));
});

test('the entire new volume has matching published sentence translations, including textual notes and titles',async()=>{
 const chapter=loadPublishedChapters(loadLibrary()).find(c=>c.id==='new-v51');
 assert.equal(chapter.paragraphs.length,57);
 const fetcher=async url=>{try{return new Response(readFileSync(new URL('frontend/public'+new URL(String(url),'https://local').pathname,root)));}catch{return new Response('',{status:404});}};
 let clickable=0,plain=0;
 for(const p of chapter.paragraphs){
  assert.ok(p.translation?.text);
  const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher});
  assert.equal(parts.map(u=>u.original).join(''),p.original);
  for(const u of parts){if(u.kind==='sentence'){clickable++;assert.ok(u.translation,p.id);}else plain++;}
 }
 assert.equal(clickable,294);assert.equal(plain,0);
 assert.equal(chapter.paragraphs.filter(p=>originalTextTag(p)!=='p').length,7);
 assert.equal(chapter.paragraphs.flatMap(p=>splitReadingSpans(p.original)).filter(s=>/[。？！]/u.test(s.text)).length,287);
 assert.match(chapter.paragraphs[55].original,/鎮武軍/);
 assert.match(chapter.paragraphs[56].original,/房州/);
 assert.match(chapter.paragraphs[20].translation.text,/女儿.*重美.*妃/u);
});
