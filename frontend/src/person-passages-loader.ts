import { parseChapter } from './chapter-schema.ts';
import { libraryBooks, libraryChapters } from './library.ts';
import { parsePersonPassageIndex, parsePersonPassagesPage, originalHash } from './person-passages-schema.ts';
import { validateSearchQuery, searchFields } from '../../content/passage-search.mts';
import { loadPassageSearch } from './passage-search.ts';
import type { BookId, ChapterResponse, PersonPassage, PersonPassagesResponse, SearchField } from './types';

export async function readPersonPassages({personId,bookId,cursor='0',limit=50,query='',field='both',apiBase,archiveBase,signal,onArchive,fetcher=fetch}: {
  personId:string; bookId?:BookId; cursor?:string; limit?:number; query?:string; field?:SearchField; apiBase:string; archiveBase:string; signal:AbortSignal;
  onArchive?:(page:PersonPassagesResponse)=>void; fetcher?:typeof fetch;
}): Promise<{page:PersonPassagesResponse;source:'api'|'archive'}> {
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || !Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error('Invalid passage pagination');
  query=validateSearchQuery(query);
  if (!searchFields.includes(field)) throw new Error('Invalid passage search field');
  signal.throwIfAborted();
  let authoritativeFailure=false;
  async function request(url:string,timeout:number):Promise<unknown> {
    const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),credentials:'omit'});
    if(!response.ok) throw new Error('Person passages unavailable');
    return await response.json() as unknown;
  }
  async function archive():Promise<PersonPassagesResponse> {
    const index=parsePersonPassageIndex(await request(`${archiveBase}history/person-passages.json`,10000));
    if (!index.people.some(person=>person.id===personId)) throw new Error('Unknown person');
    const chapterById=new Map(libraryChapters.map(chapter=>[chapter.id,chapter]));
    const matches=index.passages.flatMap(item=>{
      const association=item.people.find(person=>person.personId===personId);
      const chapter=chapterById.get(item.chapterId);
      return association && chapter && (!bookId||chapter.bookId===bookId)?[{item,association,chapter}]:[];
    }).sort((a,b)=>a.chapter.bookId.localeCompare(b.chapter.bookId)||a.chapter.position-b.chapter.position
      || Number(a.item.spans[0]?.paragraphId.split('-p').at(-1))-Number(b.item.spans[0]?.paragraphId.split('-p').at(-1))||a.item.id.localeCompare(b.item.id));
    // Search all of the person's indexed paragraphs before slicing a result page.
    const selected=query ? matches : matches.slice(Number(cursor),Number(cursor)+limit);
    const cache=new Map<string,Promise<ChapterResponse>>();
    const chapterList=[...new Map(selected.map(entry=>[entry.chapter.id,entry.chapter])).values()];
    let chapterCursor=0;
    await Promise.all(Array.from({length:Math.min(6,chapterList.length)},async()=>{
      while(chapterCursor<chapterList.length){
        signal.throwIfAborted();
        const chapter=chapterList[chapterCursor++]!;
        const pending=request(`${archiveBase}history/chapters/${encodeURIComponent(chapter.id)}.json`,10000).then(value=>parseChapter(value,chapter.bookId,chapter.id));
        cache.set(chapter.id,pending);await pending;
      }
    }));
    const loaded:PersonPassage[]=await Promise.all(selected.map(async ({item,association,chapter})=>{
      const source=await cache.get(chapter.id)!;
      const paragraphs=item.spans.map(location=>{
        const paragraph=source.paragraphs.find(candidate=>candidate.id===location.paragraphId);
        if(!paragraph||paragraph.revision!==location.originalRevision) throw new Error('Passage original changed');
        return paragraph;
      });
      for(let position=0;position<item.spans.length;position++) {
        const location=item.spans[position],paragraph=paragraphs[position];
        if (!location || !paragraph || location.originalSha256!==await originalHash(paragraph.original)) throw new Error('Passage original changed');
      }
      return {id:item.id,title:item.title,kind:association.kind,bookId:chapter.bookId,bookTitle:libraryBooks.find(book=>book.id===chapter.bookId)!.title,
        chapterId:chapter.id,chapterTitle:chapter.title,chapterPosition:chapter.position,edition:source.edition,sourceUrl:source.sourceUrl,spans:item.spans,paragraphs};
    }));
    signal.throwIfAborted();
    const engine=query ? await loadPassageSearch() : null;
    const filtered=engine ? engine.filterPassages(loaded,query,field) : loaded;
    const items=query ? filtered.slice(Number(cursor),Number(cursor)+limit) : loaded;
    const total=query ? filtered.length : matches.length;
    const snapshot=query ? JSON.stringify({query,normalizedQuery:engine!.normalize(query),field,items:filtered.map(item=>({id:item.id,paragraphs:item.paragraphs.map(p=>({id:p.id,revision:p.revision,original:p.original,translation:p.translation&&{id:p.translation.id,version:p.translation.version,text:p.translation.text}}))}))}) : matches.map(match=>match.item.id).join('\n');
    const page=await parsePersonPassagesPage({schemaVersion:1,scope:'current-archive',personId,bookId:bookId??null,coverage:index.coverage,total,
      unavailableCount:0,resultSetRevision:await originalHash(snapshot),nextCursor:Number(cursor)+items.length<total?String(Number(cursor)+items.length):null,items,
      ...(query ? {search:{query,field,normalizedQuery:engine!.normalize(query)}} : {})},personId,bookId,cursor,limit,{query,field});
    if(!signal.aborted) onArchive?.(page);
    return page;
  }
  const archiveRead=archive();
  const params=new URLSearchParams({cursor,limit:String(limit)});if(bookId)params.set('bookId',bookId);if(query){params.set('q',query);params.set('field',field);}
  const liveRead=apiBase ? (async()=>{
    const response=await fetcher(`${apiBase.replace(/\/$/,'')}/api/people/${encodeURIComponent(personId)}/passages?${params}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(6000)]),credentials:'omit'});
    if(!response.ok)throw new Error('Person passages unavailable');
    try{return await parsePersonPassagesPage(await response.json(),personId,bookId,cursor,limit,{query,field});}
    catch(error){if(query)authoritativeFailure=true;throw error;}
  })() : Promise.reject(new Error('API not configured'));
  const [live,local]=await Promise.allSettled([liveRead,archiveRead]);
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(live.status==='fulfilled')return {page:live.value,source:'api'};
  // A successful query response that cannot be verified must not revive an old static result.
  if(authoritativeFailure)throw new Error('Current search result could not be verified');
  if(local.status==='fulfilled')return {page:local.value,source:'archive'};
  throw new Error('No available person passages');
}
