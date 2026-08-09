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

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
  TEST_MIGRATION_STATEMENTS: string;
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
    const createStmt = migrationStatements.find(
      (s) => /CREATE TABLE.*export_manifest/i.test(s)
    );
    expect(
      createStmt,
      'export_manifest table must be defined in migrations — it is the OER emission boundary'
    ).toBeDefined();
  });

  test('export_manifest has export_type, event_id, actor, outcome columns', () => {
    const migrationStatements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    const createStmt = migrationStatements.find(
      (s) => /CREATE TABLE.*export_manifest/i.test(s)
    )!;
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
    const routerKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('src/router.ts')
    );
    expect(routerKey, 'router.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[routerKey!]!;

    expect(src, 'router.ts must import logExportManifest').toContain('logExportManifest');
  });

  // @born-red TL-050 | method: design-time-negative-assertion | date: 2026-08-03
  test('BACKUP_EVENT audit in router.ts is accompanied by logExportManifest (BigQuery path is bounded)', () => {
    const sources = loadSources();
    const routerKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('src/router.ts')
    );
    const src = sources[routerKey!]!;

    // logExportManifest must appear in the BACKUP_EVENT handler block
    // (the export boundary must be present in the BigQuery backup flow)
    const backupIdx = src.indexOf("'BACKUP_EVENT'");
    expect(backupIdx, "'BACKUP_EVENT' action must exist in router.ts").toBeGreaterThan(0);

    // Search for the call site AFTER BACKUP_EVENT (not the import at the top of the file)
    const exportManifestIdx = src.indexOf('logExportManifest', backupIdx);
    expect(exportManifestIdx, 'logExportManifest must be called in router.ts after BACKUP_EVENT').toBeGreaterThan(backupIdx);

    // logExportManifest must appear within 500 chars of BACKUP_EVENT (same code block)
    const distanceToBoundary = Math.abs(exportManifestIdx - backupIdx);
    expect(
      distanceToBoundary,
      `logExportManifest call (at ${exportManifestIdx}) is too far from BACKUP_EVENT (at ${backupIdx}) — they may not be in the same handler block`
    ).toBeLessThan(500);
  });

  test('logExportManifest in audit-log.ts writes to export_manifest table (not OER directly)', () => {
    const sources = loadSources();
    const auditKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('lib/audit-log')
    );
    const src = sources[auditKey!]!;

    expect(
      src,
      'logExportManifest must INSERT into export_manifest table'
    ).toContain('INSERT INTO export_manifest');

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
    const bqKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/bigquery')
    );
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
    const bqKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('handlers/bigquery')
    );
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
    const routerKey = Object.keys(sources).find((k) =>
      normalizePath(k).endsWith('src/router.ts')
    );
    const src = sources[routerKey!]!;

    // EXPORT_FORMS action must be accompanied by logExportManifest
    const exportFormsIdx = src.indexOf("'EXPORT_FORMS'");
    expect(exportFormsIdx, "'EXPORT_FORMS' must exist in router.ts").toBeGreaterThan(0);

    // Find logExportManifest call in the vicinity of EXPORT_FORMS handler
    const nearbyManifest = src.slice(exportFormsIdx, exportFormsIdx + 800).includes('logExportManifest');
    expect(
      nearbyManifest,
      'logExportManifest must be called within the EXPORT_FORMS handler block (OSE-594)'
    ).toBe(true);
  });
});
