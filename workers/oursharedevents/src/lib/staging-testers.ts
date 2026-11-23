/**
 * Staging testers: outside people who try the admin pages on staging, each
 * inside one practice brand of their own (owner, 2026-11-22).
 *
 * WHY A SETTING, NOT CODE. The repository is public and a tester is a real
 * person, so no tester's address or brand is written here or in wrangler.toml.
 * The owner keeps the list in one staging Worker secret, STAGING_TESTERS, set
 * in the Cloudflare dashboard. Adding or removing a tester needs no PR.
 *
 *   STAGING_TESTERS = {"tester@example.com":"practice-brand", ...}
 *
 * WHAT IT GRANTS, AND ONLY THERE.
 *   - On staging only (WORKER_ENV === 'staging'). Anywhere else the setting is
 *     read as empty, so a copy on production grants nothing (and the
 *     production preflight refuses the secret there, FORBIDDEN_SECRETS).
 *   - A listed address passes the admin allowlist (lib/admin-allowlist.ts). It
 *     still has to pass Cloudflare Access first: the owner adds it to the
 *     staging Access policy too.
 *   - Its brand scope is exactly its one brand (lib/admin-brand-scope.ts),
 *     used only when the address has no admin_brand_memberships row.
 *
 * FAIL CLOSED. A malformed setting, a malformed address, a brand that is not a
 * plain slug, or the platform or public brand all grant nothing. A tester never
 * gets 'all', more than one brand, or a role (resolveAdminRoles reads the
 * membership table only), so owner-only screens stay closed to them.
 */
import { PLATFORM_BRAND_ID, PUBLIC_BRAND_ID } from './admin-brand-scope';

export interface StagingTestersEnv {
  WORKER_ENV?: string;
  /** JSON object, tester email → practice brand slug. A staging Worker secret. */
  STAGING_TESTERS?: string;
}

/**
 * The environments where the setting grants anything. A list, so a later
 * testing environment is one entry here (and its own secret), never production.
 */
export const TESTER_ENVIRONMENTS: readonly string[] = ['staging'];

/** The most testers the setting may list; more reads as malformed (nothing granted). */
export const MAX_STAGING_TESTERS = 50;

const BRAND_SHAPE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EMAIL_SHAPE = /^[^\s@,]{1,64}@[^\s@,]{1,253}\.[^\s@,]{2,63}$/;

/** Tester email (lowercased) → its one brand. Empty off staging or when malformed. */
export function stagingTesters(env: StagingTestersEnv): Map<string, string> {
  const out = new Map<string, string>();
  if (!env.WORKER_ENV || !TESTER_ENVIRONMENTS.includes(env.WORKER_ENV)) return out;
  const raw = env.STAGING_TESTERS?.trim();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_STAGING_TESTERS) return out;
  for (const [email, brand] of entries) {
    const e = email.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(e)) continue;
    if (typeof brand !== 'string' || !BRAND_SHAPE.test(brand)) continue;
    if (brand === PLATFORM_BRAND_ID || brand === PUBLIC_BRAND_ID) continue;
    out.set(e, brand);
  }
  return out;
}

/** The tester's one brand, or null when the address is not a staging tester. */
export function stagingTesterBrand(email: string | null, env: StagingTestersEnv): string | null {
  if (!email) return null;
  return stagingTesters(env).get(email.trim().toLowerCase()) ?? null;
}
