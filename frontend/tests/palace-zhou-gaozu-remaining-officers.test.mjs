import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {filterSearch} from '../src/data.ts';
import {relationshipsForPerson,searchRelationshipNodes} from '../src/relationships.ts';

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const li='zhou-guo-wei-shangshi-li',others=['zhou-guo-wei-shanggong-cao','zhou-guo-wei-siyao-lin','zhou-guo-wei-siyao-zhai'],ids=[li,...others];

test('qualified office searches do not merge the other Li and Wang source roles into these four entries',()=>{
 for(const query of ['后周尚食李氏','後周尚食李氏'])for(const search of [filterSearch,searchRelationshipNodes])assert.ok(search(query).some(p=>p.id===li));
 for(const query of ['后周典宝李氏','後周司正李氏','后周司衣李氏','後周司寶王氏','后周司正王氏'])for(const search of [filterSearch,searchRelationshipNodes])assert.ok(!search(query).some(p=>ids.includes(p.id)),query);
 const rules=read('content/person-passages/rules.json');for(const id of ids){const rule=rules.people.find(r=>r.personId===id);assert.ok(rule);for(const name of [...rule.names,...rule.shortNames,...rule.titles])assert.doesNotMatch(name,/^(?:[\p{Script=Han}]{1,2}氏|夫人|县君|縣君)$/u);}
});

test('the annal eight-person grant belongs to its named Shangshi Li without assigning Cao, Lin or Zhai',()=>{
 const index=loadPersonPassageIndex(),passage=index.passages.find(p=>p.spans.some(s=>s.paragraphId==='old-v111-p6'));assert.ok(passage);assert.equal(passage.people.find(p=>p.personId===li)?.kind,'record');assert.ok(!passage.people.some(p=>others.includes(p.personId)));
 for(const id of ids)assert.ok(index.passages.some(p=>p.spans.some(s=>s.paragraphId==='huiyao-v001-p53')&&p.people.some(p=>p.personId===id)));
});

test('the shared eighth-month edict remains enfeoffment evidence with reciprocal service relations',()=>{
 const docs=loadPersonTimelines(),reverse=relationshipsForPerson('guo-wei');for(const id of ids){const d=docs.find(d=>d.personId===id);assert.ok(d);assert.equal(d.events.length,1);const e=d.events[0];assert.equal(e.year,951);assert.equal(e.precision,'month');assert.match(e.sourceDate,/八月/);assert.equal(e.phase,'service');assert.ok(e.evidence.some(x=>x.paragraphId==='huiyao-v001-p53'&&x.excerpt==='並廣順元年八月敕。'));
  const edges=relationshipsForPerson(id);assert.equal(edges.length,1);assert.equal(edges[0].kind,'service');assert.deepEqual([edges[0].from,edges[0].to],['guo-wei',id]);assert.equal(reverse.filter(x=>x.id===edges[0].id).length,1);
 }
});
