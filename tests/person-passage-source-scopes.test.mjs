import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../content/person-passages.mjs';
import { buildPersonPassageIndex } from '../scripts/index-person-passages.mjs';

const library = loadLibrary();
const rules = JSON.parse(readFileSync(new URL('../content/person-passages/rules.json', import.meta.url), 'utf8'));
const savedIndex = loadPersonPassageIndex(library);
const findAssociation = (index, paragraphId, personId) => index.passages.find(passage => passage.spans[0].paragraphId === paragraphId)
  ?.people.find(person => person.personId === personId);

function withSourceFixtures() {
  const copy = structuredClone(library);
  for (const [bookId, id] of [['songshu', 'songshu-v999'], ['nanshi', 'nanshi-v999'], ['tongjian', 'tongjian-v130'], ['huiyao', 'huiyao-v999']]) {
    if (!copy.catalog.books.some(book => book.id === bookId)) copy.catalog.books.push({ id: bookId, title: `Test ${bookId}` });
    assert.ok(!copy.chapters.some(chapter => chapter.id === id), `reserved fixture chapter ${id}`);
    copy.chapters.push({ id, bookId, position: 999, title: `Test ${id}`, paragraphs: [
      { id: `${id}-p1`, position: 1, revision: 1, original: '朱全忠與梁太祖皆是測試同名字串，全忠、王建、武皇亦然。天成二年七月敕：「依舊。」' },
    ] });
  }
  return copy;
}

test('the Southern emperors topic is part of the same canonical identity registry', () => {
  const topic = JSON.parse(readFileSync(new URL('../content/southern-northern/emperors.json', import.meta.url), 'utf8'));
  const canonical = loadPassagePeople();
  assert.equal(topic.id, 'southern-emperors');
  for (const person of topic.people) {
    assert.deepEqual(canonical.filter(candidate => candidate.id === person.id), [{ id: person.id, name: person.name }]);
  }
  assert.equal(new Set(canonical.map(person => person.id)).size, canonical.length);
});

test('adding new books or earlier chapters of an existing book preserves every existing passage object', () => {
  assert.deepEqual(buildPersonPassageIndex(library, rules), savedIndex);
  const expanded = buildPersonPassageIndex(withSourceFixtures(), rules);
  assert.deepEqual(expanded.people, savedIndex.people);
  assert.deepEqual(expanded.passages, savedIndex.passages);
  assert.equal(expanded.coverage.chapterCount, savedIndex.coverage.chapterCount + 4);
  assert.equal(expanded.coverage.paragraphCount, savedIndex.coverage.paragraphCount + 4);
});

test('per-person book and chapter selectors allow only their declared automatic source matches', () => {
  const copy = structuredClone(rules);
  copy.people.find(person => person.personId === 'zhu-wen').sourceScope = {
    bookIds: ['songshu'], chapterIds: ['nanshi-v999'],
  };
  const expanded = buildPersonPassageIndex(withSourceFixtures(), copy);
  for (const id of ['songshu-v999-p1', 'nanshi-v999-p1']) {
    assert.deepEqual(findAssociation(expanded, id, 'zhu-wen'), { personId: 'zhu-wen', kind: 'record' });
    assert.deepEqual(expanded.passages.find(passage => passage.spans[0].paragraphId === id).people, [{ personId: 'zhu-wen', kind: 'record' }]);
  }
  for (const id of ['tongjian-v130-p1', 'huiyao-v999-p1']) assert.equal(findAssociation(expanded, id, 'zhu-wen'), undefined);
});

test('registered per-person source scopes override the default and constrain regnal inference too', () => {
  const copy = structuredClone(rules);
  copy.sourceScopes['test-reviewed-chapter'] = { chapterIds: ['huiyao-v999'] };
  copy.people.find(person => person.personId === 'li-siyuan').sourceScope = 'test-reviewed-chapter';
  const expanded = buildPersonPassageIndex(withSourceFixtures(), copy);
  assert.deepEqual(findAssociation(expanded, 'huiyao-v999-p1', 'li-siyuan'), { personId: 'li-siyuan', kind: 'record' });
  for (const id of ['songshu-v999-p1', 'nanshi-v999-p1', 'tongjian-v130-p1']) {
    assert.equal(findAssociation(expanded, id, 'li-siyuan'), undefined);
  }
});

test('an empty automatic scope preserves precise chapter ranges and version-bound attributions', () => {
  const copy = structuredClone(rules);
  copy.people.find(person => person.personId === 'li-keyong').sourceScope = { bookIds: [], chapterIds: [] };
  copy.sections.push({ personId: 'li-keyong', chapterId: 'songshu-v999', start: 1, end: 1,
    startText: '朱全忠與梁太祖', endText: '朱全忠與梁太祖', terms: ['武皇'], kind: 'mention', label: 'Explicit fixture reference' });
  const expanded = buildPersonPassageIndex(withSourceFixtures(), copy);
  assert.deepEqual(findAssociation(expanded, 'songshu-v999-p1', 'li-keyong'), { personId: 'li-keyong', kind: 'mention' });
  assert.equal(findAssociation(expanded, 'nanshi-v999-p1', 'li-keyong'), undefined);
  const verified = JSON.parse(readFileSync(new URL('../content/person-passages/verified-attributions.json', import.meta.url), 'utf8'));
  for (const entry of verified.entries.filter(entry => entry.personId === 'li-keyong')) {
    assert.ok(findAssociation(expanded, entry.paragraphId, entry.personId), entry.paragraphId);
  }
  assert.equal(findAssociation(expanded, 'old-v025-p1', 'li-keyong')?.kind, 'biography');
});

test('source scope configuration fails closed on missing registries and malformed or unknown selectors', () => {
  const invalid = change => {
    const copy = structuredClone(rules); change(copy);
    assert.throws(() => buildPersonPassageIndex(library, copy), /source scope/);
  };
  invalid(copy => delete copy.sourceScopes);
  invalid(copy => copy.sourceScopes = []);
  invalid(copy => delete copy.defaultSourceScope);
  invalid(copy => copy.defaultSourceScope = 'unregistered');
  invalid(copy => copy.sourceScopes.bad = { bookIds: ['unknown'] });
  invalid(copy => copy.sourceScopes.bad = { chapterIds: ['tongjian-v130'] });
  invalid(copy => copy.sourceScopes.bad = { bookIds: ['old', 'old'] });
  invalid(copy => copy.sourceScopes.bad = { chapterIds: ['old-v001', 'old-v001'] });
  invalid(copy => copy.sourceScopes.bad = { bookIds: ['old'], except: [] });
  invalid(copy => copy.sourceScopes.bad = {});
  invalid(copy => copy.sourceScopes.bad = { chapterIds: 'old-v001' });
  invalid(copy => copy.people[0].sourceScope = 'unregistered');
  invalid(copy => copy.people[0].sourceScope = null);
  invalid(copy => copy.people[0].sourceScope = {});
  invalid(copy => copy.people[0].sourceScope = { chapterIds: ['unknown'] });
});
