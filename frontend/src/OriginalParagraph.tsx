import { originalTextTag } from './reading-headings';
import { TranslationBlock } from './TranslationBlock';
import type { ChapterParagraph } from './types';

// The canonical paragraph determines formatting; only its displayed text changes.
export function OriginalParagraph({ paragraph, displayedOriginal, onEdit, anchorId = paragraph.id }: {
  paragraph: ChapterParagraph;
  displayedOriginal: string;
  onEdit?: () => void;
  anchorId?: string;
}) {
  const TextTag = originalTextTag(paragraph);
  return <div id={anchorId}>
    <TextTag className={TextTag === 'p' ? undefined : 'original-heading'}>
      <span className="paragraph-number">{paragraph.position}</span>{displayedOriginal}
    </TextTag>
    {paragraph.translation && <TranslationBlock translation={paragraph.translation} onEdit={onEdit} />}
  </div>;
}
