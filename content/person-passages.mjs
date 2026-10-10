import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from './library.mjs';

export const personPassagesRoot = new URL('./person-passages/', import.meta.url);
const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid person passages: ${message}`); };
export const originalSha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function loadPassagePeople() {
  const catalogs = ['emperors', 'taibao', 'zhu-wen-generals', 'li-keyong-generals', 'ten-kingdoms-rulers'].map(file =>
    JSON.parse(readFileSync(new URL(`./five-dynasties/${file}.json`, import.meta.url), 'utf8')));
  const people = catalogs.flatMap(catalog => catalog.people).map(({ id, name }) => ({ id, name }));
  requireValue(new Set(people.map(person => person.id)).size === people.length, 'canonical people IDs');
  return people;
}

export function validatePersonPassageIndex(input, library = loadLibrary()) {
  requireValue(input?.schemaVersion === 1 && input.scope === 'current-archive', 'schema or scope');
  const coverage = { bookCount: library.catalog.books.length, chapterCount: library.chapters.length,
    paragraphCount: library.chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0) };
  requireValue(input.coverage && Object.entries(coverage).every(([key, count]) => input.coverage[key] === count), 'archive coverage');
  const canonicalPeople = new Map(loadPassagePeople().map(person => [person.id, person.name]));
  requireValue(Array.isArray(input.people) && input.people.length === canonicalPeople.size, 'people coverage');
  const peopleIds = new Set();
  for (const person of input.people) {
    requireValue(person && typeof person.id === 'string' && !peopleIds.has(person.id)
      && canonicalPeople.get(person.id) === person.name, 'person registry');
    peopleIds.add(person.id);
  }
  requireValue(Array.isArray(input.passages), 'passages');
  const chapters = new Map(library.chapters.map(chapter => [chapter.id, chapter]));
  const paragraphs = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, { chapter, paragraph }])));
  const passageIds = new Set(), associations = new Set(), coveredParagraphs = new Set();
  for (const passage of input.passages) {
    requireValue(passage && typeof passage.id === 'string' && /^passage-[a-z]+-v\d+-p\d+$/.test(passage.id)
      && !passageIds.has(passage.id), 'passage ID');
    passageIds.add(passage.id);
    const chapter = chapters.get(passage.chapterId);
    requireValue(chapter && library.catalog.books.some(book => book.id === chapter.bookId), `chapter ${passage.id}`);
    requireValue(typeof passage.title === 'string' && passage.title.trim(), `title ${passage.id}`);
    requireValue(Array.isArray(passage.spans) && passage.spans.length > 0, `spans ${passage.id}`);
    requireValue(passage.id === `passage-${passage.spans[0]?.paragraphId}`, `stable passage ID ${passage.id}`);
    const spanIds = new Set();
    let previousPosition = 0;
    for (const span of passage.spans) {
      const match = paragraphs.get(span?.paragraphId);
      requireValue(match && match.chapter.id === chapter.id && !spanIds.has(span.paragraphId)
        && match.paragraph.position > previousPosition, `span chapter/order ${passage.id}`);
      requireValue(!coveredParagraphs.has(span.paragraphId), `duplicate paragraph ${span.paragraphId}`);
      coveredParagraphs.add(span.paragraphId);
      spanIds.add(span.paragraphId); previousPosition = match.paragraph.position;
      requireValue(Number.isSafeInteger(span.originalRevision) && span.originalRevision === match.paragraph.revision
        && /^[a-f0-9]{64}$/.test(span.originalSha256) && span.originalSha256 === originalSha256(match.paragraph.original), `span original ${span.paragraphId}`);
      requireValue(Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start === 0 && span.end === [...match.paragraph.original].length, `full Unicode span ${span.paragraphId}`);
    }
    requireValue(Array.isArray(passage.people) && passage.people.length > 0, `associations ${passage.id}`);
    const seenPeople = new Set();
    for (const association of passage.people) {
      requireValue(peopleIds.has(association?.personId) && !seenPeople.has(association.personId)
        && ['biography', 'record', 'mention'].includes(association.kind), `person association ${passage.id}`);
      seenPeople.add(association.personId);
      const key = `${passage.id}/${association.personId}`;
      requireValue(!associations.has(key), `duplicate association ${key}`); associations.add(key);
    }
  }
  return input;
}

export function loadPersonPassageIndex(library = loadLibrary(), root = personPassagesRoot) {
  return validatePersonPassageIndex(JSON.parse(readFileSync(new URL('index.json', root), 'utf8')), library);
}

export function buildPersonPassageSummary(index, library = loadLibrary()) {
  validatePersonPassageIndex(index, library);
  const chapters = new Map(library.chapters.map(chapter => [chapter.id, chapter]));
  return { schemaVersion: 1, people: index.people.map(person => ({ id: person.id,
    books: library.catalog.books.flatMap(book => {
      const matches = index.passages.filter(passage => chapters.get(passage.chapterId).bookId === book.id
        && passage.people.some(association => association.personId === person.id));
      return matches.length ? [{ bookId: book.id, passageCount: matches.length,
        chapterCount: new Set(matches.map(passage => passage.chapterId)).size }] : [];
    }) })) };
}
