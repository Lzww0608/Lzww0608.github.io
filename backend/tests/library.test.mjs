import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLibrary } from '../../content/library.mjs';
const { catalog, chapters } = loadLibrary();

test('the archive has verified source hashes, complete founder annals and all Five Dynasties Tongjian volumes', () => {
  assert.equal(chapters.length, 64);
  assert.deepEqual(catalog.books.map(book => book.id), ['old', 'new', 'tongjian', 'quewen']);
  for (const [person, oldCount, newCount] of [['zhu-wen', 7, 2], ['li-cunxu', 8, 2], ['shi-jingtang', 6, 1], ['liu-zhiyuan', 2, 1], ['guo-wei', 4, 1]]) {
    assert.equal(catalog.chapters.filter(c => c.bookId === 'old' && c.subjects.includes(person)).length, oldCount);
    assert.equal(catalog.chapters.filter(c => c.bookId === 'new' && c.subjects.includes(person)).length, newCount);
    assert.ok(catalog.chapters.some(c => c.bookId === 'tongjian' && c.subjects.includes(person)));
  }
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'tongjian').map(c => c.volume), Array.from({ length: 29 }, (_, i) => 266 + i));
  assert.ok(chapters.every(c => c.scope === 'full' && c.paragraphs.every(p => p.translation === null)));
  assert.ok(chapters.find(c => c.id === 'old-v001').paragraphs.some(p => p.original.includes('永樂大典')));
  assert.ok(chapters.find(c => c.id === 'tongjian-v272').paragraphs.some(p => p.original.includes('莊宗光聖神閔孝皇帝')));
  const quewen = chapters.find(c => c.id === 'quewen-v001').paragraphs.map(p => p.original).join('');
  assert.ok(quewen.includes('宋王禹偁撰') && quewen.includes('皆聞於耆老者也') && quewen.includes('王樸'));
});
