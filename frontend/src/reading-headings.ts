import index from './reading-headings.json' with { type: 'json' };
import type { ChapterParagraph } from './types.ts';

type OriginalTextTag = 'p' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
const headings: Readonly<Record<string, { level: number; revision: number; original: string }>> = index;
const tags: Readonly<Record<number, OriginalTextTag>> = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' };

// Classify the canonical paragraph before converting its display text.
// A revised API paragraph must not inherit formatting from a different original.
export function originalTextTag(paragraph: ChapterParagraph): OriginalTextTag {
  const heading = headings[paragraph.id];
  if (!heading || heading.revision !== paragraph.revision || heading.original !== paragraph.original) return 'p';
  return tags[heading.level] ?? 'p';
}
