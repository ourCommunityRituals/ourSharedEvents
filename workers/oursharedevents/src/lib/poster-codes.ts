/**
 * Poster codes — OSE-1357 part 2: more than one code per poster, each pointing
 * at a target the organizer picks.
 *
 * Data model (migration 0080): every code is a `shortlinks` row — one /s/
 * ROUTING link per (event, kind) — and `poster_position` is its place on the
 * poster (0 = the event page, always first; NULL = not on the poster). Taking a
 * code off the poster never deletes the row, so a printed code keeps working.
 * Physical per-placement TRACKING stays `/q/<qr_token>` (poster_deployments);
 * the two layers are composed, never merged — no code here is a /q path.
 *
 * Targets:
 *   - INTERNAL kinds (event page, anonymous check-in) are built server-side at
 *     redirect time from the event id alone; a client-sent target is ignored.
 *   - EXTERNAL kinds (donate, sign-up, tickets, other link, ourWKRP) must be a
 *     valid https:// URL (isValidHttpsTarget) — javascript:, data:, http: are
 *     refused with a 400 at save time, never at resolve time.
 *
 * Entitlement: how many codes fit on a poster is a tier allotment
 * (POSTER_CODE_LIMITS), read from the platform's current flag tier and
 * enforced HERE on save — the admin UI only mirrors it.
 *
 * Never-who: a click is still only `clicks + 1` and a timestamp.
 */

import {
  createShortlink,
  isValidHttpsTarget,
  type ShortlinksEnv,
  type SlotShortlink,
} from './shortlinks';
import type { Tier } from './feature-flags';

/** How a code's target is produced. */
export type PosterCodeTarget = 'event' | 'checkin' | 'https';

/** Colour family. Green is ONLY anonymous check-in; blue is ONLY donate. */
export type PosterCodeTone = 'checkin' | 'donate' | 'neutral';

export interface PosterCodeKind {
  kind: string;
  /** The one big word printed with the code — the non-colour channel. */
  word: string;
  /** What the organizer picks from, in their words. */
  choice: string;
  target: PosterCodeTarget;
  tone: PosterCodeTone;
}

/**
 * The target kinds, in the order the admin picker offers them. The external
 * keys reuse the what_url_type vocabulary (donation/tickets/league/…), so an
 * event's existing typed link carries straight over as a poster code.
 */
export const POSTER_CODE_KINDS: readonly PosterCodeKind[] = [
  { kind: 'public', word: 'EVENT', choice: 'Event page', target: 'event', tone: 'neutral' },
  {
    kind: 'checkin',
    word: 'CHECK IN',
    choice: 'Anonymous check-in',
    target: 'checkin',
    tone: 'checkin',
  },
  { kind: 'donation', word: 'DONATE', choice: 'Donation link', target: 'https', tone: 'donate' },
  { kind: 'signup', word: 'SIGN UP', choice: 'Sign-up link', target: 'https', tone: 'neutral' },
  { kind: 'tickets', word: 'TICKETS', choice: 'Tickets link', target: 'https', tone: 'neutral' },
  { kind: 'ow', word: 'MUSIC', choice: 'ourWKRP link', target: 'https', tone: 'neutral' },
  { kind: 'league', word: 'LEAGUE', choice: 'League link', target: 'https', tone: 'neutral' },
  { kind: 'workshop', word: 'REGISTER', choice: 'Workshop link', target: 'https', tone: 'neutral' },
  {
    kind: 'substack',
    word: 'SUBSCRIBE',
    choice: 'Newsletter link',
    target: 'https',
    tone: 'neutral',
  },
  { kind: 'menu', word: 'MENU', choice: 'Menu link', target: 'https', tone: 'neutral' },
  { kind: 'website', word: 'MORE', choice: 'Other link', target: 'https', tone: 'neutral' },
];

const KIND_BY_KEY = new Map(POSTER_CODE_KINDS.map((k) => [k.kind, k]));

/** Catalog entry for a kind; unknown/legacy kinds read as a neutral "MORE". */
export function posterCodeKind(kind: string): PosterCodeKind {
  return (
    KIND_BY_KEY.get(kind) ?? {
      kind,
      word: 'MORE',
      choice: 'Other link',
      target: 'https',
      tone: 'neutral',
    }
  );
}

/**
 * Codes a poster may carry per plan tier, COUNTING the event-page code.
 * Product decision (2026-09-29, OSE-1357): see the PR — these numbers are the
 * one place to change it.
 */
export const POSTER_CODE_LIMITS: Readonly<Record<Tier, number>> = {
  free: 3,
  mid: 5,
  enterprise: 8,
};

/** Hard ceiling on a request body, whatever the tier (abuse guard). */
const MAX_REQUEST_CODES = 20;

export function posterCodeLimit(tier: Tier): number {
  return POSTER_CODE_LIMITS[tier] ?? POSTER_CODE_LIMITS.free;
}

/** Where an INTERNAL kind routes — built from the event id only, no identity. */
export function internalTarget(origin: string, eventId: string, kind: string): string {
  const id = encodeURIComponent(eventId);
  return posterCodeKind(kind).target === 'checkin'
    ? `${origin}/forms/${id}?type=checkin`
    : `${origin}/events/${id}`;
}

export interface PosterCodeInput {
  kind: string;
  /** Only for external kinds; null for internal ones. */
  target_url: string | null;
}

export type ParseResult =
  | { ok: true; codes: PosterCodeInput[] }
  | { ok: false; code: string; error: string; index?: number };

/**
 * Validate a PUT body `{ codes: [{ kind, target_url? }] }` into the ordered
 * list of codes AFTER the event page (which is implicit and always first).
 * Pure — no DB — so every refusal is unit-testable.
 */
export function parsePosterCodes(body: unknown, limit: number): ParseResult {
  const raw = (body as { codes?: unknown } | null)?.codes;
  if (!Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_BODY', error: 'Send { codes: [...] }.' };
  }
  if (raw.length > MAX_REQUEST_CODES) {
    return { ok: false, code: 'TOO_MANY_CODES', error: 'Too many codes in one request.' };
  }
  const seen = new Set<string>();
  const codes: PosterCodeInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as { kind?: unknown; target_url?: unknown } | null;
    const kind = typeof entry?.kind === 'string' ? entry.kind.trim() : '';
    const spec = KIND_BY_KEY.get(kind);
    if (!spec) {
      return {
        ok: false,
        code: 'INVALID_KIND',
        error: 'Pick what this code opens from the list.',
        index: i,
      };
    }
    if (kind === 'public') continue; // the event page is implicit and always first
    if (seen.has(kind)) {
      return {
        ok: false,
        code: 'DUPLICATE_KIND',
        error: `The poster already has a ${spec.word} code.`,
        index: i,
      };
    }
    seen.add(kind);
    if (spec.target === 'https') {
      const url = typeof entry?.target_url === 'string' ? entry.target_url.trim() : '';
      if (!isValidHttpsTarget(url)) {
        return {
          ok: false,
          code: 'INVALID_TARGET',
          error: `The ${spec.word} link must be a full https:// address.`,
          index: i,
        };
      }
      codes.push({ kind, target_url: url });
    } else {
      // Internal target: built server-side; anything the client sent is dropped.
      codes.push({ kind, target_url: null });
    }
  }
  if (codes.length + 1 > limit) {
    return {
      ok: false,
      code: 'PLAN_LIMIT',
      error: `Your plan fits ${limit} codes on a poster, including the event page.`,
    };
  }
  return { ok: true, codes };
}

/**
 * The codes an organizer has SAVED for the poster, in order (event page first).
 * Returns null when none are saved (or the 0080 column is not there yet), so
 * the caller falls back to the original Event page + typed-link slots.
 */
export async function listSavedPosterCodes(
  env: ShortlinksEnv,
  eventId: string
): Promise<SlotShortlink[] | null> {
  if (!env.DB) return null;
  try {
    const rows = await env.DB.prepare(
      `SELECT code, COALESCE(NULLIF(kind, ''), 'public') AS kind, target_url
         FROM shortlinks
        WHERE event_id = ? AND poster_position IS NOT NULL
        ORDER BY poster_position ASC, created_at ASC`
    )
      .bind(eventId)
      .all<SlotShortlink>();
    const list = rows.results ?? [];
    if (!list.length) return null;
    // The event page leads whatever the stored order says.
    const pub = list.filter((r) => r.kind === 'public').slice(0, 1);
    return [...pub, ...list.filter((r) => r.kind !== 'public')];
  } catch {
    return null; // un-migrated DB: legacy slots
  }
}

async function codeForKind(env: ShortlinksEnv, eventId: string, kind: string) {
  return env
    .DB!.prepare(
      `SELECT code FROM shortlinks
      WHERE event_id = ? AND (kind = ? OR (? = 'public' AND kind IS NULL))
      ORDER BY created_at ASC LIMIT 1`
    )
    .bind(eventId, kind, kind)
    .first<{ code: string }>();
}

/**
 * Save the poster's code list: the event page at 0, then `codes` in order.
 * One row per (event, kind) — an existing row is REUSED (its target updated in
 * place, so a printed code follows the organizer's fix) and a missing one is
 * minted. Rows left out go to NULL: off the poster, still routing.
 */
export async function savePosterCodes(
  env: ShortlinksEnv,
  eventId: string,
  codes: PosterCodeInput[]
): Promise<void> {
  if (!env.DB) throw new Error('[poster-codes] DB binding missing');
  const keep: string[] = [];
  const pub = await codeForKind(env, eventId, 'public');
  const publicCode = pub?.code ?? (await createShortlink(env, eventId, { kind: 'public' })).code;
  keep.push(publicCode);
  const writes: D1PreparedStatement[] = [
    env.DB.prepare('UPDATE shortlinks SET poster_position = 0 WHERE code = ?').bind(publicCode),
  ];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    const existing = await codeForKind(env, eventId, c.kind);
    const code =
      existing?.code ??
      (await createShortlink(env, eventId, { kind: c.kind, targetUrl: c.target_url })).code;
    keep.push(code);
    writes.push(
      env.DB.prepare(
        'UPDATE shortlinks SET target_url = ?, poster_position = ? WHERE code = ?'
      ).bind(c.target_url, i + 1, code)
    );
  }
  writes.push(
    env.DB.prepare(
      `UPDATE shortlinks SET poster_position = NULL
        WHERE event_id = ? AND code NOT IN (${keep.map(() => '?').join(', ')})`
    ).bind(eventId, ...keep)
  );
  await env.DB.batch(writes);
}
