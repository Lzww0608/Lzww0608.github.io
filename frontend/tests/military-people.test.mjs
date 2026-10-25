import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateMilitaryTopic } from '../../content/military-people.mjs';
import { loadPassagePeople } from '../../content/person-passages.mjs';
import { catalogPeople, peopleForGroup, personTopics, personTopicRelationships } from '../src/person-catalog.ts';
import { people, filterSearch } from '../src/data.ts';
import { searchRelationshipNodes } from '../src/relationships.ts';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const topic = read('../../content/five-dynasties/military-people.json');
const oldTopic = read('../../content/five-dynasties/zhu-wen-generals.json');
const chapter = read('../../content/five-dynasties/chapters/new-v22.json');
const paragraph = chapter.paragraphs.find(item => item.id === 'new-v22-p21');
const sha = createHash('sha256').update(paragraph.original).digest('hex');
const qualificationChapters = [...new Set(Object.values(topic.memberServiceEvidence).flat().map(source => source.chapterId))]
  .map(id => read(`../../content/five-dynasties/chapters/${id}.json`));
const library = { chapters: qualificationChapters };
const canonical = loadPassagePeople();
const passageIndex = read('../../content/person-passages/index.json');

test('military-topic-reuses-canonical-ids', () => {
  assert.equal(topic.id, 'military-people');
  assert.ok(topic.memberIds.includes('niu-cunjie'));
  assert.equal(new Set(topic.memberIds).size, topic.memberIds.length);
  assert.deepEqual(topic.people, []);
  assert.ok(oldTopic.memberIds.includes('niu-cunjie'));
  assert.ok(oldTopic.people.some(person => person.id === 'niu-cunjie'));
  assert.equal(catalogPeople.filter(person => person.id === 'niu-cunjie').length, 1);
  assert.equal(people.filter(person => person.id === 'niu-cunjie').length, 1);
  assert.equal(canonical.filter(person => person.id === 'niu-cunjie').length, 1);
  assert.deepEqual(peopleForGroup(people, topic.id).map(person => person.id), topic.memberIds);
  assert.ok(personTopics.some(item => item.id === topic.id));
  assert.ok(filterSearch('牛存節').some(person => person.id === 'niu-cunjie'));
  assert.ok(searchRelationshipNodes('牛存節').some(person => person.id === 'niu-cunjie'));
});

test('military-topic-keeps-actual-commanders', () => {
  const current = personTopics.find(item => item.id === topic.id);
  assert.equal(current.relationshipSubject, undefined);
  assert.equal(topic.relationshipSubject, undefined);
  assert.equal(current.memberRelationshipSubjects?.['niu-cunjie'], '朱温');
  const person = people.find(item => item.id === 'niu-cunjie');
  const relation = personTopicRelationships(person).find(item => item.groupId === topic.id);
  assert.equal(relation.subject, '朱温');
  assert.equal(relation.relation, topic.memberRelations['niu-cunjie']);
  const alternateCommand = { ...current, memberIds: ['niu-cunjie', 'li-sizhao'],
    memberRelations: { 'niu-cunjie': '朱温麾下', 'li-sizhao': '李克用麾下' },
    memberRelationshipSubjects: { 'niu-cunjie': '朱温', 'li-sizhao': '李克用' } };
  const sizhao = people.find(item => item.id === 'li-sizhao');
  assert.deepEqual(personTopicRelationships(sizhao, [alternateCommand]),
    [{ groupId: topic.id, subject: '李克用', relation: '李克用麾下' }]);
});

test('military qualification binds current continuous original and existing canonical identity', () => {
  const source = topic.memberServiceEvidence['niu-cunjie'][0];
  assert.equal(source.chapterId, chapter.id);
  assert.equal(source.paragraphId, paragraph.id);
  assert.equal(source.originalRevision, paragraph.revision);
  assert.equal(source.originalSha256, sha);
  assert.ok(paragraph.original.includes(source.excerpt));
  assert.equal(validateMilitaryTopic(topic, library, canonical, passageIndex), topic);
});

test('military qualification rejects missing, unknown, duplicate and stale member evidence', () => {
  const invalid = (change, pattern) => {
    const copy = structuredClone(topic);
    change(copy);
    assert.throws(() => validateMilitaryTopic(copy, library, canonical, passageIndex), pattern);
  };
  invalid(copy => { copy.memberIds.push('niu-cunjie'); }, /duplicate member/i);
  invalid(copy => { copy.memberIds.push('unknown-person'); }, /unknown member/i);
  invalid(copy => { copy.memberServiceEvidence = {}; }, /evidence.*member|member.*evidence/i);
  invalid(copy => { copy.memberServiceEvidence['niu-cunjie'] = []; }, /evidence/i);
  invalid(copy => { copy.memberServiceEvidence['unknown-person'] = copy.memberServiceEvidence['niu-cunjie']; }, /evidence.*member|member.*evidence/i);
  invalid(copy => { copy.memberServiceEvidence['niu-cunjie'][0].chapterId = 'new-v23'; }, /chapter/i);
  invalid(copy => { copy.memberServiceEvidence['niu-cunjie'][0].originalSha256 = '0'.repeat(64); }, /SHA/i);
  invalid(copy => { copy.memberServiceEvidence['niu-cunjie'][0].originalRevision += 1; }, /revision/i);
  invalid(copy => { copy.memberServiceEvidence['niu-cunjie'][0].excerpt = '乃率其徒歸梁太祖'; }, /excerpt/i);
  invalid(copy => { copy.relationshipSubject = '朱温'; }, /common commander|relationshipSubject/i);
});

test('a military member cannot borrow another reviewed person’s source span', () => {
  const substitute = structuredClone(topic);
  substitute.memberIds = ['li-sizhao'];
  substitute.memberServiceEvidence = { 'li-sizhao': structuredClone(topic.memberServiceEvidence['niu-cunjie']) };
  substitute.memberRelations = { 'li-sizhao': '李克用麾下' };
  substitute.memberRelationshipSubjects = { 'li-sizhao': '李克用' };
  assert.throws(() => validateMilitaryTopic(substitute, library, canonical, passageIndex), /association|attribution/i);
});
