import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { ConverterBuilder } from 'opencc-js/core';
import * as Locale from 'opencc-js/preset/t2cn';
import { createSearchConverter } from '../../content/passage-search.mts';

const rulesUrl = new URL('../../content/person-passages/rules.json', import.meta.url);
const outputUrl = new URL('../src/generated/person-search-names.json', import.meta.url);

// Search-only character equivalence, generated with the installed search dictionary.
// The browser receives this small table, not an eager OpenCC converter. Checked
// source names below remain unchanged; no local titles become global aliases.
export function closeSearchFoldCharacters(direct) {
  for (const [from, to] of Object.entries(direct)) {
    assert.equal([...from].length, 1, 'Search fold source must be one code point');
    assert.equal(typeof to, 'string');
    assert.equal([...to].length, 1, 'Search fold target must be one code point');
  }
  return Object.fromEntries(Object.keys(direct).sort().map(from => {
    const visited = new Set();
    let to = from;
    while (Object.hasOwn(direct, to)) {
      assert.ok(!visited.has(to), `Cyclic search fold: ${from}`);
      visited.add(to);
      to = direct[to];
    }
    return [from, to];
  }));
}

export function buildSearchFoldCharacters() {
  const convert = createSearchConverter(ConverterBuilder, Locale);
  const characters = new Set(['衞']);
  for (const group of Locale.configs.t2s.conversionChain) {
    for (const dictionary of group) {
      const entries = typeof dictionary === 'string'
        ? dictionary.split('|').map(entry => entry.split(' ')) : dictionary;
      for (const [key] of entries) for (const char of key.normalize('NFKC')) characters.add(char);
    }
  }
  return closeSearchFoldCharacters(Object.fromEntries([...characters].sort().flatMap(char => {
    const folded = convert(char);
    return folded === char ? [] : [[char, folded]];
  })));
}

export function buildPersonSearchNames(people, rules, sourceSha256) {
  assert.match(sourceSha256, /^[a-f0-9]{64}$/);
  const knownIds = new Set(people.map(person => person.id));
  const byId = new Map();
  for (const rule of rules.people) {
    assert.ok(knownIds.has(rule.personId), `Unknown search identity: ${rule.personId}`);
    assert.ok(!byId.has(rule.personId), `Duplicate search identity: ${rule.personId}`);
    assert.ok(Array.isArray(rule.names) && rule.names.every(name => typeof name === 'string' && name.trim() === name && name.length > 0), `Invalid full names: ${rule.personId}`);
    // Only checked full names are global search terms. Local short names,
    // titles and exclusion phrases retain their paragraph-specific meaning.
    byId.set(rule.personId, [...new Set(rule.names)]);
  }
  return {
    schemaVersion: 1,
    sourceSha256,
    searchFoldCharacters: buildSearchFoldCharacters(),
    namesByPerson: Object.fromEntries([...byId.keys()].sort().map(id => [id, byId.get(id)])),
  };
}

export function writePersonSearchNames(people) {
  const source = readFileSync(rulesUrl);
  const index = buildPersonSearchNames(people, JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex'));
  mkdirSync(new URL('./', outputUrl), { recursive: true });
  writeFileSync(outputUrl, JSON.stringify(index) + '\n');
  return index;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writePersonSearchNames(loadPassagePeople());
