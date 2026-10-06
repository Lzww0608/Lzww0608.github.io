import { useState } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { readSidebarCollapsed, saveSidebarCollapsed } from './appearance';
import type { ReactNode, Ref } from 'react';
import type { SidebarId } from './types';

export function useSidebarState(id: SidebarId) {
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(id));
  function selectCollapsed(value: boolean) {
    saveSidebarCollapsed(id, value);
    setCollapsed(value);
  }
  return { collapsed, setCollapsed: selectCollapsed, toggle: () => selectCollapsed(!collapsed) };
}

export function CollapsibleSidebar({ id, title, side, collapsed, onToggle, className = '', panelRef, children }: {
  id: SidebarId;
  title: string;
  side: 'left' | 'right';
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  panelRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const Icon = (side === 'left') !== collapsed ? CaretLeft : CaretRight;
  const label = `${collapsed ? '展开' : '收起'}${title}`;
  return <aside ref={panelRef} className={`collapsible-sidebar ${className}`} data-sidebar={id} data-collapsed={collapsed} aria-label={title}>
    <div className="sidebar-heading"><h2 className="sidebar-title">{title}</h2><button className="sidebar-toggle" onClick={onToggle} aria-label={label} title={label} aria-expanded={!collapsed} aria-controls={`${id}-content`}><Icon size={20} /><span className="sidebar-restore-label">{title}</span></button></div>
    <div id={`${id}-content`} className="sidebar-content" hidden={collapsed}>{children}</div>
  </aside>;
}
