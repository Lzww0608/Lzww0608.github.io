import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipNodes, relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const ids=['zhaoyi-hou','zhaoyuan-bai','meixuan-deng','chuzhen-zhang','demei-zhou','shizhen-wu','yicai-wang','xianyi-han'].map(s=>'tang-li-cunxu-'+s);

test('palace office evidence derives both graph views without inventing marriages or merging Hou identities',()=>{
  for(const id of ids){
    assert.equal(relationshipNodes.filter(n=>n.id===id&&!n.external).length,1,id);
    const edge=relationshipsForPerson(id).find(e=>e.id===id+'-cunxu-inner-office');
    assert.equal(edge?.kind,'service',id);
    assert.ok(relationshipsForPerson('li-cunxu').some(e=>e.id===edge.id),id);
    assert.ok(!relationshipsForPerson(id).some(e=>e.kind==='spouse'),id);
  }
  assert.ok(relationshipNodes.some(n=>n.id==='tang-li-cunxu-jiazhai-hou'));
  assert.ok(!relationshipsForPerson('tang-li-cunxu-zhaoyi-hou').some(e=>e.from==='tang-li-cunxu-jiazhai-hou'||e.to==='tang-li-cunxu-jiazhai-hou'));
});

test('generic remaining women and later reigns do not become named records or exact days for Wang and Han',()=>{
  const index=loadPersonPassageIndex(),timelines=loadPersonTimelines();
  for(const id of ids.slice(6)){
    const paragraphs=index.passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
    assert.ok(paragraphs.includes('old-v049-p16'),id);
    assert.ok(paragraphs.includes('huiyao-v001-p49'),id);
    for(const excluded of ['old-v032-p14','huiyao-v001-p50','new-v14-p10'])assert.ok(!paragraphs.includes(excluded),id+' '+excluded);
    const event=timelines.find(d=>d.personId===id).events.find(e=>e.id===id+'-fief-924');
    assert.equal(event.year,924);assert.equal(event.precision,'month');
    assert.ok(!event.evidence.some(e=>e.paragraphId==='old-v032-p14'));
  }
});

test('Bai fief variants remain separately sourced rather than becoming one normalized title',()=>{
  const event=loadPersonTimelines().find(d=>d.personId==='tang-li-cunxu-zhaoyuan-bai').events.find(e=>e.id==='tang-li-cunxu-zhaoyuan-bai-fief-924');
  const evidence=[...event.evidence,...event.variants.flatMap(v=>v.evidence)];
  for(const [id,text]of [['old-v032-p14','昭媛白氏為沛國夫人'],['old-v049-p16','昭媛白氏封沂國夫人'],['huiyao-v001-p49','昭媛白氏，〈封汧國夫人。〉']])
    assert.ok(evidence.some(e=>e.paragraphId===id&&e.excerpt.includes(text)),id);
});

test('the context correction keeps every click unit and does not narrow fengjun to county titles',async()=>{
  const chapter=loadPublishedChapters(loadLibrary()).find(c=>c.id==='huiyao-v001'),paragraph=chapter.paragraphs.find(p=>p.id==='huiyao-v001-p50');
  assert.ok(paragraph.translation.version>=2);
  const alignment=JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/huiyao-v001.json',import.meta.url)));
  const parts=await readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,archiveBase:'/',fetcher:async url=>String(url).includes('sentence-alignments')?Response.json(alignment):new Response('',{status:404})});
  assert.equal(parts.length,32);assert.equal(parts.map(p=>p.original).join(''),paragraph.original);
  assert.equal(parts.map(p=>p.translation).join(''),paragraph.translation.text);
  assert.ok(parts[31].original.includes('前代内職皆無封君之禮'));
  assert.ok(parts[31].translation.includes('都没有封君的礼制'));
  assert.ok(!parts[31].translation.includes('封县君'));
});
