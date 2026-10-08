import { parseChapter } from './chapter-schema.ts';
import { libraryBooks, libraryChapters } from './library.ts';
import { parsePersonPassageIndex, parsePersonPassagesPage, originalHash } from './person-passages-schema.ts';
import type { BookId, ChapterResponse, PersonPassage, PersonPassagesResponse } from './types';

export async function readPersonPassages({personId,bookId,cursor='0',limit=50,apiBase,archiveBase,signal,onArchive,fetcher=fetch}: {
  personId:string; bookId?:BookId; cursor?:string; limit?:number; apiBase:string; archiveBase:string; signal:AbortSignal;
  onArchive?:(page:PersonPassagesResponse)=>void; fetcher?:typeof fetch;
}): Promise<{page:PersonPassagesResponse;source:'api'|'archive'}> {
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || !Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error('Invalid passage pagination');
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
    const selected=matches.slice(Number(cursor),Number(cursor)+limit);
    const cache=new Map<string,Promise<ChapterResponse>>();
    for(const {chapter} of selected) if(!cache.has(chapter.id)) cache.set(chapter.id,request(`${archiveBase}history/chapters/${encodeURIComponent(chapter.id)}.json`,10000).then(value=>parseChapter(value,chapter.bookId,chapter.id)));
    const items:PersonPassage[]=await Promise.all(selected.map(async ({item,association,chapter})=>{
      const source=await cache.get(chapter.id)!;
      const paragraphs=item.spans.map(location=>{
        const paragraph=source.paragraphs.find(candidate=>candidate.id===location.paragraphId);
        if(!paragraph||paragraph.revision!==location.originalRevision) throw new Error('Passage original changed');
        return paragraph;
      });
      for(let position=0;position<item.spans.length;position++) {
        const location=item.spans[position]; const paragraph=paragraphs[position];
        if(!location || !paragraph || location.originalSha256!==await originalHash(paragraph.original)) throw new Error('Passage original changed');
      }
      return {id:item.id,title:item.title,kind:association.kind,bookId:chapter.bookId,bookTitle:libraryBooks.find(book=>book.id===chapter.bookId)!.title,
        chapterId:chapter.id,chapterTitle:chapter.title,chapterPosition:chapter.position,edition:source.edition,sourceUrl:source.sourceUrl,spans:item.spans,paragraphs};
    }));
    const page=await parsePersonPassagesPage({schemaVersion:1,scope:'current-archive',personId,bookId:bookId??null,coverage:index.coverage,total:matches.length,
      unavailableCount:0,resultSetRevision:await originalHash(matches.map(match=>match.item.id).join('\n')),nextCursor:Number(cursor)+items.length<matches.length?String(Number(cursor)+items.length):null,items},personId,bookId,cursor,limit);
    if(!signal.aborted) onArchive?.(page);
    return page;
  }
  const archiveRead=archive();
  const query=new URLSearchParams({cursor,limit:String(limit)});if(bookId)query.set('bookId',bookId);
  const liveRead=apiBase?request(`${apiBase.replace(/\/$/,'')}/api/people/${encodeURIComponent(personId)}/passages?${query}`,6000)
    .then(value=>parsePersonPassagesPage(value,personId,bookId,cursor,limit)):Promise.reject(new Error('API not configured'));
  const [live,local]=await Promise.allSettled([liveRead,archiveRead]);
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(live.status==='fulfilled')return {page:live.value,source:'api'};
  if(local.status==='fulfilled')return {page:local.value,source:'archive'};
  throw new Error('No available person passages');
}
