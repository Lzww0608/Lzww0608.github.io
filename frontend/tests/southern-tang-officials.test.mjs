import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../content/five-dynasties/southern-tang-officials.json' with { type: 'json' };
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { people, filterSearch } from '../src/data.ts';
import { catalogPeople, personTopics, peopleForGroup, personTopicRelationships } from '../src/person-catalog.ts';
import { preferredChapterForPerson, personSourcesRoute, resolvePersonSourcesRoute } from '../src/library.ts';
import { relationshipNodes, relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';

const library = loadLibrary();
const index = loadPersonPassageIndex(library);

test('civil officials share one identity across person lists, searches and their own topic', () => {
  const topic = personTopics.find(topic => topic.id === catalog.id);
  assert.ok(topic);
  assert.equal(topic.relationshipSubject, undefined);
  assert.deepEqual(topic.memberIds, catalog.people.map(person => person.id));
  assert.deepEqual(peopleForGroup(people, topic.id).map(person => person.id), topic.memberIds);
  for (const person of catalog.people) {
    for (const collection of [catalogPeople, people, loadPassagePeople(), relationshipNodes]) {
      assert.equal(collection.filter(item => item.id === person.id).length, 1, person.id);
    }
    for (const group of ['emperors', 'ten-kingdoms-rulers', 'li-keyong-generals', 'zhu-wen-generals']) {
      assert.ok(!peopleForGroup(people, group).some(item => item.id === person.id));
    }
    assert.equal(personTopicRelationships(person).length, 0);
    for (const field of ['reign', 'reignStart', 'reignEnd', 'event']) assert.equal(person[field], undefined);
    assert.ok(filterSearch(person.name).some(item => item.id === person.id));
    assert.ok(searchRelationshipNodes(person.name).some(item => item.id === person.id));
  }
});

test('civilian source entrances resolve attributed complete chapters and individual records', () => {
  for (const person of catalog.people) {
    assert.ok(person.sources.length > 0);
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      const chapter = preferredChapterForPerson(bookId, person.id);
      assert.equal(chapter?.id, chapterId, `${person.id}/${bookId}`);
      assert.ok(index.passages.some(passage => passage.chapterId === chapterId && passage.people.some(item => item.personId === person.id)));
      assert.equal(resolvePersonSourcesRoute(personSourcesRoute(person.id, bookId)).person.id, person.id);
    }
    assert.ok(index.passages.some(passage => passage.people.some(item => item.personId === person.id)));
    assert.ok(loadPersonTimelines(library).find(document => document.personId === person.id).events.length > 0);
  }
});

test('civilian relationships have source text and appear exactly once for both endpoints', () => {
  const originals = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph.original])));
  for (const person of catalog.people) {
    const relations = relationshipsForPerson(person.id);
    assert.ok(relations.length > 0, person.id);
    for (const relation of relations) {
      for (const endpoint of [relation.from, relation.to]) assert.equal(relationshipsForPerson(endpoint).filter(item => item.id === relation.id).length, 1);
      for (const source of relation.sources) assert.ok(originals.get(source.paragraphId)?.includes(source.excerpt), relation.id);
    }
  }
});

test('Song Qiqiu attribution excludes a title-only paragraph and an unresolved same-surname reference', () => {
  for (const query of ['宋齐丘', '宋齊丘', '宋子嵩', '九华先生', '九華先生']) {
    assert.ok(filterSearch(query).some(person => person.id === 'song-qiqiu'), query);
    assert.ok(searchRelationshipNodes(query).some(person => person.id === 'song-qiqiu'), query);
  }
  for (const paragraphId of ['shibu-v002-p27', 'old-v070-p6']) {
    assert.ok(!index.passages.some(passage => passage.spans.some(span => span.paragraphId === paragraphId) && passage.people.some(person => person.personId === 'song-qiqiu')), paragraphId);
  }
  assert.ok(index.passages.some(passage => passage.spans.some(span => span.paragraphId === 'shibu-v002-p28') && passage.people.some(person => person.personId === 'song-qiqiu')));
  assert.ok(library.chapters.find(chapter => chapter.id === 'shibu-v002').paragraphs.find(paragraph => paragraph.id === 'shibu-v002-p27'));
});

test('Han Xizai keeps source-backed context aliases outside canonical identities and excludes a bare heading', () => {
  for (const query of ['韩熙载', '韓熙載', '熙载', '熙載', '韓熙']) {
    assert.ok(filterSearch(query).some(person => person.id === 'han-xizai'), query);
    assert.ok(searchRelationshipNodes(query).some(person => person.id === 'han-xizai'), query);
  }
  for (const query of ['韩叔嗣', '韓叔嗣']) {
    assert.deepEqual(searchRelationshipNodes(query).map(node => node.id), ['han-shusi']);
    assert.ok(!filterSearch(query).some(person => person.id === 'han-shusi'));
  }
  const father = relationshipNodes.find(node => node.id === 'han-shusi');
  assert.ok(father?.external);
  for (const collection of [catalogPeople, loadPassagePeople(), catalog.people]) assert.ok(!collection.some(person => person.id === father.id));
  const paternal = relationshipsForPerson('han-xizai').filter(edge => edge.from === father.id && edge.kind === 'kinship');
  assert.equal(paternal.length, 1);
  assert.equal(relationshipsForPerson(father.id).filter(edge => edge.id === paternal[0].id).length, 1);
  assert.ok(!index.passages.some(passage => passage.spans.some(span => span.paragraphId === 'shibu-v005-p39') && passage.people.some(person => person.personId === 'han-xizai')));
  assert.ok(index.passages.some(passage => passage.spans.some(span => span.paragraphId === 'shibu-v005-p40') && passage.people.some(person => person.personId === 'han-xizai')));
});
