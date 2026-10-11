import { libraryBooks, libraryChapters } from './library.ts';
import { catalogPeople } from './person-catalog.ts';
import { eventComparisons } from './event-comparison-data.ts';
import { timelineEventIdentity } from './event-timeline-links-schema.ts';
import { timelineHash } from './person-timeline-schema.ts';
import { READING_SHELF_APP, READING_SHELF_LIMITS, parseReadingShelfDocument, parseReadingShelfJson, parseReadingProgress, parseReadingBookmark,
  parseReadingShelfRoute, normalizeReadingShelfRoute, inferReadingPerson, readingProgressId, paragraphBookmarkId, eventBookmarkId } from './reading-shelf-schema.ts';
import type { ChapterParagraph, Route } from './types.ts';
import type { PersonTimelineResponse } from './person-timeline-schema.ts';
import type { ReadingProgress, ReadingBookmark, ParagraphBookmark, EventBookmark, ReadingShelfDocument, ReadingShelfSnapshot } from './reading-shelf-schema.ts';
export * from './reading-shelf-schema.ts';

export const READING_SHELF_STORAGE_KEY = 'ancient-history-reading-shelf-v1';
export interface ReadingShelfStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ReadingShelfImportPreview { document: ReadingShelfDocument; progressCount: number; bookmarkCount: number }
type Operation = (document: ReadingShelfDocument) => ReadingShelfDocument;
const empty = (): ReadingShelfDocument => ({ schemaVersion: 1, app: READING_SHELF_APP, progress: [], bookmarks: [] });
const clone = <T>(value: T): T => structuredClone(value);
function newest<T extends { id: string }>(items: T[], time: (item: T) => string): T[] {
  return items.sort((a, b) => time(b).localeCompare(time(a)) || a.id.localeCompare(b.id));
}
function mergeRows<T extends { id: string }>(local: T[], incoming: T[], time: (item: T) => string): T[] {
  const rows = new Map(local.map(item => [item.id, item]));
  for (const item of incoming) if (!rows.has(item.id) || time(item) > time(rows.get(item.id)!)) rows.set(item.id, item);
  return newest([...rows.values()], time);
}
function freezeSnapshot(value: ReadingShelfSnapshot): ReadingShelfSnapshot {
  function freeze(item: unknown) { if (item && typeof item === 'object') { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } }
  freeze(value); return value;
}

export function createReadingShelfStore({ storage, clock = () => new Date(), events }: {
  storage?: ReadingShelfStorage | null;
  clock?: () => Date | string | number;
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
} = {}) {
  let notice: string | null = null;
  let backing = storage;
  if (backing === undefined) {
    try { backing = typeof window === 'undefined' ? null : window.localStorage; }
    catch { backing = null; notice = '当前浏览器无法保存阅读资料，暂存于本页；请导出后再关闭页面。'; }
  }
  const listeners = new Set<() => void>();
  let lastStored = empty();
  let pending: Operation[] = [];
  function readBacking(): ReadingShelfDocument {
    if (!backing) return lastStored;
    try {
      const raw = backing.getItem(READING_SHELF_STORAGE_KEY);
      const document = raw === null ? empty() : parseReadingShelfJson(raw);
      return { ...document, progress: newest(document.progress, item => item.updatedAt), bookmarks: newest(document.bookmarks, item => item.savedAt) };
    } catch {
      notice = '无法读取浏览器中保存的阅读资料，现有记录仍保留于本页；可先导出。';
      return lastStored;
    }
  }
  lastStored = readBacking();
  let snapshot = freezeSnapshot({ ...clone(lastStored), notice });
  function notify(document: ReadingShelfDocument) {
    const next = { ...clone(document), notice };
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = freezeSnapshot(next);
    for (const listener of listeners) listener();
  }
  function commit(operation: Operation) {
    // Every mutation re-reads the shared key. A stale tab therefore cannot
    // overwrite another tab's new bookmark or resurrect its deleted records.
    const current = readBacking();
    let document = current;
    for (const waiting of pending) document = waiting(document);
    const proposed = operation(document);
    if (proposed.progress.length > READING_SHELF_LIMITS.progress || proposed.bookmarks.length > READING_SHELF_LIMITS.bookmarks) throw new Error('阅读资料超出容量，请先导出并清理部分记录。');
    document = parseReadingShelfDocument(proposed);
    const serialized = JSON.stringify(document);
    if (new TextEncoder().encode(serialized).length > READING_SHELF_LIMITS.bytes) throw new Error('阅读资料过多，请先导出并清理部分记录。');
    if (backing) {
      try { backing.setItem(READING_SHELF_STORAGE_KEY, serialized); lastStored = document; pending = []; notice = null; }
      catch { pending.push(operation); lastStored = current; notice = '浏览器暂时无法保存阅读资料，本页中的记录仍可使用；请导出后再关闭页面。'; }
    } else {
      lastStored = document; pending = [];
      notice = '当前浏览器无法保存阅读资料，暂存于本页；请导出后再关闭页面。';
    }
    notify(document);
  }
  function timestamp() {
    const value = clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
  const eventTarget = events === undefined ? typeof window === 'undefined' ? null : window : events;
  const onStorage = (event: Event) => {
    const change = event as StorageEvent;
    if (change.key !== READING_SHELF_STORAGE_KEY && change.key !== null) return;
    if (change.storageArea && backing && change.storageArea !== backing) return;
    let document = readBacking();
    lastStored = document;
    try {
      for (const waiting of pending) document = waiting(document);
      document = parseReadingShelfDocument(document);
      // Receiving another tab's storage update is read-only. It does not merge
      // an old snapshot back into the shared key and undo deliberate deletion.
      notify(document);
    } catch {
      // A concurrent tab can fill the remaining capacity while this tab holds
      // an unpersisted add. Preserve its exportable snapshot without dropping
      // that add or throwing from the browser's storage event handler.
      notice = '其他标签页的阅读资料已更新，合并后超出容量；本页记录仍保留，请先导出并清理部分记录。';
      notify({ schemaVersion: 1, app: READING_SHELF_APP, progress: snapshot.progress, bookmarks: snapshot.bookmarks });
    }
  };
  eventTarget?.addEventListener('storage', onStorage);
  function getProgress(route: string, context?: string) {
    const canonical = normalizeReadingShelfRoute(route);
    if (!canonical) return;
    const personId = inferReadingPerson(canonical, context);
    return snapshot.progress.find(item => item.id === readingProgressId(canonical, personId));
  }
  function getLatestProgress(personId?: string) { return snapshot.progress.find(item => personId === undefined || item.personId === personId); }
  function saveProgress(input: Omit<ReadingProgress, 'id' | 'updatedAt'>) {
    const route = normalizeReadingShelfRoute(input.route);
    if (!route) throw new Error('无法保存此阅读地址。');
    const personId = inferReadingPerson(route, input.personId);
    if (input.personId !== undefined && personId !== input.personId) throw new Error('阅读人物与地址不匹配。');
    const progress = parseReadingProgress({ ...input, route, ...(personId ? { personId } : {}), id: readingProgressId(route, personId), updatedAt: timestamp() });
    commit(document => ({ ...document, progress: newest([...document.progress.filter(item => item.id !== progress.id), progress], item => item.updatedAt).slice(0, READING_SHELF_LIMITS.progress) }));
    return progress;
  }
  function removeBookmark(id: string) { commit(document => ({ ...document, bookmarks: document.bookmarks.filter(item => item.id !== id) })); }
  function removeProgress(id: string) { commit(document => ({ ...document, progress: document.progress.filter(item => item.id !== id) })); }
  function isParagraphBookmarked(chapterId: string, paragraphId: string, personId?: string) { return snapshot.bookmarks.some(item => item.id === paragraphBookmarkId(chapterId, paragraphId, personId)); }
  function isEventBookmarked(personId: string, eventId: string) { return snapshot.bookmarks.some(item => item.id === eventBookmarkId(personId, eventId)); }
  function putBookmark(bookmark: ReadingBookmark) {
    let current = readBacking();
    for (const waiting of pending) current = waiting(current);
    const enabled = !current.bookmarks.some(item => item.id === bookmark.id);
    commit(document => {
      const others = document.bookmarks.filter(item => item.id !== bookmark.id);
      // Retrying an unpersisted add/remove preserves the user's original
      // intention. Replaying a toggle could invert a concurrent tab's change.
      return { ...document, bookmarks: enabled ? mergeRows(document.bookmarks, [bookmark], item => item.savedAt) : newest(others, item => item.savedAt) };
    });
    return enabled;
  }
  async function toggleParagraphBookmark({ chapterId, paragraph, personId }: { chapterId: string; paragraph: ChapterParagraph; personId?: string }) {
    const bookmark = parseReadingBookmark({ id: paragraphBookmarkId(chapterId, paragraph.id, personId), kind: 'paragraph', chapterId, paragraphId: paragraph.id,
      ...(personId ? { personId } : {}), originalRevision: paragraph.revision, originalSha256: await timelineHash(paragraph.original), savedAt: timestamp() });
    return putBookmark(bookmark);
  }
  async function toggleEventBookmark({ personId, event }: { personId: string; event: PersonTimelineResponse['events'][number] }) {
    const bookmark = parseReadingBookmark({ id: eventBookmarkId(personId, event.id), kind: 'event', personId, eventId: event.id,
      eventSha256: await timelineHash(timelineEventIdentity(event)), label: event.title, savedAt: timestamp() });
    return putBookmark(bookmark);
  }
  function exportJson() {
    return JSON.stringify({ schemaVersion: 1, app: READING_SHELF_APP, progress: snapshot.progress, bookmarks: snapshot.bookmarks }, null, 2);
  }
  function previewImport(text: string): ReadingShelfImportPreview {
    const document = parseReadingShelfJson(text);
    return { document, progressCount: document.progress.length, bookmarkCount: document.bookmarks.length };
  }
  function mergeImport(preview: ReadingShelfImportPreview) {
    const incoming = parseReadingShelfDocument(preview.document);
    commit(document => {
      const progress = mergeRows(document.progress, incoming.progress, item => item.updatedAt);
      const bookmarks = mergeRows(document.bookmarks, incoming.bookmarks, item => item.savedAt);
      if (progress.length > READING_SHELF_LIMITS.progress || bookmarks.length > READING_SHELF_LIMITS.bookmarks) throw new Error('合并后阅读资料超出容量，请先导出并清理部分记录。');
      return { ...document, progress, bookmarks };
    });
    return { progressCount: incoming.progress.length, bookmarkCount: incoming.bookmarks.length };
  }
  return { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getProgress, getLatestProgress, saveProgress, toggleParagraphBookmark, toggleEventBookmark, isParagraphBookmarked, isEventBookmarked,
    removeBookmark, removeProgress, exportJson, previewImport, mergeImport,
    destroy: () => { eventTarget?.removeEventListener('storage', onStorage); listeners.clear(); } };
}

export const readingShelf = createReadingShelfStore();
export function progressResumeRoute(progress: ReadingProgress): Route {
  const checked = parseReadingProgress(progress);
  const resolved = parseReadingShelfRoute(checked.route)!;
  const parameters = new URLSearchParams(checked.route.split('?', 2)[1]);
  if (checked.binding?.kind === 'paragraph' && resolved.kind === 'reader') parameters.set('paragraph', checked.binding.paragraphId);
  if (checked.binding?.kind === 'event') parameters.set('event', checked.binding.eventId);
  if (resolved.kind === 'comparison') {
    const comparison = eventComparisons.find(document => document.id === resolved.comparisonId)!;
    const stage = checked.binding?.kind === 'stage' ? checked.binding.stageId : comparison.stages.find(stage => stage.sourceIds.some(source => checked.position.anchorId === `comparison-paragraph-${comparison.id}-${stage.id}-${source}`))?.id;
    if (stage) parameters.set('stage', stage);
  }
  return `${resolved.path}${parameters.size ? `?${parameters}` : ''}` as Route;
}
export function bookmarkRoute(bookmark: ReadingBookmark): Route {
  const checked = parseReadingBookmark(bookmark);
  if (checked.kind === 'event') return `person-timeline/${checked.personId}?event=${checked.eventId}`;
  const chapter = libraryChapters.find(chapter => chapter.id === checked.chapterId)!;
  return `read-${chapter.bookId}/${chapter.id}?paragraph=${checked.paragraphId}`;
}
export interface ReadingShelfDescription { title: string; detail: string }
export function describeProgress(progress: ReadingProgress): ReadingShelfDescription {
  const checked = parseReadingProgress(progress);
  const resolved = parseReadingShelfRoute(checked.route)!;
  const personName = checked.personId ? catalogPeople.find(person => person.id === checked.personId)!.name : undefined;
  if (resolved.kind === 'timeline') return { title: `${personName}年表`, detail: checked.binding?.kind === 'event' ? '返回上次的年表事件' : '继续阅读人物年表' };
  if (resolved.kind === 'comparison') {
    const document = eventComparisons.find(document => document.id === resolved.comparisonId)!;
    const stageId = checked.binding?.kind === 'stage' ? checked.binding.stageId : parseReadingShelfRoute(progressResumeRoute(checked))?.targetId;
    return { title: document.title, detail: [personName, document.stages.find(stage => stage.id === stageId)?.title ?? '史料对读'].filter(Boolean).join(' · ') };
  }
  if (resolved.kind === 'passages') {
    const book = libraryBooks.find(book => book.id === resolved.path.split('/')[2]);
    return { title: `${personName}的史料记载`, detail: `${book?.title ?? '全部文献'}${checked.view.passages ? ` · 第 ${checked.view.passages.index + 1} 页` : ''}${resolved.query ? ' · 检索结果' : ''}` };
  }
  const chapter = libraryChapters.find(chapter => chapter.id === resolved.chapterId)!;
  const paragraphId = checked.binding?.kind === 'paragraph' ? checked.binding.paragraphId : resolved.targetId;
  return { title: libraryBooks.find(book => book.id === chapter.bookId)!.title, detail: [personName, chapter.title, paragraphId ? `第 ${paragraphId.split('-p').at(-1)} 段` : '完整篇章'].filter(Boolean).join(' · ') };
}
export function describeBookmark(bookmark: ReadingBookmark): ReadingShelfDescription {
  const checked = parseReadingBookmark(bookmark);
  if (checked.kind === 'event') return { title: checked.label, detail: `${catalogPeople.find(person => person.id === checked.personId)!.name} · 年表事件` };
  const chapter = libraryChapters.find(chapter => chapter.id === checked.chapterId)!;
  const personName = checked.personId ? catalogPeople.find(person => person.id === checked.personId)!.name : undefined;
  return { title: `${libraryBooks.find(book => book.id === chapter.bookId)!.title} · ${chapter.title}`, detail: [personName, `原篇第 ${checked.paragraphId.split('-p').at(-1)} 段`].filter(Boolean).join(' · ') };
}
export async function verifyParagraphBookmark(bookmark: ParagraphBookmark, paragraph?: ChapterParagraph): Promise<boolean> {
  return !!paragraph && paragraph.id === bookmark.paragraphId && paragraph.revision === bookmark.originalRevision && await timelineHash(paragraph.original) === bookmark.originalSha256;
}
export async function verifyEventBookmark(bookmark: EventBookmark, event?: PersonTimelineResponse['events'][number]): Promise<boolean> {
  return !!event && event.id === bookmark.eventId && event.title === bookmark.label && await timelineHash(timelineEventIdentity(event)) === bookmark.eventSha256;
}
