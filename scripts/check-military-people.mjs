import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../content/library.mjs';
import { loadPassagePeople, loadPersonPassageIndex } from '../content/person-passages.mjs';
import { validateMilitaryTopic } from '../content/military-people.mjs';

export function checkMilitaryPeople(library = loadLibrary(), passageIndex = loadPersonPassageIndex(library)) {
  const topic = JSON.parse(readFileSync(new URL('../content/five-dynasties/military-people.json', import.meta.url), 'utf8'));
  return validateMilitaryTopic(topic, library, loadPassagePeople(), passageIndex);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const topic = checkMilitaryPeople();
  console.log(`Checked ${topic.memberIds.length} military topic members against current originals.`);
}
