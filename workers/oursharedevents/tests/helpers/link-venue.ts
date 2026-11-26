/**
 * Voting opens only on an event linked to its venue (owner card 2026-11-26,
 * VENUE_NEEDED in lib/vote-sets.ts). A spec that opens a vote set links each
 * event to a venue of its own brand with this. The venue has no room limit, so
 * the ROOM_CEILING_DEFAULT applies unless the spec sets one. It is set up as
 * the platform would (room_kind 'outdoor', no permit limit): voting opens only
 * at a venue the platform has set up (VENUE_NOT_SET_UP).
 */
export async function linkVenue(db: D1Database, eventId: string): Promise<string> {
  const venueId = `ven-${eventId}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO venues (id, brand_id, name, room_kind)
         SELECT ?, brand_id, 'Test venue', 'outdoor' FROM events WHERE id = ?`
    )
    .bind(venueId, eventId)
    .run();
  await db.prepare('UPDATE events SET host_venue_id = ? WHERE id = ?').bind(venueId, eventId).run();
  return venueId;
}
