/**
 * OSE-272 — SharedReport data pipeline static-invariant gates
 *
 * Defends the anonymity contract documented in
 * docs/features/SHARED-REPORT-DATA-PIPELINE.md across the schema and the
 * supporting library code. CI runs these on every PR.
 *
 * Gate inventory (from the design doc — gates 3 and 4 land in Sessions 3-4
 * when the materialization handler + BigQuery export ship):
 *
 *   Gate 1 (this file) — No FORMS_DB reads in any SharedReport
 *                        pipeline file (preserves ADR-001 isolation).
 *   Gate 2 (this file) — No raw anon_id storage. The new migrations
 *                        must define anon_id_hash columns and MUST NOT
 *                        define a column literally named `anon_id` in
 *                        any pipeline table.
 *
 * The lower-numbered gates (architecture.spec.ts, pii-invariant.spec.ts)
 * already defend the global rules. This file is the pipeline-specific
 * supplement — it asserts the SharedReport-pipeline-scoped subset of
 * those rules in one place so future contributors looking at the
 * pipeline can find its invariants without grepping.
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// The set of pipeline-related migration files Gate 2 inspects.
// Add new files here as the pipeline grows.
const PIPELINE_MIGRATIONS = [
  '0031_create_anon_id_returns.sql',
  '0032_create_corridor_density_baseline.sql',
  '0033_create_event_series.sql',
  '0034_events_add_series_id.sql',
  '0035_create_bigquery_export_state.sql',
  // OSE-330 Phase 2 — Local Sponsor Covenant. Adds is_local to the
  // existing sponsors table. NOT a pipeline-shape migration (sponsors is
  // metadata, not per-attendee), but registering here satisfies the
  // drift-guard at line ~320 which requires every 003x_*.sql to be listed.
  // The per-migration Gate 2 check below treats this migration as a
  // sponsors-metadata change (no per-attendee columns expected).
  '0036_add_is_local_to_sponsors.sql',
  // OSE-450 S-6 — H3 NCR tagging. Adds h3_res9/h3_res7 TEXT columns to events
  // and scan_aggregates. NOT per-attendee columns; geo enrichment only.
  '0037_add_h3_cells_to_events.sql',
  '0038_scan_aggregates_add_h3_cells.sql',
];

// The set of pipeline-related lib + handler files Gate 1 inspects.
// Session 2: anon-id-hash.ts. Session 3: shared-report.ts + the
// scheduled-only handler shared-report-materialize.ts. Session 4:
// shared-report-export.ts (lib + handler). Session 5: the read-API
// stack (shared-report-auth.ts, shared-report-builder.ts, and the
// shared-report-read.ts handler).
const PIPELINE_LIB_FILES = [
  'src/lib/anon-id-hash.ts',
  'src/lib/shared-report.ts',
  'src/lib/shared-report-auth.ts',
  'src/lib/shared-report-builder.ts',
  'src/lib/shared-report-export.ts',
  'src/handlers/shared-report-materialize.ts',
  'src/handlers/shared-report-export.ts',
  'src/handlers/shared-report-read.ts',
];

function loadSource(relPath: string): string | null {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
  return entry ? entry[1] : null;
}

function loadMigrationByName(name: string): string | null {
  // The vitest config flattens all migrations into TEST_MIGRATION_STATEMENTS
  // as a JSON array of executed-statement strings. Match by filename via
  // the source-files map, which includes the .sql files too.
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) =>
    p.replace(/\\/g, '/').endsWith(`migrations/${name}`)
  );
  return entry ? entry[1] : null;
}

// ─── Gate 1 — no FORMS_DB reads in SharedReport pipeline source files ───────

describe('OSE-272 Gate 1: no FORMS_DB reads in pipeline source files', () => {
  test.each(PIPELINE_LIB_FILES)('%s does not reference env.FORMS_DB', (rel) => {
    const src = loadSource(rel);
    expect(src, `${rel} not in TEST_SOURCE_FILES_JSON`).not.toBeNull();
    expect(src!).not.toMatch(/env\.FORMS_DB/);
    expect(src!).not.toMatch(/FORMS_DB\b/);
  });

  // Drift-guard — when Sessions 4-5 add BigQuery exporter and read API,
  // register them in PIPELINE_LIB_FILES so this gate covers them.
  test('PIPELINE_LIB_FILES list is honest about what exists in src/', () => {
    for (const f of PIPELINE_LIB_FILES) {
      const src = loadSource(f);
      expect(src, `${f} expected to exist`).not.toBeNull();
    }
  });
});

// ─── Gate 4 — materialization handler is cron-only, never user-facing ───────

describe('OSE-272 Gate 4: SharedReport materialization is cron-only', () => {
  // The materialization entry point (runSharedReportMaterialization) MUST
  // NOT appear in any user-facing handler or in the router. The ONLY caller
  // permitted is the scheduled() handler in src/index.ts (which dispatches
  // it via the daily cron trigger configured in wrangler.toml).
  //
  // If a future PR exposes the materialization as a route (e.g., for a
  // "manually trigger backfill" admin endpoint), this gate fails. Manual
  // backfill should be its own admin handler with its own audit + auth
  // path, NOT a direct call to the cron-only function.

  test('runSharedReportMaterialization is NOT referenced from src/router.ts', () => {
    const src = loadSource('src/router.ts');
    expect(src, 'router.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/runSharedReportMaterialization/);
  });

  test('runSharedReportMaterialization IS referenced from src/index.ts (scheduled handler)', () => {
    const src = loadSource('src/index.ts');
    expect(src, 'index.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/runSharedReportMaterialization/);
    // Bonus: must appear inside the scheduled() block, not the fetch() block.
    // Cheap proxy: scheduled() appears in source BEFORE the call site.
    const scheduledIdx = src!.indexOf('async scheduled(');
    const callIdx = src!.indexOf('runSharedReportMaterialization(env)');
    expect(scheduledIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(scheduledIdx);
  });

  test('materialize handler does not export a route handler shape', () => {
    // Sanity: the handler file should not export anything that looks like
    // a Request -> Response handler (which would be a sign someone is
    // trying to expose it via the router).
    const src = loadSource('src/handlers/shared-report-materialize.ts');
    expect(src, 'shared-report-materialize.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(
      /export\s+(?:async\s+)?function\s+handle\w+\s*\([^)]*request\s*:\s*Request/i
    );
  });

  test('pipeline lib does not import from router', () => {
    // shared-report.ts is the pure aggregation lib; it must not pull in
    // routing primitives (which would imply user-facing wiring).
    const src = loadSource('src/lib/shared-report.ts');
    expect(src, 'shared-report.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/from\s+['"]\.\.\/router['"]/);
    expect(src!).not.toMatch(/import.*\broute\b.*from/);
  });
});

// ─── Gate 5 — BigQuery export handler is cron-only, never user-facing ───────

describe('OSE-272 Gate 5: SharedReport BigQuery export is cron-only', () => {
  // Mirror of Gate 4 for the Session 4 export. The export streams aggregate
  // rows to BigQuery — it must NEVER be invoked from a request handler.
  // Cron-only by static-source contract.

  test('runSharedReportBigQueryExport is NOT referenced from src/router.ts', () => {
    const src = loadSource('src/router.ts');
    expect(src, 'router.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/runSharedReportBigQueryExport/);
  });

  test('runSharedReportBigQueryExport IS referenced from src/index.ts (scheduled handler)', () => {
    const src = loadSource('src/index.ts');
    expect(src, 'index.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/runSharedReportBigQueryExport/);
    const scheduledIdx = src!.indexOf('async scheduled(');
    const callIdx = src!.indexOf('runSharedReportBigQueryExport(env)');
    expect(scheduledIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(scheduledIdx);
  });

  test('export handler does not export a route handler shape', () => {
    const src = loadSource('src/handlers/shared-report-export.ts');
    expect(src, 'shared-report-export.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(
      /export\s+(?:async\s+)?function\s+handle\w+\s*\([^)]*request\s*:\s*Request/i
    );
  });

  test('export lib does not import from router', () => {
    const src = loadSource('src/lib/shared-report-export.ts');
    expect(src, 'shared-report-export.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/from\s+['"]\.\.\/router['"]/);
    expect(src!).not.toMatch(/import.*\broute\b.*from/);
  });

  test('export pipeline writes only aggregate tables, never raw scans/forms', () => {
    // The exporter joins to events for routing tags but only writes to
    // BigQuery — never INSERTs into scans, registrations, surveys, etc.
    // This is a paranoia gate: catches a future PR that accidentally
    // "enriches" the export with forms data.
    const src = loadSource('src/lib/shared-report-export.ts');
    expect(src, 'shared-report-export.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/INSERT\s+INTO\s+scans/i);
    expect(src!).not.toMatch(/INSERT\s+INTO\s+form_/i);
    expect(src!).not.toMatch(/INSERT\s+INTO\s+email_signups/i);
  });
});

// ─── Gate 6 — SharedReport read API is read-only (no writes to pipeline) ────

describe('OSE-272 Gate 6: SharedReport read API is read-only', () => {
  // The read API surfaces aggregate data to bars, sponsors, and (in-fleet)
  // WKRP. It MUST NEVER write to anon_id_returns, corridor_density_baseline,
  // or event_series — those are written exclusively by the cron (Session 3
  // materialization). A handler that writes back through the read path
  // would break the cron-only invariant AND defeat the read/write
  // separation that anchors the Session-3 / Session-5 boundary.

  test('shared-report-builder.ts contains no INSERT/UPDATE/DELETE statements', () => {
    const src = loadSource('src/lib/shared-report-builder.ts');
    expect(src, 'shared-report-builder.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // SELECT is fine (read). Any write statement is a contract violation.
    expect(src!).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(src!).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(src!).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  test('shared-report-read.ts (handler) contains no INSERT/UPDATE/DELETE statements', () => {
    const src = loadSource('src/handlers/shared-report-read.ts');
    expect(src, 'shared-report-read.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(src!).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
    expect(src!).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  test('shared-report-builder.ts does not query forms tables', () => {
    // Read-side echo of Gate 1: no FORMS_DB access from the read path.
    // The builder must not enrich SharedReport with per-attendee form data.
    const src = loadSource('src/lib/shared-report-builder.ts');
    expect(src, 'shared-report-builder.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/\bform_registrations\b/i);
    expect(src!).not.toMatch(/\bform_surveys\b/i);
    expect(src!).not.toMatch(/\bemail_signups\b/i);
    expect(src!).not.toMatch(/env\.FORMS_DB/);
  });

  test('shared-report-read.ts response shape never includes anon_id_hash', () => {
    // The builder reads anon_id_hash internally for COUNT(*) operations
    // but never returns it. This gate is a paranoia check: the read
    // handler's response surface must not include the hash field.
    const src = loadSource('src/handlers/shared-report-read.ts');
    expect(src, 'shared-report-read.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // The handler delegates to the builder; the builder's SharedReport
    // interface in shared-report-builder.ts must also not expose anon_id_hash.
    const builderSrc = loadSource('src/lib/shared-report-builder.ts');
    expect(builderSrc).not.toBeNull();
    // Allow it to APPEAR in WHERE/SELECT clauses (internal aggregation)
    // but NOT in any exported interface field.
    expect(builderSrc!).not.toMatch(/anon_id_hash\s*:/);
  });

  test('shared-report-auth.ts does not query the database', () => {
    // Auth verification must be pure crypto — never D1 lookups.
    const src = loadSource('src/lib/shared-report-auth.ts');
    expect(src, 'shared-report-auth.ts not in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).not.toMatch(/env\.DB/);
    expect(src!).not.toMatch(/env\.FORMS_DB/);
    expect(src!).not.toMatch(/\.prepare\(/);
  });
});

// ─── Gate 2 — no raw anon_id columns in pipeline migration tables ───────────

describe('OSE-272 Gate 2: no raw anon_id columns in pipeline migrations', () => {
  // The anonymity contract: only anon_id_hash (peppered SHA-256, 32 hex) is
  // stored. A column literally named `anon_id` would defeat the entire moat.
  // This regex is intentionally narrow: matches `anon_id` as a column name
  // followed by a TYPE keyword. It must NOT match `anon_id_hash`.
  const RAW_ANON_ID_COLUMN = /\banon_id\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;

  test('migration 0031 (anon_id_returns) stores anon_id_hash only, never raw anon_id', () => {
    const src = loadMigrationByName('0031_create_anon_id_returns.sql');
    expect(src, '0031 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // Positive: anon_id_hash must be present
    expect(src!).toMatch(/anon_id_hash\s+TEXT\s+NOT\s+NULL/i);
    // Negative: no raw anon_id column
    expect(src!).not.toMatch(RAW_ANON_ID_COLUMN);
  });

  // SQL TYPE-followed regex catches column definitions like `anon_id TEXT NOT NULL`
  // but NOT free-text references to "anon_id" in comments (which is legal — comments
  // explaining the design are not violations).
  const COL_ANON_ID = /\banon_id\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;
  const COL_IP_HASH = /\bip_hash\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;
  const COL_EMAIL = /\bemail\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i;

  test('migration 0032 (corridor_density_baseline) has no per-attendee columns at all', () => {
    const src = loadMigrationByName('0032_create_corridor_density_baseline.sql');
    expect(src, '0032 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // Corridor baseline is purely aggregate — no anon_id, no anon_id_hash,
    // no ip, no email. Just corridor + dow + hour + counts.
    expect(src!).not.toMatch(COL_ANON_ID);
    // Aggregates only — no per-attendee hash columns either
    expect(src!).not.toMatch(/\banon_id_hash\s+(?:TEXT|INTEGER|BLOB|REAL|NUMERIC)\b/i);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0033 (event_series) has no per-attendee columns', () => {
    const src = loadMigrationByName('0033_create_event_series.sql');
    expect(src, '0033 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    // event_series is metadata about a recurring pattern, not attendee data.
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0034 (events.series_id) only adds the series FK column', () => {
    const src = loadMigrationByName('0034_events_add_series_id.sql');
    expect(src, '0034 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/ALTER TABLE events ADD COLUMN series_id/i);
    // Sanity: doesn't sneak in any attendee-identity columns
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
  });

  test('migration 0036 (sponsors.is_local) only adds the locality classification axis', () => {
    // OSE-330 Phase 2 — Local Sponsor Covenant. Adds is_local INTEGER to
    // sponsors (metadata table). Not a pipeline-shape migration but
    // registered in PIPELINE_MIGRATIONS so the drift-guard above stays
    // satisfied; the equivalent of Gate 2 for this migration is:
    //   (a) it ONLY adds is_local (not a per-attendee PII column)
    //   (b) DEFAULT 0 for backward compatibility
    //   (c) NOT NULL for schema-level guard (see tier-equity-sort.spec.ts
    //       schema-rejects-NULL test for the matching assertion)
    const src = loadMigrationByName('0036_add_is_local_to_sponsors.sql');
    expect(src, '0036 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/ALTER TABLE sponsors ADD COLUMN is_local INTEGER NOT NULL DEFAULT 0/i);
    // Sanity: doesn't sneak in any attendee-identity columns
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0037 (h3_res9/h3_res7 on events) only adds geo-enrichment columns', () => {
    // OSE-450 S-6.1.1 — NCR tagging at capture time. Adds h3_res9 and h3_res7
    // TEXT columns to events (nullable, venue-level geo only, never per-attendee).
    const src = loadMigrationByName('0037_add_h3_cells_to_events.sql');
    expect(src, '0037 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/ALTER TABLE events ADD COLUMN h3_res9 TEXT/i);
    expect(src!).toMatch(/ALTER TABLE events ADD COLUMN h3_res7 TEXT/i);
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('migration 0038 (h3_res9/h3_res7 on scan_aggregates) only adds geo-enrichment columns', () => {
    // OSE-450 S-6.1.2 — Denormalizes NCR cells onto scan aggregates. Adds
    // h3_res9 and h3_res7 TEXT columns to scan_aggregates (nullable, geo-only).
    const src = loadMigrationByName('0038_scan_aggregates_add_h3_cells.sql');
    expect(src, '0038 not found in TEST_SOURCE_FILES_JSON').not.toBeNull();
    expect(src!).toMatch(/ALTER TABLE scan_aggregates ADD COLUMN h3_res9 TEXT/i);
    expect(src!).toMatch(/ALTER TABLE scan_aggregates ADD COLUMN h3_res7 TEXT/i);
    expect(src!).not.toMatch(COL_ANON_ID);
    expect(src!).not.toMatch(COL_IP_HASH);
    expect(src!).not.toMatch(COL_EMAIL);
  });

  test('drift-guard: PIPELINE_MIGRATIONS list covers every 003x_*.sql in migrations/', () => {
    // When future pipeline migrations land (0035+), add them to
    // PIPELINE_MIGRATIONS so Gate 2 keeps covering the full set.
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const found = new Set<string>();
    for (const [path] of Object.entries(sources)) {
      const normalized = path.replace(/\\/g, '/');
      const m = normalized.match(/migrations\/(003[1-9]_[\w-]+\.sql)$/);
      if (m) found.add(m[1]);
    }
    // Only check files that exist; PIPELINE_MIGRATIONS may legitimately
    // be a subset until later sessions add migrations.
    const declared = new Set(PIPELINE_MIGRATIONS);
    for (const name of found) {
      expect(
        declared.has(name),
        `Migration ${name} exists but is not registered in PIPELINE_MIGRATIONS — Gate 2 won't cover it`
      ).toBe(true);
    }
  });
});

// ─── Schema verification — tables exist with the expected columns ───────────

describe('OSE-272 Session 2: pipeline tables created with correct shape', () => {
  test('anon_id_returns table exists with anon_id_hash + venue_id PK', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // Apply migrations
    const stmts: string[] = JSON.parse(tenv2.TEST_MIGRATION_STATEMENTS);
    for (const stmt of stmts) {
      try {
        await tenv2.DB.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(anon_id_returns)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('anon_id_hash');
    expect(colNames).toContain('venue_id');
    expect(colNames).toContain('first_seen_at');
    expect(colNames).toContain('last_seen_at');
    expect(colNames).toContain('visit_count');
    expect(colNames).toContain('computed_at');
    // CRITICAL: must NOT contain raw anon_id
    expect(colNames).not.toContain('anon_id');
  });

  test('corridor_density_baseline table exists with expected aggregate columns', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(corridor_density_baseline)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('corridor_id');
    expect(colNames).toContain('bucket_dow');
    expect(colNames).toContain('bucket_hour');
    expect(colNames).toContain('window_30d_count');
    expect(colNames).toContain('window_90d_count');
    // CRITICAL: no attendee-identity columns
    expect(colNames).not.toContain('anon_id');
    expect(colNames).not.toContain('anon_id_hash');
    expect(colNames).not.toContain('ip_hash');
  });

  test('event_series table exists with 3-state lifecycle (Q2 hybrid)', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(event_series)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name).sort();
    expect(colNames).toContain('id');
    expect(colNames).toContain('venue_id');
    expect(colNames).toContain('series_name');
    expect(colNames).toContain('state');
    expect(colNames).toContain('detected_at');
    expect(colNames).toContain('confirmed_at');
    expect(colNames).toContain('rejected_reason');
  });

  test('event_series.state enforces pending|confirmed|rejected via CHECK', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // Q2 hybrid lifecycle — the CHECK constraint must reject any other value
    await expect(
      tenv2.DB.prepare(
        `INSERT INTO event_series (id, venue_id, series_name, state) VALUES (?, ?, ?, ?)`
      )
        .bind('test-bad-state', 'evt-test', 'Bogus', 'archived')
        .run()
    ).rejects.toThrow();
  });

  test('event_series accepts the three valid lifecycle states', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    // First insert a venue event for the FK
    await tenv2.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, ?)`
    )
      .bind('evt-series-venue', 'test-brand', 'Series Venue', 'series-venue', 'active')
      .run();
    for (const state of ['pending', 'confirmed', 'rejected'] as const) {
      await expect(
        tenv2.DB.prepare(
          `INSERT INTO event_series (id, venue_id, series_name, state) VALUES (?, ?, ?, ?)`
        )
          .bind(`series-${state}`, 'evt-series-venue', `Test ${state}`, state)
          .run()
      ).resolves.toBeDefined();
    }
  });

  test('events.series_id column added by migration 0034 (TEXT, nullable, FK)', async () => {
    const tenv2 = env as unknown as TestEnv & { DB: D1Database };
    const cols = await tenv2.DB.prepare(`PRAGMA table_info(events)`).all();
    const colNames = (cols.results as Array<{ name: string }>).map((c) => c.name);
    expect(colNames).toContain('series_id');
  });
});

// ─── Anon-id-hash lib unit tests ────────────────────────────────────────────

describe('OSE-272 hashAnonIdForReturns — anonymity-preserving hash function', () => {
  test('returns null when pepper is undefined (graceful no-signal mode)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    expect(await hashAnonIdForReturns('anon_abc', undefined)).toBeNull();
  });

  test('returns null when pepper is empty string', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    expect(await hashAnonIdForReturns('anon_abc', '')).toBeNull();
  });

  test('returns a 32-char hex string when pepper is set', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const hash = await hashAnonIdForReturns('anon_abc123', 'test-pepper-rotate-me');
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  test('same input + same pepper produces same hash (determinism)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_xyz', 'pepper');
    const b = await hashAnonIdForReturns('anon_xyz', 'pepper');
    expect(a).toBe(b);
  });

  test('same input + different pepper produces different hash (blast-radius isolation)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_xyz', 'pepper-A');
    const b = await hashAnonIdForReturns('anon_xyz', 'pepper-B');
    expect(a).not.toBe(b);
  });

  test('different inputs + same pepper produce different hashes (no collision on canonical IDs)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const a = await hashAnonIdForReturns('anon_aaa', 'pepper');
    const b = await hashAnonIdForReturns('anon_bbb', 'pepper');
    expect(a).not.toBe(b);
  });

  test('hash does NOT contain the raw anon_id substring (one-way property)', async () => {
    const { hashAnonIdForReturns } = await import('../src/lib/anon-id-hash');
    const anonId = 'anon_someuniqueidentifier';
    const hash = await hashAnonIdForReturns(anonId, 'pepper');
    expect(hash).not.toBeNull();
    expect(hash!.toLowerCase()).not.toContain('someuniqueidentifier');
  });
});
