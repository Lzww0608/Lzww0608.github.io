import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLibrary } from '../../content/library.mjs';
import { applyPublishedTranslations } from '../../content/translations.mjs';
import { textHash } from '../src/translation-batch.mjs';
const library=loadLibrary(), paragraph=library.chapters.find(c=>c.id==='chunqiu-v001').paragraphs[0];
const snapshot=()=>({schemaVersion:1,bookId:'chunqiu',status:'published',entries:[{paragraphId:paragraph.id,originalRevision:paragraph.revision,originalSha256:textHash(paragraph.original),translation:{id:'1',text:'后梁太祖（朱温）',language:'zh-Hans',version:1,translator:'Codex',origin:'ai',reviewStatus:'pending',reviewNotes:[]}}]});

test('published offline translations preserve immutable originals and carry their AI label',()=>{
  const before=structuredClone(library);
  const chapters=applyPublishedTranslations(library,[snapshot()]);
  assert.deepEqual(library,before);
  const p=chapters.find(c=>c.id==='chunqiu-v001').paragraphs[0];
  assert.equal(p.original,paragraph.original);assert.equal(p.revision,paragraph.revision);assert.equal(p.translation.origin,'ai');
});

test('unreleased, duplicate, stale or falsely reviewed AI snapshots cannot enter the site',()=>{
  for(const mutate of [s=>{s.status='draft';},s=>{s.entries[0].originalRevision++;},s=>{s.entries[0].originalSha256='0'.repeat(64);},s=>{s.entries.push(s.entries[0]);},s=>{s.entries[0].translation.reviewStatus='reviewed';}]){
    const s=snapshot();mutate(s);assert.throws(()=>applyPublishedTranslations(library,[s]));
  }
});
