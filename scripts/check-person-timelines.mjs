import { loadPersonTimelines, validateTimelineCoverage } from '../content/person-timelines.mjs';
import { loadLibrary } from '../content/library.mjs';
import { loadPublishedChapters } from '../content/translations.mjs';
import { timelineEvidence } from '../content/person-timelines.mjs';

const library = loadLibrary(), timelines = loadPersonTimelines(library);
const coverage = validateTimelineCoverage(timelines);
const paragraphs = new Map(loadPublishedChapters(library).flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
let citations = 0, undated = 0, ranged = 0;
for (const document of timelines) for (const event of document.events) {
  for (const reference of timelineEvidence(event)) {
    const paragraph = paragraphs.get(reference.paragraphId);
    if (!paragraph?.translation?.text.trim() || paragraph.revision !== reference.originalRevision) {
      throw new Error(`Timeline has no matching published full translation: ${document.personId}/${event.id}/${reference.paragraphId}`);
    }
    citations++;
  }
  if (event.precision === 'undated') undated++;
  if (event.precision === 'range') ranged++;
}
console.log(JSON.stringify({ checked: true, ...coverage, citations, undated, ranged }));
