import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { people, events, fiveDynasties, displayedDynasties, filterSearch } from '../src/data.ts';
import { libraryChapters, chaptersForPerson, chapterRoute, preferredChapterForPerson, resolveReadingRoute } from '../src/library.ts';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import sharedEmperors from '../../content/five-dynasties/emperors.json' with { type: 'json' };

const emperorCatalog = JSON.parse(readFileSync(new URL('../../content/five-dynasties/emperors.json', import.meta.url), 'utf8'));
const emperorIds = [
  'zhu-wen', 'zhu-yougui', 'zhu-youzhen',
  'li-cunxu', 'li-siyuan', 'li-conghou', 'li-congke',
  'shi-jingtang', 'shi-chonggui',
  'liu-zhiyuan', 'liu-chengyou',
  'guo-wei', 'chai-rong', 'chai-zongxun',
];

const emperorPeople = people.filter(person => emperorIds.includes(person.id));

test('the people index includes all fourteen reigning Five Dynasties emperors and keeps later dynasties hidden', () => {
  assert.equal(emperorCatalog.schemaVersion, 1);
  assert.equal(emperorCatalog.scope, 'five-dynasties-reigning-emperors');
  assert.equal(emperorPeople.length, 14);
  assert.deepEqual(new Set(emperorPeople.map(person => person.id)), new Set(emperorIds));
  assert.deepEqual(emperorPeople, emperorCatalog.people);
  assert.deepEqual(fiveDynasties, ['后梁', '后唐', '后晋', '后汉', '后周']);
  assert.equal(displayedDynasties.includes('宋'), false);
  for (const [dynasty, count] of [['后梁', 3], ['后唐', 4], ['后晋', 2], ['后汉', 2], ['后周', 3]]) {
    assert.equal(emperorPeople.filter(person => person.dynasty === dynasty).length, count);
  }
  assert.ok(emperorPeople.every(person => events.some(event => event.id === person.event && event.dynasty === person.dynasty)));
  assert.equal(people.some(person => person.name === '刘赟'), false, 'a nominated successor who never acceded is not a reigning emperor');
  assert.deepEqual(filterSearch('刘赟', 'person'), []);
  assert.deepEqual(filterSearch('赵匡胤', 'person'), []);
  assert.equal(events.some(event => event.dynasty === '宋'), false);
});

test('every emperor has an explicit reign and attributable source references', () => {
  for (const person of emperorPeople) {
    assert.ok(person.name && person.role && person.aliases && person.intro, person.id);
    assert.ok(Number.isSafeInteger(person.reignStart) && Number.isSafeInteger(person.reignEnd), person.id);
    assert.ok(person.reignStart >= 907 && person.reignStart <= person.reignEnd && person.reignEnd <= 960, person.id);
    assert.ok(person.reign.includes(String(person.reignStart)) && person.reign.includes(String(person.reignEnd)), person.id);
    assert.ok(person.sources.length > 0, person.id);
    for (const source of person.sources) {
      const url = new URL(source.url);
      assert.ok(source.title.trim());
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username + url.password, '');
    }
    const result = filterSearch(person.name, 'person').find(item => item.id === person.id);
    assert.ok(result, person.id);
    assert.ok(result.summary.includes(`在位 ${person.reign}`), person.id);
  }
});

test('historical aliases find the corresponding emperor and associated source chapters', () => {
  for (const [query, id] of [['朱全忠', 'zhu-wen'], ['朱锽', 'zhu-youzhen'], ['李嗣源', 'li-siyuan'], ['晋出帝', 'shi-chonggui'], ['周恭帝', 'chai-zongxun']]) {
    assert.ok(filterSearch(query, 'person').some(result => result.id === id), query);
    assert.ok(chaptersForPerson(id).length > 0, `${query}: originals remain available through the person`);
  }
});

test('every emperor has biographical originals in both official histories and each reading route stays in its book', () => {
  for (const id of emperorIds) {
    const entries = chaptersForPerson(id);
    assert.ok(entries.some(chapter => chapter.bookId === 'old'), `${id}: old history`);
    assert.ok(entries.some(chapter => chapter.bookId === 'new'), `${id}: new history`);
    assert.ok(entries.some(chapter => chapter.bookId === 'tongjian'), `${id}: chronology`);
    for (const entry of entries) {
      const resolved = resolveReadingRoute(chapterRoute(entry));
      assert.equal(resolved.chapter.id, entry.id);
      assert.equal(resolved.book.id, entry.bookId);
    }
  }
  assert.ok(chaptersForPerson('liu-chengyou').some(chapter => chapter.id === 'new-v10'), 'the shared Han annals include the second emperor');
  assert.ok(chaptersForPerson('zhu-yougui').some(chapter => chapter.id === 'new-v13'), 'the short reign stays reachable through the Liang family biography');
  assert.ok(chaptersForPerson('chai-zongxun').some(chapter => chapter.id === 'tongjian-v294'), 'the final archived chronology includes the 959 succession');
  const knownPeople = new Set(people.map(person => person.id));
  assert.ok(libraryChapters.every(chapter => chapter.subjects.every(id => knownPeople.has(id))));
});

test('preferred entries open the main biography rather than a passing mention in an earlier chapter', () => {
  for (const person of emperorPeople) {
    for (const bookId of ['old', 'new', 'tongjian']) {
      const start = person.readingStarts[bookId];
      if (!start) continue;
      const preferred = preferredChapterForPerson(bookId, person.id);
      assert.equal(preferred.id, start, `${person.id}: ${bookId}`);
      assert.equal(preferred.bookId, bookId);
      assert.ok(preferred.subjects.includes(person.id));
    }
  }
  assert.equal(preferredChapterForPerson('old', 'zhu-yougui').id, 'old-v012');
  assert.equal(preferredChapterForPerson('new', 'zhu-yougui').id, 'new-v13');
  assert.equal(preferredChapterForPerson('new', 'liu-chengyou').id, 'new-v10');
  assert.equal(preferredChapterForPerson('new', 'chai-zongxun').id, 'new-v12');
  assert.equal(preferredChapterForPerson('new', 'unknown-person'), undefined);
  const supplementary = preferredChapterForPerson('quewen', 'li-cunxu');
  assert.equal(supplementary.bookId, 'quewen');
  assert.ok(supplementary.subjects.includes('li-cunxu'));
});

test('incorrect preferred metadata cannot open a chapter from another book or another emperor', () => {
  const person = sharedEmperors.people.find(person => person.id === 'zhu-wen');
  const saved = person.readingStarts.old;
  const other = libraryChapters.find(chapter => chapter.bookId === 'old' && !chapter.subjects.includes('zhu-wen'));
  assert.ok(other);
  try {
    for (const invalid of ['new-v01', other.id, 'missing-chapter']) {
      person.readingStarts.old = invalid;
      const chapter = preferredChapterForPerson('old', 'zhu-wen');
      assert.equal(chapter.bookId, 'old');
      assert.ok(chapter.subjects.includes('zhu-wen'));
      assert.notEqual(chapter.id, invalid);
    }
  } finally {
    person.readingStarts.old = saved;
  }
});

test('all emperors can read originals and published translations of their complete archived annals and biographies', () => {
  const library = loadLibrary();
  const published = new Map(loadPublishedChapters(library).map(chapter => [chapter.id, chapter]));
  const originals = new Map(library.chapters.map(chapter => [chapter.id, chapter]));
  const checked = new Set();
  for (const id of emperorIds) {
    const annals = chaptersForPerson(id).filter(chapter => chapter.bookId === 'old' || chapter.bookId === 'new');
    assert.ok(annals.length, id);
    for (const entry of annals) {
      if (checked.has(entry.id)) continue;
      checked.add(entry.id);
      const chapter = published.get(entry.id);
      const original = originals.get(entry.id);
      assert.equal(chapter.scope, 'full');
      assert.equal(chapter.paragraphs.length, entry.paragraphCount);
      for (const [index, paragraph] of chapter.paragraphs.entries()) {
        assert.equal(paragraph.id, original.paragraphs[index].id);
        assert.equal(paragraph.revision, original.paragraphs[index].revision);
        assert.equal(paragraph.original, original.paragraphs[index].original);
        assert.ok(paragraph.original.trim(), paragraph.id);
        assert.ok(paragraph.translation?.text.trim(), `${paragraph.id}: published translation`);
      }
    }
  }
});
