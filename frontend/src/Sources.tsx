import { useState } from 'react';
import { ArrowRight, BookOpen } from '@phosphor-icons/react';
import { books, people } from './data';
import { chaptersForBook, chapterRoute, libraryChapters } from './library';
import { BookCover } from './BookCover';
import type { Route } from './types';

export function Sources({ go }: { go: (route: Route) => void }) {
  const [personId, setPersonId] = useState('all');
  const founders = people;
  const selected = founders.find(person => person.id === personId);
  const count = libraryChapters.filter(chapter => personId === 'all' || chapter.subjects.includes(personId)).length;
  return <section className="page-shell library-page">
    <div className="page-heading"><div><span className="eyebrow">五代 / 本地史料库</span><h1>同一段历史，不止一种记述。</h1></div><p>从本纪、编年、笔记、典章与考证相互参读。原文已收录，直接在站内阅读。</p></div>
    <div className="library-summary"><span><strong>{books.length}</strong> 部史料</span><span><strong>{libraryChapters.length}</strong> 篇章原文</span><span>五位开国皇帝 · 朱温 / 李存勖 / 石敬瑭 / 刘知远 / 郭威</span></div>
    <div className="founder-filter" role="group" aria-label="按开国皇帝筛选史料">
      <button className={personId === 'all' ? 'active' : ''} aria-pressed={personId === 'all'} onClick={() => setPersonId('all')}>全部史料</button>
      {founders.map(person => <button key={person.id} className={personId === person.id ? 'active' : ''} aria-pressed={personId === person.id} onClick={() => setPersonId(person.id)}>{person.name}<small>{person.dynasty}</small></button>)}
    </div>
    <p className="small-note filter-explanation" aria-live="polite">{selected ? `${selected.name} · ${count} 篇相关史料。本纪、编年与考异按记载范围关联；笔记、会要按正文专名关联，供整篇参读。` : '本纪、编年与补充史料一并收录，提要和序文列于各书目录。'} 原文保留繁体字与夹注。</p>
    <div className="source-catalog library-catalog">{books.map(book => {
      const chapters = chaptersForBook(book.id).filter(chapter => personId === 'all' || chapter.subjects.includes(personId));
      const first = chapters.find(chapter => chapter.id === book.defaultChapter) ?? chapters.find(chapter => chapter.volume > 0) ?? chapters[0];
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
