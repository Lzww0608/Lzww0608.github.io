import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import {catalogPeople} from '../src/person-catalog.ts';import {personSearchNames} from '../src/person-search-names.ts';
import {personRelationships,relationshipsForPerson} from '../src/relationships.ts';import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
const root=new URL('../../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),maid='tang-li-siyuan-palace-timekeeper-unnamed',wang='tang-li-siyuan-shufei-wang';
const kind=(id,pid)=>read('content/person-passages/index.json').passages.find(p=>p.id==='passage-'+pid)?.people.find(p=>p.personId===id)?.kind;
test('unnamed palace timekeeper retains two source roles, month precision and the old/new reply difference without inheriting six-palaces actions',()=>{
 const p=catalogPeople.find(p=>p.id===maid);assert.ok(p);assert.deepEqual(read('content/person-passages/rules.json').people.find(p=>p.personId===maid).names,['明宗守漏宮女','明宗知漏宮女']);assert.match(p.name,/失名/);assert.equal(kind(maid,'new-v15-p28'),'record');assert.equal(kind(maid,'old-v044-p12'),'record');
 const doc=read('content/person-timelines/'+maid+'.json');assert.equal(doc.events.length,1);const e=doc.events[0];assert.equal(e.year,933);assert.equal(e.precision,'month');assert.equal(e.yearRange,undefined);
 assert.deepEqual(e.evidence.map(p=>p.paragraphId),['old-v044-p12','old-v044-p1','old-v044-p11']);assert.equal(e.variants.length,1);assert.deepEqual(e.variants[0].evidence.map(p=>p.paragraphId),['new-v15-p28']);assert.match(e.summary,/旧纪.*省/);assert.match(e.variants[0].summary,/吾不知也/);
 const links=personRelationships.filter(r=>r.from===maid||r.to===maid);assert.equal(links.length,1);assert.equal(links[0].kind,'service');assert.equal(links[0].from,'li-siyuan');assert.equal(links[0].to,maid);assert.deepEqual(links[0].sources.map(p=>p.paragraphId),['new-v15-p28','old-v044-p12']);assert.ok(relationshipsForPerson('li-siyuan').some(r=>r.id===links[0].id));
});
test('Wang crisis adds two source records to the same existing event while only the local LiuZhi false association is removed',()=>{
 assert.equal(kind(wang,'new-v15-p28'),'record');assert.equal(kind(wang,'new-v15-p29'),'record');const doc=read('content/person-timelines/'+wang+'.json');assert.ok(doc.events.length>=19);const e=doc.events.find(e=>e.id===wang+'-congrong-crisis');assert.ok(e);assert.ok(e.evidence.length>=4);assert.deepEqual(e.evidence.slice(2).map(p=>p.paragraphId),['new-v15-p28','new-v15-p29']);
 assert.equal(kind('liu-yan-southern-han','old-v044-p12'),undefined);assert.ok(personSearchNames('liu-yan-southern-han').some(n=>n==='刘陟'||n==='劉陟'));
 assert.ok(read('content/person-timelines/liu-yan-southern-han.json').events.length>=17);assert.ok(read('content/person-timelines/li-siyuan.json').events.length>=99);
});
test('current shared popup uses the actual appended p71 full parent and both Unicode-aligned units, with no original-text supplementation',async()=>{
 const chapter=read('frontend/public/history/chapters/tongjian-v278.json'),p=chapter.paragraphs.find(p=>p.id==='tongjian-v278-p71');assert.ok(p?.translation);assert.notEqual(String(p.translation.id),'4628');assert.equal(p.translation.version,2);assert.equal(p.original,'庚辰，改慎州懷化軍。置保順軍於洮州，領洮、鄯等州。');
 const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher:async url=>new Response(fs.readFileSync(new URL('frontend/public'+new URL(String(url),'https://fs.invalid').pathname,root)))});
 assert.equal(parts.length,2);assert.ok(parts.every(p=>p.kind==='sentence'));assert.equal(parts[0].translation,'庚辰，更改慎州怀化军的军号。');assert.equal(parts[1].translation,'在洮州设置保顺军，领洮州、鄯州等州。');assert.equal(parts.map(p=>p.translation).join(''),p.translation.text);assert.equal(p.translation.reviewNotes.length,1);assert.match(p.translation.reviewNotes[0],/旧五代史/);assert.match(p.translation.reviewNotes[0],/不.*补定/);
});
