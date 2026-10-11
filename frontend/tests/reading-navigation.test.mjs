import test from 'node:test';
import assert from 'node:assert/strict';
import { eventComparisonRoute, resolveEventComparisonRoute } from '../src/event-comparison-route.ts';
import { personTimelineRoute, resolvePersonTimelineRoute } from '../src/person-timeline-route.ts';
import { chapterRoute, libraryChapters, resolveReadingRoute, resolveRoute } from '../src/library.ts';
import { chooseReadingAnchor, createReadingNavigationSession, readingPositionDecision, readingSnapshotCurrent } from '../src/reading-navigation-state.ts';
import { createNavigationDecision, createReadingTraversalGuard } from '../src/reading-navigation-guard.ts';

const a = personTimelineRoute('li-cunxu', 'li-cunxu-baixiang');
const c = eventComparisonRoute('baixiang', 'battle');
const b = personTimelineRoute('zhou-dewei', 'zhou-dewei-baixiang');
const position = (anchorId, offset, scrollY = 4200, details = {}) => ({ anchorId, offset, scrollY, details });

test('verified persistent hydration retains the current opaque entry and cannot invent return ancestors', () => {
  const session = createReadingNavigationSession();
  const entry = session.activate(c);
  const previousActivation = entry.activation;
  const saved = position('comparison-stage-battle', -200, 0, { 'root/details/0': true });
  assert.equal(session.hydrateCurrent(c, { position: saved, view: { selectedBooks: ['new'], fontSize: 24 } }), true);
  assert.equal(session.current().id, entry.id);
  assert.ok(session.current().activation > previousActivation);
  assert.equal(session.current().persistentRestore, true);
  assert.equal(session.size(), 1);
  assert.equal(session.returnDistance(a, a), null);
  assert.deepEqual(readingPositionDecision(session.current()), { kind: 'restore', position: saved });
  saved.offset = -999;
  assert.equal(session.current().position.offset, -200);
});

test('persistent hydration rejects another route and never overrides user positioning cancellation', () => {
  const session = createReadingNavigationSession();
  session.activate(c);
  assert.equal(session.hydrateCurrent(a, { position: position('timeline-event-li-cunxu-baixiang', 24) }), false);
  assert.equal(session.current().intent, 'target');
  session.cancel();
  assert.equal(session.hydrateCurrent(c, { position: position('comparison-stage-battle', 24) }), false);
  assert.deepEqual(readingPositionDecision(session.current(), 'comparison-stage-battle'), { kind: 'cancel' });
});

test('top-only persistent metadata restores controls without treating an old scroll number as a target', () => {
  const session = createReadingNavigationSession();
  session.activate(c);
  session.savePosition(position('old', -200, 9000));
  assert.equal(session.hydrateCurrent(c, { view: { fontSize: 25 } }), true);
  assert.equal(session.current().position, undefined);
  assert.deepEqual(readingPositionDecision(session.current()), { kind: 'top' });
  assert.equal(session.readView(c, {}).fontSize, 25);
});

test('a delayed binding check cannot hydrate a fresh target in the same route, another history visit, or a cleared resume intent', async () => {
  const session = createReadingNavigationSession();
  const first = session.activate(c);
  const expected = { route: c, entryId: first.id, activation: first.activation, resumeId: 11 };
  let activeResumeId = 11;
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; }).then(() => {
    if (readingSnapshotCurrent(session.current(), expected, activeResumeId)) session.hydrateCurrent(c, { position: position('comparison-stage-battle', -700) });
  });
  assert.equal(readingSnapshotCurrent(session.current(), expected, activeResumeId), true);
  activeResumeId = undefined;
  assert.equal(readingSnapshotCurrent(session.current(), expected, activeResumeId), false);
  activeResumeId = 11;
  session.activate(c, first.id); // Explicit same-route activation after a new target.
  assert.equal(readingSnapshotCurrent(session.current(), expected, activeResumeId), false);
  finish(); await delayed;
  assert.equal(session.current().position, undefined);
  session.activate(a);
  const second = session.activate(c);
  assert.notEqual(second.id, first.id);
  assert.equal(readingSnapshotCurrent(second, expected, activeResumeId), false);
});

test('real same-battle timeline and comparison links keep a checked single return and Reader preserves that context', () => {
  const comparison = eventComparisonRoute('baixiang', 'battle', a);
  assert.equal(resolveEventComparisonRoute(comparison).returnTo, a);
  const timeline = personTimelineRoute('zhou-dewei', 'zhou-dewei-baixiang', comparison);
  assert.equal(resolvePersonTimelineRoute(timeline).returnTo, c);
  assert.equal(resolveRoute(`#${timeline}`), timeline);
  // Changing the selected stage must not drop the original timeline return.
  const aftermath = eventComparisonRoute('baixiang', 'aftermath', resolveEventComparisonRoute(comparison).returnTo);
  assert.equal(resolveEventComparisonRoute(aftermath).returnTo, a);
  const chapter = libraryChapters.find(item => item.id === 'old-v027');
  const reader = chapterRoute(chapter, { paragraphId: 'old-v027-p18', query: '', field: 'both', returnTo: comparison });
  assert.equal(resolveReadingRoute(reader).returnTo, comparison);
  assert.equal(resolveEventComparisonRoute(resolveReadingRoute(reader).returnTo).returnTo, a);
});

test('untrusted return addresses cannot create external navigation, unknown identities, ambiguous parameters or nested loops', () => {
  const badLeaves = [
    'https://evil.invalid/', '//evil.invalid/x', 'javascript:alert(1)', '#'+a,
    'person-timeline/missing', 'person-timeline/li-cunxu?event=zhou-dewei-baixiang',
    'event-comparison/baixiang?stage=unknown', 'event-comparison/missing?stage=battle',
    `${a}&event=li-cunxu-baixiang`, `${c}&stage=battle`, `${c}&extra=x`,
    `${c}&return=${encodeURIComponent(a)}`, `${a}&return=${encodeURIComponent(c)}`,
  ];
  for (const leaf of badLeaves) {
    const injected = `${c}&return=${encodeURIComponent(leaf)}`;
    assert.equal(resolveEventComparisonRoute(injected), null, leaf);
    assert.equal(resolveRoute(`#${injected}`), 'people', leaf);
  }
  assert.equal(resolveEventComparisonRoute(`${c}&return=${encodeURIComponent(a)}&return=${encodeURIComponent(b)}`), null);
  assert.equal(resolvePersonTimelineRoute(`${a}&return=${encodeURIComponent(a)}`), null);
  assert.throws(() => eventComparisonRoute('baixiang', 'battle', 'https://evil.invalid/'));
  // Public constructors flatten a valid origin once rather than growing URLs.
  let route = a;
  for (let index = 0; index < 100; index++) route = index % 2 === 0
    ? eventComparisonRoute('baixiang', 'battle', route)
    : personTimelineRoute('li-cunxu', 'li-cunxu-baixiang', route);
  assert.ok(route.length < 220);
});

test('Reader permits only the one-page context depth and refuses repeated or unknown outer parameters', () => {
  const chapter = libraryChapters.find(item => item.id === 'old-v027');
  const prefix = `read-old/${chapter.id}`;
  const nested = `${c}&return=${encodeURIComponent(`${a}&return=${encodeURIComponent(b)}`)}`;
  assert.equal(resolveReadingRoute(`${prefix}?return=${encodeURIComponent(nested)}`).returnTo, undefined);
  for (const suffix of ['paragraph=old-v027-p18&paragraph=old-v027-p19', 'return='+encodeURIComponent(a)+'&return='+encodeURIComponent(b), 'private=1', 'q=x&q=y', 'field=both&field=original', 'return=x?more=y']) {
    assert.equal(resolveReadingRoute(`${prefix}?${suffix}`), null, suffix);
  }
});

test('A to comparison to B and both returns use the actual ancestors with independent positions and view state', () => {
  const session = createReadingNavigationSession();
  const entryA = session.activate(a);
  session.savePosition(position('timeline-event-li-cunxu-baixiang', -192, 3710, { 'a/evidence': true }));
  const comparison = eventComparisonRoute('baixiang', 'battle', a);
  const entryC = session.activate(comparison);
  session.rememberView(comparison, { selectedBooks: ['tongjian', 'huiyao'], expandedTranslations: { 'battle/old-p18': true }, fontSize: 24 });
  session.savePosition(position('comparison-paragraph-baixiang-battle-tongjian-p2', -527, 12200, { 'battle/troops': true }));
  const timeline = personTimelineRoute('zhou-dewei', 'zhou-dewei-baixiang', comparison);
  const entryB = session.activate(timeline);
  session.savePosition(position('timeline-event-zhou-dewei-baixiang', -319, 6900));
  assert.equal(session.returnDistance(c, resolvePersonTimelineRoute(timeline).returnTo), -1);
  const restoredC = session.activate(comparison, entryC.id);
  assert.deepEqual(readingPositionDecision(restoredC, 'comparison-stage-battle'), { kind: 'restore', position: position('comparison-paragraph-baixiang-battle-tongjian-p2', -527, 12200, { 'battle/troops': true }) });
  assert.deepEqual(session.readView(comparison, {}), { selectedBooks: ['tongjian', 'huiyao'], expandedTranslations: { 'battle/old-p18': true }, fontSize: 24 });
  assert.equal(session.returnDistance(a, resolveEventComparisonRoute(comparison).returnTo), -1);
  const restoredA = session.activate(a, entryA.id);
  assert.equal(restoredA.position.offset, -192);
  // Native browser forward revisits both retained entries; neither is replaced
  // with a newly synthesized route or the other's reading state.
  assert.equal(session.activate(comparison, entryC.id).position.offset, -527);
  assert.equal(session.activate(timeline, entryB.id).position.offset, -319);
});

test('two history visits to the same route keep distinct book selections, opened translations and viewport offsets', () => {
  const session = createReadingNavigationSession();
  const first = session.activate(c);
  const firstView = { selectedBooks: ['old'], expandedTranslations: { 'battle/first': true }, fontSize: 20 };
  session.rememberView(c, firstView);
  session.savePosition(position('first', -650));
  session.activate(b);
  const second = session.activate(c);
  const secondView = { selectedBooks: ['new', 'tongjian', 'huiyao'], expandedTranslations: {}, fontSize: 28 };
  session.rememberView(c, secondView);
  session.savePosition(position('second', -200, 8888));
  assert.notEqual(first.id, second.id);
  session.activate(c, first.id);
  assert.deepEqual(session.readView(c, {}), firstView);
  assert.equal(session.current().position.anchorId, 'first');
  session.activate(c, second.id);
  assert.deepEqual(session.readView(c, {}), secondView);
  assert.equal(session.current().position.anchorId, 'second');
  // An effect belonging to a previous entry must not overwrite this visit.
  session.rememberView(c, firstView, first.id);
  assert.deepEqual(session.readView(c, {}), secondView);
  const copy = session.readView(c, {}); copy.selectedBooks.push('old');
  assert.deepEqual(session.readView(c, {}), secondView);
});

test('fresh paragraph searches reset only inherited translation toggles while Back restores each search snapshot', () => {
  const session = createReadingNavigationSession();
  const firstRoute = 'person-sources/li-cunxu/old?q=柏乡&field=translation';
  const secondRoute = 'person-sources/li-cunxu/old?q=胡柳&field=translation';
  const first = session.activate(firstRoute);
  const page = { target: 'first-search', cursors: ['0', '50'], index: 1 };
  session.rememberView(firstRoute, { size: 27, pagination: page, expandedTranslations: { 'old-v027-p18': false, 'old-v027-p19': true } });
  const second = session.activate(secondRoute);
  assert.deepEqual(session.readView(secondRoute, {}), { size: 27, pagination: page, expandedTranslations: {} });
  session.rememberView(secondRoute, { size: 27, pagination: page, expandedTranslations: { 'old-v027-p18': true } });
  const clearRoute = 'person-sources/li-cunxu/old';
  session.activate(clearRoute);
  assert.deepEqual(session.readView(clearRoute, {}).expandedTranslations, {});
  session.activate(secondRoute, second.id);
  assert.deepEqual(session.readView(secondRoute, {}).expandedTranslations, { 'old-v027-p18': true });
  session.activate(firstRoute, first.id);
  assert.deepEqual(session.readView(firstRoute, {}).expandedTranslations, { 'old-v027-p18': false, 'old-v027-p19': true });
});

test('Reader preserves translation controls across paragraph targets and clears them for a changed search field', () => {
  const session = createReadingNavigationSession();
  const first = 'read-old/old-v027?q=柏乡&field=original&paragraph=old-v027-p18';
  session.activate(first);
  const view = { size: 24, expandedTranslations: { 'old-v027-p18': false, 'old-v027-p19': true } };
  session.rememberView(first, view);
  const paragraph = 'read-old/old-v027?q=柏乡&field=original&paragraph=old-v027-p19';
  session.activate(paragraph);
  assert.deepEqual(session.readView(paragraph, {}), view);
  const field = 'read-old/old-v027?q=柏乡&field=translation&paragraph=old-v027-p19';
  session.activate(field);
  assert.deepEqual(session.readView(field, {}), { size: 24, expandedTranslations: {} });
});

test('stage navigation inherits controls but deliberately targets the new stage, while back restores the prior paragraph', () => {
  const session = createReadingNavigationSession();
  const first = session.activate(c);
  session.rememberView(c, { selectedBooks: ['tongjian'], fontSize: 23, expandedTranslations: { x: true } });
  session.savePosition(position('comparison-paragraph-baixiang-battle-x', -950));
  const aftermath = eventComparisonRoute('baixiang', 'aftermath');
  const next = session.activate(aftermath);
  assert.deepEqual(session.readView(aftermath, {}), { selectedBooks: ['tongjian'], fontSize: 23, expandedTranslations: { x: true } });
  assert.deepEqual(readingPositionDecision(next, 'comparison-stage-aftermath'), { kind: 'target', anchorId: 'comparison-stage-aftermath' });
  assert.equal(readingPositionDecision(session.activate(c, first.id), 'comparison-stage-battle').position.offset, -950);
});

test('Reader return may skip chapter visits and safely restore the true parent even if its URL lacked the clicked stage', () => {
  const session = createReadingNavigationSession();
  const parent = session.activate(eventComparisonRoute('baixiang'));
  session.savePosition(position('comparison-paragraph-baixiang-battle-old-p18', -404));
  const chapter = libraryChapters.find(item => item.id === 'old-v027');
  const reader = chapterRoute(chapter, { returnTo: c, paragraphId: 'old-v027-p18', query: '', field: 'both' });
  session.activate(reader);
  session.activate(chapterRoute(libraryChapters.find(item => item.id === 'old-v028'), { returnTo: c, query: '', field: 'both' }));
  assert.equal(session.returnDistance(c, resolveReadingRoute(reader).returnTo), -2);
  assert.equal(session.activate(parent.route, parent.id).position.offset, -404);
  assert.equal(session.returnDistance(a, c), null);
});

test('first destination gets exact event focus, refresh has a safe top fallback, and user input cancels late correction', () => {
  const session = createReadingNavigationSession();
  const first = session.activate(a);
  assert.deepEqual(readingPositionDecision(first, 'timeline-event-li-cunxu-baixiang'), { kind: 'target', anchorId: 'timeline-event-li-cunxu-baixiang' });
  session.cancel();
  assert.deepEqual(readingPositionDecision(first, 'timeline-event-li-cunxu-baixiang'), { kind: 'cancel' });
  const refreshed = createReadingNavigationSession().activate(c, first.id);
  assert.notEqual(refreshed.id, first.id);
  assert.deepEqual(readingPositionDecision(refreshed), { kind: 'top' });
});

test('history is bounded, discards abandoned forward entries and ignores forged entry IDs', () => {
  const session = createReadingNavigationSession(3);
  const first = session.activate(a);
  const middle = session.activate(c);
  const last = session.activate(b);
  session.activate(c, middle.id);
  const branch = session.activate(eventComparisonRoute('baixiang', 'aftermath'));
  assert.notEqual(session.activate(b, last.id).id, last.id);
  assert.ok(session.size() <= 3);
  assert.notEqual(session.activate(c, first.id).id, first.id);
  assert.notEqual(session.current().id, branch.id);
});

test('reading anchors prefer the actual paragraph crossing the viewport over its large stage ancestor', () => {
  const anchors = [{ id: 'stage', top: -9500, bottom: 24000 }, { id: 'preceding', top: -450, bottom: -20 },
    { id: 'paragraph', top: -280, bottom: 950 }, { id: 'following', top: 960, bottom: 2300 }];
  assert.equal(chooseReadingAnchor(anchors).id, 'paragraph');
  assert.equal(chooseReadingAnchor([{ id: 'a', top: 50, bottom: 300 }, { id: 'b', top: 420, bottom: 700 }]).id, 'a');
});

// This is a deterministic browser-history model for the navigation controller,
// not evidence of browser execution. The separate UI receipt checks real Back.
function historyModel(session) {
  const entries = [], seen = new Map(); let index = -1;
  function push(route) {
    const entry = session.activate(route);
    entries.splice(index + 1); entries.push({ route, id: entry.id }); index++;
    seen.set(entry.id, entry);
    return entry;
  }
  function go(distance) {
    assert.ok(index + distance >= 0 && index + distance < entries.length, `physical traversal ${distance} from ${index}`);
    index += distance;
    return entries[index];
  }
  return { push, go, entries, current: () => entries[index], index: () => index, seen };
}

test('cancelled native Back physically bounces to the original entry, preserves every ancestor URL and permits the next explicit return', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard(), browser = historyModel(session);
  browser.push(a); const comparison = browser.push(c);
  const reader = browser.push('read-old/old-v027?return='+encodeURIComponent(c));
  const unchanged = structuredClone(browser.entries);
  const popped = browser.go(-1);
  const plan = guard.block(reader, popped.route, popped.id, session.distanceToEntry(popped.id));
  assert.equal(plan.distance, -1);
  assert.equal(session.current().id, reader.id);
  const bounced = browser.go(-plan.distance);
  assert.deepEqual(guard.arrive(bounced.route, bounced.id, session.current()), { handled: true, action: { kind: 'none' } });
  assert.equal(browser.current().id, reader.id);
  assert.deepEqual(browser.entries, unchanged);
  // Continuing editing clears the UI callback; a later explicit return uses a
  // new guard and the unchanged, physically correct distance.
  guard.invalidate();
  const distance = session.returnDistance(c, c);
  assert.equal(distance, -1);
  assert.equal(browser.go(distance).id, comparison.id);
});

test('confirming native Back before its bounce waits for the original pointer and resumes exactly once', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard(), browser = historyModel(session);
  browser.push(a); const comparison = browser.push(c); const reader = browser.push('read-old/old-v027');
  const popped = browser.go(-1), plan = guard.block(reader, popped.route, popped.id, session.distanceToEntry(popped.id));
  assert.deepEqual(guard.requestContinuation(plan, reader), { kind: 'none' });
  assert.equal(browser.current().id, comparison.id);
  const bounced = browser.go(-plan.distance), resumed = guard.arrive(bounced.route, bounced.id, reader);
  assert.equal(resumed.action.kind, 'traverse'); assert.equal(resumed.action.distance, -1);
  assert.equal(browser.go(resumed.action.distance).id, comparison.id);
  session.activate(comparison.route, comparison.id);
  assert.deepEqual(guard.requestContinuation(plan, session.current()), { kind: 'none' });
  assert.deepEqual(guard.requestContinuation(plan, reader), { kind: 'none' });
});

test('native Forward cancellation restores its original pointer and confirmation preserves the future entry', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard(), browser = historyModel(session);
  const first = browser.push('read-old/old-v027'); const future = browser.push('read-old/old-v028');
  const previous = browser.go(-1); session.activate(previous.route, previous.id);
  const from = { ...session.current() }, unchanged = structuredClone(browser.entries);
  const popped = browser.go(1), plan = guard.block(from, popped.route, popped.id, session.distanceToEntry(popped.id));
  assert.equal(plan.distance, 1);
  const bounced = browser.go(-plan.distance);
  guard.arrive(bounced.route, bounced.id, session.current());
  assert.equal(browser.current().id, first.id);
  const continuation = guard.requestContinuation(plan, session.current());
  assert.equal(continuation.kind, 'traverse'); assert.equal(continuation.distance, 1);
  assert.equal(browser.go(continuation.distance).id, future.id);
  assert.deepEqual(browser.entries, unchanged);
});

test('busy rejection and stale editor confirmations cannot resume after a later navigation or activation', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard();
  const first = session.activate(a), reader = session.activate('read-old/old-v027');
  const plan = guard.block(reader, first.route, first.id, -1);
  // A busy handler never calls continuation. Bounce completes without leaving.
  assert.equal(guard.arrive(reader.route, reader.id, reader).action.kind, 'none');
  guard.invalidate();
  assert.equal(guard.requestContinuation(plan, reader).kind, 'none');
  const next = guard.block(reader, first.route, first.id, -1);
  guard.arrive(reader.route, reader.id, reader);
  session.activate(reader.route, reader.id); // Same opaque ID, later activation.
  assert.equal(guard.requestContinuation(next, session.current()).kind, 'none');
});

test('unknown and expired history entries revoke ancestor distances and use only a safe new internal navigation', () => {
  const session = createReadingNavigationSession(2), guard = createReadingTraversalGuard();
  const expired = session.activate(a); session.activate(c);
  const reader = session.activate('read-old/old-v027');
  assert.equal(session.distanceToEntry(expired.id), null);
  const plan = guard.block(reader, expired.route, expired.id, session.distanceToEntry(expired.id));
  assert.equal(plan.distance, null);
  session.retainCurrentOnly();
  assert.equal(session.size(), 1);
  assert.equal(session.returnDistance(c, c), null);
  assert.deepEqual(guard.requestContinuation(plan, session.current()), { kind: 'push', route: a });
  // Accepting an unknown native destination also starts a fresh history base.
  session.activate(c); session.activate(a, 'foreign-or-evicted-id');
  assert.equal(session.size(), 1);
  assert.equal(session.current().route, a);
  assert.equal(session.returnDistance(c, c), null);
});

test('duplicate pop/hash events do not rebounce, rapid native actions recalibrate a known pointer and corrections are bounded', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard();
  const first = session.activate(a), middle = session.activate(c), reader = session.activate('read-old/old-v027');
  const plan = guard.block(reader, middle.route, middle.id, -1);
  assert.equal(guard.arrive(middle.route, middle.id, reader, -1).action.kind, 'none');
  assert.deepEqual(guard.arrive(first.route, first.id, reader, -2).action, { kind: 'bounce', distance: 2 });
  assert.equal(guard.arrive(first.route, first.id, reader, -2).action.kind, 'none');
  assert.deepEqual(guard.arrive(reader.route, reader.id, reader, 0), { handled: true, action: { kind: 'none' } });
  assert.equal(guard.isBouncing(), false);
  assert.equal(guard.requestContinuation(plan, reader).kind, 'traverse');
  const storm = guard.block(reader, middle.route, middle.id, -1);
  for (const [route, id, delta] of [[first.route, first.id, -2], [middle.route, middle.id, -1], [first.route, first.id, -2]]) {
    assert.equal(guard.arrive(route, id, reader, delta).action.kind, 'bounce');
  }
  assert.equal(guard.arrive(middle.route, middle.id, reader, -1).action.kind, 'fallback');
  assert.equal(guard.isBouncing(), false);
  assert.deepEqual(guard.requestContinuation(storm, reader), { kind: 'push', route: c });
});

test('synchronous continuation during cancelled dispatch waits until the block/bounce exists; allowed continuation is once-only', () => {
  const session = createReadingNavigationSession(), guard = createReadingTraversalGuard();
  const target = session.activate(c), reader = session.activate('read-old/old-v027');
  let plan, activated = 0, actions = [];
  const decision = createNavigationDecision({ isCurrent: () => session.current()?.id === reader.id && session.current().activation === reader.activation,
    onAllowed: () => activated++, onBlocked: () => actions.push(guard.requestContinuation(plan, session.current())) });
  decision.request(); // The listener calls continue, then prevents default.
  assert.equal(activated, 0); assert.equal(actions.length, 0);
  plan = guard.block(reader, target.route, target.id, -1);
  decision.settle(false);
  assert.equal(activated, 0); assert.deepEqual(actions, [{ kind: 'none' }]);
  assert.equal(guard.arrive(reader.route, reader.id, reader).action.kind, 'traverse');
  decision.request(); assert.equal(activated, 0); assert.equal(actions.at(-1).kind, 'none');
  const token = { ...session.current() };
  const allowed = createNavigationDecision({ isCurrent: () => session.current().id === token.id && session.current().activation === token.activation,
    onAllowed: () => activated++, onBlocked: () => assert.fail('must not block') });
  allowed.request(); allowed.settle(true); allowed.request(); allowed.settle(true);
  assert.equal(activated, 1);
  session.activate(reader.route, reader.id); allowed.request(); assert.equal(activated, 1);
});
