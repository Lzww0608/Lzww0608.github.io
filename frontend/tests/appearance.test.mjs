import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readTheme, saveTheme, readSidebarCollapsed, saveSidebarCollapsed, THEME_KEY } from '../src/appearance.ts';

function memoryStorage(values = new Map()) {
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('theme preference survives reloads and safely rejects unknown stored values', () => {
  const values = new Map();
  const storage = memoryStorage(values);
  assert.equal(readTheme(storage), 'paper');
  for (const theme of ['jade', 'night', 'paper']) {
    saveTheme(theme, storage);
    assert.equal(readTheme(memoryStorage(values)), theme);
  }
  values.set(THEME_KEY, '{"theme":"unknown"}');
  assert.equal(readTheme(storage), 'paper');
});

test('each sidebar remembers its own state without overwriting theme or text preferences', () => {
  const values = new Map([['ancient-history:original-script:v1', 'simplified']]);
  const storage = memoryStorage(values);
  const ids = ['home-sources', 'reader-directory', 'reader-context', 'map-places'];
  saveTheme('night', storage);
  ids.forEach(id => assert.equal(readSidebarCollapsed(id, storage), false));
  saveSidebarCollapsed('reader-directory', true, storage);
  saveSidebarCollapsed('map-places', true, storage);
  assert.deepEqual(ids.map(id => readSidebarCollapsed(id, memoryStorage(values))), [false, true, false, true]);
  saveSidebarCollapsed('reader-directory', false, storage);
  assert.deepEqual(ids.map(id => readSidebarCollapsed(id, storage)), [false, false, false, true]);
  assert.equal(readTheme(storage), 'night');
  assert.equal(values.get('ancient-history:original-script:v1'), 'simplified');
  values.set('ancient-history:sidebar:v1:home-sources', 'invalid');
  assert.equal(readSidebarCollapsed('home-sources', storage), false);
});

test('blocked browser storage cannot prevent changing colors or opening sidebars', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(readTheme(blocked), 'paper');
  assert.equal(readSidebarCollapsed('reader-directory', blocked), false);
  assert.doesNotThrow(() => saveTheme('night', blocked));
  assert.doesNotThrow(() => saveSidebarCollapsed('reader-directory', true, blocked));
});

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255);
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a, b) {
  const [dark, light] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (light + .05) / (dark + .05);
}

test('all three palettes keep body text, muted labels and action text readable', () => {
  const css = readFileSync(new URL('../src/appearance.css', import.meta.url), 'utf8');
  const palettes = [...css.matchAll(/:root(?:\[data-theme="(\w+)"\])?\s*\{([^}]+)\}/g)];
  assert.equal(palettes.length, 3);
  for (const [, name = 'paper', body] of palettes) {
    const tokens = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(([, key, value]) => [key, value]));
    for (const background of ['paper', 'surface']) {
      for (const foreground of ['ink', 'soft-ink', 'muted', 'accent']) {
        assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${name}: ${foreground} on ${background}`);
      }
    }
    assert.ok(contrast(tokens['on-accent'], tokens.accent) >= 4.5, `${name}: primary button text`);
  }
});
