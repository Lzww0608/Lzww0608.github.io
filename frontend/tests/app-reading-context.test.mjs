import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Run the actual App navigation callbacks with in-memory hooks. Rendering and
// scroll/loading hooks are outside this test; route resolution remains real.
test('App binds return and paragraph focus to each explicit reading destination', async () => {
  const { transformSync } = createRequire(import.meta.url)('esbuild');
  const modules = {};
  for (const name of ['data', 'eras', 'person-search-names', 'library', 'person-catalog', 'owner-review-route',
    'person-timeline-route', 'event-comparison-data', 'event-comparison-route', 'reading-navigation-state',
    'reading-navigation-guard', 'reading-shelf', 'reading-shelf-context']) {
    modules[`./${name}`] = await import(`../src/${name}.ts`);
  }
  let dirty = false, cursor = 0, pending = [], activeHash = '#person-sources/li-cunxu/old';
  const hooks = [];
  modules.react = {
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(value) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value;
      return [hooks[i], update => { const next = typeof update === 'function' ? update(hooks[i]) : update;
        if (next !== hooks[i]) { hooks[i] = next; dirty = true; } }];
    },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i];
      if (!old || deps.some((v, n) => v !== old[n])) { hooks[i] = deps; pending.push(fn); } },
    lazy: () => 'Lazy', Suspense: 'Suspense',
  };
  const history = { state: null, scrollRestoration: 'auto',
    replaceState(state, _title, url) { this.state = state; if (url?.includes('#')) activeHash = '#' + url.split('#')[1]; },
    go(distance) { throw new Error(`Unexpected history traversal ${distance}`); } };
  const location = { get hash() { return activeHash; },
    set hash(v) { activeHash = v.startsWith('#') ? v : '#' + v; history.state = null; },
    get href() { return 'http://test/' + activeHash; } };
  const window = new EventTarget();
  window.scrollTo = () => {};
  window.sessionStorage = { getItem: () => null, setItem: () => {} };
  const prior = Object.fromEntries(['history', 'location', 'window', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.assign(globalThis, { history, location, window, document: { title: '', getElementById: () => null } });
  modules['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  modules['./use-reading-position'] = { captureReadingPosition: () => {} };
  modules['./use-reading-progress'] = { clearReadingResume: () => {}, hydrateReadingProgress: () => {}, prepareReadingResume: () => {}, prepareReadingBookmark: () => {} };
  const output = transformSync(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
  const exported = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }), exported, exported.exports);
  const render = () => { for (let i = 0; i < 8; i++) { dirty = false; cursor = 0; const result = exported.exports.App();
    const effects = pending; pending = []; effects.forEach(fn => fn()); if (!dirty) return result; } throw new Error('Render loop'); };
  const find = (tree, predicate) => { if (Array.isArray(tree)) { for (const child of tree) { const found = find(child, predicate); if (found) return found; } }
    else if (tree && typeof tree === 'object') return predicate(tree) ? tree : find(tree.props?.children, predicate); };
  try {
    let tree = render();
    const reader = () => find(tree, n => n.type === 'Reader').props;
    const arrived = () => { window.dispatchEvent(new Event('hashchange')); tree = render(); };
    const navigate = route => { location.hash = route; arrived(); };
    find(tree, n => n.props?.person?.id === 'li-cunxu' && n.props.onReadSource).props.onReadSource('old-v028', 'old-v028-p16',
      { query: '', field: 'both', returnTo: 'person-sources/li-cunxu/old' });
    arrived();
    assert.equal(reader().returnTo, 'person-sources/li-cunxu/old');
    assert.equal(reader().focusParagraphId, 'old-v028-p16');
    assert.equal(reader().personId, 'li-cunxu');
    navigate('eras'); navigate('read-songshu/songshu-v001');
    for (const key of ['returnTo', 'focusParagraphId', 'personId']) assert.equal(reader()[key], undefined, key);
    assert.ok(find(tree, n => n.type === 'a' && n.props.href === '#people/southern-northern'));
    navigate('people');
    const people = () => find(tree, n => n.props?.eraId === 'five-dynasties' && n.props.onReadSource).props;
    people().onSelectPerson('li-cunxu'); people().onViewChange('graph'); tree = render();
    people().onReadSource('old-v028', 'old-v028-p17'); arrived();
    assert.equal(reader().focusParagraphId, 'old-v028-p17');
    assert.equal(reader().returnTo, undefined);
    assert.equal(reader().personId, 'li-cunxu');
    assert.match(location.hash, /paragraph=old-v028-p17/);
    navigate('read-old/old-v028');
    for (const key of ['returnTo', 'focusParagraphId', 'personId']) assert.equal(reader()[key], undefined, key);
  } finally {
    for (const [key, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
