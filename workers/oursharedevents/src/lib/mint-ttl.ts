/**
 * mint-ttl.ts — resolve a SharedReport mint-link token TTL to seconds (OSE-1390).
 *
 * Pure request-validation for
 *   POST /api/v2/admin/events/:id/shared-report/mint-link
 * kept dependency-free so it runs in the fast node vitest project (no worker deps).
 *
 *   ttl_minutes (integer 5–1440) → run-scoped tokens (a captured token is worthless
 *                                  minutes later). Takes precedence.
 *   ttl_days    (integer 1–365, default 7) → unchanged, backward-compatible.
 *   both present → error (ambiguous).
 *
 * The bounds are a SERVER-SIDE clamp: the client cannot mint a token that outlives
 * the ceiling or dodges the floor. `starts_at`/exp stay server-computed.
 */
export const MINT_TTL_MINUTES_MIN = 5;
export const MINT_TTL_MINUTES_MAX = 1440; // 1 day; for longer, use ttl_days
export const MINT_TTL_DAYS_MIN = 1;
export const MINT_TTL_DAYS_MAX = 365;
export const MINT_TTL_DAYS_DEFAULT = 7;

export type TtlResolution = { ttlSeconds: number } | { error: string };

export function resolveMintTtlSeconds(body: {
  ttl_minutes?: unknown;
  ttl_days?: unknown;
}): TtlResolution {
  const hasMinutes = body.ttl_minutes !== undefined;
  const hasDays = body.ttl_days !== undefined;

  if (hasMinutes && hasDays) {
    return { error: 'provide ttl_minutes or ttl_days, not both' };
  }

  if (hasMinutes) {
    const m = body.ttl_minutes;
    if (
      typeof m !== 'number' ||
      !Number.isInteger(m) ||
      m < MINT_TTL_MINUTES_MIN ||
      m > MINT_TTL_MINUTES_MAX
    ) {
      return {
        error: `ttl_minutes must be an integer between ${MINT_TTL_MINUTES_MIN} and ${MINT_TTL_MINUTES_MAX}`,
      };
    }
    return { ttlSeconds: m * 60 };
  }

  const d = hasDays ? body.ttl_days : MINT_TTL_DAYS_DEFAULT;
  if (
    typeof d !== 'number' ||
    !Number.isInteger(d) ||
    d < MINT_TTL_DAYS_MIN ||
    d > MINT_TTL_DAYS_MAX
  ) {
    return {
      error: `ttl_days must be an integer between ${MINT_TTL_DAYS_MIN} and ${MINT_TTL_DAYS_MAX}`,
    };
  }
  return { ttlSeconds: d * 24 * 60 * 60 };
}
