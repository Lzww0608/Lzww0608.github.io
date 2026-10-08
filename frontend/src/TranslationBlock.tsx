import { useId, useState } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { PublishedTranslation } from './types';
import { reviewNoteForDisplay } from './translation-display';

export function TranslationBlock({ translation, onEdit }: { translation: PublishedTranslation; onEdit?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const ToggleIcon = collapsed ? CaretDown : CaretUp;
  const showCredit = translation.origin !== 'ai' && !/\b(?:Codex|ChatGPT|OpenAI)\b/iu.test(translation.translator);
  return <div className="paragraph-translation" lang={translation.language}>
    <div className="translation-heading">
      <span>白话译文</span><small>第 {translation.version} 版</small>
      <div className="translation-heading-actions">
        {onEdit && <button type="button" className="translation-edit-button" onClick={onEdit}>修订这段</button>}
        <button type="button" className="translation-toggle-button" aria-label={`${collapsed ? '展开' : '收起'}白话译文`} aria-expanded={!collapsed} aria-controls={contentId} onClick={() => setCollapsed(value => !value)}>
          <ToggleIcon size={14} aria-hidden="true" />{collapsed ? '展开' : '收起'}
        </button>
      </div>
    </div>
    <div id={contentId} className="translation-content" hidden={collapsed}>
      <p>{translation.text}</p>{showCredit && <span className="translation-credit">{translation.translator}</span>}
      {!!translation.reviewNotes?.length && <details className="translation-review-notes"><summary>校核提示 · {translation.reviewNotes.length}</summary><ul>{translation.reviewNotes.map((note, index) => <li key={index}>{reviewNoteForDisplay(note)}</li>)}</ul></details>}
    </div>
  </div>;
}
