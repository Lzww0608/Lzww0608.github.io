import { createHash } from 'node:crypto';

const check = (ok, message) => { if (!ok) throw new Error(`Invalid military topic: ${message}`); };
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

// The fourth argument is the frozen release index or the current validated public index.
// A source quote qualifies a member only when that exact original span is attributed to them.
export function validateMilitaryTopic(input, library, people, passageIndex) {
  check(input?.schemaVersion === 1 && input.id === 'military-people', 'identity');
  check(input.relationshipSubject === undefined, 'common commander relationshipSubject is not valid for this topic');
  check(Array.isArray(input.people) && Array.isArray(input.memberIds) && input.memberIds.length > 0, 'people and members');
  check(Array.isArray(people), 'canonical people');
  const known = new Set();
  for (const person of people) {
    check(typeof person?.id === 'string' && person.id && !known.has(person.id), `duplicate canonical person ${person?.id}`);
    known.add(person.id);
  }
  const members = new Set();
  for (const id of input.memberIds) {
    check(typeof id === 'string' && id && !members.has(id), `duplicate member ${id}`);
    members.add(id);
    check(known.has(id), `unknown member ${id}`);
  }
  const newPeople = new Set();
  for (const person of input.people) {
    check(typeof person?.id === 'string' && members.has(person.id) && !newPeople.has(person.id), `duplicate or nonmember topic person ${person?.id}`);
    newPeople.add(person.id);
  }
  const evidence = input.memberServiceEvidence;
  check(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'member evidence mapping');
  check(Object.keys(evidence).length === members.size && Object.keys(evidence).every(id => members.has(id)), 'evidence keys must match members');
  const chapters = new Map((library?.chapters ?? []).map(chapter => [chapter.id, chapter]));
  check(chapters.size > 0, 'library chapters');
  check(Array.isArray(passageIndex?.passages), 'reviewed person passage index');
  for (const id of members) {
    check(Array.isArray(evidence[id]) && evidence[id].length > 0, `missing evidence for ${id}`);
    for (const entry of evidence[id]) {
      const chapter = chapters.get(entry?.chapterId);
      check(chapter, `unknown evidence chapter for ${id}`);
      const paragraph = chapter.paragraphs?.find(item => item.id === entry.paragraphId);
      check(paragraph, `evidence paragraph outside chapter for ${id}`);
      check(Number.isSafeInteger(entry.originalRevision) && entry.originalRevision === paragraph.revision, `stale original revision for ${id}`);
      check(typeof entry.originalSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.originalSha256)
        && entry.originalSha256 === sha256(paragraph.original), `original SHA mismatch for ${id}`);
      check(typeof entry.title === 'string' && entry.title.trim(), `evidence title for ${id}`);
      check(typeof entry.excerpt === 'string' && entry.excerpt.trim() && paragraph.original.includes(entry.excerpt), `noncontinuous excerpt for ${id}`);
      check(passageIndex.passages.some(passage => passage.chapterId === entry.chapterId
        && passage.spans?.some(span => span.paragraphId === entry.paragraphId
          && span.originalRevision === entry.originalRevision && span.originalSha256 === entry.originalSha256)
        && passage.people?.some(person => person.personId === id)), `missing reviewed association for ${id}/${entry.paragraphId}`);
    }
  }
  return input;
}
