/**
 * OSE-272 — Peppered SHA-256 hash of an anon_id, truncated to 32 hex chars.
 *
 * Mirrors the OSE-207 ip_hash pattern (src/handlers/pages.ts hashIpForSubscribe)
 * but with a distinct pepper (ANON_ID_HASH_PEPPER) per Q1 ratified decision
 * (2026-05-15): separate peppers + separate rotation cadence so the two
 * anonymity scopes — per-attendee event correlation vs. rate-limit /
 * subscriber identity — have independent compromise blast radii.
 *
 * Used by the SharedReport data pipeline to populate:
 *   - anon_id_returns.anon_id_hash       (migration 0031)
 *   - corridor_density_baseline distinct-anon counts (migration 0032)
 *
 * Returns null if no pepper is configured. Callers MUST treat null as
 * "no SharedReport signal available for this anon_id" and either skip the
 * aggregate update OR emit a structured warning. NEVER write the raw
 * anon_id as a fallback.
 *
 * Truncation: 32 hex chars = 128 bits of collision resistance, ample for
 * "did this same anon_id visit twice" aggregate-count uniqueness without
 * any reversibility benefit from a longer hash.
 *
 * Anonymity properties:
 *
 *   - One-way: knowing the hash does NOT let an attacker derive the
 *     anon_id without the pepper.
 *   - Pepper rotation invalidates all historical hashes — same as
 *     IP_HASH_PEPPER rotation behavior. SharedReport return-rate signal
 *     "resets" at pepper rotation, which is the intended semantics for
 *     defense in depth. Since migration 0091 each row records pepperEpoch()
 *     and the corridor-returns export counts only the current epoch, so the
 *     reset is enforced, not assumed.
 *   - The pepper itself is a Wrangler secret (Doppler-managed per
 *     reference_doppler memory).
 */
export async function hashAnonIdForReturns(
  anonId: string,
  pepper: string | undefined
): Promise<string | null> {
  if (!pepper) return null;
  const buf = new TextEncoder().encode(`${anonId}|${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * One-way fingerprint of the pepper that hashed a row (migration 0091). Rows
 * written under a rotated-out pepper carry a different epoch, so a count can be
 * limited to one pepper and never sees the same browser under two hashes. The
 * fingerprint cannot be reversed to the pepper and is not a key for anything else.
 */
export async function pepperEpoch(pepper: string | undefined): Promise<string | null> {
  if (!pepper) return null;
  const buf = new TextEncoder().encode(`ose-anon-pepper-epoch|${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
