import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';
import type { ChapterParagraph, TextRange } from './types';
import { HighlightedText } from './HighlightedText';
import { useSentenceTranslations } from './use-sentence-translations';
import { reviewNoteForDisplay } from './translation-display';
import './sentence-translation.css';

type SentencePart = ReturnType<typeof useSentenceTranslations>['parts'][number];
type ClickablePart = SentencePart & { kind: 'sentence' | 'unaligned' };
interface OpenTranslation {
  partId: string;
  sourceKey: symbol;
  x: number;
  y: number;
  keyboard: boolean;
}

// Paragraphs share one reading popup, including across the two reading views.
let closeActivePopup: (() => void) | null = null;

function translationLabel(kind: ClickablePart['kind']): string {
  return kind === 'sentence' ? '对应句译文' : '这句的译文';
}

function clickablePart(part: SentencePart | undefined): part is ClickablePart {
  return !!part && (part.kind === 'unaligned'
    || part.kind === 'sentence' && typeof part.translation === 'string' && !!part.translation.trim());
}

function boundedPosition(anchor: OpenTranslation, width: number, height: number): { left: number; top: number } {
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const preferredLeft = anchor.x + margin;
  const preferredTop = anchor.y + margin;
  return {
    left: Math.max(margin, Math.min(preferredLeft, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(
      preferredTop + height <= viewportHeight - margin ? preferredTop : anchor.y - height - margin,
      viewportHeight - height - margin,
    )),
  };
}

export function SentenceTranslationText({ paragraph, displayedOriginal, onExpandTranslation, searchRanges = [] }: {
  paragraph: ChapterParagraph;
  displayedOriginal: string;
  onExpandTranslation?: () => void;
  searchRanges?: readonly TextRange[];
}) {
  const { parts, pending } = useSentenceTranslations(paragraph, displayedOriginal);
  const popupId = useId();
  const headingId = `${popupId}-heading`;
  const popupRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const [open, setOpen] = useState<OpenTranslation | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  // A changed source, script or published translation cannot keep an old popup.
  const sourceKey = useMemo(() => Symbol('sentence-translation-source'), [
    paragraph.id, paragraph.revision, paragraph.original, paragraph.translation?.id, paragraph.translation?.version,
    paragraph.translation?.text, displayedOriginal, pending, parts,
  ]);
  const activePart = open?.sourceKey === sourceKey ? parts.find(part => part.id === open.partId) : undefined;
  const visible = !!open && clickablePart(activePart);
  const close = useCallback(() => {
    setOpen(null);
    if (closeActivePopup === close) closeActivePopup = null;
  }, []);

  useEffect(() => {
    close();
    return () => {
      if (closeActivePopup === close) closeActivePopup = null;
    };
  }, [sourceKey, close]);

  const closeAndRestoreFocus = () => {
    const shouldRestore = open?.keyboard && triggerRef.current?.isConnected;
    close();
    if (shouldRestore) triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!visible || !open || !popupRef.current) return;
    const bounds = popupRef.current.getBoundingClientRect();
    setPosition(boundedPosition(open, bounds.width, bounds.height));
    if (open.keyboard) closeButtonRef.current?.focus({ preventScroll: true });
  }, [visible, open]);

  useEffect(() => {
    if (!visible) return;
    const outsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      const trigger = triggerRef.current;
      close();
      if (open?.keyboard && trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
    const scroll = (event: Event) => {
      // Long translations scroll inside the popup without dismissing it.
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', outsideClick, true);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('pointerdown', outsideClick, true);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('hashchange', close);
    };
  }, [visible, close, open?.keyboard]);

  const show = (part: ClickablePart, target: HTMLSpanElement, point?: { x: number; y: number }) => {
    if (visible && activePart?.id === part.id) {
      close();
      return;
    }
    closeActivePopup?.();
    closeActivePopup = close;
    triggerRef.current = target;
    const rects = Array.from(target.getClientRects());
    const bounds = rects.find(rect => rect.bottom >= 0 && rect.top < window.innerHeight) ?? target.getBoundingClientRect();
    const anchor = point ?? { x: bounds.left, y: bounds.bottom };
    setPosition(boundedPosition({ ...anchor, partId: part.id, sourceKey, keyboard: !point }, 360, 180));
    setOpen({ partId: part.id, sourceKey, ...anchor, keyboard: !point });
  };

  let displayOffset = 0;
  return <>
    {parts.map(part => {
      const offset = displayOffset;
      displayOffset += [...part.original].length;
      const text = <HighlightedText text={part.original} ranges={searchRanges} offset={offset} />;
      if (!clickablePart(part)) return <Fragment key={part.id}>{text}</Fragment>;
      const selected = visible && activePart?.id === part.id;
      const label = translationLabel(part.kind);
      return <span key={part.id} className="sentence-translation-trigger" role="button" tabIndex={0}
        aria-label={`查看${label}：${part.original}`} aria-haspopup="dialog" aria-expanded={selected}
        aria-controls={selected ? popupId : undefined} data-selected={selected || undefined}
        title={`点击查看${label}`} onPointerDown={event => {
          pointerStart.current = { x: event.clientX, y: event.clientY, dragged: false };
        }} onPointerMove={event => {
          const start = pointerStart.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) start.dragged = true;
        }} onPointerCancel={() => { pointerStart.current = null; }} onClick={event => {
          const drag = pointerStart.current;
          pointerStart.current = null;
          if (drag?.dragged || window.getSelection()?.isCollapsed === false) return;
          show(part, event.currentTarget, event.detail ? { x: event.clientX, y: event.clientY } : undefined);
        }} onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          show(part, event.currentTarget);
        }}>{text}</span>;
    })}
    {visible && clickablePart(activePart) && typeof document !== 'undefined' && createPortal(
      <div id={popupId} ref={popupRef} className="sentence-translation-popover" role="dialog"
        aria-labelledby={headingId} lang={paragraph.translation?.language ?? 'zh-Hans'}
        style={{ left: position.left, top: position.top }}>
        <div className="sentence-translation-popover-heading">
          <span id={headingId}>{translationLabel(activePart.kind)}</span>
          <button ref={closeButtonRef} type="button" className="sentence-translation-close" aria-label="关闭译文"
            onClick={closeAndRestoreFocus}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="sentence-translation-popover-body">
          {activePart.kind === 'sentence' ? <>
            <p>{activePart.translation}</p>
            {!!activePart.reviewNotes?.length && <div className="sentence-translation-review-notes">
              <span>校核提示</span><ul>{activePart.reviewNotes.map((note, index) => <li key={index}>{reviewNoteForDisplay(note)}</li>)}</ul>
            </div>}
          </> : <>
            <p className="sentence-translation-notice">{pending
              ? '正在查找这句的译文…'
              : '这句尚未完成独立对应，请展开下方白话译文查看。'}</p>
            {onExpandTranslation && <button type="button" className="sentence-translation-expand" onClick={() => {
              closeAndRestoreFocus();
              onExpandTranslation();
            }}>查看整段译文</button>}
          </>}
        </div>
      </div>, document.body,
    )}
  </>;
}
