import { lazy, Suspense, useEffect, useState } from 'react';
import { originalTextTag } from './reading-headings';
import { TranslationBlock } from './TranslationBlock';
import { HighlightedText, useSearchRanges } from './HighlightedText';
import type { ChapterParagraph, SearchField } from './types';

const SentenceTranslationText = lazy(() => import('./SentenceTranslationText').then(module => ({ default: module.SentenceTranslationText })));

// The canonical paragraph determines formatting; only its displayed text changes.
export function OriginalParagraph({ paragraph, displayedOriginal, onEdit, anchorId = paragraph.id, searchQuery = '', searchField = 'both', translationMatch = false }: {
  paragraph: ChapterParagraph;
  displayedOriginal: string;
  onEdit?: () => void;
  anchorId?: string;
  searchQuery?: string;
  searchField?: SearchField;
  translationMatch?: boolean;
}) {
  const [translationExpanded, setTranslationExpanded] = useState(false);
  const originalHits = useSearchRanges(displayedOriginal, searchField === 'translation' ? '' : searchQuery, paragraph.original);
  const translationHits = useSearchRanges(paragraph.translation?.text ?? '', searchField === 'original' ? '' : searchQuery);
  const expandForSearch = !!searchQuery && (translationMatch || translationHits.length > 0);
  useEffect(() => { setTranslationExpanded(expandForSearch); }, [searchQuery, searchField, expandForSearch]);
  const TextTag = originalTextTag(paragraph);
  return <div id={anchorId}>
    <TextTag className={TextTag === 'p' ? undefined : 'original-heading'}>
      <span className="paragraph-number">{paragraph.position}</span><Suspense fallback={<HighlightedText text={displayedOriginal} ranges={originalHits} />}><SentenceTranslationText paragraph={paragraph} displayedOriginal={displayedOriginal} searchRanges={originalHits} onExpandTranslation={() => setTranslationExpanded(true)} /></Suspense>
    </TextTag>
    {paragraph.translation && <TranslationBlock translation={paragraph.translation} onEdit={onEdit}
      expanded={translationExpanded} onExpandedChange={setTranslationExpanded} searchRanges={translationHits} />}
  </div>;
}
