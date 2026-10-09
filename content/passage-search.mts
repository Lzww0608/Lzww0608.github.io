export type SearchField = 'both' | 'original' | 'translation';
export interface TextRange { start: number; end: number }
export interface ParagraphSearchMatch { paragraphId: string; original: TextRange[]; translation: TextRange[] }
export interface SearchableParagraph { id: string; original: string; translation: { text: string } | null }
export interface SearchablePassage { paragraphs: SearchableParagraph[] }
export const searchFields: readonly SearchField[] = ['both', 'original', 'translation'];
export function validateSearchQuery(value: string): string {
  const query = value.trim();
  if ([...query].length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid passage search query');
  return query;
}

type Dictionary = string | readonly (readonly [string, string])[];
type DictionaryGroup = readonly Dictionary[];
interface SearchPreset { from: Record<string, readonly DictionaryGroup[]>; to: Record<string, readonly DictionaryGroup[]>; configs?: Record<string, { segmentation: Dictionary | DictionaryGroup; conversionChain: readonly DictionaryGroup[] }> }
type ConverterBuilder = (preset: SearchPreset) => (options: { from: string; to: string }) => (text: string) => string;
export function createSearchConverter(builder: ConverterBuilder, locale: Pick<SearchPreset, 'configs'>): (text: string) => string {
  const standard = locale.configs?.t2s;
  if (!standard) throw new Error('Missing search conversion dictionary');
  const convert = builder({ from: {}, to: { cn: standard.conversionChain }, configs: { t2s: standard } })({ from: 't', to: 'cn' });
  // Search equivalence is separate from the reader's preserved historical-name display.
  return text => convert(text.replaceAll('衞', '衛'));
}

// Only needed for converters that change code-point counts. LCS maps replacement
// blocks to their source extent; it never divides surrogate pairs or rewrites text.
function lcsRow(a: string[], b: string[]): Uint32Array {
  let previous = new Uint32Array(b.length + 1);
  for (const char of a) {
    const row = new Uint32Array(b.length + 1);
    for (let j = 0; j < b.length; j++) row[j + 1] = char === b[j] ? previous[j]! + 1 : Math.max(previous[j + 1]!, row[j]!);
    previous = row;
  }
  return previous;
}
function lcsPairs(a: string[], b: string[], aOffset = 0, bOffset = 0): [number, number][] {
  if (!a.length || !b.length) return [];
  if (a.length === 1) { const at = b.indexOf(a[0]!); return at < 0 ? [] : [[aOffset, bOffset + at]]; }
  const middle = Math.floor(a.length / 2), left = lcsRow(a.slice(0, middle), b), right = lcsRow(a.slice(middle).reverse(), b.slice().reverse());
  let split = 0, score = -1;
  for (let j = 0; j <= b.length; j++) { const next = left[j]! + right[b.length - j]!; if (next > score) { score = next; split = j; } }
  return [...lcsPairs(a.slice(0, middle), b.slice(0, split), aOffset, bOffset), ...lcsPairs(a.slice(middle), b.slice(split), aOffset + middle, bOffset + split)];
}
function conversionRanges(source: string[], converted: string[], convert: (text: string) => string): TextRange[] {
  if (source.length === converted.length) return source.map((_, i) => ({ start: i, end: i + 1 }));
  const base: string[] = [], ranges: TextRange[] = [];
  source.forEach((char, i) => { for (const piece of convert(char)) { base.push(piece); ranges.push({ start: i, end: i + 1 }); } });
  let prefix = 0, suffix = 0;
  while (prefix < base.length && prefix < converted.length && base[prefix] === converted[prefix]) prefix++;
  while (suffix < base.length - prefix && suffix < converted.length - prefix && base[base.length - suffix - 1] === converted[converted.length - suffix - 1]) suffix++;
  const pairs: [number, number][] = [
    ...Array.from({ length: prefix }, (_, i): [number, number] => [i, i]),
    ...lcsPairs(base.slice(prefix, base.length - suffix), converted.slice(prefix, converted.length - suffix), prefix, prefix),
    ...Array.from({ length: suffix }, (_, i): [number, number] => [base.length - suffix + i, converted.length - suffix + i]),
  ];
  const result: TextRange[] = Array(converted.length);
  let aStart = 0, bStart = 0;
  for (const [a, b] of [...pairs, [base.length, converted.length] as [number, number]]) {
    let range = { start: ranges[aStart]?.start ?? source.length, end: ranges[a - 1]?.end ?? ranges[aStart]?.start ?? source.length };
    if (range.end <= range.start) range = { start: ranges[aStart - 1]?.start ?? ranges[aStart]?.start ?? 0, end: ranges[aStart]?.end ?? ranges[aStart - 1]?.end ?? source.length };
    for (let i = bStart; i < b; i++) result[i] = range;
    if (b < converted.length) result[b] = ranges[a]!;
    aStart = a + 1; bStart = b + 1;
  }
  return result;
}

export function createTextSearch(convert: (text: string) => string) {
  const normalize = (text: string): string => [...convert(text)].map(char => char.normalize('NFKC').toLowerCase()).join('');
  const cache = new Map<string, { chars: string[]; ranges: TextRange[] }>();
  function findRanges(text: string, query: string): TextRange[] {
    query=validateSearchQuery(query);
    const needle=[...normalize(query)], literalNeedle=[...query].flatMap(char=>[...char.normalize('NFKC').toLowerCase()]);
    if (!needle.length) return [];
    const source=[...text], literalChars=source.flatMap(char=>[...char.normalize('NFKC').toLowerCase()]);
    const normalizedMatch=normalize(text).includes(needle.join(''));
    const literalMatch=literalChars.join('').includes(literalNeedle.join(''));
    if (!normalizedMatch && !literalMatch) return [];
    const candidates: TextRange[]=[];
    const collect=(chars:string[],ranges:TextRange[],term:string[])=>{
      for(let at=0;at+term.length<=chars.length;at++){
        if(!term.every((char,i)=>char===chars[at+i]))continue;
        const region=ranges.slice(at,at+term.length);
        candidates.push({start:Math.min(...region.map(r=>r.start)),end:Math.max(...region.map(r=>r.end))});
      }
    };
    if(normalizedMatch){
      let indexed=cache.get(text);
      if(!indexed){
        const converted=[...convert(text)],mapped=conversionRanges(source,converted,convert),chars:string[]=[],ranges:TextRange[]=[];
        converted.forEach((char,i)=>{for(const folded of char.normalize('NFKC').toLowerCase()){chars.push(folded);ranges.push(mapped[i]!);}});
        indexed={chars,ranges};cache.set(text,indexed);
        if(cache.size>128)cache.delete(cache.keys().next().value!);
      }
      collect(indexed.chars,indexed.ranges,needle);
    }
    // Exact written characters remain searchable even where contextual OpenCC
    // chooses another spelling (e.g. the single 乾 inside 乾坤).
    if(literalMatch){
      const ranges=source.flatMap((char,i)=>[...char.normalize('NFKC').toLowerCase()].map(()=>({start:i,end:i+1})));
      collect(literalChars,ranges,literalNeedle);
    }
    const matches:TextRange[]=[];
    for(const next of candidates.sort((a,b)=>a.start-b.start||a.end-b.end)){
      const previous=matches.at(-1);
      if(previous&&next.start<=previous.end)previous.end=Math.max(previous.end,next.end);else matches.push(next);
    }
    return matches;
  }
  function matchParagraph(paragraph: SearchableParagraph, query: string, field: SearchField): ParagraphSearchMatch | null {
    if (!searchFields.includes(field)) throw new TypeError('Invalid passage search field');
    const original = field === 'translation' ? [] : findRanges(paragraph.original, query);
    const translation = field === 'original' || !paragraph.translation ? [] : findRanges(paragraph.translation.text, query);
    return original.length || translation.length ? { paragraphId: paragraph.id, original, translation } : null;
  }
  function filterPassages<T extends SearchablePassage>(items: T[], query: string, field: SearchField): (T & { searchMatches: ParagraphSearchMatch[] })[] {
    return items.flatMap(item => { const searchMatches = item.paragraphs.map(p => matchParagraph(p, query, field)).filter((match): match is ParagraphSearchMatch => !!match); return searchMatches.length ? [{ ...item, searchMatches }] : []; });
  }
  return { normalize, findRanges, matchParagraph, filterPassages };
}
export type TextSearch = ReturnType<typeof createTextSearch>;

// Script conversion preserves the source identity. Project only through the
// actual display converter; these offsets are never reused for translation text.
export function projectTextRanges(sourceText: string, displayedText: string, sourceRanges: readonly TextRange[], convert: (text: string) => string): TextRange[] {
  const source=[...sourceText],displayed=[...displayedText];
  if(sourceRanges.some(r=>!Number.isSafeInteger(r.start)||!Number.isSafeInteger(r.end)||r.start<0||r.end<=r.start||r.end>source.length))return [];
  if(sourceText!==displayedText&&convert(sourceText)!==displayedText)return [];
  const map=conversionRanges(source,displayed,convert),matches:TextRange[]=[];
  for(let at=0;at<map.length;at++){
    if(!sourceRanges.some(range=>range.start<map[at]!.end&&range.end>map[at]!.start))continue;
    const previous=matches.at(-1);if(previous?.end===at)previous.end=at+1;else matches.push({start:at,end:at+1});
  }
  return matches;
}
