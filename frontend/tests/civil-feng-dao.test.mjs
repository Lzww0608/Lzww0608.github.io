import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import civil from '../../content/five-dynasties/civil-officials.json' with { type: 'json' };
import { catalogPeople } from '../src/person-catalog.ts';
import { relationshipNodes, relationshipsForPerson } from '../src/relationships.ts';

const document = loadPersonTimelines(loadLibrary()).find(d => d.personId === 'feng-dao');
const find = suffix => document.events.find(e => e.id === `feng-dao-${suffix}`);
const position = suffix => document.events.findIndex(e => e.id === `feng-dao-${suffix}`);
const follows = sequence => {
  const positions = sequence.map(position);
  assert.ok(positions.every((p, i) => p >= 0 && (!i || p > positions[i - 1])), sequence.join(' -> '));
};

test('Feng Dao uses one civil identity, with separately bounded family contexts', () => {
  assert.equal(civil.people.filter(p => p.id === 'feng-dao').length, 1);
  assert.equal(catalogPeople.filter(p => p.id === 'feng-dao').length, 1);
  assert.ok(civil.memberIds.includes('feng-dao'));
  const mother = relationshipNodes.find(n => n.id === 'feng-dao-mother-zhang');
  assert.ok(mother?.external);
  assert.match(mother.name, /冯道/);
  assert.ok(relationshipsForPerson('feng-dao').some(e => e.from === mother.id && e.kind === 'kinship'));
  assert.ok(!catalogPeople.some(p => p.id === mother.id));
});

test('source-backed months keep the four corrected same-year sequences', () => {
  follows(['correct-dingzhou-in-memorial', 'petition-for-chancellor', 'mingzong-southern-suburb-commission', 'jingxing-lesson']);
  follows(['mindi-sikong', 'urge-lu-dao-draft', 'amend-mingzong-posthumous-title', 'leave-tang-chancellery-for-tongzhou']);
  follows(['commission-envoy-to-khitan', 'grant-gate-halberds']);
  follows(['praise-liu-shenjiao-government', 'compose-changle-lao-preface']);
  assert.match(find('amend-mingzong-posthumous-title').notes.join(' '), /具体先后未明/);
});

test('the penalty and the Tongjian poem date retain their own source variants', () => {
  assert.ok(find('correct-dingzhou-in-memorial').variants.some(v => v.evidence.some(e => e.paragraphId === 'new-v54-p22')));
  const poem = find('recite-farmers-poem');
  assert.equal(poem.year, null);
  assert.equal(poem.precision, 'range');
  assert.ok(poem.variants.some(v => v.year === 929 && v.evidence.some(e => e.paragraphId === 'tongjian-v276-p106')));
});

test('the coffin order, death report and posthumous honours retain different meanings', () => {
  const command = find('ordered-to-escort-zhou-coffin');
  assert.match(command.title, /^受命/);
  assert.match(command.evidence.map(e => e.excerpt).join(' '), /帝命馮道/);
  const death = find('death-source-accounts');
  assert.ok(death.variants.some(v => /东京奏报/.test(v.label) && v.evidence.some(e => e.paragraphId === 'old-v114-p8')));
  assert.equal(find('posthumous-honours').phase, 'posthumous');
});

test('the unnamed Khitan dowager stays a source role and 子斌 stays unresolved', () => {
  const role = relationshipNodes.find(n => n.id === 'khitan-taihou-tianfu3-source-role');
  assert.equal(role?.identityKind, 'source-role');
  assert.ok(!catalogPeople.some(p => p.id === role.id));
  const welcome = find('commission-to-welcome-liu-yun');
  assert.ok(welcome.variants.some(v => v.year === 950 && /暂不认定与刘赟同人/.test(v.summary)));
  const names = JSON.parse(readFileSync(new URL('../src/generated/person-search-names.json', import.meta.url), 'utf8'));
  assert.deepEqual(names.namesByPerson['feng-dao'], ['馮道', '冯道']);
});
