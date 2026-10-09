import emperors from '../../content/five-dynasties/emperors.json' with { type: 'json' };
import taibao from '../../content/five-dynasties/taibao.json' with { type: 'json' };
import zhuWenGenerals from '../../content/five-dynasties/zhu-wen-generals.json' with { type: 'json' };
import type { EmperorCatalog, HistoricalPersonGroup, HistoryPerson, PersonGroupId } from './types.ts';

export const reigningEmperors = (emperors as EmperorCatalog).people;
export const taibaoGroup: HistoricalPersonGroup = { ...taibao as HistoricalPersonGroup, filterLabel: '十三太保', relationshipSubject: '李克用' };
export const zhuWenGeneralsGroup = zhuWenGenerals as HistoricalPersonGroup;
export const personTopics: readonly HistoricalPersonGroup[] = [taibaoGroup, zhuWenGeneralsGroup];

// Shared members retain their existing canonical emperor object and stable ID.
export const catalogPeople: HistoryPerson[] = [];
const knownPeople = new Set<string>();
for (const person of [...reigningEmperors, ...personTopics.flatMap(topic => topic.people)]) {
  if (knownPeople.has(person.id)) continue;
  knownPeople.add(person.id);
  catalogPeople.push(person);
}
const emperorIds = new Set(reigningEmperors.map(person => person.id));
const topicMembers = new Map(personTopics.map(topic => [topic.id, new Set(topic.memberIds)]));

export const personGroups: readonly { id: PersonGroupId; label: string }[] = [
  { id: 'all', label: '全部人物' },
  { id: 'emperors', label: '五代皇帝' },
  ...personTopics.map(topic => ({ id: topic.id, label: topic.filterLabel ?? topic.title })),
];

export function personTopic(groupId: PersonGroupId): HistoricalPersonGroup | undefined {
  return personTopics.find(topic => topic.id === groupId);
}

export function topicsForPerson(person: HistoryPerson): HistoricalPersonGroup[] {
  return personTopics.filter(topic => topicMembers.get(topic.id)?.has(person.id));
}

export function personMatchesGroup(person: HistoryPerson, groupId: PersonGroupId): boolean {
  return groupId === 'all' || (groupId === 'emperors' ? emperorIds.has(person.id) : topicMembers.get(groupId)?.has(person.id) === true);
}

export function peopleForGroup(people: readonly HistoryPerson[], groupId: PersonGroupId): HistoryPerson[] {
  const topic = personTopic(groupId);
  if (topic) {
    const byId = new Map(people.map(person => [person.id, person]));
    return topic.memberIds.flatMap(id => {
      const person = byId.get(id);
      return person ? [person] : [];
    });
  }
  return people.filter(person => personMatchesGroup(person, groupId));
}

export function personDisplayPeriod(person: HistoryPerson): string {
  return person.periodLabel ?? person.dynasty;
}

export function personRelationship(person: HistoryPerson): string | undefined {
  return personTopicRelationships(person)[0]?.relation ?? person.relation;
}

export function personTopicRelationships(person: HistoryPerson): { groupId: HistoricalPersonGroup['id']; subject: string | undefined; relation: string }[] {
  return topicsForPerson(person).flatMap(topic => {
    const relation = topic.memberRelations?.[person.id] ?? topic.people.find(member => member.id === person.id)?.relation;
    return relation ? [{ groupId: topic.id, subject: topic.relationshipSubject, relation }] : [];
  });
}

export function personTopicKeywords(person: HistoryPerson): string {
  return topicsForPerson(person).flatMap(topic => [topic.title, topic.filterLabel ?? '', topic.relationshipSubject ?? '', topic.memberRelations?.[person.id] ?? topic.people.find(member => member.id === person.id)?.relation ?? '']).join(' ');
}
