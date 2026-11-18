/**
 * Going live needs a code that works (lib/go-live-evidence.ts): a share link
 * the resolver accepts, or a poster that is switched on. Specs that seed an
 * event row straight into D1 and then walk it to `active` give it one here, so
 * they keep testing what they were written for and not the refusal
 * (tests/go-live-evidence.spec.ts covers that).
 *
 * The link is the same row event creation writes: a 6-character base62 code
 * with no target, which opens the event's own page.
 */
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A code of the shape the product mints: exactly 6 base62 characters. */
export function mintTestCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += BASE62[b % BASE62.length];
  return out;
}

/** Give the event one working share link, unless it already has a link. */
export async function giveGoLiveEvidence(db: D1Database, eventId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO shortlinks (code, event_id, created_at)
       SELECT ?, ?, datetime('now')
        WHERE NOT EXISTS (SELECT 1 FROM shortlinks WHERE event_id = ?)`
    )
    .bind(mintTestCode(), eventId, eventId)
    .run();
}
