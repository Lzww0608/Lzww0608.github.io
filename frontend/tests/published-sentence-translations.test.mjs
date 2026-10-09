import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { parsePublishedSentenceTranslations, currentPublishedSentenceTranslations } from '../src/published-sentence-translations.ts';
import { readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';
import { splitPeriodSpans, validateSentenceAlignmentDocument } from '../src/sentence-alignment.ts';
const hash=t=>createHash('sha256').update(t).digest('hex');
const paragraph={id:'new-v99-p1',position:1,revision:1,original:'以功拜澶〈古本作單。〉州刺史。',translation:{id:'901',version:1,text:'因功获任澶〈古本此字作“单”。〉州刺史。',language:'zh-Hans',translator:'测试'}};
const units=splitPeriodSpans(paragraph.original);
const texts=['因功获授澶州的官职〈古本将“澶”字写作“单”。〉','（接前句）担任该州的刺史。'];
const document={schemaVersion:1,status:'published',chapterId:'new-v99',entries:units.map((unit,i)=>({id:`sentence-test-${i}`,paragraphId:paragraph.id,originalRevision:1,originalSha256:hash(paragraph.original),originalStart:unit.start,originalEnd:unit.end,parentTranslationId:'901',parentTranslationVersion:1,parentTranslationSha256:hash(paragraph.translation.text),version:1,text:texts[i],textSha256:hash(texts[i]),origin:'ai',humanReviewed:false,reviewNotes:i?['接前句的官职，初译待人工校订。']:[]}))};
const index={schemaVersion:1,chapterId:'new-v99',paragraphs:[{paragraphId:paragraph.id,originalRevision:1,originalSha256:hash(paragraph.original),translationId:'901',translationVersion:1,translationSha256:hash(paragraph.translation.text),groups:[{originalStart:0,originalEnd:[...paragraph.original].length,translationStart:0,translationEnd:[...paragraph.translation.text].length,kind:'paragraph'}],supplementalTranslations:document.entries.map(({id,version,textSha256})=>({id,version,textSha256}))}]};
const read=async(fetcher,extra={})=>readSentenceTranslationParts({paragraph,displayedOriginal:paragraph.original,archiveBase:'/',fetcher,...extra});
function fetcherFor(api){const calls=[];const fetcher=async(url,opts)=>{calls.push({url,opts});if(url.includes('sentence-alignments'))return Response.json(index);if(url.includes('/api/'))return typeof api==='function'?api():Response.json(api);return Response.json(document);};return {fetcher,calls};}

test('published supplements keep each literal note-period unit independent without changing full text',async()=>{
  const {fetcher,calls}=fetcherFor();const before=structuredClone(paragraph);
  const parts=await read(fetcher);assert.deepEqual(parts.map(p=>p.translation),texts);assert.ok(parts.every(p=>p.kind==='sentence'));
  assert.deepEqual(parts.map(p=>p.original),units.map(s=>s.text));assert.deepEqual(paragraph,before);assert.deepEqual(parts[1].reviewNotes,document.entries[1].reviewNotes);
  await read(fetcher);assert.equal(calls.filter(c=>c.url.includes('sentence-translations')).length,1);assert.ok(calls.every(c=>c.opts.credentials==='omit'));
});
test('source, full translation and independent text version/checksum bindings must all match',async()=>{
  assert.equal(parsePublishedSentenceTranslations(document)?.entries.length,2);
  const refs=index.paragraphs[0].supplementalTranslations;
  for(const mutation of [d=>d.entries[0].originalRevision++,d=>d.entries[0].parentTranslationVersion++,d=>d.entries[0].parentTranslationId='902',d=>d.entries[0].originalStart++,d=>d.entries[0].version++,d=>d.entries[0].text+='篡改',d=>{d.entries[0].text+='新文';d.entries[0].textSha256=hash(d.entries[0].text);}]){
    const d=structuredClone(document);mutation(d);assert.equal((await currentPublishedSentenceTranslations(d,paragraph,refs)).length,1);
  }
  assert.deepEqual(await currentPublishedSentenceTranslations(document,{...paragraph,translation:{...paragraph.translation,id:'902'}},refs),[]);
  const falseReview=structuredClone(document);falseReview.entries[0].humanReviewed=true;assert.equal(parsePublishedSentenceTranslations(falseReview),null);
  assert.equal(parsePublishedSentenceTranslations({...document,status:'draft'}),null);
  const invalidNotes=structuredClone(document);invalidNotes.entries[0].reviewNotes=[{}];assert.equal(parsePublishedSentenceTranslations(invalidNotes),null);
  const invalidIndex=structuredClone(index);invalidIndex.paragraphs[0].supplementalTranslations[0].textSha256='bad';assert.throws(()=>validateSentenceAlignmentDocument(invalidIndex));
});
test('successful API suspension or invalid JSON cannot revive an old archived supplement',async()=>{
  for(const api of [{...document,entries:[]},{...document,status:'draft'},()=>new Response('{broken',{status:200})]){
    const {fetcher}=fetcherFor(api);const parts=await read(fetcher,{apiBase:'https://api.test'});assert.ok(parts.every(p=>p.translation===null));
  }
});
test('API-offline reading uses only the matching published archive; valid API is preferred',async()=>{
  const offline=fetcherFor(()=>{throw Error('offline');});assert.deepEqual((await read(offline.fetcher,{apiBase:'https://api.test'})).map(p=>p.translation),texts);
  const current=fetcherFor(document);assert.deepEqual((await read(current.fetcher,{apiBase:'https://api.test'})).map(p=>p.translation),texts);
  assert.equal(current.calls.filter(c=>c.url.includes('/api/')).length,1);
});
test('cancelling an obsolete reading view prevents late supplement parts from being shown',async()=>{
  const controller=new AbortController();const {fetcher}=fetcherFor(()=>{controller.abort();return Response.json(document);});
  await assert.rejects(read(fetcher,{apiBase:'https://api.test',signal:controller.signal}),{name:'AbortError'});
});
