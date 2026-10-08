import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { catalogPeople } from '../src/person-catalog.ts';
import { personSourcesRoute, resolvePersonSourcesRoute, resolveRoute } from '../src/library.ts';
import { readPersonPassages } from '../src/person-passages-loader.ts';
import { parsePersonPassageIndex, parsePersonPassagesPage } from '../src/person-passages-schema.ts';
import { matchesPassagePageBaseline } from '../src/person-passages-pagination.ts';

const library=loadLibrary();
const chapters=new Map(loadPublishedChapters(library).map(chapter=>[chapter.id,chapter]));
const personId='li-cunxin';
const coverage={bookCount:library.catalog.books.length,chapterCount:library.chapters.length,paragraphCount:library.chapters.reduce((sum,chapter)=>sum+chapter.paragraphs.length,0)};
const hash=text=>createHash('sha256').update(text).digest('hex');
function entry(chapterId,position,id=personId,kind='record') {
  const chapter=chapters.get(chapterId);const paragraph=chapter.paragraphs.find(value=>value.position===position);
  return {id:`passage-${paragraph.id}`,chapterId,title:`${chapter.title} · 第${position}段`,spans:[{paragraphId:paragraph.id,originalRevision:paragraph.revision,originalSha256:hash(paragraph.original),start:0,end:Array.from(paragraph.original).length}],people:[{personId:id,kind}]};
}
const index={schemaVersion:1,scope:'current-archive',coverage,people:catalogPeople.map(person=>({id:person.id,name:person.name})),passages:[entry('new-v06',2),entry('new-v36',17,personId,'biography'),entry('new-v06',1,'li-siyuan','biography')]};
function passage(location) {
  const chapter=chapters.get(location.chapterId);const association=location.people.find(person=>person.personId===personId);
  return {...location,kind:association.kind,bookId:chapter.bookId,bookTitle:chapter.bookTitle,chapterTitle:chapter.title,chapterPosition:chapter.position,edition:chapter.edition,sourceUrl:chapter.sourceUrl,paragraphs:location.spans.map(span=>chapter.paragraphs.find(paragraph=>paragraph.id===span.paragraphId))};
}
const page={schemaVersion:1,scope:'current-archive',personId,bookId:'new',coverage,total:2,unavailableCount:0,resultSetRevision:hash(index.passages.slice(0,2).map(item=>item.id).join('\n')),nextCursor:null,items:index.passages.slice(0,2).map(passage)};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function archiveFetcher(log=[],manifest=index) {
  return async url=>{
    log.push(String(url));
    if(String(url).endsWith('person-passages.json'))return json(manifest);
    const id=/chapters\/([^/]+)\.json$/.exec(String(url))?.[1];
    return id&&chapters.has(id)?json(chapters.get(id)):new Response('',{status:503});
  };
}
const options={personId,bookId:'new',apiBase:'',archiveBase:'/',signal:new AbortController().signal};

test('person source routes preserve valid book-specific and all-book summaries without restoring retired routes',()=>{
  assert.equal(personSourcesRoute(personId,'new'),'person-sources/li-cunxin/new');
  assert.equal(resolveRoute('#person-sources/li-cunxin/new'),'person-sources/li-cunxin/new');
  assert.equal(resolvePersonSourcesRoute(personSourcesRoute(personId)).person.id,personId);
  assert.equal(resolvePersonSourcesRoute('person-sources/li-cunxin/new').book.id,'new');
  for(const route of ['person-sources/missing/new','person-sources/li-cunxin/missing','person-sources/li-cunxin/new/extra','sources','map'])assert.equal(resolveRoute(`#${route}`),'people');
});

test('offline summaries select only indexed person passages, including records in another person biography',async()=>{
  const log=[];const result=await readPersonPassages({...options,fetcher:archiveFetcher(log)});
  assert.equal(result.source,'archive');assert.equal(result.page.total,2);
  assert.deepEqual(result.page.items.map(item=>item.chapterId),['new-v06','new-v36']);
  assert.deepEqual(result.page.items.flatMap(item=>item.paragraphs.map(p=>p.id)),['new-v06-p2','new-v36-p17']);
  assert.ok(result.page.items.every(item=>item.paragraphs.every(p=>p.translation?.text)));
  assert.equal(result.page.items.some(item=>item.paragraphs.some(p=>p.id==='new-v06-p1')),false);
  assert.equal(log.filter(url=>url.endsWith('new-v06.json')).length,1);
});

test('archive pagination requests just the selected page and uses stable original positions',async()=>{
  const firstLog=[];const first=await readPersonPassages({...options,limit:1,fetcher:archiveFetcher(firstLog)});
  assert.equal(first.page.nextCursor,'1');assert.equal(first.page.items[0].paragraphs[0].id,'new-v06-p2');
  assert.equal(firstLog.some(url=>url.endsWith('new-v36.json')),false);
  const second=await readPersonPassages({...options,cursor:'1',limit:1,fetcher:archiveFetcher()});
  assert.equal(second.page.nextCursor,null);assert.equal(second.page.items[0].paragraphs[0].id,'new-v36-p17');
});

test('latest valid API translations replace the matching archived page without writing any content',async()=>{
  const live=structuredClone(page);live.items[0].paragraphs[0].translation.text='测试用最新公开译文';live.items[0].paragraphs[0].translation.version++;
  const log=[];const staticFetch=archiveFetcher(log);const callback=[];
  const result=await readPersonPassages({...options,apiBase:'https://history.example',onArchive:value=>callback.push(value),fetcher:async(url,init)=>{
    assert.equal(init.credentials,'omit');
    return String(url).startsWith('https://history.example')?json(live):staticFetch(url);
  }});
  assert.equal(result.source,'api');assert.equal(result.page.items[0].paragraphs[0].translation.text,'测试用最新公开译文');
  assert.equal(callback.length,1);assert.notEqual(callback[0].items[0].paragraphs[0].translation.text,'测试用最新公开译文');
});

test('wrong-person, wrong-book and stale-source API responses cannot replace a valid static summary',async()=>{
  for(const mutate of [value=>value.personId='li-siyuan',value=>value.bookId='old',value=>value.items[0].paragraphs[0].original+='改字',value=>value.items[0].spans[0].originalRevision++]){
    const invalid=structuredClone(page);mutate(invalid);const staticFetch=archiveFetcher();
    const result=await readPersonPassages({...options,apiBase:'https://history.example',fetcher:url=>String(url).startsWith('https://history.example')?json(invalid):staticFetch(url)});
    assert.equal(result.source,'archive');assert.equal(result.page.items[0].paragraphs[0].original,chapters.get('new-v06').paragraphs[1].original);
  }
});

test('unavailable associations and their unpublished translations are not rebuilt from the archive after a successful API response',async()=>{
  const live={...page,total:0,unavailableCount:2,resultSetRevision:hash(''),items:[]};const staticFetch=archiveFetcher();
  const result=await readPersonPassages({...options,apiBase:'https://history.example',fetcher:url=>String(url).startsWith('https://history.example')?json(live):staticFetch(url)});
  assert.equal(result.source,'api');assert.equal(result.page.items.length,0);assert.equal(result.page.unavailableCount,2);
});

test('partial ranges, duplicate identities, invalid pagination and changed snapshot sources are rejected',async()=>{
  const partial=structuredClone(page);partial.items[0].spans[0].start=1;
  await assert.rejects(parsePersonPassagesPage(partial,personId,'new'));
  const duplicate=structuredClone(index);duplicate.passages.push(duplicate.passages[0]);assert.throws(()=>parsePersonPassageIndex(duplicate));
  const wrongPerson=structuredClone(index);wrongPerson.passages[0].people[0].personId='missing';assert.throws(()=>parsePersonPassageIndex(wrongPerson));
  for(const cursor of ['-1','1.5','NaN','9007199254740992'])await assert.rejects(readPersonPassages({...options,cursor,fetcher:archiveFetcher()}));
  const staticFetch=archiveFetcher();
  await assert.rejects(readPersonPassages({...options,fetcher:async url=>{
    if(String(url).endsWith('new-v06.json')){const modified=structuredClone(chapters.get('new-v06'));modified.paragraphs[1].original+='改字';return json(modified);}
    return staticFetch(url);
  }}));
});

test('aborted navigation cannot publish an archived or API page into another person view',async()=>{
  const controller=new AbortController();const callbacks=[];const staticFetch=archiveFetcher();
  const pending=readPersonPassages({...options,signal:controller.signal,onArchive:value=>callbacks.push(value),fetcher:async url=>{controller.abort();return staticFetch(url);}});
  await assert.rejects(pending,error=>error.name==='AbortError');assert.deepEqual(callbacks,[]);
});

test('truncated pages, unknown source links and repeated whole paragraphs cannot masquerade as complete summaries',async()=>{
  const truncated=structuredClone(page);truncated.items.pop();
  await assert.rejects(parsePersonPassagesPage(truncated,personId,'new'));
  for(const sourceUrl of ['data:text/html,untrusted','javascript:alert(1)','https://untrusted.example/history']){
    const unknown=structuredClone(page);unknown.items[0].sourceUrl=sourceUrl;
    await assert.rejects(parsePersonPassagesPage(unknown,personId,'new'));
  }
  const repeated=structuredClone(page);repeated.items[1]={...structuredClone(repeated.items[0]),id:'passage-duplicate'};
  await assert.rejects(parsePersonPassagesPage(repeated,personId,'new'));
  const repeatedIndex=structuredClone(index);repeatedIndex.passages.push({...structuredClone(repeatedIndex.passages[0]),id:'passage-duplicate'});
  assert.throws(()=>parsePersonPassageIndex(repeatedIndex));
});

test('the static result-set revision is stable across pages and records index membership changes',async()=>{
  const first=await readPersonPassages({...options,limit:1,fetcher:archiveFetcher()});
  const second=await readPersonPassages({...options,limit:1,cursor:'1',fetcher:archiveFetcher()});
  assert.equal(first.page.resultSetRevision,second.page.resultSetRevision);
  const changed=structuredClone(index);changed.passages[0].people=[{personId:'li-siyuan',kind:'record'}];
  const updated=await readPersonPassages({...options,fetcher:archiveFetcher([],changed)});
  assert.notEqual(first.page.resultSetRevision,updated.page.resultSetRevision);
});

test('pagination keeps its offset only for the same person, book, source and complete result set',()=>{
  const baseline={target:'li-cunxin/new',source:'api',resultSetRevision:page.resultSetRevision};
  assert.equal(matchesPassagePageBaseline(baseline,baseline.target,'api',baseline.resultSetRevision),true);
  assert.equal(matchesPassagePageBaseline(baseline,baseline.target,'archive',baseline.resultSetRevision),false);
  assert.equal(matchesPassagePageBaseline(baseline,baseline.target,'api',hash('other results')),false);
  assert.equal(matchesPassagePageBaseline(baseline,'li-siyuan/new','api',baseline.resultSetRevision),false);
  assert.equal(matchesPassagePageBaseline(baseline,'li-cunxin/old','api',baseline.resultSetRevision),false);
  assert.equal(matchesPassagePageBaseline(null,baseline.target,'api',baseline.resultSetRevision),false);
});
