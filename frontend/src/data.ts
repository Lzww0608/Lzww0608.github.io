import type { Book, Era, HistoricalPlace, HistoryEvent, HistoryPerson, SearchFilter, SearchItem } from './types';

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

export const books: [Book, Book] = [
  { id: 'old', title: '旧五代史', author: '北宋 · 薛居正等撰', image: '/images/old-five-dynasties.webp', description: '以五个王朝分别叙述，保存五代人物与事件的丰富记载。', chapter: '梁太祖纪一', url: 'https://zh.wikisource.org/wiki/舊五代史', chapterUrl: 'https://zh.wikisource.org/wiki/舊五代史/卷1', paragraphs: ['太祖神武元聖孝皇帝，姓朱氏，諱晃，本名溫。', '唐僖宗乾符中，關東荐饑，羣賊嘯聚。黃巢因之起于曹、濮，饑民願附者凡數萬。帝乃辭崇家，與仲兄存俱入巢軍，以力戰屢捷，得補為隊長。'], notes: ['此处为卷一的短节选。第一段在原页面中附有辑佚出处与校勘说明，本页暂以主文展示，完整上下文请查阅来源。', '文中的“帝”指本纪记述的朱温。将人物称谓与上下文对照，有助于阅读本纪。'] },
  { id: 'new', title: '新五代史', author: '北宋 · 欧阳修撰', image: '/images/new-five-dynasties.webp', description: '从另一种编纂视角记录五代，与《旧五代史》相互参读。', chapter: '梁本纪第一', url: 'https://zh.wikisource.org/wiki/新五代史', chapterUrl: 'https://zh.wikisource.org/wiki/新五代史/卷01', paragraphs: ['太祖神武元聖孝皇帝，姓朱氏，宋州碭山午溝里人也。其父誠，以五經教授鄉里，生三子，曰全昱、存、溫。', '誠卒，三子貧，不能為生，與其母傭食蕭縣人劉崇家。全昱無他材能，然為人頗長者。存、溫勇有力，而溫尤兇悍。'], notes: ['此处为卷一开篇节选。原页面中另有夹注；完整原文和上下文可通过下方来源链接查阅。', '这段记述朱温的家庭与早年经历。原文保留繁体字，界面使用简体中文。'] },
];

export const places: [HistoricalPlace, ...HistoricalPlace[]] = [
  { name: '洛阳', coords: [34.62, 112.45], detail: '五代时期的重要政治中心，与后唐等王朝的历史密切相关。' },
  { name: '开封', coords: [34.8, 114.31], detail: '史料中的汴州、大梁与这一地区相关，是理解中原政权更迭的重要地点。' },
  { name: '太原', coords: [37.87, 112.55], detail: '河东地区的核心城市，可作为追索李存勖、刘知远等人物活动的地理入口。' },
];

export const searchItems: SearchItem[] = [
  ...events.map((item): SearchItem => ({ ...item, type: 'event', category: '事件', name: item.title, summary: `${item.year} 年 · ${item.description}`, keywords: `${item.dynasty} ${item.person} ${item.year}` })),
  ...people.map((item): SearchItem => ({ ...item, type: 'person', category: '人物', summary: `${item.dynasty} · ${item.role}`, keywords: `${item.dynasty} ${item.aliases}` })),
  ...books.map((item): SearchItem => ({ ...item, type: 'book', category: '史料', name: item.title, summary: `${item.author} · ${item.description}`, keywords: '五代 史书 梁本纪 薛居正 欧阳修' })),
];

export function filterSearch(query: string, type: SearchFilter = 'all'): SearchItem[] {
  const needle = query.trim().toLowerCase();
  return searchItems.filter(item => (type === 'all' || item.type === type) && (!needle || `${item.name} ${item.summary} ${item.keywords}`.toLowerCase().includes(needle)));
}
