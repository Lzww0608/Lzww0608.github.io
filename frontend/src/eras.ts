import type { BookId, ChapterSummary, Dynasty, EraId, HistoryPerson, PersonGroupId, Route } from './types.ts';

export interface HistoryEra {
  id: EraId;
  title: string;
  period: string;
  description: string;
  dynasties: readonly Dynasty[];
  groupIds: readonly PersonGroupId[];
  searchExample: string;
}

export const historyEras: readonly HistoryEra[] = [
  { id: 'five-dynasties', title: '五代十国', period: '唐末至十国末期',
    description: '从帝王、文臣、武将与宫廷人物，阅读五代十国的原文、译文和人物年表。',
    dynasties: ['后梁', '后唐', '后晋', '后汉', '后周', '吴', '南唐', '吴越', '前蜀', '后蜀', '南汉', '楚', '闽', '南平', '北汉'],
    groupIds: ['all', 'emperors', 'ten-kingdoms-rulers', 'thirteen-taibao', 'zhu-wen-generals', 'li-keyong-generals', 'southern-tang-officials', 'civil-officials', 'palace-people', 'military-people'],
    searchExample: '李存孝、朱全忠、后唐' },
  { id: 'southern-northern', title: '南北朝', period: '南朝皇帝专题',
    description: '先从南朝皇帝开始，按刘宋、南齐、南梁、南陈逐批整理；人物与史料以已收录内容为准。',
    dynasties: ['刘宋', '南齐', '南梁', '南陈'], groupIds: ['all', 'southern-emperors'], searchExample: '刘裕、宋武帝、刘宋' },
];

export function historyEra(eraId: EraId): HistoryEra { return historyEras.find(era => era.id === eraId)!; }
export function peopleRoute(eraId: EraId): Route { return eraId === 'five-dynasties' ? 'people' : 'people/southern-northern'; }
export function resolvePeopleEra(route: string): EraId | undefined {
  return route === 'people' ? 'five-dynasties' : route === 'people/southern-northern' ? 'southern-northern' : undefined;
}
export function eraForPerson(person: Pick<HistoryPerson, 'dynasty'>): EraId | undefined {
  return historyEras.find(era => era.dynasties.includes(person.dynasty))?.id;
}
export function personIndexRoute(person: Pick<HistoryPerson, 'dynasty'>): Route {
  const eraId = eraForPerson(person);
  return eraId ? peopleRoute(eraId) : 'eras';
}

// Shared works can register individual chapters without changing their existing
// book or paragraph identities. Do not infer the era from compilation dates.
const chapterEras: Readonly<Record<string, EraId>> = {};
const bookEras: Readonly<Record<BookId, EraId>> = {
  old: 'five-dynasties', new: 'five-dynasties', tongjian: 'five-dynasties', quewen: 'five-dynasties',
  shibu: 'five-dynasties', chunqiu: 'five-dynasties', huiyao: 'five-dynasties', beimeng: 'five-dynasties',
  kaoyi: 'five-dynasties', shiguochunqiu: 'five-dynasties', nantanglu: 'five-dynasties', nantangma: 'five-dynasties',
  nantangjinshi: 'five-dynasties', quantangwen: 'five-dynasties', jiuguozhi: 'five-dynasties',
  songshu: 'southern-northern', nanshi: 'southern-northern',
};
export function eraForChapter(chapter: Pick<ChapterSummary, 'id' | 'bookId'>): EraId {
  return chapterEras[chapter.id] ?? bookEras[chapter.bookId];
}
export function eraForComparison(document: { sources: readonly { chapterId: string; bookId: BookId }[] }): EraId | undefined {
  const eras = new Set(document.sources.map(source => eraForChapter({ id: source.chapterId, bookId: source.bookId })));
  return eras.size === 1 ? [...eras][0] : undefined;
}
