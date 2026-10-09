import { useId, useState } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { PublishedTranslation, TextRange } from './types';
import { reviewNoteForDisplay } from './translation-display';
import { HighlightedText } from './HighlightedText';

export function TranslationBlock({ translation, onEdit, expanded, onExpandedChange, searchRanges = [] }: {
  translation: PublishedTranslation;
  onEdit?: () => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  searchRanges?: readonly TextRange[];
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const collapsed = !(expanded ?? localExpanded);
  const toggle = () => {
    const nextExpanded = collapsed;
    if (expanded === undefined) setLocalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };
  const contentId = useId();
  const ToggleIcon = collapsed ? CaretDown : CaretUp;
  const showCredit = translation.origin !== 'ai' && !/\b(?:Codex|ChatGPT|OpenAI)\b/iu.test(translation.translator);
  return <div className="paragraph-translation" lang={translation.language}>
    <div className="translation-heading">
      <span>白话译文</span><small>第 {translation.version} 版</small>
      <div className="translation-heading-actions">
        {onEdit && <button type="button" className="translation-edit-button" onClick={onEdit}>修订这段</button>}
        <button type="button" className="translation-toggle-button" aria-label={`${collapsed ? '展开' : '收起'}白话译文`} aria-expanded={!collapsed} aria-controls={contentId} onClick={toggle}>
          <ToggleIcon size={14} aria-hidden="true" />{collapsed ? '展开' : '收起'}
        </button>
      </div>
    </div>
    <div id={contentId} className="translation-content" hidden={collapsed}>
      <p><HighlightedText text={translation.text} ranges={searchRanges} /></p>{showCredit && <span className="translation-credit">{translation.translator}</span>}
      {!!translation.reviewNotes?.length && <details className="translation-review-notes"><summary>校核提示 · {translation.reviewNotes.length}</summary><ul>{translation.reviewNotes.map((note, index) => <li key={index}>{reviewNoteForDisplay(note)}</li>)}</ul></details>}
    </div>
  </div>;
}
