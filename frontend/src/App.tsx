import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, ArrowRight, X, UsersThree } from '@phosphor-icons/react';
import { displayedDynasties, people, books, filterSearch } from './data';
import { matchesPersonSearch, personSearchNames } from './person-search-names';
import { chapterRoute, libraryChapters, personPassageBooks, personSourcesRoute, resolvePersonSourcesRoute, resolveReadingRoute, resolveRoute } from './library';
import { Reader } from './Reader';
import { ThemeSwitcher } from './ThemeSwitcher';
import { PeopleRelationshipGraph } from './PeopleRelationshipGraph';
import { historicalLeaders, peopleForGroup, personDisplayPeriod, personGroups, personTopic, personTopicRelationships, personTopics, reigningEmperors, tenKingdomRulers, topicsForPerson } from './person-catalog';
import type { ReactNode } from 'react';
import type { HistoryPerson, PersonGroupId, Route, SearchItem } from './types';
import type { ReadingSearchContext } from './library';
import { resolveOwnerReviewRoute } from './owner-review-route';
import { hasPersonTimeline, personTimelineRoute, resolvePersonTimelineRoute } from './person-timeline-route';
import { eventComparisons, comparisonsForPerson } from './event-comparison-data';
import { eventComparisonRoute, resolveEventComparisonRoute } from './event-comparison-route';
import { readingNavigation, readingPageKey } from './reading-navigation-state';
import { captureReadingPosition } from './use-reading-position';
import { createNavigationDecision, createReadingTraversalGuard } from './reading-navigation-guard';
import type { TraversalAction } from './reading-navigation-guard';
import { ReadingShelfPanel } from './ReadingShelfPanel';
import { bookmarkRoute, inferReadingPerson, progressResumeRoute, normalizeReadingShelfRoute } from './reading-shelf';
import type { ReadingBookmark, ReadingProgress } from './reading-shelf';
import { clearReadingResume, hydrateReadingProgress, prepareReadingResume, prepareReadingBookmark } from './use-reading-progress';
import { rememberReadingContext, savedReadingContext } from './reading-shelf-context';

type Navigate = (route: Route) => void;
type OpenPerson = (person: HistoryPerson | undefined) => void;
type ModalState = { type: 'search'; query: string } | { type: 'person'; item: HistoryPerson };
const getRoute = (): Route => {
  const route = resolveRoute(location.hash);
  const reading = resolveReadingRoute(route);
  if (reading && route.split('?', 1)[0] === `read-${reading.book.id}`) {
    const query = route.includes('?') ? route.slice(route.indexOf('?')) : '';
    return `read-${reading.book.id}/${reading.chapter.id}${query}` as Route;
  }
  return route;
};
const PersonPassages = lazy(() => import('./PersonPassages').then(module => ({default:module.PersonPassages})));
const OwnerReview = lazy(() => import('./OwnerReview').then(module => ({ default: module.OwnerReview })));
const PersonTimeline = lazy(() => import('./PersonTimeline').then(module => ({ default: module.PersonTimeline })));
const EventComparison = lazy(() => import('./EventComparison').then(module => ({ default: module.EventComparison })));

function personInReadingRoute(route: Route): string | undefined {
  let current: Route | undefined = route;
  for (let depth = 0; current && depth < 8; depth++) {
    const person = resolvePersonSourcesRoute(current)?.person.id ?? resolvePersonTimelineRoute(current)?.person.id;
    if (person) return inferReadingPerson(route, person);
    current = resolveReadingRoute(current)?.returnTo ?? resolveEventComparisonRoute(current)?.returnTo;
  }
  return undefined;
}

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => {
    const firstControl = ref.current?.querySelector('input') ?? ref.current?.querySelector('button');
    firstControl?.focus();
  }, [title]);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-top"><span>{title}</span><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={24} weight="thin" /></button></div>{children}
  </dialog>;
}

function SearchPanel({ initialQuery, openItem }: { initialQuery: string; openItem: (item: SearchItem) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const results = filterSearch(query, 'person');
  return <div className="search-panel"><div className="search-field"><MagnifyingGlass size={24} weight="thin" /><input aria-label="搜索人物" placeholder="搜索姓名、别名或政权" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></div>
    <p className="result-count" aria-live="polite">{query.trim() ? `“${query.trim()}” · ${results.length} 位人物` : '从五代与十国人物开始探索'}</p>
    <div className="search-results">{results.map(item => <button className="result-row" key={item.id} onClick={() => openItem(item)}><span className="result-category">人物</span><span><strong>{item.name}</strong><small>{item.summary}</small></span><ArrowRight size={20} weight="thin" /></button>)}{results.length === 0 && <div className="empty-state"><UsersThree size={36} weight="thin" /><h3>暂时没有找到相关人物</h3><p>可以搜索姓名、别名或政权，如“李存孝”“朱全忠”“后唐”。</p><button className="text-link" onClick={() => setQuery('')}>浏览全部人物 <ArrowRight size={18} /></button></div>}</div>
  </div>;
}

function People({ openPerson, view, onViewChange, focusPersonId, onSelectPerson, onReadSource, onResume, onOpenBookmark }: {
  openPerson: OpenPerson;
  view: 'list' | 'graph';
  onViewChange: (view: 'list' | 'graph') => void;
  focusPersonId: string | undefined;
  onSelectPerson: (id: string) => void;
  onReadSource: (chapterId: string, paragraphId?: string) => void;
  onResume: (progress: ReadingProgress) => void;
  onOpenBookmark: (bookmark: ReadingBookmark) => void;
}) {
  const [query, setQuery] = useState('');
  const [dynasty, setDynasty] = useState('全部');
  const [groupId, setGroupId] = useState<PersonGroupId>('all');
  const topic = personTopic(groupId);
  const sharedEmperors = topic ? reigningEmperors.filter(person => topic.memberIds.includes(person.id)) : [];
  const groupedPeople = peopleForGroup(people, groupId);
  const availableDynasties = displayedDynasties.filter(value => groupedPeople.some(person => person.dynasty === value));
  const visible = groupedPeople.filter(person => (dynasty === '全部' || person.dynasty === dynasty) && matchesPersonSearch(query, [`${person.name} ${person.aliases} ${personSearchNames(person.id).join(' ')}`]));
  return <section className="page-shell">
    <div className="page-heading"><div><span className="eyebrow">人物索引 / PEOPLE</span><h1>从一个名字，进入一个时代。</h1></div><p>收录 {people.length} 位人物，包含五代 {reigningEmperors.length} 位在位皇帝、十国 {tenKingdomRulers.length} 位君主{historicalLeaders.length > 0 && `、${historicalLeaders.map(person => person.name).join('、')}等历史主将`}及{personTopics.map(item => item.title).join('、')}，沿本纪、列传与编年史追索历史线索。</p></div>
    <div className="people-view-switch" role="group" aria-label="人物浏览方式"><button aria-pressed={view === 'list'} onClick={() => onViewChange('list')}>人物名单</button><button aria-pressed={view === 'graph'} onClick={() => onViewChange('graph')}>关系图</button></div>
    <ReadingShelfPanel onResume={onResume} onOpenBookmark={onOpenBookmark} />
    {view === 'list' && <p className="small-note people-comparison-links"><span>史料对读：</span>{eventComparisons.map(document => <a className="text-link" key={document.id} href={`#${eventComparisonRoute(document.id)}`}>{document.title} <ArrowRight size={17} /></a>)}</p>}
    {view === 'graph' ? <PeopleRelationshipGraph people={people} selectedPersonId={focusPersonId} onSelectPerson={onSelectPerson} onOpenPerson={person => openPerson(person)} onReadSource={onReadSource} /> : <>
    <div className="person-group-filter" role="group" aria-label="按人物专题筛选">{personGroups.map(group => <button key={group.id} className={groupId === group.id ? 'active' : ''} aria-pressed={groupId === group.id} onClick={() => { setGroupId(group.id); setDynasty('全部'); }}>{group.label}</button>)}</div>
    {groupId === 'ten-kingdoms-rulers' && <div className="person-group-context"><h2>十国君主</h2><p>包含称帝、称王的实际统治者及闽末局部被拥立的争位者，具体身份见各条目；按所属政权分别整理，南平亦称荆南。在位年份表示统治时期，不是生卒年。</p></div>}
    {topic && <div className="person-group-context"><h2>{topic.title}</h2><p>{topic.description}</p><details><summary>称谓与史料依据</summary><p>{topic.sourceNote}</p><ul>{topic.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details></div>}
    <div className="people-tools"><div className="compact-search"><MagnifyingGlass size={20} weight="thin" /><input aria-label="查找人物" placeholder="姓名或别名，如李存孝、符存审" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="按政权筛选人物" value={dynasty} onChange={event => setDynasty(event.target.value)}>{['全部', ...availableDynasties].map(value => <option key={value} value={value}>{value === '全部' ? '全部政权' : value}</option>)}</select></div>
    <p className="small-note people-count" aria-live="polite">{visible.length} 位人物{sharedEmperors.length > 0 ? ` · ${sharedEmperors.map(person => person.name).join('、')}同时属于五代皇帝条目。` : ''} · 活动时期见人物条目。</p>
    <div className="people-list">{visible.map((person, index) => <button className="person-row" key={person.id} onClick={() => openPerson(person)}><span className="index-number">{String(index + 1).padStart(2, '0')}</span><span className="person-name"><strong>{person.name}</strong>{person.reign && <small>在位 {person.reign}</small>}{person.lifespan && <small>生卒 {person.lifespan}</small>}</span><span>{personDisplayPeriod(person)}</span><p>{person.role}</p><ArrowRight size={24} weight="thin" /></button>)}{visible.length === 0 && <div className="empty-state"><h3>没有匹配的人物</h3><p>可以更换姓名、专题或政权筛选条件。</p><button className="text-link" onClick={() => { setQuery(''); setDynasty('全部'); setGroupId('all'); }}>重置筛选 <ArrowRight size={18} /></button></div>}</div>
    </>}
  </section>;
}

function PersonDetails({ person, onViewRelationships, go, onResume, onOpenBookmark }: { person: HistoryPerson; onViewRelationships: (id: string) => void; go: Navigate; onResume: (progress: ReadingProgress) => void; onOpenBookmark: (bookmark: ReadingBookmark) => void }) {
  const relations = personTopicRelationships(person);
  const topics = topicsForPerson(person);
  const comparisons = comparisonsForPerson(person.id);
  return <div className="detail-panel">
    <span className="eyebrow">{personDisplayPeriod(person)} · {person.role}</span><h2>{person.name}</h2>
    {person.reign && <p className="person-reign">在位 {person.reign}</p>}
    {person.lifespan && <p className="person-lifespan">生卒 {person.lifespan}</p>}
    <p>{person.intro}</p>
    <ReadingShelfPanel compact personId={person.id} onResume={onResume} onOpenBookmark={onOpenBookmark} />
    {person.sovereignTitle && <p className="small-note">史载身份：{person.sovereignTitle}</p>}
    {person.statusNote && <p className="small-note">{person.statusNote}</p>}
    {!!person.sourceNotes?.length && <details className="person-references"><summary>称谓与史料差异</summary><ul>{person.sourceNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    {relations.map(relation => <p className="small-note" key={relation.groupId}>{relation.subject ? `与${relation.subject}的关系` : '史载关系'}：{relation.relation}</p>)}
    {person.aliases && <p className="small-note">相关称谓：{person.aliases}</p>}
    {topics.map(topic => <details className="person-references" key={topic.id}><summary>{topic.title} · 称谓说明</summary><p>{topic.sourceNote}</p><ul>{topic.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details>)}
    {person.sources && person.sources.length > 0 && <details className="person-references"><summary>条目来源</summary><ul>{person.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details>}
    <button className="text-link person-relationship-link" onClick={() => onViewRelationships(person.id)}>查看人物关系 <ArrowRight size={18} /></button>
    {hasPersonTimeline(person.id) && <button className="text-link person-timeline-link" onClick={() => go(personTimelineRoute(person.id))}>查看人物年表 <ArrowRight size={18} /></button>}
    {!!comparisons.length && <div className="person-comparison-links">{comparisons.map(document => <button className="text-link" key={document.id} onClick={() => go(eventComparisonRoute(document.id))}>{document.title} · 多史料对读 <ArrowRight size={18} /></button>)}</div>}
    <h3>相关原文与译文</h3><RelatedSources personId={person.id} go={go} />
    {!!personPassageBooks(person.id).length && <button className="text-link" onClick={() => go(personSourcesRoute(person.id))}>汇总全部文献记载 <ArrowRight size={18} /></button>}
  </div>;
}

function RelatedSources({ personId, go }: { personId: string | undefined; go: Navigate }) {
  const matches = personId ? personPassageBooks(personId) : [];
  return matches.length ? <div className="detail-links person-source-links">{books.map(book => {
    const summary = matches.find(item => item.bookId === book.id);
    return summary && personId ? <button key={book.id} onClick={() => go(personSourcesRoute(personId,book.id))}><span>{book.title}<small>{summary.chapterCount} 篇中的 {summary.passageCount} 处相关记载</small></span><ArrowRight size={18} /></button> : null;
  })}</div> : <p className="small-note">此人物的相关原文尚未收录。</p>;
}

export function App() {
  const readingPersonContext = useRef<string | undefined>(undefined);
  const personByEntry = useRef(new Map<string, string | undefined>());
  const [route, setRoute] = useState(() => {
    const initial = getRoute();
    const existing = readingNavigation.current();
    const previousEntry = history.state?.ancientHistoryReadingEntry;
    const entry = existing?.route === initial && previousEntry === existing.id ? existing : readingNavigation.activate(initial);
    const currentContext = savedReadingContext(entry.id, initial);
    readingPersonContext.current = currentContext ? currentContext.personId : personInReadingRoute(initial);
    // A fresh explicit link keeps its requested target. Only an existing browser
    // history entry can recover a matching persisted snapshot after a reload.
    if (!existing && typeof previousEntry === 'string' && normalizeReadingShelfRoute(initial)) {
      const context = savedReadingContext(previousEntry, initial);
      if (context) { readingPersonContext.current = context.personId; hydrateReadingProgress(initial, context.personId); }
      else if (readingPersonContext.current) hydrateReadingProgress(initial, readingPersonContext.current);
    }
    personByEntry.current.set(entry.id, readingPersonContext.current);
    rememberReadingContext(entry.id, initial, readingPersonContext.current);
    history.replaceState({ ...history.state, ancientHistoryReadingEntry: entry.id }, '', location.href);
    return initial;
  });
  const [, setNavigationActivation] = useState(0);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const approvedNavigation = useRef<{ fromEntryId: string; fromActivation: number; page: string; targetEntryId?: string } | null>(null);
  const traversalGuard = useRef(createReadingTraversalGuard()).current;
  const [peopleView, setPeopleView] = useState<'list' | 'graph'>('list');
  const [focusPersonId, setFocusPersonId] = useState<string>();
  const [readingFocusId, setReadingFocusId] = useState<string>();
  const [readingReturnRoute, setReadingReturnRoute] = useState<Route>();
  const [modal, setModal] = useState<ModalState | null>(null);
  function resumeTraversal(action: TraversalAction) {
    if (action.kind === 'none') return;
    const current = readingNavigation.current();
    if (!current) return;
    if (action.kind === 'bounce') { history.go(action.distance); return; }
    if (action.kind === 'fallback') {
      readingNavigation.retainCurrentOnly();
      history.pushState({ ancientHistoryReadingEntry: current.id }, '', `#${currentRoute.current}`);
      if (action.resumeRoute) resumeTraversal({ kind: 'push', route: action.resumeRoute });
      return;
    }
    const destination = resolveRoute(`#${action.route}`);
    if (action.kind === 'push' && getRoute() === destination) return;
    approvedNavigation.current = { fromEntryId: current.id, fromActivation: current.activation, page: readingPageKey(destination),
      ...(action.kind === 'traverse' && action.entryId ? { targetEntryId: action.entryId } : {}) };
    if (action.kind === 'traverse') history.go(action.distance);
    else location.hash = destination;
  }
  useEffect(() => {
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const listener = (nativeTraversal = false) => {
      const next = getRoute();
      const stateEntry = history.state?.ancientHistoryReadingEntry;
      const nextEntryId = typeof stateEntry === 'string' ? stateEntry : undefined;
      const arrived = traversalGuard.arrive(next, nextEntryId, readingNavigation.current(), readingNavigation.distanceToEntry(nextEntryId));
      if (arrived.handled) { resumeTraversal(arrived.action); return; }
      if (next === currentRoute.current && nextEntryId === readingNavigation.current()?.id) {
        if (location.hash !== `#${next}`) history.replaceState(history.state, '', `#${next}`);
        return;
      }
      const completeNavigation = (programmaticPush = false) => {
        captureReadingPosition();
        if (!programmaticPush) clearReadingResume();
        const entry = readingNavigation.activate(next, nextEntryId ?? (nativeTraversal && !programmaticPush ? 'untracked-history-entry' : undefined));
        readingPersonContext.current = personInReadingRoute(next) ?? (personByEntry.current.has(entry.id) ? personByEntry.current.get(entry.id) : programmaticPush ? inferReadingPerson(next, readingPersonContext.current) : undefined);
        personByEntry.current.set(entry.id, readingPersonContext.current);
        rememberReadingContext(entry.id, next, readingPersonContext.current);
        if (personByEntry.current.size > 64) personByEntry.current.delete(personByEntry.current.keys().next().value!);
        history.replaceState({ ...history.state, ancientHistoryReadingEntry: entry.id }, '', `#${next}`);
        currentRoute.current = next;
        setRoute(next);
        setNavigationActivation(entry.activation);
        window.scrollTo({ top: 0 });
      };
      const approved = approvedNavigation.current;
      approvedNavigation.current = null;
      const current = readingNavigation.current();
      if (approved && approved.fromEntryId === current?.id && approved.fromActivation === current.activation && approved.page === readingPageKey(next)
        && (!approved.targetEntryId || approved.targetEntryId === nextEntryId)) { completeNavigation(true); return; }
      traversalGuard.invalidate();
      let blocked: ReturnType<typeof traversalGuard.block> | undefined;
      const fromId = current?.id, fromActivation = current?.activation;
      const decision = createNavigationDecision({
        isCurrent: () => readingNavigation.current()?.id === fromId && readingNavigation.current()?.activation === fromActivation,
        onAllowed: () => completeNavigation(),
        onBlocked: () => { if (blocked) resumeTraversal(traversalGuard.requestContinuation(blocked, readingNavigation.current())); },
      });
      const event = new CustomEvent('ancient-history:before-navigation', { cancelable: true, detail: { continueNavigation: decision.request } });
      const allowed = window.dispatchEvent(event);
      if (!allowed && current) {
        captureReadingPosition();
        blocked = traversalGuard.block(current, next, nextEntryId, readingNavigation.distanceToEntry(nextEntryId));
        if (blocked.distance !== null) history.go(-blocked.distance);
        else {
          // Unknown/expired entries have no trustworthy traversal distance.
          // Preserve their URL, create a safe current-page entry, and revoke old
          // ancestor distances rather than overwrite the popped entry.
          readingNavigation.retainCurrentOnly();
          history.pushState({ ancientHistoryReadingEntry: current.id }, '', `#${currentRoute.current}`);
        }
      }
      decision.settle(allowed);
    };
    listener();
    const hashListener = () => listener();
    const popListener = () => listener(true);
    window.addEventListener('hashchange', hashListener);
    window.addEventListener('popstate', popListener);
    return () => { window.removeEventListener('hashchange', hashListener); window.removeEventListener('popstate', popListener); history.scrollRestoration = previousScrollRestoration; };
  }, []);
  const reading = resolveReadingRoute(route);
  const personSources = resolvePersonSourcesRoute(route);
  const ownerReview = resolveOwnerReviewRoute(route);
  const timeline = resolvePersonTimelineRoute(route);
  const comparison = resolveEventComparisonRoute(route);
  const title = ownerReview ? '校核清单' : comparison ? `${comparison.document.title} · 史料对读` : timeline ? `${timeline.person.name} · 人物年表` : personSources ? `${personSources.person.name} · ${personSources.book?.title ?? '文献记载'}` : reading ? `${reading.book.title} · ${reading.chapter.title}` : peopleView === 'graph' ? '人物关系' : '人物索引';
  useEffect(() => { document.title = `${title} · 中国古代史`; }, [title]);
  function go(view: Route, paragraphId?: string, resume?: { progress?: ReadingProgress; bookmark?: ReadingBookmark; personId?: string }) {
    const restoring = !!(resume?.progress || resume?.bookmark);
    if (traversalGuard.isBouncing()) { traversalGuard.invalidate(); return; }
    traversalGuard.invalidate();
    const current = currentRoute.current;
    const expectedReturn = resolveReadingRoute(current)?.returnTo ?? resolvePersonTimelineRoute(current)?.returnTo ?? resolveEventComparisonRoute(current)?.returnTo;
    const distance = restoring ? null : readingNavigation.returnDistance(view, expectedReturn);
    const fromEntryId = readingNavigation.current()?.id;
    const fromActivation = readingNavigation.current()?.activation;
    let performed = false;
    const perform = (action: () => void) => {
      const continueNavigation = () => {
        if (performed || readingNavigation.current()?.id !== fromEntryId || readingNavigation.current()?.activation !== fromActivation) return;
        performed = true;
        setModal(null); setReadingFocusId(paragraphId);
        const context = resume ? resume.personId : modal?.type === 'person' ? modal.item.id : readingPersonContext.current;
        readingPersonContext.current = personInReadingRoute(view) ?? inferReadingPerson(view, context);
        if (restoring) setReadingReturnRoute(undefined);
        if (resume?.progress) prepareReadingResume(resume.progress);
        else if (resume?.bookmark) prepareReadingBookmark(resume.bookmark);
        else clearReadingResume();
        approvedNavigation.current = fromEntryId && fromActivation !== undefined ? { fromEntryId, fromActivation, page: readingPageKey(view) } : null;
        action();
      };
      const event = new CustomEvent('ancient-history:before-navigation', { cancelable: true, detail: { continueNavigation } });
      if (window.dispatchEvent(event)) continueNavigation();
    };
    if (distance !== null) { perform(() => { captureReadingPosition(); history.go(distance); }); return; }
    if (getRoute() === view) {
      perform(() => {
        captureReadingPosition();
        const entry = readingNavigation.activate(view, readingNavigation.current()?.id);
        if (!restoring) readingNavigation.hydrateCurrent(view, { view: entry.view });
        personByEntry.current.set(entry.id, readingPersonContext.current);
        rememberReadingContext(entry.id, view, readingPersonContext.current);
        history.replaceState({ ...history.state, ancientHistoryReadingEntry: entry.id }, '', `#${view}`);
        approvedNavigation.current = null;
        setNavigationActivation(entry.activation);
        if (!restoring) window.scrollTo({ top: 0 });
      });
    } else perform(() => { location.hash = view; });
  }
  function resumeReading(progress: ReadingProgress) { go(progressResumeRoute(progress), undefined, { progress, personId: progress.personId }); }
  function openSavedBookmark(bookmark: ReadingBookmark) { go(bookmarkRoute(bookmark), undefined, { bookmark, personId: bookmark.personId }); }
  const openPerson: OpenPerson = person => { if (person) setModal({ type: 'person', item: person }); };
  function viewRelationships(id: string) { setFocusPersonId(id); setPeopleView('graph'); go('people'); }
  function readRelationshipSource(chapterId: string, paragraphId?: string, context?: ReadingSearchContext) {
    const chapter = libraryChapters.find(item => item.id === chapterId);
    if (chapter) {
      const personId = personInReadingRoute(context?.returnTo ?? currentRoute.current) ?? (modal?.type === 'person' ? modal.item.id : currentRoute.current === 'people' && peopleView === 'graph' ? focusPersonId : readingPersonContext.current);
      setReadingReturnRoute(resolvePersonSourcesRoute(currentRoute.current) || resolvePersonTimelineRoute(currentRoute.current) || resolveEventComparisonRoute(currentRoute.current) ? currentRoute.current : undefined);
      go(chapterRoute(chapter, context ? { ...context, paragraphId } : undefined), paragraphId?.startsWith(`${chapterId}-p`) ? paragraphId : undefined, { personId });
    }
  }
  return <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView(); }}>跳转到内容</a>
    <header className="site-header people-header"><a className="brand" href="#people"><img src="/images/history-seal-ancient.png" alt="" /><strong>中国古代史</strong></a><nav className="main-nav" aria-label="主导航"><a className="active" aria-current="page" href="#people">人物</a></nav><div className="header-actions"><ThemeSwitcher /><button className="header-search" aria-label="搜索人物" onClick={() => setModal({ type: 'search', query: '' })}><MagnifyingGlass size={26} weight="thin" /><span>搜索</span></button></div></header>
    <main id="main-content" tabIndex={-1}>{route === 'people' && <People openPerson={openPerson} view={peopleView} onViewChange={setPeopleView} focusPersonId={focusPersonId} onSelectPerson={setFocusPersonId} onReadSource={readRelationshipSource} onResume={resumeReading} onOpenBookmark={openSavedBookmark} />}{ownerReview && <Suspense fallback={<p className="page-shell" role="status">正在打开所有者入口…</p>}><OwnerReview filters={ownerReview} go={go} /></Suspense>}{timeline && <Suspense fallback={<p className="page-shell" role="status">正在打开人物年表…</p>}><PersonTimeline key={timeline.person.id} route={route} returnTo={timeline.returnTo} person={timeline.person} eventId={timeline.eventId} go={go} onReadSource={readRelationshipSource} /></Suspense>}{comparison && <Suspense fallback={<p className="page-shell" role="status">正在打开史料对读…</p>}><EventComparison key={comparison.document.id} personId={readingPersonContext.current} route={route} returnTo={comparison.returnTo} document={comparison.document} stageId={comparison.stageId} go={go} onReadSource={readRelationshipSource} /></Suspense>}{personSources && <Suspense fallback={<p className="page-shell" role="status">正在打开人物记载…</p>}><PersonPassages key={personSources.person.id} route={route} person={personSources.person} book={personSources.book} search={personSources.search} go={go} onReadSource={readRelationshipSource} /></Suspense>}{reading && <Reader key={reading.chapter.id} personId={readingPersonContext.current} route={route} book={reading.book} entry={reading.chapter} go={go} search={reading.search} focusParagraphId={reading.focusParagraphId ?? readingFocusId} returnTo={reading.returnTo ?? readingReturnRoute} />}</main>
    {modal && <Dialog title={modal.type === 'search' ? '查找人物' : '人物条目'} onClose={() => setModal(null)} wide={modal.type === 'search'}>{modal.type === 'search' ? <SearchPanel initialQuery={modal.query} openItem={openPerson} /> : <PersonDetails person={modal.item} onViewRelationships={viewRelationships} go={go} onResume={resumeReading} onOpenBookmark={openSavedBookmark} />}</Dialog>}
  </>;
}
