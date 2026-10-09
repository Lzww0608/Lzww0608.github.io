import { useState } from 'react';
import { ArrowRight, BookOpen } from '@phosphor-icons/react';
import { books, people } from './data';
import { chaptersForBook, chapterRoute, libraryChapters, preferredChapterForPerson } from './library';
import { BookCover } from './BookCover';
import { peopleForGroup, personDisplayPeriod, personGroups, personTopic } from './person-catalog';
import type { ChapterSummary, PersonGroupId, Route } from './types';

export function Sources({ go }: { go: (route: Route) => void }) {
  const [personId, setPersonId] = useState('all');
  const [groupId, setGroupId] = useState<PersonGroupId>('all');
  const topic = personTopic(groupId);
  const groupPeople = peopleForGroup(people, groupId);
  const groupPersonIds = new Set(groupPeople.map(person => person.id));
  const selected = people.find(person => person.id === personId);
  const inSelection = (chapter: ChapterSummary): boolean => personId !== 'all' ? chapter.subjects.includes(personId) : groupId === 'all' || chapter.subjects.some(id => groupPersonIds.has(id));
  const count = libraryChapters.filter(inSelection).length;
  return <section className="page-shell library-page">
    <div className="page-heading"><div><span className="eyebrow">五代 / 本地史料库</span><h1>同一段历史，不止一种记述。</h1></div><p>从本纪、编年、笔记、典章与考证相互参读。原文已收录，直接在站内阅读。</p></div>
    <div className="library-summary"><span><strong>{books.length}</strong> 部史料</span><span><strong>{libraryChapters.length}</strong> 篇章原文</span><span><strong>{people.length}</strong> 位人物</span></div>
    <div className="person-group-filter" role="group" aria-label="按人物专题筛选史料">{personGroups.map(group => <button key={group.id} className={groupId === group.id ? 'active' : ''} aria-pressed={groupId === group.id} onClick={() => { setGroupId(group.id); setPersonId('all'); }}>{group.label}</button>)}</div>
    <div className="source-person-selection"><label htmlFor="source-person">选择人物</label><select id="source-person" value={personId} onChange={event => setPersonId(event.target.value)}><option value="all">{groupId === 'all' ? '全部史料' : '专题全部史料'}</option>{groupPeople.map(person => <option key={person.id} value={person.id}>{person.name} · {personDisplayPeriod(person)}</option>)}</select></div>
    {topic && <div className="person-group-context"><h2>{topic.title}</h2><p>{topic.description}</p><details><summary>称谓与史料依据</summary><p>{topic.sourceNote}</p><ul>{topic.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details></div>}
    <p className="small-note filter-explanation" aria-live="polite">{selected ? `${selected.name} · ${count} 篇相关史料。本纪、列传、编年与考异按记载范围关联；笔记、会要按正文专名关联，供整篇参读。` : groupId === 'all' ? '本纪、列传、编年与补充史料一并收录，提要和序文列于各书目录。' : `${count} 篇专题相关史料，按人物关联整篇参读。`} 原文保留繁体字与夹注。</p>
    <div className="source-catalog library-catalog">{books.map(book => {
      const chapters = chaptersForBook(book.id).filter(inSelection);
      const topicStart = topic ? groupPeople.filter(person => !person.reign).map(person => preferredChapterForPerson(book.id, person.id)).find(Boolean) : undefined;
      const first = selected ? preferredChapterForPerson(book.id, selected.id) : topicStart ?? chapters.find(chapter => chapter.id === book.defaultChapter) ?? chapters.find(chapter => chapter.volume > 0) ?? chapters[0];
      if (!first) return null;
      return <article className="catalog-book library-book" key={book.id}>
        <BookCover book={book} /><div className="catalog-copy"><span className="eyebrow">{book.kind} · {chapters.length} 篇</span><h2>{book.title}</h2><p className="author">{book.author}</p><p>{book.description}</p>
          <div className="catalog-actions"><button className="primary-button" onClick={() => go(chapterRoute(first))}>{selected ? `阅读${selected.name}相关原文` : '阅读原文'} <ArrowRight size={18} /></button></div>
          <details className="catalog-directory"><summary>查看收录目录 <span>{chapters.length} 篇</span></summary><div>{chapters.map(chapter => <button key={chapter.id} onClick={() => go(chapterRoute(chapter))}><span>{chapter.title}<small>{chapter.years ? `${chapter.years} 年 · ` : ''}{chapter.paragraphCount} 段原文</small></span><ArrowRight size={16} /></button>)}</div></details>
        </div>
      </article>;
    })}</div>
    <p className="source-note"><BookOpen size={23} weight="thin" /><span>《五代会要》可查典章制度，《资治通鉴考异》可看取舍依据；笔记异闻应与正史、编年史相互参证。每篇保留来源版本与署名信息。</span></p>
  </section>;
}
