import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { MagnifyingGlass, ArrowRight, ArrowLeft, X, List, BookOpen, UsersThree } from '@phosphor-icons/react';
import { displayedDynasties, events, people, books, filterSearch } from './data';
import { chapterRoute, chaptersForPerson, resolveReadingRoute, resolveRoute } from './library';
import { Sources } from './Sources';
import { Reader } from './Reader';
import { BookCover } from './BookCover';
import { CollapsibleSidebar, useSidebarState } from './CollapsibleSidebar';
import { ThemeSwitcher } from './ThemeSwitcher';
import type { CSSProperties, ReactNode } from 'react';
import type { HistoryEvent, HistoryPerson, Route, SearchFilter, SearchItem } from './types';

type Navigate = (route: Route) => void;
type OpenPerson = (person: HistoryPerson | undefined) => void;
type OpenEvent = (event: HistoryEvent | undefined) => void;
type ModalState =
  | { type: 'search'; query: string }
  | { type: 'event'; item: HistoryEvent }
  | { type: 'person'; item: HistoryPerson };

const searchFilters: [SearchFilter, string][] = [['all', '全部'], ['event', '事件'], ['person', '人物'], ['book', '史料']];
const navigation: [Route, string][] = [['timeline', '时序'], ['sources', '史料'], ['people', '人物'], ['map', '地图']];
const dynastyStyle = (color: string): CSSProperties & { '--dynasty-color': string } => ({ '--dynasty-color': color });

const MapView = lazy(() => import('./MapView').then(module => ({ default: module.MapView })));
const getRoute = (): Route => resolveRoute(location.hash);

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
  const [type, setType] = useState<SearchFilter>('all');
  const results = filterSearch(query, type);
  return <div className="search-panel"><div className="search-field"><MagnifyingGlass size={24} weight="thin" /><input aria-label="搜索人物、事件或史料" placeholder="搜索人物、事件或史料" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></div>
    <div className="filter-tabs" role="group" aria-label="搜索类型">{searchFilters.map(([id, label]) => <button className={type === id ? 'active' : ''} key={id} aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>)}</div>
    <p className="result-count" aria-live="polite">{query.trim() ? `“${query.trim()}” · ${results.length} 条结果` : '从当前五代条目开始探索'}</p>
    <div className="search-results">{results.map(item => <button className="result-row" key={`${item.type}-${item.id}`} onClick={() => openItem(item)}><span className="result-category">{item.category}</span><span><strong>{item.name}</strong><small>{item.summary}</small></span><ArrowRight size={20} weight="thin" /></button>)}{results.length === 0 && <div className="empty-state"><BookOpen size={36} weight="thin" /><h3>暂时没有找到相关条目</h3><p>试试“朱温”“后唐”或“五代史”。当前内容范围为五代时期。</p><button className="text-link" onClick={() => { setQuery(''); setType('all'); }}>浏览全部条目 <ArrowRight size={18} /></button></div>}</div>
  </div>;
}

function DynastyRibbon({ go }: { go: Navigate }) {
  return <section className="era-ribbon" aria-label="五代政权更迭"><h2>五代时期</h2><ol className="era-list">{events.map(event => <li className="era-item" key={event.id}><span>{event.dynasty}</span><small>{event.year}—{event.end}</small><i aria-hidden="true" /></li>)}</ol><button className="text-link era-link" onClick={() => go('timeline')}>查看年表 <ArrowRight size={18} weight="thin" /></button></section>;
}

function Home({ go, search }: { go: Navigate; search: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const sidebar = useSidebarState('home-sources');
  return <><section className="hero"><img className="hero-art" src="/images/hero-landscape.webp" alt="青绿水墨山水，远山、江岸与一叶小舟" fetchPriority="high" /><div className="hero-copy"><h1>在时间深处，<br />读懂中国。</h1><p>从史料出发，连接人物、事件与时代。</p><form className="hero-search" onSubmit={event => { event.preventDefault(); search(query); }}><MagnifyingGlass size={25} weight="thin" /><input aria-label="首页搜索" placeholder="搜索人物、事件或史料" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit">检索</button></form></div><p className="hero-caption">第一期 · 五代 907—960</p></section>
    <DynastyRibbon go={go} />
    <section className={`home-content ${sidebar.collapsed ? 'right-collapsed' : ''}`}><div className="feature-area"><div className="section-heading"><h2>从五代开始</h2><p>重返历史现场，理解一个多变而真实的时代。</p></div><div className="feature-story"><button className="story-image-button" onClick={() => go('timeline')} aria-label="进入五代更迭专题"><img src="/images/river-story.webp" alt="古代江岸、舟船与楼阁的山水画风插图" /></button><div className="feature-copy"><h3>五代更迭：从后梁到后周</h3><span className="date-label">907 — 960</span><p>五代是唐宋之间承前启后的关键时期。中原政权更迭频仍，格局纷纭，而社会、经济与文化也在动荡中持续演进。从人物、事件与史料出发，接近这一时期复杂而生动的历史面貌。</p><button className="text-link" onClick={() => go('timeline')}>进入五代专题 <ArrowRight size={21} weight="thin" /></button></div></div></div><CollapsibleSidebar id="home-sources" title="史料入口" side="right" className="source-area" collapsed={sidebar.collapsed} onToggle={sidebar.toggle}><div className="section-heading"><button className="text-link small" onClick={() => go('sources')}>进入史料库 <ArrowRight size={18} weight="thin" /></button></div><div className="book-list">{books.slice(0, 2).map(book => <button className="book-row" key={book.id} onClick={() => go(`read-${book.id}`)}><BookCover book={book} compact /><span><strong>{book.title}</strong><small>{book.author}</small><span className="book-description">{book.description}</span></span></button>)}</div></CollapsibleSidebar></section>
    <section className="home-next"><div><span className="eyebrow">由人物进入时代</span><h2>历史的线索，藏在人与人的相遇中。</h2></div><button className="text-link" onClick={() => go('people')}>浏览人物索引 <ArrowRight size={20} weight="thin" /></button></section>
  </>;
}

function Timeline({ openEvent, openPerson, go }: { openEvent: OpenEvent; openPerson: OpenPerson; go: Navigate }) {
  const [selected, setSelected] = useState(0);
  const item = events[selected] ?? events[0];
  return <section className="page-shell"><div className="page-heading"><div><span className="eyebrow">第一期 / 五代 907—960</span><h1>五代，五次政权更迭。</h1></div><p>沿着时间，从后梁到后周，追索五代的历史线索。</p></div>
    <div className="dynasty-timeline" role="group" aria-label="选择历史节点">{events.map((event, index) => <button className={selected === index ? 'active' : ''} key={event.id} onClick={() => setSelected(index)} aria-pressed={selected === index} style={dynastyStyle(event.color)}><strong>{event.dynasty}</strong><span className="dynasty-line" /><span>{event.year}</span></button>)}</div>
    <div className="timeline-story"><div className="timeline-art"><img src="/images/river-story.webp" alt="舟船与江岸山水插图" /><span>时代在更迭，历史在延续。</span></div><article><span className="eyebrow">公元 {item.year} 年</span><h2>{item.title}</h2><p className="lead">{item.description}</p><p>{item.context}</p><div className="related-inline"><button onClick={() => openPerson(people.find(person => person.name === item.person))}><UsersThree size={19} weight="thin" />关联人物 · {item.person}</button><button onClick={() => go('sources')}><BookOpen size={19} weight="thin" />查看相关史料</button></div><button className="text-link" onClick={() => openEvent(item)}>查看事件条目 <ArrowRight size={20} weight="thin" /></button></article></div>
    <div className="timeline-controls"><button className="quiet-button" disabled={selected === 0} onClick={() => setSelected(index => index - 1)}><ArrowLeft size={18} />上一事件</button><span>{item.year} 年 · {item.dynasty}</span><button className="quiet-button" disabled={selected === events.length - 1} onClick={() => setSelected(index => index + 1)}>下一事件<ArrowRight size={18} /></button></div>
    <p className="small-note">本年表展示五代中原五个王朝的建立节点。点击政权，可查看关联人物与史料。</p>
  </section>;
}

function People({ openPerson }: { openPerson: OpenPerson }) {
  const [query, setQuery] = useState('');
  const [dynasty, setDynasty] = useState('全部');
  const visible = people.filter(person => (dynasty === '全部' || person.dynasty === dynasty) && `${person.name} ${person.aliases}`.includes(query.trim()));
  return <section className="page-shell"><div className="page-heading"><div><span className="eyebrow">人物索引 / PEOPLE</span><h1>从一个名字，进入一个时代。</h1></div><p>从五代政权更迭相关人物开始，追索其历史线索。</p></div><div className="people-tools"><div className="compact-search"><MagnifyingGlass size={20} weight="thin" /><input aria-label="查找人物" placeholder="姓名或别名，如朱温、朱全忠" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="按政权筛选人物" value={dynasty} onChange={event => setDynasty(event.target.value)}>{['全部', ...displayedDynasties].map(value => <option key={value} value={value}>{value === '全部' ? '全部政权' : value}</option>)}</select></div><div className="people-list">{visible.map((person, index) => <button className="person-row" key={person.id} onClick={() => openPerson(person)}><span className="index-number">{String(index + 1).padStart(2, '0')}</span><strong>{person.name}</strong><span>{person.dynasty}</span><p>{person.role}</p><ArrowRight size={24} weight="thin" /></button>)}{visible.length === 0 && <div className="empty-state"><h3>没有匹配的人物</h3><p>可以更换姓名或政权筛选条件。</p><button className="text-link" onClick={() => { setQuery(''); setDynasty('全部'); }}>重置筛选 <ArrowRight size={18} /></button></div>}</div></section>;
}

function RelatedSources({ personId, go }: { personId: string | undefined; go: Navigate }) {
  const matches = personId ? chaptersForPerson(personId) : [];
  return matches.length ? <div className="detail-links person-source-links">{books.map(book => {
    const chapters = matches.filter(chapter => chapter.bookId === book.id);
    const first = chapters[0];
    return first ? <button key={book.id} onClick={() => go(chapterRoute(first))}><span>{book.title}<small>{first.title} · 共 {chapters.length} 卷</small></span><ArrowRight size={18} /></button> : null;
  })}</div> : <p className="small-note">当前文库聚焦五位开国皇帝，此人物的相关原文尚未收录。</p>;
}

export function App() {
  const [route, setRoute] = useState(getRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  useEffect(() => { const listener = () => { setRoute(getRoute()); window.scrollTo({ top: 0 }); }; window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  const reading = resolveReadingRoute(route);
  const pageTitles: Partial<Record<Route, string>> = { overview: '在时间深处，读懂中国', timeline: '五代年表', sources: '史料库', people: '人物索引', map: '历史地点' };
  const title = reading ? `${reading.book.title} · ${reading.chapter.title}` : pageTitles[route] ?? '中国古代史';
  useEffect(() => { document.title = `${title} · 中国古代史`; }, [title]);
  function go(view: Route) { setMenuOpen(false); setModal(null); if (getRoute() === view) window.scrollTo({ top: 0 }); else location.hash = view; }
  const search = (query: string) => setModal({ type: 'search', query });
  const openEvent: OpenEvent = item => { if (item) setModal({ type: 'event', item }); };
  const openPerson: OpenPerson = item => { if (item) setModal({ type: 'person', item }); };
  function openItem(item: SearchItem) { if (item.type === 'book') go(`read-${item.id}`); else if (item.type === 'chapter') go(chapterRoute(item)); else if (item.type === 'person') openPerson(item); else openEvent(item); }
  const active = route.startsWith('read-') ? 'sources' : route;
  return <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView(); }}>跳转到内容</a><header className="site-header"><a className="brand" href="#overview" onClick={() => setMenuOpen(false)}><img src="/images/history-seal-ancient.png" alt="" /><strong>中国古代史</strong></a><nav className={menuOpen ? 'main-nav menu-open' : 'main-nav'} aria-label="主导航">{navigation.map(([id, text]) => <a className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} href={`#${id}`} key={id} onClick={() => setMenuOpen(false)}>{text}</a>)}</nav><div className="header-actions"><ThemeSwitcher /><button className="header-search" aria-label="打开全站搜索" onClick={() => search('')}><MagnifyingGlass size={26} weight="thin" /><span>搜索</span></button><button className="icon-button menu-button" aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={25} /> : <List size={25} />}</button></div></header>
    <main id="main-content" tabIndex={-1}>{route === 'overview' && <Home go={go} search={search} />}{route === 'timeline' && <Timeline go={go} openEvent={openEvent} openPerson={openPerson} />}{route === 'sources' && <Sources go={go} />}{route === 'people' && <People openPerson={openPerson} />}{route === 'map' && <Suspense fallback={<div className="page-shell"><p role="status">正在打开地点地图…</p></div>}><MapView /></Suspense>}{reading && <Reader key={reading.chapter.id} book={reading.book} entry={reading.chapter} go={go} />}</main>
    {modal && <Dialog title={{ search: '检索历史', event: '事件条目', person: '人物条目' }[modal.type]} onClose={() => setModal(null)} wide={modal.type === 'search'}>{modal.type === 'search' && <SearchPanel initialQuery={modal.query} openItem={openItem} />}{modal.type === 'event' && <div className="detail-panel"><span className="eyebrow">{modal.item.year} 年 · {modal.item.dynasty}</span><h2>{modal.item.title}</h2><p className="lead">{modal.item.description}</p><p>{modal.item.context}</p><h3>关联人物</h3><button className="text-link" onClick={() => openPerson(people.find(person => person.name === modal.item.person))}>{modal.item.person}<ArrowRight size={18} /></button><h3>沿史料继续阅读</h3><RelatedSources personId={people.find(person => person.name === modal.item.person)?.id} go={go} /></div>}{modal.type === 'person' && <div className="detail-panel"><span className="eyebrow">{modal.item.dynasty} · {modal.item.role}</span><h2>{modal.item.name}</h2><p>{modal.item.intro}</p><p className="small-note">相关称谓：{modal.item.aliases}</p><h3>关联事件</h3><button className="text-link" onClick={() => openEvent(events.find(event => event.id === modal.item.event))}>{events.find(event => event.id === modal.item.event)?.title}<ArrowRight size={18} /></button><h3>史料入口</h3><RelatedSources personId={modal.item.id} go={go} /></div>}</Dialog>}
  </>;
}
