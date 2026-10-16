import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { relationshipNodes, relationshipsForPerson } from '../src/relationships.ts';
import { readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';

const princessId = 'liang-zhu-youzhen-princess-jinan-puan';

test('Jinan and Puan reuse one promoted identity and remain distinct from Shouchang', () => {
  const nodes = relationshipNodes.filter(n => n.id === princessId);
  assert.equal(nodes.length, 1);
  assert.notEqual(nodes[0].external, true);
  assert.ok(relationshipNodes.some(n => n.id === 'liang-zhu-youzhen-princess-shouchang'));
  const contexts = JSON.parse(fs.readFileSync(new URL('../../content/person-relationships/palace-context.json', import.meta.url)));
  assert.ok(!contexts.some(n => n.id === princessId));
  const doc = loadPersonTimelines().find(d => d.personId === princessId);
  assert.equal(doc.events.length, 1);
  assert.equal(doc.events[0].year, null);
  assert.equal(doc.events[0].precision, 'undated');
});

test('the existing Luo Zhoujing marriage edge keeps its identity and adds the actual old-history source', () => {
  const id = 'liang-zhu-youzhen-jinan-puan-luo-zhoujing-marriage';
  for (const person of [princessId, 'luo-zhoujing']) {
    const edges = relationshipsForPerson(person).filter(e => e.id === id);
    assert.equal(edges.length, 1);
    assert.ok(edges[0].sources.some(s => s.paragraphId === 'old-v091-p30'));
    assert.ok(edges[0].sources.some(s => s.paragraphId === 'new-v39-p24'));
  }
});

test('the new full source keeps original variants and precise separate translations', async () => {
  const chapter = loadPublishedChapters(loadLibrary()).find(c => c.id === 'old-v091');
  assert.equal(chapter.paragraphs.length, 32);
  const alignment = JSON.parse(fs.readFileSync(new URL('../../content/sentence-alignments/chapters/old-v091.json', import.meta.url)));
  const fetcher = async url => String(url).includes('sentence-alignments')
    ? Response.json(alignment) : new Response('', { status: 404 });
  const read = async id => {
    const paragraph = chapter.paragraphs.find(p => p.id === id);
    const parts = await readSentenceTranslationParts({ paragraph, displayedOriginal: paragraph.original, archiveBase: '/', fetcher });
    assert.equal(parts.map(p => p.original).join(''), paragraph.original);
    assert.ok(parts.every(p => p.kind === 'sentence' && p.translation));
    return { paragraph, parts };
  };
  const sons = await read('old-v091-p9');
  assert.ok(sons.parts[0].translation.includes('其余两子是康延泽、康延寿'));
  const marriage = await read('old-v091-p30');
  assert.ok(marriage.paragraph.original.includes('弟三子'));
  assert.ok(marriage.paragraph.original.includes('尚梁普安公主'));
  assert.ok(marriage.parts[5].original.startsWith('逾三年'));
  assert.ok(marriage.parts[5].translation.startsWith('过了三年多'));
});
