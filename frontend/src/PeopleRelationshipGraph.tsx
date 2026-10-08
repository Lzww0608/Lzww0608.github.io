import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  personRelationships,
  relationshipKindLabels,
  relationshipNodes,
  buildRelationshipNodes,
  getRelationshipNeighborhood,
  searchRelationshipNodes,
} from './relationships.ts';
import type { PersonRelationship, RelationshipKind, RelationshipNode } from './relationships.ts';
import type { HistoryPerson } from './types.ts';
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

interface GraphLayout {
  width: number;
  height: number;
  nodes: PositionedNode[];
}

const kinds: readonly RelationshipKind[] = ['kinship', 'adoption', 'service', 'conflict', 'succession'];
const nodeWidth = 116;
const nodeHeight = 68;

function focusLayout(nodes: readonly RelationshipNode[], selectedId: string): GraphLayout {
  const selected = nodes.find(node => node.id === selectedId);
  const neighbors = nodes.filter(node => node.id !== selectedId);
  const height = Math.max(360, neighbors.length * 86 + 116);
  return {
    width: 940,
    height,
    nodes: [
      ...(selected ? [{ node: selected, x: 195, y: height / 2 }] : []),
      ...neighbors.map((node, index) => ({ node, x: 750, y: 102 + index * 86 })),
    ],
  };
}

function curveForRelationship(from: PositionedNode, to: PositionedNode, lane: number): string {
  const offset = lane * 7;
  const direction = to.x > from.x ? 1 : -1;
  const startX = from.x + direction * nodeWidth / 2;
  const endX = to.x - direction * nodeWidth / 2;
  const bend = Math.max(40, Math.abs(endX - startX) * .52);
  return `M ${startX} ${from.y + offset} C ${startX + direction * bend} ${from.y + offset}, ${endX - direction * bend} ${to.y + offset}, ${endX} ${to.y + offset}`;
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
  const [query, setQuery] = useState('');
  const originalScript = useOriginalScript();
  const peopleById = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const nodes = useMemo(() => buildRelationshipNodes(people, relationshipNodes.filter(node => node.external)), [people]);
  const nodesById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const requestedSelectedId = selectedPersonId ?? localSelectedPersonId;
  const focusedId = nodesById.has(requestedSelectedId) ? requestedSelectedId : '';
  const focusedNode = nodesById.get(focusedId);
  const candidates = focusedId ? [] : searchRelationshipNodes(query, nodes, people);
  const allRelationships = useMemo(() => getRelationshipNeighborhood(focusedId, nodes, personRelationships).relationships, [focusedId, nodes]);
  const neighborhood = useMemo(() => getRelationshipNeighborhood(focusedId, nodes, personRelationships, selectedKinds), [focusedId, nodes, selectedKinds]);
  const relationships = neighborhood.relationships;
  const layout = useMemo(() => focusLayout(neighborhood.nodes, focusedId), [neighborhood.nodes, focusedId]);
  useEffect(() => {
    const selected = nodesById.get(selectedPersonId ?? '');
    if (selected) setQuery(selected.name);
  }, [selectedPersonId, nodesById]);
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
  const displayedRelationships = relationships;

  function selectPerson(id: string): void {
    setLocalSelectedPersonId(id);
    onSelectPerson?.(id);
    setActiveRelationshipId('');
    setQuery(nodesById.get(id)?.name ?? '');
    setExpandedEvidence(new Set());
  }

  function editQuery(value: string): void {
    setQuery(value);
    setLocalSelectedPersonId('');
    onSelectPerson?.('');
    setActiveRelationshipId('');
    setExpandedEvidence(new Set());
  }

  function toggleKind(kind: RelationshipKind): void {
    setSelectedKinds(current => current.includes(kind) ? current.filter(item => item !== kind) : kinds.filter(item => item === kind || current.includes(item)));
    setActiveRelationshipId('');
  }

  function activateRelationship(id: string): void {
    setActiveRelationshipId(id);

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
        <div className="relationship-person-search">
          <label htmlFor={`${elementId}-search`}>搜索关系人物</label>
          <div className="relationship-search-field"><input id={`${elementId}-search`} type="search" autoComplete="off" placeholder="输入姓名或别名，如李嗣源、安敬思" value={query} onChange={event => editQuery(event.target.value)} />{query && <button type="button" onClick={() => { selectPerson(''); document.getElementById(`${elementId}-search`)?.focus(); }}>清空</button>}</div>
          {!focusedId && query.trim() && <div className="relationship-search-results" role="group" aria-label="搜索匹配人物"><p aria-live="polite">{candidates.length ? `找到 ${candidates.length} 位人物，请选择一位` : '没有匹配的人物，可以更换姓名或别名'}</p>{candidates.map(node => <button className="relationship-search-result" type="button" key={node.id} onClick={() => selectPerson(node.id)}><strong>{node.name}</strong><small>{node.external ? '关联人物' : peopleById.get(node.id)?.role}</small></button>)}</div>}
        </div>
        {focusedNode && <fieldset className="relationship-kind-filter">
          <legend>显示关系</legend>
          <div>
            {kinds.map(kind => <button key={kind} type="button" className={`relationship-kind-choice kind-${kind}`} aria-pressed={selectedKinds.includes(kind)} onClick={() => toggleKind(kind)}>
              <svg viewBox="0 0 30 12" width="30" height="12" aria-hidden="true"><path d="M 1 6 H 28" /></svg>
              <span>{relationshipKindLabels[kind]}</span>
              <span className="relationship-check" aria-hidden="true">{selectedKinds.includes(kind) ? '✓' : '＋'}</span>
            </button>)}
          </div>
        </fieldset>}
      </div>

      {focusedNode ? <>
      <div className="relationship-context">
        <div>
          <h2>{focusedNode.name}的人物关系</h2><p>{relationships.length} 条直接联系。姓名可打开人物详情，关系线可查看原文依据。</p>
          {focusedNode?.external && <p className="relationship-external-note">{focusedNode.note ?? '此人为说明关系而列入，当前没有独立人物传记入口。'}</p>}
        </div>
        {focusedId && <button type="button" className="relationship-reset" onClick={() => selectPerson('')}>重新搜索</button>}
      </div>

      <figure className="relationship-figure">
        <div ref={diagramRef} className="relationship-diagram-scroll" tabIndex={0} role="region" aria-label="人物关系图，可滚动查看" aria-describedby={`${elementId}-diagram-help`}>
          <svg className="relationship-diagram is-focused" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${focusedNode.name}及其直接相关人物的关系`}>
            <defs>{kinds.map(kind => <marker key={kind} id={`${elementId}-arrow-${kind}`} viewBox="0 0 9 8" markerWidth="7" markerHeight="7" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path className={`relationship-arrow kind-${kind}`} d="M 0 0 L 8 4 L 0 8 Z" /></marker>)}</defs>
            {focusedNode && <g className="relationship-focus-label" aria-hidden="true"><text x="195" y="42" textAnchor="middle">聚焦人物</text><text x="750" y="42" textAnchor="middle">直接相关人物</text></g>}
            {relationships.map(relationship => {
              const from = positionedNodes.get(relationship.from);
              const to = positionedNodes.get(relationship.to);
              if (!from || !to) return null;
              const pair = [relationship.from, relationship.to].sort().join('/');
              const siblings = parallelRelationships.get(pair) ?? [];
              const lane = siblings.findIndex(item => item.id === relationship.id) - (siblings.length - 1) / 2;
              const d = curveForRelationship(from, to, lane);
              const neighbor = relationship.from === focusedId ? to : from;
              const labelX = 586;
              const labelY = neighbor.y + lane * 28;
              return <g key={relationship.id} className={`relationship-edge kind-${relationship.kind}${activeRelationshipId === relationship.id ? ' is-active' : ''}`} role="button" tabIndex={0} aria-label={`${from.node.name}与${to.node.name}：${relationship.label}，查看原文依据`} onClick={() => activateRelationship(relationship.id)} onKeyDown={event => activateWithKeyboard(event, () => activateRelationship(relationship.id))}>
                <title>{from.node.name} → {to.node.name}：{relationship.label}</title>
                <rect x={(from.x + to.x) / 2 - 6} y={(from.y + to.y) / 2 + lane * 7 - 6} width="12" height="12" fill="transparent" pointerEvents="none" aria-hidden="true" />
                <path className="relationship-edge-line" d={d} markerEnd={relationship.kind === 'conflict' || relationship.label === '兄弟' ? undefined : `url(#${elementId}-arrow-${relationship.kind})`} aria-hidden="true" />
                <path className="relationship-edge-target" d={d} aria-hidden="true" />
                {<g className="relationship-edge-label" aria-hidden="true"><rect x={labelX - Math.max(30, relationship.label.length * 6.5 + 8)} y={labelY - 11} width={Math.max(60, relationship.label.length * 13 + 16)} height="23" rx="2" /><text x={labelX} y={labelY + 5} textAnchor="middle">{relationship.label}</text></g>}
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
        <figcaption id={`${elementId}-diagram-help`}>只展示已选人物与直接相关人物，可在图内滚动查看。箭头按父辈、养育者、主将或前帝指向相关人物；兄弟、冲突使用无箭头连线。虚线框为关联人物，当前没有独立传记。位置不表示排行。</figcaption>
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
        </ul> : <p className="relationship-empty">{!allRelationships.length ? '此人物暂无已核验关系。新收录的关系会自动更新到这里。' : selectedKinds.length ? '所选类别没有关系，可选择其他类别。' : '选择上方的关系类别，即可查看联系与原文依据。'}</p>}

      </section>
      </> : <div className="relationship-search-empty"><h2>搜索一个人物，查看关系</h2><p>输入姓名或别名，再从匹配结果中选择人物。这里会显示他与其他人物的直接联系及原文依据。</p></div>}
    </section>
  );
}
