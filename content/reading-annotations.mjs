import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadLibrary } from './library.mjs';
import { loadEventComparisons } from './event-comparisons.mjs';
import { loadPublishedChapters } from './translations.mjs';
import { matchesReadingAnnotationOccurrences, parseReadingAnnotationDocument, readingAnnotationEventIds } from '../frontend/src/reading-annotations-schema.ts';

export const readingAnnotationRoot = new URL('./reading-annotations/', import.meta.url);
const sha = text => createHash('sha256').update(text).digest('hex');

export function validateReadingAnnotationSources(input, library = loadLibrary(), comparisons = loadEventComparisons(library)) {
  const document = parseReadingAnnotationDocument(input);
  const supportedComparisons = comparisons.filter(comparison => readingAnnotationEventIds.includes(comparison.id));
  if (supportedComparisons.length !== readingAnnotationEventIds.length
    || readingAnnotationEventIds.some(id => !supportedComparisons.some(comparison => comparison.id === id))) throw new Error('Missing supported annotation comparison');
  const selected = new Map();
  for (const comparison of supportedComparisons) {
    for (const source of comparison.sources) {
      const previous = selected.get(source.paragraphId);
      if (previous && (previous.chapterId !== source.chapterId || previous.originalRevision !== source.originalRevision
        || previous.originalSha256 !== source.originalSha256)) throw new Error(`Inconsistent selected annotation source: ${source.paragraphId}`);
      if (previous) previous.eventIds.push(comparison.id);
      else selected.set(source.paragraphId, { ...source, eventIds: [comparison.id] });
    }
  }
  if (document.eventIds.length !== readingAnnotationEventIds.length || document.eventIds.some(id => !readingAnnotationEventIds.includes(id))
    || document.paragraphs.length !== selected.size) throw new Error('Incomplete selected annotation corpus');
  const published = new Map(loadPublishedChapters(library).flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
  for (const binding of document.paragraphs) {
    const source = selected.get(binding.paragraphId), paragraph = published.get(binding.paragraphId);
    if (!source || !paragraph || source.chapterId !== binding.chapterId || source.originalRevision !== binding.originalRevision
      || source.originalSha256 !== binding.originalSha256 || sha(paragraph.original) !== binding.originalSha256
      || !paragraph.translation?.text.trim() || binding.eventIds.length !== source.eventIds.length
      || binding.eventIds.some(id => !source.eventIds.includes(id))
      || !matchesReadingAnnotationOccurrences(binding, paragraph, document.entries)) throw new Error(`Invalid reading annotation source: ${binding.paragraphId}`);
  }
  return document;
}

export function loadReadingAnnotations(library = loadLibrary(), comparisons = loadEventComparisons(library)) {
  return validateReadingAnnotationSources(JSON.parse(readFileSync(new URL('annotations.json', readingAnnotationRoot), 'utf8')), library, comparisons);
}

export function buildReadingAnnotationChapters(document) {
  return [...new Set(document.paragraphs.map(paragraph => paragraph.chapterId))].sort().map(chapterId => {
    const paragraphs = document.paragraphs.filter(paragraph => paragraph.chapterId === chapterId);
    const usedEntries = new Set(paragraphs.flatMap(paragraph => paragraph.occurrences.map(occurrence => occurrence.entryId)));
    const entries = document.entries.filter(entry => usedEntries.has(entry.id));
    const usedReferences = new Set(entries.flatMap(entry => entry.referenceIds));
    return parseReadingAnnotationDocument({ schemaVersion: 1, scope: 'current-archive', chapterId,
      eventIds: document.eventIds.filter(id => paragraphs.some(paragraph => paragraph.eventIds.includes(id))),
      references: document.references.filter(reference => usedReferences.has(reference.id)), entries, paragraphs }, chapterId);
  });
}
