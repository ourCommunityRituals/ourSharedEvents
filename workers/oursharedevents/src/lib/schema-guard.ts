/**
 * Schema version guard — OSE-803
 *
 * D1 bindings are UUIDs. Cloudflare will bind a Worker built against migration
 * 0061 to a database sitting at 0041 without complaint: the deploy goes green and
 * the failure surfaces later as `SQLITE_ERROR: no such column` at prepare time,
 * on a phone, in somebody's hand.
 *
 * This module closes that gap. It runs ONCE per isolate, asserts that both D1
 * bindings are at or beyond the migration the code was written against, and
 * refuses to serve if they are not.
 *
 * FAIL-CLOSED vs FAIL-OPEN — the distinction matters:
 *   - A successful query returning a LOWER version is real drift. Fail closed.
 *   - A failed query (D1 unreachable, d1_migrations absent) is infrastructure,
 *     not drift. Fail OPEN and log — a transient D1 hiccup must not 503 the site.
 *
 * Diagnosability: the router lets /health and /api/status through even when
 * drift is detected, so the drift is READABLE rather than merely fatal. A guard
 * you cannot interrogate is a guard that gets deleted at 2am.
 *
 * KEEP THESE CONSTANTS IN STEP WITH THE MIGRATION DIRECTORIES.
 * Bump in the SAME PR as any migration. CI asserts this — see
 * scripts/check-schema-guard.mjs.
 */

/** Highest migration in migrations/ — currently 0086_remove_seed_test_event.sql */
export const REQUIRED_DB_MIGRATION = 86;

/** Highest migration in migrations-forms/ — currently 0015_checkin_walk_in_count.sql */
export const REQUIRED_FORMS_MIGRATION = 15;

export interface SchemaGuardEnv {
  DB?: D1Database;
  FORMS_DB?: D1Database;
  WORKER_ENV?: string;
}

export interface SchemaDrift {
  binding: 'DB' | 'FORMS_DB';
  found: number;
  required: number;
}

/** Module-level cache — one check per isolate, not per request. */
let checked = false;
let drift: SchemaDrift | null = null;

/** Test seam. */
export function __resetSchemaGuard(): void {
  checked = false;
  drift = null;
}

async function highestApplied(db: D1Database | undefined): Promise<number | null> {
  if (!db) return null;
  try {
    const row = await db
      .prepare('SELECT MAX(id) AS v FROM d1_migrations')
      .first<{ v: number | null }>();
    return row && typeof row.v === 'number' ? row.v : null;
  } catch {
    // d1_migrations absent, or D1 unavailable. Infrastructure — not drift.
    return null;
  }
}

/**
 * Check both bindings. Returns the drift if the code is ahead of a database,
 * or null when healthy / undeterminable. Result is cached for the isolate.
 */
export async function checkSchema(env: SchemaGuardEnv): Promise<SchemaDrift | null> {
  if (checked) return drift;

  const [dbVersion, formsVersion] = await Promise.all([
    highestApplied(env.DB),
    highestApplied(env.FORMS_DB),
  ]);

  if (dbVersion !== null && dbVersion < REQUIRED_DB_MIGRATION) {
    drift = { binding: 'DB', found: dbVersion, required: REQUIRED_DB_MIGRATION };
  } else if (formsVersion !== null && formsVersion < REQUIRED_FORMS_MIGRATION) {
    drift = { binding: 'FORMS_DB', found: formsVersion, required: REQUIRED_FORMS_MIGRATION };
  } else {
    drift = null;
  }

  checked = true;

  if (drift) {
    console.error(
      JSON.stringify({
        type: 'SCHEMA_DRIFT',
        binding: drift.binding,
        found: drift.found,
        required: drift.required,
        env: env.WORKER_ENV ?? 'unknown',
        message:
          `D1 binding ${drift.binding} is at migration ${drift.found}; this Worker ` +
          `requires ${drift.required}. Apply migrations or roll back the Worker.`,
        timestamp: new Date().toISOString(),
      })
    );
  }

  return drift;
}

/** The 503 served to every route except the diagnostic ones while drift persists. */
export function schemaDriftResponse(d: SchemaDrift): Response {
  return Response.json(
    {
      ok: false,
      status: 503,
      error: 'Schema drift — refusing to serve',
      detail: `D1 binding ${d.binding} is at migration ${d.found}; this Worker requires ${d.required}.`,
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Paths that stay reachable during drift so the drift can be diagnosed. */
export function isDiagnosticPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api/status';
}
