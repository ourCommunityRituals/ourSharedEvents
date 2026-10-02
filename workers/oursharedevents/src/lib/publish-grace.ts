// ─── Publish grace window (PO decision 2026-10-02) ───────────────────────────
//
// Publish is meant to be safe to undo. For PUBLISH_GRACE_MINUTES after an event
// moves into `active` (verify-qr, or PUT status), it is live for anyone who
// holds its link (page, poster QR codes, the organizer's own TV), but it stays
// off every surface where strangers find events on their own:
//   the list (/events, GET /api/v2/events, the TV's "coming up"), the map,
//   the sitemap, sponsor discovery, and the corridor count.
// An Undo inside the window therefore leaves no public trace. When the window
// ends the event lists itself; nothing has to run.
//
// Storage: events.listed_from (migration 0093), an ISO-8601 UTC instant.
//   value → listed once that instant has passed. Every move into active sets
//           it, even with the window off (then it is "now"), and so does
//           creating an event as active, so the corridor latch can always
//           tell how long an event has been listed.
//   NULL  → rows from before 0093 (listed as before), and events not active.
// Stored as JS toISOString() so it compares as text against LISTED_NOW_SQL.
//
// Testing: the fast vitest pool sets PUBLISH_GRACE_MINUTES = "0" so unrelated
// specs can publish and list at once. Deployed envs, `wrangler dev`, and the
// API / Playwright suites run with the window on (wrangler.toml), and
// tests/publish-grace.spec.ts sets it back on to prove the behaviour.

export const DEFAULT_PUBLISH_GRACE_MINUTES = 10;
/** The window may be shortened or turned off, never stretched past an hour. */
export const MAX_PUBLISH_GRACE_MINUTES = 60;

/** SQL "now" in the same text shape as Date.prototype.toISOString(). */
export const LISTED_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * True when the event's grace window is over. `alias` is the events table
 * alias in the query ('' for none). Use it next to `is_published = 1`.
 */
export function listedSql(alias = ''): string {
  const col = alias ? `${alias}.listed_from` : 'listed_from';
  return `(${col} IS NULL OR ${col} <= ${LISTED_NOW_SQL})`;
}

/** Minutes from env. Unset or invalid → default; 0 or less → off; capped at 60. */
export function resolvePublishGraceMinutes(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_PUBLISH_GRACE_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PUBLISH_GRACE_MINUTES;
  if (n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_PUBLISH_GRACE_MINUTES);
}

/**
 * The listed_from to store when an event moves into active now: now plus the
 * window, or now itself when the window is off. Never NULL, so the corridor
 * latch's 24-hour settling rule applies to every new publication.
 */
export function listedFromForPublish(raw: string | undefined, now: Date = new Date()): string {
  const minutes = resolvePublishGraceMinutes(raw);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export interface PublishGraceEnv {
  PUBLISH_GRACE_MINUTES?: string;
}
