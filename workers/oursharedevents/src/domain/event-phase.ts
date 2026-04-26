/**
 * Event Phase Domain Model (OSE-242 / BE-26 — rescoped 2026-04-26 to canonical
 * matrix-wide resolver per CCR-4 SCRUM audit).
 *
 * Single source of truth for the event LIFECYCLE PHASE that every OSE surface
 * (Sponsor, Poster, Event-admin, Display, Public, SharedReport) consumes for
 * rendering decisions. Distinct from `event-state.ts`:
 *
 *   - `event-state.ts` (OSE-199) — admin lifecycle: draft → ready → active →
 *     archived. State machine. Admin transitions. Governs WHO can render WHAT.
 *
 *   - `event-phase.ts` (this file) — temporal phase: pre_event → event →
 *     post_event. Auto-derived. Governs HOW each surface renders WITHIN the
 *     "is this event live" window.
 *
 * The two are orthogonal: status answers "is this event in operational play?";
 * phase answers "where in time is this event?". Surfaces consume both jointly.
 *
 * Rule (Decision 1, status gates / time refines, confirmed 2026-04-26):
 *
 *   status = 'draft'    → ALWAYS 'pre_event'    (work hasn't started for users)
 *   status = 'ready'    → ALWAYS 'pre_event'    (approvals pending; not yet live)
 *   status = 'active'   → time decides:
 *       now < start_date              → 'pre_event'
 *       start_date ≤ now ≤ end_date   → 'event'
 *       now > end_date                → 'post_event'
 *   status = 'archived' → ALWAYS 'post_event'   (hidden; conceptually past)
 *
 * Null-handling (Decision 3, status fallback + warn):
 *   - Both dates null → defer to status (active → 'event'; others by status rule)
 *   - start_date set, end_date null → if now < start → pre_event; else 'event'
 *   - start_date null, end_date set → malformed; status fallback + warn
 *   - Unparseable date string → status fallback + warn
 *
 * EXTRACTION NOTE: This module is written as the literal shape of a future
 * `@ocr/event-phase` package. Zero OSE-specific imports. Zero handler
 * coupling. When OCR-24 (INFRA-7 @ocr/* package scaffold) lifts the module
 * to `packages/event-phase/src/index.ts`, the diff is `git mv` + a
 * `package.json`. No refactor.
 *
 * BRAIN CONTRACT: This implementation must conform to
 * `OCR-docs/ocr-docs-brain/event-phase-contract.yaml`. The brain pyramid
 * Level 2 schema check validates that any OCR sibling implementing event
 * phase logic matches the contract — drift detection self-arms when a
 * second consumer (WKRP / OSM / OSP / OSR / OSG / OAW / OER) ships its
 * own phase logic.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Temporal phase of an event relative to current time. */
export type EventPhase = 'pre_event' | 'event' | 'post_event';

/**
 * Subset-typed input. Accepts only the fields the resolver needs so callers
 * (handlers, tests) don't need to construct full event rows.
 *
 * `status` is a string (not the typed `EventState`) so this module has zero
 * dependency on `event-state.ts`. The resolver tolerates unknown status
 * values by treating them as 'active' for time-deciding behaviour, with a
 * warn log so drift is observable.
 */
export interface EventPhaseInput {
  status: string;
  start_date: string | null;
  end_date: string | null;
}

/** Why `computeEventPhase` returned the value it did — for logging / admin UI. */
export interface EventPhaseExplanation {
  phase: EventPhase;
  reason:
    | 'status_pre' // status = draft/ready
    | 'status_post' // status = archived
    | 'time_before_start' // status = active, now < start_date
    | 'time_within' // status = active, in [start_date, end_date]
    | 'time_after_end' // status = active, now > end_date
    | 'no_dates_status_active' // active + no dates → 'event' by status
    | 'partial_dates_after_start' // start_date set, end null, now ≥ start
    | 'malformed_dates_status_fallback'; // bad input → fall back to status
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const VALID_EVENT_PHASES: readonly EventPhase[] = [
  'pre_event',
  'event',
  'post_event',
] as const;

export const EVENT_PHASE_LABELS: Record<EventPhase, string> = {
  pre_event: 'Pre-event',
  event: 'Live',
  post_event: 'Post-event',
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseISO(value: string | null): Date | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function warn(message: string): void {
  // Console-only by design — this module has zero logger dependencies so it
  // can be lifted into `@ocr/event-phase` without auxiliary imports. The
  // `[EventPhase]` prefix matches the convention in event-state.ts.
  console.warn(`[EventPhase] ${message}`);
}

// ── Core resolver ─────────────────────────────────────────────────────────────

/**
 * Compute the temporal phase of an event relative to `now`.
 *
 * Pure function. Side effects limited to console.warn on malformed input.
 *
 * @example
 * const phase = computeEventPhase(
 *   { status: 'active', start_date: '2026-05-01T19:00:00Z', end_date: '2026-05-01T22:00:00Z' },
 *   new Date('2026-05-01T20:00:00Z')
 * );
 * // phase === 'event'
 */
export function computeEventPhase(event: EventPhaseInput, now: Date = new Date()): EventPhase {
  return explainEventPhase(event, now).phase;
}

/**
 * Same as `computeEventPhase` but returns a structured explanation.
 * Useful for admin event-list (show phase reason as a tooltip) and tests.
 */
export function explainEventPhase(
  event: EventPhaseInput,
  now: Date = new Date()
): EventPhaseExplanation {
  const status = (event.status || '').toLowerCase().trim();

  // Decision 1, half 1: status forces phase for draft / ready / archived.
  if (status === 'draft' || status === 'ready') {
    return { phase: 'pre_event', reason: 'status_pre' };
  }
  if (status === 'archived') {
    return { phase: 'post_event', reason: 'status_post' };
  }

  // Anything other than 'active' falls into time-decides territory but with a
  // warn (we don't recognise this status). Treat as 'active' for the time
  // calculation; surfaces depending on event-state.ts will have already
  // gated rendering separately.
  if (status !== 'active') {
    warn(`Unknown status "${event.status}" — treating as 'active' for phase derivation`);
  }

  // Decision 1, half 2: status = active → time decides.
  const start = parseISO(event.start_date);
  const end = parseISO(event.end_date);

  // Both dates null → admin marked it active without scheduling. Trust admin.
  if (!start && !end) {
    if (event.start_date !== null || event.end_date !== null) {
      // strings were provided but failed to parse
      warn(
        `Active event with malformed dates: start="${event.start_date}", end="${event.end_date}" — falling back to 'event'`
      );
      return { phase: 'event', reason: 'malformed_dates_status_fallback' };
    }
    return { phase: 'event', reason: 'no_dates_status_active' };
  }

  // start_date null but end_date set → unusual; status fallback to 'event'
  if (!start && end) {
    warn(
      `Active event with end_date but no start_date (end="${event.end_date}") — falling back to 'event'`
    );
    return { phase: 'event', reason: 'malformed_dates_status_fallback' };
  }

  // From here on `start` is non-null.
  if (start && now < start) {
    return { phase: 'pre_event', reason: 'time_before_start' };
  }

  // start ≤ now. If no end_date, stay in 'event' until admin transitions to archived.
  if (start && !end) {
    return { phase: 'event', reason: 'partial_dates_after_start' };
  }

  // Both dates set, now ≥ start.
  if (end && now <= end) {
    return { phase: 'event', reason: 'time_within' };
  }

  // now > end_date.
  return { phase: 'post_event', reason: 'time_after_end' };
}

// ── Surface-coherence helper (the seed of #1 cross-surface coherence test) ──

/**
 * Given a list of (surface, computed_phase) tuples, assert that all surfaces
 * agree on the canonical phase for the same event at the same `now`. Returns
 * `{ ok: true }` on agreement or `{ ok: false, divergences }` on drift.
 *
 * This is the L2 verification helper used by `event-phase-coherence.spec.ts`
 * and by SRE drift-detection probes. Surfaces compute phase locally; then the
 * test (or a runtime probe) calls this helper to verify cross-surface
 * coherence. A `false` return = flywheel-incomplete.
 */
export function assertSurfaceCoherence(
  observations: ReadonlyArray<{ surface: string; phase: EventPhase }>
):
  | { ok: true }
  | {
      ok: false;
      expected: EventPhase;
      divergences: ReadonlyArray<{ surface: string; phase: EventPhase }>;
    } {
  if (observations.length === 0) return { ok: true };
  const expected = observations[0]!.phase;
  const divergences = observations.filter((o) => o.phase !== expected);
  if (divergences.length === 0) return { ok: true };
  return { ok: false, expected, divergences };
}
