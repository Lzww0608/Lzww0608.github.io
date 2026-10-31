import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import southernTang from '../../content/five-dynasties/southern-tang-officials.json' with { type: 'json' };
import { loadLibrary } from '../../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { people, filterSearch } from '../src/data.ts';
import { catalogPeople, peopleForGroup, personTopic, personTopicRelationships, topicsForPerson } from '../src/person-catalog.ts';
import { buildRelationshipNodes, relationshipNeighborhood, relationshipNodes, relationshipsForPerson, searchRelationshipNodes } from '../src/relationships.ts';

const southernTangIds = ['song-qiqiu', 'han-xizai', 'xu-xuan'];

test('the civil-officials filter reuses all three Southern Tang identities in both topics', () => {
  const topic = personTopic('civil-officials');
  assert.ok(topic);
  const members = peopleForGroup(people, 'civil-officials');
  assert.deepEqual(members.map(person => person.id), topic.memberIds, 'every registered member resolves in topic order');
  const southernTangMembers = members.filter(person => southernTangIds.includes(person.id));
  assert.deepEqual(southernTangMembers.map(person => person.id), southernTangIds);
  assert.deepEqual(peopleForGroup(people, 'southern-tang-officials'), southernTangMembers);
  assert.deepEqual(new Set(filterSearch('五代十国文臣').map(person => person.id)), new Set(topic.memberIds));
  assert.deepEqual(filterSearch('南唐文臣').map(person => person.id), southernTangIds);
  for (const person of southernTangMembers) {
    assert.equal(person, southernTang.people.find(candidate => candidate.id === person.id));
    assert.deepEqual(topicsForPerson(person).map(topic => topic.id).filter(id => ['civil-officials', 'southern-tang-officials'].includes(id)).sort(),
      ['civil-officials', 'southern-tang-officials']);
    assert.deepEqual(personTopicRelationships(person), [], `${person.id}: membership does not imply a commander`);
    for (const group of ['emperors', 'ten-kingdoms-rulers', 'thirteen-taibao', 'li-keyong-generals', 'zhu-wen-generals']) {
      assert.ok(!peopleForGroup(people, group).some(candidate => candidate.id === person.id), `${person.id}/${group}`);
    }
  }
  assert.equal(personTopic('civil-officials')?.relationshipSubject, undefined);
});

test('shared civil officials keep one API, catalog, search and direct-relationship identity with real sources and events', () => {
  const library = loadLibrary();
  const index = loadPersonPassageIndex(library);
  const timelines = loadPersonTimelines(library);
  const apiPeople = loadPassagePeople();
  for (const person of southernTang.people) {
    for (const collection of [catalogPeople, people, apiPeople, relationshipNodes]) {
      assert.equal(collection.filter(candidate => candidate.id === person.id).length, 1, person.id);
    }
    for (const query of [person.name, { 'song-qiqiu': '宋齊丘', 'han-xizai': '韓熙載', 'xu-xuan': '徐鉉' }[person.id]]) {
      assert.equal(filterSearch(query).filter(candidate => candidate.id === person.id).length, 1, query);
      assert.equal(searchRelationshipNodes(query).filter(candidate => candidate.id === person.id).length, 1, query);
    }
    assert.ok(person.sources.length > 0, person.id);
    assert.ok(index.passages.some(passage => passage.people.some(association => association.personId === person.id)), person.id);
    assert.ok(timelines.find(document => document.personId === person.id)?.events.length > 0, person.id);
    const neighborhood = relationshipNeighborhood(person.id);
    assert.equal(neighborhood.nodes.filter(node => node.id === person.id).length, 1, person.id);
    assert.deepEqual(neighborhood.relationships, relationshipsForPerson(person.id));
    for (const relation of neighborhood.relationships) {
      assert.ok(relation.from === person.id || relation.to === person.id, relation.id);
      for (const endpoint of [relation.from, relation.to]) {
        assert.equal(relationshipsForPerson(endpoint).filter(candidate => candidate.id === relation.id).length, 1, relation.id);
      }
    }
  }
});

test('relationship derivation keeps the two historically distinct Wang Jian identities separate', () => {
  const nodes = buildRelationshipNodes([
    { id: 'wang-jian-former-shu', name: '王建', dynasty: '前蜀' },
    { id: 'wang-jianji', name: '王建', dynasty: '后唐' },
  ]);
  assert.deepEqual(nodes.map(node => node.id), ['wang-jian-former-shu', 'wang-jianji']);
  assert.deepEqual(searchRelationshipNodes('王建', nodes, []).map(node => node.id), ['wang-jian-former-shu', 'wang-jianji']);
});

test('the API catalog loader rejects a duplicate formal identity added through the civil topic', async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'civil-officials-catalog-'));
  try {
    const contentRoot = new URL('../../content/', import.meta.url);
    for (const file of ['person-passages.mjs', 'library.mjs']) copyFileSync(new URL(file, contentRoot), join(temporaryRoot, file));
    const catalogsRoot = join(temporaryRoot, 'five-dynasties');
    mkdirSync(catalogsRoot);
    mkdirSync(join(temporaryRoot, 'southern-northern'));
    copyFileSync(new URL('southern-northern/emperors.json', contentRoot), join(temporaryRoot, 'southern-northern/emperors.json'));
    for (const file of readdirSync(new URL('five-dynasties/', contentRoot)).filter(file => file.endsWith('.json'))) {
      const catalog = JSON.parse(readFileSync(new URL(`five-dynasties/${file}`, contentRoot), 'utf8'));
      if (Array.isArray(catalog.people)) writeFileSync(join(catalogsRoot, file), JSON.stringify(catalog));
    }
    writeFileSync(join(catalogsRoot, 'civil-officials.json'), JSON.stringify({ people: [southernTang.people[0]] }));
    const { loadPassagePeople: loadFixturePeople } = await import(pathToFileURL(join(temporaryRoot, 'person-passages.mjs')).href);
    assert.throws(() => loadFixturePeople(), /Invalid person passages: canonical people IDs/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
