export type Era = '先秦' | '秦汉' | '魏晋南北朝' | '隋唐' | '五代' | '宋元' | '明清';
export type Dynasty = '后梁' | '后唐' | '后晋' | '后汉' | '后周' | '宋';
export type EventId = 'liang' | 'tang' | 'jin' | 'han' | 'zhou' | 'song';
export type BookId = 'old' | 'new' | 'tongjian' | 'quewen' | 'shibu' | 'chunqiu' | 'huiyao' | 'beimeng' | 'kaoyi';
export type OriginalScript = 'traditional' | 'simplified';
export type PageTheme = 'paper' | 'jade' | 'night';
export type SidebarId = 'home-sources' | 'reader-directory' | 'map-places';
export type PersonTopicId = 'thirteen-taibao' | 'zhu-wen-generals' | 'li-keyong-generals';
export type PersonGroupId = 'all' | 'emperors' | PersonTopicId;
export type Route = 'people' | `read-${BookId}` | `read-${BookId}/${string}` | `person-sources/${string}`;

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
  event?: EventId;
  aliases: string;
  intro: string;
  periodLabel?: string;
  relation?: string;
  reign?: string;
  reignStart?: number;
  reignEnd?: number;
  sources?: HistoricalSourceReference[];
  readingStarts?: Partial<Record<BookId, string>>;
}

export interface HistoricalSourceReference {
  title: string;
  url: string;
}

export interface ReigningEmperor extends HistoryPerson {
  dynasty: Exclude<Dynasty, '宋'>;
  event: Exclude<EventId, 'song'>;
  reign: string;
  reignStart: number;
  reignEnd: number;
  sources: HistoricalSourceReference[];
  readingStarts: Partial<Record<BookId, string>>;
}

export interface EmperorCatalog {
  schemaVersion: 1;
  scope: 'five-dynasties-reigning-emperors';
  people: ReigningEmperor[];
}

export interface HistoricalPersonGroup {
  schemaVersion: 1;
  id: PersonTopicId;
  title: string;
  filterLabel?: string;
  relationshipSubject?: string;
  memberRelationshipSubjects?: Record<string, string>;
  description: string;
  sourceNote: string;
  sources: HistoricalSourceReference[];
  memberIds: string[];
  memberRelations?: Record<string, string>;
  people: HistoryPerson[];
}

export interface Book {
  id: BookId;
  title: string;
  author: string;
  image: string;
  kind: string;
  description: string;
  url: string;
  defaultChapter: string;
}

export interface ChapterSummary {
  id: string;
  bookId: BookId;
  title: string;
  volume: number;
  position: number;
  years?: string;
  subjects: string[];
  scope: 'full';
  paragraphCount: number;
  characterCount: number;
  provenance: {
    pageTitle: string;
    sourceUrl: string;
    revisionId: number;
    fetchedAt: string;
    license: string;
    licenseUrl: string;
    contributorsUrl: string;
    sourceSha256: string;
    chapterSha256: string;
  };
}

export interface LibraryCatalog {
  schemaVersion: number;
  title: string;
  license: string;
  licenseUrl: string;
  books: Book[];
  chapters: ChapterSummary[];
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

export type SearchItem = HistoryPerson & SearchDetails & { type: 'person'; category: '人物' };

export type SearchFilter = 'all' | SearchItem['type'];

export interface PublishedTranslation {
  id: string;
  text: string;
  language: string;
  version: number;
  translator: string;
  origin?: 'ai' | 'human';
  reviewStatus?: 'pending' | 'owner-edited' | 'reviewed';
  reviewNotes?: string[];
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

export type PersonPassageKind = 'biography' | 'record' | 'mention';

export interface PassageSpan {
  paragraphId: string;
  originalRevision: number;
  originalSha256: string;
  start: number;
  end: number;
}

export interface PersonPassage {
  id: string;
  title: string;
  kind: PersonPassageKind;
  bookId: BookId;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterPosition: number;
  edition: string;
  sourceUrl: string;
  spans: PassageSpan[];
  paragraphs: ChapterParagraph[];
}

export interface PersonPassagesResponse {
  schemaVersion: 1;
  scope: 'current-archive';
  personId: string;
  bookId: BookId | null;
  coverage: { bookCount: number; chapterCount: number; paragraphCount: number };
  total: number;
  unavailableCount: number;
  resultSetRevision: string;
  nextCursor: string | null;
  items: PersonPassage[];
}

export interface PersonPassageIndex {
  schemaVersion: 1;
  scope: 'current-archive';
  coverage: PersonPassagesResponse['coverage'];
  people: { id: string; name: string }[];
  passages: { id: string; chapterId: string; title: string; spans: PassageSpan[]; people: { personId: string; kind: PersonPassageKind }[] }[];
}

export interface PersonPassageSummary {
  schemaVersion: 1;
  people: { id: string; books: { bookId: BookId; passageCount: number; chapterCount: number }[] }[];
}
