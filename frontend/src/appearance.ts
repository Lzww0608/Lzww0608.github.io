import type { PageTheme, SidebarId } from './types.ts';

export const THEME_KEY = 'ancient-history:theme:v1';
export const THEMES: ReadonlyArray<{ id: PageTheme; label: string }> = [
  { id: 'paper', label: '纸笺' }, { id: 'jade', label: '青瓷' }, { id: 'night', label: '夜读' },
];
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function readPreference(key: string, storage?: Pick<PreferenceStorage, 'getItem'>): string | null {
  try {
    return (storage ?? (typeof window === 'undefined' ? undefined : window.localStorage))?.getItem(key) ?? null;
  } catch { return null; }
}

function savePreference(key: string, value: string, storage?: Pick<PreferenceStorage, 'setItem'>): void {
  try {
    (storage ?? (typeof window === 'undefined' ? undefined : window.localStorage))?.setItem(key, value);
  } catch { /* Preferences are optional; controls remain usable without storage. */ }
}

export function readTheme(storage?: Pick<PreferenceStorage, 'getItem'>): PageTheme {
  const saved = readPreference(THEME_KEY, storage);
  return saved === 'jade' || saved === 'night' ? saved : 'paper';
}

export function saveTheme(theme: PageTheme, storage?: Pick<PreferenceStorage, 'setItem'>): void {
  savePreference(THEME_KEY, theme, storage);
}

export function readSidebarCollapsed(id: SidebarId, storage?: Pick<PreferenceStorage, 'getItem'>): boolean {
  return readPreference(`ancient-history:sidebar:v1:${id}`, storage) === 'collapsed';
}

export function saveSidebarCollapsed(id: SidebarId, collapsed: boolean, storage?: Pick<PreferenceStorage, 'setItem'>): void {
  savePreference(`ancient-history:sidebar:v1:${id}`, collapsed ? 'collapsed' : 'expanded', storage);
}
