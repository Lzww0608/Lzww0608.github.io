import type { PublishedTranslation } from './types';

export function TranslationBlock({ translation, onEdit }: { translation: PublishedTranslation; onEdit?: () => void }) {
  const credit = translation.translator.replace(/（AI 初译，待人工修订）/gu, '').trim();
  return <div className="paragraph-translation" lang={translation.language}>
    <div className="translation-heading"><span>白话译文</span><small>第 {translation.version} 版</small>{onEdit && <button className="translation-edit-button" onClick={onEdit}>修订这段</button>}</div>
    <p>{translation.text}</p><span className="translation-credit">{credit}</span>
    {!!translation.reviewNotes?.length && <details className="translation-review-notes"><summary>校核提示 · {translation.reviewNotes.length}</summary><ul>{translation.reviewNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
  </div>;
}
