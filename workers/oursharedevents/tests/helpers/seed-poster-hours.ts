/**
 * Seed poster scans hour by hour: the one grain the SharedReport counts people
 * in (OSE-1784, owner 2026-11-23, "one number, from the posters").
 *
 * distinct_scanners, corridor_density.this_event_count and every
 * headcount_trend instance are the sum of an event's published poster rows, so
 * a test that wants a head count seeds scans at a poster here. Each scan is one
 * scan_placement_events row in the given hour; /q/ stores at most one per
 * person per poster per hour, so `n` rows in one hour are `n` people.
 */

/** The poster an event's scans go to when a test names none. */
export const defaultPosterOf = (eventId: string): string => `${eventId}-poster`;

/** Insert a poster for `eventId` if it is not there yet. */
export async function seedPoster(
  db: D1Database,
  eventId: string,
  posterId: string = defaultPosterOf(eventId),
  label = 'Front window'
): Promise<string> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token, placement_label)
       VALUES (?, ?, ?, ?)`
    )
    .bind(posterId, eventId, `qr-${posterId}`, label)
    .run();
  return posterId;
}

/**
 * `n` scans at a poster of `eventId` in one hour of 2026-05-07 (UTC). `hour` is
 * 0 to 23, or any string a test used as a bucket name (mapped to an hour by a
 * stable hash, so distinct names are distinct hours for the few a test uses).
 */
export async function seedPosterHour(
  db: D1Database,
  eventId: string,
  hour: number | string,
  n: number,
  posterId?: string
): Promise<void> {
  const pid = await seedPoster(db, eventId, posterId);
  const h =
    typeof hour === 'number'
      ? hour % 24
      : /^\d+$/.test(hour)
        ? Number(hour) % 24
        : [...hour].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 24, 7);
  const hh = String(h).padStart(2, '0');
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
           VALUES (?, ?, ?, ?)`
        )
        .bind(`${pid}-h${hh}-${i}`, eventId, pid, `2026-05-07T${hh}:00`)
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
}

/** Remove the posters and scans of events whose id starts with `prefix`. */
export async function clearPosterHours(db: D1Database, prefix: string): Promise<void> {
  await db
    .prepare(`DELETE FROM scan_placement_events WHERE event_id LIKE ?`)
    .bind(`${prefix}%`)
    .run();
  await db.prepare(`DELETE FROM poster_deployments WHERE event_id LIKE ?`).bind(`${prefix}%`).run();
}
