/**
 * OSE-666 / B1 — Admin brand-scope resolution (INVARIANT #9 tenant_isolation).
 *
 * The admin events list (events.ts handleAdminListEvents) historically ran an
 * UNSCOPED `SELECT ... FROM events`, so on a shared multi-tenant instance a
 * brand-A operator received every brand's rows — a live #9 breach. This module
 * is the single enforcement point that derives which brand(s) a caller may see.
 *
 * FAIL-CLOSED BY CONSTRUCTION. An operator the system cannot scope receives
 * `{ mode: 'deny' }` → zero rows, NEVER the whole table. Scope is derived from
 * the SERVER-VERIFIED actor identity (the CF Access email, via extractAdminActor)
 * — never from a client-supplied `?brand_id=` query string, which is caller-
 * chosen and therefore not a security boundary.
 *
 * INTERIM SOURCE (B1): the email→brand map is read from `ADMIN_BRAND_MEMBERSHIP`
 * (JSON). B2 (OSE-666) replaces this env source with an audited membership table
 * WITHOUT changing this function's contract or its callers — the enforcement
 * point and the fail-closed default stay put; only the lookup backing changes.
 *
 * AUTOMATION ESCAPE HATCH: CI/internal key actors (`key:ocr-internal`,
 * `key:admin`) carry no brand identity. They run unscoped ONLY when the
 * deployment sets `ADMIN_SCOPE_ALL=true` — a staging/CI opt-in that is NEVER
 * granted to a real (email) operator. Absent the flag, key actors also deny.
 */

export interface AdminBrandScopeEnv {
  /** Interim email→brandIds map, JSON: `{ "user@x": ["brand-A", ...] }`. B2 fallback. */
  ADMIN_BRAND_MEMBERSHIP?: string;
  /** `'true'` lets key/automation actors run unscoped (CI/staging only, never an email operator). */
  ADMIN_SCOPE_ALL?: string;
  /** B2: the audited membership table backing scope (migration 0050). */
  DB?: D1Database;
}

/** OSE-671 groundwork: the admin role vocabulary carried on a membership row. */
export type AdminRole = 'brand_owner' | 'organizer' | 'sponsor_manager' | 'staff';

export type AdminBrandScope =
  | { mode: 'all' }
  | { mode: 'scoped'; brandIds: string[] }
  | { mode: 'deny' };

/**
 * Resolve the brand scope for an admin caller. Pure — takes the already-extracted
 * actor (from extractAdminActor) so it is trivially unit-testable and has no
 * request/crypto dependency.
 *
 * @param actor server-verified actor id: an email, `key:ocr-internal`,
 *              `key:admin`, or null (unauthenticated / unknown).
 */
export function resolveAdminBrandScope(
  actor: string | null,
  env: AdminBrandScopeEnv
): AdminBrandScope {
  // Fail-closed: no identity → no rows.
  if (!actor) return { mode: 'deny' };

  // Automation / CI keys carry no brand identity. Unscoped access is an explicit
  // deployment opt-in, never inferred, and never for an email operator.
  if (actor.startsWith('key:')) {
    return env.ADMIN_SCOPE_ALL === 'true' ? { mode: 'all' } : { mode: 'deny' };
  }

  // Email operator → interim membership map. Absent / malformed / unmapped /
  // empty membership all collapse to deny-all — never the whole table.
  const raw = env.ADMIN_BRAND_MEMBERSHIP?.trim();
  if (!raw) return { mode: 'deny' };

  let map: Record<string, unknown>;
  try {
    map = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { mode: 'deny' };
  }
  if (!map || typeof map !== 'object') return { mode: 'deny' };

  const entry = map[actor];
  if (!Array.isArray(entry)) return { mode: 'deny' };

  const brandIds = Array.from(
    new Set(entry.filter((b): b is string => typeof b === 'string' && b.length > 0))
  );
  if (brandIds.length === 0) return { mode: 'deny' };

  return { mode: 'scoped', brandIds };
}

/**
 * OSE-666 / B2 — DB-backed scope resolution. The audited membership table
 * (admin_brand_memberships, migration 0050) is the source of truth; the interim
 * ADMIN_BRAND_MEMBERSHIP env map is the fallback for envs where the table is not
 * yet populated. Still fail-closed and still server-derived from the actor — the
 * table is looked up by the caller's verified email, never a client brand_id.
 *
 * - key/automation actors: unchanged (ADMIN_SCOPE_ALL opt-in), no DB read.
 * - email actor with >=1 membership row: scoped to those brands.
 * - email actor with no rows: fall back to the env map, else deny.
 */
export async function resolveAdminBrandScopeAsync(
  actor: string | null,
  env: AdminBrandScopeEnv
): Promise<AdminBrandScope> {
  if (!actor) return { mode: 'deny' };
  // Automation keys carry no brand identity — same opt-in path, no DB.
  if (actor.startsWith('key:')) return resolveAdminBrandScope(actor, env);

  if (env.DB) {
    try {
      const rows = await env.DB.prepare(
        'SELECT brand_id FROM admin_brand_memberships WHERE email = ?'
      )
        .bind(actor)
        .all<{ brand_id: string }>();
      const brandIds = Array.from(
        new Set(
          (rows.results ?? [])
            .map((r) => r.brand_id)
            .filter((b): b is string => typeof b === 'string' && b.length > 0)
        )
      );
      if (brandIds.length > 0) return { mode: 'scoped', brandIds };
    } catch {
      // Table absent (env not migrated) → fall through to the env-map fallback.
    }
  }

  // No membership rows → interim env map, else deny (both fail-closed).
  return resolveAdminBrandScope(actor, env);
}

/**
 * OSE-671 groundwork: resolve the caller's roles from the membership table
 * (email → {brand_id, role}[]). Returns [] when unmapped / no DB. Server-derived.
 */
export async function resolveAdminRoles(
  actor: string | null,
  env: AdminBrandScopeEnv
): Promise<Array<{ brandId: string; role: AdminRole }>> {
  if (!actor || actor.startsWith('key:') || !env.DB) return [];
  try {
    const rows = await env.DB.prepare(
      'SELECT brand_id, role FROM admin_brand_memberships WHERE email = ?'
    )
      .bind(actor)
      .all<{ brand_id: string; role: string }>();
    return (rows.results ?? []).map((r) => ({
      brandId: r.brand_id,
      role: (['brand_owner', 'organizer', 'sponsor_manager', 'staff'].includes(r.role)
        ? r.role
        : 'staff') as AdminRole,
    }));
  } catch {
    return [];
  }
}
