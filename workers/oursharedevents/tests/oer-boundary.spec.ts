/**
 * OSE-586 — OER emission boundary: close conformance gap on #17 (oer_emission_boundary)
 *
 * Invariant #17 claims OSE only emits data to OER through the defined export
 * boundary (BigQuery export via logExportManifest + export_manifest table).
 * No handler may write directly to OER storage, schema, or API.
 *
 * TL-050: OSE writes directly to OER storage bypassing export_manifest boundary
 *
 * Gates:
 *   G1 — No source file imports from an OER path or calls a direct OER API
 *   G2 — export_manifest table exists in migrations
 *   G3 — Every BIGQUERY export action in router.ts calls logExportManifest
 *   G4 — logExportManifest is imported in router.ts (the export boundary is wired)
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';

// DS-02: mock the Google auth path BEFORE importing the backup handler, so the
// runtime withholding test never signs a real WIF/JWT. The fetch mock below
// still records the dataset each row is routed to.
vi.mock('../src/google/auth', () => ({
  getGoogleAccessToken: vi.fn(async () => ({ token: 'test-access-token' })),
}));

import { BIGQUERY_DATASETS } from '../src/lib/pool-contract';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
  DB?: D1Database;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// OER-specific patterns that must never appear in OSE source (boundary violation indicators)
const OER_FORBIDDEN_PATTERNS = [
  /import.*ourEventRings/i,
  /import.*oer-/i,
  /fetch\(['"`]https?:\/\/[^'"]+oureventrings/i,
  /BIGQUERY_DATASET.*=.*['"`]oer/i,
] as const;

describe('OSE-586 G1 — TL-050: No direct OER imports or API calls in OSE source', () => {
  // @born-red TL-050 | method: design-time-negative-assertion | date: 2026-08-03
  test('no source file imports from an OER repo path', () => {
    const sources = loadSources();
    const violations: string[] = [];

    for (const [path, src] of Object.entries(sources)) {
      const normalized = normalizePath(path);
      if (normalized.includes('node_modules')) continue;
      if (normalized.includes('/tests/')) continue;

      for (const pattern of OER_FORBIDDEN_PATTERNS) {
        if (pattern.test(src)) {
          violations.push(`${normalized}: matches ${pattern}`);
        }
      }
    }

    expect(
      violations,
      `These files violate the OER emission boundary: ${violations.join(' | ')}`
    ).toHaveLength(0);
  });
});

describe('OSE-586 G2 — export_manifest table exists in migrations', () => {
  // @born-red TL-050 | method: design-time-negative-assertion | date: 2026-08-03
  test('export_manifest CREATE TABLE migration exists', () => {
    const migrationStatements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    const createStmt = migrationStatements.find((s) => /CREATE TABLE.*export_manifest/i.test(s));
    expect(
      createStmt,
      'export_manifest table must be defined in migrations — it is the OER emission boundary'
    ).toBeDefined();
  });

  test('export_manifest has export_type, event_id, actor, outcome columns', () => {
    const migrationStatements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    const createStmt = migrationStatements.find((s) => /CREATE TABLE.*export_manifest/i.test(s))!;
    expect(createStmt).toMatch(/export_type/i);
    expect(createStmt).toMatch(/event_id/i);
    expect(createStmt).toMatch(/actor/i);
    expect(createStmt).toMatch(/outcome/i);
  });
});

describe('OSE-586 G3/G4 — logExportManifest is the only OER data path', () => {
  // @born-red TL-050 | method: design-time-negative-assertion | date: 2026-08-03
  test('router.ts imports logExportManifest (export boundary is wired)', () => {
    const sources = loadSources();
    const routerKey = Object.keys(sources).find((k) => normalizePath(k).endsWith('src/router.ts'));
    expect(routerKey, 'router.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[routerKey!]!;

    expect(src, 'router.ts must import logExportManifest').toContain('logExportManifest');
  });

  // @born-red TL-050 | method: design-time-negative-assertion | date: 2026-08-03
  test('BACKUP_EVENT audit in router.ts is accompanied by logExportManifest (BigQuery path is bounded)', () => {
    const sources = loadSources();
    const routerKey = Object.keys(sources).find((k) => normalizePath(k).endsWith('src/router.ts'));
    const src = sources[routerKey!]!;

    // logExportManifest must appear in the BACKUP_EVENT handler block
    // (the export boundary must be present in the BigQuery backup flow)
    const backupIdx = src.indexOf("'BACKUP_EVENT'");
    expect(backupIdx, "'BACKUP_EVENT' action must exist in router.ts").toBeGreaterThan(0);

    // Search for the call site AFTER BACKUP_EVENT (not the import at the top of the file)
    const exportManifestIdx = src.indexOf('logExportManifest', backupIdx);
    expect(
      exportManifestIdx,
      'logExportManifest must be called in router.ts after BACKUP_EVENT'
    ).toBeGreaterThan(backupIdx);

    // logExportManifest must appear within 500 chars of BACKUP_EVENT (same code block)
    const distanceToBoundary = Math.abs(exportManifestIdx - backupIdx);
    expect(
      distanceToBoundary,
      `logExportManifest call (at ${exportManifestIdx}) is too far from BACKUP_EVENT (at ${backupIdx}) — they may not be in the same handler block`
    ).toBeLessThan(500);
  });

  test('logExportManifest in audit-log.ts writes to export_manifest table (not OER directly)', () => {
    const sources = loadSources();
    const auditKey = Object.keys(sources).find((k) => normalizePath(k).includes('lib/audit-log'));
    const src = sources[auditKey!]!;

    expect(src, 'logExportManifest must INSERT into export_manifest table').toContain(
      'INSERT INTO export_manifest'
    );

    // Must not contain any direct OER hostname or storage reference
    expect(src, 'audit-log.ts must not reference OER storage directly').not.toMatch(
      /oureventrings|oer\.storage|oer-api/i
    );
  });

  test('OSE-586 evidence', () => {
    const report = {
      story: 'OSE-586',
      threats_covered: ['TL-050'],
      invariant: 17,
      date: '2026-08-03',
    };
    console.log(`[OSE-586-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.threats_covered).toHaveLength(1);
  });
});

// ── OSE-594: Cron backup path is also bounded by logExportManifest ────────────
// Before OSE-594, logExportManifest was only called in the admin on-demand
// backup route. The scheduled nightly backup (runBigQueryBackup) violated
// invariant #17 on every run with zero manifest records.

describe('OSE-594 — TL-055: scheduled BigQuery cron path bounded by logExportManifest', () => {
  // @born-red TL-055 | method: design-time-negative-assertion | date: 2026-08-03
  test('bigquery.ts imports logExportManifest (cron path is bounded)', () => {
    const sources = loadSources();
    const bqKey = Object.keys(sources).find((k) => normalizePath(k).includes('handlers/bigquery'));
    expect(bqKey, 'handlers/bigquery.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[bqKey!]!;
    expect(
      src,
      'bigquery.ts must import logExportManifest — the cron backup path must be bounded by the OER emission manifest (OSE-594)'
    ).toContain('logExportManifest');
  });

  // @born-red TL-055 | method: design-time-negative-assertion | date: 2026-08-03
  test('runBigQueryBackup in bigquery.ts calls logExportManifest (cron boundary is wired)', () => {
    const sources = loadSources();
    const bqKey = Object.keys(sources).find((k) => normalizePath(k).includes('handlers/bigquery'));
    const src = sources[bqKey!]!;

    // runBigQueryBackup must contain a logExportManifest call in its body
    const runBqIdx = src.indexOf('runBigQueryBackup');
    expect(runBqIdx, 'runBigQueryBackup must exist in bigquery.ts').toBeGreaterThan(0);

    const manifestIdx = src.indexOf('logExportManifest', runBqIdx);
    expect(
      manifestIdx,
      'logExportManifest must be called inside or after runBigQueryBackup (cron export boundary — OSE-594)'
    ).toBeGreaterThan(runBqIdx);
  });

  test('forms CSV export in router.ts also calls logExportManifest', () => {
    const sources = loadSources();
    const routerKey = Object.keys(sources).find((k) => normalizePath(k).endsWith('src/router.ts'));
    const src = sources[routerKey!]!;

    // EXPORT_FORMS action must be accompanied by logExportManifest
    const exportFormsIdx = src.indexOf("'EXPORT_FORMS'");
    expect(exportFormsIdx, "'EXPORT_FORMS' must exist in router.ts").toBeGreaterThan(0);

    // Find logExportManifest call in the vicinity of EXPORT_FORMS handler
    const nearbyManifest = src
      .slice(exportFormsIdx, exportFormsIdx + 800)
      .includes('logExportManifest');
    expect(
      nearbyManifest,
      'logExportManifest must be called within the EXPORT_FORMS handler block (OSE-594)'
    ).toBe(true);
  });
});

// ── DS-02: BigQuery backup routes through the fail-closed regulatory-pool contract ──
//
// The OSE-594 tests above only prove logExportManifest is CALLED inside
// runBigQueryBackup — they never inspect the target DATASET or the row CONTENT.
// That let DS-02 hide in plain sight: runBigQueryBackup did `SELECT *` and streamed
// full raw rows to the flat, non-pool `oursharedevents_backup` dataset via
// backupEvents(), bypassing the fail-closed contract (Invariant #4 / OSE-380 /
// OSE-1220) that the SharedReport export path enforces. A tier-4 (HIPAA) or tier-5
// (COPPA) event — persistable because legal_clearance_tier has no CHECK — leaked
// wholesale.
//
// These gates inspect DATASET + CONTENT: the handler must route through
// phaseToPool/datasetForPool (static), and at runtime a tier-4 row must be
// WITHHELD (not exported) while a permitted row lands in a POOL dataset, never the
// flat default.

describe('DS-02 (static) — backup handler routes through the pool contract', () => {
  test('handlers/bigquery.ts imports the fail-closed pool-contract helpers', () => {
    const sources = loadSources();
    const bqKey = Object.keys(sources).find((k) => normalizePath(k).includes('handlers/bigquery'));
    expect(bqKey, 'handlers/bigquery.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[bqKey!]!;

    // The critical fix: pool routing + fail-closed withholding + tag assertion.
    expect(src, 'must route via phaseToPool').toContain('phaseToPool');
    expect(src, 'must target pool datasets via datasetForPool').toContain('datasetForPool');
    expect(src, 'must fail closed on PoolRoutingError').toContain('PoolRoutingError');
    expect(src, 'must assert required tags before emitting').toContain('assertRequiredTags');
    // Must stream to a SPECIFIC dataset, not the flat default insert path.
    expect(src, 'must use the per-dataset insert path').toContain('bigQueryInsertRowsToDataset');
  });

  test('handlers/bigquery.ts no longer uses SELECT * or the flat backupEvents path', () => {
    const sources = loadSources();
    const bqKey = Object.keys(sources).find((k) => normalizePath(k).includes('handlers/bigquery'));
    const src = sources[bqKey!]!;

    // The raw-row spread to the flat default dataset is the bypass we removed.
    expect(src, 'SELECT * FROM events must be gone (raw-row spread bypass)').not.toMatch(
      /SELECT \*\s+FROM events/i
    );
    // backupEvents() (the flat-dataset helper) must not be CALLED here anymore.
    // backupEventsPooled(...) — the new pool-routed path — is allowed; only a
    // bare backupEvents( call (the flat-dataset bypass) is banned. The negative
    // lookahead lets backupEventsPooled( through.
    expect(src, 'flat backupEvents() call must be gone').not.toMatch(
      /\bbackupEvents(?!Pooled)\s*\(/
    );
  });
});

describe('DS-02 (runtime) — tier-4/5 event is WITHHELD; permitted row lands in a pool dataset', () => {
  const tenvDb = () => env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };

  // BQ env stub — looks "configured" per isBigQueryConfigured(); auth flow is
  // short-circuited by the fetch mock. BIGQUERY_DATASET_ID intentionally set to
  // the FLAT default that the bug leaked to, so if routing regresses the row
  // shows up in 'oursharedevents_backup' and the assertions below go red.
  const BQ_ENV_CONFIGURED = {
    WIF_PRIVATE_KEY_PEM:
      '-----BEGIN PRIVATE KEY-----\nMIIE-test-fake-key-for-tests-only\n-----END PRIVATE KEY-----',
    GCP_PROJECT_NUMBER: '123456789012',
    WIF_POOL_ID: 'test-pool',
    WIF_PROVIDER_ID: 'test-provider',
    GCP_PROJECT_ID: 'ose-test',
    BIGQUERY_DATASET_ID: 'oursharedevents_backup',
  };

  interface InsertAllCall {
    dataset: string;
    tableId: string;
    rows: Array<{ insertId: string; json: Record<string, unknown> }>;
  }
  let bqCalls: InsertAllCall[] = [];

  function installBqMock(): void {
    bqCalls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (
          url.includes('sts.googleapis.com') ||
          url.includes('iamcredentials.googleapis.com') ||
          url.includes('oauth2.googleapis.com')
        ) {
          return new Response(
            JSON.stringify({
              access_token: 'test-access-token',
              token: 'test-token',
              expires_in: 3600,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ) as unknown as Response;
        }
        const m = url.match(/\/projects\/[^/]+\/datasets\/([^/]+)\/tables\/([^/]+)\/insertAll$/);
        if (m) {
          const body = init?.body ? JSON.parse(init.body as string) : { rows: [] };
          bqCalls.push({ dataset: m[1], tableId: m[2], rows: body.rows ?? [] });
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }) as unknown as Response;
        }
        return new Response('', { status: 404 }) as unknown as Response;
      }
    );
  }

  async function applyMigrations(): Promise<void> {
    const stmts: string[] = JSON.parse(tenvDb().TEST_MIGRATION_STATEMENTS);
    for (const stmt of stmts) {
      try {
        await tenvDb().DB.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes('duplicate column name') ||
          msg.includes('already exists') ||
          msg.includes('no such column')
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  async function seedEvent(id: string, phase: number): Promise<void> {
    // Recent updated_at so the 24h window picks it up. event_type_id supplies
    // the uec_code join (required tag); NULL is tolerated (defaults to 'unknown').
    // corridor_id / event_type_id left NULL to avoid FK constraints — the pool
    // contract tolerates them (corridor_id/uec_code default to 'unknown').
    await tenvDb()
      .DB.prepare(
        `INSERT INTO events
           (id, brand_id, title, slug, status, corridor_id, event_type_id,
            legal_clearance_tier, created_at, updated_at)
         VALUES (?, 'ds02-brand', ?, ?, 'active', NULL, NULL, ?,
                 datetime('now'), datetime('now'))`
      )
      .bind(id, `DS02 ${id}`, id, phase)
      .run();
  }

  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    installBqMock();
    await tenvDb().DB.prepare(`DELETE FROM events WHERE id LIKE 'ds02-evt-%'`).run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reinstall the auth mock restoreAllMocks cleared; harmless if unused next test.
  });

  test('a tier-4 (HIPAA / declined) event is WITHHELD — never streamed to any dataset', async () => {
    const { runBigQueryBackup } = await import('../src/handlers/bigquery');
    await seedEvent('ds02-evt-tier1', 1); // permitted → general pool
    await seedEvent('ds02-evt-tier4', 4); // declined → must be withheld

    await runBigQueryBackup({ DB: tenvDb().DB, ...BQ_ENV_CONFIGURED } as never);

    const allExportedIds = bqCalls.flatMap((c) => c.rows.map((r) => String(r.json.id)));

    // The declined-tier row must NOT appear in any insertAll call.
    expect(
      allExportedIds,
      'DS-02 REGRESSION: a tier-4 (HIPAA) event leaked into a BigQuery export — the fail-closed pool contract is bypassed'
    ).not.toContain('ds02-evt-tier4');

    // The permitted row must still be exported.
    expect(allExportedIds, 'the tier-1 event should still be exported').toContain('ds02-evt-tier1');
  });

  test('permitted rows land in the POOL dataset (oureventring_general), never the flat default', async () => {
    const { runBigQueryBackup } = await import('../src/handlers/bigquery');
    await seedEvent('ds02-evt-tier1', 1);

    await runBigQueryBackup({ DB: tenvDb().DB, ...BQ_ENV_CONFIGURED } as never);

    const datasetsUsed = [...new Set(bqCalls.map((c) => c.dataset))];
    expect(datasetsUsed.length, 'at least one insertAll must have run').toBeGreaterThan(0);

    // Every insert must target the pool dataset...
    expect(
      datasetsUsed,
      'DS-02 REGRESSION: backup targeted the flat non-pool dataset instead of the regulatory pool'
    ).toEqual([BIGQUERY_DATASETS.general]);

    // ...and NEVER the flat default the bug leaked to.
    expect(datasetsUsed).not.toContain('oursharedevents_backup');
  });

  test('exported rows carry the required regulatory tags (assertRequiredTags contract)', async () => {
    const { runBigQueryBackup } = await import('../src/handlers/bigquery');
    await seedEvent('ds02-evt-tier1', 1);

    await runBigQueryBackup({ DB: tenvDb().DB, ...BQ_ENV_CONFIGURED } as never);

    const exportedRows = bqCalls.flatMap((c) => c.rows.map((r) => r.json));
    expect(exportedRows.length).toBeGreaterThan(0);
    for (const row of exportedRows) {
      expect(row.regulatory_pool, 'every exported row must be tagged with its pool').toBe(
        'general'
      );
      expect(row.product_id).toBe('ose');
      for (const tag of ['corridor_id', 'venue_id', 'event_type', 'uec_code']) {
        expect(typeof row[tag], `required tag ${tag} must be a non-empty string`).toBe('string');
        expect(String(row[tag]).length).toBeGreaterThan(0);
      }
    }
  });
});
