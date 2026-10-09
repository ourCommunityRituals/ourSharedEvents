// ─── TV code — a short code to type on a TV (OSE-1684) ──────────────────────
//
// An event's TV page is /events/<id>/tv; the id is 40 characters, which nobody
// types with a TV remote. The organizer reads a six-character code in admin
// and opens /tv/<code> on the TV instead (owner decision 2026-10-09).
//
// Uppercase, from an alphabet with no look-alikes (no 0/O, 1/I/L), and read
// case- and space-insensitively, so "k7q 2px" finds K7Q2PX. 31^6 ≈ 887 million
// codes; the resolver is rate-limited at the route. One code per event, kept
// in its own table (migration 0096) so it is never counted, printed on a
// poster or reported the way shortlinks are.

export const TV_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TV_CODE_LENGTH = 6;
const MINT_ATTEMPTS = 5;

/** A fresh random code. */
export function generateTvCode(): string {
  const bytes = new Uint8Array(TV_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 % 31 leaves a bias under 1% toward the first characters; a code is a
  // lookup key, not a secret, so that is fine.
  return Array.from(bytes, (b) => TV_CODE_ALPHABET[b % TV_CODE_ALPHABET.length]).join('');
}

/** What was typed, as a code, or null when it cannot be one. */
export function normalizeTvCode(raw: string): string | null {
  let typed: string;
  try {
    typed = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = typed.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== TV_CODE_LENGTH) return null;
  for (const ch of code) if (!TV_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The event's code, minted on first ask. Throws on a database failure. */
export async function ensureTvCode(db: D1Database, eventId: string): Promise<string> {
  const read = () =>
    db
      .prepare('SELECT code FROM event_tv_codes WHERE event_id = ?')
      .bind(eventId)
      .first<{ code: string }>();
  const existing = await read();
  if (existing) return existing.code;
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    try {
      await db
        .prepare('INSERT INTO event_tv_codes (code, event_id) VALUES (?, ?)')
        .bind(generateTvCode(), eventId)
        .run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('UNIQUE constraint') && !msg.includes('PRIMARY KEY')) throw err;
      // Either the code was taken (try another) or a second request minted
      // this event's code first (read it back below).
    }
    const minted = await read();
    if (minted) return minted.code;
  }
  throw new Error('[tv-code] could not mint a code');
}

/** The event a code opens, or null. */
export async function resolveTvCode(db: D1Database, code: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT event_id FROM event_tv_codes WHERE code = ?')
    .bind(code)
    .first<{ event_id: string }>();
  return row?.event_id ?? null;
}
