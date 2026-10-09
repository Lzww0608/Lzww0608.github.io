import type { ChapterParagraph, OriginalScript, SearchField } from './types.ts';

// A static paragraph and a newer API revision are different positioning targets.
export function readingFocusKey(chapterId: string, paragraph: ChapterParagraph, query: string, field: SearchField, script: OriginalScript): string {
  return JSON.stringify([chapterId, paragraph.id, paragraph.revision, paragraph.original, paragraph.translation?.id,
    paragraph.translation?.version, paragraph.translation?.text, query, field, script]);
}
