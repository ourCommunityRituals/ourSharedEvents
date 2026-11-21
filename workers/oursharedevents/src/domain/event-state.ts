/**
 * Event State Domain Model (OSE-199 / BE-12)
 *
 * Single source of truth for the event asset lifecycle.
 * Governs which surfaces may render events in each state.
 *
 * State machine:
 *   draft    → event exists but is not public-ready
 *   ready    → event data complete, awaiting final activation
 *   active   → live and safe to render on all public surfaces
 *   archived → hidden from all surfaces except admin
 *
 * Valid transitions:
 *   draft    → ready | archived
 *   ready    → active | draft | archived
 *   active   → archived | ready
 *   archived → active | draft
 *
 * OSE convention: lowercase state values match the D1 status column.
 *
 * Ported from prior worker implementation. Its one import is listedSql, the
 * publish-grace test the routable rule (below) is built on; that module imports
 * nothing, so this one stays free of runtime dependencies.
 */

import { listedSql } from '../lib/publish-grace';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Event lifecycle states — lowercase, matches D1 status column */
export type EventState = 'draft' | 'ready' | 'active' | 'archived';

/** Surfaces that can request event rendering */
export type RenderSurface = 'public' | 'display' | 'poster' | 'admin' | 'report';

/** Full state resolution result */
export interface EventStateInfo {
  state: EventState;
  isRenderable: boolean;
  label: string;
  description: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const VALID_EVENT_STATES: readonly EventState[] = [
  'draft',
  'ready',
  'active',
  'archived',
] as const;

export const EVENT_STATE_LABELS: Record<EventState, string> = {
  draft: 'Draft',
  ready: 'Ready for Verification',
  active: 'Active',
  archived: 'Archived',
} as const;

export const EVENT_STATE_DESCRIPTIONS: Record<EventState, string> = {
  draft: 'Event is being created and is not ready for public display',
  ready: 'Event data is complete but has not been activated yet',
  active: 'Event is live and safe to display on all public surfaces',
  archived: 'Event has been archived and is hidden from all surfaces',
} as const;

/**
 * Which surfaces may render each state.
 *
 * INVARIANT: Only ACTIVE events render on public / display / poster.
 * Admin sees all states for management purposes.
 */
export const RENDERABLE_SURFACES: Record<EventState, readonly RenderSurface[]> = {
  draft: ['admin'],
  ready: ['admin'],
  active: ['public', 'display', 'poster', 'admin', 'report'],
  archived: ['admin'],
} as const;

/**
 * Valid state transitions.
 * Any state → draft is permitted (reset); any state → archived is permitted.
 */
export const VALID_TRANSITIONS: Record<EventState, readonly EventState[]> = {
  draft: ['ready', 'archived'],
  ready: ['active', 'draft', 'archived'],
  active: ['archived', 'ready'],
  archived: ['active', 'draft'],
} as const;

// ── Validation ────────────────────────────────────────────────────────────────

export function isValidEventState(value: unknown): value is EventState {
  return typeof value === 'string' && (VALID_EVENT_STATES as readonly string[]).includes(value);
}

/**
 * Parse and normalise an event state value (e.g. from DB or request body).
 * Accepts lowercase strings; unknown values default to 'draft'.
 */
export function parseEventState(value: unknown): EventState {
  if (!value || typeof value !== 'string') return 'draft';
  const lower = value.toLowerCase().trim();
  if (isValidEventState(lower)) return lower;
  console.warn(`[EventState] Unknown state value: "${value}", defaulting to draft`);
  return 'draft';
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Assert that an event in the given state may render on the target surface.
 *
 * Returns `{ allowed: true }` on success or `{ allowed: false, reason }` on block.
 * Never throws — callers branch on the result.
 *
 * @example
 * const r = assertRenderable('ready', 'poster');
 * // r.allowed === false
 * // r.reason  === 'Event is not yet verified for public display'
 */
export function assertRenderable(
  state: EventState,
  surface: RenderSurface
): { allowed: boolean; reason?: string } {
  if ((RENDERABLE_SURFACES[state] as readonly string[]).includes(surface)) {
    return { allowed: true };
  }

  const reasons: Record<EventState, string> = {
    draft: 'Event is still in draft mode and not ready for display',
    ready: 'Event has not been activated yet',
    active: '', // should never reach here for active
    archived: 'Event has been archived and is no longer available',
  };

  return {
    allowed: false,
    reason: reasons[state] || `State "${state}" is not allowed on surface "${surface}"`,
  };
}

/** Convenience wrapper — returns true if rendering is allowed. */
export function canRender(state: EventState, surface: RenderSurface): boolean {
  return assertRenderable(state, surface).allowed;
}

/**
 * "The parent event is live" as SQL: the one test every public read of
 * something that belongs to an event uses (OSE-2144, owner 2026-11-18:
 * nothing is more live than its container). It is canRender(state, 'public')
 * written over an `events` row, so the state machine above stays the single
 * source: the states it allows are the ones that render on 'public' (today
 * `active` alone, which the admin calls Published).
 *
 * The shared sponsor rules (SPONSOR_ON_SHOW_SQL, PLACEMENT_ON_SHOW_SQL in
 * lib/sponsor-card.ts) are built on it, and the scan route (/q) asks it in its
 * token lookup. `alias` is the `events` alias in scope; '' is a bare column.
 *
 * Two written exceptions, both owner decisions of 2026-11-18, and nowhere else:
 *   1. the recap page of an archived event that was listed keeps its sponsor
 *      strip (handlers/pages.ts fetchEventPageSocialData);
 *   2. an archived event's SharedReport opens with an unexpired signed link
 *      (lib/shared-report-builder.ts).
 */
export function eventLiveSql(alias = 'e'): string {
  const col = alias ? `${alias}.status` : 'status';
  const live = VALID_EVENT_STATES.filter((s) => canRender(s, 'public'));
  return live.length === 1
    ? `${col} = '${live[0]}'`
    : `${col} IN (${live.map((s) => `'${s}'`).join(', ')})`;
}

// ── Routable: listed and live (OSE-2196) ──────────────────────────────────────

/** The fields of an `events` row the routable rule reads. */
export interface RoutableEvent {
  status?: string | null;
  is_published?: number | null;
  listed_from?: string | null;
}

/**
 * Owner ruling, 2026-11-19: "Anything that is listed as private or off map
 * cannot be routed to." A route to an event (a Directions menu, the map's
 * "Take me there", a maps link of any kind) is offered only when the event is
 * ROUTABLE, and routable is exactly LISTED: the rule the list, the map and the
 * brand's calendar feed already use to decide who appears on them.
 *
 *   1. live: its status renders on 'public' (canRender above, eventLiveSql);
 *   2. on the map: `is_published = 1` (off map, "unlisted", is 0);
 *   3. past its publish grace: `listed_from` is unset or has passed
 *      (lib/publish-grace.ts). Inside the window the event is still off the
 *      map, so it is not routable either.
 *
 * Those are every private marker the events table has (status, is_published,
 * listed_from). An off-map event still opens at its link (PO 2026-10-07); it
 * simply offers no route.
 *
 * `asPublished` answers for an admin draft preview: would this event be
 * routable once it is published and its grace has passed? So the preview of a
 * draft that will be listed shows its Directions, and one that will be off the
 * map shows none.
 */
export function isRoutable(
  e: RoutableEvent,
  opts: { now?: Date; asPublished?: boolean } = {}
): boolean {
  if (e.is_published !== 1) return false;
  if (opts.asPublished) return true;
  // The stored state exactly, as eventLiveSql compares it: no case folding or
  // trimming, so the TS and SQL forms can never disagree (a stray 'ACTIVE' is
  // not routable on either side).
  const status = e.status ?? '';
  if (!isValidEventState(status) || !canRender(status, 'public')) return false;
  // The grace test as listedSql writes it: the stored text against now in the
  // same toISOString shape, compared as text. Written the same way so the two
  // forms agree on every value, a malformed one included.
  if (e.listed_from && !(e.listed_from <= (opts.now ?? new Date()).toISOString())) return false;
  return true;
}

/**
 * isRoutable as SQL over an `events` row: eventLiveSql, `is_published = 1` and
 * listedSql (lib/publish-grace.ts), so the rule is written once. The map's and
 * the list's source query (lib/data-provider.ts fetchEvents) uses it, which is
 * what keeps the map panel's "Take me there" to routable events. `alias` is the
 * `events` alias in scope; '' is a bare column.
 */
export function eventRoutableSql(alias = ''): string {
  const pub = alias ? `${alias}.is_published` : 'is_published';
  return `${pub} = 1 AND ${eventLiveSql(alias)} AND ${listedSql(alias)}`;
}

// ── Transitions ───────────────────────────────────────────────────────────────

export function isValidTransition(from: EventState, to: EventState): boolean {
  return (VALID_TRANSITIONS[from] as readonly string[]).includes(to);
}

export function getAllowedTransitions(from: EventState): readonly EventState[] {
  return VALID_TRANSITIONS[from];
}

// ── Response helpers ──────────────────────────────────────────────────────────

/** Build the state info block for API responses. */
export function resolveEventStateInfo(status: string): EventStateInfo {
  const state = parseEventState(status);
  return {
    state,
    isRenderable: canRender(state, 'public'),
    label: EVENT_STATE_LABELS[state],
    description: EVENT_STATE_DESCRIPTIONS[state],
  };
}

/**
 * Build a standard 403 response for non-renderable events.
 * Use when a public surface requests an event that is not ACTIVE.
 */
export function nonRenderableResponse(state: EventState, surface: RenderSurface): Response {
  const { reason } = assertRenderable(state, surface);
  return Response.json(
    {
      ok: false,
      status: 403,
      code: 'NOT_RENDERABLE',
      state,
      surface,
      error: reason ?? 'Event is not available on this surface',
    },
    { status: 403 }
  );
}
