// ─── The per-poster-hour scan cap (OSE-1496) ────────────────────────────────
//
// Owner decision 2026-11-23: each poster counts at most POSTER_HOUR_CAP scans
// in one UTC hour, and a figure that reached the cap reads "100 or more".
//
// What it does: bounds how many scans one poster can add in an hour, whoever
// sends them, with or without a cookie. Past the cap the visitor is still sent
// on to the event (never refused, like the per-caller limit), and the scan is
// not counted.
//
// What it does not do: stop the four-scan probe of the count floor (K = 5).
// Any cap of 5 or more admits four fake scans; that residual is the owner's
// accepted risk (OSE-1496 decision 2, 2026-10-07), recorded in the threat model.
//
// ATOMIC. One statement takes a place: INSERT … ON CONFLICT DO UPDATE …
// RETURNING runs as one write on D1's single primary, so two scans at the same
// moment cannot both take place 100. The counter stops at cap + 1, so the table
// never records how big a crowd beyond the cap was.
//
// FAIL OPEN. A failed write (a D1 blip) counts the scan, as before the cap: a
// blip is not something a caller can cause, and losing real scans is worse.
//
// The room's vote code is not capped: its scans publish no poster figure
// (OSE-2140) and a full room votes through it.

import { errorLabel } from './error-label';

/** Scans one poster may count in one UTC hour. Owner decision 2026-11-23. */
export const POSTER_HOUR_CAP = 100;

/** The hour of a scan_bucket ("YYYY-MM-DDTHH…"), the scan-cells grain. */
export function scanHourOf(scanBucket: string): string {
  return scanBucket.slice(0, 13);
}

const TAKE_SQL = `INSERT INTO scan_poster_hour_tally (poster_deployment_id, scan_hour, scans)
     VALUES (?, ?, 1)
     ON CONFLICT (poster_deployment_id, scan_hour)
       DO UPDATE SET scans = MIN(scans + 1, ${POSTER_HOUR_CAP + 1})
     RETURNING scans`;

/**
 * Take one of this poster-hour's places. True when the scan may be counted,
 * false when the poster has already counted POSTER_HOUR_CAP scans this hour.
 */
export async function takePosterHourPlace(
  db: D1Database,
  posterId: string,
  scanHour: string
): Promise<boolean> {
  try {
    const row = await db.prepare(TAKE_SQL).bind(posterId, scanHour).first<{ scans: number }>();
    return Number(row?.scans ?? 0) <= POSTER_HOUR_CAP;
  } catch (err) {
    console.warn(
      JSON.stringify({
        type: 'POSTER_HOUR_CAP_SKIPPED',
        error: errorLabel(err),
      })
    );
    return true;
  }
}

/** Rows older than this are deleted by the cron job; a cap needs only the current hour. */
export const POSTER_HOUR_TALLY_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/** Delete tally rows for hours before `now - POSTER_HOUR_TALLY_KEEP_MS`. */
export async function prunePosterHourTally(db: D1Database, now: Date): Promise<number> {
  const cutoff = scanHourOf(new Date(now.getTime() - POSTER_HOUR_TALLY_KEEP_MS).toISOString());
  const res = await db
    .prepare('DELETE FROM scan_poster_hour_tally WHERE scan_hour < ?')
    .bind(cutoff)
    .run();
  return res.meta?.changes ?? 0;
}

/** The cron job: prune old tally rows. Never throws; logs a count of rows, nothing else. */
export async function runPosterHourTallyPrune(
  env: { DB?: D1Database },
  now: Date = new Date()
): Promise<void> {
  if (!env.DB) return;
  try {
    const deleted = await prunePosterHourTally(env.DB, now);
    console.log(JSON.stringify({ type: 'POSTER_HOUR_TALLY_PRUNED', deleted }));
  } catch (err) {
    console.warn(
      JSON.stringify({
        type: 'POSTER_HOUR_TALLY_PRUNE_FAILED',
        error: errorLabel(err),
      })
    );
  }
}
