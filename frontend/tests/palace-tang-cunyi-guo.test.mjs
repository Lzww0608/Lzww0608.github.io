import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {catalogPeople} from '../src/person-catalog.ts';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {relationshipsForPerson,relationshipNodes} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';
const id='tang-cunyi-wife-guo';
test('Cunyi wife Guo keeps one direct marriage and three source-qualified kinship mentions without Yang wife deeds',()=>{
 const person=catalogPeople.find(p=>p.id===id);assert.ok(person);assert.equal(person.birthYear,undefined);assert.equal(person.deathYear,undefined);
 const rows=loadPersonPassageIndex().passages.filter(p=>p.people.some(q=>q.personId===id));assert.equal(rows.length,4);
 assert.deepEqual(rows.flatMap(p=>p.spans.map(s=>[s.paragraphId,p.people.find(q=>q.personId===id).kind])).sort(),[['new-v14-p38','record'],['old-v034-p2','mention'],['beimeng-v018-p5','mention'],['tongjian-v274-p41','mention']].sort());
 const events=loadPersonTimelines().find(d=>d.personId===id).events;assert.equal(events.length,1);assert.equal(events[0].year,null);assert.equal(events[0].precision,'undated');assert.deepEqual(events[0].evidence.map(s=>s.paragraphId),['new-v14-p38']);
 assert.ok(person.sourceNotes.some(n=>/杨千郎/.test(n)&&/不是|不归/.test(n)));assert.ok(person.sourceNotes.some(n=>/周氏/.test(n)&&/未|不/.test(n)));
 assert.ok(person.sourceNotes.some(n=>/族|受刑/.test(n)&&/不|未/.test(n)));assert.ok(!events.some(e=>/宫禁|受宠|求官|被杀|死亡/.test(e.title)));
});
test('Guo daughter graph reuses the father and limits husband context to two reciprocal kinship edges',()=>{
 const edges=relationshipsForPerson(id);assert.equal(edges.length,2);assert.ok(edges.every(e=>e.kind==='kinship'));
 assert.deepEqual(edges.map(e=>[e.from,e.to,e.label]).sort(),[['guo-chongtao',id,'父女'],['li-cunyi',id,'夫妻']].sort());
 for(const e of edges)for(const who of[e.from,e.to])assert.ok(relationshipsForPerson(who).some(x=>x.id===e.id));
 const husband=relationshipNodes.find(n=>n.id==='li-cunyi');assert.ok(husband?.external);assert.ok(husband.note.includes('其母姓名号位未明'));
 assert.ok(!edges.some(e=>/周氏|杨千郎/.test(e.label)||e.kind==='conflict'));assert.equal(catalogPeople.filter(p=>p.id==='guo-chongtao').length,1);
});
test('new history popup binds the actual revised parent and six independent units without implying every clan member died',async()=>{
 const chapter=JSON.parse(fs.readFileSync(new URL('../public/history/chapters/new-v14.json',import.meta.url))),p=chapter.paragraphs.find(p=>p.id==='new-v14-p38');assert.ok(p);assert.ok(p.translation.version>=2);
 const fetcher=async url=>{try{return new Response(fs.readFileSync(new URL('../public'+new URL(String(url),'https://static.test').pathname,import.meta.url)));}catch{return new Response('',{status:404});}};
 const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher});assert.equal(parts.length,6);assert.ok(parts.every(u=>u.kind==='sentence'));
 assert.match(parts[4].translation,/等郭崇韬遭到族诛/);assert.ok(!parts[4].translation.includes('郭崇韬全族被诛'));assert.equal(parts.map(u=>u.original).join(''),p.original);assert.equal(parts.map(u=>u.translation).join(''),p.translation.text);
 assert.ok(p.translation.reviewNotes.some(n=>n.startsWith('“其妻”承杨千郎')));assert.ok(p.translation.reviewNotes.some(n=>/周氏/.test(n)&&/不据族诛/.test(n)));
});
