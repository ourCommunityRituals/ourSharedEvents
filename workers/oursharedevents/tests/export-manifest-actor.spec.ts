/**
 * OSE-1259 (slice of OSE-556) — attribute the on-demand BigQuery export actor.
 *
 * The OER export manifest (export_manifest) is the audit record for every
 * D1 -> OER boundary crossing (invariant #17 emission boundary, #24
 * auditability). handleAdminBackupEvent (src/handlers/bigquery.ts) previously
 * wrote `actor: null` for admin-triggered exports, so a human-triggered export
 * was indistinguishable from an unattributed one. The cron path already records
 * `actor: 'cron:scheduler'`. This spec proves:
 *
 *   (1) INTEGRITY (D1 round-trip) — logExportManifest writes a row that reads
 *       back with the actor and every field intact (parses the emitted row,
 *       not a source-shape proximity heuristic), and faithfully distinguishes a
 *       null actor from a provided one.
 *
 *   (2) ATTRIBUTION (born-red, static source) — the on-demand handler threads
 *       extractAdminActor(request, env) and no longer passes `actor: null`.
 *       Reverting the fix (restoring `actor: null`) turns test (2) red.
 *
 * Harness: workers pool (cloudflare:test). Migrations applied in beforeAll
 * (mirrors admin-export.spec.ts) so export_manifest exists on env.DB.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { logExportManifest } from '../src/lib/audit-log';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// (1) INTEGRITY — parse the emitted manifest row (SDET: not presence-only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1259 (1): export_manifest round-trip integrity', () => {
  test('a written manifest row reads back with the actor and every field intact', async () => {
    const requestId = 'req-ose1259-integrity';
    await logExportManifest(tenv() as never, {
      export_type: 'BIGQUERY',
      event_id: 'evt_ose1259',
      actor: 'ops@oursharedevents.com',
      request_id: requestId,
      rows_exported: 3,
      outcome: 'success',
    });

    const row = await tenv()
      .DB.prepare('SELECT * FROM export_manifest WHERE request_id = ?')
      .bind(requestId)
      .first<Record<string, unknown>>();

    expect(row, 'manifest row must have been written and be readable').toBeTruthy();
    expect(row!.actor).toBe('ops@oursharedevents.com');
    expect(row!.export_type).toBe('BIGQUERY');
    expect(row!.event_id).toBe('evt_ose1259');
    expect(row!.rows_exported).toBe(3);
    expect(row!.outcome).toBe('success');
  });

  test('a null actor and a provided actor are faithfully distinguished on read', async () => {
    await logExportManifest(tenv() as never, {
      export_type: 'BIGQUERY',
      event_id: 'evt_ose1259_null',
      actor: null,
      request_id: 'req-ose1259-null',
      rows_exported: 1,
      outcome: 'success',
    });
    await logExportManifest(tenv() as never, {
      export_type: 'BIGQUERY',
      event_id: 'evt_ose1259_named',
      actor: 'admin@example.com',
      request_id: 'req-ose1259-named',
      rows_exported: 1,
      outcome: 'success',
    });

    const nullRow = await tenv()
      .DB.prepare('SELECT actor FROM export_manifest WHERE request_id = ?')
      .bind('req-ose1259-null')
      .first<{ actor: string | null }>();
    const namedRow = await tenv()
      .DB.prepare('SELECT actor FROM export_manifest WHERE request_id = ?')
      .bind('req-ose1259-named')
      .first<{ actor: string | null }>();

    expect(nullRow!.actor).toBeNull();
    expect(namedRow!.actor).toBe('admin@example.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// (2) ATTRIBUTION — born-red on the on-demand handler fix
// ═══════════════════════════════════════════════════════════════════════════════

describe('OSE-1259 (2): on-demand export is attributed, not null', () => {
  function bigquerySource(): string {
    const sources = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const entry = Object.entries(sources).find(([p]) =>
      normalizePath(p).endsWith('src/handlers/bigquery.ts')
    );
    expect(entry, 'src/handlers/bigquery.ts must be present in the source map').toBeTruthy();
    return entry![1];
  }

  test('bigquery.ts imports extractAdminActor (the operator-identity seam)', () => {
    expect(bigquerySource()).toMatch(
      /import\s*\{[^}]*extractAdminActor[^}]*\}\s*from\s*['"]\.\.\/auth\/admin['"]/
    );
  });

  test('the on-demand manifest write threads extractAdminActor(request, env)', () => {
    // @born-red OSE-1259 | method: revert-to-actor-null | date: 2026-09-08
    expect(bigquerySource()).toMatch(/actor:\s*extractAdminActor\(request,\s*env\)/);
  });

  test('no export path in bigquery.ts writes actor: null (the pre-fix regression)', () => {
    // @born-red OSE-1259 | method: revert-to-actor-null | date: 2026-09-08
    // The cron path uses 'cron:scheduler'; the on-demand path now uses
    // extractAdminActor — so a literal `actor: null` anywhere is the regression.
    expect(bigquerySource()).not.toMatch(/actor:\s*null/);
  });
});
