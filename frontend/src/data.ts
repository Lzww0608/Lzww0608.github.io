import { libraryBooks } from './library.ts';
import { catalogPeople, personDisplayPeriod, personMatchesGroup, personTopicKeywords } from './person-catalog.ts';
import type { Dynasty, FiveDynasty, TenKingdomDynasty, HistoricalPlace, HistoryEvent, HistoryPerson, SearchFilter, SearchItem } from './types';

// The person index includes the authorized Ten Kingdoms expansion; other eras remain hidden.
export const fiveDynasties: readonly FiveDynasty[] = ['后梁', '后唐', '后晋', '后汉', '后周'];
export const tenKingdomDynasties: readonly TenKingdomDynasty[] = ['吴', '南唐', '吴越', '前蜀', '后蜀', '南汉', '楚', '闽', '南平', '北汉'];
export const displayedDynasties: readonly Dynasty[] = [...fiveDynasties, ...tenKingdomDynasties];

const allEvents: [HistoryEvent, ...HistoryEvent[]] = [
  { id: 'liang', year: 907, end: 923, dynasty: '后梁', title: '后梁建立', person: '朱温', description: '朱温建立后梁，唐朝结束。五代时期由此展开。', context: '从唐末的地方军事势力到新王朝的建立，后梁为理解五代政治的开端提供了入口。', color: '#9b493d' },
  { id: 'tang', year: 923, end: 936, dynasty: '后唐', title: '后唐建立', person: '李存勖', description: '李存勖建立后唐，随后灭后梁。中原政权进入后唐时期。', context: '阅读后唐史，可以追索河东势力与中原政权的关系，以及洛阳在这一时期的地位。', color: '#767c61' },
  { id: 'jin', year: 936, end: 947, dynasty: '后晋', title: '后晋建立', person: '石敬瑭', description: '石敬瑭建立后晋，后唐结束。', context: '后晋的建立与北方政治关系密切，相关史料可与前后两个王朝的记述对读。', color: '#a88a62' },
  { id: 'han', year: 947, end: 951, dynasty: '后汉', title: '后汉建立', person: '刘知远', description: '刘知远建立后汉，成为五代中的第四个中原王朝。', context: '后汉国祚较短。沿人物与事件阅读，可以观察政权交接和地方军事力量之间的关系。', color: '#6d7c7b' },
  { id: 'zhou', year: 951, end: 960, dynasty: '后周', title: '后周建立', person: '郭威', description: '郭威建立后周。后周是五代中的最后一个中原王朝。', context: '郭威与柴荣的相关记述，是理解后周政治与社会的重要线索，可与前朝史料对读。', color: '#876956' },
  { id: 'song', year: 960, end: 960, dynasty: '宋', title: '宋朝建立', person: '赵匡胤', description: '赵匡胤建立宋朝，五代时期结束。', context: '960 年是五代与宋初的分界。十国的历史延续与统一过程，需要在后续专题中继续展开。', color: '#9b493d' },
];

const allPeople: HistoryPerson[] = [
  ...catalogPeople,
  { id: 'zhao-kuangyin', name: '赵匡胤', dynasty: '宋', role: '宋朝建立者', event: 'song', aliases: '宋太祖', intro: '赵匡胤是宋朝的建立者。当前收录其与五代结束相关的线索，宋代内容将逐步整理。' },
];

function inDisplayedScope<T extends { dynasty: Dynasty }>(entries: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = entries.filter(entry => displayedDynasties.includes(entry.dynasty));
  if (!first) throw new Error('当前展示范围需要至少一个历史条目');
  return [first, ...rest];
}

// Every view and the search index consume the same scoped data.
export const events = inDisplayedScope(allEvents);
export const people = inDisplayedScope(allPeople);

export const books = libraryBooks;

export const places: [HistoricalPlace, ...HistoricalPlace[]] = [
  { name: '洛阳', coords: [34.62, 112.45], detail: '五代时期的重要政治中心，与后唐等王朝的历史密切相关。' },
  { name: '开封', coords: [34.8, 114.31], detail: '史料中的汴州、大梁与这一地区相关，是理解中原政权更迭的重要地点。' },
  { name: '太原', coords: [37.87, 112.55], detail: '河东地区的核心城市，可作为追索李存勖、刘知远等人物活动的地理入口。' },
];

export const searchItems: SearchItem[] = [
  ...people.map((item): SearchItem => ({ ...item, type: 'person', category: '人物', summary: `${personDisplayPeriod(item)} · ${item.role}${item.reign ? ` · 在位 ${item.reign}` : ''}`, keywords: `${item.dynasty} ${item.dynasty === '南平' ? '荆南' : ''} ${item.aliases} ${personTopicKeywords(item)} ${personMatchesGroup(item, 'ten-kingdoms-rulers') ? '十国君主' : ''}` })),
];

export function filterSearch(query: string, type: SearchFilter = 'all'): SearchItem[] {
  const needle = query.trim().toLowerCase();
  return searchItems.filter(item => (type === 'all' || item.type === type) && (!needle || `${item.name} ${item.summary} ${item.keywords}`.toLowerCase().includes(needle)));
}
