import { splitPeriodSpans, textSha256 } from './sentence-alignment.ts';
import type { PublishedSentenceReference } from './sentence-alignment.ts';
import type { ChapterParagraph } from './types.ts';

export interface PublishedSentenceTranslation {
  id: string;
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  originalStart: number;
  originalEnd: number;
  parentTranslationId: string;
  parentTranslationVersion: number;
  parentTranslationSha256: string;
  version: number;
  text: string;
  textSha256: string;
  origin: 'ai' | 'human';
  humanReviewed: boolean;
  reviewNotes: string[];
}
export interface PublishedSentenceTranslationDocument {
  schemaVersion: 1;
  status: 'published';
  chapterId: string;
  entries: PublishedSentenceTranslation[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const offset = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const checksum = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parsePublishedSentenceTranslations(input: unknown): PublishedSentenceTranslationDocument | null {
  if (!object(input) || input.schemaVersion !== 1 || input.status !== 'published' || typeof input.chapterId !== 'string'
    || !/^[a-z]+-v\d+$/.test(input.chapterId) || !Array.isArray(input.entries) || input.entries.length > 10000) return null;
  const ids = new Set<string>(), spans = new Set<string>();
  for (const entry of input.entries) {
    if (!object(entry) || typeof entry.id !== 'string' || !/^sentence-[a-z0-9-]+$/.test(entry.id)
      || typeof entry.paragraphId !== 'string' || !new RegExp(`^${input.chapterId}-p[1-9]\\d*$`).test(entry.paragraphId)
      || !positive(entry.originalRevision) || !checksum(entry.originalSha256) || !offset(entry.originalStart)
      || !positive(entry.originalEnd) || entry.originalEnd <= entry.originalStart
      || typeof entry.parentTranslationId !== 'string' || !/^[1-9]\d*$/.test(entry.parentTranslationId)
      || !positive(entry.parentTranslationVersion) || !checksum(entry.parentTranslationSha256) || !positive(entry.version)
      || !checksum(entry.textSha256) || typeof entry.text !== 'string' || !entry.text.trim() || [...entry.text].length > 20000
      || !['ai', 'human'].includes(String(entry.origin)) || typeof entry.humanReviewed !== 'boolean'
      || entry.origin === 'ai' && entry.humanReviewed !== false
      || !Array.isArray(entry.reviewNotes) || entry.reviewNotes.length > 20
      || entry.reviewNotes.some(note => typeof note !== 'string' || !note.trim() || [...note].length > 2000)) return null;
    const key = `${entry.paragraphId}/${entry.originalStart}/${entry.originalEnd}`;
    if (ids.has(entry.id) || spans.has(key)) return null;
    ids.add(entry.id); spans.add(key);
  }
  return input as unknown as PublishedSentenceTranslationDocument;
}

export async function currentPublishedSentenceTranslations(document: PublishedSentenceTranslationDocument,
  paragraph: ChapterParagraph, expected: readonly PublishedSentenceReference[]): Promise<PublishedSentenceTranslation[]> {
  if (!paragraph.translation) return [];
  const [originalHash, parentHash] = await Promise.all([textSha256(paragraph.original), textSha256(paragraph.translation.text)]);
  const periods = splitPeriodSpans(paragraph.original);
  const checked = await Promise.all(document.entries.map(async entry => {
    const binding = expected.find(ref => ref.id === entry.id);
    return !!binding && binding.version === entry.version && binding.textSha256 === entry.textSha256
      && await textSha256(entry.text) === entry.textSha256;
  }));
  return document.entries.filter((entry, index) => checked[index] && entry.paragraphId === paragraph.id
    && entry.originalRevision === paragraph.revision && entry.originalSha256 === originalHash
    && entry.parentTranslationId === paragraph.translation!.id && entry.parentTranslationVersion === paragraph.translation!.version
    && entry.parentTranslationSha256 === parentHash
    && periods.some(period => period.start === entry.originalStart && period.end === entry.originalEnd));
}
