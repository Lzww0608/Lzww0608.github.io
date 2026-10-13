async (page) => {
  const settings = null /* BENCHMARK_SETTINGS */;
  // A new tab isolates the page-scoped initialization observer for each run.
  // The independent CLI browser context remains the same; no user browser is touched.
  page = await page.context().newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.unrouteAll({ behavior: 'wait' });
  if (settings.mode === 'backend-offline') {
    await page.route('**/api/**', route => route.request().method() === 'GET'
      && /^\/api\/(?:chapters|people|passages)(?:\/|$)/.test(new URL(route.request().url()).pathname)
      ? route.abort('connectionfailed') : route.continue());
  }
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: settings.mode === 'slow' ? 150 : 0,
    downloadThroughput: settings.mode === 'slow' ? 1600000 / 8 : -1,
    uploadThroughput: settings.mode === 'slow' ? 750000 / 8 : -1,
    connectionType: settings.mode === 'slow' ? 'cellular3g' : 'none',
  });
  const requests = new Map();
  let clockStart = Date.now();
  cdp.on('Network.requestWillBeSent', event => {
    requests.set(event.requestId, { id: event.requestId, url: event.request.url, method: event.request.method, type: event.type, startMs: Date.now() - clockStart, timestamp: event.timestamp });
  });
  cdp.on('Network.responseReceived', event => {
    const item = requests.get(event.requestId);
    if (item) Object.assign(item, { status: event.response.status, mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache ?? false, responseMs: Date.now() - clockStart, protocol: event.response.protocol, contentLength: event.response.headers['content-length'] ?? event.response.headers['Content-Length'] ?? null });
  });
  cdp.on('Network.responseReceivedExtraInfo', event => {
    const item = requests.get(event.requestId);
    if (item) Object.assign(item, { wireStatus: event.statusCode });
  });
  cdp.on('Network.loadingFinished', event => {
    const item = requests.get(event.requestId);
    if (item) Object.assign(item, { encodedDataLength: event.encodedDataLength, durationMs: Math.round((event.timestamp - item.timestamp) * 1000), endMs: Date.now() - clockStart });
  });
  cdp.on('Network.loadingFailed', event => {
    const item = requests.get(event.requestId);
    if (item) Object.assign(item, { failure: event.errorText, canceled: event.canceled ?? false, durationMs: Math.round((event.timestamp - item.timestamp) * 1000), endMs: Date.now() - clockStart });
  });
  await page.addInitScript(settings => {
    if (!location.href.startsWith(settings.base)) return;
    localStorage.clear(); sessionStorage.clear();
    window.__readingBenchmark = { firstReadableMs: null, completeCurrentMs: null, linksReadyMs: null, completed: false };
    function check() {
      const marks = window.__readingBenchmark;
      if (!marks || marks.completed) return;
      const timeline = settings.kind === 'timeline';
      const host = document.querySelector(timeline ? '.person-timeline' : '.event-comparison');
      if (!host) return;
      const scope = timeline ? host : document.getElementById(`comparison-stage-${settings.stage}`);
      if (!scope) return;
      const readable = timeline
        ? scope.querySelector('.timeline-event-summary')?.textContent.trim().length > 20 && !!scope.querySelector('.person-timeline-event li')
        : scope.querySelector('.comparison-original')?.textContent.trim().length > 20;
      const complete = timeline
        ? scope.querySelectorAll('.person-timeline-event').length === settings.expectedEvents && ['ready', 'archive'].includes(host.dataset.readState)
        : scope.querySelectorAll('.comparison-source[data-status="available"] .comparison-original').length === settings.expectedSources
          && scope.querySelectorAll('.paragraph-translation').length === settings.expectedSources
          && new Set([...scope.querySelectorAll('.comparison-source')].map(source => source.dataset.sourceId)).size === settings.expectedSources
          && [...scope.querySelectorAll('.comparison-source')].every(source => settings.expectedSourceIds.includes(source.dataset.sourceId)
            && !!source.querySelector('.comparison-original')?.textContent.trim()
            && !!source.querySelector('.translation-content')?.textContent.trim())
          && scope.querySelectorAll('.sentence-translation-trigger').length > 0 && host.dataset.readState === 'ready';
      const linked = timeline ? host.dataset.linksReady === 'true' : host.dataset.linksState === 'ready';
      const now = Math.round(performance.now());
      if (readable && marks.firstReadableMs === null) {
        marks.firstReadableMs = now;
        marks.firstReadState = host.dataset.readState;
        marks.firstReadStatusText = document.querySelector('.timeline-read-status, .comparison-load-status')?.textContent.trim();
      }
      if (complete && marks.completeCurrentMs === null) marks.completeCurrentMs = now;
      if (linked && marks.linksReadyMs === null) marks.linksReadyMs = now;
      marks.completed = !!(marks.firstReadableMs !== null && marks.completeCurrentMs !== null && marks.linksReadyMs !== null);
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    addEventListener('DOMContentLoaded', check);
  }, settings);
  await page.goto('about:blank');
  requests.clear(); clockStart = Date.now();
  await page.goto(`${settings.base}#${settings.hash}`, { waitUntil: 'domcontentloaded', timeout: settings.timeout });
  let timedOut = false;
  try {
    await page.waitForFunction(() => window.__readingBenchmark?.completed, null, { timeout: settings.timeout });
  } catch { timedOut = true; }
  const marks = await page.evaluate(() => window.__readingBenchmark ?? {});
  const final = await page.evaluate(settings => {
    const host = document.querySelector(settings.kind === 'timeline' ? '.person-timeline' : '.event-comparison');
    const scope = settings.kind === 'timeline' ? host : document.getElementById(`comparison-stage-${settings.stage}`);
    return {
      url: location.href, title: document.title, readState: host?.dataset.readState, linksState: host?.dataset.linksState ?? host?.dataset.linksReady,
      sources: scope?.querySelectorAll('.comparison-source').length ?? 0,
      availableSources: scope?.querySelectorAll('.comparison-source[data-status="available"]').length ?? 0,
      actualSourceIds: [...(scope?.querySelectorAll('.comparison-source') ?? [])].map(source => source.dataset.sourceId),
      eventCount: host?.querySelectorAll('.person-timeline-event').length ?? 0,
      sentenceTriggers: scope?.querySelectorAll('.sentence-translation-trigger').length ?? 0,
      selectedBooks: [...document.querySelectorAll('.comparison-book-selection [aria-pressed="true"]')].map(el => el.textContent.trim()),
      readStatusText: document.querySelector('.timeline-read-status, .comparison-load-status')?.textContent.trim(),
      firstContent: scope?.querySelector('.timeline-event-summary, .comparison-original')?.textContent.trim().slice(0, 120),
      readyStageViewportTop: scope?.getBoundingClientRect().top,
    };
  }, settings);
  const readyRequests = [...requests.values()].map(item => ({ ...item }));
  const settledStart = Date.now();
  let networkSettled = true;
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch { networkSettled = false; }
  const networkSettleAfterReadyMs = Date.now() - settledStart;
  const coldRequests = [...requests.values()].map(item => ({ ...item }));
  const summarize = items => ({
    requests: items.length,
    getRequests: items.filter(item => item.method === 'GET').length,
    jsonRequests: items.filter(item => item.url.includes('/api/') || new URL(item.url).pathname.endsWith('.json')).length,
    apiRequests: items.filter(item => item.url.includes('/api/')).length,
    staticJsonRequests: items.filter(item => new URL(item.url).pathname.endsWith('.json')).length,
    notModifiedResponses: items.filter(item => (item.wireStatus ?? item.status) === 304).length,
    transferredBytes: items.reduce((sum, item) => sum + (item.encodedDataLength ?? 0), 0),
    failed: items.filter(item => item.failure).length,
    unfinished: items.filter(item => item.encodedDataLength === undefined && !item.failure).length,
  });
  let warm = null;
  if (settings.warm && !timedOut) {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    const before = requests.size;
    const controlSnapshot = await page.getByRole('navigation', { name: settings.kind === 'comparison' ? '对读阶段' : '人物年表年份', exact: true }).ariaSnapshot();
    if (!controlSnapshot.includes(settings.kind === 'comparison' ? settings.warmTitle : settings.warmButton)) throw new Error('Expected warm control was not present in the observed navigation snapshot');
    const switchStart = Date.now();
    if (settings.kind === 'comparison') {
      await page.getByRole('navigation', { name: '对读阶段', exact: true }).getByRole('button', { name: settings.warmTitle, exact: true }).click();
      await page.waitForFunction(settings => {
        const stage = document.getElementById(`comparison-stage-${settings.warmStage}`);
        const sources = [...(stage?.querySelectorAll('.comparison-source') ?? [])];
        return location.hash.includes(`stage=${settings.warmStage}`)
          && sources.length === settings.warmSources
          && new Set(sources.map(source => source.dataset.sourceId)).size === settings.warmSources
          && sources.every(source => source.dataset.status === 'available' && settings.warmSourceIds.includes(source.dataset.sourceId)
            && !!source.querySelector('.comparison-original')?.textContent.trim()
            && !!source.querySelector('.translation-content')?.textContent.trim())
          && stage.querySelectorAll('.sentence-translation-trigger').length > 0;
      }, settings, { timeout: settings.timeout });
    } else {
      await page.getByRole('navigation', { name: '人物年表年份', exact: true }).getByRole('button', { name: settings.warmButton, exact: true }).click();
      await page.waitForFunction(() => location.hash.includes('event=') && !!document.querySelector('.person-timeline-event[data-focused="true"]'), null, { timeout: settings.timeout });
    }
    const switchMs = Date.now() - switchStart;
    await page.waitForFunction(settings => settings.kind === 'comparison'
      ? document.querySelector('.event-comparison')?.dataset.linksState === 'ready'
      : document.querySelector('.person-timeline')?.dataset.linksReady === 'true', settings, { timeout: settings.timeout });
    const switchLinksReadyMs = Date.now() - switchStart;
    const switchedUrl = page.url();
    const backStart = Date.now();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(settings => {
      if (location.hash !== `#${settings.hash}`) return false;
      if (settings.kind === 'timeline') {
        const host = document.querySelector('.person-timeline');
        return host?.querySelectorAll('.person-timeline-event').length === settings.expectedEvents
          && ['ready', 'archive'].includes(host.dataset.readState) && host.dataset.linksReady === 'true';
      }
      const stage = document.getElementById(`comparison-stage-${settings.stage}`);
      const sources = [...(stage?.querySelectorAll('.comparison-source') ?? [])];
      return sources.length === settings.expectedSources
        && new Set(sources.map(source => source.dataset.sourceId)).size === settings.expectedSources
        && sources.every(source => source.dataset.status === 'available' && settings.expectedSourceIds.includes(source.dataset.sourceId)
          && !!source.querySelector('.comparison-original')?.textContent.trim()
          && !!source.querySelector('.translation-content')?.textContent.trim())
        && stage.querySelectorAll('.sentence-translation-trigger').length > 0
        && document.querySelector('.event-comparison')?.dataset.linksState === 'ready';
    }, settings, { timeout: settings.timeout });
    await page.waitForTimeout(100);
    const returnedContent = await page.evaluate(settings => {
      const scope = settings.kind === 'timeline' ? document.querySelector('.person-timeline') : document.getElementById(`comparison-stage-${settings.stage}`);
      return { viewportTop: scope?.getBoundingClientRect().top, scrollY, sourceIds: [...(scope?.querySelectorAll('.comparison-source') ?? [])].map(source => source.dataset.sourceId), firstContent: scope?.querySelector('.timeline-event-summary, .comparison-original')?.textContent.trim().slice(0, 120), selectedBooks: [...document.querySelectorAll('.comparison-book-selection [aria-pressed="true"]')].map(el => el.textContent.trim()) };
    }, settings);
    warm = { switchMs, switchLinksReadyMs, returnMs: Date.now() - backStart, returnSettlingMs: 100, controlSnapshot, switchedUrl, returnedUrl: page.url(), returnedContent, requests: summarize([...requests.values()].slice(before)), requestDetails: [...requests.values()].slice(before) };
  }
  await cdp.detach();
  const result = {
    settings, conditions: { latencyMs: settings.mode === 'slow' ? 150 : 0, downloadMbps: settings.mode === 'slow' ? 1.6 : null, uploadMbps: settings.mode === 'slow' ? 0.75 : null, coldHttpCacheDisabled: true, localPublicReadingStorageCleared: true, realResponses: settings.mode !== 'backend-offline', backendOffline: settings.mode === 'backend-offline' ? 'Only public GET /api requests aborted; static site remains reachable.' : null, note: 'CDP emulation on independent Chromium, local production preview. No real home-network disconnection was measured. Marks observe actual DOM content availability; they are not a synthetic heading-only paint score.' },
    marks, timedOut, final, network: { summary: summarize(coldRequests), readySummary: summarize(readyRequests), networkSettled, networkSettleAfterReadyMs, requests: coldRequests, readyRequests, jsonUris: [...new Set(coldRequests.filter(item => item.url.includes('/api/') || new URL(item.url).pathname.endsWith('.json')).map(item => item.url))] }, warm,
  };
  await page.close();
  return result;
}
