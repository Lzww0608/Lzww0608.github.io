import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipNodes,relationshipsForPerson} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const ids=['tang-li-cunxu-empress-liu','tang-li-cunxu-shufei-han','tang-li-cunxu-defei-yi','tang-li-cunxu-guoguo-xia','tang-li-cunxu-jiazhai-hou','tang-li-cunxu-favorite-yuan-xingqin-wife','tang-princess-yining-cunxu-daughter','tang-li-jiji-wife-wang-du-daughter'];

test('Cunxu household source identities are unique and direct relationships derive at both ends',()=>{
  for(const id of ids){const matches=relationshipNodes.filter(n=>n.id===id);assert.equal(matches.length,1,id);assert.notEqual(matches[0].external,true,id);const edges=relationshipsForPerson(id);assert.ok(edges.length,id);for(const edge of edges){const other=edge.from===id?edge.to:edge.from;assert.ok(relationshipsForPerson(other).some(e=>e.id===edge.id),edge.id);}}
});

test('the prince wife source does not inherit other women who share Wang or the Wei title',()=>{
  const id='tang-li-jiji-wife-wang-du-daughter';
  const index=loadPersonPassageIndex();
  const paragraphs=index.passages.filter(p=>p.people.some(q=>q.personId===id)).flatMap(p=>p.spans.map(s=>s.paragraphId));
  assert.ok(paragraphs.includes('old-v032-p7'));
  assert.ok(paragraphs.includes('new-v39-p33'));
  assert.ok(!paragraphs.includes('old-v031-p6'));
  assert.ok(!paragraphs.includes('new-v14-p9'));
  for(const paragraphId of ['beimeng-v018-p14','beimeng-v018-p18']){
    const passage=index.passages.find(p=>p.spans.some(s=>s.paragraphId===paragraphId));
    assert.ok(!passage?.people.some(p=>ids.includes(p.personId)),paragraphId+' is a reading heading, not a person record');
  }
  const generalPalaceBackground=index.passages.find(p=>p.spans.some(s=>s.paragraphId==='new-v14-p10'));
  assert.ok(!generalPalaceBackground.people.some(p=>p.personId==='tang-li-cunxu-shufei-han'));
});

test('month-only investitures preserve the western-year range and the private order precedes its execution',()=>{
  const docs=loadPersonTimelines();
  for(const id of ['tang-li-cunxu-shufei-han','tang-li-cunxu-defei-yi']){const event=docs.find(d=>d.personId===id).events.find(e=>e.id===id+'-ceremony');assert.equal(event.year,null);assert.equal(event.precision,'range');assert.deepEqual(event.yearRange,{start:924,end:925});}
  const event=docs.find(d=>d.personId==='tang-li-cunxu-empress-liu').events.find(e=>e.id==='tang-li-cunxu-empress-liu-private-kill-guo');
  assert.equal(event.year,926);assert.ok(event.sourceDate.includes('闰十二月'));assert.ok(event.sourceDate.includes('正月'));
});

test('minimal revised full versions retain precise click units and unpunctuated text remains unclickable',async()=>{
  const chapters=loadPublishedChapters(loadLibrary());
  const cases=[['new-v14-p19',5,'罪责却归到了我身上'],['new-v14-p39',3,'存渥走到风谷时'],['old-v032-p7',0,'儿子彦超'],['old-v052-p15',3,'皇帝是您的叔父'],['tongjian-v272-p77',4,'贤能的宗亲']];
  for(const[id,index,expected]of cases){const chapter=chapters.find(c=>c.paragraphs.some(p=>p.id===id)),paragraph=chapter.paragraphs.find(p=>p.id===id);assert.ok(paragraph.translation.version>=2,id);const alignment=JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/'+chapter.id+'.json',import.meta.url)));const fetcher=async url=>String(url).includes('sentence-alignments')?Response.json(alignment):new Response('',{status:404});const parts=await readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,archiveBase:'/',fetcher});assert.equal(parts.map(p=>p.original).join(''),paragraph.original);assert.equal(parts[index].kind,'sentence');assert.ok(parts[index].translation.includes(expected),id);}
  const paragraph=chapters.find(c=>c.id==='beimeng-v018').paragraphs.find(p=>p.id==='beimeng-v018-p13');assert.ok(paragraph.translation.text.includes('到风谷时，李存渥被部下杀死'));const parts=await readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,archiveBase:'/',fetcher:async()=>new Response('',{status:404})});assert.equal(parts.length,1);assert.equal(parts[0].kind,'unavailable');assert.equal(parts[0].translation,null);
});
