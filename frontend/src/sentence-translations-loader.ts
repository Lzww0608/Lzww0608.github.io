import { findSentenceAlignment, matchesSentenceAlignment, sliceCodePoints, splitSentenceSpans, validateSentenceAlignmentDocument } from './sentence-alignment.ts';
import type { SentenceAlignmentDocument, SentenceAlignmentParagraph } from './sentence-alignment.ts';
import type { ChapterParagraph } from './types.ts';

export interface SentenceTranslationPart {
  id: string;
  original: string;
  translation: string | null;
  kind: 'sentence' | 'group' | 'paragraph' | 'unavailable';
  groupId: string;
}

type Fetcher = typeof fetch;
const caches = new WeakMap<Fetcher, Map<string, Promise<SentenceAlignmentDocument | null>>>();

function chapterIdForParagraph(id: string): string | null {
  return /^(\w+-v\d+)-p\d+$/.exec(id)?.[1] ?? null;
}

function displayedSpans(paragraph: ChapterParagraph, displayedOriginal: string) {
  const canonical = splitSentenceSpans(paragraph.original);
  const displayed = splitSentenceSpans(displayedOriginal);
  if (canonical.length !== displayed.length) {
    return [{ start: 0, end: Array.from(paragraph.original).length, text: displayedOriginal }];
  }
  return canonical.map((span, index) => ({ ...span, text: displayed[index]?.text ?? span.text }));
}

export function paragraphTranslationParts(paragraph: ChapterParagraph, displayedOriginal: string): SentenceTranslationPart[] {
  return displayedSpans(paragraph, displayedOriginal).map((span, index) => ({
    id: `${paragraph.id}-sentence-${index}`,
    original: span.text,
    translation: paragraph.translation?.text ?? null,
    kind: paragraph.translation ? 'paragraph' : 'unavailable',
    groupId: `${paragraph.id}-paragraph`,
  }));
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
    const groupIndex = alignment.groups.findIndex(group => group.originalStart <= span.start && group.originalEnd >= span.end);
    const group = alignment.groups[groupIndex];
    if (!group || !paragraph.translation) return fallback[index] ?? fallback[0]!;
    return {
      id: `${paragraph.id}-sentence-${index}`,
      original: span.text,
      translation: sliceCodePoints(paragraph.translation.text, group.translationStart, group.translationEnd),
      kind: group.kind,
      groupId: `${paragraph.id}-group-${groupIndex}`,
    };
  });
}
