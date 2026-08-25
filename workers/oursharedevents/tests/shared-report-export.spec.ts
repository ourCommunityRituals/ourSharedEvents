/**
 * SR-13: Export JSON button — unit + integration tests
 *
 * Pyramid coverage:
 *   L1 Static  — SHARED_REPORT_HTML contains data-testid="export-json-btn"
 *   L2 Flag    — report.export-json is ON for all three tier presets
 *   L3 Integration — /sharedReport (when enabled) serves the export button
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { handleSharedReportPage } from '../src/handlers/pages';
import { TIER_PRESETS } from '../src/lib/feature-flags';

// ─── L1 Static: HTML template structure ────────────────────────────────────

describe('SR-13 L1 Static: export-json-btn in SharedReport template', () => {
  async function getHtml(): Promise<string> {
    return handleSharedReportPage({} as never).then((r) => r.text());
  }

  test('returns text/html response', async () => {
    const res = await handleSharedReportPage({} as never);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  test('export-json-btn has correct data-testid', async () => {
    const body = await getHtml();
    expect(body).toContain('data-testid="export-json-btn"');
  });

  test('report-action-bar wrapper present', async () => {
    const body = await getHtml();
    expect(body).toContain('data-testid="report-action-bar"');
  });

  test('button starts disabled', async () => {
    const body = await getHtml();
    expect(body).toMatch(/id="export-json-btn"[^>]*disabled/);
  });

  test('export handler builds report-{id}.json filename', async () => {
    const body = await getHtml();
    expect(body).toContain("'report-' + eventId + '.json'");
  });

  test('__reportBundle shared object initialized before scripts', async () => {
    const body = await getHtml();
    expect(body).toContain('window.__reportBundle');
  });

  test('events script stores data into __reportBundle', async () => {
    const body = await getHtml();
    expect(body).toContain('window.__reportBundle.events = items');
  });

  test('export button enabled after events load', async () => {
    const body = await getHtml();
    expect(body).toContain("document.getElementById('export-json-btn').disabled = false");
  });
});

// ─── L2 Flag: report.export-json ON for all tiers ──────────────────────────

describe('SR-13 L2 Flag: report.export-json enabled across all tiers', () => {
  for (const tier of ['free', 'mid', 'enterprise'] as const) {
    test(`${tier} tier has report.export-json = true`, () => {
      const flags = TIER_PRESETS[tier].flags;
      expect(flags['report.export-json']).toBe(true);
    });
  }
});

// ─── L3 Integration: /sharedReport route serves export button ──────────────

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

describe('SR-13 L3 Integration: /sharedReport serves export-json-btn when flag enabled', () => {
  beforeAll(async () => {
    const tenv = env as unknown as TestEnv;
    const stmts = JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[];
    for (const stmt of stmts) {
      try {
        await tenv.FORMS_DB.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('duplicate column name') && !msg.includes('already exists')) throw e;
      }
    }
    await tenv.FORMS_DB.prepare(
      `INSERT OR REPLACE INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
       VALUES ('sr13-test-gate', 'global', '', 'analytics.shared-report', 1, datetime('now'))`
    ).run();
  });

  afterAll(async () => {
    const tenv = env as unknown as TestEnv;
    await tenv.FORMS_DB.prepare(`DELETE FROM feature_flags WHERE id = 'sr13-test-gate'`).run();
  });

  test('GET /sharedReport returns 200 when flag enabled', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    expect(res.status).toBe(200);
  });

  test('response HTML contains data-testid="export-json-btn"', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('data-testid="export-json-btn"');
  });

  test('response HTML contains data-testid="report-action-bar"', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('data-testid="report-action-bar"');
  });

  test('response HTML contains __reportBundle initialization', async () => {
    const res = await SELF.fetch('https://t.test/sharedReport');
    const body = await res.text();
    expect(body).toContain('window.__reportBundle');
  });
});
