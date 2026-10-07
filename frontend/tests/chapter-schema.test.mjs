import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChapter } from '../src/chapter-schema.ts';

const chapter = {
  id: 'old-1', bookId: 'old', title: '梁太祖纪一', position: 1,
  scope: 'excerpt', sourceUrl: 'https://zh.wikisource.org/wiki/舊五代史/卷1',
  bookTitle: '旧五代史', author: '北宋 · 薛居正等撰',
  editionId: 'old-wikisource', edition: '维基文库整理文本',
  notes: ['此处为卷一的短节选。'],
  paragraphs: [{ id: 'old-1-p1', position: 1, revision: 1, original: '太祖神武元聖孝皇帝，姓朱氏。', translation: null }],
};

test('accepts published originals with no translation', () => {
  assert.deepEqual(parseChapter(structuredClone(chapter), 'old'), chapter);
});

test('accepts a published translation including its attribution', () => {
  const value = structuredClone(chapter);
  value.paragraphs[0].translation = {
    id: '42', text: '太祖姓朱。', language: 'zh-Hans', version: 2, translator: '测试译者',
  };
  assert.deepEqual(parseChapter(value, 'old'), value);
});

test('accepts released AI initial translations with transparent review notes, rejects malformed labels', () => {
  const translation = { id:'1', text:'AI 初译', language:'zh-Hans', version:1, translator:'Codex', origin:'ai', reviewStatus:'pending', reviewNotes:['待核对专名'] };
  const value = { ...chapter, paragraphs:[{...chapter.paragraphs[0], translation}] };
  assert.deepEqual(parseChapter(value,'old'),value);
  for (const extra of [{origin:'unknown'}, {reviewStatus:['pending']}, {reviewNotes:[1]}, {reviewNotes:null}]) {
    assert.throws(() => parseChapter({...value, paragraphs:[{...chapter.paragraphs[0], translation:{...translation,...extra}}]},'old'),/Invalid chapter/);
  }
});

test('rejects a chapter belonging to the other book', () => {
  assert.throws(() => parseChapter(chapter, 'new'), /Invalid chapter/);
});

test('rejects incomplete chapter metadata and malformed reading notes', () => {
  for (const value of [null, [], {}, { ...chapter, title: null }, { ...chapter, sourceUrl: 42 }, { ...chapter, notes: null }, { ...chapter, notes: [null] }]) {
    assert.throws(() => parseChapter(value, 'old'), /Invalid chapter/);
  }
});

test('rejects empty or malformed original paragraphs before rendering', () => {
  for (const paragraphs of [[], [null], [{ ...chapter.paragraphs[0], original: 42 }], [{ ...chapter.paragraphs[0], id: null }], [{ ...chapter.paragraphs[0], revision: 0 }]]) {
    assert.throws(() => parseChapter({ ...chapter, paragraphs }, 'old'), /Invalid chapter/);
  }
});

test('rejects malformed translations instead of rendering unsafe values', () => {
  const translation = { id: '42', text: '太祖姓朱。', language: 'zh-Hans', version: 1, translator: '测试译者' };
  for (const invalid of [undefined, {}, { ...translation, text: {} }, { ...translation, translator: null }, { ...translation, version: -1 }]) {
    const value = { ...chapter, paragraphs: [{ ...chapter.paragraphs[0], translation: invalid }] };
    assert.throws(() => parseChapter(value, 'old'), /Invalid chapter/);
  }
});
