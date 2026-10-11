import { useEffect, useLayoutEffect, useState } from 'react';
import { chooseReadingAnchor, readingNavigation, readingPositionDecision, readReadingView, rememberReadingView } from './reading-navigation-state.ts';
import type { Dispatch, SetStateAction } from 'react';
import type { Route } from './types.ts';

function readingRoot() {
  return document.querySelector<HTMLElement>('#main-content > .person-timeline, #main-content > .event-comparison, #main-content > .reader, #main-content > .person-passages');
}

function detailKey(detail: HTMLDetailsElement, root: HTMLElement): string {
  if (detail.dataset.readingDetailsId) return detail.dataset.readingDetailsId;
  const owner = detail.closest<HTMLElement>('[data-reading-anchor], [id^="timeline-event-"], [id^="comparison-paragraph-"], .original-text > div[id]') ?? root;
  return `${owner.dataset.readingAnchor || owner.id || 'root'}/details/${[...owner.querySelectorAll('details')].indexOf(detail)}`;
}

export function captureReadingPosition() {
  const root = readingRoot();
  if (!root) return;
  const anchors = [...root.querySelectorAll<HTMLElement>('[data-reading-anchor], [id^="timeline-event-"], [id^="comparison-paragraph-"], div[id^="person-passage-"], .original-text > div[id]')]
    .filter(element => element.getClientRects().length && element.id)
    .map(element => { const box = element.getBoundingClientRect(); return { id: element.id, top: box.top, bottom: box.bottom }; });
  const anchor = chooseReadingAnchor(anchors);
  const details: Record<string, boolean> = {};
  for (const detail of root.querySelectorAll('details')) details[detailKey(detail, root)] = detail.open;
  const position = { scrollY: Math.max(0, window.scrollY), ...(anchor ? { anchorId: anchor.id, offset: anchor.top } : {}), details };
  readingNavigation.savePosition(position);
  return position;
}

// Change an entire view atomically when visiting an existing history entry. A
// conditional render-time reset avoids committing old controls into the new
// entry and does not remount/refetch an already loaded comparison page.
export function useReadingView<T extends object>(route: Route, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const entry = readingNavigation.current();
  const entryId = entry?.id ?? route;
  const entryKey = `${entryId}/${entry?.activation ?? 0}`;
  const [state, setState] = useState(() => ({ entryId, entryKey, value: readReadingView(route, fallback) }));
  let value = state.value;
  if (state.entryKey !== entryKey) {
    value = readReadingView(route, fallback);
    setState({ entryId, entryKey, value });
  }
  useEffect(() => { rememberReadingView(route, state.value, state.entryId); }, [route, state]);
  const setValue: Dispatch<SetStateAction<T>> = next => setState(current => ({ entryId, entryKey,
    value: typeof next === 'function' ? (next as (value: T) => T)(current.value) : next }));
  return [value, setValue];
}

export function useReadingPosition({ route, ready, targetId, focusSelector, layoutKey: _layoutKey }: {
  route: Route;
  ready: boolean;
  targetId?: string;
  focusSelector?: string;
  layoutKey?: string;
}) {
  const entry = readingNavigation.current();
  const entryId = entry?.id;
  const activation = entry?.activation;
  // Cancel even while data are pending, so a reader who starts scrolling during
  // a slow request cannot be pulled away by its late response.
  useEffect(() => {
    const cancel = () => { if (readingNavigation.current()?.id === entryId) readingNavigation.cancel(); };
    const key = (event: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel(); };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('pointerdown', cancel, { passive: true });
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('wheel', cancel); window.removeEventListener('touchstart', cancel); window.removeEventListener('pointerdown', cancel); window.removeEventListener('keydown', key); };
  }, [entryId, activation]);

  useLayoutEffect(() => {
    const current = readingNavigation.current();
    const root = readingRoot();
    if (!ready || !root || !current || current.route !== route || current.positioningStarted) return;
    current.positioningStarted = true;
    const decision = readingPositionDecision(current, targetId);
    if (decision.kind === 'cancel') return;
    if (decision.kind === 'restore') for (const detail of root.querySelectorAll('details')) {
      const key = detailKey(detail, root);
      if (Object.hasOwn(decision.position.details, key)) detail.open = decision.position.details[key]!;
    }
    let stopped = false, frame = 0, focused = false;
    function position() {
      if (stopped || current!.cancelled || readingNavigation.current()?.activation !== activation) return;
      if (decision.kind === 'restore') {
        const anchor = decision.position.anchorId ? document.getElementById(decision.position.anchorId) : null;
        const top = anchor && root!.contains(anchor) && decision.position.offset !== undefined
          ? window.scrollY + anchor.getBoundingClientRect().top - decision.position.offset : current!.persistentRestore ? 0 : decision.position.scrollY;
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      } else if (decision.kind === 'target') {
        const anchor = document.getElementById(decision.anchorId);
        if (anchor && root!.contains(anchor)) {
          anchor.scrollIntoView({ block: 'start', behavior: 'instant' });
          if (!focused && focusSelector) { anchor.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true }); focused = true; }
        }
      } else window.scrollTo({ top: 0, behavior: 'instant' });
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); }
    position(); schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { subtree: true, childList: true });
    void document.fonts?.ready.then(schedule);
    // Layout correction is confined to this activation. It cannot restart after
    // a version, font, or control update, and user input cancels it immediately.
    const timeout = window.setTimeout(() => { stopped = true; resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); }, 4000);
    return () => { stopped = true; window.clearTimeout(timeout); resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame);
      if (readingNavigation.current()?.activation === activation) current.positioningStarted = false;
    };
  }, [route, ready, targetId, focusSelector, entryId, activation]);

  return { restoring: entry?.intent === 'restore' && !!entry.position, cancelled: () => readingNavigation.current()?.cancelled ?? false };
}
