import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadLibrary } from '../../content/library.mjs';
import { originalTextTag } from '../src/reading-headings.ts';

const { chapters } = loadLibrary();
const paragraphs = new Map(chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));

test('source section headings, year headings and marked subheadings keep their distinct levels', () => {
  for (const [id, tag] of [
    ['old-v005-p1', 'h2'], ['new-v02-p1', 'h2'],
    ['old-v057-p1', 'h2'], ['old-v057-p15', 'h2'],
    ['tongjian-v266-p3', 'h3'], ['tongjian-v280-p3', 'h3'],
    ['quewen-v001-p2', 'h2'], ['quewen-v001-p6', 'h3'], ['quewen-v001-p7', 'h4'],
    ['shibu-v001-p1', 'h2'], ['chunqiu-v001-p1', 'h2'], ['huiyao-v001-p1', 'h2'],
    ['beimeng-v017-p2', 'h2'], ['beimeng-v017-p4', 'h3'], ['beimeng-v000-p6', 'h2'],
    ['kaoyi-v028-p2', 'h2'], ['kaoyi-v028-p4', 'h3'],
  ]) assert.equal(originalTextTag(paragraphs.get(id)), tag, id);
  assert.equal(originalTextTag(paragraphs.get('old-v001-p2')), 'p');
  assert.equal(originalTextTag(paragraphs.get('new-v01-p1')), 'p');
  assert.equal(originalTextTag(paragraphs.get('beimeng-v017-p5')), 'p');
  assert.equal(originalTextTag(paragraphs.get('kaoyi-v028-p9')), 'p');
});

test('every heading is attached to the exact canonical paragraph and retains its identity', () => {
  const index = JSON.parse(readFileSync(new URL('../src/reading-headings.json', import.meta.url), 'utf8'));
  for (const [id, heading] of Object.entries(index)) {
    const paragraph = paragraphs.get(id);
    assert.ok(paragraph, id);
    assert.equal(paragraph.original, heading.original, id);
    assert.equal(paragraph.revision, heading.revision, id);
    assert.equal(originalTextTag(paragraph), `h${heading.level}`, id);
  }
});

test('revised API originals do not inherit stale heading formatting or change translations', () => {
  const original = paragraphs.get('new-v02-p1');
  assert.equal(originalTextTag({ ...original, original: '新修订的正文。' }), 'p');
  assert.equal(originalTextTag({ ...original, revision: original.revision + 1 }), 'p');
  const paragraph = { ...original, translation: { id: 'translation-1', text: '开平元年', language: 'zh-Hans', version: 1, translator: '测试译者' } };
  const before = structuredClone(paragraph);
  assert.equal(originalTextTag(paragraph), 'h2');
  assert.deepEqual(paragraph, before);
});
