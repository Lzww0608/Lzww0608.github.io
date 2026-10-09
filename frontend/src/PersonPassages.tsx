import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { libraryBooks, libraryChapters, personSourcesRoute } from './library';
import type { PassageSearchOptions, ReadingSearchContext } from './library';
import { validateSearchQuery } from '../../content/passage-search.mts';
import { loadPersonPassages } from './person-passages-api';
import { OriginalParagraph } from './OriginalParagraph';
import { useOriginalScript } from './use-original-script';
import { matchesPassagePageBaseline } from './person-passages-pagination';
import type { PassagePageBaseline } from './person-passages-pagination';
import type { Book, ChapterParagraph, HistoryPerson, PersonPassage, PersonPassagesResponse, Route } from './types';
import './person-passages.css';

type ReadState = 'loading' | 'archive-pending' | 'archive' | 'ready' | 'error';
type LoadedPage = { key: string; state: ReadState; page: PersonPassagesResponse | null };
type Pagination = { target: string; cursors: string[]; index: number };
type ChapterGroup = {
  first: PersonPassage;
  entries: { passage: PersonPassage; paragraph: ChapterParagraph }[];
};
type BookGroup = { bookId: string; bookTitle: string; chapters: ChapterGroup[] };
const kindLabels: Record<PersonPassage['kind'], string> = { biography: '本纪／本传', record: '事迹记载', mention: '相关提及' };
const chapterMetadata = new Map(libraryChapters.map(chapter => [chapter.id, chapter]));

function groupPassages(items: PersonPassage[]): BookGroup[] {
  const books: BookGroup[] = [];
  const bookGroups = new Map<string, BookGroup>();
  const chapters = new Map<string, ChapterGroup>();
  const paragraphs = new Set<string>();
  for (const passage of items) {
    let book = bookGroups.get(passage.bookId);
    if (!book) {
      book = { bookId: passage.bookId, bookTitle: passage.bookTitle, chapters: [] };
      bookGroups.set(passage.bookId, book);
      books.push(book);
    }
    const key = `${passage.bookId}/${passage.chapterId}`;
    let chapter = chapters.get(key);
    if (!chapter) {
      chapter = { first: passage, entries: [] };
      chapters.set(key, chapter);
      book.chapters.push(chapter);
    }
    for (const paragraph of passage.paragraphs) {
      if (paragraphs.has(paragraph.id)) continue;
      paragraphs.add(paragraph.id);
      chapter.entries.push({ passage, paragraph });
    }
  }
  return books;
}

function PassageProvenance({ passage }: { passage: PersonPassage }) {
  const chapter = chapterMetadata.get(passage.chapterId);
  const provenance = chapter?.bookId === passage.bookId ? chapter.provenance : undefined;
  return <details className="provenance passage-provenance">
    <summary>出处与版本信息</summary>
    <p>底本：{passage.edition}<br />篇章：{passage.bookTitle} · {passage.chapterTitle}</p>
    {provenance && <p>归档来源：{provenance.pageTitle} · 原页修订 {provenance.revisionId}<br />
      归档时间：{new Date(provenance.fetchedAt).toLocaleString('zh-CN')}<br />
      授权：<a href={provenance.licenseUrl} target="_blank" rel="noreferrer">{provenance.license}</a> · 古籍原作公版</p>}
    <div>
      <a href={passage.sourceUrl} target="_blank" rel="noreferrer">查看原文来源 <ArrowUpRight size={15} /></a>
      {provenance && <>
        <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">核对归档版本 <ArrowUpRight size={15} /></a>
        <a href={provenance.contributorsUrl} target="_blank" rel="noreferrer">贡献者与修订记录 <ArrowUpRight size={15} /></a>
      </>}
    </div>
  </details>;
}

export function PersonPassages({ person, book, go, onReadSource, search }: {
  person: HistoryPerson;
  book?: Book;
  go: (route: Route) => void;
  onReadSource: (chapterId: string, paragraphId?: string, context?: ReadingSearchContext) => void;
  search: PassageSearchOptions;
}) {
  const target = JSON.stringify([person.id, book?.id ?? '', search.query, search.field]);
  const [draftQuery, setDraftQuery] = useState(search.query);
  const [draftField, setDraftField] = useState(search.field);
  const [searchError, setSearchError] = useState('');
  const [pagination, setPagination] = useState<Pagination>({ target, cursors: ['0'], index: 0 });
  const currentPagination = pagination.target === target ? pagination : { target, cursors: ['0'], index: 0 };
  const cursor = currentPagination.cursors[currentPagination.index] ?? '0';
  const requestKey = `${target}/${cursor}`;
  const [loaded, setLoaded] = useState<LoadedPage>({ key: requestKey, state: 'loading', page: null });
  const [retry, setRetry] = useState(0);
  const [size, setSize] = useState(23);
  const [paginationNotice, setPaginationNotice] = useState<{ target: string; text: string } | null>(null);
  const firstPageBaseline = useRef<PassagePageBaseline | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const focusResults = useRef(false);
  const originalScript = useOriginalScript();
  const current = loaded.key === requestKey ? loaded : { key: requestKey, state: 'loading' as const, page: null };
  const page = current.page;
  const groups = useMemo(() => groupPassages(page?.items ?? []), [page?.items]);

  useEffect(() => {
    setPagination(value => value.target === target ? value : { target, cursors: ['0'], index: 0 });
    firstPageBaseline.current = null;
    setPaginationNotice(null);
    setDraftQuery(search.query);
    setDraftField(search.field);
    setSearchError('');
  }, [target]);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ key: requestKey, state: 'loading', page: null });
    loadPersonPassages(person.id, book?.id, controller.signal, archive => {
      if (!controller.signal.aborted && (cursor === '0' || matchesPassagePageBaseline(firstPageBaseline.current, target, 'archive', archive.resultSetRevision))) {
        setLoaded({ key: requestKey, state: 'archive-pending', page: archive });
      }
    }, cursor, search).then(result => {
      if (controller.signal.aborted) return;
      if (cursor !== '0' && !matchesPassagePageBaseline(firstPageBaseline.current, target, result.source, result.page.resultSetRevision)) {
        firstPageBaseline.current = null;
        setLoaded({ key: `${target}/0`, state: 'loading', page: null });
        setPagination({ target, cursors: ['0'], index: 0 });
        setPaginationNotice({ target, text: '记载范围或读取来源已变化，已返回第一页。' });
        focusResults.current = true;
        return;
      }
      if (cursor === '0') firstPageBaseline.current = { target, source: result.source, resultSetRevision: result.page.resultSetRevision };
      setLoaded({ key: requestKey, state: result.source === 'api' ? 'ready' : 'archive', page: result.page });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ key: requestKey, state: 'error', page: null });
    });
    return () => controller.abort();
  }, [person.id, book?.id, search.query, search.field, cursor, requestKey, retry]);

  useEffect(() => {
    if (focusResults.current && current.state !== 'loading') {
      resultsHeading.current?.focus();
      resultsHeading.current?.scrollIntoView({ block: 'start' });
      focusResults.current = false;
    }
  }, [current.state, requestKey]);

  function switchBook(bookId: string) {
    const selected = libraryBooks.find(item => item.id === bookId);
    go(personSourcesRoute(person.id, selected?.id, search));
  }
  function submitSearch() {
    let query: string;
    try { query = validateSearchQuery(draftQuery); }
    catch { setSearchError('请使用不超过 100 字、不含换行或控制字符的关键词。'); return; }
    setSearchError('');
    focusResults.current = true;
    setPagination({ target, cursors: ['0'], index: 0 });
    go(personSourcesRoute(person.id, book?.id, { query, field: draftField }));
  }
  function clearSearch() {
    setDraftQuery('');
    setDraftField('both');
    setSearchError('');
    focusResults.current = true;
    go(personSourcesRoute(person.id, book?.id));
  }
  function readContext(chapterId: string, paragraphId?: string) {
    onReadSource(chapterId, paragraphId, { ...search, returnTo: personSourcesRoute(person.id, book?.id, search) });
  }
  function turnPage(direction: 'previous' | 'next') {
    if (current.state === 'loading' || !page) return;
    if (direction === 'previous' && currentPagination.index > 0) {
      setPaginationNotice(null);
      focusResults.current = true;
      setPagination({ ...currentPagination, index: currentPagination.index - 1 });
    } else if (direction === 'next' && page.nextCursor) {
      setPaginationNotice(null);
      focusResults.current = true;
      setPagination({ target, cursors: [...currentPagination.cursors.slice(0, currentPagination.index + 1), page.nextCursor], index: currentPagination.index + 1 });
    }
  }

  const offset = Number(cursor);
  const rangeStart = Number.isSafeInteger(offset) && offset >= 0 ? offset + 1 : 1;
  const rangeEnd = rangeStart + (page?.items.length ?? 0) - 1;
  const isPending = current.state === 'loading' || current.state === 'archive-pending';
  return <section className="person-passages" data-read-state={current.state} data-person-id={person.id} data-book-id={book?.id ?? 'all'}>
    <div className="breadcrumbs"><button onClick={() => go('people')}>人物</button><span>/</span><span>{person.name}</span><span>/</span><span>相关记载</span></div>
    <div className="person-passages-page">
      <header className="passages-heading">
        <div><h1>{person.name}的相关记载</h1><p>汇集本传、各篇史事与他人传中的相关段落，保留原段文白对照。</p></div>
        <button className="text-link small" onClick={() => go('people')}><ArrowLeft size={17} />返回人物</button>
      </header>
      <div className="passages-selection">
        <label htmlFor="person-passage-book">文献</label>
        <div className="passages-book-select">
          <select id="person-passage-book" value={book?.id ?? ''} onChange={event => switchBook(event.target.value)}>
            <option value="">全部文献</option>
            {libraryBooks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <CaretDown size={16} aria-hidden="true" focusable="false" />
        </div>
        <p>仅汇总当前文库收录范围内已核对的记载。</p>
      </div>
      <form className="passages-search" role="search" aria-label={`${person.name}记载内检索`} onSubmit={event => { event.preventDefault(); submitSearch(); }}>
        <label htmlFor="person-passage-query">在{person.name}的记载中检索</label>
        <div className="passages-search-row">
          <div className="passages-search-input"><MagnifyingGlass size={20} aria-hidden="true" /><input id="person-passage-query" type="search" value={draftQuery} placeholder="输入地名、事件或原句，如潞州" onChange={event => setDraftQuery([...event.target.value].slice(0, 100).join(''))} aria-invalid={!!searchError} aria-describedby={`person-passage-search-help${searchError ? ' person-passage-search-error' : ''}`} /></div>
          <button className="passages-search-submit" type="submit">检索</button>
          {(search.query || draftQuery) && <button className="passages-search-clear" type="button" onClick={clearSearch}>清除</button>}
        </div>
        <fieldset className="passages-search-fields"><legend>搜索范围</legend>{([
          ['both', '原文和译文'], ['original', '仅原文'], ['translation', '仅译文'],
        ] as const).map(([value, label]) => <label key={value}><input type="radio" name="person-passage-field" value={value} checked={draftField === value} onChange={() => setDraftField(value)} /><span>{label}</span></label>)}</fieldset>
        <p id="person-passage-search-help">支持繁体或简体输入，检索原文及已发布白话译文；匹配处会突出显示。</p>
        {searchError && <p id="person-passage-search-error" role="alert">{searchError}</p>}
      </form>
      <div className="reader-toolbar passages-toolbar">
        <div className="reader-text-mode"><span>原文</span><div className="script-switch" role="group" aria-label="原文繁简切换">
          {(['traditional', 'simplified'] as const).map(script => <button key={script} aria-pressed={originalScript.script === script} onClick={() => originalScript.selectScript(script)}>{script === 'traditional' ? '繁体' : '简体'}</button>)}
        </div></div>
        <div className="passages-font-controls"><span>字号</span><button className="font-button" aria-label="减小字号" disabled={size <= 18} onClick={() => setSize(value => value - 1)}>A−</button><button className="font-button" aria-label="增大字号" disabled={size >= 30} onClick={() => setSize(value => value + 1)}>A＋</button></div>
      </div>
      <div className="script-status" role="status">
        {originalScript.pending && '正在准备简体显示…'}
        {originalScript.error ? <><span>简体转换暂不可用，当前显示繁体原文。</span> <button className="text-link small" onClick={originalScript.retry}>重试转换</button></> : originalScript.displayScript === 'simplified' && '简体为自动转换的阅读显示，可随时切回繁体原文。'}
      </div>
      <div className="passages-results-heading">
        <h2 ref={resultsHeading} tabIndex={-1}>{book?.title ?? '全部文献'}</h2>
        {page && <p>{search.query ? `“${search.query}” · ${page.total} 则匹配记载` : `${page.total} 则相关记载`}{page.items.length > 0 && `，本页第 ${rangeStart}—${rangeEnd} 则`}</p>}
      </div>
      <p className="sentence-reading-hint">点击原文句子，在附近查看译文。</p>
      <div className="reader-status passages-status" role="status" aria-live="polite">
        {current.state === 'loading' && '正在汇总相关原文与译文…'}
        {current.state === 'archive-pending' && '已打开随站保存的记载，正在检查最新已发布译文…'}
        {current.state === 'archive' && '当前显示随站保存的原文和已发布译文。'}
        {current.state === 'error' && <><span>相关记载暂时无法打开。</span> <button className="text-link small" onClick={() => setRetry(value => value + 1)}>重新读取</button></>}
      </div>
      {paginationNotice?.target === target && <p className="passages-unavailable" role="status">{paginationNotice.text}</p>}
      {page && <p className="passages-scope">当前归档收录 {page.coverage.bookCount} 部文献、{page.coverage.chapterCount} 篇原文、{page.coverage.paragraphCount.toLocaleString('zh-CN')} 段。已收录的选卷不等于史书全本，未列入汇总也不代表其他史料没有记载。</p>}
      {!!page?.unavailableCount && <p className="passages-unavailable" role="status">{page.unavailableCount} 则关联的原文版本已变化，暂未列入。可进入完整篇章阅读，待重新核对后恢复汇总。</p>}
      {page?.total === 0 && <div className="passages-empty"><h3>{search.query ? '没有找到匹配的记载' : '当前文献暂无已核对的相关片段'}</h3><p>{search.query ? '可以缩短关键词、改换搜索范围，或查看其他文献。' : '可以查看其他文献中的记载，或返回人物选择其他条目。'}</p>{search.query && <button className="text-link" onClick={clearSearch}>清除检索 <ArrowRight size={17} /></button>}{book && <button className="text-link" onClick={() => switchBook('')}>查看全部文献 <ArrowRight size={17} /></button>}</div>}
      {page && page.total > 0 && !page.items.length && <div className="passages-empty"><h3>本页的记载已变化</h3><p>请回到第一页查看当前可用的相关记载。</p><button className="text-link" onClick={() => setPagination({target,cursors:['0'],index:0})}>返回第一页 <ArrowRight size={17} /></button></div>}
      <div className="passages-results" aria-busy={isPending}>
        {groups.map(bookGroup => {
          const sourceBook = libraryBooks.find(item => item.id === bookGroup.bookId);
          return <section className="passages-book" key={bookGroup.bookId}>
            <header className="passages-book-heading"><h2>{bookGroup.bookTitle}</h2>{sourceBook && <p>{sourceBook.author} · {sourceBook.kind}</p>}</header>
            {bookGroup.chapters.map(group => <section className="passages-chapter" key={group.first.chapterId}>
              <header className="passages-chapter-heading"><h3>{group.first.chapterTitle}</h3><button className="text-link small" onClick={() => readContext(group.first.chapterId, group.entries[0]?.paragraph.id)}>阅读完整篇章 <ArrowRight size={16} /></button></header>
              <div className="original-text passage-text" lang={originalScript.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'} aria-busy={originalScript.pending} style={{ fontSize: size }}>
                {group.entries.map(({ passage, paragraph }, index) => {
                  const previous = group.entries[index - 1]?.paragraph;
                  const gap = previous && paragraph.position - previous.position - 1;
                  const displayedOriginal = originalScript.displayScript === 'simplified' && originalScript.converter ? originalScript.converter(paragraph.original) : paragraph.original;
                  const matches = passage.searchMatches?.find(match => match.paragraphId === paragraph.id);
                  return <div className="passage-entry" key={paragraph.id}>
                    {previous && gap !== undefined && gap > 0 && <p className="passage-gap">中间另有 {gap} 段，未列入本人物汇总。<button onClick={() => readContext(passage.chapterId, previous.id)}>查看上下文</button></p>}
                    <div className="passage-context"><span>{kindLabels[passage.kind]} · 原篇第 {paragraph.position} 段{search.query && matches && ` · ${matches.original.length && matches.translation.length ? '原文与译文命中' : matches.original.length ? '原文命中' : '译文命中'}`}</span><button onClick={() => readContext(passage.chapterId, paragraph.id)}>{search.query ? '查看上下文并定位' : '在全文中定位'}</button></div>
                    <OriginalParagraph paragraph={paragraph} displayedOriginal={displayedOriginal} anchorId={`person-passage-${paragraph.id}`} searchQuery={search.query} searchField={search.field} translationMatch={!!matches?.translation.length} onEdit={current.state === 'ready' ? () => readContext(passage.chapterId, paragraph.id) : undefined} />
                    {!paragraph.translation && <p className="passage-no-translation">这段暂未提供对应的已发布白话译文。</p>}
                  </div>;
                })}
              </div>
              <PassageProvenance passage={group.first} />
            </section>)}
          </section>;
        })}
      </div>
      {page && page.total > 0 && <nav className="passages-pagination" aria-label="相关记载分页">
        <button className="text-link small" disabled={isPending || currentPagination.index === 0} onClick={() => turnPage('previous')}><ArrowLeft size={17} />上一页</button>
        <span>第 {currentPagination.index + 1} 页</span>
        <button className="text-link small" disabled={isPending || !page.nextCursor} onClick={() => turnPage('next')}>下一页 <ArrowRight size={17} /></button>
      </nav>}
    </div>
  </section>;
}
