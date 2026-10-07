import type { PublishedTranslation } from './types';
import { reviewNoteForDisplay } from './translation-display';

export function TranslationBlock({ translation, onEdit }: { translation: PublishedTranslation; onEdit?: () => void }) {
  const showCredit = translation.origin !== 'ai' && !/\b(?:Codex|ChatGPT|OpenAI)\b/iu.test(translation.translator);
  return <div className="paragraph-translation" lang={translation.language}>
    <div className="translation-heading"><span>白话译文</span><small>第 {translation.version} 版</small>{onEdit && <button className="translation-edit-button" onClick={onEdit}>修订这段</button>}</div>
    <p>{translation.text}</p>{showCredit && <span className="translation-credit">{translation.translator}</span>}
    {!!translation.reviewNotes?.length && <details className="translation-review-notes"><summary>校核提示 · {translation.reviewNotes.length}</summary><ul>{translation.reviewNotes.map((note, index) => <li key={index}>{reviewNoteForDisplay(note)}</li>)}</ul></details>}
  </div>;
}
