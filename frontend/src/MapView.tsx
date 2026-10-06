import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from '@phosphor-icons/react';
import { places } from './data';
import { CollapsibleSidebar, useSidebarState } from './CollapsibleSidebar';
import type { HistoricalPlace } from './types';

export function MapView() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const [selected, setSelected] = useState(places[0]);
  const [tileError, setTileError] = useState(false);
  const sidebar = useSidebarState('map-places');
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([35.6, 112.9], 6);
    map.current = instance;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 15, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    tiles.on('tileerror', () => setTileError(true));
    places.forEach(place => {
      L.circleMarker(place.coords, { radius: 8, color: '#fffaf0', weight: 3, fillColor: '#9b493d', fillOpacity: 1 }).addTo(instance).bindTooltip(place.name, { permanent: true, direction: 'top', offset: [0, -8] }).on('click', () => setSelected(place));
    });
    const resize = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; };
  }, []);
  function choose(place: HistoricalPlace) { setSelected(place); map.current?.setView(place.coords, 8, { animate: true }); }
  return <section className="page-shell">
    <div className="page-heading"><div><span className="eyebrow">地点与时代 / HISTORICAL PLACES</span><h1>循山河，探历史。</h1></div><p>从洛阳、开封与太原，进入五代的地理空间。</p></div>
    <div className={`map-layout ${sidebar.collapsed ? 'right-collapsed' : ''}`}><div className="map-surface"><div ref={container} className="history-map" role="region" aria-label="五代相关地点地图" />{tileError && <p className="map-notice">底图暂时无法加载，仍可从地点索引查看历史关联。</p>}</div><CollapsibleSidebar id="map-places" title="地点索引" side="right" className="place-panel" collapsed={sidebar.collapsed} onToggle={sidebar.toggle}><span className="eyebrow">五代 · 地理入口</span><div className="place-list">{places.map(place => <button key={place.name} className={place.name === selected.name ? 'selected' : ''} onClick={() => choose(place)}><MapPin size={18} weight="thin" />{place.name}</button>)}</div><h3>{selected.name}</h3><p>{selected.detail}</p><p className="small-note">使用现代地理底图展示相关地点。标记为地理入口，不表示五代疆域、行政边界或精确历史城址。</p></CollapsibleSidebar></div>
  </section>;
}
