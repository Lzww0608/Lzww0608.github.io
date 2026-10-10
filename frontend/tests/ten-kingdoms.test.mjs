import test from 'node:test';
import assert from 'node:assert/strict';
import { people, events, displayedDynasties, fiveDynasties, tenKingdomDynasties, filterSearch } from '../src/data.ts';
import { tenKingdomRulers, reigningEmperors, peopleForGroup, personMatchesGroup, personTopicRelationships } from '../src/person-catalog.ts';
import { chapterRoute, preferredChapterForPerson, resolveReadingRoute, personSourcesRoute, resolvePersonSourcesRoute, personPassageBooks } from '../src/library.ts';
import { buildRelationshipNodes, searchRelationshipNodes } from '../src/relationships.ts';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import rulerCatalog from '../../content/five-dynasties/ten-kingdoms-rulers.json' with { type: 'json' };

test('the Ten Kingdoms collection includes actual reigning rulers of all ten states without exposing other eras', () => {
  assert.equal(rulerCatalog.schemaVersion, 1);
  assert.equal(rulerCatalog.scope, 'ten-kingdoms-rulers');
  assert.equal(tenKingdomRulers.length, 43);
  assert.equal(new Set(tenKingdomRulers.map(person => person.id)).size, 43);
  assert.deepEqual(displayedDynasties, [...fiveDynasties, ...tenKingdomDynasties]);
  const counts = new Map([['吴', 4], ['南唐', 3], ['吴越', 5], ['前蜀', 2], ['后蜀', 2], ['南汉', 4], ['楚', 6], ['闽', 8], ['南平', 5], ['北汉', 4]]);
  assert.deepEqual(new Set(tenKingdomRulers.map(person => person.dynasty)), new Set(counts.keys()));
  for (const [dynasty, count] of counts) assert.equal(tenKingdomRulers.filter(person => person.dynasty === dynasty).length, count, dynasty);
  assert.equal(people.some(person => person.dynasty === '宋'), false);
  assert.equal(events.some(event => event.dynasty === '宋'), false);
  assert.deepEqual(filterSearch('赵匡胤'), []);
  const disputed = tenKingdomRulers.find(person => person.name === '卓俨明');
  assert.equal(disputed?.dynasty, '闽');
  assert.equal(disputed.reignStart, 945);
  assert.equal(disputed.reignEnd, 945);
  assert.match(disputed.intro, /福州|局部/);
  const byName = new Map(tenKingdomRulers.map(person => [person.name, person]));
  assert.equal(byName.get('李煜').reignEnd, 976);
  assert.match(byName.get('李煜').sourceNotes.join(' '), /开宝八年十一月乙未/);
  assert.equal(byName.get('钱弘倧').reignEnd, 948);
  assert.equal(byName.get('马希广').reignEnd, 951);
  assert.equal(byName.get('刘继元').reignEnd, 979);
});

test('Ten Kingdoms filtering, person search and graph candidates share the same canonical identities', () => {
  const ids = tenKingdomRulers.map(person => person.id);
  assert.deepEqual(peopleForGroup(people, 'ten-kingdoms-rulers'), tenKingdomRulers);
  assert.deepEqual(peopleForGroup(people, 'emperors'), reigningEmperors);
  assert.deepEqual(new Set(filterSearch('十国君主').map(person => person.id)), new Set(ids));
  assert.deepEqual(new Set(filterSearch('荆南').filter(person => person.dynasty === '南平').map(person => person.id)), new Set(tenKingdomRulers.filter(person => person.dynasty === '南平').map(person => person.id)));
  const nodes = buildRelationshipNodes(people);
  for (const person of tenKingdomRulers) {
    assert.equal(people.find(entry => entry.id === person.id), person, person.id);
    assert.equal(personMatchesGroup(person, 'ten-kingdoms-rulers'), true, person.id);
    assert.equal(personMatchesGroup(person, 'emperors'), false, person.id);
    assert.ok(filterSearch(person.name).some(entry => entry.id === person.id), person.id);
    assert.ok(searchRelationshipNodes(person.name, nodes, people).some(node => node.id === person.id), person.id);
    assert.deepEqual(personTopicRelationships(person), [], `${person.id}: collection membership is not a commander relationship`);
  }
});

test('the Former Shu king and Hedong general with the Wang Jian name remain separate searchable people', () => {
  const king = people.find(person => person.id === 'wang-jian-former-shu');
  const general = people.find(person => person.id === 'wang-jianji');
  assert.equal(king.name, '王建');
  assert.equal(king.dynasty, '前蜀');
  assert.equal(general.name, '王建及');
  assert.equal(general.dynasty, '后唐');
  const matches = new Set(filterSearch('王建').map(person => person.id));
  assert.ok(matches.has(king.id));
  assert.ok(matches.has(general.id));
  assert.equal(peopleForGroup(people, 'ten-kingdoms-rulers').some(person => person.id === general.id), false);
});

test('every Ten Kingdoms ruler has attributable reign metadata and archived originals with published translations', () => {
  const library = loadLibrary();
  const published = new Map(loadPublishedChapters(library).map(chapter => [chapter.id, chapter]));
  for (const person of tenKingdomRulers) {
    assert.ok(person.role.trim() && person.intro.trim(), person.id);
    assert.ok(Number.isSafeInteger(person.reignStart) && Number.isSafeInteger(person.reignEnd), person.id);
    assert.ok(person.reignStart <= person.reignEnd, person.id);
    assert.ok(person.reign.includes(String(person.reignStart)) && person.reign.includes(String(person.reignEnd)), person.id);
    assert.ok(person.sources.length, person.id);
    for (const source of person.sources) {
      assert.ok(source.title.trim(), person.id);
      assert.equal(new URL(source.url).protocol, 'https:', person.id);
    }
    const entrances = Object.entries(person.readingStarts);
    assert.ok(entrances.length, person.id);
    for (const [bookId, chapterId] of entrances) {
      const chapter = preferredChapterForPerson(bookId, person.id);
      assert.equal(chapter?.id, chapterId, `${person.id}: ${bookId}`);
      const route = resolveReadingRoute(chapterRoute(chapter));
      assert.equal(route.book.id, bookId);
      assert.equal(route.chapter.id, chapterId);
      const text = published.get(chapterId);
      assert.ok(text?.paragraphs.length, `${person.id}: ${chapterId}`);
      assert.ok(text.paragraphs.every(paragraph => paragraph.translation?.text.trim()), `${person.id}: published full translations`);
    }
    const passageBooks = personPassageBooks(person.id);
    assert.ok(passageBooks.length, `${person.id}: indexed literature entrances`);
    for (const summary of passageBooks) {
      const route = resolvePersonSourcesRoute(personSourcesRoute(person.id, summary.bookId));
      assert.equal(route.person.id, person.id);
      assert.equal(route.book.id, summary.bookId);
      assert.ok(summary.passageCount > 0 && summary.chapterCount > 0);
    }
  }
});
