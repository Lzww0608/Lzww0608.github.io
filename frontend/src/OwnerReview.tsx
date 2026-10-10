import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { historyApiBase } from './history-api';
import { authenticateEditorSession, authenticateLocalEditorSession, clearEditorSession, hasEditorSession, hasLocalEditorSession, isLocalEditorDevelopment, TranslationEditorError } from './translation-editor-api';
import { loadOwnerReviewDetail, loadOwnerReviews, updateOwnerReviewStatus } from './owner-review-api';
import { ownerReviewRoute, reviewCategories, reviewStatuses } from './owner-review-route';
import type { OwnerReviewFilters } from './owner-review-route';
import { chapterRoute, libraryBooks, libraryChapters } from './library';
import { TranslationBlock } from './TranslationBlock';
import { useOriginalScript } from './use-original-script';
import type { OwnerReviewDetail, OwnerReviewItem, OwnerReviewResponse, ReviewCategory, ReviewStatus, Route } from './types';
import './owner-review.css';

const statusLabels: Record<ReviewStatus | 'stale', string> = { open: '待处理', resolved: '已修订', retained: '保留异说', checked: '已核对', stale: '版本已变更' };
const categoryLabels: Record<ReviewCategory, string> = { translation: '译文', association: '人物记载', relationship: '人物关系', 'source-note': '史料疑点' };
const severityLabels = { info: '提示', warning: '需留意', error: '需修正' };

export function OwnerReview({ filters, go }: { filters: OwnerReviewFilters; go: (route: Route) => void }) {
  const passwordId = useId();
  const password = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const revision = useRef<{ filterKey: string; revision: string } | null>(null);
  const selectedId = useRef<string | null>(null);
  const [authenticated, setAuthenticated] = useState(() => hasEditorSession(historyApiBase));
  const [localEntry, setLocalEntry] = useState(() => import.meta.env.DEV && hasLocalEditorSession(historyApiBase));
  const [response, setResponse] = useState<OwnerReviewResponse | null>(null);
  const [detail, setDetail] = useState<OwnerReviewDetail | null>(null);
  const [resolution, setResolution] = useState('');
  const [status, setStatus] = useState<ReviewStatus>('checked');
  const [busy, setBusy] = useState<'auth' | 'load' | 'status' | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const originalScript = useOriginalScript();
  const filterKey = JSON.stringify([filters.personId, filters.bookId, filters.status, filters.category]);

  function resetPrivateState(): void {
    request.current?.abort(); detailRequest.current?.abort(); statusRequest.current?.abort();
    selectedId.current = null; revision.current = null;
    setResponse(null); setDetail(null); setResolution(''); setDetailError(''); setDetailBusy(false); setBusy(null);
    if (password.current) password.current.value = '';
  }

  function failed(cause: unknown, detailFailure = false): void {
    if (cause instanceof Error && cause.name === 'AbortError') return;
    if (cause instanceof TranslationEditorError && cause.status === 401) {
      clearEditorSession(); resetPrivateState(); setAuthenticated(false);
      setError('校订权限已失效，请重新输入密码。'); return;
    }
    const message = cause instanceof TranslationEditorError ? cause.message : '校核清单暂时无法读取，请稍后重试。';
    if (detailFailure) setDetailError(message); else setError(message);
  }

  useEffect(() => {
    if (!import.meta.env.DEV || hasEditorSession(historyApiBase)) return;
    const context = { development: true, pageUrl: window.location.href, apiBase: historyApiBase };
    if (!isLocalEditorDevelopment(context)) return;
    const controller = new AbortController(); request.current = controller;
    setBusy('auth'); setError('');
    authenticateLocalEditorSession({ ...context, signal: controller.signal }).then(entered => {
      if (controller.signal.aborted) return;
      setLocalEntry(entered); setAuthenticated(entered);
    }).catch(cause => { if (!controller.signal.aborted) failed(cause); }).finally(() => {
      if (!controller.signal.aborted && request.current === controller) setBusy(null);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    statusRequest.current?.abort();
    detailRequest.current?.abort(); selectedId.current = null;
    setDetail(null); setDetailBusy(false); setDetailError(''); setError(''); setResponse(null); setBusy('load');
    loadOwnerReviews({ apiBase: historyApiBase, filters, signal: controller.signal }).then(value => {
      if (controller.signal.aborted || request.current !== controller) return;
      const previous = revision.current;
      revision.current = { filterKey, revision: value.resultSetRevision };
      if (filters.offset > 0 && (previous && (previous.filterKey !== filterKey || previous.revision !== value.resultSetRevision) || value.total > 0 && filters.offset >= value.total)) {
        go(ownerReviewRoute({ ...filters, offset: 0 })); return;
      }
      setResponse(value);
    }).catch(cause => { if (!controller.signal.aborted) failed(cause); }).finally(() => {
      if (!controller.signal.aborted && request.current === controller) setBusy(null);
    });
    return () => controller.abort();
  }, [authenticated, filterKey, filters.offset, retry]);

  useEffect(() => () => { request.current?.abort(); detailRequest.current?.abort(); statusRequest.current?.abort(); }, []);
  useEffect(() => { if (!authenticated) password.current?.focus(); }, [authenticated]);

  async function authenticate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (busy) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy('auth'); setError('');
    try {
      if (import.meta.env.DEV && localEntry) {
        const entered = await authenticateLocalEditorSession({ apiBase: historyApiBase, development: true, pageUrl: window.location.href, signal: controller.signal });
        if (!entered) throw new TranslationEditorError('本地校订入口暂不可用，请重新读取。');
      } else await authenticateEditorSession({ apiBase: historyApiBase, token: password.current?.value ?? '', signal: controller.signal });
      if (controller.signal.aborted) return;
      if (password.current) password.current.value = '';
      setAuthenticated(true);
    } catch (cause) { if (!controller.signal.aborted) failed(cause); }
    finally { if (!controller.signal.aborted && request.current === controller) setBusy(null); }
  }

  async function openDetail(item: OwnerReviewItem): Promise<void> {
    if (busy === 'status') return;
    const controller = new AbortController(); detailRequest.current?.abort(); detailRequest.current = controller;
    selectedId.current = item.id; setDetail(null); setDetailBusy(true); setDetailError(''); setNotice('');
    try {
      const value = await loadOwnerReviewDetail({ apiBase: historyApiBase, id: item.id, signal: controller.signal });
      if (controller.signal.aborted || selectedId.current !== item.id) return;
      setDetail(value); setResolution(value.item.resolution); setStatus(value.item.status === 'open' ? 'checked' : value.item.status);
    } catch (cause) { if (!controller.signal.aborted) failed(cause, true); }
    finally { if (!controller.signal.aborted) setDetailBusy(false); }
  }

  async function saveStatus(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!detail || busy || !detail.item.currentBinding) return;
    const controller = new AbortController(); statusRequest.current?.abort(); statusRequest.current = controller;
    setBusy('status'); setDetailError('');
    try {
      await updateOwnerReviewStatus({ apiBase: historyApiBase, item: detail.item, status, resolution, signal: controller.signal });
      if (controller.signal.aborted) return;
      setNotice('处理结论已保存。');
      go(ownerReviewRoute({ ...filters, offset: 0 })); setRetry(value => value + 1);
    } catch (cause) { if (!controller.signal.aborted) failed(cause, true); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }

  function changeFilter(key: 'personId' | 'bookId' | 'status' | 'category', value: string): void {
    statusRequest.current?.abort(); go(ownerReviewRoute({ ...filters, [key]: value, offset: 0 }));
  }
  function read(chapterId: string, paragraphId: string): void {
    const chapter = libraryChapters.find(item => item.id === chapterId);
    if (chapter) go(chapterRoute(chapter, { query: '', field: 'both', paragraphId, returnTo: ownerReviewRoute(filters) }));
  }
  const displayOriginal = (value: string) => originalScript.displayScript === 'simplified' && originalScript.converter ? originalScript.converter(value) : value;
  const chapterName = (id: string) => libraryChapters.find(chapter => chapter.id === id)?.title ?? id;
  const bookName = (id: string) => libraryBooks.find(book => book.id === id)?.title ?? id;

  return <section className="page-shell owner-review">
    <div className="owner-review-heading"><div><h1>校核清单</h1><p>核对记载、译文与出处，保留每次处理的依据。</p></div><div className="owner-review-session">
      <button type="button" className="quiet-button" onClick={() => go('people')}>返回人物</button>
      {authenticated && <button type="button" className="quiet-button" onClick={() => { clearEditorSession(); resetPrivateState(); setAuthenticated(false); setError(''); setNotice(''); }}>退出校订</button>}
    </div></div>
    {!authenticated ? <form className="owner-review-login" onSubmit={event => { void authenticate(event); }}>
      <h2>所有者入口</h2><p>{localEntry ? '可重新进入本地校订会话。' : '输入校订密码后读取清单。退出或刷新页面后需重新验证。'}</p>
      {!localEntry && <label htmlFor={passwordId}>校订密码</label>}<div className="owner-review-password">{!localEntry && <input id={passwordId} ref={password} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy !== null || !historyApiBase} />}<button type="submit" className="primary-button" disabled={busy !== null || !historyApiBase}>{busy === 'auth' ? '正在确认…' : '打开校核清单'}</button></div>
      {!historyApiBase && <p role="alert">校订服务尚未配置，清单暂不可用。</p>}
      {error && <p role="alert" className="owner-review-error">{error}</p>}
    </form> : <>
      <div className="owner-review-filters" aria-label="筛选校核清单">
        <label>人物<select value={filters.personId} disabled={!response || busy === 'status'} onChange={event => changeFilter('personId', event.target.value)}><option value="">全部人物</option>{response?.subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label>
        <label>文献<select value={filters.bookId} disabled={busy === 'status'} onChange={event => changeFilter('bookId', event.target.value)}><option value="">全部文献</option>{libraryBooks.map(book => <option value={book.id} key={book.id}>{book.title}</option>)}</select></label>
        <label>状态<select value={filters.status} disabled={busy === 'status'} onChange={event => changeFilter('status', event.target.value)}><option value="">全部状态</option>{[...reviewStatuses, 'stale' as const].map(value => <option value={value} key={value}>{statusLabels[value]}</option>)}</select></label>
        <label>内容<select value={filters.category} disabled={busy === 'status'} onChange={event => changeFilter('category', event.target.value)}><option value="">全部内容</option>{reviewCategories.map(value => <option value={value} key={value}>{categoryLabels[value]}</option>)}</select></label>
      </div>
      <div aria-live="polite">{busy === 'load' && <p role="status">正在读取校核清单…</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert" className="owner-review-error">{error} <button className="text-link" type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>}</div>
      {response && <><div className="owner-review-summary"><span>{response.total.toLocaleString('zh-CN')} 条记录</span>{([...reviewStatuses, 'stale'] as const).map(value => <span key={value}>{statusLabels[value]} {response.summary[value].toLocaleString('zh-CN')}</span>)}</div>
        <div className="owner-review-list">{response.items.map(item => <article key={item.id} className={`owner-review-row ${selectedId.current === item.id ? 'selected' : ''}`}>
          <div className="owner-review-meta"><span>{item.personName}</span><span>{bookName(item.bookId)} / {chapterName(item.chapterId)}</span><span>{categoryLabels[item.category]}</span><span>{item.currentBinding ? statusLabels[item.status] : statusLabels.stale}</span></div>
          <button className="owner-review-title" type="button" onClick={() => { void openDetail(item); }} disabled={busy === 'status'} aria-expanded={selectedId.current === item.id}><h2>{item.title}</h2><span>{severityLabels[item.severity]}</span></button>
          <p className="owner-review-description">{item.detail}</p>
          {selectedId.current === item.id && <div className="owner-review-detail">
            {detailBusy && <p role="status">正在打开依据与结论…</p>}
            {detailError && <p role="alert" className="owner-review-error">{detailError} <button className="text-link" type="button" disabled={busy === 'status'} onClick={() => { void openDetail(item); }}>重新读取此条</button></p>}
            {detail && <>
              {!detail.item.currentBinding && <p className="owner-review-stale" role="status">原文或译文已有新版本，本次核对依据已失效。需按当前版本重新复查。</p>}
              <div className="owner-review-detail-tools"><div className="script-switch" role="group" aria-label="校核依据繁简切换">{(['traditional', 'simplified'] as const).map(value => <button key={value} aria-pressed={originalScript.script === value} onClick={() => originalScript.selectScript(value)}>{value === 'traditional' ? '繁体' : '简体'}</button>)}</div><button type="button" className="text-link" onClick={() => read(detail.item.chapterId, detail.item.paragraphId)}>定位原文与译文</button></div>
              <div role="status" className="small-note">{originalScript.pending && '正在准备简体显示…'}{originalScript.error && <><span>简体转换暂不可用，当前显示繁体。</span> <button className="text-link" onClick={originalScript.retry}>重试</button></>}</div>
              <h3>原文依据</h3>{detail.item.evidence.map((evidence, index) => <blockquote key={`${evidence.paragraphId}/${index}`} lang={originalScript.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'}><p>{displayOriginal(evidence.excerpt)}</p><button type="button" className="text-link" onClick={() => read(evidence.chapterId, evidence.paragraphId)}>{chapterName(evidence.chapterId)} · 定位出处</button></blockquote>)}
              {detail.paragraph && <><details className="owner-review-paragraph"><summary>查看当前完整原文 · 第 {detail.paragraph.position} 段</summary><p lang={originalScript.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'}>{displayOriginal(detail.paragraph.original)}</p></details>{detail.paragraph.translation && <TranslationBlock key={detail.paragraph.translation.id} translation={detail.paragraph.translation} />}</>}
              <form className="owner-review-conclusion" onSubmit={event => { void saveStatus(event); }}>
                <label htmlFor={`${passwordId}-status`}>处理状态</label><select id={`${passwordId}-status`} value={status} disabled={!detail.item.currentBinding || busy === 'status'} onChange={event => setStatus(event.target.value as ReviewStatus)}>{reviewStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select>
                <label htmlFor={`${passwordId}-resolution`}>处理结论</label><textarea id={`${passwordId}-resolution`} value={resolution} maxLength={4000} rows={4} disabled={!detail.item.currentBinding || busy === 'status'} onChange={event => setResolution(event.target.value)} required />
                {detail.item.checkedAt && <p className="small-note">上次核对：{new Date(detail.item.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}；依据原文第 {detail.item.originalRevision} 版{detail.item.translationVersion ? `、译文第 ${detail.item.translationVersion} 版` : ''}。</p>}
                <button type="submit" className="quiet-button" disabled={!detail.item.currentBinding || busy !== null}>{busy === 'status' ? '正在保存…' : '保存处理结论'}</button>
              </form>
            </>}
          </div>}
        </article>)}{!response.items.length && <div className="empty-state"><h2>没有符合条件的记录</h2><p>可以调整人物、文献或处理状态。</p></div>}</div>
        <nav className="owner-review-pagination" aria-label="校核清单分页"><button className="quiet-button" type="button" disabled={filters.offset === 0 || busy !== null} onClick={() => go(ownerReviewRoute({ ...filters, offset: Math.max(0, filters.offset - 50) }))}>上一页</button><span>{response.total ? `${filters.offset + 1}—${filters.offset + response.items.length} / ${response.total}` : '0 条记录'}</span><button className="quiet-button" type="button" disabled={response.nextOffset === null || busy !== null} onClick={() => response.nextOffset !== null && go(ownerReviewRoute({ ...filters, offset: response.nextOffset }))}>下一页</button></nav>
      </>}
    </>}
  </section>;
}
