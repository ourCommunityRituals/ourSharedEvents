/**
 * The rotating vote code (OSE-2234 follow-up; OSE ADR-040 decision 6, amended
 * 2026-11-26: "as stringent as you can make it", owner).
 *
 * WHY. The room's vote code (lib/vote-code.ts) used to be one URL for the
 * whole night. A photo of it, posted to a group chat or handed to a script or
 * an AI agent, kept minting vote passes from anywhere until the host replaced
 * it. Now the URL the room screen shows carries a stamp that changes every
 * minute, and `/q` mints a pass only for a stamp from this minute or the one
 * before. A photo stops working within two minutes. To keep voting, someone
 * outside the room needs a live view of the screen, all night.
 *
 * THE STAMP. `w=<minute>.<seal>`: the minute is whole minutes since the epoch
 * (UTC, the server's clock only), and the seal is the first 16 bytes of an
 * HMAC over the code's token and that minute, under a subkey of
 * ANON_ID_HASH_PEPPER (HKDF, its own label). No new secret. Nobody without the
 * pepper can make a stamp for a minute they have not seen on the screen.
 *
 * WHAT IT IS NOT. It names no voter, no device and no count. It does not stop
 * someone standing in the room with a script: that is what the room size
 * check at final is for (lib/vote-results.ts ROOM_CHECK_UPDATE).
 *
 * FAILS CLOSED. No pepper, no stamp, a malformed stamp, a stamp from another
 * code or an old minute: no pass. The scan itself still stands, and the
 * visitor gets the event page, as for any other code.
 */

/** How long one stamp is current. The screen reloads well inside it. */
export const VOTE_CODE_WINDOW_SECONDS = 60;
/** Stamps accepted: this minute and the one before, so a stamp lives 60 to 120 seconds. */
export const VOTE_CODE_WINDOWS_ACCEPTED = 2;

/** HKDF `info` for the stamp's seal. Its own; never imported from another file. */
const WINDOW_SEAL_LABEL = 'ose:vote:code-window:v1';
const HKDF_SALT = new TextEncoder().encode('oursharedevents:vote-code-window');

const STAMP = /^(\d{1,12})\.([0-9a-f]{32})$/;

const keys = new Map<string, Promise<CryptoKey>>();

function sealKey(pepper: string): Promise<CryptoKey> {
  let key = keys.get(pepper);
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pepper),
        'HKDF',
        false,
        ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: HKDF_SALT,
          info: new TextEncoder().encode(WINDOW_SEAL_LABEL),
        },
        material,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign']
      );
    })();
    keys.set(pepper, key);
    key.catch(() => keys.delete(pepper));
  }
  return key;
}

async function seal(pepper: string, token: string, minute: number): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await sealKey(pepper),
    new TextEncoder().encode(`${token}\u0000${minute}`)
  );
  return Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  );
}

/** The minute a time falls in. */
export function voteCodeMinute(nowMs: number): number {
  return Math.floor(nowMs / (VOTE_CODE_WINDOW_SECONDS * 1000));
}

/** The stamp for a code's token at a time. */
export async function voteCodeStamp(pepper: string, token: string, nowMs: number): Promise<string> {
  const minute = voteCodeMinute(nowMs);
  return `${minute}.${await seal(pepper, token, minute)}`;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True only for a stamp made for this token in this minute or the one before.
 * Never throws: anything unexpected is false.
 */
export async function voteCodeStampOk(
  pepper: string | undefined,
  token: string,
  stamp: string | null,
  nowMs: number
): Promise<boolean> {
  if (!pepper || !token || !stamp) return false;
  const m = STAMP.exec(stamp);
  if (!m) return false;
  const minute = Number(m[1]);
  const now = voteCodeMinute(nowMs);
  if (!Number.isSafeInteger(minute) || minute > now || now - minute >= VOTE_CODE_WINDOWS_ACCEPTED)
    return false;
  try {
    return sameText(await seal(pepper, token, minute), m[2]);
  } catch {
    return false;
  }
}
