import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipNodes, relationshipsForPerson } from '../src/relationships.ts';
import { readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';

test('formal profiles upgrade the same two context identities and retain existing relationships', () => {
  const contexts = JSON.parse(fs.readFileSync(new URL('../../content/person-relationships/palace-context.json', import.meta.url)));
  for (const id of ['tang-li-keyong-grandmother-cui', 'tang-li-keyong-daughter-wang-yu-wife']) {
    const nodes = relationshipNodes.filter(n => n.id === id);
    assert.equal(nodes.length, 1);
    assert.notEqual(nodes[0].external, true);
    assert.ok(!contexts.some(n => n.id === id));
  }
  assert.ok(relationshipsForPerson('li-keyong').some(e => e.id === 'tang-li-keyong-grandmother-cui-keyong'));
  assert.ok(relationshipsForPerson('tang-li-keyong-daughter-wang-yu-wife').some(e => e.id === 'tang-li-keyong-daughter-wang-yu-wife-keyong'));
  const docs = loadPersonTimelines();
  const cui = docs.find(d => d.personId === 'tang-li-keyong-grandmother-cui');
  assert.equal(cui.events.length, 1);
  assert.equal(cui.events[0].year, 923);
  assert.equal(cui.events[0].phase, 'posthumous');
  const wife = docs.find(d => d.personId === 'tang-li-keyong-daughter-wang-yu-wife');
  assert.equal(wife.events.length, 1);
  assert.equal(wife.events[0].year, null);
});

test('new cross-biography evidence separates Shouchun marriage and short-name collisions', () => {
  const docs = loadPersonTimelines();
  const shouchun = docs.find(d => d.personId === 'liang-zhu-youzhen-princess-shouchun');
  assert.equal(shouchun.events.find(e => e.id === 'liang-zhu-youzhen-princess-shouchun-investiture').year, 913);
  assert.ok(shouchun.events.some(e => e.year === null && e.evidence.some(s => s.paragraphId === 'new-v39-p24') && e.summary.includes('罗周翰')));
  const index = loadPersonPassageIndex();
  const people = pid => index.passages.find(p => p.spans.some(s => s.paragraphId === pid))?.people ?? [];
  assert.ok(!people('new-v39-p17').some(p => p.personId === 'li-chengsi'));
  assert.ok(!people('new-v39-p51').some(p => p.personId === 'zhu-wen'));
});

test('numeric endnote tails retain full translation coverage without acquiring a sentence popup', async () => {
  const chapter = loadPublishedChapters(loadLibrary()).find(c => c.id === 'new-v39');
  const alignment = JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/new-v39.json', import.meta.url)));
  const fetcher = async url => {
    if (String(url).includes('sentence-alignments')) return Response.json(alignment);
    return new Response('', { status: 404 });
  };
  for (const [pid, tail] of [['new-v39-p24', '[4]'], ['new-v39-p35', '[5]']]) {
    const paragraph = chapter.paragraphs.find(p => p.id === pid);
    const parts = await readSentenceTranslationParts({ paragraph, displayedOriginal: paragraph.original, archiveBase: '/', fetcher });
    assert.equal(parts.map(p => p.original).join(''), paragraph.original);
    assert.equal(parts.at(-1).original, tail);
    assert.equal(parts.at(-1).kind, 'unavailable');
    assert.equal(parts.at(-1).translation, null);
    assert.ok(paragraph.translation.text.endsWith(tail));
    assert.ok(parts.slice(0, -1).every(p => p.kind === 'sentence' && p.translation));
  }
});
