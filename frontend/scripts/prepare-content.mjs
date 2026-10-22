import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLibrary, libraryRoot } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadPersonPassageIndex, buildPersonPassageSummary } from '../../content/person-passages.mjs';
import { loadPublishedSentenceTranslations } from '../../content/sentence-translations.mjs';
import { loadPersonTimelines, buildTimelineSummary, validateTimelineCoverage } from '../../content/person-timelines.mjs';
import { loadEventComparisons } from '../../content/event-comparisons.mjs';
import { loadEventTimelineLinks } from '../../content/event-timeline-links.mjs';
import { loadReadingAnnotations, buildReadingAnnotationChapters } from '../../content/reading-annotations.mjs';
import { writeFileSync } from 'node:fs';
import { writePersonSearchNames } from './person-search-names.mjs';
import { checkMilitaryPeople } from '../../scripts/check-military-people.mjs';

const library = loadLibrary();
checkMilitaryPeople(library);
const { catalog } = library;
const chapters = loadPublishedChapters(library);
execFileSync(process.execPath,[fileURLToPath(new URL('../../scripts/index-sentence-alignments.mjs',import.meta.url)),'--check'],{stdio:'inherit'});
execFileSync(process.execPath,[fileURLToPath(new URL('../../scripts/index-person-passages.mjs',import.meta.url)),'--check'],{stdio:'inherit'});
const passages = loadPersonPassageIndex(library);
writePersonSearchNames(passages.people);
const timelines = loadPersonTimelines(library);
validateTimelineCoverage(timelines);
const comparisons = loadEventComparisons(library);
const eventTimelineLinks = loadEventTimelineLinks(library);
const readingAnnotations = loadReadingAnnotations(library, comparisons);
const annotationChapters = buildReadingAnnotationChapters(readingAnnotations);
execFileSync('python3', [fileURLToPath(new URL('../../scripts/index-reading-headings.py', import.meta.url))], { stdio: 'inherit' });
const target = new URL('../public/history/', import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(new URL('chapters/', target), { recursive: true });
mkdirSync(new URL('sentence-alignments/', target), { recursive: true });
mkdirSync(new URL('sentence-translations/', target), { recursive: true });
mkdirSync(new URL('person-timelines/', target), { recursive: true });
mkdirSync(new URL('event-comparisons/', target), { recursive: true });
mkdirSync(new URL('event-timeline-links/', target), { recursive: true });
mkdirSync(new URL('reading-annotations/', target), { recursive: true });
copyFileSync(new URL('catalog.json', libraryRoot), new URL('catalog.json', target));
for (const chapter of chapters) {
  writeFileSync(new URL(`chapters/${chapter.id}.json`, target), JSON.stringify(chapter, null, 2)+'\n');
  copyFileSync(new URL(`../../content/sentence-alignments/chapters/${chapter.id}.json`, import.meta.url), new URL(`sentence-alignments/${chapter.id}.json`, target));
}
writeFileSync(new URL('person-passages.json', target), JSON.stringify(passages)+'\n');
for (const document of loadPublishedSentenceTranslations(chapters)) {
  writeFileSync(new URL(`sentence-translations/${document.chapterId}.json`, target), JSON.stringify(document, null, 2)+'\n');
}
writeFileSync(new URL('../src/person-passage-summary.json', import.meta.url), JSON.stringify(buildPersonPassageSummary(passages,library),null,2)+'\n');
for (const document of timelines) writeFileSync(new URL(`person-timelines/${document.personId}.json`,target),JSON.stringify(document,null,2)+'\n');
writeFileSync(new URL('../src/person-timeline-summary.json',import.meta.url),JSON.stringify(buildTimelineSummary(timelines),null,2)+'\n');
for (const document of comparisons) writeFileSync(new URL(`event-comparisons/${document.id}.json`, target),JSON.stringify(document,null,2)+'\n');
for (const document of eventTimelineLinks) writeFileSync(new URL(`event-timeline-links/${document.comparisonId}.json`, target),JSON.stringify(document,null,2)+'\n');
for (const document of annotationChapters) writeFileSync(new URL(`reading-annotations/${document.chapterId}.json`, target),JSON.stringify(document,null,2)+'\n');
writeFileSync(new URL('../src/reading-annotation-chapters.json', import.meta.url), JSON.stringify(annotationChapters.map(document => document.chapterId), null, 2)+'\n');
writeFileSync(new URL('../src/reading-annotation-locations.json', import.meta.url), JSON.stringify(readingAnnotations.paragraphs.filter(paragraph => paragraph.occurrences.length).map(paragraph => ({ paragraphId: paragraph.paragraphId,
  sentenceIndices: [...new Set(paragraph.occurrences.map(occurrence => occurrence.sentenceIndex))].sort((a, b) => a - b) })), null, 2)+'\n');
console.log(`Prepared ${catalog.chapters.length} full chapters for local website reading.`);
console.log(`Prepared ${passages.passages.length} shared person passages.`);
console.log(`Prepared ${timelines.length} person timelines with ${timelines.reduce((n,d)=>n+d.events.length,0)} events.`);
console.log(`Prepared ${comparisons.length} event comparisons with current original and full-translation bindings.`);
console.log(`Prepared ${eventTimelineLinks.reduce((count, document) => count + document.links.length, 0)} checked timeline/comparison links.`);
console.log(`Prepared ${readingAnnotations.entries.length} reading annotations across ${readingAnnotations.paragraphs.length} checked battle paragraphs.`);
