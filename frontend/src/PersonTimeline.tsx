import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { historyApiBase } from './history-api';
import { readPersonTimeline } from './person-timeline-loader';
import { personTimelineRoute } from './person-timeline-route';
import { personSourcesRoute } from './library';
import { CollapsibleSidebar, useSidebarState } from './CollapsibleSidebar';
import { useOriginalScript } from './use-original-script';
import { personDisplayPeriod } from './person-catalog';
import type { ReadingSearchContext } from './library';
import type { HistoryPerson, Route } from './types';
import type { PersonTimelineEvent, PersonTimelineResponse, ResolvedTimelineEvidence, TimelinePhase } from './person-timeline-schema';
import './person-timeline.css';

type TimelineEvent = PersonTimelineEvent<ResolvedTimelineEvidence>;
type ReadState = 'loading' | 'archive-pending' | 'archive' | 'ready' | 'error';
const phaseLabels: Record<TimelinePhase, string> = {
  early: '早年与家世', campaigns: '平乱与河东', rivalry: '与诸镇角逐', late: '晋王晚年',
  posthumous: '身后记载', jin: '晋王时期', conquest: '争衡与灭梁', imperial: '后唐时期', fall: '变乱与身故',
};
const precisionLabels = { year: '原书记年', month: '原书记月', day: '原书记日' };

function groupEvents(events: TimelineEvent[]) {
  const phases: { id: string; phase: TimelinePhase; years: { year: number; events: TimelineEvent[] }[] }[] = [];
  for (const event of events) {
    let phase = phases.at(-1);
    if (!phase || phase.phase !== event.phase) {
      phase = { id: `${event.phase}-${event.id}`, phase: event.phase, years: [] };
      phases.push(phase);
    }
    let year = phase.years.at(-1);
    if (!year || year.year !== event.year) { year = { year: event.year, events: [] }; phase.years.push(year); }
    year.events.push(event);
  }
  return phases;
}

function EvidenceList({ evidence, displayOriginal, onRead }: {
  evidence: ResolvedTimelineEvidence[];
  displayOriginal: (original: string) => string;
  onRead: (evidence: ResolvedTimelineEvidence) => void;
}) {
  const sources = new Map<string, { source: ResolvedTimelineEvidence; excerpts: string[] }>();
  for (const source of evidence) {
    const key = `${source.chapterId}/${source.paragraphId}`, existing = sources.get(key);
    if (existing) existing.excerpts.push(source.excerpt);
    else sources.set(key, { source, excerpts: [source.excerpt] });
  }
  return <ul className="timeline-evidence-list">{[...sources.values()].map(({ source, excerpts }) => <li key={source.paragraphId}>
    <div className="timeline-evidence-caption"><strong>{source.bookTitle} · {source.chapterTitle}</strong><span>原篇第 {source.paragraph.position} 段</span><button type="button" onClick={() => onRead(source)}>阅读原文与译文</button></div>
    <details><summary>查看原文依据{excerpts.length > 1 && `（${excerpts.length} 处）`}</summary>{excerpts.map((excerpt, index) => <blockquote key={index}>{displayOriginal(excerpt)}</blockquote>)}</details>
  </li>)}</ul>;
}

export function PersonTimeline({ person, eventId, go, onReadSource }: {
  person: HistoryPerson;
  eventId?: string;
  go: (route: Route) => void;
  onReadSource: (chapterId: string, paragraphId?: string, context?: ReadingSearchContext) => void;
}) {
  const [page, setPage] = useState<PersonTimelineResponse | null>(null);
  const [readState, setReadState] = useState<ReadState>('loading');
  const [retry, setRetry] = useState(0);
  const yearSidebar = useSidebarState('timeline-years');
  const script = useOriginalScript();
  const focused = useRef('');
  const groups = useMemo(() => groupEvents(page?.events ?? []), [page?.events]);
  const years = useMemo(() => {
    const list: { year: number; firstEventId: string; count: number }[] = [];
    for (const event of page?.events ?? []) {
      const previous = list.at(-1);
      if (previous?.year === event.year) previous.count++;
      else list.push({ year: event.year, firstEventId: event.id, count: 1 });
    }
    return list;
  }, [page?.events]);
  const selectedYear = page?.events.find(event => event.id === eventId)?.year;
  const displayOriginal = (original: string) => script.displayScript === 'simplified' && script.converter ? script.converter(original) : original;

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setReadState('loading'); focused.current = '';
    readPersonTimeline({ personId: person.id, apiBase: historyApiBase, archiveBase: import.meta.env.BASE_URL, signal: controller.signal,
      onArchive: value => { if (!controller.signal.aborted) { setPage(value); setReadState('archive-pending'); } },
    }).then(result => {
      if (!controller.signal.aborted) { setPage(result.page); setReadState(result.source === 'api' ? 'ready' : 'archive'); }
    }).catch(() => {
      if (!controller.signal.aborted) { setPage(null); setReadState('error'); }
    });
    return () => controller.abort();
  }, [person.id, retry]);

  useEffect(() => {
    if (!page || !eventId || !page.events.some(event => event.id === eventId)) return;
    const key = `${person.id}/${eventId}/${page.resultSetRevision}`;
    if (focused.current === key) return;
    const element = document.getElementById(`timeline-event-${eventId}`);
    if (!element) return;
    focused.current = key;
    element.scrollIntoView({ block: 'start' });
    element.querySelector<HTMLHeadingElement>('h4')?.focus({ preventScroll: true });
  }, [page, eventId, person.id]);

  function readEvidence(event: TimelineEvent, evidence: ResolvedTimelineEvidence) {
    onReadSource(evidence.chapterId, evidence.paragraphId, { query: '', field: 'both', returnTo: personTimelineRoute(person.id, event.id) });
  }

  function selectEvent(id: string) {
    if (id !== eventId) { go(personTimelineRoute(person.id, id)); return; }
    const element = document.getElementById(`timeline-event-${id}`);
    element?.scrollIntoView({ block: 'start' });
    element?.querySelector<HTMLHeadingElement>('h4')?.focus({ preventScroll: true });
  }

  return <section className="person-timeline" data-person-id={person.id} data-read-state={readState}>
    <div className="timeline-breadcrumbs"><button type="button" onClick={() => go('people')}><ArrowLeft size={14} /> 人物</button><span>/</span><span>{person.name}年表</span></div>
    <header className="person-timeline-heading"><div><h1>{person.name}<span>人物年表</span></h1><p className="timeline-person-period">{personDisplayPeriod(person)} · {person.role}{person.lifespan && ` · 生卒 ${person.lifespan}`}</p></div><p>按年份串联当前归档中的重要记载。史载年号与日期保留在事件下方，不同史书的异说分别列出；每条出处均可定位到原文与白话译文。</p></header>
    <div className="timeline-actions"><button className="text-link" type="button" onClick={() => go(personSourcesRoute(person.id))}>汇总全部文献记载 <ArrowRight size={17} /></button><div className="timeline-script-switch"><span>原文依据</span><div className="script-switch" role="group" aria-label="年表原文繁简切换">{(['traditional', 'simplified'] as const).map(value => <button key={value} type="button" aria-pressed={script.script === value} onClick={() => script.selectScript(value)}>{value === 'traditional' ? '繁体' : '简体'}</button>)}</div></div></div>
    <div className="timeline-read-status" role="status">
      {readState === 'loading' && '正在打开人物年表…'}
      {readState === 'archive-pending' && '已打开随站年表，正在核对当前记载…'}
      {readState === 'archive' && '当前显示随站保存的年表与出处。'}
      {readState === 'error' && <><span>当前年表暂时无法核验。</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></>}
      {!!page?.unavailableCount && <p>{page.unavailableCount} 条事件的来源已变化，暂不展示。</p>}
      {eventId && page && !page.events.some(event => event.id === eventId) && <p>所定位的事件当前未展示，可以查看其他记载。</p>}
      {script.pending && <p>正在准备简体原文…</p>}
      {script.error && <p>简体转换暂不可用，当前显示繁体原文。<button type="button" onClick={script.retry}>重试转换</button></p>}
    </div>
    {!!page?.events.length && <div className={`timeline-layout ${yearSidebar.collapsed ? 'left-collapsed' : ''}`}>
      <CollapsibleSidebar id="timeline-years" title="年度定位" side="left" className="timeline-year-directory" collapsed={yearSidebar.collapsed} onToggle={yearSidebar.toggle}>
        <p>{page.events.length} 条事件，分布于 {years.length} 个年份</p><nav aria-label="人物年表年份">{years.map(year => <button type="button" key={year.year} aria-current={selectedYear === year.year ? 'location' : undefined} onClick={() => selectEvent(year.firstEventId)}><span>{year.year} 年</span><small>{year.count} 条记载</small></button>)}</nav>
      </CollapsibleSidebar>
      <div className="timeline-main">{groups.map(phase => <section className="timeline-phase" key={phase.id} aria-labelledby={`phase-${phase.id}`}><h2 id={`phase-${phase.id}`}>{phaseLabels[phase.phase]}</h2>{phase.years.map(year => <div className="timeline-year-group" key={year.year}><h3 aria-label={`公元 ${year.year} 年`}>{year.year}<small aria-hidden="true">公元</small></h3><div className="timeline-year-events">{year.events.map(event => <article className="person-timeline-event" id={`timeline-event-${event.id}`} key={event.id} data-focused={eventId === event.id}>
        <h4 tabIndex={-1}>{event.title}</h4><p className="timeline-source-date">{precisionLabels[event.precision]}：{displayOriginal(event.sourceDate)}</p><p className="timeline-event-summary">{event.summary}</p>
        {event.notes?.map((note, index) => <p className="timeline-date-note" key={index}>{note}</p>)}
        <EvidenceList evidence={event.evidence} displayOriginal={displayOriginal} onRead={source => readEvidence(event, source)} />
        {!!event.variants?.length && <details className="timeline-source-variants"><summary>史书差异 · {event.variants.length} 处</summary>{event.variants.map((variant, index) => <div className="timeline-variant" key={index}><h5>{variant.label}</h5><p>{variant.year !== undefined && `另记公元 ${variant.year} 年；`}原书日期：{displayOriginal(variant.sourceDate)}</p>{variant.summary && <p>{variant.summary}</p>}{variant.notes?.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}<EvidenceList evidence={variant.evidence} displayOriginal={displayOriginal} onRead={source => readEvidence(event, source)} /></div>)}</details>}
      </article>)}</div></div>)}</section>)}</div>
    </div>}
    {page?.events.length === 0 && <div className="timeline-empty"><h2>当前暂无可展示的事件</h2><p>可以继续查阅人物的原文与译文记载。</p><button className="text-link" type="button" onClick={() => go(personSourcesRoute(person.id))}>查看文献记载 <ArrowRight size={17} /></button></div>}
  </section>;
}
