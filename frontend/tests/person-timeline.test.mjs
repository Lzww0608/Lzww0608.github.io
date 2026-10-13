import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { readPersonTimeline } from '../src/person-timeline-loader.ts';
import { parsePersonTimelineDocument, parsePersonTimelineResponse } from '../src/person-timeline-schema.ts';
import { hasPersonTimeline, personTimelineRoute, resolvePersonTimelineRoute } from '../src/person-timeline-route.ts';
import { chapterRoute, libraryChapters, personSourcesRoute, resolveReadingRoute, resolveRoute } from '../src/library.ts';
import { eventComparisonRoute, resolveEventComparisonRoute } from '../src/event-comparison-route.ts';
import { eventTimelineLinks } from '../src/event-timeline-links.ts';
import { createPublicReadingFetcher } from '../src/public-reading-fetch.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const library = loadLibrary(), allChapters = loadPublishedChapters(library);
const source = allChapters.find(chapter => chapter.id === 'old-v025');
const paragraph = source.paragraphs.find(paragraph => paragraph.id === 'old-v025-p2');
const reference = { chapterId: source.id, paragraphId: paragraph.id, originalRevision: paragraph.revision,
  originalSha256: hash(paragraph.original), excerpt: [...paragraph.original].slice(0, 70).join('') };
const event = { id: 'li-keyong-fixture-birth', year: 856, sortOrder: 1, title: '出生记载', summary: '底本记述李克用的出生与家世。',
  sourceDate: '大中十年', precision: 'year', phase: 'early', evidence: [reference] };
const document = { schemaVersion: 1, scope: 'current-archive', personId: 'li-keyong', events: [event] };
const resolvedReference = { ...reference, bookId: source.bookId, bookTitle: source.bookTitle, chapterTitle: source.title, paragraph };
const response = { ...document, events: [{ ...event, evidence: [resolvedReference] }], unavailableCount: 0, resultSetRevision: hash('fixture-version') };
const options = { personId: document.personId, apiBase: '', archiveBase: '/', signal: new AbortController().signal };
const archive = async (url, inputDocument = document, inputSource = source) => {
  if (url.endsWith(`/person-timelines/${document.personId}.json`)) return Response.json(inputDocument);
  if (url.endsWith(`/chapters/${source.id}.json`)) return Response.json(inputSource);
  return new Response('', { status: 404 });
};

test('every real timeline document remains readable with exact canonical sources and complete published translations when the API is offline', async () => {
  const root = new URL('../../content/person-timelines/', import.meta.url);
  const documents = readdirSync(root).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(new URL(file, root), 'utf8')));
  assert.ok(documents.some(document => document.personId === 'li-keyong'));
  assert.ok(documents.some(document => document.personId === 'li-cunxu'));
  const chapters = new Map(allChapters.map(chapter => [chapter.id, chapter]));
  for (const document of documents) {
    const result = await readPersonTimeline({ ...options, personId: document.personId, fetcher: async url => {
      if (url.endsWith(`/person-timelines/${document.personId}.json`)) return Response.json(document);
      const chapterId = /\/chapters\/([a-z0-9-]+)\.json$/.exec(url)?.[1];
      return chapterId && chapters.has(chapterId) ? Response.json(chapters.get(chapterId)) : new Response('', { status: 404 });
    } });
    assert.equal(result.source, 'archive');
    assert.equal(result.page.unavailableCount, 0);
    assert.deepEqual(result.page.events.map(event => event.id), document.events.map(event => event.id));
    for (const event of result.page.events) for (const evidence of [...event.evidence, ...(event.variants?.flatMap(variant => variant.evidence) ?? [])]) {
      const canonical = chapters.get(evidence.chapterId).paragraphs.find(paragraph => paragraph.id === evidence.paragraphId);
      assert.deepEqual(evidence.paragraph, canonical);
      assert.ok(evidence.paragraph.translation?.text, `${event.id}: ${evidence.paragraphId} has a complete published translation`);
      assert.equal(hash(evidence.paragraph.original), evidence.originalSha256);
    }
  }
});

test('offline timeline resolves the original paragraph and complete published translation without altering either', async () => {
  const before = JSON.stringify(source), previews = [];
  const result = await readPersonTimeline({ ...options, onArchive: page => previews.push(page), fetcher: url => archive(url) });
  assert.equal(result.source, 'archive');
  assert.equal(previews.length, 1);
  assert.equal(result.page.events[0].evidence[0].paragraph.id, paragraph.id);
  assert.deepEqual(result.page.events[0].evidence[0].paragraph.translation, paragraph.translation);
  assert.equal(result.page.events[0].evidence[0].excerpt, reference.excerpt);
  assert.equal(JSON.stringify(source), before);
});

test('latest valid API translations win over static copies and change the result snapshot', async () => {
  const latest = structuredClone(response);
  latest.events[0].evidence[0].paragraph.translation = { ...paragraph.translation, id: 'fixture-new-version', version: paragraph.translation.version + 1, text: `${paragraph.translation.text}校订说明。` };
  latest.resultSetRevision = hash(JSON.stringify(latest.events));
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: async (url, init) => {
    assert.equal(init.credentials, 'omit');
    return url.startsWith('https://api.example') ? Response.json(latest) : archive(url);
  } });
  assert.equal(result.source, 'api');
  assert.equal(result.page.events[0].evidence[0].paragraph.translation.id, 'fixture-new-version');
  assert.notEqual(result.page.resultSetRevision, response.resultSetRevision);
});

test('a valid API timeline completes before a slow static chapter and does not request archive copies', async () => {
  const requests = [];
  let releaseArchive;
  const delayedArchive = new Promise(resolve => { releaseArchive = resolve; });
  const reading = readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: async url => {
    requests.push(url);
    if (url.startsWith('https://api.example')) return Response.json(response);
    await delayedArchive;
    return archive(url);
  } });
  const outcome = await Promise.race([
    reading.then(result => ({ result })),
    new Promise(resolve => setTimeout(() => resolve({ waitingForArchive: true }), 80)),
  ]);
  releaseArchive();
  await reading;
  assert.equal(outcome.waitingForArchive, undefined, 'valid API data must be usable while static chapters are delayed');
  assert.equal(outcome.result.source, 'api');
  assert.deepEqual(requests, ['https://api.example/api/people/li-keyong/timeline']);
});

test('a pending API cannot display or request archived events before network failure is confirmed', async () => {
  const requests = [], previews = [];
  let rejectApi;
  const api = new Promise((resolve, reject) => { rejectApi = reject; });
  const reading = readPersonTimeline({ ...options, apiBase: 'https://api.example', onArchive: page => previews.push(page), fetcher: async url => {
    requests.push(url);
    if (url.startsWith('https://api.example')) return api;
    return archive(url);
  } });
  await new Promise(resolve => setTimeout(resolve, 30));
  const beforeFailure = { requests: [...requests], previews: [...previews] };
  rejectApi(new TypeError('Network unavailable'));
  const result = await reading;
  assert.deepEqual(beforeFailure.requests, ['https://api.example/api/people/li-keyong/timeline']);
  assert.deepEqual(beforeFailure.previews, []);
  assert.equal(result.source, 'archive');
  assert.equal(previews.length, 1);
  assert.deepEqual(requests.slice(1), ['/history/person-timelines/li-keyong.json', '/history/chapters/old-v025.json']);
});

test('HTTP authority includes empty, invalid and truncated bodies without requesting an older archive', async () => {
  for (const makeResponse of [
    () => Response.json({ ...response, events: [], unavailableCount: 1 }),
    () => new Response('', { status: 404 }),
    () => new Response('', { status: 500 }),
    () => new Response('{bad'),
    () => Response.json({ ...response, personId: 'li-cunxu' }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Body was truncated')); } })),
  ]) {
    const requests = [], previews = [];
    try {
      await readPersonTimeline({ ...options, apiBase: 'https://api.example', onArchive: page => previews.push(page), fetcher: async url => {
        requests.push(url);
        return url.startsWith('https://api.example') ? makeResponse() : archive(url);
      } });
    } catch (error) { assert.match(error.message, /could not be verified/); }
    assert.deepEqual(requests, ['https://api.example/api/people/li-keyong/timeline']);
    assert.deepEqual(previews, []);
  }
});

test('a shared public read with received HTTP headers and a timed out body cannot become an offline archive', async () => {
  const requests = [], previews = [];
  const shared = createPublicReadingFetcher(async (url, init) => {
    requests.push(url);
    if (!url.startsWith('https://api.example')) return archive(url);
    return new Response(new ReadableStream({ start(controller) {
      // Real headers arrive, then the body remains pending until cancellation.
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    } }));
  });
  await assert.rejects(readPersonTimeline({ ...options, apiBase: 'https://api.example', onArchive: page => previews.push(page),
    fetcher: (url, init) => shared(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(25)]) }),
  }), /could not be verified/);
  assert.deepEqual(requests, ['https://api.example/api/people/li-keyong/timeline']);
  assert.deepEqual(previews, []);
});

test('navigation abort while the API is pending never starts an archive request or callback', async () => {
  const controller = new AbortController(), requests = [], previews = [];
  const reading = readPersonTimeline({ ...options, apiBase: 'https://api.example', signal: controller.signal, onArchive: page => previews.push(page),
    fetcher: async (url, init) => {
      requests.push(url);
      if (!url.startsWith('https://api.example')) return archive(url);
      return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); });
    } });
  controller.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.deepEqual(requests, ['https://api.example/api/people/li-keyong/timeline']);
  assert.deepEqual(previews, []);
});

test('comparison event selections request only their unique stable event IDs while keeping API authority', async () => {
  const requests = [], selected = [event.id, event.id];
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example/', eventIds: selected, fetcher: async url => {
    requests.push(url);
    return Response.json(response);
  } });
  assert.deepEqual(requests, ['https://api.example/api/people/li-keyong/timeline?eventId=li-keyong-fixture-birth']);
  assert.equal(result.source, 'api');
  assert.deepEqual(result.page.events.map(event => event.id), ['li-keyong-fixture-birth']);
  assert.deepEqual(selected, [event.id, event.id]);
  const empty = await readPersonTimeline({ ...options, apiBase: 'https://api.example', eventIds: [], fetcher: async url => {
    assert.equal(url, 'https://api.example/api/people/li-keyong/timeline');
    return Response.json(response);
  } });
  assert.deepEqual(empty.page.events, []);
  await assert.rejects(readPersonTimeline({ ...options, apiBase: 'https://api.example', eventIds: [], fetcher: async url => {
    assert.equal(url, 'https://api.example/api/people/li-keyong/timeline');
    return new Response('', { status: 500 });
  } }), /could not be verified/);
});

test('successful empty or suspended API timelines are authoritative and cannot preview an older archive after responding', async () => {
  const empty = { ...response, events: [], unavailableCount: 1, resultSetRevision: hash('paused') }, previews = [];
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', onArchive: value => previews.push(value),
    fetcher: url => url.startsWith('https://api.example') ? Promise.resolve(Response.json(empty)) : archive(url) });
  assert.equal(result.source, 'api');
  assert.deepEqual(result.page.events, []);
  assert.equal(result.page.unavailableCount, 1);
  assert.deepEqual(previews, []);
});

test('responding API errors, unknown people, malformed JSON and invalid bindings cannot revive static events', async () => {
  const invalid = structuredClone(response);
  invalid.events[0].evidence[0].paragraph.original += '来源已变化。';
  for (const apiResponse of [new Response('', { status: 404 }), new Response('', { status: 500 }),
    new Response('{bad'), Response.json(invalid), Response.json({ ...response, personId: 'li-cunxu' })]) {
    await assert.rejects(readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: url =>
      url.startsWith('https://api.example') ? Promise.resolve(apiResponse) : archive(url) }), /could not be verified/);
  }
});

test('network loss falls back to independently bound archive sources, and navigation cancellation stops callbacks', async () => {
  const result = await readPersonTimeline({ ...options, apiBase: 'https://api.example', fetcher: url => {
    if (url.startsWith('https://api.example')) throw new TypeError('Network unavailable');
    return archive(url);
  } });
  assert.equal(result.source, 'archive');
  const controller = new AbortController(), previews = [];
  await assert.rejects(readPersonTimeline({ ...options, signal: controller.signal, onArchive: page => previews.push(page), fetcher: async url => {
    controller.abort(); return archive(url);
  } }), error => error.name === 'AbortError');
  assert.deepEqual(previews, []);
});

test('changed originals pause the whole event, including an independently stale variant', async () => {
  for (const mutate of [value => value.events[0].evidence[0].originalRevision++, value => {
    value.events[0].variants = [{ label: '另书异文', sourceDate: '大中十年', year: 856,
      summary: '另一来源的记载单独列出。', notes: ['保留来源差异。'], evidence: [{ ...reference, originalSha256: '0'.repeat(64) }] }];
  }]) {
    const changed = structuredClone(document); mutate(changed);
    const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, changed) });
    assert.deepEqual(result.page.events, []);
    assert.equal(result.page.unavailableCount, 1);
  }
});

test('a source without a matching nonblank published translation pauses its whole event and cannot validate an API event', async () => {
  for (const translation of [null, { ...paragraph.translation, text: '' }, { ...paragraph.translation, text: '   ' }]) {
    const missing = structuredClone(source);
    missing.paragraphs.find(item => item.id === reference.paragraphId).translation = translation;
    assert.equal(hash(missing.paragraphs.find(item => item.id === reference.paragraphId).original), reference.originalSha256);
    const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, document, missing) });
    assert.deepEqual(result.page.events, []);
    assert.equal(result.page.unavailableCount, 1);
    const incomplete = structuredClone(response);
    incomplete.events[0].evidence[0].paragraph.translation = translation;
    await assert.rejects(parsePersonTimelineResponse(incomplete, document.personId));
  }
  const completeParagraph = source.paragraphs.find(item => item.id !== reference.paragraphId);
  const completeReference = { chapterId: source.id, paragraphId: completeParagraph.id, originalRevision: completeParagraph.revision,
    originalSha256: hash(completeParagraph.original), excerpt: [...completeParagraph.original].slice(0, 40).join('') };
  const variantOnlyMissing = structuredClone(document);
  variantOnlyMissing.events[0].evidence = [completeReference];
  variantOnlyMissing.events[0].variants = [{ label: '另一来源的记载', sourceDate: '大中十年', evidence: [reference] }];
  const missing = structuredClone(source);
  missing.paragraphs.find(item => item.id === reference.paragraphId).translation = null;
  const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, variantOnlyMissing, missing) });
  assert.deepEqual(result.page.events, []);
  assert.equal(result.page.unavailableCount, 1);
});

test('timeline schema rejects duplicate events, unknown phases, guessed dates, ordering and forged evidence', async () => {
  assert.equal(parsePersonTimelineDocument(document, document.personId).events.length, 1);
  for (const mutate of [value => value.events.push(value.events[0]), value => value.events[0].precision = 'approximate',
    value => value.events[0].phase = 'unknown', value => value.events[0].year = -1,
    value => value.events[0].evidence[0].chapterId = 'old-not-existing',
    value => value.events[0].evidence[0].paragraphId = 'new-v04-p1',
    value => value.events[0].id = 'li-cunxu-foreign-event',
    value => value.events.push({ ...value.events[0], id: 'li-keyong-earlier-fixture', year: 855 }),
    value => value.events.push({ ...value.events[0], id: 'li-keyong-same-order-fixture' })]) {
    const invalid = structuredClone(document); mutate(invalid);
    assert.throws(() => parsePersonTimelineDocument(invalid, document.personId));
  }
  for (const mutate of [value => value.events[0].evidence[0].paragraph.revision++, value => value.events[0].evidence[0].excerpt = '不是原文的引文。',
    value => value.events[0].evidence[0].bookTitle = '其他书籍', value => value.events[0].evidence[0].chapterTitle = '其他章节',
    value => value.events[0].evidence[0].paragraph.id = 'old-v025-p3', value => value.unavailableCount = -1]) {
    const invalid = structuredClone(response); mutate(invalid);
    await assert.rejects(parsePersonTimelineResponse(invalid, document.personId));
  }
});

test('person timeline routes expose only real registered timelines and retain a safe exact-event reader return', () => {
  const summary = JSON.parse(readFileSync(new URL('../src/person-timeline-summary.json', import.meta.url), 'utf8'));
  const entry = summary.people.find(person => person.personId === 'li-keyong');
  const route = personTimelineRoute(entry.personId, entry.eventIds[0]);
  assert.equal(hasPersonTimeline('li-keyong'), true);
  assert.equal(hasPersonTimeline('li-cunxu'), true);
  assert.equal(hasPersonTimeline('unregistered-person'), false);
  assert.equal(resolveRoute(`#${route}`), route);
  assert.equal(resolvePersonTimelineRoute(route).person.id, 'li-keyong');
  const chapter = libraryChapters.find(chapter => chapter.id === 'old-v025');
  const read = chapterRoute(chapter, { query: '', field: 'both', paragraphId: paragraph.id, returnTo: route });
  assert.equal(resolveReadingRoute(read).returnTo, route);
  assert.equal(resolveReadingRoute(read).focusParagraphId, paragraph.id);
  for (const invalid of ['https://evil.example', 'person-timeline/unregistered-person', 'person-timeline/li-keyong/extra',
    'person-timeline/li-keyong?event=https://evil.example', 'person-timeline/li-keyong?event=not-registered',
    `person-timeline/li-keyong?event=${entry.eventIds[0]}&event=${entry.eventIds[0]}`, 'person-timeline/li-keyong?token=secret']) {
    assert.equal(resolvePersonTimelineRoute(invalid), null);
    assert.equal(resolveReadingRoute(`read-old/${chapter.id}?return=${encodeURIComponent(invalid)}`).returnTo, undefined);
  }
});

test('unknown dates and bounded periods survive the real reader as uncertainty without a substituted year', async () => {
  const input = structuredClone(document);
  input.events.push({ ...structuredClone(input.events[0]), id: 'li-keyong-undated-fixture', year: null,
    precision: 'undated', phase: 'uncertain', sourceDate: '本传未记明确纪年', sortOrder: 90 });
  input.events.push({ ...structuredClone(input.events[0]), id: 'li-keyong-range-fixture', year: null,
    precision: 'range', phase: 'uncertain', sourceDate: '原书记月跨两个西历年', yearRange: { start: 913, end: 914 }, sortOrder: 91 });
  const result = await readPersonTimeline({ ...options, fetcher: url => archive(url, input) });
  assert.equal(result.page.events[1].year, null);
  assert.equal(result.page.events[1].precision, 'undated');
  assert.deepEqual(result.page.events[2].yearRange, { start: 913, end: 914 });
  assert.equal(result.page.events[2].year, null);
  for (const change of [value => value.events[2].yearRange.end = 912, value => value.events[2].year = 913,
    value => value.events[1].precision = 'year', value => value.events[2].yearRange = undefined,
    value => value.events[1].phase = 'service', value => value.events.reverse()]) {
    const invalid = structuredClone(input); change(invalid);
    assert.throws(() => parsePersonTimelineDocument(invalid, input.personId));
  }
});

// Render the real component in controlled completed/pending read states. Only
// browser hooks and their asynchronous inputs are replaced; real route data,
// event grouping, evidence rendering and comparison controls stay in use.
const componentSource = await transform(readFileSync(new URL('../src/PersonTimeline.tsx', import.meta.url), 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env.BASE_URL': '"/"' },
});
function renderTimelineState(page, comparisonLinks = [], linksReady = false, destination = {}) {
  const captured = {};
  const states = [destination.readState === 'error' ? null : page, { personId: page.personId, state: destination.readState ?? 'ready' }, 0, comparisonLinks, linksReady];
  let stateIndex = 0;
  const modules = {
    react: { ...React, useState: initial => {
      const index = stateIndex++;
      return [index === 1 && typeof initial === 'string' ? states[index].state : states[index], () => {}];
    }, useMemo: callback => callback(), useEffect: () => {} },
    '@phosphor-icons/react': { ArrowLeft: () => null, ArrowRight: () => null },
    './history-api': { historyApiBase: 'https://api.example' },
    './person-timeline-loader': { readPersonTimeline },
    './person-timeline-route': { personTimelineRoute },
    './event-comparison-route': { eventComparisonRoute, resolveEventComparisonRoute },
    './use-reading-position': { useReadingPosition: value => { captured.position = value; } },
    './use-reading-progress': { useReadingProgress: value => { captured.progress = value; return { ready: value.ready, stale: false }; } },
    './BookmarkButton': { BookmarkButton: () => null },
    './event-timeline-links-loader': { readTimelineComparisonLinks: () => { throw new Error('Effects are not started by static rendering'); } },
    './event-timeline-links': { eventTimelineLinks },
    './library': { personSourcesRoute },
    './CollapsibleSidebar': { useSidebarState: () => ({ collapsed: false, toggle: () => {} }), CollapsibleSidebar: ({ children }) => React.createElement('aside', null, children) },
    './use-original-script': { useOriginalScript: () => ({ script: 'traditional', displayScript: 'traditional', selectScript: () => {} }) },
    './person-catalog': { personDisplayPeriod: () => '后唐' },
    './person-timeline.css': {},
  };
  const module = { exports: {} }, nativeRequire = createRequire(import.meta.url);
  vm.runInNewContext(componentSource.code, { module, exports: module.exports, require: name => modules[name] ?? nativeRequire(name) });
  const eventId = destination.eventId ?? page.events[0].id, route = personTimelineRoute(destination.personId ?? page.personId, eventId);
  const person = resolvePersonTimelineRoute(route).person;
  const element = module.exports.PersonTimeline({ person, route, eventId, go: () => {}, onReadSource: () => {} });
  return { ...captured, html: renderToStaticMarkup(element), eventId };
}

const componentDocument = JSON.parse(readFileSync(new URL('../../content/person-timelines/li-cunxu.json', import.meta.url), 'utf8'));
const componentPage = (await readPersonTimeline({ ...options, personId: 'li-cunxu', eventIds: ['li-cunxu-huliu'], fetcher: async url => {
  if (url.endsWith('/person-timelines/li-cunxu.json')) return Response.json(componentDocument);
  const chapterId = /\/chapters\/([a-z0-9-]+)\.json$/.exec(url)?.[1];
  const chapter = allChapters.find(source => source.id === chapterId);
  return chapter ? Response.json(chapter) : new Response('', { status: 404 });
} })).page;

test('a final public timeline can restore its exact event before unrelated comparison proof completes', () => {
  const rendered = renderTimelineState(componentPage);
  assert.equal(rendered.progress.ready, true, 'a verified timeline must not wait for comparisons to verify its saved event binding');
  assert.equal(rendered.position.ready, true);
  assert.equal(rendered.position.targetId, 'timeline-event-li-cunxu-huliu');
});

test('comparison slots keep the same stage controls while proof is pending, valid or unavailable', () => {
  const page = componentPage, huliu = page.events[0];
  const registered = eventTimelineLinks.find(document => document.comparisonId === 'huliu').links.find(link => link.personId === 'li-cunxu' && link.eventId === huliu.id);
  const readyLink = { event: page.events[0], comparisonId: 'huliu', stageIds: registered.stageIds };
  const pending = renderTimelineState(page), verified = renderTimelineState(page, [readyLink], true), unavailable = renderTimelineState(page, [], true);
  const controls = html => [...html.matchAll(/<button[^>]*aria-label="胡柳陂之战史料对读：([^"]+)"[^>]*>/g)].map(match => ({ label: match[1], disabled: match[0].includes('disabled=""') }));
  const initialControls = controls(pending.html);
  assert.equal(initialControls.length, registered.stageIds.length, 'registered stage slots are present before late proof responses change the layout');
  assert.ok(initialControls.every(control => control.disabled));
  assert.deepEqual(controls(verified.html).map(control => control.label), initialControls.map(control => control.label));
  assert.ok(controls(verified.html).every(control => !control.disabled));
  assert.deepEqual(controls(unavailable.html), initialControls);
  assert.match(pending.html, /正在核验史料对读/);
  assert.match(unavailable.html, /对读出处暂时无法核验/);
});

test('partial comparison proof enables only the stages whose current sources were verified', () => {
  const registered = eventTimelineLinks.find(document => document.comparisonId === 'huliu').links.find(link => link.personId === 'li-cunxu' && link.eventId === 'li-cunxu-huliu');
  const link = { event: componentPage.events[0], comparisonId: 'huliu', stageIds: [registered.stageIds[0]] };
  const rendered = renderTimelineState(componentPage, [link], true);
  const controls = [...rendered.html.matchAll(/<button[^>]*aria-label="胡柳陂之战史料对读：[^"]+"[^>]*>/g)];
  assert.equal(controls.filter(match => !match[0].includes('disabled=""')).length, 1);
  assert.equal(controls.filter(match => match[0].includes('disabled=""')).length, registered.stageIds.length - 1);
  assert.match(rendered.html, /部分对读出处暂时无法核验/);
});

test('changing people cannot position a new destination from the previous persons completed timeline', () => {
  const nextDocument = JSON.parse(readFileSync(new URL('../../content/person-timelines/li-keyong.json', import.meta.url), 'utf8'));
  for (const readState of ['ready', 'error']) {
    const rendered = renderTimelineState(componentPage, [], false, { personId: 'li-keyong', eventId: nextDocument.events[0].id, readState });
    assert.equal(rendered.progress.ready, false);
    assert.equal(rendered.position.ready, false);
    assert.match(rendered.html, /data-read-state="loading"/);
    assert.doesNotMatch(rendered.html, /data-reading-anchor="timeline-event-li-cunxu-huliu"/);
  }
});
