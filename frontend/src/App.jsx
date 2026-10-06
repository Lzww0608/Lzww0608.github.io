import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { MagnifyingGlass, ArrowRight, ArrowLeft, X, List, BookOpen, ArrowUpRight, UsersThree } from '@phosphor-icons/react';
import { eras, events, people, books, filterSearch } from './data';
import { loadChapter, historyApiConfigured } from './history-api';

const MapView = lazy(() => import('./MapView').then(module => ({ default: module.MapView })));
const routes = ['overview', 'timeline', 'sources', 'people', 'map', 'read-old', 'read-new'];
const getRoute = () => routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const External = ({ href, children, ...props }) => <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;

function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; previous?.focus(); };
  }, []);
  useEffect(() => {
    const firstControl = ref.current?.querySelector('input') ?? ref.current?.querySelector('button');
    firstControl?.focus();
  }, [title]);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-top"><span>{title}</span><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={24} weight="thin" /></button></div>{children}
  </dialog>;
}

function SearchPanel({ initialQuery, openItem }) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState('all');
  const results = filterSearch(query, type);
  return <div className="search-panel"><div className="search-field"><MagnifyingGlass size={24} weight="thin" /><input aria-label="搜索人物、事件或史料" placeholder="搜索人物、事件或史料" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></div>
    <div className="filter-tabs" role="group" aria-label="搜索类型">{[['all', '全部'], ['event', '事件'], ['person', '人物'], ['book', '史料']].map(([id, label]) => <button className={type === id ? 'active' : ''} key={id} aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>)}</div>
    <p className="result-count" aria-live="polite">{query.trim() ? `“${query.trim()}” · ${results.length} 条结果` : '从当前五代条目开始探索'}</p>
    <div className="search-results">{results.map(item => <button className="result-row" key={`${item.type}-${item.id}`} onClick={() => openItem(item)}><span className="result-category">{item.category}</span><span><strong>{item.name}</strong><small>{item.summary}</small></span><ArrowRight size={20} weight="thin" /></button>)}{results.length === 0 && <div className="empty-state"><BookOpen size={36} weight="thin" /><h3>暂时没有找到相关条目</h3><p>试试“朱温”“后唐”或“五代史”。当前内容范围为五代时期。</p><button className="text-link" onClick={() => { setQuery(''); setType('all'); }}>浏览全部条目 <ArrowRight size={18} /></button></div>}</div>
  </div>;
}

function EraRibbon({ go, showEra }) {
  return <section className="era-ribbon" aria-label="中国历史时期"><h2>中国历史长卷</h2><div className="era-list">{eras.map(era => <button key={era} onClick={() => era === '五代' ? go('timeline') : showEra(era)} className={era === '五代' ? 'current-era' : ''}><span>{era}</span><i aria-hidden="true" /></button>)}</div><p>其他时期逐步整理</p></section>;
}

function Home({ go, search, showEra }) {
  const [query, setQuery] = useState('');
  return <><section className="hero"><img className="hero-art" src="/images/hero-landscape.webp" alt="青绿水墨山水，远山、江岸与一叶小舟" fetchPriority="high" /><div className="hero-copy"><h1>在时间深处，<br />读懂中国。</h1><p>从史料出发，连接人物、事件与时代。</p><form className="hero-search" onSubmit={event => { event.preventDefault(); search(query); }}><MagnifyingGlass size={25} weight="thin" /><input aria-label="首页搜索" placeholder="搜索人物、事件或史料" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit">检索</button></form></div><p className="hero-caption">第一期 · 五代 907—960</p></section>
    <EraRibbon go={go} showEra={showEra} />
    <section className="home-content"><div className="feature-area"><div className="section-heading"><h2>从五代开始</h2><p>重返历史现场，理解一个多变而真实的时代。</p></div><div className="feature-story"><button className="story-image-button" onClick={() => go('timeline')} aria-label="进入五代更迭专题"><img src="/images/river-story.webp" alt="古代江岸、舟船与楼阁的山水画风插图" /></button><div className="feature-copy"><h3>五代更迭：从后梁到后周</h3><span className="date-label">907 — 960</span><p>五代是唐宋之间承前启后的关键时期。中原政权更迭频仍，格局纷纭，而社会、经济与文化也在动荡中持续演进。从人物、事件与史料出发，接近这一时期复杂而生动的历史面貌。</p><button className="text-link" onClick={() => go('timeline')}>进入五代专题 <ArrowRight size={21} weight="thin" /></button></div></div></div><aside className="source-area"><div className="section-heading"><h2>史料入口</h2><button className="text-link small" onClick={() => go('sources')}>进入史料库 <ArrowRight size={18} weight="thin" /></button></div><div className="book-list">{books.map(book => <button className="book-row" key={book.id} onClick={() => go(`read-${book.id}`)}><img src={book.image} alt={`${book.title}书封插图`} /><span><strong>{book.title}</strong><small>{book.author}</small><span className="book-description">{book.description}</span></span></button>)}</div></aside></section>
    <section className="home-next"><div><span className="eyebrow">由人物进入时代</span><h2>历史的线索，藏在人与人的相遇中。</h2></div><button className="text-link" onClick={() => go('people')}>浏览人物索引 <ArrowRight size={20} weight="thin" /></button></section>
  </>;
}

function Timeline({ openEvent, openPerson, go }) {
  const [selected, setSelected] = useState(0);
  const item = events[selected];
  return <section className="page-shell"><div className="page-heading"><div><span className="eyebrow">第一期 / 五代 907—960</span><h1>五代，五次政权更迭。</h1></div><p>沿着时间，从后梁到后周，走向宋初。</p></div>
    <div className="dynasty-timeline" role="group" aria-label="选择历史节点">{events.map((event, index) => <button className={selected === index ? 'active' : ''} key={event.id} onClick={() => setSelected(index)} aria-pressed={selected === index} style={{ '--dynasty-color': event.color }}><strong>{event.dynasty}</strong><span className="dynasty-line" /><span>{event.year}</span></button>)}</div>
    <div className="timeline-story"><div className="timeline-art"><img src="/images/river-story.webp" alt="舟船与江岸山水插图" /><span>时代在更迭，历史在延续。</span></div><article><span className="eyebrow">公元 {item.year} 年</span><h2>{item.title}</h2><p className="lead">{item.description}</p><p>{item.context}</p><div className="related-inline"><button onClick={() => openPerson(people.find(person => person.name === item.person))}><UsersThree size={19} weight="thin" />关联人物 · {item.person}</button><button onClick={() => go('sources')}><BookOpen size={19} weight="thin" />查看相关史料</button></div><button className="text-link" onClick={() => openEvent(item)}>查看事件条目 <ArrowRight size={20} weight="thin" /></button></article></div>
    <div className="timeline-controls"><button className="quiet-button" disabled={selected === 0} onClick={() => setSelected(index => index - 1)}><ArrowLeft size={18} />上一事件</button><span>{item.year} 年 · {item.dynasty}</span><button className="quiet-button" disabled={selected === events.length - 1} onClick={() => setSelected(index => index + 1)}>下一事件<ArrowRight size={18} /></button></div>
    <p className="small-note">本年表展示中原五个王朝的主要交替节点。五代时期之外的区域政权与细节，将随内容整理逐步补充。</p>
  </section>;
}

function Sources({ go }) {
  return <section className="page-shell"><div className="page-heading"><div><span className="eyebrow">以史料为起点 / SOURCES</span><h1>同一段历史，不止一种记述。</h1></div><p>将两部史书相互参读，保留出处，回到原文。</p></div><div className="source-catalog">{books.map(book => <article className="catalog-book" key={book.id}><img src={book.image} alt={`${book.title}书封插图`} /><div><span className="eyebrow">五代 · 纪传体史书</span><h2>{book.title}</h2><p className="author">{book.author}</p><p>{book.description}</p><div className="catalog-actions"><button className="primary-button" onClick={() => go(`read-${book.id}`)}>阅读节选 <ArrowRight size={18} /></button><External className="text-link" href={book.url}>完整目录 <ArrowUpRight size={18} /></External></div></div></article>)}</div><p className="source-note"><BookOpen size={23} weight="thin" />当前提供两部史书的开篇节选与外部原文入口。原文保留繁体字，阅读提示由本站整理；图像为插图，并非史书版本影印。</p></section>;
}

function People({ openPerson }) {
  const [query, setQuery] = useState('');
  const [dynasty, setDynasty] = useState('全部');
  const visible = people.filter(person => (dynasty === '全部' || person.dynasty === dynasty) && `${person.name} ${person.aliases}`.includes(query.trim()));
  return <section className="page-shell"><div className="page-heading"><div><span className="eyebrow">人物索引 / PEOPLE</span><h1>从一个名字，进入一个时代。</h1></div><p>从五代政权更迭相关人物开始，追索其历史线索。</p></div><div className="people-tools"><div className="compact-search"><MagnifyingGlass size={20} weight="thin" /><input aria-label="查找人物" placeholder="姓名或别名，如朱温、朱全忠" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="按政权筛选人物" value={dynasty} onChange={event => setDynasty(event.target.value)}>{['全部', '后梁', '后唐', '后晋', '后汉', '后周', '宋'].map(value => <option key={value} value={value}>{value === '全部' ? '全部政权' : value}</option>)}</select></div><div className="people-list">{visible.map((person, index) => <button className="person-row" key={person.id} onClick={() => openPerson(person)}><span className="index-number">{String(index + 1).padStart(2, '0')}</span><strong>{person.name}</strong><span>{person.dynasty}</span><p>{person.role}</p><ArrowRight size={24} weight="thin" /></button>)}{visible.length === 0 && <div className="empty-state"><h3>没有匹配的人物</h3><p>可以更换姓名或政权筛选条件。</p><button className="text-link" onClick={() => { setQuery(''); setDynasty('全部'); }}>重置筛选 <ArrowRight size={18} /></button></div>}</div></section>;
}

function Reader({ book: localBook, go, openPerson }) {
  const [size, setSize] = useState(23);
  const [tab, setTab] = useState('notes');
  const [showDirectory, setShowDirectory] = useState(false);
  const [chapter, setChapter] = useState(null);
  const [readState, setReadState] = useState(historyApiConfigured ? 'loading' : 'local');
  useEffect(() => {
    if (!historyApiConfigured) return;
    const controller = new AbortController();
    loadChapter(localBook.id, controller.signal).then(value => {
      if (!controller.signal.aborted) { setChapter(value); setReadState('ready'); }
    }).catch(() => { if (!controller.signal.aborted) setReadState('fallback'); });
    return () => controller.abort();
  }, [localBook.id]);
  const book = chapter ? { ...localBook, chapter: chapter.title, chapterUrl: chapter.sourceUrl, notes: chapter.notes } : localBook;
  const paragraphs = chapter?.paragraphs ?? localBook.paragraphs.map((original, index) => ({ id: `${localBook.id}-1-p${index + 1}`, original, translation: null }));
  return <section className="reader" data-read-state={readState}><div className="breadcrumbs"><button onClick={() => go('sources')}>史料库</button><span>/</span><span>五代</span><span>/</span><span>{book.title}</span></div><div className="reader-layout"><aside className={`reader-directory ${showDirectory ? 'directory-visible' : ''}`}><h2>{book.title}</h2><p>章节目录</p><button className="chapter-active" onClick={() => setShowDirectory(false)}>{book.chapter}</button><External href={book.url} className="text-link small">查看完整目录 <ArrowUpRight size={16} /></External><img src={book.image} alt="书封插图" /></aside><article className="reader-main"><span className="eyebrow">{book.author} · 卷一节选</span><h1>{book.chapter}</h1><div className="reader-toolbar"><span>原文</span><div><button className="font-button" aria-label="减小字号" disabled={size <= 18} onClick={() => setSize(value => value - 1)}>A−</button><button className="font-button" aria-label="增大字号" disabled={size >= 30} onClick={() => setSize(value => value + 1)}>A＋</button><button className="directory-toggle" aria-expanded={showDirectory} onClick={() => setShowDirectory(!showDirectory)}><List size={18} />目录</button></div></div><div className="reader-status" role="status">{readState === 'loading' && '正在读取章节…'}{readState === 'fallback' && '暂时无法读取最新章节，当前显示已收录节选。'}</div><div className="original-text" style={{ fontSize: size }}>{paragraphs.map((paragraph, index) => <div key={paragraph.id}><p><span className="paragraph-number">{index + 1}</span>{paragraph.original}</p>{paragraph.translation && <div className="paragraph-translation"><span>译文 · {paragraph.translation.translator}</span><p>{paragraph.translation.text}</p></div>}</div>)}</div><div className="reading-source"><span>原文来源 · 维基文库</span><External href={book.chapterUrl}>查阅完整原文与夹注 <ArrowUpRight size={17} /></External><p>本页为节选阅读，暂未收录完整章节。阅读提示用于帮助定位，不替代原文校勘与专业研究。</p></div><div className="reader-bottom"><button className="text-link" onClick={() => go('sources')}><ArrowLeft size={18} />返回史料库</button><button className="text-link" onClick={() => go(`read-${book.id === 'old' ? 'new' : 'old'}`)}>参读《{book.id === 'old' ? '新' : '旧'}五代史》<ArrowRight size={18} /></button></div></article><aside className="reader-context"><div className="filter-tabs" role="group" aria-label="阅读辅助">{[['notes', '阅读提示'], ['related', '关联']].map(([id, label]) => <button className={tab === id ? 'active' : ''} aria-pressed={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === 'notes' ? <div><h3>阅读说明</h3>{book.notes.map(note => <p key={note}>{note}</p>)}</div> : <div><h3>关联人物</h3><button className="context-link" onClick={() => openPerson(people[0])}>朱温 <ArrowRight size={18} /></button><p>后梁建立者</p><h3>关联事件</h3><button className="context-link" onClick={() => go('timeline')}>后梁建立 · 907 年 <ArrowRight size={18} /></button></div>}</aside></div></section>;
}

export function App() {
  const [route, setRoute] = useState(getRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(null);
  useEffect(() => { const listener = () => { setRoute(getRoute()); window.scrollTo({ top: 0 }); }; window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  useEffect(() => { document.title = `${{ overview: '在时间深处，读懂中国', timeline: '五代年表', sources: '史料库', people: '人物索引', map: '历史地点', 'read-old': '旧五代史 · 节选', 'read-new': '新五代史 · 节选' }[route]} · 中国古代史`; }, [route]);
  function go(view) { setMenuOpen(false); setModal(null); if (getRoute() === view) window.scrollTo({ top: 0 }); else location.hash = view; }
  const search = query => setModal({ type: 'search', query });
  const openEvent = item => setModal({ type: 'event', item });
  const openPerson = item => setModal({ type: 'person', item });
  function openItem(item) { if (item.type === 'book') go(`read-${item.id}`); else if (item.type === 'person') openPerson(item); else openEvent(item); }
  const active = route.startsWith('read-') ? 'sources' : route;
  return <><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); const main = document.getElementById('main-content'); main.focus(); main.scrollIntoView(); }}>跳转到内容</a><header className="site-header"><a className="brand" href="#overview" onClick={() => setMenuOpen(false)}><img src="/images/history-seal-ancient.png" alt="" /><strong>中国古代史</strong></a><span className="brand-note">以史为镜 · 与古今对话</span><nav className={menuOpen ? 'main-nav menu-open' : 'main-nav'} aria-label="主导航">{[['timeline', '时序'], ['sources', '史料'], ['people', '人物'], ['map', '地图']].map(([id, text]) => <a className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} href={`#${id}`} key={id} onClick={() => setMenuOpen(false)}>{text}</a>)}</nav><div className="header-actions"><button className="header-search" aria-label="打开全站搜索" onClick={() => search('')}><MagnifyingGlass size={26} weight="thin" /><span>搜索</span></button><button className="icon-button menu-button" aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={25} /> : <List size={25} />}</button></div></header>
    <main id="main-content" tabIndex={-1}>{route === 'overview' && <Home go={go} search={search} showEra={era => setModal({ type: 'era', era })} />}{route === 'timeline' && <Timeline go={go} openEvent={openEvent} openPerson={openPerson} />}{route === 'sources' && <Sources go={go} />}{route === 'people' && <People openPerson={openPerson} />}{route === 'map' && <Suspense fallback={<div className="page-shell"><p role="status">正在打开地点地图…</p></div>}><MapView /></Suspense>}{route.startsWith('read-') && <Reader key={route} book={books.find(book => book.id === route.slice(5))} go={go} openPerson={openPerson} />}</main>
    <footer className="site-footer"><div><strong>中国古代史</strong><span>从史料出发，与历史相遇。</span></div><span>当前整理 · 五代时期</span><External href="https://github.com/Lzww0608/Lzww0608.github.io">项目与来源 <ArrowUpRight size={15} /></External></footer>
    {modal && <Dialog title={{ search: '检索历史', event: '事件条目', person: '人物条目', era: '历史长卷' }[modal.type]} onClose={() => setModal(null)} wide={modal.type === 'search'}>{modal.type === 'search' && <SearchPanel initialQuery={modal.query} openItem={openItem} />}{modal.type === 'era' && <div className="detail-panel"><span className="eyebrow">中国古代史 · 内容计划</span><h2>{modal.era}</h2><p>这一时期的内容正在规划中。当前先从五代时期整理人物、事件与史料，随后逐步扩展。</p><button className="text-link" onClick={() => go('timeline')}>先探索五代 <ArrowRight size={20} /></button></div>}{modal.type === 'event' && <div className="detail-panel"><span className="eyebrow">{modal.item.year} 年 · {modal.item.dynasty}</span><h2>{modal.item.title}</h2><p className="lead">{modal.item.description}</p><p>{modal.item.context}</p><h3>关联人物</h3><button className="text-link" onClick={() => openPerson(people.find(person => person.name === modal.item.person))}>{modal.item.person}<ArrowRight size={18} /></button><h3>沿史料继续阅读</h3><div className="detail-links">{books.map(book => <button key={book.id} onClick={() => go(`read-${book.id}`)}>{book.title}<ArrowRight size={18} /></button>)}</div></div>}{modal.type === 'person' && <div className="detail-panel"><span className="eyebrow">{modal.item.dynasty} · {modal.item.role}</span><h2>{modal.item.name}</h2><p>{modal.item.intro}</p><p className="small-note">相关称谓：{modal.item.aliases}</p><h3>关联事件</h3><button className="text-link" onClick={() => openEvent(events.find(event => event.id === modal.item.event))}>{events.find(event => event.id === modal.item.event).title}<ArrowRight size={18} /></button><h3>史料入口</h3><div className="detail-links">{books.map(book => <External key={book.id} href={book.url}>{book.title}<ArrowUpRight size={18} /></External>)}</div></div>}</Dialog>}
  </>;
}
