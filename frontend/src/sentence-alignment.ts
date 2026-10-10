export interface SentenceSpan { start: number; end: number; text: string }

export interface SentenceAlignmentGroup {
  originalStart: number;
  originalEnd: number;
  translationStart: number;
  translationEnd: number;
  kind: 'sentence' | 'group' | 'paragraph';
}

export interface PeriodSentenceAlignment {
  originalStart: number;
  originalEnd: number;
  translationStart: number;
  translationEnd: number;
}

export interface PublishedSentenceReference { id: string; version: number; textSha256: string }

export interface SentenceAlignmentParagraph {
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  translationId: string;
  translationVersion: number;
  translationSha256: string;
  groups: SentenceAlignmentGroup[];
  periodSentences?: PeriodSentenceAlignment[];
  tailSentences?: PeriodSentenceAlignment[];
  supplementalTranslations?: PublishedSentenceReference[];
}

export interface SentenceAlignmentDocument {
  schemaVersion: 1;
  chapterId: string;
  paragraphs: SentenceAlignmentParagraph[];
}

const terminals = new Set(['。', '！', '？']);
const closingMarks = new Set(['”', '’', '」', '』', '】', '〉', '》', '〕', '）', ')', '"', "'"]);

// Click targets follow the user's literal full-stop rule, including quoted notes.
// Question/exclamation marks do not join targets across the next Chinese full stop.
export function splitPeriodSpans(text: string): SentenceSpan[] {
  const characters = [...text];
  const spans: SentenceSpan[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < characters.length) {
    if (characters[cursor] !== '。') { cursor += 1; continue; }
    cursor += 1;
    while (cursor < characters.length && (closingMarks.has(characters[cursor]!) || /^\s$/u.test(characters[cursor]!))) cursor += 1;
    spans.push({ start, end: cursor, text: characters.slice(start, cursor).join('') });
    start = cursor;
  }
  if (start < characters.length) spans.push({ start, end: characters.length, text: characters.slice(start).join('') });
  return spans;
}

// Preserve the checked full-stop units. A trailing question/exclamation sentence
// also needs its own click target, even when the paragraph has no final 。.
export function splitReadingSpans(text: string): SentenceSpan[] {
  const periods = splitPeriodSpans(text);
  const tail = periods.at(-1);
  if (!tail || tail.text.includes('。') || !/[？！]/u.test(tail.text)) return periods;
  const characters = [...tail.text];
  const spans = periods.slice(0, -1);
  let start = 0;
  let cursor = 0;
  while (cursor < characters.length) {
    if (!/[？！]/u.test(characters[cursor]!)) { cursor += 1; continue; }
    cursor += 1;
    while (cursor < characters.length && (/[？！]/u.test(characters[cursor]!)
      || closingMarks.has(characters[cursor]!) || /^\s$/u.test(characters[cursor]!))) cursor += 1;
    spans.push({ start: tail.start + start, end: tail.start + cursor, text: characters.slice(start, cursor).join('') });
    start = cursor;
  }
  if (start < characters.length) spans.push({ start: tail.start + start, end: tail.end, text: characters.slice(start).join('') });
  return spans;
}

export function isClickableReadingSpan(text: string): boolean {
  return /[。？！]/u.test(text);
}

export function matchesTailSentenceRanges(ranges: PeriodSentenceAlignment[], original: string, translation: string): boolean {
  const tail = splitPeriodSpans(original).at(-1);
  if (!tail || tail.text.includes('。') || !/[？！]/u.test(tail.text)) return false;
  const spans = splitReadingSpans(original).filter(span => span.start >= tail.start);
  if (ranges.length !== spans.length) return false;
  let translationEnd = ranges[0]?.translationStart;
  if (translationEnd === undefined || !Number.isSafeInteger(translationEnd) || translationEnd < 0) return false;
  for (const [i, range] of ranges.entries()) {
    if (range.originalStart !== spans[i]?.start || range.originalEnd !== spans[i]?.end
      || range.translationStart !== translationEnd || !Number.isSafeInteger(range.translationEnd)
      || range.translationEnd <= range.translationStart) return false;
    translationEnd = range.translationEnd;
  }
  return translationEnd === [...translation].length;
}

export function tailTranslationStart(alignment: SentenceAlignmentParagraph, original: string): number | undefined {
  const tail = splitPeriodSpans(original).at(-1);
  if (!tail || tail.text.includes('。')) return undefined;
  const explicit = alignment.periodSentences?.find(range => range.originalStart === tail.start && range.originalEnd === tail.end);
  if (explicit) return explicit.translationStart;
  const groups = alignment.groups.filter(group => group.originalStart < tail.end && group.originalEnd > tail.start);
  if (groups[0]?.originalStart === tail.start && groups.at(-1)?.originalEnd === tail.end) return groups[0].translationStart;
  return undefined;
}

export function matchesPeriodSentenceRanges(ranges: PeriodSentenceAlignment[], original: string, translation: string): boolean {
  const spans = splitPeriodSpans(original);
  if (ranges.length !== spans.length) return false;
  let translatedEnd = 0;
  for (const [index, range] of ranges.entries()) {
    const span = spans[index];
    if (!span || range.originalStart !== span.start || range.originalEnd !== span.end
      || range.translationStart !== translatedEnd || range.translationEnd <= range.translationStart) return false;
    translatedEnd = range.translationEnd;
  }
  return translatedEnd === [...translation].length;
}
const notePairs: Record<string, string> = { '〈': '〉', '【': '】', '〔': '〕', '（': '）', '(': ')' };

export function hasOuterSentencePunctuation(text: string): boolean {
  const stack: string[] = [];
  for (const character of text) {
    if (notePairs[character]) stack.push(notePairs[character]!);
    else if (character === stack.at(-1)) stack.pop();
    else if (stack.length === 0 && terminals.has(character)) return true;
  }
  return false;
}

// Offsets are Unicode code points, including rare characters outside the BMP.
// Closing quotes/notes stay with the sentence they close; no characters are lost.
export function splitSentenceSpans(text: string): SentenceSpan[] {
  const characters = [...text];
  const spans: SentenceSpan[] = [];
  const noteStack: string[] = [];
  let start = 0;
  let cursor = 0;
  let standaloneNote = false;
  while (cursor < characters.length) {
    const character = characters[cursor]!;
    if (notePairs[character]) {
      if (noteStack.length === 0) standaloneNote = cursor === start;
      noteStack.push(notePairs[character]!);
      cursor += 1;
      continue;
    }
    if (character === noteStack.at(-1)) {
      noteStack.pop();
      cursor += 1;
      if (standaloneNote && noteStack.length === 0) {
        while (cursor < characters.length && /^\s$/u.test(characters[cursor]!)) cursor += 1;
        spans.push({ start, end: cursor, text: characters.slice(start, cursor).join('') });
        start = cursor;
        standaloneNote = false;
      }
      continue;
    }
    // A sentence mark in an embedded editorial note cannot cut its host clause.
    if (noteStack.length > 0) { cursor += 1; continue; }
    if (!terminals.has(characters[cursor]!)) { cursor += 1; continue; }
    cursor += 1;
    while (cursor < characters.length && (terminals.has(characters[cursor]!) || closingMarks.has(characters[cursor]!) || /^\s$/u.test(characters[cursor]!))) cursor += 1;
    spans.push({ start, end: cursor, text: characters.slice(start, cursor).join('') });
    start = cursor;
  }
  if (start < characters.length) spans.push({ start, end: characters.length, text: characters.slice(start).join('') });
  return spans;
}

export function sliceCodePoints(text: string, start: number, end: number): string {
  return [...text].slice(start, end).join('');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const offset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const checksum = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireValue: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Invalid sentence alignment: ${message}`);
};

export function validateSentenceAlignmentDocument(input: unknown): SentenceAlignmentDocument {
  requireValue(record(input) && input.schemaVersion === 1 && typeof input.chapterId === 'string' && /^[a-z]+-v\d+$/.test(input.chapterId) && Array.isArray(input.paragraphs) && input.paragraphs.length > 0 && input.paragraphs.length <= 10_000, 'document');
  const seen = new Set<string>();
  for (const paragraph of input.paragraphs) {
    requireValue(record(paragraph) && typeof paragraph.paragraphId === 'string' && new RegExp(`^${input.chapterId}-p[1-9]\\d*$`).test(paragraph.paragraphId) && !seen.has(paragraph.paragraphId), 'paragraph identity');
    seen.add(paragraph.paragraphId);
    requireValue(positiveInteger(paragraph.originalRevision) && checksum(paragraph.originalSha256) && typeof paragraph.translationId === 'string' && /^[1-9]\d*$/.test(paragraph.translationId) && positiveInteger(paragraph.translationVersion) && checksum(paragraph.translationSha256), `versions ${paragraph.paragraphId}`);
    requireValue(Array.isArray(paragraph.groups) && paragraph.groups.length > 0 && paragraph.groups.length <= 4096, `groups ${paragraph.paragraphId}`);
    let originalEnd = 0;
    let translationEnd = 0;
    for (const group of paragraph.groups) {
      requireValue(record(group) && offset(group.originalStart) && positiveInteger(group.originalEnd) && offset(group.translationStart) && positiveInteger(group.translationEnd), `ranges ${paragraph.paragraphId}`);
      requireValue(group.originalStart === originalEnd && group.translationStart === translationEnd && group.originalEnd > group.originalStart && group.translationEnd > group.translationStart, `contiguous ranges ${paragraph.paragraphId}`);
      requireValue(group.kind === 'sentence' || group.kind === 'group' || group.kind === 'paragraph', `kind ${paragraph.paragraphId}`);
      requireValue(group.kind !== 'paragraph' || paragraph.groups.length === 1, `paragraph fallback ${paragraph.paragraphId}`);
      originalEnd = group.originalEnd;
      translationEnd = group.translationEnd;
    }
    if (paragraph.periodSentences !== undefined) {
      requireValue(Array.isArray(paragraph.periodSentences) && paragraph.periodSentences.length > 0 && paragraph.periodSentences.length <= 4096, `period ranges ${paragraph.paragraphId}`);
      let sourceEnd = 0;
      let targetEnd = 0;
      for (const sentence of paragraph.periodSentences) {
        requireValue(record(sentence) && offset(sentence.originalStart) && positiveInteger(sentence.originalEnd) && offset(sentence.translationStart) && positiveInteger(sentence.translationEnd), `period offsets ${paragraph.paragraphId}`);
        requireValue(sentence.originalStart === sourceEnd && sentence.translationStart === targetEnd && sentence.originalEnd > sentence.originalStart && sentence.translationEnd > sentence.translationStart, `period coverage ${paragraph.paragraphId}`);
        sourceEnd = sentence.originalEnd;
        targetEnd = sentence.translationEnd;
      }
      requireValue(sourceEnd === originalEnd && targetEnd === translationEnd, `period extent ${paragraph.paragraphId}`);
    }
    if (paragraph.supplementalTranslations !== undefined) {
      requireValue(Array.isArray(paragraph.supplementalTranslations) && paragraph.supplementalTranslations.length > 0
        && paragraph.supplementalTranslations.length <= 4096
        && paragraph.supplementalTranslations.every(ref => record(ref) && typeof ref.id === 'string' && /^sentence-[a-z0-9-]+$/.test(ref.id) && positiveInteger(ref.version) && checksum(ref.textSha256))
        && new Set(paragraph.supplementalTranslations.map(ref => (ref as Record<string, unknown>).id)).size === paragraph.supplementalTranslations.length,
      `published sentence references ${paragraph.paragraphId}`);
    }
    if (paragraph.tailSentences !== undefined) {
      requireValue(Array.isArray(paragraph.tailSentences) && paragraph.tailSentences.length > 0
        && paragraph.tailSentences.length <= 4096, `tail ranges ${paragraph.paragraphId}`);
      const parent = Array.isArray(paragraph.periodSentences) ? paragraph.periodSentences.at(-1) : undefined;
      if (parent) requireValue(paragraph.tailSentences[0].originalStart === parent.originalStart
        && paragraph.tailSentences[0].translationStart === parent.translationStart, `tail parent ${paragraph.paragraphId}`);
      let sourceEnd: number | undefined;
      let targetEnd: number | undefined;
      for (const sentence of paragraph.tailSentences) {
        requireValue(record(sentence) && offset(sentence.originalStart) && positiveInteger(sentence.originalEnd)
          && offset(sentence.translationStart) && positiveInteger(sentence.translationEnd), `tail offsets ${paragraph.paragraphId}`);
        requireValue(sentence.originalEnd > sentence.originalStart && sentence.translationEnd > sentence.translationStart
          && (sourceEnd === undefined || sentence.originalStart === sourceEnd)
          && (targetEnd === undefined || sentence.translationStart === targetEnd), `tail coverage ${paragraph.paragraphId}`);
        sourceEnd = sentence.originalEnd;
        targetEnd = sentence.translationEnd;
      }
      requireValue(sourceEnd === originalEnd && targetEnd === translationEnd, `tail extent ${paragraph.paragraphId}`);
    }
  }
  return input as unknown as SentenceAlignmentDocument;
}

export function findSentenceAlignment(document: SentenceAlignmentDocument, paragraphId: string): SentenceAlignmentParagraph | undefined {
  return document.paragraphs.find(paragraph => paragraph.paragraphId === paragraphId);
}

export function findAlignmentGroup(alignment: SentenceAlignmentParagraph, originalStart: number): SentenceAlignmentGroup | undefined {
  return alignment.groups.find(group => originalStart >= group.originalStart && originalStart < group.originalEnd);
}

export async function textSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

// A current API correction must never receive ranges from an earlier translation.
export async function matchesSentenceAlignment(alignment: SentenceAlignmentParagraph, paragraph: {
  id: string;
  revision: number;
  original: string;
  translation: { id: string; version: number; text: string } | null;
}): Promise<boolean> {
  if (alignment.paragraphId !== paragraph.id || alignment.originalRevision !== paragraph.revision || !paragraph.translation || alignment.translationId !== paragraph.translation.id || alignment.translationVersion !== paragraph.translation.version) return false;
  const [originalHash, translationHash] = await Promise.all([textSha256(paragraph.original), textSha256(paragraph.translation.text)]);
  if (alignment.originalSha256 !== originalHash || alignment.translationSha256 !== translationHash) return false;
  if (alignment.periodSentences && !matchesPeriodSentenceRanges(alignment.periodSentences, paragraph.original, paragraph.translation.text)) return false;
  if (alignment.tailSentences && (!matchesTailSentenceRanges(alignment.tailSentences, paragraph.original, paragraph.translation.text)
    || alignment.tailSentences[0]?.translationStart !== tailTranslationStart(alignment, paragraph.original))) return false;
  const originalSpans = splitSentenceSpans(paragraph.original);
  const translationSpans = splitSentenceSpans(paragraph.translation.text);
  const originalBoundaries = new Set(originalSpans.map(span => span.end));
  const translationBoundaries = new Set(translationSpans.map(span => span.end));
  const last = alignment.groups.at(-1);
  if (!last || last.originalEnd !== [...paragraph.original].length || last.translationEnd !== [...paragraph.translation.text].length) return false;
  return alignment.groups.every(group => {
    const sentenceCount = originalSpans.filter(span => span.start >= group.originalStart && span.end <= group.originalEnd).length;
    return originalBoundaries.has(group.originalEnd) && translationBoundaries.has(group.translationEnd)
      && (group.kind !== 'sentence' || (sentenceCount === 1 && hasOuterSentencePunctuation(sliceCodePoints(paragraph.original, group.originalStart, group.originalEnd))))
      && (group.kind !== 'group' || sentenceCount >= 2);
  });
}
