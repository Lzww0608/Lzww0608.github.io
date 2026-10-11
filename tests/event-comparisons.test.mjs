import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary} from '../content/library.mjs';
import {loadPublishedChapters} from '../content/translations.mjs';
import {loadEventComparisons,validateEventComparisonSources} from '../content/event-comparisons.mjs';

test('Baixiang compares complete current paragraphs and published translations across the five selected works',()=>{
  const library=loadLibrary(),[doc]=loadEventComparisons(library);
  assert.equal(doc.id,'baixiang');assert.equal(doc.sources.length,52);
  assert.equal(new Set(doc.sources.map(source=>source.bookId)).size,5);
  assert.equal(doc.stages.length,4);assert.equal(doc.differences.length,9);
  const published=new Map(loadPublishedChapters(library).flatMap(chapter=>chapter.paragraphs.map(paragraph=>[paragraph.id,paragraph])));
  assert.ok(doc.sources.every(source=>published.get(source.paragraphId).translation.text.trim()));
  assert.ok(doc.differences.some(item=>item.kind==='dating'));
});

test('prebuild rejects stale originals, invented excerpts and private comparison metadata',()=>{
  const [doc]=loadEventComparisons(),stale=structuredClone(doc),invented=structuredClone(doc);
  stale.sources[0].originalSha256='0'.repeat(64);
  assert.throws(()=>validateEventComparisonSources(stale),/Invalid comparison source/);
  invented.differences[0].evidence[0].excerpt='未在该段出现的虚构记载';
  assert.throws(()=>validateEventComparisonSources(invented),/Invalid comparison evidence/);
  assert.throws(()=>validateEventComparisonSources({...doc,privateReview:'secret'}),/Invalid event comparison data/);
});
