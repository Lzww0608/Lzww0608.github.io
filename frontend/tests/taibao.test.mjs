import test from 'node:test';
import assert from 'node:assert/strict';
import { people, displayedDynasties, filterSearch } from '../src/data.ts';
import { peopleForGroup, personDisplayPeriod, reigningEmperors, taibaoGroup } from '../src/person-catalog.ts';
import { chapterRoute, chaptersForPerson, libraryChapters, preferredChapterForPerson, resolveReadingRoute } from '../src/library.ts';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';

const memberIds = [
  'li-siyuan', 'li-sizhao', 'li-cunxu', 'li-cunxin', 'li-cunjin',
  'li-siben', 'li-sien', 'li-cunzhang', 'fu-cunshen', 'li-cunxian',
  'shi-jingsi', 'kang-junli', 'li-cunxiao',
];
const newIds = memberIds.filter(id => !['li-siyuan', 'li-cunxu'].includes(id));
const expectedCatalogIds = new Set(loadPassagePeople().map(person => person.id));

test('searching the topic name finds all thirteen people while their originals stay linked', () => {
  assert.deepEqual(new Set(filterSearch('十三太保', 'person').map(person => person.id)), new Set(memberIds));
  assert.deepEqual(filterSearch('李克用亲子', 'person').map(person => person.id), ['li-cunxu']);
  assert.ok(filterSearch('李克用养子', 'person').some(person => person.id === 'li-siyuan'));
  const keyongMatches = new Set(filterSearch('李克用', 'person').map(person => person.id));
  assert.ok(memberIds.every(id => keyongMatches.has(id)));
  for (const id of ['old-v052', 'new-v36']) {
    assert.ok(libraryChapters.find(chapter => chapter.id === id).subjects.some(personId => memberIds.includes(personId)), id);
  }
});

test('thirteen historical people share a topic without duplicating the two existing emperors', () => {
  assert.equal(taibaoGroup.schemaVersion, 1);
  assert.equal(taibaoGroup.id, 'thirteen-taibao');
  assert.deepEqual(taibaoGroup.memberIds, memberIds);
  assert.equal(new Set(taibaoGroup.memberIds).size, 13);
  assert.deepEqual(new Set(taibaoGroup.people.map(person => person.id)), new Set(newIds));
  assert.equal(people.length, expectedCatalogIds.size);
  assert.deepEqual(new Set(people.map(person => person.id)), expectedCatalogIds);
  assert.equal(peopleForGroup(people, 'all').length, expectedCatalogIds.size);
  assert.deepEqual(peopleForGroup(people, 'thirteen-taibao').map(person => person.id), memberIds);
  assert.deepEqual(peopleForGroup(people, 'emperors'), reigningEmperors);
  assert.equal(taibaoGroup.memberRelations['li-cunxu'], '李克用亲子');
  assert.equal(taibaoGroup.memberRelations['li-siyuan'], '李克用养子');
  for (const id of ['li-siyuan', 'li-cunxu']) {
    assert.equal(people.find(person => person.id === id), reigningEmperors.find(person => person.id === id));
  }
});

test('the topic keeps the historical relationship and actual period distinct from imperial reigns', () => {
  assert.ok(taibaoGroup.description.includes('亲子') && taibaoGroup.description.includes('将领'));
  assert.ok(taibaoGroup.sourceNote.includes('排行') && taibaoGroup.sourceNote.includes('演义'));
  for (const person of taibaoGroup.people) {
    assert.ok(person.name.trim() && person.role.trim() && person.intro.trim(), person.id);
    assert.equal(typeof person.aliases, 'string', person.id);
    assert.equal(person.dynasty, '后唐', `${person.id}: catalog affiliation`);
    assert.ok(displayedDynasties.includes(person.dynasty));
    assert.ok(person.periodLabel.startsWith('唐末'), `${person.id}: actual period`);
    assert.equal(personDisplayPeriod(person), person.periodLabel);
    assert.ok(person.relation?.trim(), person.id);
    assert.equal(person.event, undefined, `${person.id}: no unrelated foundation event`);
    for (const key of ['reign', 'reignStart', 'reignEnd']) assert.equal(person[key], undefined, `${person.id}: ${key}`);
    assert.ok(person.sources.length > 0, person.id);
    for (const source of person.sources) {
      assert.ok(source.title.trim());
      const url = new URL(source.url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username + url.password, '');
    }
  }
  for (const id of ['shi-jingsi', 'kang-junli']) {
    assert.ok(taibaoGroup.people.find(person => person.id === id).relation.includes('部将'));
  }
  assert.deepEqual(filterSearch('赵匡胤', 'person'), []);
  assert.equal(people.some(person => person.dynasty === '宋'), false);
});

test('aliases find one canonical person and related chapters, while period labels stay accurate', () => {
  for (const [query, id] of [['李存审', 'fu-cunshen'], ['符存審', 'fu-cunshen'], ['安敬思', 'li-cunxiao'], ['王贤', 'li-cunxian'], ['李进通', 'li-sizhao'], ['孙重进', 'li-cunjin']]) {
    assert.deepEqual(filterSearch(query, 'person').map(person => person.id), [id], query);
    assert.ok(chaptersForPerson(id).length > 0, `${query}: originals remain available through the person`);
  }
  for (const id of newIds) {
    const person = people.find(person => person.id === id);
    const result = filterSearch(person.name, 'person').find(item => item.id === id);
    assert.ok(result, id);
    assert.ok(result.summary.startsWith(person.periodLabel), id);
    assert.equal(result.summary.includes('在位'), false, id);
  }
});

test('every new person opens a verified main biography in the correct official history', () => {
  for (const person of taibaoGroup.people) {
    const entries = chaptersForPerson(person.id);
    for (const bookId of ['old', 'new']) {
      const preferred = preferredChapterForPerson(bookId, person.id);
      assert.equal(preferred?.id, person.readingStarts[bookId], `${person.id}: ${bookId}`);
      assert.equal(preferred.bookId, bookId);
      assert.ok(preferred.subjects.includes(person.id));
      const route = resolveReadingRoute(chapterRoute(preferred));
      assert.equal(route.book.id, bookId);
      assert.equal(route.chapter.id, preferred.id);
    }
    for (const entry of entries) {
      const resolved = resolveReadingRoute(chapterRoute(entry));
      assert.equal(resolved.chapter.id, entry.id);
      assert.equal(resolved.book.id, entry.bookId);
    }
  }
  assert.equal(preferredChapterForPerson('old', 'fu-cunshen').id, 'old-v056');
  assert.equal(preferredChapterForPerson('new', 'fu-cunshen').id, 'new-v25');
  assert.equal(preferredChapterForPerson('old', 'shi-jingsi').id, 'old-v055');
  assert.equal(preferredChapterForPerson('new', 'shi-jingsi').id, 'new-v25');
  assert.equal(preferredChapterForPerson('new', 'li-cunxiao').id, 'new-v36');
});

test('incorrect preferred metadata for a new person cannot cross books or people', () => {
  const person = taibaoGroup.people.find(person => person.id === 'fu-cunshen');
  const saved = person.readingStarts.old;
  const unrelated = libraryChapters.find(chapter => chapter.bookId === 'old' && !chapter.subjects.includes(person.id));
  assert.ok(unrelated);
  try {
    for (const invalid of ['new-v25', unrelated.id, 'missing-chapter']) {
      person.readingStarts.old = invalid;
      const chosen = preferredChapterForPerson('old', person.id);
      assert.equal(chosen.bookId, 'old');
      assert.ok(chosen.subjects.includes(person.id));
      assert.notEqual(chosen.id, invalid);
    }
  } finally {
    person.readingStarts.old = saved;
  }
});

test('all six complete added volumes include published translations bound to unchanged originals', () => {
  const ids = ['old-v052', 'old-v053', 'old-v055', 'old-v056', 'new-v25', 'new-v36'];
  const library = loadLibrary();
  const published = new Map(loadPublishedChapters(library).map(chapter => [chapter.id, chapter]));
  for (const id of ids) {
    const original = library.chapters.find(chapter => chapter.id === id);
    const chapter = published.get(id);
    assert.ok(original && chapter, id);
    assert.equal(chapter.scope, 'full');
    assert.equal(chapter.paragraphs.length, original.paragraphs.length);
    for (const [index, paragraph] of chapter.paragraphs.entries()) {
      assert.equal(paragraph.id, original.paragraphs[index].id);
      assert.equal(paragraph.revision, original.paragraphs[index].revision);
      assert.equal(paragraph.original, original.paragraphs[index].original);
      assert.ok(paragraph.translation?.text.trim(), `${paragraph.id}: published translation`);
    }
  }
});
