import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { readingNavigation, readingSnapshotCurrent } from './reading-navigation-state';
import { captureReadingPosition } from './use-reading-position';
import { timelineEventIdentity } from './event-timeline-links';
import { bookmarkRoute, readingShelf } from './reading-shelf';
import { parseReadingBookmark, parseReadingShelfRoute, readingProgressId } from './reading-shelf-schema';
import type { ReadingBookmark, ReadingProgress, ReadingProgressBinding, ReadingShelfView } from './reading-shelf-schema';
import type { ChapterParagraph, Route } from './types';
import type { PersonTimelineResponse } from './person-timeline-schema';

type ParagraphAnchor = { anchorId: string; chapterId: string; paragraph: ChapterParagraph };
type EventAnchor = { anchorId: string; personId: string; event: PersonTimelineResponse['events'][number] };
type StageAnchor = { anchorId: string; comparisonId: string; stageId: string; sources: (ParagraphAnchor & { sourceId: string })[] };
export type PublicReadingAnchor = ParagraphAnchor | EventAnchor | StageAnchor;

let pending: { progress: ReadingProgress; id: number } | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emit = () => { revision++; for (const listener of listeners) listener(); };

// App calls this only after the existing dirty-editor navigation guard allows
// the action. It is a single public reference, never a return chain or draft.
export function prepareReadingResume(progress: ReadingProgress): void {
  pending = { progress: structuredClone(progress), id: ++revision };
  emit();
}

export function prepareReadingBookmark(bookmark: ReadingBookmark): void {
  const checked = parseReadingBookmark(bookmark);
  const route = bookmarkRoute(checked);
  const binding: ReadingProgressBinding = checked.kind === 'paragraph'
    ? { kind: 'paragraph', chapterId: checked.chapterId, paragraphId: checked.paragraphId, originalRevision: checked.originalRevision, originalSha256: checked.originalSha256 }
    : { kind: 'event', personId: checked.personId, eventId: checked.eventId, eventSha256: checked.eventSha256 };
  prepareReadingResume({ id: readingProgressId(route, checked.personId), route, personId: checked.personId, updatedAt: checked.savedAt,
    position: { scrollY: 0, anchorId: checked.kind === 'paragraph' ? checked.paragraphId : `timeline-event-${checked.eventId}`, offset: 24, details: {} }, view: {}, binding });
}

export function hydrateReadingProgress(route: Route, personId?: string): void {
  const progress = readingShelf.getProgress(route, personId);
  if (progress) prepareReadingResume(progress);
}

export function clearReadingResume(): void {
  if (pending) { pending = null; emit(); }
}

export function pendingReadingResume(route: Route): ReadingProgress | null {
  if (!pending) return null;
  const current = parseReadingShelfRoute(route, true), saved = parseReadingShelfRoute(pending.progress.route);
  return current && saved && current.path === saved.path && current.query === saved.query && current.field === saved.field ? pending.progress : null;
}

export function readingResumeNonce(route: Route): number | undefined {
  return pendingReadingResume(route) ? pending?.id : undefined;
}

async function hash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function anchorBinding(anchor: PublicReadingAnchor): Promise<ReadingProgressBinding> {
  if ('paragraph' in anchor) return { kind: 'paragraph', chapterId: anchor.chapterId, paragraphId: anchor.paragraph.id,
    originalRevision: anchor.paragraph.revision, originalSha256: await hash(anchor.paragraph.original) };
  if ('event' in anchor) return { kind: 'event', personId: anchor.personId, eventId: anchor.event.id, eventSha256: await hash(timelineEventIdentity(anchor.event)) };
  return { kind: 'stage', comparisonId: anchor.comparisonId, stageId: anchor.stageId,
    sourceBindings: await Promise.all(anchor.sources.map(async source => ({ sourceId: source.sourceId, chapterId: source.chapterId,
      paragraphId: source.paragraph.id, originalRevision: source.paragraph.revision, originalSha256: await hash(source.paragraph.original) }))) };
}

function bindingMatches(saved: ReadingProgressBinding | undefined, current: ReadingProgressBinding | undefined): boolean {
  if (!saved || !current || saved.kind !== current.kind) return false;
  if (saved.kind === 'paragraph' && current.kind === 'paragraph') return saved.chapterId === current.chapterId && saved.paragraphId === current.paragraphId && saved.originalRevision === current.originalRevision && saved.originalSha256 === current.originalSha256;
  if (saved.kind === 'event' && current.kind === 'event') return saved.personId === current.personId && saved.eventId === current.eventId && saved.eventSha256 === current.eventSha256;
  if (saved.kind === 'stage' && current.kind === 'stage') return saved.comparisonId === current.comparisonId && saved.stageId === current.stageId && saved.sourceBindings.length > 0 && saved.sourceBindings.every(source => current.sourceBindings.some(item => item.sourceId === source.sourceId && item.chapterId === source.chapterId && item.paragraphId === source.paragraphId && item.originalRevision === source.originalRevision && item.originalSha256 === source.originalSha256));
  return false;
}

export function useReadingProgress({ route, personId, ready, anchors, view, navigationView, progressRoute, blockedNotice }: {
  route: Route;
  personId?: string;
  ready: boolean;
  anchors: PublicReadingAnchor[];
  view?: ReadingShelfView;
  navigationView?: (view: ReadingShelfView) => object;
  progressRoute?: (anchorId: string | undefined) => Route;
  blockedNotice?: string;
}) {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  const storageNotice = useSyncExternalStore(readingShelf.subscribe, () => readingShelf.getSnapshot().notice, () => null);
  const candidate = pendingReadingResume(route);
  const pendingId = candidate ? pending?.id : undefined;
  const [checked, setChecked] = useState<number | undefined>();
  const [notice, setNotice] = useState('');
  const [noticeActivation, setNoticeActivation] = useState<number | undefined>();
  const showNotice = (text: string) => { setNotice(text); setNoticeActivation(readingNavigation.current()?.activation); };
  const [staleActivation, setStaleActivation] = useState<number | undefined>();
  const [bindings, setBindings] = useState<Map<string, ReadingProgressBinding>>(new Map());
  const bindingCache = useRef<{ key: string; bindings: Map<string, ReadingProgressBinding> } | null>(null);
  const entryId = readingNavigation.current()?.id;
  const activation = readingNavigation.current()?.activation;
  const stale = staleActivation !== undefined && staleActivation === activation;
  const latest = useRef({ route, personId, view, progressRoute, ready, bindings });
  latest.current = { route, personId, view, progressRoute, ready, bindings };
  const restored = pendingId === undefined || checked === pendingId;
  const publicKey = useMemo(() => anchors.map(anchor => 'paragraph' in anchor ? `${anchor.anchorId}/${anchor.paragraph.revision}/${anchor.paragraph.original}` : 'event' in anchor ? `${anchor.anchorId}/${timelineEventIdentity(anchor.event)}` : `${anchor.anchorId}/${anchor.sources.map(source => `${source.sourceId}/${source.paragraph.revision}/${source.paragraph.original}`).join('|')}`).join('\n'), [anchors]);
  const viewKey = JSON.stringify(view);

  useEffect(() => {
    let stopped = false;
    if (!ready) { setBindings(new Map()); return; }
    const cached = bindingCache.current?.key === publicKey ? bindingCache.current.bindings : null;
    if (!cached) setBindings(new Map());
    const pairsPromise = cached ? Promise.resolve([...cached]) : Promise.all(anchors.map(async anchor => [anchor.anchorId, await anchorBinding(anchor)] as const));
    void pairsPromise.then(pairs => {
      const currentEntry = readingNavigation.current();
      if (stopped || !readingSnapshotCurrent(currentEntry, { route, entryId, activation })) return;
      const currentBindings = new Map(pairs);
      bindingCache.current = { key: publicKey, bindings: currentBindings };
      setBindings(currentBindings);
      if (candidate && pendingId !== undefined && checked !== pendingId) {
        if (!readingSnapshotCurrent(currentEntry, { route, entryId, activation, resumeId: pendingId }, pending?.id)) return;
        const valid = !blockedNotice && (!candidate.position.anchorId || bindingMatches(candidate.binding, currentBindings.get(candidate.position.anchorId)));
        if (valid) {
          setStaleActivation(undefined);
          const current = readingNavigation.current();
          if (current?.route === route && !current.cancelled) readingNavigation.hydrateCurrent(route, {
            view: navigationView ? navigationView(candidate.view) : candidate.view,
            position: candidate.position.anchorId ? { ...candidate.position, scrollY: 0 } : undefined,
          });
          else showNotice('阅读位置已核验；你已开始操作，未自动移动页面。');
        } else {
          readingNavigation.hydrateCurrent(route, {});
          setStaleActivation(readingNavigation.current()?.activation);
          showNotice(blockedNotice || '保存位置的原文或事件已变化，已打开当前内容；旧位置暂不恢复。');
        }
        setChecked(pendingId);
        if (pending?.id === pendingId) { pending = null; emit(); }
      }
    }).catch(() => {
      const currentEntry = readingNavigation.current();
      if (!stopped && candidate && pendingId !== undefined && readingSnapshotCurrent(currentEntry, { route, entryId, activation, resumeId: pendingId }, pending?.id)) {
        readingNavigation.hydrateCurrent(route, {}); setStaleActivation(readingNavigation.current()?.activation); showNotice('保存位置暂时无法核验，已打开当前内容。'); setChecked(pendingId); pending = null; emit();
      }
    });
    return () => { stopped = true; };
  }, [route, ready, publicKey, pendingId, blockedNotice, entryId, activation]);

  useEffect(() => {
    if (!ready || !restored || !bindings.size) return;
    let timer = 0;
    let settled = false;
    const settle = window.setTimeout(() => { settled = true; save(); }, 4200);
    function save() {
      const state = latest.current, current = readingNavigation.current();
      if (!state.ready || !readingSnapshotCurrent(current, { route: state.route, entryId, activation }) || !settled) return;
      const position = captureReadingPosition();
      if (!position) return;
      const binding = position.anchorId ? state.bindings.get(position.anchorId) : undefined;
      // A missing/paused anchor is never turned into a numeric scroll fallback.
      if (position.anchorId && !binding) return;
      try {
        readingShelf.saveProgress({ route: state.progressRoute?.(position.anchorId) ?? state.route, personId: state.personId,
          position: { ...position, scrollY: 0, details: Object.fromEntries(Object.entries(position.details).filter(([, open]) => open).slice(0, 300)) }, view: state.view ?? {}, ...(binding ? { binding } : {}) });
      } catch { showNotice('阅读位置暂时无法保存，可继续阅读；已有记录保持。'); }
    }
    function schedule() { window.clearTimeout(timer); timer = window.setTimeout(save, 350); }
    function userScroll() { settled = true; schedule(); }
    function flush() { settled = true; window.clearTimeout(timer); save(); }
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('scroll', userScroll, { passive: true });
    window.addEventListener('pagehide', flush);
    window.addEventListener('ancient-history:before-navigation', flush);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('toggle', schedule, true);
    return () => { window.clearTimeout(timer); window.clearTimeout(settle); window.removeEventListener('scroll', userScroll); window.removeEventListener('pagehide', flush); window.removeEventListener('ancient-history:before-navigation', flush); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('toggle', schedule, true); };
  }, [route, ready, restored, bindings, entryId, activation]);
  useEffect(() => { if (ready && restored) { const event = new Event('scroll'); window.dispatchEvent(event); } }, [viewKey]);
  return { ready: ready && restored && (anchors.length === 0 || bindings.size > 0), notice: [noticeActivation === activation ? notice : '', storageNotice].filter(Boolean).join(' '), candidate, stale };
}
