import { libraryBooks, libraryChapters } from './library';
import type { Era, HistoricalPlace, HistoryEvent, HistoryPerson, SearchFilter, SearchItem } from './types';

export const eras: Era[] = ['先秦', '秦汉', '魏晋南北朝', '隋唐', '五代', '宋元', '明清'];

export const events: [HistoryEvent, ...HistoryEvent[]] = [
  { id: 'liang', year: 907, end: 923, dynasty: '后梁', title: '后梁建立', person: '朱温', description: '朱温建立后梁，唐朝结束。五代时期由此展开。', context: '从唐末的地方军事势力到新王朝的建立，后梁为理解五代政治的开端提供了入口。', color: '#9b493d' },
  { id: 'tang', year: 923, end: 936, dynasty: '后唐', title: '后唐建立', person: '李存勖', description: '李存勖建立后唐，随后灭后梁。中原政权进入后唐时期。', context: '阅读后唐史，可以追索河东势力与中原政权的关系，以及洛阳在这一时期的地位。', color: '#767c61' },
  { id: 'jin', year: 936, end: 947, dynasty: '后晋', title: '后晋建立', person: '石敬瑭', description: '石敬瑭建立后晋，后唐结束。', context: '后晋的建立与北方政治关系密切，相关史料可与前后两个王朝的记述对读。', color: '#a88a62' },
  { id: 'han', year: 947, end: 951, dynasty: '后汉', title: '后汉建立', person: '刘知远', description: '刘知远建立后汉，成为五代中的第四个中原王朝。', context: '后汉国祚较短。沿人物与事件阅读，可以观察政权交接和地方军事力量之间的关系。', color: '#6d7c7b' },
  { id: 'zhou', year: 951, end: 960, dynasty: '后周', title: '后周建立', person: '郭威', description: '郭威建立后周。后周是五代中的最后一个中原王朝。', context: '后周连接五代与宋初。郭威与柴荣的相关记述，是理解这一转折的重要线索。', color: '#876956' },
  { id: 'song', year: 960, end: 960, dynasty: '宋', title: '宋朝建立', person: '赵匡胤', description: '赵匡胤建立宋朝，五代时期结束。', context: '960 年是五代与宋初的分界。十国的历史延续与统一过程，需要在后续专题中继续展开。', color: '#9b493d' },
];

export const people: [HistoryPerson, ...HistoryPerson[]] = [
  { id: 'zhu-wen', name: '朱温', dynasty: '后梁', role: '后梁建立者', event: 'liang', aliases: '朱全忠 朱晃 梁太祖', intro: '朱温是后梁的建立者。史料中也以朱全忠、朱晃等名字出现，阅读时应注意称谓的变化。' },
  { id: 'li-cunxu', name: '李存勖', dynasty: '后唐', role: '后唐建立者', event: 'tang', aliases: '唐庄宗', intro: '李存勖是后唐的建立者。其活动与河东军事势力、梁唐交替和洛阳的政治地位相关。' },
  { id: 'shi-jingtang', name: '石敬瑭', dynasty: '后晋', role: '后晋建立者', event: 'jin', aliases: '晋高祖', intro: '石敬瑭是后晋的建立者。其相关记述可从后唐与后晋两朝的史料中相互参照。' },
  { id: 'liu-zhiyuan', name: '刘知远', dynasty: '后汉', role: '后汉建立者', event: 'han', aliases: '汉高祖', intro: '刘知远是后汉的建立者。其经历与河东、中原以及五代政权更迭有关。' },
  { id: 'guo-wei', name: '郭威', dynasty: '后周', role: '后周建立者', event: 'zhou', aliases: '周太祖', intro: '郭威是后周的建立者。其相关事件为理解后汉到后周的转变提供了入口。' },
  { id: 'zhao-kuangyin', name: '赵匡胤', dynasty: '宋', role: '宋朝建立者', event: 'song', aliases: '宋太祖', intro: '赵匡胤是宋朝的建立者。当前收录其与五代结束相关的线索，宋代内容将逐步整理。' },
];

export const books = libraryBooks;

export const places: [HistoricalPlace, ...HistoricalPlace[]] = [
  { name: '洛阳', coords: [34.62, 112.45], detail: '五代时期的重要政治中心，与后唐等王朝的历史密切相关。' },
  { name: '开封', coords: [34.8, 114.31], detail: '史料中的汴州、大梁与这一地区相关，是理解中原政权更迭的重要地点。' },
  { name: '太原', coords: [37.87, 112.55], detail: '河东地区的核心城市，可作为追索李存勖、刘知远等人物活动的地理入口。' },
];

export const searchItems: SearchItem[] = [
  ...events.map((item): SearchItem => ({ ...item, type: 'event', category: '事件', name: item.title, summary: `${item.year} 年 · ${item.description}`, keywords: `${item.dynasty} ${item.person} ${item.year}` })),
  ...people.map((item): SearchItem => ({ ...item, type: 'person', category: '人物', summary: `${item.dynasty} · ${item.role}`, keywords: `${item.dynasty} ${item.aliases}` })),
  ...books.map((item): SearchItem => ({ ...item, type: 'book', category: '史料', name: item.title, summary: `${item.author} · ${item.description}`, keywords: `${item.kind} 五代 正史 编年 笔记 ${item.title} ${item.author}` })),
  ...libraryChapters.map((item): SearchItem => ({ ...item, type: 'chapter', category: '史料', name: `${books.find(book => book.id === item.bookId)?.title} · ${item.title}`, summary: `${item.years ?? '完整原文'} · ${item.paragraphCount} 段`, keywords: people.filter(person => item.subjects.includes(person.id)).map(person => `${person.name} ${person.dynasty} ${person.aliases}`).join(' ') })),
];

export function filterSearch(query: string, type: SearchFilter = 'all'): SearchItem[] {
  const needle = query.trim().toLowerCase();
  return searchItems.filter(item => (type === 'all' || item.type === type || (type === 'book' && item.type === 'chapter')) && (!needle || `${item.name} ${item.summary} ${item.keywords}`.toLowerCase().includes(needle)));
}
