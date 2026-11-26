/**
 * Flood detection on a vote code (OSE-2234; OSE ADR-040 decision 6, amended
 * 2026-11-26: "add flood detection only", owner).
 *
 * WHY. The cookie can be forged (lib/anonymous-id.ts accepts any `anon_`
 * value), so a script holding a photo of the vote code can mint a fresh voter
 * key with every request. ADR-040 does not cap that (no per-address cap at
 * `/q`, no per-song cap until a flood is seen). This file is how a flood gets
 * seen. It detects; it never blocks, slows or refuses a vote.
 *
 * THE SIGNAL. Every vote pass `/q` mints for an event counts once, renewals
 * included: a forged cookie never needs a new one, so new cookies would miss
 * it. The count lives in a Workers Rate Limiting binding (VOTE_FLOOD_LIMITER,
 * wrangler.toml), keyed by `vote-flood:` and the event id only, for one
 * 60-second window, in memory at the Cloudflare location. Past
 * VOTE_FLOOD_PASSES_PER_MINUTE the binding answers `success: false`, and the
 * set's burst_seen turns to 1, once.
 *
 * THE HOST'S ALARM, NOT THE PUBLIC'S (owner, decision card 2026-11-26, "Room
 * check only, show room size"). burst_seen is shown in the admin Voting card
 * only. One browser re-scanning fast, or a large honest room arriving at once,
 * can trip it (CCR loops 1 to 3), so it never marks a public result. The
 * public "may be padded" line comes only from the room check at final
 * (flood_seen, lib/vote-results.ts ROOM_CHECK_UPDATE).
 *
 * WHY THE BINDING, NOT KV (the story's first sketch). A KV counter takes one
 * write per pass on one key, and KV refuses more than one write a second to a
 * key: it would fail exactly during a flood. KV's get-then-put also loses
 * counts under concurrency. The binding has no write limit and stores nothing.
 * Its known limit: it counts per Cloudflare location and syncs in the
 * background (lib/edge-rate-limit.ts measured it letting ~500 through over
 * 20 s on staging before its first refusal), so it trips late and a flood
 * spread across many locations may not trip it. It is a smoke alarm, not a
 * meter.
 *
 * WHAT IS KEPT. A boolean on vote_sets. No time (the write does not touch
 * updated_at), no count, no address, no cookie, no k and no pass, in the key,
 * the value or any log line. The one log line (written by `/q`, not here) names the event and nothing else;
 * the log host stamps it with its own time, so the operator's logs (never the
 * database) know roughly when the flag tripped.
 *
 * WHAT IT CANNOT SEE (CCR loop 1, H1). A night is decided by a lead of 5 to 9
 * and 10 to 14 voters (decision 7), so 10 to 20 forged passes can swing it,
 * well under this threshold. A paced or spread-out stuffer is not flagged. No
 * flag never means a clean night; a flag means a careless bulk flood.
 *
 * OFF THE ANSWER PATH. `/q` hands this to ctx.waitUntil when it has a context
 * (the router always does), so detection runs after the redirect is sent.
 *
 * FAIL-SAFE. No binding, a binding that throws, or a D1 error: nothing is
 * flagged, and the scan and its pass stand. This function never throws.
 */

/** The binding's runtime shape (`env.X.limit({ key })`), as lib/edge-rate-limit.ts. */
export interface VoteFloodLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface VoteFloodEnv {
  DB: D1Database;
  /** One 60-second window per event (wrangler.toml `[[ratelimits]]`). Unbound: no detection. */
  VOTE_FLOOD_LIMITER?: VoteFloodLimiter;
}

/**
 * Vote passes in one minute, for one event, past which a flood is flagged. Must
 * match VOTE_FLOOD_LIMITER's `simple.limit` in wrangler.toml (gate:
 * tests/vote-flood.spec.ts). The owner picks it; proposed 300 because:
 *   - S0 (ADR-040) put a full room of 150 browsers through `/q` in 5 seconds:
 *     a whole room arriving at once is about 150 passes in a minute, and twice
 *     that is not a room;
 *   - one address is held to 360 a minute at `/q` (KV) and 60 per 10 s at the
 *     edge, so a script from one address at full speed passes 300.
 */
export const VOTE_FLOOD_PASSES_PER_MINUTE = 300;

/** The binding key: the event only. Never an address, cookie, k or pass. */
export function voteFloodKey(eventId: string): string {
  return `vote-flood:${eventId}`;
}

/**
 * The one write. It sets the flag to the literal 1, only on a set that is not
 * final and not flagged yet, and touches no other column (no updated_at, so
 * the hour of the flood is not kept).
 */
export const MARK_FLOOD_SQL = `UPDATE vote_sets SET burst_seen = 1
  WHERE event_id = ? AND burst_seen = 0 AND is_final = 0`;

// Events this isolate has already flagged, so a flood past the limit does not
// write once per pass. Bounded: a long-lived isolate forgets the oldest.
const flagged = new Set<string>();
const FLAGGED_MAX = 1000;

/** For tests only: forget what this isolate has flagged. */
export function resetVoteFloodMemo(): void {
  flagged.clear();
}

/**
 * Count one minted vote pass for the event; flag a flood past the limit.
 * Returns true only when this call wrote the flag. Never throws.
 */
export async function noteVotePassMinted(env: VoteFloodEnv, eventId: string): Promise<boolean> {
  const limiter = env.VOTE_FLOOD_LIMITER;
  if (!limiter || !eventId || !env.DB) return false;
  try {
    const { success } = await limiter.limit({ key: voteFloodKey(eventId) });
    if (success || flagged.has(eventId)) return false;
    const res = await env.DB.prepare(MARK_FLOOD_SQL).bind(eventId).run();
    if (flagged.size >= FLAGGED_MAX) flagged.clear();
    flagged.add(eventId);
    // No log line here: the caller logs, so this function forwards no
    // parameter into a console call (the log-redaction gate's wrapper rule).
    return (res.meta?.changes ?? 0) > 0;
  } catch {
    // Detection never blocks a vote, and the line would name nothing useful.
    return false;
  }
}
