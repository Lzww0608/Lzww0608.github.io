import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPassagePeople } from '../../content/person-passages.mjs';

const rulesUrl = new URL('../../content/person-passages/rules.json', import.meta.url);
const outputUrl = new URL('../src/generated/person-search-names.json', import.meta.url);

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
