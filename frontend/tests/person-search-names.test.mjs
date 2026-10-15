import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import index from '../src/generated/person-search-names.json' with { type: 'json' };
import { buildPersonSearchNames } from '../scripts/person-search-names.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { filterSearch } from '../src/data.ts';
import { searchRelationshipNodes } from '../src/relationships.ts';

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
  assert.deepEqual(Object.keys(index).sort(), ['namesByPerson', 'schemaVersion', 'sourceSha256']);
  assert.ok(readFileSync(new URL('../src/generated/person-search-names.json', import.meta.url)).length < 20000);
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
