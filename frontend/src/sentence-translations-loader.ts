import { findSentenceAlignment, matchesSentenceAlignment, sliceCodePoints, splitPeriodSpans, splitSentenceSpans, validateSentenceAlignmentDocument } from './sentence-alignment.ts';
import type { SentenceAlignmentDocument, SentenceAlignmentParagraph } from './sentence-alignment.ts';
import { originalTextTag } from './reading-headings.ts';
import type { ChapterParagraph } from './types.ts';

export interface SentenceTranslationPart {
  id: string;
  original: string;
  translation: string | null;
  kind: 'sentence' | 'unaligned' | 'unavailable';
  groupId: string;
}

type Fetcher = typeof fetch;
const caches = new WeakMap<Fetcher, Map<string, Promise<SentenceAlignmentDocument | null>>>();

function chapterIdForParagraph(id: string): string | null {
  return /^(\w+-v\d+)-p\d+$/.exec(id)?.[1] ?? null;
}

function displayedSpans(paragraph: ChapterParagraph, displayedOriginal: string) {
  const canonical = splitPeriodSpans(paragraph.original);
  const displayed = splitPeriodSpans(displayedOriginal);
  if (canonical.length !== displayed.length) {
    return [{ start: 0, end: Array.from(paragraph.original).length, text: displayedOriginal, clickable: false }];
  }
  const heading = originalTextTag(paragraph) !== 'p';
  return canonical.map((span, index) => ({ ...span, text: displayed[index]?.text ?? span.text, clickable: span.text.includes('。') || heading }));
}

export function paragraphTranslationParts(paragraph: ChapterParagraph, displayedOriginal: string): SentenceTranslationPart[] {
  const spans = displayedSpans(paragraph, displayedOriginal);
  return spans.map((span, index) => {
    const id = `${paragraph.id}-sentence-${index}`;
    const available = span.clickable && !!paragraph.translation;
    const singleSentence = available && spans.length === 1;
    return {
      id, original: span.text,
      translation: singleSentence ? paragraph.translation!.text : null,
      kind: singleSentence ? 'sentence' : available ? 'unaligned' : 'unavailable',
      groupId: id,
    };
  });
}

function validRanges(alignment: SentenceAlignmentParagraph, paragraph: ChapterParagraph): boolean {
  if (!paragraph.translation) return false;
  const original = splitSentenceSpans(paragraph.original);
  const starts = new Set(original.map(span => span.start));
  const ends = new Set(original.map(span => span.end));
  let sourceEnd = 0;
  let translatedEnd = 0;
  for (const group of alignment.groups) {
    if (group.originalStart !== sourceEnd || group.translationStart !== translatedEnd
      || !starts.has(group.originalStart) || !ends.has(group.originalEnd)) return false;
    const count = original.filter(span => span.start >= group.originalStart && span.end <= group.originalEnd).length;
    if (group.kind === 'sentence' && count !== 1 || group.kind === 'group' && count < 2
      || group.kind === 'paragraph' && alignment.groups.length !== 1) return false;
    sourceEnd = group.originalEnd;
    translatedEnd = group.translationEnd;
  }
  return sourceEnd === Array.from(paragraph.original).length
    && translatedEnd === Array.from(paragraph.translation.text).length;
}

async function readIndex(url: string, fetcher: Fetcher): Promise<SentenceAlignmentDocument | null> {
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  let pending = cache.get(url);
  if (!pending) {
    pending = fetcher(url, { credentials: 'omit', signal: AbortSignal.timeout(10000) }).then(async response => {
      if (!response.ok) return null;
      return validateSentenceAlignmentDocument(await response.json());
    }).catch(() => null);
    cache.set(url, pending);
    const currentCache = cache;
    const currentRequest = pending;
    void pending.then(index => {
      if (!index && currentCache.get(url) === currentRequest) currentCache.delete(url);
    });
  }
  return pending;
}

export async function readSentenceTranslationParts({ paragraph, displayedOriginal, archiveBase = '/', fetcher = fetch, signal }: {
  paragraph: ChapterParagraph;
  displayedOriginal: string;
  archiveBase?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}): Promise<SentenceTranslationPart[]> {
  signal?.throwIfAborted();
  const fallback = paragraphTranslationParts(paragraph, displayedOriginal);
  const chapterId = chapterIdForParagraph(paragraph.id);
  if (!paragraph.translation || !chapterId) return fallback;
  const document = await readIndex(`${archiveBase.replace(/\/$/, '')}/history/sentence-alignments/${chapterId}.json`, fetcher);
  signal?.throwIfAborted();
  if (!document || document.chapterId !== chapterId) return fallback;
  const alignment = findSentenceAlignment(document, paragraph.id);
  if (!alignment || !validRanges(alignment, paragraph)) return fallback;
  try { if (!await matchesSentenceAlignment(alignment, paragraph)) return fallback; }
  catch { return fallback; }
  signal?.throwIfAborted();
  return displayedSpans(paragraph, displayedOriginal).map((span, index) => {
    if (!span.clickable) return fallback[index] ?? fallback[0]!;
    const explicit = alignment.periodSentences?.find(sentence => sentence.originalStart === span.start && sentence.originalEnd === span.end);
    const groups = alignment.groups.filter(group => group.originalStart < span.end && group.originalEnd > span.start);
    const first = groups[0];
    const last = groups.at(-1);
    const exact = first?.originalStart === span.start && last?.originalEnd === span.end;
    if ((!explicit && !exact) || !paragraph.translation) return fallback[index] ?? fallback[0]!;
    const translationStart = explicit?.translationStart ?? first!.translationStart;
    const translationEnd = explicit?.translationEnd ?? last!.translationEnd;
    const id = `${paragraph.id}-sentence-${index}`;
    return {
      id,
      original: span.text,
      translation: sliceCodePoints(paragraph.translation.text, translationStart, translationEnd),
      kind: 'sentence',
      groupId: id,
    };
  });
}
