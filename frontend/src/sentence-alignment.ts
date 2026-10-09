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

export interface SentenceAlignmentParagraph {
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  translationId: string;
  translationVersion: number;
  translationSha256: string;
  groups: SentenceAlignmentGroup[];
  periodSentences?: PeriodSentenceAlignment[];
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
