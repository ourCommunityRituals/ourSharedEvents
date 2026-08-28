/**
 * Event staleness — the "a poster must never rot" contract (OSE-291, EPIC OSE-284).
 *
 * WHY this exists: a printed poster (or a shared QR shortlink) can live in a
 * venue window for weeks. The underlying event is mutable — it may be archived
 * or wound back to draft between print and scan. When that happens, a customer
 * who scans MUST NOT be handed a live, actionable surface (a registration form
 * for an event that already happened). Every PUBLIC link must instead forward
 * them to the discovery listing so they can find what's on next.
 *
 * WHO this serves: the attendee holding a phone in front of a stale poster, and
 * the bar owner who can't debug "I scanned but nothing worked" from the field.
 *
 * WHERE it applies (systematic, not whack-a-mole): the public terminal renderers
 * that a QR / shortlink / direct link can land on.
 *   - /events/:id (handlePublicEventPage) ALREADY enforces this — draft/ready →
 *     branded 404 → /events, archived → graceful post-event recap. So /s/
 *     shortlinks (→ /events/:id) are covered transitively.
 *   - /forms/:id (handleFormPage) is the QR (/q/) landing and was the sole
 *     outlier — it rendered a live form regardless of status. This helper closes
 *     that gap, keeping every public link consistent.
 *
 * The single source of truth for "may this state render on a public surface" is
 * the event state machine (domain/event-state). We reuse `canRender(state,
 * 'public')` rather than re-deriving a parallel notion of staleness.
 *
 * ── The funnel model (share a code on ANY external platform → resolve to OSE) ──
 * A shareable code has two layers:
 *   1. EMITTER / CONTRACT layer — UEC (lib/uec, the semantic-category contract
 *      for "any URL the platform emits"), shortlinks (/s/:code), QR tokens
 *      (/q/:token). This layer decides what a code MEANS and which OSE URL it
 *      encodes (UEC encodes `${origin}${url_path}` so a code is portable across
 *      external platforms and across staging/prod). OSE owns resolution.
 *   2. ENFORCEMENT layer — the terminal public renderers (/events/:id,
 *      /forms/:id) where every event-bearing URL converges. Staleness is
 *      enforced HERE, so it holds no matter which emitter produced the link.
 * UEC today resolves semantic categories (/enter, /live, /archive…), not event
 * instances, so it has no event-lifecycle to check. WHEN a future UEC/shortlink
 * surface carries event context, it funnels through the same renderers — or
 * calls the two helpers below directly — and inherits "never rot" for free.
 */

import { parseEventState, canRender } from '../domain/event-state';

/** Fixed, internal forward target for a stale public landing — the discovery
 * listing. A literal path (never derived from request input) so this can never
 * become an open-redirect vector (Dr-Security: agentic/appsec review). */
export const STALE_FORWARD_PATH = '/events';

/**
 * True when an event in this D1 `status` must NOT take a live public landing
 * (i.e. it is not renderable on the public surface: draft / ready / archived).
 * `active` → false. Unknown/garbage status parses to 'draft' → true (fail-safe:
 * an unparseable state is treated as not-live, never as live).
 */
export function isStaleForPublicLanding(status: unknown): boolean {
  return !canRender(parseEventState(status), 'public');
}

/**
 * Build the staleness forward: a 302 to the fixed internal `/events` listing.
 *
 * Emits a NEVER-WHO structured signal (SRE/SDET field-debug hook): it carries
 * only the event id + parsed state + surface — no anon_id, no cookie, no PII, no
 * exact timestamp. It exists so a bar owner's "nothing worked" report is
 * traceable to "the event was archived" without touching who scanned.
 *
 * @param origin  server-derived request origin (`new URL(request.url).origin`)
 * @param eventId the resolved event id (for the log only — not echoed to markup)
 * @param status  the raw D1 status (parsed for the log)
 * @param surface which public seam forwarded (e.g. 'form') — for field triage
 */
export function staleEventForward(
  origin: string,
  eventId: string,
  status: unknown,
  surface: string
): Response {
  console.log(
    JSON.stringify({
      type: 'STALE_EVENT_FORWARD',
      surface,
      event_id: eventId,
      event_state: parseEventState(status),
    })
  );
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}${STALE_FORWARD_PATH}`,
      'Cache-Control': 'no-store',
    },
  });
}
