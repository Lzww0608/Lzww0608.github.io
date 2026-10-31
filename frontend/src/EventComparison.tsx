import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CaretDown, CaretUp } from '@phosphor-icons/react';
import { CollapsibleSidebar, useSidebarState } from './CollapsibleSidebar';
import { OriginalParagraph } from './OriginalParagraph';
import { historyApiBase } from './history-api';
import { readEventComparison } from './event-comparison-loader';
import { eventComparisonRoute } from './event-comparison-route';
import { personTimelineRoute, resolvePersonTimelineRoute } from './person-timeline-route';
import { captureReadingPosition, useReadingPosition, useReadingView } from './use-reading-position';
import { pendingReadingResume, useReadingProgress } from './use-reading-progress';
import { readingNavigation } from './reading-navigation-state';
import type { PublicReadingAnchor } from './use-reading-progress';
import { readComparisonTimelineLinks } from './event-timeline-links-loader';
import { eventTimelineLinks } from './event-timeline-links';
import type { ResolvedEventTimelineLink } from './event-timeline-links';
import { catalogPeople } from './person-catalog';
import { eraForComparison, peopleRoute } from './eras';
import { useOriginalScript } from './use-original-script';
import type { CSSProperties, SetStateAction } from 'react';
import type { EventComparisonDocument, EventComparisonResponse } from './event-comparison-schema';
import type { ReadingSearchContext } from './library';
import type { BookId, Route } from './types';
import './event-comparison.css';

type ComparisonSource = EventComparisonResponse['sources'][number];
type ComparisonDifference = EventComparisonResponse['differences'][number];
type ComparisonStage = EventComparisonResponse['stages'][number];
type ReadState = 'loading' | 'ready' | 'error';
interface ComparisonView { selectedBooks: BookId[]; expandedTranslations: Record<string, boolean>; fontSize: number }
const differenceLabels = { conflict: '记载不同', detail: '详略差别', perspective: '叙事侧重', dating: '纪年与日期' };
const preferredBooks: readonly BookId[] = ['old', 'new', 'tongjian'];
// Keep the reading selection while visiting an original chapter, within this tab
// only. No source content or reading preferences are written to persistent storage.
const bookSelections = new Map<string, BookId[]>();

function initialBooks(document: EventComparisonDocument, route?: Route): BookId[] {
  const available = [...new Set(document.sources.map(source => source.bookId))];
  const saved = route ? pendingReadingResume(route)?.view.selectedBooks?.filter(bookId => available.includes(bookId)).slice(0, 3) : undefined;
  if (saved?.length) return saved;
  const previous = bookSelections.get(document.id)?.filter(bookId => available.includes(bookId)).slice(0, 3);
  if (previous?.length) return [...previous];
  const preferred = preferredBooks.filter(bookId => available.includes(bookId));
  return [...preferred, ...available.filter(bookId => !preferred.includes(bookId))].slice(0, 3);
}

function Difference({ difference, sources, displayOriginal, onRead, onVerify, verifying, initiallyOpen }: {
  difference: ComparisonDifference;
  sources: ReadonlyMap<string, ComparisonSource>;
  displayOriginal: (original: string) => string;
  onRead: (source: ComparisonSource) => void;
  onVerify: (differenceId: string) => void;
  verifying: boolean;
  initiallyOpen: boolean;
}) {
  return <article className="comparison-difference" data-difference-id={difference.id} data-status={difference.status}>
    <div className="comparison-difference-heading"><span>{differenceLabels[difference.kind]}</span><h4>{difference.title}</h4></div>
    {difference.status === 'available' ? <>
      <p>{difference.summary}</p>
      <details className="comparison-difference-evidence" open={initiallyOpen || undefined} data-reading-details-id={`difference/${difference.id}`}><summary>核对各书原文依据</summary><ul>{difference.evidence.map((evidence, index) => {
        const source = sources.get(evidence.sourceId);
        if (!source || source.status !== 'available') return null;
        return <li key={`${evidence.sourceId}-${index}`}><div><strong>{source.bookTitle}</strong><span>{source.chapterTitle}，原篇第 {source.paragraph.position} 段</span><button type="button" onClick={() => onRead(source)}>定位原篇</button></div><blockquote>{displayOriginal(evidence.excerpt)}</blockquote></li>;
      })}</ul></details>
    </> : difference.status === 'pending' ? <div className="comparison-proof-pending"><p>这条说明尚有来源待核验，核对全部原文依据后再展示结论。</p><button type="button" disabled={verifying} onClick={() => onVerify(difference.id)}>{verifying ? '正在核验原文依据…' : '核验这条说明的全部依据'}</button></div>
      : <p className="comparison-paused">这条说明的原文或译文目前无法核验，暂不展示结论。可查阅下方仍有效的记载。</p>}
  </article>;
}

export function EventComparison({ document, route, stageId, returnTo, personId, go, onReadSource }: {
  document: EventComparisonDocument;
  route: Route;
  stageId?: string;
  returnTo?: Route;
  personId?: string;
  go: (route: Route) => void;
  onReadSource: (chapterId: string, paragraphId?: string, context?: ReadingSearchContext) => void;
}) {
  const [storedPage, setStoredPage] = useState<{ key: string; page: EventComparisonResponse | null }>({ key: '', page: null });
  const [readRecord, setReadRecord] = useState<{ key: string; state: ReadState }>({ key: '', state: 'loading' });
  const [retry, setRetry] = useState(0);
  const [timelineLinks, setTimelineLinks] = useState<ResolvedEventTimelineLink[]>([]);
  const [storedLinksState, setLinksState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storedUnavailableLinks, setUnavailableLinks] = useState(0);
  const [linkOwner, setLinkOwner] = useState({ key: '', proofKey: '' });
  const resume = pendingReadingResume(route);
  const savedAnchor = resume?.position.anchorId ?? readingNavigation.current()?.position?.anchorId;
  const restoredStage = document.stages.find(stage => savedAnchor === `comparison-stage-${stage.id}`
    || stage.sourceIds.some(sourceId => savedAnchor === `comparison-paragraph-${document.id}-${stage.id}-${sourceId}`));
  const activeStageId = stageId ?? restoredStage?.id ?? document.stages[0]!.id;
  const resumeEntryId = readingNavigation.current()?.id ?? route;
  const verificationKey = `${document.id}/${activeStageId}/${resumeEntryId}`;
  const [verification, setVerification] = useState<{ key: string; ids: string[]; loading: boolean }>({ key: verificationKey, ids: [], loading: false });
  const proofController = useRef<AbortController | null>(null);
  // Keep the initial resume proof for this history entry after the hook consumes
  // it; removing it would cause a second identical chapter read after restore.
  const resumeSourceIds = useMemo(() => resume?.binding?.kind === 'stage'
    ? resume.binding.sourceBindings.map(source => source.sourceId).filter(id => document.sources.some(source => source.id === id)) : [],
  [document.id, route, resumeEntryId]);
  const [view, setView] = useReadingView<ComparisonView>(route, { selectedBooks: initialBooks(document, route), expandedTranslations: {}, fontSize: 20 });
  const { selectedBooks, expandedTranslations, fontSize } = view;
  const restoredDetails = useMemo(() => {
    const entry = readingNavigation.current();
    return { ...(resume?.position.details ?? (entry?.route === route ? entry.position?.details : undefined) ?? {}) };
  }, [document.id, route, resumeEntryId, selectedBooks.join(',')]);
  const restoredDifferenceIds = document.differences.filter(difference => restoredDetails[`difference/${difference.id}`] === true).map(difference => difference.id);
  const differenceIds = [...new Set([...restoredDifferenceIds, ...(verification.key === verificationKey ? verification.ids : [])])];
  // A new request owns no prior body's readiness, even on the render before
  // effects abort/restart. This keeps a new saved binding pending until its own
  // requested sources have finished validation.
  const requestKey = JSON.stringify([document, activeStageId, selectedBooks, resumeSourceIds, restoredDifferenceIds, retry, route, resumeEntryId]);
  const page = storedPage.key === requestKey ? storedPage.page : null;
  const readState = readRecord.key === requestKey ? readRecord.state : 'loading';
  function setPage(page: EventComparisonResponse | null) { setStoredPage({ key: requestKey, page }); }
  function setReadState(state: ReadState) { setReadRecord({ key: requestKey, state }); }
  function setSelectedBooks(value: SetStateAction<BookId[]>) { setView(current => ({ ...current, selectedBooks: typeof value === 'function' ? value(current.selectedBooks) : value })); }
  function setExpandedTranslations(value: SetStateAction<Record<string, boolean>>) { setView(current => ({ ...current, expandedTranslations: typeof value === 'function' ? value(current.expandedTranslations) : value })); }
  function setFontSize(value: SetStateAction<number>) { setView(current => ({ ...current, fontSize: typeof value === 'function' ? value(current.fontSize) : value })); }
  const directory = useSidebarState('comparison-stages');
  const script = useOriginalScript();
  const sources = useMemo(() => new Map(page?.sources.map(source => [source.id, source]) ?? []), [page?.sources]);
  const books = useMemo(() => {
    const entries = new Map<BookId, { id: BookId; title: string; sourceCount: number }>();
    for (const source of page?.sources ?? []) {
      const book = entries.get(source.bookId);
      if (book) book.sourceCount++;
      else entries.set(source.bookId, { id: source.bookId, title: source.bookTitle, sourceCount: 1 });
    }
    return [...entries.values()];
  }, [page?.sources]);
  const selected = books.filter(book => selectedBooks.includes(book.id));
  const displayOriginal = (original: string) => script.displayScript === 'simplified' && script.converter ? script.converter(original) : original;
  const translationKeys = page?.stages.filter(stage => stage.id === activeStageId).flatMap(stage => stage.sourceIds.flatMap(sourceId => {
    const source = sources.get(sourceId);
    return source?.status === 'available' && selectedBooks.includes(source.bookId) ? [`${stage.id}/${sourceId}`] : [];
  })) ?? [];
  const allTranslationsExpanded = translationKeys.length > 0 && translationKeys.every(key => expandedTranslations[key]);
  const linkSourceIds = eventTimelineLinks.find(registry => registry.comparisonId === document.id)?.links
    .flatMap(link => link.evidence.filter(evidence => evidence.stageId === activeStageId).map(evidence => evidence.sourceId)) ?? [];
  const linkProofKey = JSON.stringify(page?.sources.filter(source => linkSourceIds.includes(source.id)).map(source =>
    source.status === 'available' ? [source.id, source.status, source.paragraph.revision, source.originalSha256, source.paragraph.translation?.id, source.paragraph.translation?.version]
      : [source.id, source.status, source.reason]) ?? []);
  const linksCurrent = linkOwner.key === requestKey && linkOwner.proofKey === linkProofKey && readState === 'ready';
  const linksState = linksCurrent ? storedLinksState : 'loading';
  const unavailableLinks = linksCurrent ? storedUnavailableLinks : 0;
  const unavailableCount = page?.sources.filter(source => source.status === 'unavailable').length ?? 0;
  const archiveCount = page?.sources.filter(source => source.status === 'available' && source.source === 'archive').length ?? 0;
  const returnTimeline = returnTo ? resolvePersonTimelineRoute(returnTo) : null;
  const readingPersonId = personId ?? returnTimeline?.person.id;
  const anchors = useMemo<PublicReadingAnchor[]>(() => (page?.stages ?? []).filter(stage => stage.id === activeStageId).flatMap(stage => {
    const available = stage.sourceIds.map(id => sources.get(id)).filter((source): source is Extract<ComparisonSource, { status: 'available' }> => source?.status === 'available');
    return [...(available.length ? [{ anchorId: `comparison-stage-${stage.id}`, comparisonId: document.id, stageId: stage.id, sources: available.map(source => ({ anchorId: source.id, sourceId: source.id, chapterId: source.chapterId, paragraph: source.paragraph })) }] : []),
      ...available.map(source => ({ anchorId: `comparison-paragraph-${document.id}-${stage.id}-${source.id}`, chapterId: source.chapterId, paragraph: source.paragraph }))];
  }), [page, sources, document.id, activeStageId]);
  const progress = useReadingProgress({ route, personId: readingPersonId, ready: readState === 'error' || readState === 'ready', anchors,
    view: { selectedBooks, expandedTranslations, fontSize },
    navigationView: saved => ({ selectedBooks: saved.selectedBooks ?? initialBooks(document), expandedTranslations: saved.expandedTranslations ?? {}, fontSize: Math.min(28, saved.fontSize ?? 20) }),
    progressRoute: anchorId => eventComparisonRoute(document.id, page?.stages.find(stage => anchorId === `comparison-stage-${stage.id}` || stage.sourceIds.some(sourceId => anchorId === `comparison-paragraph-${document.id}-${stage.id}-${sourceId}`))?.id ?? stageId),
    blockedNotice: readState === 'error' ? '当前对读资料暂时无法核验，保存位置暂不恢复。' : undefined });
  useReadingPosition({ route, ready: progress.ready && readState !== 'error', targetId: !progress.stale ? `comparison-stage-${activeStageId}` : undefined,
    focusSelector: 'h2', layoutKey: `${page?.resultSetRevision ?? readState}/${selectedBooks.join(',')}/${fontSize}/${directory.collapsed}/${script.displayScript}` });

  useEffect(() => {
    const controller = new AbortController();
    setLinkOwner({ key: requestKey, proofKey: linkProofKey });
    setTimelineLinks([]); setLinksState('loading'); setUnavailableLinks(0);
    if (!page || readState !== 'ready') return () => controller.abort();
    readComparisonTimelineLinks({ comparison: page, stageIds: [activeStageId], apiBase: historyApiBase, archiveBase: import.meta.env.BASE_URL, signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setTimelineLinks(result.links); setUnavailableLinks(result.unavailableCount); setLinksState('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setLinksState('error'); });
    return () => controller.abort();
  }, [requestKey, linkProofKey, readState]);

  useEffect(() => {
    const controller = new AbortController();
    setVerification({ key: verificationKey, ids: restoredDifferenceIds, loading: false });
    setPage(null); setReadState('loading');
    readEventComparison({ document, apiBase: historyApiBase, archiveBase: import.meta.env.BASE_URL, signal: controller.signal,
      request: { stageIds: [activeStageId], bookIds: selectedBooks, sourceIds: resumeSourceIds, differenceIds: restoredDifferenceIds },
      onProgress: result => { if (!controller.signal.aborted) setPage(result.page); },
    }).then(result => {
      if (!controller.signal.aborted) { setPage(result.page); setReadState('ready'); }
    }).catch(() => { if (!controller.signal.aborted) { setPage(null); setReadState('error'); } });
    return () => { controller.abort(); proofController.current?.abort(); };
  }, [requestKey]);

  function selectStage(id: string) {
    if (id !== activeStageId) { go(eventComparisonRoute(document.id, id, returnTo)); return; }
    const element = window.document.getElementById(`comparison-stage-${id}`);
    element?.scrollIntoView({ block: 'start' });
    element?.querySelector<HTMLHeadingElement>('h2')?.focus({ preventScroll: true });
  }

  function readSource(source: ComparisonSource, stage: ComparisonStage | null) {
    onReadSource(source.chapterId, source.paragraphId, { query: '', field: 'both', returnTo: eventComparisonRoute(document.id, stage?.id ?? activeStageId, returnTo) });
  }

  function toggleBook(bookId: BookId) {
    // The native details toggle may precede the debounced progress save. Keep
    // this entry's actual open evidence before the selection starts a new read.
    captureReadingPosition();
    const next = selectedBooks.includes(bookId) ? selectedBooks.length > 1 ? selectedBooks.filter(id => id !== bookId) : selectedBooks : selectedBooks.length < 3 ? [...selectedBooks, bookId] : selectedBooks;
    bookSelections.set(document.id, [...next]);
    setSelectedBooks(next);
  }

  function toggleAllTranslations() {
    setExpandedTranslations(current => ({ ...current, ...Object.fromEntries(translationKeys.map(key => [key, !allTranslationsExpanded])) }));
  }

  function verifyDifference(id: string) {
    if (!page || readState !== 'ready') return;
    const ids = [...new Set([...differenceIds, id])];
    proofController.current?.abort();
    const controller = new AbortController(); proofController.current = controller;
    setVerification({ key: verificationKey, ids, loading: true });
    readEventComparison({ document, previousPage: page, request: { differenceIds: ids }, apiBase: historyApiBase,
      archiveBase: import.meta.env.BASE_URL, signal: controller.signal,
      onProgress: result => { if (!controller.signal.aborted) setPage(result.page); },
    }).then(result => {
      if (!controller.signal.aborted) { setPage(result.page); setVerification({ key: verificationKey, ids, loading: false }); }
    }).catch(() => { if (!controller.signal.aborted) setVerification({ key: verificationKey, ids, loading: false }); });
  }

  return <section className="event-comparison" data-comparison-id={document.id} data-read-state={readState} data-links-state={linksState}>
    <div className="comparison-breadcrumbs"><button type="button" onClick={() => { const eraId = eraForComparison(document); go(eraId ? peopleRoute(eraId) : 'eras'); }}><ArrowLeft size={14} aria-hidden="true" />人物</button><span aria-hidden="true">/</span><span>{document.title}</span></div>
    {returnTo && <button type="button" className="comparison-return" onClick={() => go(returnTo)}><ArrowLeft size={14} aria-hidden="true" />返回{returnTimeline ? `${returnTimeline.person.name}年表` : '来源页面'}</button>}
    <header className="comparison-heading"><div><h1>{document.title}</h1><p className="comparison-date">{document.dateLabel}</p></div><p>{document.summary}</p></header>
    <p className="comparison-scope">按战事阶段并列当前归档中的相关段落。各书保留完整原文与白话译文；阶段分组用于对读，不表示各书叙事逐句对应。完整原段可能包含前后其他史事，请依阶段说明区分，不把整段都视为本次战事当日。</p>
    <div className="comparison-load-status" role="status">
      {readState === 'loading' && '正在核对本阶段所选文献的原文与译文…'}
      {readState === 'error' && <><span>当前对读资料无法打开。</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></>}
      {readState === 'ready' && archiveCount > 0 && <p>{archiveCount === page?.sources.length ? '当前显示随站保存的原文与译文。' : '部分篇章暂时无法连接，已显示其随站保存的原文与译文。'}</p>}
      {readState === 'ready' && unavailableCount > 0 && <p>{unavailableCount} 段的原文或译文目前无法核验，相关记载和差异说明已暂停展示。</p>}
      {readState === 'ready' && linksState === 'loading' && <p className="comparison-links-status">正在核对相关人物的年表事件…</p>}
      {readState === 'ready' && linksState === 'error' && <p className="comparison-links-status">相关人物的年表事件当前无法核验，暂不显示跳转入口。</p>}
      {unavailableLinks > 0 && <p className="comparison-links-status">部分人物事件的依据已变化，其对应阶段的跳转暂不可用。</p>}
      {script.pending && <p>正在准备简体原文…</p>}
      {progress.notice && <p className="reading-progress-notice">{progress.notice}</p>}
      {script.error && <p>简体转换暂不可用，当前显示繁体底本。<button type="button" onClick={script.retry}>重试转换</button></p>}
    </div>
    {page && <>
      <div className="comparison-tools">
        <fieldset className="comparison-book-selection"><legend>对读文献</legend><div>{books.map(book => {
          const isSelected = selectedBooks.includes(book.id);
          return <button key={book.id} type="button" aria-pressed={isSelected} disabled={isSelected && selectedBooks.length === 1 || !isSelected && selectedBooks.length >= 3} onClick={() => toggleBook(book.id)}>{book.title}<small>{book.sourceCount} 段</small></button>;
        })}</div><p>可选一至三本并列；取消一本后，可加入其他文献。</p></fieldset>
        <div className="comparison-reading-tools"><div className="comparison-script-switch"><span>原文</span><div className="script-switch" role="group" aria-label="对读原文繁简切换">{(['traditional', 'simplified'] as const).map(value => <button key={value} type="button" aria-pressed={script.script === value} onClick={() => script.selectScript(value)}>{value === 'traditional' ? '繁体' : '简体'}</button>)}</div></div><div className="comparison-font-controls" role="group" aria-label="原文字号"><button type="button" className="font-button" aria-label="减小原文字号" disabled={fontSize <= 18} onClick={() => setFontSize(value => value - 1)}>A−</button><button type="button" className="font-button" aria-label="增大原文字号" disabled={fontSize >= 28} onClick={() => setFontSize(value => value + 1)}>A＋</button></div><button className="comparison-translations-toggle" type="button" disabled={!translationKeys.length} onClick={toggleAllTranslations}>{allTranslationsExpanded ? <CaretUp size={15} aria-hidden="true" /> : <CaretDown size={15} aria-hidden="true" />}{allTranslationsExpanded ? '一并收起译文' : '一并展开译文'}</button></div>
      </div>
      <div className={`comparison-layout ${directory.collapsed ? 'left-collapsed' : ''}`}>
        <CollapsibleSidebar id="comparison-stages" title="战事阶段" side="left" className="comparison-stage-directory" collapsed={directory.collapsed} onToggle={directory.toggle}><nav aria-label="对读阶段">{page.stages.map(stage => <button key={stage.id} type="button" aria-current={activeStageId === stage.id ? 'location' : undefined} onClick={() => selectStage(stage.id)}>{stage.title}</button>)}</nav></CollapsibleSidebar>
        <div className="comparison-main">{page.stages.filter(stage => stage.id === activeStageId).map(stage => {
          const stageSources = stage.sourceIds.map(sourceId => sources.get(sourceId)).filter((source): source is ComparisonSource => !!source);
          const differences = page.differences.filter(difference => difference.stageId === stage.id);
          const registeredLinks = eventTimelineLinks.find(registry => registry.comparisonId === document.id)?.links.filter(link => link.stageIds.includes(stage.id)) ?? [];
          return <section className="comparison-stage" key={stage.id} id={`comparison-stage-${stage.id}`} data-reading-anchor={`comparison-stage-${stage.id}`} data-focused={activeStageId === stage.id} aria-labelledby={`comparison-stage-heading-${stage.id}`}>
            <header className="comparison-stage-heading"><h2 id={`comparison-stage-heading-${stage.id}`} tabIndex={-1}>{stage.title}</h2>{activeStageId === stage.id && returnTo && <button type="button" className="comparison-inline-return" onClick={() => go(returnTo)}><ArrowLeft size={14} aria-hidden="true" />返回{returnTimeline ? `${returnTimeline.person.name}年表` : '来源页面'}</button>}{stage.summary && stageSources.every(source => source.status === 'available') && <p>{stage.summary}</p>}</header>
            {!!registeredLinks.length && <section className="comparison-related-events" aria-labelledby={`comparison-related-${stage.id}`}><h3 id={`comparison-related-${stage.id}`}>相关人物的同一事件</h3><ul>{registeredLinks.map(reference => {
              const link = linksCurrent ? timelineLinks.find(link => link.person.id === reference.personId && link.event.id === reference.eventId && link.stageIds.includes(stage.id)) : undefined;
              const name = catalogPeople.find(person => person.id === reference.personId)?.name;
              const comparisonPending = reference.evidence.filter(evidence => evidence.stageId === stage.id).some(evidence => sources.get(evidence.sourceId)?.status === 'pending');
              return <li key={`${reference.personId}/${reference.eventId}`}><button type="button" data-timeline-person={reference.personId} data-timeline-event={reference.eventId} disabled={!link} aria-label={link ? `${name}：${link.event.title}` : `${name}的对应年表事件，依据尚未核验`} onClick={() => { if (link) go(personTimelineRoute(link.person.id, link.event.id, eventComparisonRoute(document.id, stage.id, returnTo))); }}><strong>{name}</strong><span>对应年表事件</span><small>{link ? '查看年表' : comparisonPending ? '尚待核验' : linksState === 'loading' ? '正在核验' : '暂不可用'}</small></button></li>;
            })}</ul></section>}
            {differences.length > 0 && <section className="comparison-differences" aria-labelledby={`comparison-differences-${stage.id}`}><h3 id={`comparison-differences-${stage.id}`}>本阶段的记载对照</h3>{differences.map(difference => <Difference key={difference.id} difference={difference} sources={sources} displayOriginal={displayOriginal} onRead={source => readSource(source, stage)} onVerify={verifyDifference} initiallyOpen={restoredDetails[`difference/${difference.id}`] === true} verifying={readState === 'loading' || differenceIds.includes(difference.id) && verification.loading} />)}</section>}
            <div className="comparison-book-columns" style={{ '--comparison-columns': selected.length } as CSSProperties}>{selected.map(book => {
              const bookSources = stageSources.filter(source => source.bookId === book.id);
              return <section className="comparison-book" key={book.id} data-book-id={book.id} aria-label={`${stage.title}的${book.title}记载`}><h3>{book.title}</h3>{bookSources.length === 0 ? <p className="comparison-no-record">本阶段未选取该书相关段落，可在其他阶段查看已选材料。</p> : bookSources.map(source => <article className="comparison-source" key={source.id} data-source-id={source.id} data-status={source.status}>
                <div className="comparison-source-caption"><strong>{source.chapterTitle}</strong><span>{source.label}</span>{source.status === 'available' && <span>原篇第 {source.paragraph.position} 段</span>}<button type="button" onClick={() => readSource(source, stage)}>{source.status === 'available' ? '查看原篇与前后文' : '查看当前原篇'}</button></div>
                {source.status === 'available' ? <div className="comparison-original original-text" data-reading-anchor={`comparison-paragraph-${document.id}-${stage.id}-${source.id}`} lang={script.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'} style={{ fontSize }}><OriginalParagraph paragraph={source.paragraph} displayedOriginal={displayOriginal(source.paragraph.original)} anchorId={`comparison-paragraph-${document.id}-${stage.id}-${source.id}`} bookmark={{ chapterId: source.chapterId, personId: readingPersonId }} translationExpanded={expandedTranslations[`${stage.id}/${source.id}`] ?? false} onTranslationExpandedChange={expanded => setExpandedTranslations(current => ({ ...current, [`${stage.id}/${source.id}`]: expanded }))} /></div> : source.status === 'pending' ? <p className="comparison-source-pending">{source.reason === 'loading' ? '正在核对这一原段与完整译文…' : '这一原段尚未加载，选择该文献后核验。'}</p> : <p className="comparison-paused">此处原文或译文目前无法核验，暂不展示旧内容。</p>}
              </article>)}</section>;
            })}</div>
          </section>;
        })}
          {page.differences.some(difference => difference.stageId === null) && <section className="comparison-differences comparison-cross-stage"><h2>跨阶段的记载对照</h2>{page.differences.filter(difference => difference.stageId === null).map(difference => <Difference key={difference.id} difference={difference} sources={sources} displayOriginal={displayOriginal} onRead={source => readSource(source, null)} onVerify={verifyDifference} initiallyOpen={restoredDetails[`difference/${difference.id}`] === true} verifying={readState === 'loading' || differenceIds.includes(difference.id) && verification.loading} />)}</section>}
        </div>
      </div>
    </>}
  </section>;
}
