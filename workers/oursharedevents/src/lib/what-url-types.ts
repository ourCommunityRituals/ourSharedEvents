/**
 * what-url-types — canonical vocabulary for `events.what_url_type` (R3 typed
 * external link), OSE-1319.
 *
 * ONE source of truth. The two read-path label maps MUST stay supersets of this
 * list (a drift-guard test asserts it):
 *   - `WHAT_LINK_LABELS` in `handlers/pages.ts`   — the public event-page CTA label
 *   - `POSTER_SLOT_LABELS` in `handlers/poster-bundle.ts` — the poster slot label
 *
 * Posture: strict-in / lenient-out. The admin WRITE path (`handleCreateEvent` /
 * `handleUpdateEvent`) validates against this allowlist and 400s an unknown type
 * (the admin dropdown only ever emits these; the 400 catches a direct-API
 * fat-finger). The READ paths fall back safely to the 'website' label for an
 * unknown/stale value, so a row never fails to render.
 */
export const WHAT_URL_TYPES = [
  'donation',
  'league',
  'workshop',
  'substack',
  'tickets',
  'menu',
  'website',
] as const;

export type WhatUrlType = (typeof WHAT_URL_TYPES)[number];

/** True when `t` is one of the canonical what_url_type values. */
export function isValidWhatUrlType(t: unknown): t is WhatUrlType {
  return typeof t === 'string' && (WHAT_URL_TYPES as readonly string[]).includes(t);
}
