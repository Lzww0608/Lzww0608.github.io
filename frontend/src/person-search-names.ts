import index from './generated/person-search-names.json' with { type: 'json' };

const namesByPerson: Readonly<Record<string, readonly string[]>> = index.namesByPerson;

export function personSearchNames(personId: string): readonly string[] {
  return Object.hasOwn(namesByPerson, personId) ? namesByPerson[personId] ?? [] : [];
}
