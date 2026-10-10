import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../content/library.mjs';
import { loadPublishedChapters } from '../content/translations.mjs';
import { readSentenceTranslationParts } from '../frontend/src/sentence-translations-loader.ts';
import { splitReadingSpans, matchesSentenceAlignment } from '../frontend/src/sentence-alignment.ts';
import { originalTextTag } from '../frontend/src/reading-headings.ts';

// Exercise the same loader as both readers against only published static assets.
// No API, credentials, generated translation or production database mutation.
export async function checkSentenceCoverage() {
  const library=loadLibrary(), chapters=loadPublishedChapters(library), counts=()=>({paragraphs:0,clickableUnits:0,coveredUnits:0,nonclickableUnits:0,supplementalUnits:0});
  const books=new Map(library.catalog.books.map(book=>[book.id,{bookId:book.id,title:book.title,...counts()}]));
  const totals=counts(), problems=[];
  const fetcher=async url=>{
    const path=/\/history\/(sentence-alignments|sentence-translations)\/([a-z]+-v\d+)\.json$/.exec(url);
    if(!path)return new Response('',{status:404});
    const file=new URL(`../content/${path[1]==='sentence-alignments'?'sentence-alignments/chapters':'published-sentence-translations'}/${path[2]}.json`,import.meta.url);
    return existsSync(file)?Response.json(JSON.parse(readFileSync(file,'utf8'))):new Response('',{status:404});
  };
  for(const chapter of chapters)for(const paragraph of chapter.paragraphs){
    const index=JSON.parse(readFileSync(new URL(`../content/sentence-alignments/chapters/${chapter.id}.json`,import.meta.url),'utf8'));
    const alignment=index.paragraphs.find(item=>item.paragraphId===paragraph.id);
    if(!alignment||!await matchesSentenceAlignment(alignment,paragraph))problems.push(`${paragraph.id}: missing/stale published index`);
    const spans=splitReadingSpans(paragraph.original),heading=originalTextTag(paragraph)!=='p';
    const parts=await readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,fetcher});
    if(parts.map(part=>part.original).join('')!==paragraph.original)problems.push(`${paragraph.id}: original text not fully preserved`);
    if(!heading){
      // Independently count punctuation in the source. This catches a splitter
      // which still merges several trailing questions into one broad popup.
      const tail=paragraph.original.slice(paragraph.original.lastIndexOf('。')+1);
      const tailEnds=[...tail.matchAll(/[？！][？！”’」』】〉》〕）)"'\s]*/gu)].length;
      const expected=(paragraph.original.match(/。/gu)??[]).length+tailEnds;
      if(parts.filter(part=>part.kind==='sentence'||part.kind==='unaligned').length!==expected)
        problems.push(`${paragraph.id}: punctuation targets missing or merged`);
    }
    const book=books.get(chapter.bookId);totals.paragraphs++;book.paragraphs++;
    if(parts.length!==spans.length)problems.push(`${paragraph.id}: unit count differs`);
    for(const [i,span]of spans.entries()){
      // Expect punctuation from the canonical text independently of the loader's
      // click classification, so a missing question/exclamation button is a failure.
      const clickable=/[。？！]/u.test(span.text)||heading;
      for(const count of[totals,book])count[clickable?'clickableUnits':'nonclickableUnits']++;
      if(!clickable)continue;
      const part=parts[i];
      if(part?.kind!=='sentence'||!part.translation?.trim()||part.original!==span.text)problems.push(`${paragraph.id} sentence ${i+1}: no independent published correspondence`);
      else{totals.coveredUnits++;book.coveredUnits++;}
      if(alignment?.supplementalTranslations?.length){totals.supplementalUnits++;book.supplementalUnits++;}
    }
  }
  if(problems.length){const error=new Error(`Sentence coverage failed: ${problems.length} problems\n${problems.slice(0,30).join('\n')}`);error.problems=problems;throw error;}
  return {chapters:chapters.length,totals,books:[...books.values()],unmatchedUnits:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await checkSentenceCoverage(),null,2));
