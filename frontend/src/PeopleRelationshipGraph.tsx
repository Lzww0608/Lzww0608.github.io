import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  personRelationships,
  relationshipKindLabels,
  relationshipNodes,
} from './relationships.ts';
import type { PersonRelationship, RelationshipKind, RelationshipNode } from './relationships.ts';
import type { Dynasty, HistoryPerson } from './types.ts';
import { useOriginalScript } from './use-original-script.ts';
import './relationships.css';

export interface PeopleRelationshipGraphProps {
  people: readonly HistoryPerson[];
  selectedPersonId?: string;
  onSelectPerson?: (id: string) => void;
  onOpenPerson: (person: HistoryPerson) => void;
  onReadSource?: (chapterId: string, paragraphId?: string) => void;
}

interface PositionedNode {
  node: RelationshipNode;
  x: number;
  y: number;
}

interface GraphGroup {
  id: Dynasty;
  label: string;
  x: number;
  width: number;
}

interface GraphLayout {
  width: number;
  height: number;
  nodes: PositionedNode[];
  groups: GraphGroup[];
}

const kinds: readonly RelationshipKind[] = ['kinship', 'adoption', 'service', 'conflict', 'succession'];
const groupOrder: readonly Dynasty[] = ['后梁', '后唐', '后晋', '后汉', '后周'];
const groupLabels: Record<string, string> = {
  后梁: '后梁朱氏',
  后唐: '河东与后唐',
  后晋: '后晋石氏',
  后汉: '后汉刘氏',
  后周: '后周郭氏与柴氏',
};
const tangPositions: Record<string, readonly [number, number]> = {
  'li-keyong': [1, 0],
  'li-kerou': [3, 0],
  'li-cunxu': [0, 1],
  'li-siyuan': [1, 1],
  'li-sizhao': [3, 1],
  'li-conghou': [1, 2],
  'li-congke': [2, 2],
  'li-cunxin': [0, 3],
  'li-cunjin': [1, 3],
  'li-siben': [2, 3],
  'li-sien': [3, 3],
  'li-cunzhang': [0, 4],
  'fu-cunshen': [1, 4],
  'li-cunxian': [2, 4],
  'li-cunxiao': [3, 4],
  'kang-junli': [0, 5],
  'shi-jingsi': [1, 5],
};
const nodeWidth = 116;
const nodeHeight = 68;

function nodeGroup(node: RelationshipNode, peopleById: ReadonlyMap<string, HistoryPerson>): Dynasty {
  const person = peopleById.get(node.id);
  if (person) return person.dynasty;
  return groupOrder.includes(node.group as Dynasty) ? node.group as Dynasty : '后唐';
}

function overviewLayout(nodes: readonly RelationshipNode[], peopleById: ReadonlyMap<string, HistoryPerson>): GraphLayout {
  const positions: PositionedNode[] = [];
  const groups: GraphGroup[] = [];
  let left = 24;
  for (const dynasty of groupOrder) {
    const members = nodes.filter(node => nodeGroup(node, peopleById) === dynasty);
    if (!members.length) continue;
    const width = dynasty === '后唐' ? 620 : 190;
    groups.push({ id: dynasty, label: groupLabels[dynasty] ?? dynasty, x: left, width });
    members.forEach((node, index) => {
      if (dynasty === '后唐') {
        const [column, row] = tangPositions[node.id] ?? [index % 4, Math.floor(index / 4) + 3];
        positions.push({ node, x: left + 91 + column * 145, y: row < 3 ? 153 + row * 153 : 620 + (row - 3) * 135 });
      } else {
        positions.push({ node, x: left + width / 2, y: 153 + index * 153 });
      }
    });
    left += width + 18;
  }
  return { width: Math.max(600, left + 6), height: 966, nodes: positions, groups };
}

function focusLayout(nodes: readonly RelationshipNode[], selectedId: string): GraphLayout {
  const selected = nodes.find(node => node.id === selectedId);
  const neighbors = nodes.filter(node => node.id !== selectedId);
  const height = Math.max(360, neighbors.length * 86 + 116);
  return {
    width: 940,
    height,
    groups: [],
    nodes: [
      ...(selected ? [{ node: selected, x: 195, y: height / 2 }] : []),
      ...neighbors.map((node, index) => ({ node, x: 750, y: 102 + index * 86 })),
    ],
  };
}

function curveForRelationship(from: PositionedNode, to: PositionedNode, lane: number, focused: boolean): string {
  const offset = lane * 7;
  if (focused || Math.abs(to.x - from.x) > 70) {
    const direction = to.x > from.x ? 1 : -1;
    const startX = from.x + direction * nodeWidth / 2;
    const endX = to.x - direction * nodeWidth / 2;
    const bend = Math.max(40, Math.abs(endX - startX) * .52);
    return `M ${startX} ${from.y + offset} C ${startX + direction * bend} ${from.y + offset}, ${endX - direction * bend} ${to.y + offset}, ${endX} ${to.y + offset}`;
  }
  const direction = to.y > from.y ? 1 : -1;
  const startY = from.y + direction * nodeHeight / 2;
  const endY = to.y - direction * nodeHeight / 2;
  const bend = Math.abs(endY - startY) * .48;
  const bow = Math.abs(to.y - from.y) > 230 ? 100 : 0;
  return `M ${from.x + offset} ${startY} C ${from.x + offset + bow} ${startY + direction * bend}, ${to.x + offset + bow} ${endY - direction * bend}, ${to.x + offset} ${endY}`;
}

function activateWithKeyboard(event: React.KeyboardEvent<SVGElement>, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

export function PeopleRelationshipGraph({
  people,
  selectedPersonId,
  onSelectPerson,
  onOpenPerson,
  onReadSource,
}: PeopleRelationshipGraphProps) {
  const elementId = useId().replaceAll(':', '');
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const [localSelectedPersonId, setLocalSelectedPersonId] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<readonly RelationshipKind[]>(kinds);
  const [activeRelationshipId, setActiveRelationshipId] = useState('');
  const [expandedEvidence, setExpandedEvidence] = useState<ReadonlySet<string>>(new Set());
  const [showAllRelationships, setShowAllRelationships] = useState(false);
  const originalScript = useOriginalScript();
  const peopleById = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const nodes = useMemo(() => relationshipNodes.filter(node => peopleById.has(node.id) || (
    node.external && personRelationships.some(relationship => (
      relationship.from === node.id && peopleById.has(relationship.to)
    ) || (relationship.to === node.id && peopleById.has(relationship.from)))
  )), [peopleById]);
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const requestedSelectedId = selectedPersonId ?? localSelectedPersonId;
  const focusedId = nodesById.has(requestedSelectedId) ? requestedSelectedId : '';
  const focusedNode = nodesById.get(focusedId);
  const relationships = useMemo(() => personRelationships.filter(relationship => (
    selectedKinds.includes(relationship.kind)
    && nodesById.has(relationship.from)
    && nodesById.has(relationship.to)
    && (!focusedId || relationship.from === focusedId || relationship.to === focusedId)
  )), [focusedId, nodesById, selectedKinds]);
  const graphNodes = useMemo(() => {
    if (!focusedId) return nodes;
    const relatedIds = new Set([focusedId, ...relationships.flatMap(relationship => [relationship.from, relationship.to])]);
    return nodes.filter(node => relatedIds.has(node.id));
  }, [focusedId, nodes, relationships]);
  const layout = useMemo(() => focusedId
    ? focusLayout(graphNodes, focusedId)
    : overviewLayout(graphNodes, peopleById), [focusedId, graphNodes, peopleById]);
  useEffect(() => {
    const container = diagramRef.current;
    if (!container) return;
    container.scrollTop = focusedId ? Math.max(0, layout.height / 2 - container.clientHeight / 2) : 0;
    container.scrollLeft = 0;
  }, [focusedId, layout.height]);
  const positionedNodes = new Map(layout.nodes.map(node => [node.node.id, node]));
  const parallelRelationships = new Map<string, PersonRelationship[]>();
  for (const relationship of relationships) {
    const pair = [relationship.from, relationship.to].sort().join('/');
    const existing = parallelRelationships.get(pair) ?? [];
    existing.push(relationship);
    parallelRelationships.set(pair, existing);
  }
  const displayedRelationships = focusedId || showAllRelationships ? relationships : relationships.slice(0, 8);

  function selectPerson(id: string): void {
    setLocalSelectedPersonId(id);
    onSelectPerson?.(id);
    setActiveRelationshipId('');
    setShowAllRelationships(false);
    setExpandedEvidence(new Set());
  }

  function toggleKind(kind: RelationshipKind): void {
    setSelectedKinds(current => current.includes(kind) ? current.filter(item => item !== kind) : kinds.filter(item => item === kind || current.includes(item)));
    setActiveRelationshipId('');
  }

  function activateRelationship(id: string): void {
    setActiveRelationshipId(id);
    setShowAllRelationships(true);
    setExpandedEvidence(current => new Set([...current, id]));
    requestAnimationFrame(() => {
      document.getElementById(`${elementId}-relation-${id}`)?.scrollIntoView({ block: 'nearest' });
      document.getElementById(`${elementId}-evidence-toggle-${id}`)?.focus({ preventScroll: true });
    });
  }

  function toggleEvidence(id: string): void {
    setExpandedEvidence(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openNode(node: RelationshipNode): void {
    const person = peopleById.get(node.id);
    if (person) onOpenPerson(person);
    else selectPerson(node.id);
  }

  function personLink(id: string) {
    const node = nodesById.get(id);
    if (!node) return null;
    return <button className="relationship-person-link" type="button" onClick={() => openNode(node)}>{node.name}{node.external && <span>关联人物</span>}</button>;
  }

  return (
    <section className="people-relationships" aria-label="人物关系图">
      <div className="relationship-tools">
        <label className="relationship-focus-picker" htmlFor={`${elementId}-focus`}>
          <span>聚焦人物</span>
          <select id={`${elementId}-focus`} value={focusedId} onChange={event => selectPerson(event.target.value)}>
            <option value="">查看全图</option>
            {nodes.map(node => <option key={node.id} value={node.id}>{node.name}{node.external ? '（关联人物）' : ''}</option>)}
          </select>
        </label>
        <fieldset className="relationship-kind-filter">
          <legend>显示关系</legend>
          <div>
            {kinds.map(kind => <button key={kind} type="button" className={`relationship-kind-choice kind-${kind}`} aria-pressed={selectedKinds.includes(kind)} onClick={() => toggleKind(kind)}>
              <svg viewBox="0 0 30 12" width="30" height="12" aria-hidden="true"><path d="M 1 6 H 28" /></svg>
              <span>{relationshipKindLabels[kind]}</span>
              <span className="relationship-check" aria-hidden="true">{selectedKinds.includes(kind) ? '✓' : '＋'}</span>
            </button>)}
          </div>
        </fieldset>
      </div>

      <div className="relationship-context">
        <div>
          {focusedNode ? <><h2>{focusedNode.name}的相邻关系</h2><p>{relationships.length} 条联系。姓名可打开人物详情，关系线可查看原文依据。</p></> : <><h2>五代人物之间</h2><p>{people.length} 位已收录人物，{nodes.filter(node => node.external).length} 位关联人物。姓名可打开人物详情，关系线可查看原文依据。</p></>}
          {focusedNode?.external && <p className="relationship-external-note">{focusedNode.note ?? '此人为说明关系而列入，当前没有独立人物传记入口。'}</p>}
        </div>
        {focusedId && <button type="button" className="relationship-reset" onClick={() => selectPerson('')}>返回全图</button>}
      </div>

      <figure className="relationship-figure">
        <div ref={diagramRef} className="relationship-diagram-scroll" tabIndex={0} role="region" aria-label="人物关系图，可滚动查看" aria-describedby={`${elementId}-diagram-help`}>
          <svg className={`relationship-diagram${focusedId ? ' is-focused' : ''}`} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={focusedNode ? `${focusedNode.name}及其相邻人物的关系` : '五代人物关系，按史系分组'}>
            <defs>{kinds.map(kind => <marker key={kind} id={`${elementId}-arrow-${kind}`} viewBox="0 0 9 8" markerWidth="7" markerHeight="7" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path className={`relationship-arrow kind-${kind}`} d="M 0 0 L 8 4 L 0 8 Z" /></marker>)}</defs>
            {layout.groups.map(group => <g key={group.id} className="relationship-group" aria-hidden="true"><rect x={group.x} y="28" width={group.width} height={layout.height - 48} rx="3" /><text x={group.x + 16} y="66">{group.label}</text><path d={`M ${group.x + 16} 85 H ${group.x + group.width - 16}`} /></g>)}
            {focusedNode && <g className="relationship-focus-label" aria-hidden="true"><text x="195" y="42" textAnchor="middle">聚焦人物</text><text x="750" y="42" textAnchor="middle">直接相关人物</text></g>}
            {relationships.map(relationship => {
              const from = positionedNodes.get(relationship.from);
              const to = positionedNodes.get(relationship.to);
              if (!from || !to) return null;
              const pair = [relationship.from, relationship.to].sort().join('/');
              const siblings = parallelRelationships.get(pair) ?? [];
              const lane = siblings.findIndex(item => item.id === relationship.id) - (siblings.length - 1) / 2;
              const d = curveForRelationship(from, to, lane, Boolean(focusedId));
              const neighbor = relationship.from === focusedId ? to : from;
              const labelX = focusedId ? 586 : (from.x + to.x) / 2;
              const labelY = focusedId ? neighbor.y + lane * 28 : (from.y + to.y) / 2 + lane * 28;
              const showOverviewLabel = (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) <= 230)
                || (Math.abs(from.y - to.y) < 1 && Math.abs(from.x - to.x) - nodeWidth > relationship.label.length * 13 + 22);
              const showLabel = Boolean(focusedId) || showOverviewLabel || activeRelationshipId === relationship.id;
              return <g key={relationship.id} className={`relationship-edge kind-${relationship.kind}${activeRelationshipId === relationship.id ? ' is-active' : ''}`} role="button" tabIndex={0} aria-label={`${from.node.name}与${to.node.name}：${relationship.label}，查看原文依据`} onClick={() => activateRelationship(relationship.id)} onKeyDown={event => activateWithKeyboard(event, () => activateRelationship(relationship.id))}>
                <title>{from.node.name} → {to.node.name}：{relationship.label}</title>
                <rect x={(from.x + to.x) / 2 - 6} y={(from.y + to.y) / 2 + lane * 7 - 6} width="12" height="12" fill="transparent" pointerEvents="none" aria-hidden="true" />
                <path className="relationship-edge-line" d={d} markerEnd={relationship.kind === 'conflict' || relationship.label === '兄弟' ? undefined : `url(#${elementId}-arrow-${relationship.kind})`} aria-hidden="true" />
                <path className="relationship-edge-target" d={d} aria-hidden="true" />
                {showLabel && <g className="relationship-edge-label" aria-hidden="true"><rect x={labelX - Math.max(30, relationship.label.length * 6.5 + 8)} y={labelY - 11} width={Math.max(60, relationship.label.length * 13 + 16)} height="23" rx="2" /><text x={labelX} y={labelY + 5} textAnchor="middle">{relationship.label}</text></g>}
              </g>;
            })}
            {layout.nodes.map(({ node, x, y }) => <g key={node.id} className={`relationship-node${node.external ? ' is-external' : ''}${node.id === focusedId ? ' is-selected' : ''}`} transform={`translate(${x},${y})`} role="button" tabIndex={0} aria-label={`${node.name}${node.external ? '，关联人物，查看相邻关系' : '，打开人物详情'}`} onClick={() => openNode(node)} onKeyDown={event => activateWithKeyboard(event, () => openNode(node))}>
              <title>{node.name}{node.note ? `：${node.note}` : ''}</title>
              <rect x={-nodeWidth / 2} y={-nodeHeight / 2} width={nodeWidth} height={nodeHeight} rx="3" />
              <text className="relationship-node-name" y="-2" textAnchor="middle">{node.name}</text>
              <text className="relationship-node-note" y="21" textAnchor="middle">{node.external ? '关联人物' : node.id === focusedId ? '已聚焦 · 查看人物' : '查看人物'}</text>
            </g>)}
          </svg>
        </div>
        <figcaption id={`${elementId}-diagram-help`}>可滚动查看全图；选择人物聚焦相邻关系。箭头按父辈、养育者、主将或前帝指向相关人物；兄弟、冲突使用无箭头连线。虚线框为关联人物，当前没有独立传记。分组只表示史系，位置不表示排行。</figcaption>
      </figure>

      <section className="relationship-evidence" aria-labelledby={`${elementId}-evidence-title`}>
        <div className="relationship-evidence-heading"><h2 id={`${elementId}-evidence-title`}>关系与原文依据</h2><div className="relationship-quote-tools"><span aria-live="polite">{relationships.length} 条关系</span><div className="script-switch" role="group" aria-label="依据引文繁简切换">{(['traditional', 'simplified'] as const).map(script => <button key={script} type="button" aria-pressed={originalScript.script === script} onClick={() => originalScript.selectScript(script)}>{script === 'traditional' ? '繁体' : '简体'}</button>)}</div></div></div>
        <div className="relationship-script-status" role="status">{originalScript.pending && '正在准备简体引文…'}{originalScript.error && <><span>简体转换暂不可用，当前显示繁体原文。</span> <button type="button" onClick={originalScript.retry}>重试转换</button></>}</div>
        {relationships.length ? <ul className="relationship-list">
          {displayedRelationships.map(relationship => <li key={relationship.id} id={`${elementId}-relation-${relationship.id}`} className={`relationship-list-item kind-${relationship.kind}${activeRelationshipId === relationship.id ? ' is-active' : ''}`}>
            <div className="relationship-list-heading"><span className="relationship-kind-label">{relationshipKindLabels[relationship.kind]}</span><div>{personLink(relationship.from)}<span className="relationship-direction" aria-hidden="true">{relationship.kind === 'conflict' || relationship.label === '兄弟' ? '↔' : '→'}</span>{personLink(relationship.to)}</div></div>
            <p className="relationship-label">{relationship.label}</p>
            {relationship.note && <p className="relationship-note">{relationship.note}</p>}
            <button type="button" id={`${elementId}-evidence-toggle-${relationship.id}`} className="relationship-evidence-toggle" aria-expanded={expandedEvidence.has(relationship.id)} aria-controls={`${elementId}-sources-${relationship.id}`} onClick={() => toggleEvidence(relationship.id)}>{expandedEvidence.has(relationship.id) ? '收起原文依据' : `原文依据（${relationship.sources.length}）`}<span aria-hidden="true">{expandedEvidence.has(relationship.id) ? '−' : '＋'}</span></button>
            <div className="relationship-sources" id={`${elementId}-sources-${relationship.id}`} hidden={!expandedEvidence.has(relationship.id)}>
              {relationship.sources.map((source, sourceIndex) => <div className="relationship-source" key={`${source.chapterId}-${source.paragraphId}-${sourceIndex}`}><p className="relationship-source-title">{source.title}</p><blockquote lang={originalScript.displayScript === 'simplified' ? 'zh-Hans' : 'zh-Hant'} aria-busy={originalScript.pending}>{originalScript.displayScript === 'simplified' && originalScript.converter ? originalScript.converter(source.excerpt) : source.excerpt}</blockquote>{onReadSource && <button type="button" onClick={() => onReadSource(source.chapterId, source.paragraphId)}>阅读此处原文与白话译文</button>}</div>)}
            </div>
          </li>)}
        </ul> : <p className="relationship-empty">{selectedKinds.length ? '当前人物在所选类别中暂无已核对的关系。可查看全图或选择其他类别。' : '选择上方的关系类别，即可查看联系与原文依据。'}</p>}
        {!focusedId && relationships.length > 8 && <button type="button" className="relationship-more" aria-expanded={showAllRelationships} onClick={() => setShowAllRelationships(current => !current)}>{showAllRelationships ? '收起关系列表' : `展开全部 ${relationships.length} 条关系`}</button>}
      </section>
    </section>
  );
}
