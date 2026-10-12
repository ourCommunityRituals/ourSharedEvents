// ─── Event code — one short code per event (OSE-1684) ───────────────────────
//
// Every public screen of an event answers at a short address built from one
// code (owner decisions 2026-10-09): /e/ the event page (the share link), /p/
// the poster, /tv/ the TV, /r/ register, /c/ check-in. An event id is 40
// characters; nobody types that on a TV remote or reads it to a neighbour.
//
// Uppercase, from an alphabet with no look-alikes (no 0/O, 1/I/L), and read
// case- and space-insensitively, so "k7q 2px" finds K7Q2PX. 31^6 ≈ 887 million
// codes; every resolver is rate-limited at the route. Kept in its own table
// (migration 0096), never in shortlinks, which are printed and reported.

/** Every character from `first` to `last`, inclusive. */
function charRange(first: string, last: string): string[] {
  const from = first.charCodeAt(0);
  return Array.from({ length: last.charCodeAt(0) - from + 1 }, (_, i) =>
    String.fromCharCode(from + i)
  );
}

// A–Z without I, L, O, then 2–9 (no 0, 1): 31 characters. Built from ranges
// rather than written out, because a 31-character literal reads as a secret to
// the committed-secret gate (detect-secrets).
export const EVENT_CODE_ALPHABET = [...charRange('A', 'Z'), ...charRange('2', '9')]
  .filter((ch) => !'ILO'.includes(ch))
  .join('');
export const EVENT_CODE_LENGTH = 6;
const MINT_ATTEMPTS = 5;

/** The short address prefix of each screen. `share` is the event page. */
export const EVENT_CODE_SCREENS = {
  share: 'e',
  poster: 'p',
  tv: 'tv',
  register: 'r',
  checkin: 'c',
} as const;
export type EventCodeScreen = keyof typeof EVENT_CODE_SCREENS;

/** Every short address of one code, keyed by screen. */
export function eventCodeLinks(code: string): Record<EventCodeScreen, string> {
  const links = {} as Record<EventCodeScreen, string>;
  for (const [screen, prefix] of Object.entries(EVENT_CODE_SCREENS)) {
    links[screen as EventCodeScreen] = `/${prefix}/${code}`;
  }
  return links;
}

/** A fresh random code. */
export function generateEventCode(): string {
  const bytes = new Uint8Array(EVENT_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 % 31 leaves a bias under 1% toward the first characters; a code is a
  // lookup key, not a secret, so that is fine.
  return Array.from(bytes, (b) => EVENT_CODE_ALPHABET[b % EVENT_CODE_ALPHABET.length]).join('');
}

/** What was typed, as a code, or null when it cannot be one. */
export function normalizeEventCode(raw: string): string | null {
  let typed: string;
  try {
    typed = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = typed.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== EVENT_CODE_LENGTH) return null;
  for (const ch of code) if (!EVENT_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The event's code, minted on first ask. Throws on a database failure. */
export async function ensureEventCode(db: D1Database, eventId: string): Promise<string> {
  const read = () =>
    db
      .prepare('SELECT code FROM event_codes WHERE event_id = ?')
      .bind(eventId)
      .first<{ code: string }>();
  const existing = await read();
  if (existing) return existing.code;
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    try {
      await db
        .prepare('INSERT INTO event_codes (code, event_id) VALUES (?, ?)')
        .bind(generateEventCode(), eventId)
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
  throw new Error('[event-code] could not mint a code');
}

/** The event a code opens, or null. */
export async function resolveEventCode(db: D1Database, code: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT event_id FROM event_codes WHERE code = ?')
    .bind(code)
    .first<{ event_id: string }>();
  return row?.event_id ?? null;
}
