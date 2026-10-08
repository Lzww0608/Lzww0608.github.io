import emperors from '../../content/five-dynasties/emperors.json' with { type: 'json' };
import taibao from '../../content/five-dynasties/taibao.json' with { type: 'json' };
import type { EmperorCatalog, HistoricalPersonGroup, HistoryPerson, PersonGroupId } from './types.ts';

export const reigningEmperors = (emperors as EmperorCatalog).people;
export const taibaoGroup = taibao as HistoricalPersonGroup;

// Shared members retain their existing canonical emperor object and stable ID.
export const catalogPeople: HistoryPerson[] = [];
const knownPeople = new Set<string>();
for (const person of [...reigningEmperors, ...taibaoGroup.people]) {
  if (knownPeople.has(person.id)) continue;
  knownPeople.add(person.id);
  catalogPeople.push(person);
}
const emperorIds = new Set(reigningEmperors.map(person => person.id));
const taibaoIds = new Set(taibaoGroup.memberIds);

export const personGroups: readonly { id: PersonGroupId; label: string }[] = [
  { id: 'all', label: '全部人物' },
  { id: 'emperors', label: '五代皇帝' },
  { id: 'thirteen-taibao', label: '十三太保' },
];

export function personMatchesGroup(person: HistoryPerson, groupId: PersonGroupId): boolean {
  return groupId === 'all' || (groupId === 'emperors' ? emperorIds.has(person.id) : taibaoIds.has(person.id));
}

export function peopleForGroup(people: readonly HistoryPerson[], groupId: PersonGroupId): HistoryPerson[] {
  if (groupId === 'thirteen-taibao') {
    const byId = new Map(people.map(person => [person.id, person]));
    return taibaoGroup.memberIds.flatMap(id => {
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
  return person.relation ?? taibaoGroup.memberRelations?.[person.id];
}
