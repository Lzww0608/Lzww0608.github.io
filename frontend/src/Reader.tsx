import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, ArrowUpRight, List, X } from '@phosphor-icons/react';
import { people, books } from './data';
import { loadChapter } from './history-api';
import { chaptersForBook, chaptersForPerson, chapterRoute } from './library';
import type { Book, ChapterSummary, ChapterResponse, HistoryPerson, Route } from './types';

type ReadState = 'loading' | 'archive-pending' | 'archive' | 'ready' | 'error';
type ReaderTab = 'notes' | 'related';
export function Reader({ book, entry, go, openPerson }: {
  book: Book;
  entry: ChapterSummary;
  go: (route: Route) => void;
  openPerson: (person: HistoryPerson | undefined) => void;
}) {
  const directoryRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState(23);
  const [tab, setTab] = useState<ReaderTab>('notes');
  const [showDirectory, setShowDirectory] = useState(false);
  const [chapter, setChapter] = useState<ChapterResponse | null>(null);
  const [readState, setReadState] = useState<ReadState>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReadState('loading');
    loadChapter(book.id, entry.id, controller.signal, value => {
      setChapter(value); setReadState('archive-pending');
    }).then(result => {
      if (!controller.signal.aborted) { setChapter(result.chapter); setReadState(result.source === 'api' ? 'ready' : 'archive'); }
    }).catch(() => { if (!controller.signal.aborted) setReadState('error'); });
    return () => controller.abort();
  }, [book.id, entry.id, retry]);
  useEffect(() => {
    const container = directoryRef.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (container && selected) container.scrollTop = Math.max(0, selected.offsetTop - 130);
  }, [entry.id, showDirectory]);
  const directory = chaptersForBook(book.id);
  const index = directory.findIndex(item => item.id === entry.id);
  const previous = directory[index - 1];
  const next = directory[index + 1];
  const subjects = people.filter(person => entry.subjects.includes(person.id));
  const parallel = books.filter(item => item.id !== book.id).flatMap(item => {
    const match = entry.subjects.flatMap(chaptersForPerson).find(candidate => candidate.bookId === item.id);
    return match ? [{ book: item, chapter: match }] : [];
  });
  const provenance = entry.provenance;
  return <section className="reader" data-read-state={readState} data-chapter-id={entry.id}>
    <div className="breadcrumbs"><button onClick={() => go('sources')}>史料库</button><span>/</span><span>{book.title}</span><span>/</span><span>卷 {entry.volume}</span></div>
    <div className="reader-layout">
      <aside ref={directoryRef} className={`reader-directory full-directory ${showDirectory ? 'directory-visible' : ''}`}>
        <div className="directory-heading"><h2>{book.title}</h2><button className="directory-close icon-button" aria-label="关闭章节目录" onClick={() => setShowDirectory(false)}><X size={22} /></button></div>
        <p>本地收录 · {directory.length} 卷</p>
        <nav aria-label={`${book.title}章节目录`}>{directory.map(item => <button key={item.id} className={item.id === entry.id ? 'chapter-active' : ''} aria-current={item.id === entry.id ? 'page' : undefined} onClick={() => { setShowDirectory(false); go(chapterRoute(item)); }}><span>{item.title}</span>{item.years && <small>{item.years} 年</small>}</button>)}</nav>
      </aside>
      <article className="reader-main">
        <span className="eyebrow">{book.author} · 完整卷原文</span><h1>{chapter?.title ?? entry.title}</h1>
        <p className="chapter-meta">{book.kind}{entry.years ? ` · ${entry.years} 年` : ''} · {chapter?.paragraphs.length ?? entry.paragraphCount} 段</p>
        <div className="reader-toolbar"><span>原文</span><div><button className="font-button" aria-label="减小字号" disabled={size <= 18} onClick={() => setSize(value => value - 1)}>A−</button><button className="font-button" aria-label="增大字号" disabled={size >= 30} onClick={() => setSize(value => value + 1)}>A＋</button><button className="directory-toggle" aria-expanded={showDirectory} onClick={() => setShowDirectory(value => !value)}><List size={18} />目录</button></div></div>
        <div className="reader-status" role="status">{readState === 'loading' && '正在打开原文…'}{readState === 'archive-pending' && '原文已打开，正在检查已发布译文…'}{readState === 'archive' && '当前显示随站保存的完整原文。'}{readState === 'error' && <><span>这一卷暂时无法打开。</span> <button className="text-link small" onClick={() => setRetry(value => value + 1)}>重新读取</button></>}</div>
        <div className="original-text" style={{ fontSize: size }}>{chapter?.paragraphs.map(paragraph => <div key={paragraph.id} id={paragraph.id}><p><span className="paragraph-number">{paragraph.position}</span>{paragraph.original}</p>{paragraph.translation && <div className="paragraph-translation"><span>译文 · {paragraph.translation.translator}</span><p>{paragraph.translation.text}</p></div>}</div>)}</div>
        {chapter && <div className="reading-source"><span>完整卷原文 · 维基文库贡献者整理 · 本地归档</span><p>夹注、提要与原页校勘说明一并保留；阅读提示由本站整理。译文仅在校核并发布后显示。</p><details className="provenance"><summary>出处与版本信息</summary><p>来源：{provenance.pageTitle} · 修订 {provenance.revisionId}<br />归档时间：{new Date(provenance.fetchedAt).toLocaleString('zh-CN')}<br />授权：<a href={provenance.licenseUrl} target="_blank" rel="noreferrer">{provenance.license}</a> · 古籍原作公版</p><div><a href={provenance.sourceUrl} target="_blank" rel="noreferrer">核对来源版本 <ArrowUpRight size={15} /></a><a href={provenance.contributorsUrl} target="_blank" rel="noreferrer">贡献者与修订记录 <ArrowUpRight size={15} /></a></div></details></div>}
        <div className="reader-bottom"><button className="text-link" onClick={() => previous ? go(chapterRoute(previous)) : go('sources')}><ArrowLeft size={18} />{previous ? '上一卷' : '返回史料库'}</button>{next ? <button className="text-link" onClick={() => go(chapterRoute(next))}>下一卷 <ArrowRight size={18} /></button> : <button className="text-link" onClick={() => go('sources')}>返回史料库 <ArrowRight size={18} /></button>}</div>
      </article>
      <aside className="reader-context"><div className="filter-tabs" role="group" aria-label="阅读辅助">{(['notes', 'related'] as const).map(id => <button className={tab === id ? 'active' : ''} aria-pressed={tab === id} key={id} onClick={() => setTab(id)}>{id === 'notes' ? '阅读提示' : '关联'}</button>)}</div>
        {tab === 'notes' ? <div><h3>阅读说明</h3>{chapter?.notes.map(note => <p key={note}>{note}</p>)}</div> : <div><h3>关联人物</h3>{subjects.length ? subjects.map(person => <button className="context-link" key={person.id} onClick={() => openPerson(person)}>{person.name}<ArrowRight size={18} /></button>) : <p>本卷位于开国皇帝在位时期之外，保留五代史事的连续记述。</p>}<h3>同一人物，参读史料</h3>{parallel.map(item => <button className="context-link parallel-link" key={item.book.id} onClick={() => go(chapterRoute(item.chapter))}><span>{item.book.title}<small>{item.chapter.title}</small></span><ArrowRight size={18} /></button>)}{!parallel.length && <button className="context-link" onClick={() => go('sources')}>浏览全部史料 <ArrowRight size={18} /></button>}</div>}
      </aside>
    </div>
  </section>;
}
