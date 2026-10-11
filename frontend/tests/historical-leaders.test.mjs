import test from 'node:test';
import assert from 'node:assert/strict';
import leaderCatalog from '../../content/five-dynasties/historical-leaders.json' with { type: 'json' };
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { people, filterSearch } from '../src/data.ts';
import { catalogPeople, historicalLeaders, reigningEmperors, tenKingdomRulers, personTopics, peopleForGroup } from '../src/person-catalog.ts';
import { personSourcesRoute, resolvePersonSourcesRoute, resolveReadingRoute, preferredChapterForPerson, chapterRoute } from '../src/library.ts';
import { relationshipNodes, relationshipsForPerson, relationshipNeighborhood, searchRelationshipNodes } from '../src/relationships.ts';

const keyong = historicalLeaders.find(person => person.id === 'li-keyong');

test('Li Keyong has one canonical person identity without joining reigning rulers or his own officers', () => {
  assert.equal(leaderCatalog.schemaVersion, 1);
  assert.equal(leaderCatalog.scope, 'historical-leaders');
  assert.deepEqual(historicalLeaders, leaderCatalog.people);
  assert.ok(keyong);
  for (const collection of [catalogPeople, people, loadPassagePeople()]) {
    assert.equal(collection.filter(person => person.id === keyong.id).length, 1);
  }
  assert.equal(peopleForGroup(people, 'all').find(person => person.id === keyong.id), keyong);
  assert.equal(reigningEmperors.length, 14);
  assert.equal(tenKingdomRulers.length, 43);
  assert.ok(!peopleForGroup(people, 'emperors').some(person => person.id === keyong.id));
  assert.ok(!peopleForGroup(people, 'ten-kingdoms-rulers').some(person => person.id === keyong.id));
  assert.ok(personTopics.every(topic => !topic.memberIds.includes(keyong.id)));
});

test('Li Keyong distinguishes lifetime dates and posthumous titles from a reigning emperor', () => {
  assert.equal(keyong.dynasty, '后唐');
  assert.equal(keyong.periodLabel, '晚唐 · 河东／晋国');
  assert.equal(keyong.role, '河东节度使、晋王');
  assert.equal(keyong.lifespan, '856–908');
  assert.equal(keyong.birthYear, 856);
  assert.equal(keyong.deathYear, 908);
  assert.ok(keyong.sovereignTitle.includes('生前晋王') && keyong.sovereignTitle.includes('追尊'));
  assert.ok(keyong.statusNote.includes('身后') || keyong.statusNote.includes('追尊'));
  assert.ok(keyong.sourceNotes.some(note => note.includes('大中十年') && note.includes('天祐五年')));
  for (const field of ['reign', 'reignStart', 'reignEnd', 'event']) assert.equal(keyong[field], undefined, field);
});

test('canonical Li Keyong search and literature addresses use his stable ID', () => {
  for (const query of ['李克用', '独眼龙', '李鵶兒', '飞虎子']) {
    assert.ok(filterSearch(query).some(person => person.id === keyong.id), query);
    assert.ok(searchRelationshipNodes(query).some(node => node.id === keyong.id), query);
  }
  const match = filterSearch('独眼龙').find(person => person.id === keyong.id);
  assert.ok(match.summary.includes('生卒 856–908'));
  assert.ok(!match.summary.includes('在位'));
  for (const bookId of [undefined, 'old', 'new', 'tongjian']) {
    const route = personSourcesRoute(keyong.id, bookId);
    const result = resolvePersonSourcesRoute(route);
    assert.equal(result.person, keyong);
    assert.equal(result.book?.id, bookId);
  }
});

test('Li Keyong becomes a canonical graph node while existing facts update both endpoints once', () => {
  const nodes = relationshipNodes.filter(node => node.id === keyong.id);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].external, undefined);
  assert.equal(nodes[0].name, keyong.name);
  assert.equal(nodes[0].group, keyong.dynasty);
  assert.ok(relationshipNodes.some(node => node.id === 'li-kerou' && node.external));
  const neighborhood = relationshipNeighborhood(keyong.id);
  assert.ok(neighborhood.relationships.length > 0);
  assert.ok(neighborhood.nodes.some(node => node.id === keyong.id && !node.external));
  for (const relation of neighborhood.relationships) {
    assert.ok(relation.from === keyong.id || relation.to === keyong.id);
    for (const endpoint of [relation.from, relation.to]) {
      assert.equal(relationshipsForPerson(endpoint).filter(item => item.id === relation.id).length, 1, `${endpoint}: ${relation.id}`);
    }
  }
});

test('Li Keyong has attributed complete main readings in both histories without changing their subjects', () => {
  const chapters = new Map(loadLibrary().chapters.map(chapter => [chapter.id, chapter]));
  assert.deepEqual(keyong.readingStarts, { old: 'old-v025', new: 'new-v04' });
  assert.ok(keyong.sources.some(source => source.url.endsWith('/卷25')));
  assert.ok(keyong.sources.some(source => source.url.endsWith('/卷26')));
  const birth = chapters.get('old-v025');
  const death = chapters.get('old-v026');
  assert.ok(birth?.scope === 'full');
  assert.ok(death?.scope === 'full');
  assert.ok(birth.paragraphs.some(paragraph => paragraph.original.includes('大中十年丙子歲')));
  assert.ok(death.paragraphs.some(paragraph => paragraph.original.includes('追諡武皇帝，廟號太祖')));
  for (const [bookId, chapterId] of Object.entries(keyong.readingStarts)) {
    const chapter = preferredChapterForPerson(bookId, keyong.id);
    assert.equal(chapter?.id, chapterId, bookId);
    assert.ok(chapter.subjects.includes(keyong.id));
    const resolved = resolveReadingRoute(chapterRoute(chapter));
    assert.equal(resolved.book.id, bookId);
    assert.equal(resolved.chapter.id, chapterId);
  }
});
