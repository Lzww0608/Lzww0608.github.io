import { Fragment, useEffect, useMemo, useState } from 'react';
import { loadPassageSearch } from './passage-search';
import { highlightSegments, searchHighlightRanges } from './search-highlight';
import { loadOriginalConverter } from './original-script';
import type { OriginalConverter } from './original-script';
import type { TextRange } from './types';
import './search-highlight.css';

type SearchEngine = Awaited<ReturnType<typeof loadPassageSearch>>;

export function useSearchRanges(text: string, query: string, canonicalText = text): TextRange[] {
  const [engine, setEngine] = useState<SearchEngine | null>(null);
  const [converter, setConverter] = useState<OriginalConverter | null>(null);
  const hasDisplayConversion = canonicalText !== text;
  useEffect(() => {
    if (!query.trim()) return;
    let current = true;
    loadPassageSearch().then(value => { if (current) setEngine(value); }).catch(() => { /* Reading remains available when the search dictionary cannot load. */ });
    if (hasDisplayConversion) loadOriginalConverter().then(value => { if (current) setConverter(() => value); }).catch(() => { /* Keep the displayed text readable. */ });
    return () => { current = false; };
  }, [query, hasDisplayConversion]);
  return useMemo(() => query.trim() && engine ? searchHighlightRanges(engine, text, query, canonicalText, converter ?? undefined) : [], [text, query, engine, canonicalText, converter]);
}

export function HighlightedText({ text, ranges, offset = 0 }: { text: string; ranges: readonly TextRange[]; offset?: number }) {
  return <>{highlightSegments(text, ranges, offset).map(segment => segment.matched
    ? <mark className="search-hit" data-search-hit="true" key={segment.start}>{segment.text}</mark>
    : <Fragment key={segment.start}>{segment.text}</Fragment>)}</>;
}
