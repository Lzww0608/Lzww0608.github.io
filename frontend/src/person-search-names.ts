import index from './generated/person-search-names.json' with { type: 'json' };

const namesByPerson: Readonly<Record<string, readonly string[]>> = index.namesByPerson;

export function personSearchNames(personId: string): readonly string[] {
  return Object.hasOwn(namesByPerson, personId) ? namesByPerson[personId] ?? [] : [];
}

// Character equivalence is only for finding existing display names and checked
// aliases. It does not rewrite names, reorder words, or create historical aliases.
const searchFoldCharacters: Readonly<Record<string, string>> = index.searchFoldCharacters;

export function normalizePersonSearch(text: string): string {
  return [...text.normalize('NFKC')]
    .map(char => searchFoldCharacters[char] ?? char).join('').toLowerCase();
}

export function matchesPersonSearch(query: string, fields: readonly string[]): boolean {
  const needle = normalizePersonSearch(query.trim());
  return !needle || fields.some(text => normalizePersonSearch(text).includes(needle));
}
