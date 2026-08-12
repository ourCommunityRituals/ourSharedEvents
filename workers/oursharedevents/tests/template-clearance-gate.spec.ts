/**
 * OSE-728 — migration 0057: seed template_event_types + recompute
 * max_clearance_tier + clearance-tier allowlist gate.
 *
 * Proves:
 *   1. Every uec_code seeded exists in event_type_registry (no dangling FK).
 *   2. The join is non-empty and mapped templates got a computed tier.
 *   3. Stored max_clearance_tier == live MAX(mapped tier) per template
 *      (the "generated never hand-written" recompute invariant).
 *   4. GATE PROVEN LIVE (not inert on uniform tier-1 data): a tier-2 fixture
 *      registry row mapped to a fixture template makes that template's
 *      max_clearance_tier == 2 and EXCLUDES it under the launch ceiling — so the
 *      allowlist demonstrably filters, even though production data is all tier 1.
 *   5. The ceiling is CONFIG, not a hardcoded literal: raising allowedMaxTier to
 *      2 makes the tier-2 template selectable; env override is honoured.
 *   6. NULL (unmapped) templates are never selectable (fail-safe).
 *
 * @born-red invariant#4 | method: tier-2-fixture-proves-gate-wired | date: 2026-08-12
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  isTemplateSelectable,
  resolveAllowedMaxTier,
  LAUNCH_MAX_CLEARANCE_TIER,
  SELECTABLE_TEMPLATE_SQL_PREDICATE,
} from '../src/lib/template-clearance';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

const RECOMPUTE_ONE = `UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
) WHERE id = ?`;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-728 — 0057 seed + recompute', () => {
  test('join is non-empty and every seeded uec_code exists in the registry', async () => {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM template_event_types').first<{
      c: number;
    }>();
    expect(cnt?.c ?? 0).toBeGreaterThan(0);

    const dangling = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM template_event_types t
       LEFT JOIN event_type_registry r ON t.uec_code = r.uec_code
       WHERE r.uec_code IS NULL`
    ).first<{ c: number }>();
    expect(dangling?.c).toBe(0);
  });

  test('mapped templates got a computed tier; a known mapping is present', async () => {
    const recLeague = await env.DB.prepare(
      "SELECT max_clearance_tier AS t FROM event_templates WHERE id = 'rec_league'"
    ).first<{ t: number | null }>();
    // rec_league maps to REC-* (all tier 1) → tier 1.
    expect(recLeague?.t).toBe(1);
  });

  test('stored max_clearance_tier == live MAX(mapped tier) for every template (recompute invariant)', async () => {
    const rows = await env.DB.prepare(
      `SELECT e.id AS id, e.max_clearance_tier AS stored,
              (SELECT MAX(r.legal_clearance_tier)
                 FROM template_event_types t
                 JOIN event_type_registry r ON t.uec_code = r.uec_code
                WHERE t.template_id = e.id) AS live
         FROM event_templates e`
    ).all<{ id: string; stored: number | null; live: number | null }>();

    expect((rows.results ?? []).length).toBeGreaterThan(0);
    for (const r of rows.results ?? []) {
      expect(r.stored, `template ${r.id}: stored tier must equal live recompute`).toBe(r.live);
    }
  });

  test('unmapped templates are NULL and NOT selectable (fail-safe)', async () => {
    // 'custom' is intentionally unmapped by 0057.
    const custom = await env.DB.prepare(
      "SELECT max_clearance_tier AS t FROM event_templates WHERE id = 'custom'"
    ).first<{ t: number | null }>();
    expect(custom?.t).toBeNull();
    expect(isTemplateSelectable({ max_clearance_tier: custom?.t ?? null })).toBe(false);
  });

  test('GATE PROVEN LIVE: a tier-2 template is EXCLUDED under the launch ceiling', async () => {
    // Fixture registry row at tier 2 + a fixture template mapped to it.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO event_type_registry
         (id, uec_code, name, phase, legal_clearance_tier, is_active)
       VALUES ('etr-fixture-t2', 'TEST-TIER2-999', 'Fixture Tier 2', 2, 2, 1)`
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO event_templates (id, name, description, category)
       VALUES ('fixture_tier2', 'Fixture Tier 2 Template', 'test fixture', 'general')`
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO template_event_types (template_id, uec_code) VALUES ('fixture_tier2', 'TEST-TIER2-999')"
    ).run();

    // Recompute just the fixture using the SAME named statement 0057 uses.
    await env.DB.prepare(RECOMPUTE_ONE).bind('fixture_tier2').run();

    const fixture = await env.DB.prepare(
      "SELECT max_clearance_tier AS t FROM event_templates WHERE id = 'fixture_tier2'"
    ).first<{ t: number | null }>();
    expect(fixture?.t, 'recompute must derive tier 2 from the fixture registry row').toBe(2);

    // The gate EXCLUDES it under the launch ceiling (proves not inert).
    expect(isTemplateSelectable({ max_clearance_tier: fixture?.t ?? null })).toBe(false);
    expect(LAUNCH_MAX_CLEARANCE_TIER).toBe(1);

    // DB-layer predicate agrees: the fixture is absent from the selectable set.
    const selectable = await env.DB.prepare(
      `SELECT id FROM event_templates WHERE ${SELECTABLE_TEMPLATE_SQL_PREDICATE}`
    )
      .bind(resolveAllowedMaxTier())
      .all<{ id: string }>();
    const ids = (selectable.results ?? []).map((r) => r.id);
    expect(ids).not.toContain('fixture_tier2');
    // Positive control: a real tier-1 mapped template IS selectable.
    expect(ids).toContain('rec_league');
  });

  test('ceiling is CONFIG not a literal: raising it to 2 makes the tier-2 template selectable', () => {
    // Same predicate, different ceiling → different answer. If the gate inlined
    // a `<= 1` literal this could not change.
    expect(isTemplateSelectable({ max_clearance_tier: 2 }, 1)).toBe(false);
    expect(isTemplateSelectable({ max_clearance_tier: 2 }, 2)).toBe(true);

    // Env override is honoured by resolveAllowedMaxTier.
    expect(resolveAllowedMaxTier({ ALLOWED_MAX_TIER: '2' })).toBe(2);
    expect(resolveAllowedMaxTier({})).toBe(LAUNCH_MAX_CLEARANCE_TIER);
    expect(resolveAllowedMaxTier({ ALLOWED_MAX_TIER: 'garbage' })).toBe(LAUNCH_MAX_CLEARANCE_TIER);
  });

  test('#3 hygiene: 0057 derives tier via MAX(), never a hardcoded tier assignment', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const entry = Object.entries(sources).find(([p]) =>
      /0057_seed_template_event_types\.sql$/.test(p.replace(/\\/g, '/'))
    );
    expect(entry).toBeTruthy();
    const body = entry![1]
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    // The recompute must use MAX(...legal_clearance_tier...).
    expect(body).toMatch(/MAX\(\s*r\.legal_clearance_tier\s*\)/i);
    // No hand-typed tier assignment like `max_clearance_tier = 1`.
    expect(body).not.toMatch(/max_clearance_tier\s*=\s*\d/i);
  });
});
