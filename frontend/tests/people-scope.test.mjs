import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { people, searchItems, filterSearch } from '../src/data.ts';
import { personGroups, personTopics, peopleForGroup, personMatchesGroup, personTopic, personTopicRelationships, topicsForPerson } from '../src/person-catalog.ts';
import { chapterRoute, preferredChapterForPerson, resolveRoute, resolveReadingRoute } from '../src/library.ts';
import { loadPassagePeople } from '../../content/person-passages.mjs';

const catalogRoot = new URL('../../content/five-dynasties/', import.meta.url);
const catalogs = readdirSync(catalogRoot).filter(file => file.endsWith('.json')).map(file =>
  JSON.parse(readFileSync(new URL(file, catalogRoot), 'utf8'))).filter(catalog => Array.isArray(catalog.people));
const topics = catalogs.filter(catalog => Array.isArray(catalog.memberIds));
const generals = topics.find(topic => topic.id === 'zhu-wen-generals');
const keyongGenerals = topics.find(topic => topic.id === 'li-keyong-generals');

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
  assert.equal(new Set(personTopics.map(topic => topic.id)).size, topics.length);
  assert.deepEqual(new Set(personTopics.map(topic => topic.id)), new Set(topics.map(topic => topic.id)));
  assert.deepEqual(personGroups.map(group => group.id), ['all', 'emperors', ...personTopics.map(topic => topic.id)]);
  for (const topic of topics) {
    const members = peopleForGroup(people, topic.id);
    assert.deepEqual(members.map(person => person.id), topic.memberIds, topic.id);
    assert.equal(new Set(topic.memberIds).size, topic.memberIds.length, topic.id);
    assert.ok(topic.people.every(person => topic.memberIds.includes(person.id)), `${topic.id}: new people belong to the topic`);
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

test('frontend and passage catalogs cover the same unique people, including members shared between topics', () => {
  const originals = catalogs.flatMap(catalog => catalog.people);
  const canonicalIds = new Set(originals.map(person => person.id));
  assert.equal(originals.length, canonicalIds.size, 'shared topic members reuse IDs without repeating canonical people');
  assert.equal(people.length, canonicalIds.size);
  assert.equal(new Set(people.map(person => person.id)).size, people.length);
  assert.deepEqual(new Map(people.map(({ id, name }) => [id, name])), new Map(loadPassagePeople().map(({ id, name }) => [id, name])));
  assert.deepEqual(new Set(people.map(person => person.id)), canonicalIds);
  for (const topic of topics) {
    for (const id of topic.memberIds) assert.ok(canonicalIds.has(id), `${topic.id}: registered member ${id}`);
  }
});

test('topic and commander searches keep Zhu Wen generals under the correct topic relationships', () => {
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
    assert.equal(relations.some(entry => entry.subject === '李克用'), topics.some(topic => personTopic(topic.id)?.relationshipSubject === '李克用'
      && topic.memberIds.includes(id)), id);
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

test('Li Keyong generals reuse established identities and display their own commander relationship', () => {
  assert.ok(keyongGenerals?.people.length > 0);
  assert.equal(keyongGenerals.relationshipSubject, '李克用');
  assert.equal(keyongGenerals.memberIds.includes('li-keyong'), false, 'the commander remains a context node');
  assert.equal(people.some(person => person.id === 'li-keyong'), false);
  assert.deepEqual(new Set(filterSearch(keyongGenerals.title).map(person => person.id)), new Set(keyongGenerals.memberIds));
  const commanderMatches = new Set(filterSearch('李克用').map(person => person.id));
  const newIds = new Set(keyongGenerals.people.map(person => person.id));
  const reusedIds = keyongGenerals.memberIds.filter(id => !newIds.has(id));
  assert.ok(reusedIds.length > 0, 'already collected generals remain the same people');
  for (const id of keyongGenerals.memberIds) {
    const person = people.find(person => person.id === id);
    assert.ok(commanderMatches.has(id), id);
    assert.ok(filterSearch(person.name).some(entry => entry.id === id), id);
    const relation = personTopicRelationships(person).find(entry => entry.groupId === keyongGenerals.id);
    assert.equal(relation?.subject, '李克用', id);
    assert.equal(relation?.relation, keyongGenerals.memberRelations?.[id] ?? keyongGenerals.people.find(entry => entry.id === id)?.relation, id);
    assert.ok(relation?.relation.trim(), id);
  }
  for (const id of reusedIds) {
    assert.ok(catalogs.filter(catalog => catalog.id !== keyongGenerals.id).some(catalog => catalog.people.some(person => person.id === id)), id);
    assert.equal(peopleForGroup(people, keyongGenerals.id).find(person => person.id === id), people.find(person => person.id === id), id);
  }
  for (const person of keyongGenerals.people) {
    assert.equal(person.dynasty, '后唐', `${person.id}: historical lineage`);
    assert.ok(person.periodLabel?.trim(), `${person.id}: actual activity period`);
    assert.equal(person.event, undefined, `${person.id}: no unrelated foundation event`);
    for (const field of ['reign', 'reignStart', 'reignEnd']) assert.equal(person[field], undefined, `${person.id}: no fictional imperial reign`);
  }
});

test('every newly collected general has attributed main reading entrances that stay in the correct book and person', () => {
  for (const person of [...generals.people, ...keyongGenerals.people]) {
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
