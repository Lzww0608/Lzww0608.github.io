import type { Route } from './types.ts';

interface EntryToken { id: string; activation: number; route: Route }
interface BlockedTraversal {
  from: EntryToken;
  targetRoute: Route;
  targetEntryId?: string;
  distance: number | null;
  phase: 'bouncing' | 'restored';
  requested: boolean;
  valid: boolean;
  lastObserved: string;
  corrections: number;
}
export type TraversalAction = { kind: 'none' } | { kind: 'traverse'; distance: number; route: Route; entryId?: string } | { kind: 'push'; route: Route }
  | { kind: 'bounce'; distance: number } | { kind: 'fallback'; resumeRoute?: Route };

// A listener can request continuation synchronously while dispatch is still in
// progress. Defer it until the allow/block decision and physical bounce exist.
export function createNavigationDecision({ isCurrent, onAllowed, onBlocked }: {
  isCurrent: () => boolean;
  onAllowed: () => void;
  onBlocked: () => void;
}) {
  let outcome: 'pending' | 'allowed' | 'blocked' = 'pending';
  let requested = false, performed = false;
  function request() {
    if (outcome === 'pending') { requested = true; return; }
    if (!isCurrent()) return;
    if (outcome === 'allowed') { if (!performed) { performed = true; onAllowed(); } }
    else onBlocked();
  }
  function settle(allowed: boolean) {
    if (outcome !== 'pending') return;
    outcome = allowed ? 'allowed' : 'blocked';
    if (allowed || requested) request();
  }
  return { request, settle };
}

// The browser has already moved for native Back/Forward. Restore its pointer
// before accepting a deferred editor confirmation, without changing an ancestor
// URL or pretending that the old page occupies the popped history entry.
export function createReadingTraversalGuard() {
  let active: BlockedTraversal | null = null;
  function matches(plan: BlockedTraversal, current: EntryToken | undefined) {
    return active === plan && plan.valid && current?.id === plan.from.id && current.activation === plan.from.activation;
  }
  function requestContinuation(plan: BlockedTraversal, current?: EntryToken): TraversalAction {
    if (!matches(plan, current)) return { kind: 'none' };
    plan.requested = true;
    if (plan.phase === 'bouncing') return { kind: 'none' };
    active = null;
    return plan.distance === null ? { kind: 'push', route: plan.targetRoute }
      : { kind: 'traverse', distance: plan.distance, route: plan.targetRoute, ...(plan.targetEntryId ? { entryId: plan.targetEntryId } : {}) };
  }
  function block(from: EntryToken, targetRoute: Route, targetEntryId: string | undefined, distance: number | null) {
    const bounded = distance !== null && Number.isInteger(distance) && Math.abs(distance) <= 128 && distance !== 0 ? distance : null;
    active = { from: { ...from }, targetRoute, targetEntryId, distance: bounded,
      phase: bounded === null ? 'restored' : 'bouncing', requested: false, valid: true,
      lastObserved: `${targetEntryId ?? ''}/${targetRoute}`, corrections: 0 };
    return active;
  }
  function arrive(route: Route, entryId: string | undefined, current?: EntryToken, observedDistance: number | null = null): { handled: boolean; action: TraversalAction } {
    if (active?.phase !== 'bouncing') return { handled: false, action: { kind: 'none' } };
    if (entryId !== active.from.id || route !== active.from.route) {
      const key = `${entryId ?? ''}/${route}`;
      if (key === active.lastObserved) return { handled: true, action: { kind: 'none' } };
      active.lastObserved = key;
      // Rapid native actions can move the pointer again before the queued bounce
      // completes. Recompute only from known entries, at most three times.
      if (observedDistance !== null && Number.isInteger(observedDistance) && observedDistance !== 0
        && Math.abs(observedDistance) <= 128 && active.corrections < 3) {
        active.corrections++;
        return { handled: true, action: { kind: 'bounce', distance: -observedDistance } };
      }
      const plan = active;
      plan.phase = 'restored'; plan.distance = null; plan.targetEntryId = undefined;
      const resumeRoute = plan.requested && matches(plan, current) ? plan.targetRoute : undefined;
      if (resumeRoute || !plan.valid) active = null;
      return { handled: true, action: { kind: 'fallback', ...(resumeRoute ? { resumeRoute } : {}) } };
    }
    const plan = active;
    plan.phase = 'restored';
    if (!plan.valid) { active = null; return { handled: true, action: { kind: 'none' } }; }
    return { handled: true, action: plan.requested ? requestContinuation(plan, current) : { kind: 'none' } };
  }
  function invalidate() {
    if (!active) return;
    // Still recognize the bounce already in flight, but revoke its old callback.
    active.valid = false;
    if (active.phase !== 'bouncing') active = null;
  }
  return { block, arrive, requestContinuation, invalidate, isBouncing: () => active?.phase === 'bouncing' };
}
