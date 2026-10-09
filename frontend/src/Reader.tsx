import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, ArrowUpRight, List } from '@phosphor-icons/react';
import { loadChapter, historyApiBase } from './history-api';
import { chaptersForBook, chapterRoute } from './library';
import type { PassageSearchOptions } from './library';
import { originalParagraphs } from './original-script';
import { useOriginalScript } from './use-original-script';
import { OriginalParagraph } from './OriginalParagraph';
import { TranslationEditor } from './TranslationEditor';
import { CollapsibleSidebar, useSidebarState } from './CollapsibleSidebar';
import { readingFocusKey } from './reading-focus';
import type { Book, ChapterSummary, ChapterResponse, ChapterParagraph, Route } from './types';

type ReadState = 'loading' | 'archive-pending' | 'archive' | 'ready' | 'error';
export function Reader({ book, entry, go, focusParagraphId, returnTo, search = { query: '', field: 'both' } }: {
  book: Book;
  entry: ChapterSummary;
  go: (route: Route) => void;
  focusParagraphId?: string;
  returnTo?: Route;
  search?: PassageSearchOptions;
}) {
  const directoryRef = useRef<HTMLElement>(null);
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const focusedParagraph = useRef<string | undefined>(undefined);
  const [size, setSize] = useState(23);
  const [showDirectory, setShowDirectory] = useState(false);
  const directorySidebar = useSidebarState('reader-directory');
  const [chapter, setChapter] = useState<ChapterResponse | null>(null);
  const [readState, setReadState] = useState<ReadState>('loading');
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<ChapterParagraph | null>(null);
  const [saveNotice, setSaveNotice] = useState('');
  const originalScript = useOriginalScript();
  const paragraphs = useMemo(() => originalParagraphs(
    chapter?.paragraphs ?? [], originalScript.displayScript, originalScript.converter,
  ), [chapter?.paragraphs, originalScript.displayScript, originalScript.converter]);
  useEffect(() => {
    const controller = new AbortController();
    setEditing(null); setSaveNotice('');
    setReadState('loading');
    loadChapter(book.id, entry.id, controller.signal, value => {
      setChapter(value); setReadState('archive-pending');
    }).then(result => {
      if (!controller.signal.aborted) { setChapter(result.chapter); setReadState(result.source === 'api' ? 'ready' : 'archive'); }
    }).catch(() => { if (!controller.signal.aborted) setReadState('error'); });
    return () => controller.abort();
  }, [book.id, entry.id, retry]);
  useEffect(() => {
    const paragraph = chapter?.paragraphs.find(item => item.id === focusParagraphId);
    if (!focusParagraphId || !paragraph) return;
    const key = readingFocusKey(entry.id, paragraph, search.query, search.field, originalScript.displayScript);
    if (focusedParagraph.current === key) return;
    const target = document.getElementById(focusParagraphId);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    if (!search.query) { focusedParagraph.current = key; return; }
    // A match can sit halfway through a long paragraph or in a translation that
    // has just expanded. Wait for the shared lazy text component before locating it.
    function locateMatch() {
      const hit = Array.from(target!.querySelectorAll<HTMLElement>('[data-search-hit]')).find(mark => !mark.closest('[hidden]'));
      if (!hit) return false;
      focusedParagraph.current = key;
      hit.scrollIntoView({ block: 'center' });
      return true;
    }
    if (locateMatch()) return;
    const observer = new MutationObserver(() => { if (locateMatch()) observer.disconnect(); });
    observer.observe(target, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  }, [chapter, entry.id, focusParagraphId, search.query, search.field, originalScript.displayScript]);
  useEffect(() => {
    const container = directoryRef.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (container && selected) container.scrollTop = Math.max(0, selected.offsetTop - 130);
  }, [entry.id, showDirectory]);
  function closeDrawer() {
    if (showDirectory) directoryTrigger.current?.focus();
    setShowDirectory(false);
  }
  useEffect(() => {
    if (!showDirectory) return;
    const panel = directoryRef.current;
    panel?.querySelector<HTMLButtonElement>('.sidebar-toggle')?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        directoryTrigger.current?.focus();
        setShowDirectory(false);
      }
    }
    function leaveDrawer(event: FocusEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && !panel?.contains(target)
        && target !== directoryTrigger.current
        && !target.closest('.sidebar-backdrop')) {
        setShowDirectory(false);
      }
    }
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', leaveDrawer);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('focusin', leaveDrawer); };
  }, [showDirectory]);
  const directory = chaptersForBook(book.id);
  const index = directory.findIndex(item => item.id === entry.id);
  const previous = directory[index - 1];
  const next = directory[index + 1];
  const provenance = entry.provenance;
  const contextRoute = (chapterEntry: ChapterSummary) => chapterRoute(chapterEntry, { ...search, returnTo });
  return <section className="reader" data-read-state={readState} data-chapter-id={entry.id}>
    <div className="breadcrumbs"><button onClick={() => go(returnTo ?? 'people')}>{returnTo ? '返回相关记载' : '人物'}</button><span>/</span><span>{book.title}</span><span>/</span><span>{entry.volume > 0 ? `卷 ${entry.volume}` : entry.title}</span></div>
    <div className={`reader-layout ${directorySidebar.collapsed ? 'left-collapsed' : ''}`}>
      {showDirectory && <button className="sidebar-backdrop directory-backdrop" aria-label="关闭侧栏" onClick={closeDrawer} />}
      <CollapsibleSidebar id="reader-directory" title="章节目录" side="left" panelRef={directoryRef} className={`reader-directory full-directory ${showDirectory ? 'directory-visible' : ''}`} collapsed={directorySidebar.collapsed} onToggle={() => { directorySidebar.toggle(); if (showDirectory) closeDrawer(); }}>
        <h3 className="directory-book-title">{book.title}</h3>
        <p>本地收录 · {directory.length} 篇</p>
        <nav aria-label={`${book.title}章节目录`}>{directory.map(item => <button key={item.id} className={item.id === entry.id ? 'chapter-active' : ''} aria-current={item.id === entry.id ? 'page' : undefined} onClick={() => { setShowDirectory(false); go(contextRoute(item)); }}><span>{item.title}</span>{item.years && <small>{item.years} 年</small>}</button>)}</nav>
      </CollapsibleSidebar>
      <article className="reader-main">
        <span className="eyebrow">{book.author} · 完整篇章原文</span><h1>{chapter?.title ?? entry.title}</h1>
        <p className="chapter-meta">{book.kind}{entry.years ? ` · ${entry.years} 年` : ''} · {chapter?.paragraphs.length ?? entry.paragraphCount} 段</p>
        {search.query && <p className="reader-search-context">正在全文中定位“{search.query}”{search.field === 'original' ? '的原文' : search.field === 'translation' ? '的译文' : ''}，前后文均保留。{returnTo && <button type="button" onClick={() => go(returnTo)}>返回检索结果</button>}</p>}
        <div className="reader-toolbar"><div className="reader-text-mode"><span>原文</span><div className="script-switch" role="group" aria-label="原文繁简切换">{(['traditional', 'simplified'] as const).map(script => <button key={script} aria-pressed={originalScript.script === script} onClick={() => originalScript.selectScript(script)}>{script === 'traditional' ? '繁体' : '简体'}</button>)}</div></div><div><button className="font-button" aria-label="减小字号" disabled={size <= 18} onClick={() => setSize(value => value - 1)}>A−</button><button className="font-button" aria-label="增大字号" disabled={size >= 30} onClick={() => setSize(value => value + 1)}>A＋</button><button ref={directoryTrigger} className="directory-toggle" aria-expanded={showDirectory} aria-controls="reader-directory-content" onClick={() => { directorySidebar.setCollapsed(false); setShowDirectory(value => !value); }}><List size={18} />目录</button></div></div>
        <div className="script-status" role="status">{originalScript.pending && '正在准备简体显示…'}{originalScript.error ? <><span>简体转换暂不可用，当前显示繁体原文。</span> <button className="text-link small" onClick={originalScript.retry}>重试转换</button></> : originalScript.displayScript === 'simplified' && '简体为自动转换的阅读显示，可随时切回繁体原文。'}</div>
        <p className="sentence-reading-hint">点击原文句子，在附近查看译文。</p>
        <div className="reader-status" role="status">{readState === 'loading' && '正在打开原文…'}{readState === 'archive-pending' && '原文已打开，正在检查已发布译文…'}{readState === 'archive' && '当前显示随站保存的完整原文。'}{readState === 'error' && <><span>这一篇暂时无法打开。</span> <button className="text-link small" onClick={() => setRetry(value => value + 1)}>重新读取</button></>}</div>
        {saveNotice && <p className="translation-notice" role="status">{saveNotice}</p>}
        <div className="original-text" lang={originalScript.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'} aria-busy={originalScript.pending} style={{ fontSize: size }}>{paragraphs.map((paragraph, index) => <OriginalParagraph key={paragraph.id} paragraph={chapter?.paragraphs[index] ?? paragraph} displayedOriginal={paragraph.original} searchQuery={search.query} searchField={search.field} onEdit={historyApiBase && readState === 'ready' ? () => setEditing(chapter?.paragraphs[index] ?? null) : undefined} />)}</div>
        {chapter && <div className="reading-source"><span>完整篇章原文 · 维基文库贡献者整理 · 本地归档</span><p>夹注、提要与原页校勘说明一并保留。译文支持逐段修订，旧版本保留。</p><details className="provenance"><summary>出处与版本信息</summary><p>来源：{provenance.pageTitle} · 修订 {provenance.revisionId}<br />归档时间：{new Date(provenance.fetchedAt).toLocaleString('zh-CN')}<br />授权：<a href={provenance.licenseUrl} target="_blank" rel="noreferrer">{provenance.license}</a> · 古籍原作公版</p><div><a href={provenance.sourceUrl} target="_blank" rel="noreferrer">核对来源版本 <ArrowUpRight size={15} /></a><a href={provenance.contributorsUrl} target="_blank" rel="noreferrer">贡献者与修订记录 <ArrowUpRight size={15} /></a></div></details></div>}
        <div className="reader-bottom"><button className="text-link" onClick={() => previous ? go(contextRoute(previous)) : go(returnTo ?? 'people')}><ArrowLeft size={18} />{previous ? '上一篇' : returnTo ? '返回相关记载' : '返回人物'}</button>{next ? <button className="text-link" onClick={() => go(contextRoute(next))}>下一篇 <ArrowRight size={18} /></button> : <button className="text-link" onClick={() => go(returnTo ?? 'people')}>{returnTo ? '返回相关记载' : '返回人物'} <ArrowRight size={18} /></button>}</div>
      </article>
    </div>
    {editing && <TranslationEditor key={`${editing.id}/${editing.translation?.id}`} paragraph={editing} apiBase={historyApiBase}
      onClose={() => setEditing(null)} onSaved={translation => {
        setChapter(current => current ? {...current, paragraphs:current.paragraphs.map(paragraph => paragraph.id === editing.id ? {...paragraph,translation} : paragraph)} : current);
        setSaveNotice(`第 ${editing.position} 段已保存为第 ${translation.version} 版，旧版本保留。`); setEditing(null);
      }} />}
  </section>;
}
