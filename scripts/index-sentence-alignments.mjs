import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLibrary } from '../content/library.mjs';
import { loadPublishedSentenceTranslations } from '../content/sentence-translations.mjs';
import { simplifyOriginal } from '../frontend/src/script-converter.ts';
import { hasOuterSentencePunctuation, matchesPeriodSentenceRanges, splitSentenceSpans, validateSentenceAlignmentDocument } from '../frontend/src/sentence-alignment.ts';

export const sentenceAlignmentsRoot = new URL('../content/sentence-alignments/', import.meta.url);
const translationsRoot = new URL('../content/published-translations/', import.meta.url);
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid sentence alignment source: ${message}`); };
const normalize = text => [...simplifyOriginal(text).normalize('NFKC')].filter(character => /[\p{Unified_Ideograph}\p{Number}]/u.test(character));

// Only independently unique literal phrases are anchors. Sentence count and
// relative lengths never establish a correspondence. Phrase matching is only
// used offline to choose boundaries; uncertain neighboring sentences stay together.
function uniquePhrases(spans, sizes = [4, 5, 6]) {
  const occurrences = new Map();
  for (const [sentence, span] of spans.entries()) {
    const characters = normalize(span.text);
    for (const size of sizes) {
      for (let start = 0; start + size <= characters.length; start += 1) {
        const phrase = characters.slice(start, start + size).join('');
        const previous = occurrences.get(phrase);
        if (previous) previous.count += 1;
        else occurrences.set(phrase, { sentence, start, end: start + size, count: 1 });
      }
    }
  }
  return occurrences;
}

function anchorBoundaries(originalSpans, translationSpans) {
  const originalPhrases = uniquePhrases(originalSpans);
  const translationPhrases = uniquePhrases(translationSpans);
  const matches = [];
  for (const [phrase, original] of originalPhrases) {
    const translation = translationPhrases.get(phrase);
    if (original.count === 1 && translation?.count === 1) matches.push({ original, translation });
  }
  // Short unique phrases are too weak to create boundaries, but a cross-boundary
  // occurrence is evidence against an otherwise attractive longer anchor.
  const shortOriginal = uniquePhrases(originalSpans, [2, 3]);
  const shortTranslation = uniquePhrases(translationSpans, [2, 3]);
  const contradictions = [];
  for (const [phrase, original] of shortOriginal) {
    const translation = shortTranslation.get(phrase);
    if (original.count === 1 && translation?.count === 1) contradictions.push({ original, translation });
  }
  // Unanchored trailing explanations may explain several earlier source
  // sentences (especially a poem repeated verbatim before its paraphrase).
  // Do not silently attach such a tail to only the last source sentence.
  if (!matches.some(match => match.translation.sentence === translationSpans.length - 1)) return [];
  const supported = sentence => {
    const covered = new Set();
    for (const match of matches.filter(match => match.original.sentence === sentence)) {
      for (let index = match.original.start; index < match.original.end; index += 1) covered.add(index);
    }
    return covered.size >= 5;
  };
  const boundaries = [];
  for (let after = 0; after < originalSpans.length - 1; after += 1) {
    if (!supported(after) || !supported(after + 1)) continue;
    const beforeMatches = matches.filter(match => match.original.sentence <= after);
    const afterMatches = matches.filter(match => match.original.sentence > after);
    const before = Math.max(...beforeMatches.map(match => match.translation.sentence));
    const next = Math.min(...afterMatches.map(match => match.translation.sentence));
    const sourceLength = normalize(originalSpans[after].text).length;
    const translationLength = before >= 0 ? normalize(translationSpans[before].text).length : 0;
    const anchoredTail = beforeMatches.some(match => match.original.sentence === after && match.translation.sentence === before
      && match.original.start >= Math.max(0, sourceLength - 12) && match.original.end >= sourceLength - 3
      && match.translation.start >= Math.max(0, translationLength - 12) && match.translation.end >= translationLength - 3);
    const anchoredHead = afterMatches.some(match => match.original.sentence === after + 1 && match.translation.sentence === next && match.original.start <= 3 && match.translation.start <= 3);
    // Every unique anchor on both sides must respect the same boundary, and
    // there must be exactly one target boundary between them. Split/merged
    // target sentences and anchor contradictions cause a larger group.
    if (anchoredTail && anchoredHead && before >= 0 && next === before + 1 && !contradictions.some(match => (match.original.sentence <= after) !== (match.translation.sentence < next))) boundaries.push({ original: after + 1, translation: next });
  }
  return boundaries;
}

function rangesFromCounts(originalSpans, translationSpans, counts) {
  counts = counts.map(pair => [...pair]);
  let sourceCursor = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const [originalCount] = counts[index];
    if (originalCount === 1 && !hasOuterSentencePunctuation(originalSpans[sourceCursor].text) && counts.length > 1) {
      const neighbor = index > 0 ? index - 1 : 1;
      counts[neighbor][0] += counts[index][0];
      counts[neighbor][1] += counts[index][1];
      counts.splice(index, 1);
      sourceCursor = 0;
      index = -1;
      continue;
    }
    sourceCursor += originalCount;
  }
  let original = 0;
  let translation = 0;
  const groups = counts.map(([originalCount, translationCount]) => {
    requireValue(Number.isSafeInteger(originalCount) && originalCount > 0 && Number.isSafeInteger(translationCount) && translationCount > 0, 'override counts');
    const firstOriginal = originalSpans[original];
    const lastOriginal = originalSpans[original + originalCount - 1];
    const firstTranslation = translationSpans[translation];
    const lastTranslation = translationSpans[translation + translationCount - 1];
    requireValue(firstOriginal && lastOriginal && firstTranslation && lastTranslation, 'override bounds');
    original += originalCount;
    translation += translationCount;
    return { originalStart: firstOriginal.start, originalEnd: lastOriginal.end, translationStart: firstTranslation.start, translationEnd: lastTranslation.end, kind: originalCount === 1 ? (hasOuterSentencePunctuation(firstOriginal.text) ? 'sentence' : 'paragraph') : 'group' };
  });
  requireValue(original === originalSpans.length && translation === translationSpans.length, 'override full coverage');
  return groups;
}

export function alignSentenceGroups(original, translation, overrideCounts, forceParagraph = false) {
  const originalSpans = splitSentenceSpans(original);
  const translationSpans = splitSentenceSpans(translation);
  requireValue(originalSpans.length && translationSpans.length, 'nonempty text');
  if (forceParagraph) return [{ originalStart: 0, originalEnd: [...original].length, translationStart: 0, translationEnd: [...translation].length, kind: 'paragraph' }];
  if (overrideCounts) return rangesFromCounts(originalSpans, translationSpans, overrideCounts);
  const fallback = () => [{ originalStart: 0, originalEnd: [...original].length, translationStart: 0, translationEnd: [...translation].length, kind: originalSpans.length === 1 && hasOuterSentencePunctuation(original) ? 'sentence' : 'paragraph' }];
  if (originalSpans.length === 1 || translationSpans.length === 1) return fallback();
  if (/(?:意思是|意為|意为|大意是|詩意|诗意|換成白話|换成白话|用白話|用白话|白話意思|白话意思)/u.test(translation)) return fallback();
  const boundaries = anchorBoundaries(originalSpans, translationSpans);
  if (!boundaries.length) return fallback();
  const counts = [];
  let originalIndex = 0;
  let translationIndex = 0;
  for (const boundary of [...boundaries, { original: originalSpans.length, translation: translationSpans.length }]) {
    requireValue(boundary.original > originalIndex && boundary.translation > translationIndex, 'monotonic anchors');
    counts.push([boundary.original - originalIndex, boundary.translation - translationIndex]);
    originalIndex = boundary.original;
    translationIndex = boundary.translation;
  }
  return rangesFromCounts(originalSpans, translationSpans, counts);
}

export function buildSentenceAlignmentDocuments(library = loadLibrary()) {
  const supplements = new Map();
  for (const document of loadPublishedSentenceTranslations()) for (const entry of document.entries) {
    const ids = supplements.get(entry.paragraphId) ?? [];
    ids.push({id:entry.id, version:entry.version, textSha256:entry.textSha256}); supplements.set(entry.paragraphId, ids);
  }
  const published = new Map();
  for (const book of library.catalog.books) {
    const snapshot = JSON.parse(readFileSync(new URL(`${book.id}.json`, translationsRoot), 'utf8'));
    requireValue(snapshot.schemaVersion === 1 && snapshot.bookId === book.id && snapshot.status === 'published' && Array.isArray(snapshot.entries), `published ${book.id}`);
    for (const entry of snapshot.entries) {
      requireValue(!published.has(entry.paragraphId), `duplicate translation ${entry.paragraphId}`);
      published.set(entry.paragraphId, entry);
    }
  }
  const overrideFile = JSON.parse(readFileSync(new URL('overrides.json', sentenceAlignmentsRoot), 'utf8'));
  requireValue(overrideFile.schemaVersion === 1 && Array.isArray(overrideFile.overrides), 'overrides');
  const overrides = new Map();
  for (const override of overrideFile.overrides) {
    requireValue(!overrides.has(override.paragraphId) && typeof override.reason === 'string' && override.reason.trim() && (Array.isArray(override.sentenceCounts) || override.mode === 'paragraph'), 'override identity');
    overrides.set(override.paragraphId, override);
  }
  const usedOverrides = new Set();
  const periodOverrides = new Map();
  const periodRoot = new URL('period-overrides/', sentenceAlignmentsRoot);
  for (const file of readdirSync(periodRoot).filter(name => name.endsWith('.json')).sort()) {
    const input = JSON.parse(readFileSync(new URL(file, periodRoot), 'utf8'));
    requireValue(input.schemaVersion === 1 && Array.isArray(input.paragraphs), `period file ${file}`);
    for (const entry of input.paragraphs) {
      requireValue(typeof entry.paragraphId === 'string' && !periodOverrides.has(entry.paragraphId)
        && typeof entry.reason === 'string' && entry.reason.trim() && Array.isArray(entry.sentences) && entry.sentences.length > 0, `period identity ${file}`);
      periodOverrides.set(entry.paragraphId, entry);
    }
  }
  const usedPeriodOverrides = new Set();
  const documents = library.chapters.map(chapter => ({
    schemaVersion: 1,
    chapterId: chapter.id,
    paragraphs: chapter.paragraphs.map(paragraph => {
      const entry = published.get(paragraph.id);
      const originalSha256 = sha256(paragraph.original);
      requireValue(entry && entry.originalRevision === paragraph.revision && entry.originalSha256 === originalSha256 && typeof entry.translation?.text === 'string' && entry.translation.text.trim(), `binding ${paragraph.id}`);
      const translation = entry.translation;
      const translationSha256 = sha256(translation.text);
      const periodOverride = periodOverrides.get(paragraph.id);
      if (periodOverride) {
        requireValue(periodOverride.originalRevision === paragraph.revision && periodOverride.originalSha256 === originalSha256
          && periodOverride.translationId === translation.id && periodOverride.translationVersion === translation.version
          && periodOverride.translationSha256 === translationSha256, `stale period override ${paragraph.id}`);
        requireValue(matchesPeriodSentenceRanges(periodOverride.sentences, paragraph.original, translation.text), `period boundaries ${paragraph.id}`);
        usedPeriodOverrides.add(paragraph.id);
      }
      const override = overrides.get(paragraph.id);
      if (override) {
        requireValue(override.originalSha256 === originalSha256 && override.translationId === translation.id && override.translationVersion === translation.version && override.translationSha256 === translationSha256, `stale override ${paragraph.id}`);
        usedOverrides.add(paragraph.id);
      }
      return {
        paragraphId: paragraph.id,
        originalRevision: paragraph.revision,
        originalSha256,
        translationId: translation.id,
        translationVersion: translation.version,
        translationSha256,
        groups: alignSentenceGroups(paragraph.original, translation.text, override?.sentenceCounts, override?.mode === 'paragraph'),
        ...(periodOverride ? { periodSentences: periodOverride.sentences } : {}),
        ...(supplements.has(paragraph.id) ? { supplementalTranslations: supplements.get(paragraph.id) } : {}),
      };
    }),
  }));
  requireValue(usedOverrides.size === overrides.size, 'unused override');
  requireValue(usedPeriodOverrides.size === periodOverrides.size, 'unused period override');
  for (const document of documents) validateSentenceAlignmentDocument(document);
  return documents;
}

function main() {
  const check = process.argv.includes('--check');
  const documents = buildSentenceAlignmentDocuments();
  const directory = new URL('chapters/', sentenceAlignmentsRoot);
  if (!check) mkdirSync(directory, { recursive: true });
  const expected = new Set(documents.map(document => `${document.chapterId}.json`));
  for (const document of documents) {
    const file = new URL(`${document.chapterId}.json`, directory);
    const contents = `${JSON.stringify(document)}\n`;
    if (check) requireValue(readFileSync(file, 'utf8') === contents, `generated file ${document.chapterId}`);
    else writeFileSync(file, contents);
  }
  requireValue(readdirSync(directory).filter(name => name.endsWith('.json')).every(name => expected.has(name)), 'unexpected generated chapter');
  const paragraphs = documents.flatMap(document => document.paragraphs);
  const groups = paragraphs.flatMap(paragraph => paragraph.groups);
  console.log(JSON.stringify({ chapters: documents.length, paragraphs: paragraphs.length, groups: groups.length, sentences: groups.filter(group => group.kind === 'sentence').length, sentenceGroups: groups.filter(group => group.kind === 'group').length, paragraphFallbacks: groups.filter(group => group.kind === 'paragraph').length, checked: check }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
