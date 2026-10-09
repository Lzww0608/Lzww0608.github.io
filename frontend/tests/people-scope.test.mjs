import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { people, searchItems, filterSearch } from '../src/data.ts';
import { personGroups, personTopics, peopleForGroup, personMatchesGroup, personTopic, personTopicRelationships, topicsForPerson } from '../src/person-catalog.ts';
import { chapterRoute, preferredChapterForPerson, resolveRoute, resolveReadingRoute } from '../src/library.ts';

const topics = ['taibao.json', 'zhu-wen-generals.json'].map(file => JSON.parse(readFileSync(new URL(`../../content/five-dynasties/${file}`, import.meta.url), 'utf8')));
const generals = topics.find(topic => topic.id === 'zhu-wen-generals');

test('retired page addresses and the root resolve to people while original reading links remain valid', () => {
  for (const hash of ['', '#', '#overview', '#timeline', '#sources', '#map', '#unknown']) {
    assert.equal(resolveRoute(hash), 'people', hash);
  }
  assert.equal(resolveRoute('#people'), 'people');
  for (const route of ['read-old/old-v056', 'read-new/new-v36', 'read-tongjian/tongjian-v294']) {
    assert.equal(resolveRoute(`#${route}`), route);
    assert.ok(resolveReadingRoute(route));
  }
});

test('public search returns existing people without exposing retired events or source catalog entries', () => {
  assert.equal(searchItems.length, people.length);
  assert.ok(searchItems.every(item => item.type === 'person'));
  assert.deepEqual(new Set(filterSearch('').map(item => item.id)), new Set(people.map(person => person.id)));
  assert.deepEqual(filterSearch('资治通鉴'), []);
  assert.deepEqual(filterSearch('', 'book'), []);
  assert.deepEqual(filterSearch('', 'event'), []);
  assert.deepEqual(filterSearch('安敬思').map(person => person.id), ['li-cunxiao']);
});

test('each registered topic filters only its members in source order without changing canonical identity', () => {
  assert.deepEqual(personTopics.map(topic => topic.id), topics.map(topic => topic.id));
  assert.deepEqual(personGroups.map(group => group.id), ['all', 'emperors', ...topics.map(topic => topic.id)]);
  for (const topic of topics) {
    const members = peopleForGroup(people, topic.id);
    assert.deepEqual(members.map(person => person.id), topic.memberIds, topic.id);
    assert.equal(new Set(topic.memberIds).size, topic.memberIds.length, topic.id);
    for (const person of people) {
      assert.equal(personMatchesGroup(person, topic.id), topic.memberIds.includes(person.id), `${topic.id}: ${person.id}`);
      assert.equal(topicsForPerson(person).some(entry => entry.id === topic.id), topic.memberIds.includes(person.id), `${topic.id}: ${person.id}`);
    }
    assert.ok(members.every(person => person === people.find(entry => entry.id === person.id)), topic.id);
    const subset = members.slice(0, 2).reverse();
    assert.deepEqual(peopleForGroup(subset, topic.id).map(person => person.id), topic.memberIds.filter(id => subset.some(person => person.id === id)));
    assert.equal(personTopic(topic.id).title, topic.title);
  }
  assert.equal(personTopic('all'), undefined);
  assert.equal(personTopic('emperors'), undefined);
  assert.equal(personTopic('unknown-topic'), undefined);
  assert.deepEqual(peopleForGroup(people, 'unknown-topic'), []);
});

test('topic and commander searches find Zhu Wen generals without assigning them Li Keyong topic relations', () => {
  assert.equal(generals.relationshipSubject, '朱温');
  assert.ok(generals.memberIds.length > 0);
  assert.deepEqual(new Set(filterSearch(generals.title).map(person => person.id)), new Set(generals.memberIds));
  const commanderMatches = new Set(filterSearch('朱温').map(person => person.id));
  assert.ok(generals.memberIds.every(id => commanderMatches.has(id)));
  for (const id of generals.memberIds) {
    const person = people.find(person => person.id === id);
    assert.ok(person, id);
    const relations = personTopicRelationships(person);
    const relation = relations.find(entry => entry.groupId === generals.id);
    assert.equal(relation?.subject, '朱温', id);
    assert.ok(relation?.relation.trim(), id);
    assert.equal(relations.some(entry => entry.subject === '李克用'), topics[0].memberIds.includes(id), id);
    assert.ok(filterSearch(person.name).some(entry => entry.id === id), id);
    for (const field of ['reign', 'reignStart', 'reignEnd']) assert.equal(person[field], undefined, `${id}: no fictional imperial reign`);
    assert.ok(person.periodLabel?.trim(), `${id}: actual activity period`);
  }
  for (const id of ['li-siyuan', 'li-cunxu']) {
    const relation = personTopicRelationships(people.find(person => person.id === id)).find(entry => entry.groupId === 'thirteen-taibao');
    assert.equal(relation.subject, '李克用');
    assert.ok(relation.relation.includes('李克用'));
  }
});

test('every Zhu Wen general has attributed main reading entrances that stay in the correct book and person', () => {
  for (const person of generals.people) {
    assert.ok(person.sources?.length > 0, person.id);
    for (const source of person.sources) {
      assert.ok(source.title.trim(), person.id);
      assert.equal(new URL(source.url).protocol, 'https:', person.id);
    }
    assert.ok(Object.keys(person.readingStarts ?? {}).length > 0, person.id);
    for (const [bookId, chapterId] of Object.entries(person.readingStarts ?? {})) {
      const entry = preferredChapterForPerson(bookId, person.id);
      assert.equal(entry?.id, chapterId, `${person.id}: ${bookId}`);
      assert.equal(entry.bookId, bookId);
      assert.ok(entry.subjects.includes(person.id));
      const resolved = resolveReadingRoute(chapterRoute(entry));
      assert.equal(resolved.book.id, bookId);
      assert.equal(resolved.chapter.id, chapterId);
    }
  }
});
