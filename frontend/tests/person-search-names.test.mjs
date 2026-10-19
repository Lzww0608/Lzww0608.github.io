import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import index from '../src/generated/person-search-names.json' with { type: 'json' };
import { buildPersonSearchNames, buildSearchFoldCharacters, closeSearchFoldCharacters } from '../scripts/person-search-names.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { filterSearch } from '../src/data.ts';
import { searchRelationshipNodes } from '../src/relationships.ts';
import { catalogPeople } from '../src/person-catalog.ts';
import { matchesPersonSearch, normalizePersonSearch, personSearchNames } from '../src/person-search-names.ts';

test('generated full-name search index tracks the checked rules without their local matching rules', () => {
  const source = readFileSync(new URL('../../content/person-passages/rules.json', import.meta.url));
  const rules = JSON.parse(source.toString('utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.sourceSha256, createHash('sha256').update(source).digest('hex'));
  const people = new Set(loadPassagePeople().map(person => person.id));
  assert.deepEqual(Object.keys(index.namesByPerson).sort(), rules.people.map(rule => rule.personId).sort());
  for (const rule of rules.people) {
    assert.ok(people.has(rule.personId));
    assert.deepEqual(index.namesByPerson[rule.personId], [...new Set(rule.names)]);
  }
  assert.deepEqual(Object.keys(index).sort(), ['namesByPerson', 'schemaVersion', 'searchFoldCharacters', 'sourceSha256']);
  assert.deepEqual(index.searchFoldCharacters, buildSearchFoldCharacters());
  assert.ok(readFileSync(new URL('../src/generated/person-search-names.json', import.meta.url)).length < 100000);
  const preparation = readFileSync(new URL('../scripts/prepare-content.mjs', import.meta.url), 'utf8');
  assert.match(preparation, /writePersonSearchNames\(passages\.people\)/);
});

test('name generation keeps shared names on separate identities and rejects unknown or duplicate identities', () => {
  const people = [{ id: 'one' }, { id: 'two' }];
  const rules = { people: [
    { personId: 'one', names: ['同名', '同名'], shortNames: ['局部短名'], titles: ['某帝'], excludedPhrases: ['排除词'] },
    { personId: 'two', names: ['同名', '別名'] },
  ] };
  const output = buildPersonSearchNames(people, rules, 'a'.repeat(64));
  assert.deepEqual(output.namesByPerson, { one: ['同名'], two: ['同名', '別名'] });
  assert.throws(() => buildPersonSearchNames([{ id: 'one' }], rules, 'a'.repeat(64)), /Unknown search identity/);
  assert.throws(() => buildPersonSearchNames(people, { people: [rules.people[0], rules.people[0]] }, 'a'.repeat(64)), /Duplicate search identity/);
});

test('traditional full names find the same distinct historical identities in both person searches', () => {
  for (const search of [filterSearch, searchRelationshipNodes]) {
    for (const [query, id, other] of [['劉訓', 'liu-xun-yonghe', 'liu-xun'], ['劉鄩', 'liu-xun', 'liu-xun-yonghe'], ['李建及', 'wang-jianji', 'wang-jian-former-shu']]) {
      const ids = search(query).map(person => person.id);
      assert.ok(ids.includes(id), query);
      assert.ok(!ids.includes(other), query);
      assert.equal(new Set(ids).size, ids.length);
    }
    const shared = search('王建').map(person => person.id);
    assert.ok(shared.includes('wang-jianji'));
    assert.ok(shared.includes('wang-jian-former-shu'));
    assert.equal(new Set(shared).size, shared.length);
  }
});

// These are UI search keys, not new historical names or source attributions.
test('canonical display names share script and compatibility equivalence in global and relationship searches', () => {
  for (const search of [filterSearch, searchRelationshipNodes]) {
    for (const query of ['张氏（周睿恭皇后）', '張氏（周睿恭皇后）', '張氏(周睿恭皇后)']) {
      assert.deepEqual(search(query).map(person => person.id), ['zhou-guo-wei-ancestress-zhang-ruigong']);
    }
    for (const query of ['韓氏（周太祖姨母、楚国夫人）', '韩氏(周太祖姨母、楚國夫人)']) {
      assert.deepEqual(search(query).map(person => person.id), ['zhou-guo-wei-aunt-han']);
    }
    for (const query of ['后周睿恭皇后张氏', '後周睿恭皇后張氏']) assert.deepEqual(search(query), []);
  }
  assert.equal(normalizePersonSearch('ＡＢＣ　１２３'), normalizePersonSearch('abc 123'));
});

test('context node display names use the same equivalence without adding a canonical identity', () => {
  const nodes = [{id: 'fixture-context', name: '韩母（楚国）', aliases: ['韓母別稱'], external: true}];
  for (const query of ['韓母(楚國)', '韩母别称']) {
    assert.deepEqual(searchRelationshipNodes(query, nodes, []).map(node => node.id), ['fixture-context']);
  }
  assert.equal(catalogPeople.some(person => person.id === 'fixture-context'), false);
  assert.deepEqual(searchRelationshipNodes('', nodes, []), []);
});

test('search character folds converge, reject cycles, and preserve literal joined-field queries', () => {
  assert.deepEqual(closeSearchFoldCharacters({'薴': '苧', '苧': '苎'}), {'苧': '苎', '薴': '苎'});
  for (const table of [{'甲': '乙', '乙': '甲'}, {'甲': '甲'}]) {
    assert.throws(() => closeSearchFoldCharacters(table), /Cyclic search fold/);
  }
  assert.throws(() => closeSearchFoldCharacters({'甲': '乙丙'}), /one code point/);
  assert.equal(new Set(['薴', '苧', '苎'].map(normalizePersonSearch)).size, 1);
  for (const [from, to] of Object.entries(index.searchFoldCharacters)) {
    assert.equal(normalizePersonSearch(from), normalizePersonSearch(to));
    assert.equal(normalizePersonSearch(normalizePersonSearch(from)), normalizePersonSearch(from));
  }
  assert.ok(filterSearch('朱温 后梁').some(person => person.id === 'zhu-wen'));
  const zhuWen = catalogPeople.find(person => person.id === 'zhu-wen');
  assert.ok(matchesPersonSearch('朱温 朱全忠', [`${zhuWen.name} ${zhuWen.aliases} ${personSearchNames(zhuWen.id).join(' ')}`]));
});
