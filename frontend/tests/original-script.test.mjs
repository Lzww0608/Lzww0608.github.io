import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { loadOriginalConverter, originalParagraphs, ORIGINAL_SCRIPT_KEY, readOriginalScript, saveOriginalScript } from '../src/original-script.ts';

test('remembers an allowed preference and defaults safely when storage is unavailable or invalid', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readOriginalScript(storage), 'traditional');
  saveOriginalScript('simplified', storage);
  assert.equal(values.get(ORIGINAL_SCRIPT_KEY), 'simplified');
  assert.equal(readOriginalScript(storage), 'simplified');
  saveOriginalScript('traditional', storage);
  assert.equal(readOriginalScript(storage), 'traditional');
  values.set(ORIGINAL_SCRIPT_KEY, 'unknown');
  assert.equal(readOriginalScript(storage), 'traditional');
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(readOriginalScript(blocked), 'traditional');
  assert.doesNotThrow(() => saveOriginalScript('simplified', blocked));
});

test('converts classical Chinese and notes while preserving punctuation and unknown rare characters', async () => {
  const convert = await loadOriginalConverter();
  assert.equal(convert('諱晃，本名溫。聖神恭肅文武孝皇帝。'), '讳晃，本名温。圣神恭肃文武孝皇帝。');
  assert.equal(convert('發兵，頭髮；𠮷𨭉。\n〔夾注〕'), '发兵，头发；𠮷𨭉。\n〔夹注〕');
  assert.equal(await loadOriginalConverter(), convert);
});

test('preserves verified historical names while simplifying their unambiguous characters', async () => {
  const convert = await loadOriginalConverter();
  assert.equal(convert('乾祐、乾化、乾寧、乾符、乾德、乾和、乾貞、乾亨、乾元。'), '乾祐、乾化、乾宁、乾符、乾德、乾和、乾贞、乾亨、乾元。');
  assert.equal(convert('乾明門，乾象門，乾文院，乾福殿。乾燥。皇后。'), '乾明门，乾象门，乾文院，乾福殿。干燥。皇后。');
});

test('restores exact canonical text after lossy simplification and keeps published translations intact', async () => {
  const convert = await loadOriginalConverter();
  const paragraphs = [{ id: 'api-p1', position: 7, revision: 2, original: '發兵，頭髮。〔夾注〕', translation: { id: '42', text: '已发布的译文。', language: 'zh-Hans', version: 3, translator: '校核者' } }];
  const before = structuredClone(paragraphs);
  const simplified = originalParagraphs(paragraphs, 'simplified', convert);
  assert.equal(simplified[0].original, '发兵，头发。〔夹注〕');
  assert.deepEqual(simplified[0], { ...paragraphs[0], original: simplified[0].original });
  assert.equal(simplified[0].translation, paragraphs[0].translation);
  assert.deepEqual(paragraphs, before);
  assert.equal(originalParagraphs(paragraphs, 'traditional', convert), paragraphs);
  assert.equal(originalParagraphs(paragraphs, 'simplified', null), paragraphs);
});

test('all archived books use the same conversion without changing source data or paragraph identity', async () => {
  const convert = await loadOriginalConverter();
  const directory = new URL('../../content/five-dynasties/chapters/', import.meta.url);
  const books = new Set();
  for (const file of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const chapter = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
    const before = JSON.stringify(chapter);
    const simplified = originalParagraphs(chapter.paragraphs, 'simplified', convert);
    assert.equal(simplified.length, chapter.paragraphs.length);
    for (let i = 0; i < simplified.length; i++) {
      assert.deepEqual({ ...simplified[i], original: chapter.paragraphs[i].original }, chapter.paragraphs[i]);
    }
    assert.equal(originalParagraphs(chapter.paragraphs, 'traditional', convert), chapter.paragraphs);
    assert.equal(JSON.stringify(chapter), before);
    books.add(chapter.bookId);
  }
  assert.deepEqual([...books].sort(), ['new', 'old', 'quewen', 'tongjian']);
});
