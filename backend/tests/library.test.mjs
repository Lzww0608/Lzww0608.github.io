import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
const { catalog, chapters } = loadLibrary();

test('the archive has verified source hashes, complete emperor annals and all Five Dynasties Tongjian volumes', () => {
  assert.equal(chapters.length, 151);
  assert.deepEqual(catalog.books.map(book => book.id), ['old', 'new', 'tongjian', 'quewen', 'shibu', 'chunqiu', 'huiyao', 'beimeng', 'kaoyi']);
  const emperors = JSON.parse(readFileSync(new URL('../../content/five-dynasties/emperors.json', import.meta.url), 'utf8')).people;
  assert.equal(emperors.length, 14);
  for (const person of emperors) {
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(catalog.chapters.some(c => c.id === chapterId && c.bookId === bookId && c.subjects.includes(person.id)), `${person.id}: ${bookId}`);
    }
  }
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'old').map(c => c.volume).sort((a,b) => a-b),
    [1,2,3,4,5,6,7,8,9,10,12, ...Array.from({length:22},(_,i)=>27+i), ...Array.from({length:11},(_,i)=>75+i), ...Array.from({length:5},(_,i)=>99+i), ...Array.from({length:11},(_,i)=>110+i)]);
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'new').map(c => c.volume), Array.from({length:13},(_,i)=>i+1));
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'tongjian').map(c => c.volume), Array.from({ length: 29 }, (_, i) => 266 + i));
  assert.ok(chapters.every(c => c.scope === 'full' && c.paragraphs.every(p => p.translation === null)));
  assert.ok(chapters.find(c => c.id === 'old-v001').paragraphs.some(p => p.original.includes('永樂大典')));
  assert.ok(chapters.find(c => c.id === 'tongjian-v272').paragraphs.some(p => p.original.includes('莊宗光聖神閔孝皇帝')));
  const quewen = chapters.find(c => c.id === 'quewen-v001').paragraphs.map(p => p.original).join('');
  assert.ok(quewen.includes('宋王禹偁撰') && quewen.includes('皆聞於耆老者也') && quewen.includes('王樸'));
});


test('the five additions retain complete selected volumes, separate prefaces and correct genres', () => {
  for (const [bookId, first, last, hasPreface] of [['shibu',1,5,true], ['chunqiu',1,2,true], ['huiyao',1,30,true], ['beimeng',17,20,true], ['kaoyi',28,30,false]]) {
    const entries = catalog.chapters.filter(c => c.bookId === bookId).sort((a,b) => a.position-b.position);
    assert.deepEqual(entries.map(c => c.volume), [...(hasPreface ? [0] : []), ...Array.from({length:last-first+1}, (_,i) => first+i)]);
    const book = catalog.books.find(b => b.id === bookId);
    assert.equal(entries.find(c => c.id === book.defaultChapter).volume, first);
    assert.ok(entries.every(c => c.provenance.license === catalog.license));
  }
  assert.equal(catalog.books.find(b => b.id === 'huiyao').kind, '典章制度');
  assert.equal(catalog.books.find(b => b.id === 'kaoyi').kind, '史料考证');
  for (const id of ['shibu-v000','chunqiu-v000','huiyao-v000','beimeng-v000']) {
    assert.ok(chapters.find(c => c.id === id).paragraphs.some(p => p.original.includes('撰')));
    assert.deepEqual(catalog.chapters.find(c => c.id === id).subjects, []);
  }
  assert.ok(chapters.find(c => c.id === 'beimeng-v000').paragraphs.some(p => p.original.includes('北夢瑣言序')));
  assert.ok(chapters.find(c => c.id === 'kaoyi-v028').paragraphs.some(p => p.original === '後梁紀上'));
  assert.ok(chapters.find(c => c.id === 'kaoyi-v030').paragraphs.some(p => p.original.includes('後周紀')));
});
