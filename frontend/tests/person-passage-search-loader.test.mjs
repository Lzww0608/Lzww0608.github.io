import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { readPersonPassages } from '../src/person-passages-loader.ts';
import { parsePersonPassagesPage } from '../src/person-passages-schema.ts';
import { loadPassageSearch } from '../src/passage-search.ts';
import { catalogPeople } from '../src/person-catalog.ts';
const library=loadLibrary(), all=loadPublishedChapters(library), personId='li-cunxin';
const chapters=new Map(all.map(c=>[c.id,structuredClone(c)]));
const originals=all.filter(c=>c.bookId==='old').flatMap(c=>c.paragraphs.map(p=>({chapter:c,p}))).slice(0,60);
const hash=t=>createHash('sha256').update(t).digest('hex');
const index={schemaVersion:1,scope:'current-archive',coverage:{bookCount:9,chapterCount:183,paragraphCount:7934},people:catalogPeople.map(p=>({id:p.id,name:p.name})),passages:originals.map(({chapter,p},i)=>{
  const local=chapters.get(chapter.id).paragraphs.find(v=>v.id===p.id);local.translation.text=i===50||i===59?'检索𠀀白话命中。':'普通白话。';
  return {id:`passage-${p.id}`,title:`${chapter.title} · 第${p.position}段`,chapterId:chapter.id,spans:[{paragraphId:p.id,originalRevision:p.revision,originalSha256:hash(p.original),start:0,end:[...p.original].length}],people:[{personId,kind:'record'}]};
})};
const options={personId,bookId:'old',query:'檢索',field:'translation',limit:1,apiBase:'',archiveBase:'/',signal:new AbortController().signal};
const archive=async url=>{if(url.endsWith('person-passages.json'))return Response.json(index);const id=/chapters\/([^/]+)\.json$/.exec(url)?.[1];return id&&chapters.has(id)?Response.json(chapters.get(id)):new Response('',{status:503});};

test('offline search examines all person records before pagination and matches either script in translations',async()=>{
  const before=JSON.stringify([...chapters]);
  const first=await readPersonPassages({...options,fetcher:archive});assert.equal(first.page.total,2);assert.equal(first.page.nextCursor,'1');assert.equal(first.page.items[0].id,index.passages[50].id);
  const second=await readPersonPassages({...options,cursor:'1',fetcher:archive});assert.equal(second.page.items[0].id,index.passages[59].id);assert.equal(second.page.nextCursor,null);assert.equal(second.page.resultSetRevision,first.page.resultSetRevision);
  assert.equal(first.page.search.query,'檢索');assert.deepEqual(first.page.items[0].searchMatches[0].translation,[{start:0,end:2}]);assert.deepEqual(first.page.items[0].searchMatches[0].original,[]);
  const simplified=await readPersonPassages({...options,query:'检索',fetcher:archive});assert.equal(simplified.page.total,2);assert.notEqual(simplified.page.resultSetRevision,first.page.resultSetRevision);
  assert.equal(JSON.stringify([...chapters]),before);
});
test('book and field filters restrict the complete result set; absent matches have an explicit empty page',async()=>{
  for(const value of [{bookId:'new'},{field:'original'},{query:'不存在的查询'}]){const r=await readPersonPassages({...options,...value,fetcher:archive});assert.equal(r.page.total,0);assert.deepEqual(r.page.items,[]);assert.equal(r.page.nextCursor,null);}
});
test('latest verified API results win, including authoritative zero matches and suspended associations',async()=>{
  const saved=(await readPersonPassages({...options,fetcher:archive})).page;
  const empty={...saved,total:0,unavailableCount:2,items:[],nextCursor:null,resultSetRevision:hash('paused')};
  const log=[];const r=await readPersonPassages({...options,apiBase:'https://api.example',fetcher:async(url,init)=>{log.push(url);assert.equal(init.credentials,'omit');return url.startsWith('https://api.example')?Response.json(empty):archive(url);}});
  assert.equal(r.source,'api');assert.equal(r.page.total,0);assert.equal(r.page.unavailableCount,2);assert.ok(log.some(url=>url.includes('q=%E6%AA%A2%E7%B4%A2')&&url.includes('field=translation')));
});
test('forged or stale query/ranges and invalid successful API JSON cannot revive an archived search',async()=>{
  const saved=(await readPersonPassages({...options,fetcher:archive})).page;
  for(const mutate of [p=>p.search.query='另一个查询',p=>p.search.field='both',p=>p.items[0].searchMatches[0].translation[0].end++,p=>p.items[0].paragraphs[0].translation.text='不再命中']){
    const bad=structuredClone(saved);mutate(bad);await assert.rejects(parsePersonPassagesPage(bad,personId,'old','0',1,{query:'檢索',field:'translation'}));
    await assert.rejects(readPersonPassages({...options,apiBase:'https://api.example',fetcher:url=>url.startsWith('https://api.example')?Promise.resolve(Response.json(bad)):archive(url)}),/verified/);
  }
  await assert.rejects(readPersonPassages({...options,apiBase:'https://api.example',fetcher:url=>url.startsWith('https://api.example')?Promise.resolve(new Response('{bad')):archive(url)}),/verified/);
});
test('valid range JSON key ordering is immaterial; archive snapshots include published text/version changes',async()=>{
  const saved=(await readPersonPassages({...options,fetcher:archive})).page;
  saved.items[0].searchMatches=saved.items[0].searchMatches.map(m=>({translation:m.translation.map(r=>({end:r.end,start:r.start})),original:m.original,paragraphId:m.paragraphId}));
  await parsePersonPassagesPage(saved,personId,'old','0',1,{query:'檢索',field:'translation'});
  const before=saved.resultSetRevision,local=chapters.get(originals[50].chapter.id).paragraphs.find(p=>p.id===originals[50].p.id),text=local.translation.text;
  try{local.translation.version++;local.translation.text+='后来校订。';const newer=await readPersonPassages({...options,fetcher:archive});assert.notEqual(newer.page.resultSetRevision,before);}finally{local.translation.version--;local.translation.text=text;}
});
test('aborted navigation and invalid input cannot populate another query',async()=>{
  const controller=new AbortController(),events=[];
  await assert.rejects(readPersonPassages({...options,signal:controller.signal,onArchive:p=>events.push(p),fetcher:async url=>{controller.abort();return archive(url);}}),e=>e.name==='AbortError');assert.deepEqual(events,[]);
  for(const query of ['x'.repeat(101),'\n检索'])await assert.rejects(readPersonPassages({...options,query,fetcher:archive}));
  assert.ok((await loadPassageSearch()).findRanges('天地乾坤。','乾').some(r=>r.start===2&&r.end===3));
});
