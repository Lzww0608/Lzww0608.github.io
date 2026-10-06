export type Era = '先秦' | '秦汉' | '魏晋南北朝' | '隋唐' | '五代' | '宋元' | '明清';
export type Dynasty = '后梁' | '后唐' | '后晋' | '后汉' | '后周' | '宋';
export type EventId = 'liang' | 'tang' | 'jin' | 'han' | 'zhou' | 'song';
export type BookId = 'old' | 'new';
export type Route = 'overview' | 'timeline' | 'sources' | 'people' | 'map' | `read-${BookId}`;

export interface HistoryEvent {
  id: EventId;
  year: number;
  end: number;
  dynasty: Dynasty;
  title: string;
  person: string;
  description: string;
  context: string;
  color: string;
}

export interface HistoryPerson {
  id: string;
  name: string;
  dynasty: Dynasty;
  role: string;
  event: EventId;
  aliases: string;
  intro: string;
}

export interface Book {
  id: BookId;
  title: string;
  author: string;
  image: string;
  description: string;
  chapter: string;
  url: string;
  chapterUrl: string;
  paragraphs: string[];
  notes: string[];
}

export interface HistoricalPlace {
  name: string;
  coords: [latitude: number, longitude: number];
  detail: string;
}

interface SearchDetails {
  name: string;
  summary: string;
  keywords: string;
}

export type SearchItem =
  | (HistoryEvent & SearchDetails & { type: 'event'; category: '事件' })
  | (HistoryPerson & SearchDetails & { type: 'person'; category: '人物' })
  | (Book & SearchDetails & { type: 'book'; category: '史料' });

export type SearchFilter = 'all' | SearchItem['type'];

export interface PublishedTranslation {
  id: string;
  text: string;
  language: string;
  version: number;
  translator: string;
}

export interface ChapterParagraph {
  id: string;
  position: number;
  revision: number;
  original: string;
  translation: PublishedTranslation | null;
}

export interface ChapterResponse {
  id: string;
  title: string;
  position: number;
  scope: string;
  sourceUrl: string;
  notes: string[];
  bookId: BookId;
  bookTitle: string;
  author: string;
  editionId: string;
  edition: string;
  paragraphs: ChapterParagraph[];
}
