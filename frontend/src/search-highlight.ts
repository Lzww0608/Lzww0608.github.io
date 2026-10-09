import type { TextRange } from './types.ts';
import { projectTextRanges } from '../../content/passage-search.mts';
import type { TextSearch } from '../../content/passage-search.mts';

export interface HighlightSegment { text: string; matched: boolean; start: number }

export function searchHighlightRanges(engine: Pick<TextSearch, 'findRanges'>, displayedText: string, query: string, canonicalText = displayedText, converter?: (text: string) => string): TextRange[] {
  const displayedMatches = engine.findRanges(displayedText, query);
  if (canonicalText === displayedText) return displayedMatches;
  const canonicalMatches = engine.findRanges(canonicalText, query);
  if (!canonicalMatches.length || !converter) return displayedMatches;
  const projectedMatches = projectTextRanges(canonicalText, displayedText, canonicalMatches, converter);
  const merged: TextRange[] = [];
  for (const range of [...displayedMatches, ...projectedMatches].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

// Match positions use Unicode code points; display text is never normalized or rewritten.
export function highlightSegments(text: string, ranges: readonly TextRange[], offset = 0): HighlightSegment[] {
  const characters = [...text];
  const end = offset + characters.length;
  const boundaries = ranges.filter(range => range.start < end && range.end > offset)
    .map(range => ({ start: Math.max(0, range.start - offset), end: Math.min(characters.length, range.end - offset) }))
    .sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];
  for (const range of boundaries) {
    const previous = merged.at(-1);
    if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else if (range.end > range.start) merged.push({ ...range });
  }
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: characters.slice(cursor, range.start).join(''), matched: false, start: cursor + offset });
    segments.push({ text: characters.slice(range.start, range.end).join(''), matched: true, start: range.start + offset });
    cursor = range.end;
  }
  if (cursor < characters.length) segments.push({ text: characters.slice(cursor).join(''), matched: false, start: cursor + offset });
  return segments;
}
