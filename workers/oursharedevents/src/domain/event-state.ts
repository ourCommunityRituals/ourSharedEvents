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
 * Ported from Codex worker/src/domain/assetState.ts (zero external imports).
 */

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
