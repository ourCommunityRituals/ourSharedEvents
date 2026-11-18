/**
 * Does this code work? One rule per kind of code, and one place it is written.
 *
 * An event has two kinds of code a person can scan or tap:
 *   - a share link (`/s/:code`, a `shortlinks` row): the digital poster's QR;
 *   - a placed poster (`/q/:token`, a `poster_deployments` row).
 *
 * Whoever needs to know whether a row is a working code asks here. Today that
 * is the go-live gate (lib/go-live-evidence.ts). An admin view that lists an
 * event's codes with a reason beside each (the "code ledger" in OSE-1420) is
 * not built yet; when it is, it calls these same two functions, so the gate and
 * that view cannot disagree about a row (OSE-1426).
 *
 * The rule is about the row alone. Whether the event is live, listed or in the
 * past is a separate question for the caller.
 */

import { isValidQrTokenShape } from './qr-token';
import { isValidCodeShape, isValidHttpsTarget } from './shortlinks';

/** The columns of a `shortlinks` row the rule reads. */
export interface ShareLinkRow {
  code: unknown;
  target_url: unknown;
}

/** The columns of a `poster_deployments` row the rule reads. */
export interface PosterRow {
  qr_token: unknown;
  is_active: unknown;
  /** OSE-2140: 1 for the room's own vote code, which is not a poster. */
  is_vote_code?: unknown;
}

/**
 * A share link works when the resolver will look its code up (exactly 6 base62
 * characters, `isValidCodeShape`: any other code is a 404 before the database
 * is read) and its destination is the event's own page (no target) or an https
 * address (`isValidHttpsTarget`, the rule a target is held to when it is
 * saved).
 *
 * A row with any other target is refused here although the resolver sends it
 * to the event page: such a row cannot come from the product, so it is a
 * damaged row, and a damaged row is not proof that a code works.
 */
export function isWorkingShareLink(row: ShareLinkRow): boolean {
  if (typeof row.code !== 'string' || !isValidCodeShape(row.code)) return false;
  const target = row.target_url;
  if (target === null || target === undefined || target === '') return true;
  return isValidHttpsTarget(target);
}

/**
 * A placed poster works when the scan route will forward it: it is switched on
 * (`is_active = 1`, the route's own lookup) and its token has the shape the
 * route accepts (`isValidQrTokenShape`: any other token is sent home before
 * the database is read). The product only mints tokens of that shape, so a row
 * with another is a damaged row, as with a share link above.
 *
 * The room's own vote code (OSE-2140) is never a working poster: it is the room
 * screen, not a poster (owner, 2026-11-18), so it alone never takes an event live.
 */
export function isWorkingPoster(row: PosterRow): boolean {
  if (row.is_vote_code === 1) return false;
  if (row.is_active !== 1) return false;
  return typeof row.qr_token === 'string' && isValidQrTokenShape(row.qr_token);
}
