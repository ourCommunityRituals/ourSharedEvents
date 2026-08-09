/**
 * OSE-658 — Public event page cache-coherence.
 *
 * The public event URL renders one of three phase states (pre_event / event /
 * post_event), derived per request from now vs start/end (see
 * domain/event-phase.ts). The cache-coherence guarantee: a state must NEVER be
 * served past its phase pivot.
 *
 * This helper produces the Cache-Control for that page. Two walls it respects,
 * per the FE perf/quality audit (rank 6):
 *   - PRIVATE, never `public` — the page body may contain the event's own
 *     attendance count (e.g. "1 person has registered"), which is a sub-floor
 *     number. A `private` cache is the user's browser only; it is NEVER stored
 *     at a shared edge, so no sub-K>=5 count can be served from a shared cache
 *     (aggregate_only_reporting #7). A `public` edge cache here would require
 *     decoupling counts from the body first (audit FE-1/FE-2 — deferred).
 *   - HARD-EXPIRES BY THE PIVOT — max-age is capped at the seconds remaining
 *     until the next phase boundary, so the browser refetches at (or before)
 *     the start/end transition and never shows a stale phase. State flips are
 *     lifecycle events, not per-second, so a small absolute cap bounds clock
 *     skew (the 15-min seal grain, not second precision).
 */

import type { EventPhase, EventPhaseInput } from '../domain/event-phase';

/** Absolute ceiling (seconds). Bounds browser/server clock skew and keeps
 * social counts reasonably fresh; state transitions are not per-second. */
export const PHASE_CACHE_MAX_AGE_CAP = 300;

function parseISO(value: string | null): Date | null {
  if (!value || typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Seconds until the next phase boundary: start_date for `pre_event`, end_date
 * for `event`. Returns null when there is no forward boundary (`post_event`,
 * or missing/malformed dates). Timezone is honored via ISO parsing of the
 * stored dates (same basis as computeEventPhase).
 */
export function secondsToNextPhaseBoundary(
  event: EventPhaseInput,
  phase: EventPhase,
  now: Date = new Date()
): number | null {
  const boundary =
    phase === 'pre_event'
      ? parseISO(event.start_date)
      : phase === 'event'
        ? parseISO(event.end_date)
        : null;
  if (!boundary) return null;
  return Math.floor((boundary.getTime() - now.getTime()) / 1000);
}

/**
 * Cache-Control for the public event page. Always `private` (never shared-edge)
 * and hard-expiring by the next phase pivot, so no stale state is served past
 * the boundary (OSE-658) and no sub-floor count is shared-cached (#7).
 */
export function publicEventCacheControl(
  event: EventPhaseInput,
  phase: EventPhase,
  now: Date = new Date()
): string {
  const secs = secondsToNextPhaseBoundary(event, phase, now);
  const maxAge =
    secs === null
      ? PHASE_CACHE_MAX_AGE_CAP
      : Math.max(0, Math.min(PHASE_CACHE_MAX_AGE_CAP, secs));
  return `private, max-age=${maxAge}`;
}
