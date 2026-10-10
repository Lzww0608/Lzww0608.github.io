import { parsePublishedTranslation } from './chapter-schema.ts';
import { requestEditorJson, TranslationEditorError } from './translation-editor-api.ts';
import type { EditorRequestOptions } from './translation-editor-api.ts';
import { reviewCategories, reviewStatuses } from './owner-review-route.ts';
import type { OwnerReviewFilters } from './owner-review-route.ts';
import type { OwnerReviewDetail, OwnerReviewItem, OwnerReviewResponse, ReviewStatus } from './types.ts';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum = 20000): string => {
  if (typeof value !== 'string' || value.length > maximum) throw new Error();
  return value;
};
const integer = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error();
  return value as number;
};
const id = (value: unknown) => {
  const result = text(value, 200);
  if (!/^[a-zA-Z0-9-]+$/.test(result)) throw new Error();
  return result;
};
const sourceId = (value: unknown) => {
  const result = text(value, 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new Error();
  return result;
};
const hash = (value: unknown) => {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error();
  return result;
};
const bookIds = ['old', 'new', 'tongjian', 'quewen', 'shibu', 'chunqiu', 'huiyao', 'beimeng', 'kaoyi'];

export function parseOwnerReviewItem(value: unknown): OwnerReviewItem {
  const item = object(value);
  if (!reviewCategories.includes(item.category as OwnerReviewItem['category']) || !reviewStatuses.includes(item.status as ReviewStatus)
    || !['info', 'warning', 'error'].includes(item.severity as string) || !bookIds.includes(item.bookId as string)
    || typeof item.currentBinding !== 'boolean' || !Array.isArray(item.evidence) || item.evidence.length > 100) throw new Error();
  const chapterId = sourceId(item.chapterId);
  const paragraphId = sourceId(item.paragraphId);
  if (!paragraphId.startsWith(`${chapterId}-p`)) throw new Error();
  const translationId = item.translationId === null ? null : id(item.translationId);
  const translationVersion = item.translationVersion === null ? null : integer(item.translationVersion, 1);
  const translationSha256 = item.translationSha256 === null ? null : hash(item.translationSha256);
  if ([translationId, translationVersion, translationSha256].filter(value => value !== null).length % 3) throw new Error();
  const checkedAt = item.checkedAt === null ? null : text(item.checkedAt, 80);
  if (checkedAt && !Number.isFinite(Date.parse(checkedAt))) throw new Error();
  return {
    id: id(item.id), personId: id(item.personId), personName: text(item.personName, 100), bookId: item.bookId as OwnerReviewItem['bookId'],
    chapterId, paragraphId, category: item.category as OwnerReviewItem['category'], status: item.status as ReviewStatus,
    severity: item.severity as OwnerReviewItem['severity'], title: text(item.title, 400), detail: text(item.detail),
    evidence: item.evidence.map(value => { const evidence = object(value); return { chapterId: sourceId(evidence.chapterId), paragraphId: sourceId(evidence.paragraphId), excerpt: text(evidence.excerpt) }; }),
    originalRevision: integer(item.originalRevision, 1), originalSha256: hash(item.originalSha256),
    translationId, translationVersion, translationSha256, checkedAt, resolution: text(item.resolution), batchId: id(item.batchId),
    version: integer(item.version, 1), currentBinding: item.currentBinding,
  };
}

export function parseOwnerReviewResponse(value: unknown, filters: OwnerReviewFilters): OwnerReviewResponse {
  const response = object(value);
  if (response.schemaVersion !== 1 || !Array.isArray(response.subjects) || !Array.isArray(response.items) || response.items.length > 50) throw new Error();
  const subjects = response.subjects.map(value => { const subject = object(value); return { id: id(subject.id), name: text(subject.name, 100) }; });
  if (new Set(subjects.map(subject => subject.id)).size !== subjects.length) throw new Error();
  const items = response.items.map(parseOwnerReviewItem);
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => !subjects.some(subject => subject.id === item.personId))) throw new Error();
  if (items.some(item => filters.personId && item.personId !== filters.personId || filters.bookId && item.bookId !== filters.bookId
    || filters.category && item.category !== filters.category || filters.status && (filters.status === 'stale' ? item.currentBinding : item.status !== filters.status))) throw new Error();
  const total = integer(response.total);
  const nextOffset = response.nextOffset === null ? null : integer(response.nextOffset, 1);
  const expectedLength = Math.min(50, Math.max(total - filters.offset, 0));
  const expectedNextOffset = filters.offset + expectedLength < total ? filters.offset + expectedLength : null;
  if (items.length !== expectedLength || nextOffset !== expectedNextOffset) throw new Error();
  const summary = object(response.summary);
  return { schemaVersion: 1, subjects, total, summary: { open: integer(summary.open), resolved: integer(summary.resolved), retained: integer(summary.retained), checked: integer(summary.checked), stale: integer(summary.stale) },
    items, nextOffset, resultSetRevision: text(response.resultSetRevision, 200) };
}

function invalidResponse(): TranslationEditorError { return new TranslationEditorError('校核清单的返回内容无法核验，请重新读取。'); }
async function textSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadOwnerReviews(options: EditorRequestOptions & { filters: OwnerReviewFilters }): Promise<OwnerReviewResponse> {
  const parameters = new URLSearchParams({ limit: '50', offset: String(options.filters.offset) });
  for (const key of ['personId', 'bookId', 'status', 'category'] as const) if (options.filters[key]) parameters.set(key, options.filters[key]);
  const result = await requestEditorJson({ ...options, path: `/api/editor/reviews?${parameters}` });
  try { return parseOwnerReviewResponse(result, options.filters); } catch { throw invalidResponse(); }
}

export async function loadOwnerReviewDetail(options: EditorRequestOptions & { id: string }): Promise<OwnerReviewDetail> {
  const result = await requestEditorJson({ ...options, path: `/api/editor/reviews/${encodeURIComponent(id(options.id))}` });
  try {
    const response = object(result);
    const item = parseOwnerReviewItem(response.item);
    if (item.id !== options.id) throw new Error();
    if (response.paragraph === null) {
      if (item.currentBinding) throw new Error();
      return { item, paragraph: null };
    }
    const paragraph = object(response.paragraph);
    if (paragraph.id !== item.paragraphId) throw new Error();
    const parsedParagraph = { id: sourceId(paragraph.id), position: integer(paragraph.position, 1), revision: integer(paragraph.revision, 1), original: text(paragraph.original, 100000), translation: paragraph.translation === null ? null : parsePublishedTranslation(paragraph.translation) };
    if (item.currentBinding && (parsedParagraph.revision !== item.originalRevision || item.translationId !== null && (!parsedParagraph.translation || parsedParagraph.translation.id !== item.translationId || parsedParagraph.translation.version !== item.translationVersion))) throw new Error();
    if (item.currentBinding && (await textSha256(parsedParagraph.original) !== item.originalSha256 || item.translationId !== null && await textSha256(parsedParagraph.translation!.text) !== item.translationSha256)) throw new Error();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return { item, paragraph: parsedParagraph };
  } catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') throw cause; throw invalidResponse(); }
}

export async function updateOwnerReviewStatus(options: EditorRequestOptions & { item: OwnerReviewItem; status: ReviewStatus; resolution: string }): Promise<OwnerReviewItem> {
  if (!options.item.currentBinding) throw new TranslationEditorError('原文或译文版本已变更，请复查后再记录结论。', 409);
  if (!reviewStatuses.includes(options.status) || !options.resolution.trim() || options.resolution.length > 4000) throw new TranslationEditorError('请填写处理结论，最多 4,000 个字符。');
  const result = await requestEditorJson({ ...options, path: `/api/editor/reviews/${encodeURIComponent(id(options.item.id))}/status`, method: 'POST', body: { expectedVersion: options.item.version, status: options.status, resolution: options.resolution.trim() } });
  try {
    const item = parseOwnerReviewItem(object(result).item);
    if (item.id !== options.item.id || item.version <= options.item.version || item.status !== options.status) throw new Error();
    return item;
  } catch { throw invalidResponse(); }
}
