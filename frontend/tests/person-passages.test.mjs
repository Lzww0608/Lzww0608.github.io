import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildPersonPassageIndex } from '../../scripts/index-person-passages.mjs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
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

test('Jin family names remain distinct from Liang general Li Chongyin and reject stale local exclusions', () => {
  const current = loadPersonPassageIndex(library);
  const ids = ['new-v17-p22', 'new-v17-p24', 'new-v17-p25', 'new-v17-p37', 'old-v086-p6'];
  for (const id of ids) {
    const passage = current.passages.find(p => p.spans.some(s => s.paragraphId === id));
    assert.ok(passage, id);
    assert.equal(passage.people.some(p => p.personId === 'li-chongyin'), false, id);
    assert.ok(passage.people.some(p => ['shi-jingtang', 'shi-chonggui'].includes(p.personId)), id);
  }
  assert.ok(current.passages.some(p => p.people.some(p => p.personId === 'li-chongyin')),
    'the Liang general retains his own records');
  const rules = JSON.parse(readFileSync(new URL('../../content/person-passages/rules.json', import.meta.url), 'utf8'));
  const exclusion = rules.titleExclusions.find(e => e.personId === 'li-chongyin' && e.paragraphId === ids[0]);
  assert.ok(exclusion);
  exclusion.originalSha256 = '0'.repeat(64);
  assert.throws(() => buildPersonPassageIndex(library, rules), /title exclusion version/);
});

test('Shi Chonggui records separate source citations and chapter footnotes from his acts and later accounts', () => {
  const current = loadPersonPassageIndex();
  const associated = (person, id) => current.passages.some(p => p.spans.some(s => s.paragraphId === id)
    && p.people.some(a => a.personId === person));
  for (const id of ['kaoyi-v030-p23', 'kaoyi-v030-p30', 'kaoyi-v030-p34', 'new-v09-p10', 'new-v09-p11'])
    assert.equal(associated('shi-chonggui', id), false, id);
  for (const id of ['kaoyi-v030-p41', 'tongjian-v282-p108', 'tongjian-v282-p109', 'tongjian-v283-p22',
    'tongjian-v288-p23', 'tongjian-v288-p83', 'tongjian-v289-p36', 'old-v112-p18',
    'huiyao-v020-p3', 'huiyao-v020-p4', 'huiyao-v020-p5', 'huiyao-v020-p11', 'huiyao-v018-p29'])
    assert.equal(associated('shi-chonggui', id), true, id);
  const fatherNote = current.passages.find(p => p.spans.some(s => s.paragraphId === 'new-v09-p10'));
  assert.ok(fatherNote);
  assert.equal(associated('shi-jingtang', 'new-v09-p10'), true);
  assert.equal(fatherNote.title.includes('晋出帝本纪'), false);
  assert.ok(chapters.get('new-v09').paragraphs.find(p => p.id === 'new-v09-p11')?.translation?.text,
    'excluding an irrelevant association preserves the full chapter and translation');
});

test('Liu Zhiyuan records distinguish cited book titles and Xiao Zhiyuan from source-bound deeds', () => {
  const index = loadPersonPassageIndex();
  const associated = id => index.passages.some(p => p.spans.some(s => s.paragraphId === id)
    && p.people.some(a => a.personId === 'liu-zhiyuan'));
  for (const id of ['tongjian-v293-p80', 'old-v080-p13', 'kaoyi-v028-p10', 'kaoyi-v030-p39'])
    assert.equal(associated(id), false, id);
  for (const id of ['new-v10-p9', 'tongjian-v288-p68', 'tongjian-v286-p76', 'tongjian-v287-p47',
    'tongjian-v287-p90', 'tongjian-v287-p96', 'tongjian-v288-p40', 'kaoyi-v030-p5', 'old-v102-p7', 'old-v102-p14'])
    assert.equal(associated(id), true, id);
});

test('Liu Chengyou records exclude Pan Chengyou and cited titles while retaining specific court acts', () => {
  const index = loadPersonPassageIndex();
  const associated = id => index.passages.some(p => p.spans.some(s => s.paragraphId === id)
    && p.people.some(a => a.personId === 'liu-chengyou'));
  for (const id of ['tongjian-v282-p98', 'tongjian-v283-p53', 'tongjian-v283-p63', 'tongjian-v293-p23',
    'kaoyi-v030-p30', 'kaoyi-v030-p48', 'kaoyi-v030-p50', 'kaoyi-v030-p57'])
    assert.equal(associated(id), false, id);
  for (const id of ['tongjian-v288-p40', 'tongjian-v288-p68', 'tongjian-v288-p92', 'tongjian-v289-p26',
    'tongjian-v289-p45', 'tongjian-v289-p46', 'tongjian-v289-p50', 'tongjian-v289-p51',
    'tongjian-v289-p61', 'kaoyi-v030-p58'])
    assert.equal(associated(id), true, id);
});

test('reviewed rulers keep actual deeds and continuous edicts while excluding book names and other rulers', () => {
  const current = loadPersonPassageIndex();
  const associated = (personId, paragraphId) => current.passages.some(passage =>
    passage.spans.some(span => span.paragraphId === paragraphId)
    && passage.people.some(person => person.personId === personId));
  for (const [personId, paragraphId] of [
    ['li-siyuan', 'huiyao-v018-p27'], ['li-siyuan', 'kaoyi-v029-p46'],
    ['guo-wei', 'old-v116-p2'], ['guo-wei', 'kaoyi-v030-p40'],
    ['shi-jingtang', 'tongjian-v282-p8'], ['shi-jingtang', 'new-v66-p43'],
  ]) assert.equal(associated(personId, paragraphId), false, `${personId}/${paragraphId}`);
  for (const [personId, paragraphId] of [
    ['li-siyuan', 'beimeng-v019-p33'], ['li-siyuan', 'beimeng-v019-p37'],
    ['guo-wei', 'tongjian-v291-p88'], ['guo-wei', 'huiyao-v015-p48'],
    ['guo-wei', 'huiyao-v027-p14'], ['guo-wei', 'huiyao-v020-p11'],
    ['guo-wei', 'huiyao-v026-p20'], ['guo-wei', 'huiyao-v003-p29'],
    ['shi-jingtang', 'huiyao-v002-p5'],
    ['shi-jingtang', 'new-v25-p21'],
  ]) assert.equal(associated(personId, paragraphId), true, `${personId}/${paragraphId}`);
  assert.equal(associated('guo-wei', 'huiyao-v027-p15'), false);
  assert.equal(associated('guo-wei', 'huiyao-v020-p12'), false);
  assert.equal(associated('guo-wei', 'huiyao-v007-p37'), false);
  assert.equal(associated('guo-wei', 'huiyao-v026-p21'), false);
});
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
  for(const route of ['person-sources/missing/new','person-sources/li-cunxin/missing','person-sources/li-cunxin/new/extra'])assert.equal(resolveRoute(`#${route}`),'eras');
  for(const route of ['sources','map'])assert.equal(resolveRoute(`#${route}`),'people');
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
  assert.equal(callback.length,0,'an already responding API must not be overwritten by a late archive preview');
});

test('ordinary malformed or failed HTTP responses do not restore older person passages',async()=>{
  for(const response of [new Response(null,{status:204}),new Response('bad json',{status:200}),new Response('',{status:503}),
    new Response(new ReadableStream({start(controller){controller.error(new Error('truncated'));}}),{status:200})]){
    let previews=0;const staticFetch=archiveFetcher();
    await assert.rejects(readPersonPassages({...options,apiBase:'https://history.example',onArchive:()=>previews++,fetcher:url=>String(url).startsWith('https://history.example')?response:staticFetch(url)}),/Current person passages/);
    assert.equal(previews,0);
  }
});

test('wrong-person, wrong-book and stale-source responding API pages cannot revive a static summary',async()=>{
  for(const mutate of [value=>value.personId='li-siyuan',value=>value.bookId='old',value=>value.items[0].paragraphs[0].original+='改字',value=>value.items[0].spans[0].originalRevision++]){
    const invalid=structuredClone(page);mutate(invalid);const staticFetch=archiveFetcher();
    await assert.rejects(readPersonPassages({...options,apiBase:'https://history.example',fetcher:url=>String(url).startsWith('https://history.example')?json(invalid):staticFetch(url)}),/Current person passages/);
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


test('a book-prefixed archived chapter remains readable in current person passages', async () => {
  const chapter = chapters.get('shiguochunqiu-v001'), paragraph = chapter.paragraphs.find(paragraph => paragraph.id === 'shiguochunqiu-v001-p19');
  const location = entry('shiguochunqiu-v001', 19, 'wu-cheng-kuangrou');
  const item = { ...location, kind: 'record', bookId: 'shiguochunqiu', bookTitle: '十国春秋',
    chapterTitle: chapter.title, chapterPosition: chapter.position, edition: chapter.edition, sourceUrl: chapter.sourceUrl, paragraphs: [paragraph] };
  const current = { schemaVersion: 1, scope: 'current-archive', personId: 'wu-cheng-kuangrou', bookId: 'shiguochunqiu', coverage,
    total: 1, unavailableCount: 0, resultSetRevision: hash('current-prefixed-passage'), nextCursor: null, items: [item] };
  const result = await parsePersonPassagesPage(current, 'wu-cheng-kuangrou', 'shiguochunqiu');
  assert.equal(result.items[0].paragraphs[0].id, 'shiguochunqiu-v001-p19');
  assert.equal(result.items[0].chapterTitle, '卷 1 · 吴太祖世家（杨行密）');
  assert.equal(current.items[0].chapterTitle, '《十国春秋》 · 卷 1 · 吴太祖世家（杨行密）');
  assert.equal(result.items[0].paragraphs[0].translation.text, paragraph.translation.text);
  for (const badTitle of ['《新五代史》 · 卷 1 · 吴太祖世家（杨行密）', '《十国春秋》 · 卷 2 · 吴太祖世家（杨行密）', '《十国春秋》 · 《十国春秋》 · 卷 1 · 吴太祖世家（杨行密）']) {
    const bad = structuredClone(current); bad.items[0].chapterTitle = badTitle;
    await assert.rejects(parsePersonPassagesPage(bad, 'wu-cheng-kuangrou', 'shiguochunqiu'), /Invalid person passage/);
  }
  const stale = structuredClone(current); stale.items[0].spans[0].originalSha256 = '0'.repeat(64);
  await assert.rejects(parsePersonPassagesPage(stale, 'wu-cheng-kuangrou', 'shiguochunqiu'), /Invalid person passage/);
});
