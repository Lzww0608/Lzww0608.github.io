import registeredChapters from './reading-annotation-chapters.json' with { type: 'json' };
import registeredLocations from './reading-annotation-locations.json' with { type: 'json' };
import { textSha256, splitReadingSpans } from './sentence-alignment.ts';
import { matchesReadingAnnotationOccurrences, parseReadingAnnotationDocument } from './reading-annotations-schema.ts';
import type { ReadingAnnotationCategory, ReadingAnnotationChapterDocument, ReadingAnnotationReference } from './reading-annotations-schema.ts';
import type { ChapterParagraph } from './types.ts';

export interface ReadingAnnotation {
  id: string;
  term: string;
  kind: ReadingAnnotationCategory;
  explanation: string;
  uncertainty: string | null;
  references: ReadingAnnotationReference[];
}
export interface ReadingAnnotationResult { status: 'available' | 'stale' | 'unavailable'; annotations: ReadingAnnotation[] }
type Fetcher = typeof fetch;
const caches = new WeakMap<Fetcher, Map<string, Promise<ReadingAnnotationChapterDocument | null>>>();
export const knownReadingAnnotationChapters: readonly string[] = registeredChapters;
export interface ReadingAnnotationLocation { paragraphId: string; sentenceIndices: number[] }
export const knownReadingAnnotationLocations: readonly ReadingAnnotationLocation[] = registeredLocations;
const knownSentenceLocations = new Map(knownReadingAnnotationLocations.map(location => [location.paragraphId, new Set(location.sentenceIndices)]));
const empty = (status: ReadingAnnotationResult['status']): ReadingAnnotationResult => ({ status, annotations: [] });

// Tiny build-time metadata lets unsupported clicks stay silent. The full notes
// still require current-original validation; this list never authorizes a note.
export function hasReadingAnnotations(paragraphId: string, sentenceIndex: number, locations?: readonly ReadingAnnotationLocation[]): boolean {
  if (!Number.isSafeInteger(sentenceIndex) || sentenceIndex < 0) return false;
  return locations === undefined ? knownSentenceLocations.get(paragraphId)?.has(sentenceIndex) === true
    : locations.some(location => location.paragraphId === paragraphId && location.sentenceIndices.includes(sentenceIndex));
}

function awaitCurrent<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted)).catch(() => {});
  });
}

function readChapter(url: string, chapterId: string, fetcher: Fetcher): Promise<ReadingAnnotationChapterDocument | null> {
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  let pending = cache.get(url);
  if (!pending) {
    pending = Promise.resolve().then(() => fetcher(url, { credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(10_000) }))
      .then(async response => response.ok ? parseReadingAnnotationDocument(await response.json(), chapterId) as ReadingAnnotationChapterDocument : null)
      .catch(() => null);
    cache.set(url, pending);
    const currentCache = cache, currentRequest = pending;
    void pending.then(document => { if (!document && currentCache.get(url) === currentRequest) currentCache.delete(url); });
  }
  return pending;
}

// This loader never fetches old chapter text. It validates annotation metadata
// against the exact current paragraph already accepted by the reader/API loader.
export async function readReadingAnnotations({ paragraph, sentenceIndex, archiveBase = '/', signal, fetcher = fetch,
  knownChapters = knownReadingAnnotationChapters }: {
  paragraph: ChapterParagraph;
  sentenceIndex: number;
  archiveBase?: string;
  signal?: AbortSignal;
  fetcher?: Fetcher;
  knownChapters?: readonly string[];
}): Promise<ReadingAnnotationResult> {
  signal?.throwIfAborted();
  const chapterId = /^([a-z]+-v\d+)-p[1-9][0-9]*$/.exec(paragraph.id)?.[1];
  if (!chapterId || !knownChapters.includes(chapterId) || !Number.isSafeInteger(sentenceIndex)
    || sentenceIndex < 0 || !splitReadingSpans(paragraph.original)[sentenceIndex]) return empty('available');
  const document = await awaitCurrent(readChapter(`${archiveBase.replace(/\/$/, '')}/history/reading-annotations/${chapterId}.json`, chapterId, fetcher), signal);
  signal?.throwIfAborted();
  if (!document) return empty('unavailable');
  const binding = document.paragraphs.find(value => value.paragraphId === paragraph.id);
  if (!binding) return empty('available');
  if (!matchesReadingAnnotationOccurrences(binding, paragraph, document.entries)) return empty('stale');
  const currentHash = await awaitCurrent(textSha256(paragraph.original), signal);
  signal?.throwIfAborted();
  if (binding.originalSha256 !== currentHash) return empty('stale');
  const ids = new Set(binding.occurrences.filter(occurrence => occurrence.sentenceIndex === sentenceIndex)
    .sort((left, right) => left.originalStart - right.originalStart || right.originalEnd - left.originalEnd)
    .map(occurrence => occurrence.entryId));
  if (!ids.size) return empty('available');
  const references = new Map(document.references.map(reference => [reference.id, reference]));
  const entries = new Map(document.entries.map(entry => [entry.id, entry]));
  return { status: 'available', annotations: [...ids].map(id => entries.get(id)!).map(entry => ({
    id: entry.id, term: entry.term, kind: entry.kind, explanation: entry.explanation, uncertainty: entry.uncertainty,
    references: entry.referenceIds.map(id => ({ ...references.get(id)! })),
  })) };
}
