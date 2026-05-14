/**
 * Shortlinks lib — OSE-240 / BE-25.
 *
 * Generates and resolves 6-character base62 shareable event codes. Owns
 * the shortlinks table created in migration 0030_create_shortlinks.sql.
 *
 * Anonymity-principle compliance (reinforced 2026-05-14):
 *   The resolve flow MUST track the click counter + last_clicked_at
 *   timestamp ONLY. No IP, no anon_id, no session cookie, no Referer.
 *   See `incrementClick()` below — that contract is the gate.
 *
 * Collision math: base62 (a-zA-Z0-9) × 6 chars = 56,800,235,584 codes.
 * At 1M events the expected collisions per random draw is ~9e-6. The
 * generate-and-retry loop in `createShortlink` handles the rare case
 * deterministically without burning many DB roundtrips.
 *
 * No `crypto.randomUUID` here because we want a short, human-typable
 * code, not a UUID. `crypto.getRandomValues` gives us the entropy we
 * need; base62 encoding gives us the shape.
 */

export interface ShortlinksEnv {
  DB?: D1Database;
}

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LEN = 6;
const MAX_GENERATE_RETRIES = 5;

/**
 * Generate a fresh 6-char base62 code using cryptographically-strong
 * randomness. No DB call here — purely synthetic.
 *
 * Exported so unit tests can verify the shape independently of the
 * DB-bound create path.
 */
export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += BASE62_ALPHABET[bytes[i] % BASE62_ALPHABET.length];
  }
  return out;
}

/**
 * Lightweight format check used by the resolve handler before hitting
 * the DB. Rejects obviously malformed codes (wrong length, non-base62
 * characters) so bots probing `/s/<garbage>` don't hit D1 at all.
 */
export function isValidCodeShape(code: string): boolean {
  if (typeof code !== 'string' || code.length !== CODE_LEN) return false;
  for (let i = 0; i < code.length; i++) {
    if (!BASE62_ALPHABET.includes(code[i])) return false;
  }
  return true;
}

export interface CreateShortlinkResult {
  code: string;
}

/**
 * Create a shortlink for the given event. Generates a fresh base62 code
 * and inserts; retries on the rare PRIMARY KEY collision. Throws if the
 * DB binding is missing OR every retry collides (vanishingly unlikely).
 *
 * Caller owns the eventId — typically `handleCreateEvent` passes the
 * id it just generated for the events row, in the same code path so
 * either both rows commit or both roll back at the platform level.
 */
export async function createShortlink(
  env: ShortlinksEnv,
  eventId: string
): Promise<CreateShortlinkResult> {
  if (!env.DB) {
    throw new Error('[shortlinks] DB binding missing');
  }
  for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
    const code = generateCode();
    try {
      await env.DB.prepare(
        `INSERT INTO shortlinks (code, event_id, created_at)
         VALUES (?, ?, datetime('now'))`
      )
        .bind(code, eventId)
        .run();
      return { code };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint') || msg.includes('PRIMARY KEY')) {
        // Collision — try a fresh code.
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `[shortlinks] could not generate a unique code after ${MAX_GENERATE_RETRIES} attempts`
  );
}

export interface ResolvedShortlink {
  code: string;
  event_id: string;
}

/**
 * Look up the event_id for a code. Returns null if no row matches.
 * Does NOT increment the click counter — the caller (resolve handler)
 * calls `incrementClick()` separately after deciding whether the
 * redirect target is renderable. This separation lets test harnesses
 * exercise lookup without side effects.
 */
export async function resolveCode(
  env: ShortlinksEnv,
  code: string
): Promise<ResolvedShortlink | null> {
  if (!env.DB) return null;
  if (!isValidCodeShape(code)) return null;
  const row = await env.DB.prepare(`SELECT code, event_id FROM shortlinks WHERE code = ?`)
    .bind(code)
    .first<ResolvedShortlink>();
  return row ?? null;
}

/**
 * Increment the click counter + stamp last_clicked_at. PRINCIPLE: this
 * is the ONLY mutation the resolve flow performs. No IP, no anon_id,
 * no session, no Referer. The signal we record is "this link was
 * clicked, this many times, last at this moment" — group-level
 * temporal data, never per-attendee.
 *
 * Returns the post-increment click count for observability (handlers
 * can log it; admin UI can render it). Never throws on D1 errors —
 * the redirect MUST succeed even if the counter increment fails, so
 * we swallow errors here with a structured log.
 */
export async function incrementClick(env: ShortlinksEnv, code: string): Promise<number> {
  if (!env.DB) return 0;
  try {
    await env.DB.prepare(
      `UPDATE shortlinks
       SET clicks = clicks + 1,
           last_clicked_at = datetime('now')
       WHERE code = ?`
    )
      .bind(code)
      .run();
    const row = await env.DB.prepare(`SELECT clicks FROM shortlinks WHERE code = ?`)
      .bind(code)
      .first<{ clicks: number }>();
    return row?.clicks ?? 0;
  } catch (err) {
    console.warn(
      JSON.stringify({
        type: 'SHORTLINK_CLICK_LOG_ERROR',
        code,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      })
    );
    return 0;
  }
}
