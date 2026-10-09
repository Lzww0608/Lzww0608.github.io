import type { TextSearch } from '../../content/passage-search.mts';
export type { TextSearch, TextRange, SearchField, ParagraphSearchMatch } from '../../content/passage-search.mts';
let pending: Promise<TextSearch> | null = null;
export function loadPassageSearch(): Promise<TextSearch> {
  pending ??= Promise.all([import('opencc-js/core'), import('opencc-js/preset/t2cn'), import('../../content/passage-search.mts')])
    .then(([core, locale, shared]) => shared.createTextSearch(shared.createSearchConverter(core.ConverterBuilder, locale)))
    .catch(error => { pending = null; throw error; });
  return pending;
}
