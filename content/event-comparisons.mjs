import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadLibrary} from './library.mjs';
import {loadPublishedChapters} from './translations.mjs';
import {parseEventComparisonDocument} from '../frontend/src/event-comparison-schema.ts';

export const eventComparisonRoot = new URL('./event-comparisons/', import.meta.url);
const sha = text => createHash('sha256').update(text).digest('hex');

export function validateEventComparisonSources(document, library = loadLibrary()) {
  const checked = parseEventComparisonDocument(document);
  const sources = new Map(loadPublishedChapters(library).flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, {chapter, paragraph}])));
  for (const reference of checked.sources) {
    const source = sources.get(reference.paragraphId);
    if (!source || source.chapter.id !== reference.chapterId || source.chapter.bookId !== reference.bookId
      || source.paragraph.revision !== reference.originalRevision || sha(source.paragraph.original) !== reference.originalSha256
      || !source.paragraph.translation?.text.trim()) throw new Error(`Invalid comparison source: ${reference.id}`);
  }
  const byId = new Map(checked.sources.map(source => [source.id, sources.get(source.paragraphId).paragraph]));
  for (const difference of checked.differences) {
    for (const evidence of difference.evidence) {
      if (!byId.get(evidence.sourceId)?.original.includes(evidence.excerpt)) throw new Error(`Invalid comparison evidence: ${difference.id}`);
    }
  }
  return checked;
}

export function loadEventComparisons(library = loadLibrary()) {
  const documents = readdirSync(eventComparisonRoot).filter(name => name.endsWith('.json')).sort().map(name => {
    const document = parseEventComparisonDocument(JSON.parse(readFileSync(new URL(name, eventComparisonRoot), 'utf8')), name.slice(0, -5));
    return validateEventComparisonSources(document, library);
  });
  if (!documents.length || new Set(documents.map(document => document.id)).size !== documents.length) throw new Error('Missing or duplicated event comparisons');
  return documents;
}
