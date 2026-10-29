// Regression coverage for the source-bound Zhou Shizong unnamed daughter.
// Uses public catalog, reading, timeline and reciprocal relationship functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadLibrary} from '../../content/library.mjs';
import {loadPublishedChapters} from '../../content/translations.mjs';
import {loadPassagePeople,loadPersonPassageIndex} from '../../content/person-passages.mjs';
import {loadPersonTimelines} from '../../content/person-timelines.mjs';
import {filterSearch} from '../src/data.ts';
import {personRelationships,relationshipsForPerson,searchRelationshipNodes} from '../src/relationships.ts';
import {readSentenceTranslationParts} from '../src/sentence-translations-loader.ts';

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const daughter='zhou-shizong-unnamed-daughter-959',father='chai-rong',paragraphId='old-v119-p6';
const sourceSha='04e34285dc8a4f013d5d40f05978f178f5150fc38149fbf311fc587637153f38';
const quote='丙子，以皇女薨輟朝三日。';
const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,normalize(v)])):value;
const objectSha=value=>createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');

test('the qualified unnamed imperial daughter is unique without an invented surname, mother, rank or title',()=>{
 const profile=read('content/five-dynasties/palace-people.json').people.find(p=>p.id===daughter);assert.ok(profile);
 assert.equal(profile.name,'周世宗失名皇女（显德六年见载）');assert.equal(profile.dynasty,'后周');
 assert.match(profile.intro,/姓名、排行、生母和封号未载/);assert.match(profile.intro,/确切卒日未详/);
 const canonical=loadPassagePeople();assert.equal(canonical.filter(p=>p.id===daughter).length,1);
 for(const query of ['周世宗失名皇女（显德六年见载）','周世宗失名皇女（顯德六年見載）'])for(const search of [filterSearch,searchRelationshipNodes])assert.deepEqual(search(query).map(p=>p.id),[daughter],query);
 const names=read('content/person-passages/rules.json').people.find(p=>p.personId===daughter).names;
 for(const bare of ['皇女','公主','柴氏','郭氏'])assert.ok(!names.includes(bare),bare);
});

test('only the closed annal record is attributed and the single father-daughter edge derives both endpoints',async()=>{
 const index=loadPersonPassageIndex(),found=index.passages.filter(p=>p.people.some(w=>w.personId===daughter));
 assert.equal(found.length,1);assert.deepEqual(found[0].spans.map(s=>s.paragraphId),[paragraphId]);
 assert.equal(found[0].people.find(p=>p.personId===daughter).kind,'record');
 const expectedId=daughter+'-father-chai-rong',edges=personRelationships.filter(e=>e.id===expectedId);assert.equal(edges.length,1);
 const edge=edges[0];assert.deepEqual([edge.from,edge.to,edge.kind,edge.label],[father,daughter,'kinship','史载父女']);
 for(const id of [father,daughter])assert.equal(relationshipsForPerson(id).filter(e=>e.id===expectedId).length,1);
 assert.deepEqual(relationshipsForPerson(daughter).map(e=>e.id),[expectedId],'no mother, spouse or invented sibling edge');
 assert.deepEqual(edge.sources.map(s=>[s.chapterId,s.paragraphId,s.excerpt]),[['old-v119',paragraphId,quote]]);
 const p=loadPublishedChapters(loadLibrary()).find(c=>c.id==='old-v119').paragraphs.find(p=>p.id===paragraphId);
 assert.equal(createHash('sha256').update(p.original).digest('hex'),sourceSha);assert.equal(p.revision,1);assert.equal(p.translation.id,'6850');assert.equal(p.translation.version,1);
 assert.equal(createHash('sha256').update(p.translation.text).digest('hex'),'5c09ccf7faac25dcef948d47589d8727e7d219c4ed74bf0d81faff08cd40766d');
 const fetcher=async url=>{const match=/\/(sentence-alignments|sentence-translations)\/([a-z]+-v\d+)\.json$/.exec(String(url));assert.ok(match,String(url));const rel=match[1]==='sentence-alignments'?'content/sentence-alignments/chapters/':'content/published-sentence-translations/';try{return Response.json(read(rel+match[2]+'.json'));}catch(error){if(error.code==='ENOENT')return new Response('',{status:404});throw error;}};
 const parts=await readSentenceTranslationParts({paragraph:p,displayedOriginal:p.original,fetcher});
 assert.equal(parts[1].original,quote);assert.equal(parts[1].kind,'sentence');assert.equal(parts[1].translation,'丙子，因皇女去世，停朝三日。');
});

test('one real court-mourning occurrence has no asserted death day and preserves all 96 old father events except four exact sorts',()=>{
 const timelines=loadPersonTimelines(),woman=timelines.find(p=>p.personId===daughter),man=timelines.find(p=>p.personId===father);assert.ok(woman&&man);
 assert.equal(woman.events.length,1);const event=woman.events[0];
 assert.deepEqual([event.year,event.precision,event.sourceDate],[959,'month','显德六年六月丙子（辍朝记日）']);
 assert.match(event.summary,/丙子为辍朝记日，皇女确切卒日未详/);
 assert.ok(event.evidence.some(e=>e.paragraphId===paragraphId&&e.originalSha256===sourceSha&&e.excerpt===quote));
 assert.ok(event.notes.some(n=>n.includes('不补皇女的确切死亡日')));
 assert.equal(man.events.length,97);const added=man.events.find(e=>e.id==='chai-rong-mourn-unnamed-daughter');assert.ok(added);assert.equal(added.sortOrder,89);
 assert.deepEqual([added.year,added.precision,added.sourceDate,added.evidence],[event.year,event.precision,event.sourceDate,event.evidence]);
 const oldSorts={'chai-rong-second-fu-and-sons':89,'chai-rong-zhao-dianjian':90,'chai-rong-death':91,'chai-rong-posthumous-title-burial':92};
 const restored=structuredClone(man);restored.events=restored.events.filter(e=>e.id!==added.id);
 // The later complete Southern Tang annal adds one precisely reviewed source variant.
 // Remove only that exact object when reconstructing the earlier release's document.
 const chuzhou=restored.events.find(e=>e.id==='chai-rong-chuzhou-capture');
 const laterVariants=chuzhou.variants.filter(v=>v.label==='本纪丁未克楚及所引军十万疑义');assert.equal(laterVariants.length,1);
 assert.equal(objectSha(laterVariants[0]),'f70760ab080f75ffed49981441a5c09b875c10ff80de922f93126fd7401d09e5');
 chuzhou.variants=chuzhou.variants.filter(v=>v!==laterVariants[0]);
 if(!chuzhou.variants.length)delete chuzhou.variants;
 // The accession memorial is a later, explicitly sourced retrospective append.
 // Check its exact contents before removing it from this historical baseline.
 const peace=restored.events.find(e=>e.id==='chai-rong-jiangbei-peace');assert.ok(peace);
 assert.deepEqual(peace.evidence.at(-1),{chapterId:'shiguochunqiu-v017',paragraphId:'shiguochunqiu-v017-p3',originalRevision:1,originalSha256:'e70de9713716323017593c055b2dc69097d1d459a0c486b6ff91ef6168358de5',excerpt:'臣亡兄文獻太子從冀將從內禪，已決宿心，而世宗敦勸既深，議言因息。'});
 assert.deepEqual(peace.notes,['《十国春秋》卷十七夹引《宋史》所载李煜建隆二年承位表，追述元宗欲内禅及周世宗劝止。表文作“从冀”，《十国春秋》元宗本纪与《通鉴》作“弘冀”，各从其本；建隆二年是上表语境，所述议论发生在此前。']);
 peace.evidence.pop();delete peace.notes;
 // SG22 later adds exactly one side account to the return of Bian Hao.
 // Verify the entire append before restoring this event's former absence of variants.
 const returned=restored.events.find(e=>e.id==='chai-rong-return-militia-farm');assert.ok(returned);
 assert.deepEqual(returned.variants,[{
  label:'边镐传的被俘、授职及请盟后归还',
  sourceDate:'本传十四年起叙援寿、被俘，后接割淮请盟归镐；各阶段未独记同年同日',
  summary:'边镐传记周世宗授被俘边镐右千牛卫上将军，割淮请盟后归还边镐。这是被俘、授职、议和后归还的多阶段叙事，不能全定在十四年；本条仅取边镐归还的旁证，不将其移贴为皇甫晖、姚凤等人的处置。',
  evidence:[{chapterId:'shiguochunqiu-v022',paragraphId:'shiguochunqiu-v022-p8',originalRevision:1,
   originalSha256:'5f57e2f7654c388ef179861802c6e3b22b0f4d53023f0f186364186d94632e0b',
   excerpt:'十四年，周師入犯，齊王景達爲元帥，出兵援壽州，起鎬爲大將，偕許文稹從行。會朱元叛去，諸軍皆潰，鎬與文稹被執，周世宗命爲右千牛衛上將軍。及割淮南請盟，乃歸鎬。'}],
 }]);
 delete returned.variants;
 // H109 adds one Lu13 account and its date/agency note to the existing
 // non-surrender variant. Verify both exact appends before restoring the past.
 const shouzhou=restored.events.find(e=>e.id==='chai-rong-shouzhou-settlement');assert.ok(shouzhou);
 const nonSurrender=shouzhou.variants.filter(v=>v.label==='新史与考异：仁赡实不降');assert.equal(nonSurrender.length,1);
 const account=nonSurrender[0];assert.equal(account.evidence.length,3);
 assert.equal(objectSha(account.evidence.at(-1)),'54d038257b13a9615df915f7e767bad35d742e99c699d5fbb81920238fd31544','exact Lu13 source identity, revision, SHA and complete excerpt');
 assert.deepEqual([account.evidence.at(-1).chapterId,account.evidence.at(-1).paragraphId],['nantanglu-v013','nantanglu-v013-p3']);
 assert.deepEqual(account.notes,['陆游本传记仁赡病危不知人、周廷构和孙羽等代为表请降，并叙甲辰、戊申、辛亥；与旧史丙午至辛亥及新史丁未等日期各存，不据相近日号强配同日。']);
 account.evidence.pop();delete account.notes;
 assert.equal(objectSha(shouzhou),'4395588c3099e15682918d982b3391105319dd82e9ad89c20844a9d44c050b71','whole pre-H109 event after only the two approved appends are removed');
 for(const [id,sort]of Object.entries(oldSorts)){const old=restored.events.find(e=>e.id===id);assert.ok(old,id);assert.equal(old.sortOrder,sort+1,id);old.sortOrder=sort;}
 assert.equal(restored.events.length,96);assert.equal(objectSha(restored),'8fe653272b69777e0b677e15070813b7ca1b18eb0663d966f0781c4bcd854ce7','whole pre-batch document including all 96 IDs, metadata and source objects');
});
