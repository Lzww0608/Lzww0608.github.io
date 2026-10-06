import { useEffect, useRef, useState } from 'react';
import { Palette, Check } from '@phosphor-icons/react';
import { readTheme, saveTheme, THEMES } from './appearance';
import type { PageTheme } from './types';

export function ThemeSwitcher() {
  const [theme, setTheme] = useState(readTheme);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!open) return;
    choices.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  function selectTheme(value: PageTheme) {
    saveTheme(value); setTheme(value); setOpen(false); trigger.current?.focus();
  }
  return <div ref={container} className="theme-switcher">
    <button ref={trigger} className="theme-trigger" aria-label="切换页面配色" aria-expanded={open} aria-controls="theme-choices" title={`页面配色：${THEMES.find(item => item.id === theme)?.label}`} onClick={() => setOpen(value => !value)}><Palette size={24} weight="thin" /><span>配色</span></button>
    <div ref={choices} id="theme-choices" className="theme-choices" role="group" aria-label="页面配色" hidden={!open}><p>页面配色</p>{THEMES.map(item => <button key={item.id} aria-pressed={theme === item.id} onClick={() => selectTheme(item.id)}><span className={`theme-swatch swatch-${item.id}`} aria-hidden="true" /><span>{item.label}</span>{theme === item.id && <Check size={17} aria-hidden="true" />}</button>)}</div>
  </div>;
}
