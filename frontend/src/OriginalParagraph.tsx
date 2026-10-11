import { lazy, Suspense, useEffect, useState } from 'react';
import { originalTextTag } from './reading-headings';
import { TranslationBlock } from './TranslationBlock';
import { HighlightedText, useSearchRanges } from './HighlightedText';
import { BookmarkButton } from './BookmarkButton';
import type { ChapterParagraph, SearchField } from './types';

const SentenceTranslationText = lazy(() => import('./SentenceTranslationText').then(module => ({ default: module.SentenceTranslationText })));

// The canonical paragraph determines formatting; only its displayed text changes.
export function OriginalParagraph({ paragraph, displayedOriginal, onEdit, anchorId = paragraph.id, searchQuery = '', searchField = 'both', translationMatch = false, translationExpanded: controlledExpanded, onTranslationExpandedChange, bookmark }: {
  paragraph: ChapterParagraph;
  displayedOriginal: string;
  onEdit?: () => void;
  anchorId?: string;
  searchQuery?: string;
  searchField?: SearchField;
  translationMatch?: boolean;
  translationExpanded?: boolean;
  onTranslationExpandedChange?: (expanded: boolean) => void;
  bookmark?: { chapterId: string; personId?: string };
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const translationExpanded = controlledExpanded ?? localExpanded;
  const setTranslationExpanded = (expanded: boolean) => {
    if (controlledExpanded === undefined) setLocalExpanded(expanded);
    onTranslationExpandedChange?.(expanded);
  };
  const originalHits = useSearchRanges(displayedOriginal, searchField === 'translation' ? '' : searchQuery, paragraph.original);
  const translationHits = useSearchRanges(paragraph.translation?.text ?? '', searchField === 'original' ? '' : searchQuery);
  const expandForSearch = !!searchQuery && (translationMatch || translationHits.length > 0);
  useEffect(() => { setLocalExpanded(expandForSearch); }, [searchQuery, searchField, expandForSearch]);
  const TextTag = originalTextTag(paragraph);
  return <div id={anchorId}>
    {bookmark && <div className="original-paragraph-actions"><BookmarkButton {...bookmark} paragraph={paragraph} /></div>}
    <TextTag className={TextTag === 'p' ? undefined : 'original-heading'}>
      <span className="paragraph-number">{paragraph.position}</span><Suspense fallback={<HighlightedText text={displayedOriginal} ranges={originalHits} />}><SentenceTranslationText paragraph={paragraph} displayedOriginal={displayedOriginal} searchRanges={originalHits} onExpandTranslation={() => setTranslationExpanded(true)} /></Suspense>
    </TextTag>
    {paragraph.translation && <TranslationBlock translation={paragraph.translation} onEdit={onEdit}
      expanded={translationExpanded} onExpandedChange={setTranslationExpanded} searchRanges={translationHits} />}
  </div>;
}
