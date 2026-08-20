/**
 * OSE-800 (A3, milestone M0) — the event-type vocabulary must stay reachable.
 *
 * The gap: the sponsor selects a `template_id` (24 templates); the event carries
 * a `uec_code` (47 active registry types); the bridge `template_event_types`
 * covered only 28. The other 19 were DARK — an organizer who correctly tagged
 * "Neighborhood Potluck" got zero sponsor matches, forever, silently. Migration
 * 0063 closes the gap (new `community_gathering` template + the 19 mappings).
 *
 * This is the load-bearing CI test the ticket asks for:
 *
 *   "Every new type becomes a new way to fail it — which is exactly the pressure
 *    we want. A type is not 'added' until it is reachable."
 *
 * Add an `event_type_registry` row (is_active = 1) without a `template_event_types`
 * mapping and this test goes RED. That is the intended forcing function.
 *
 * WHY THIS LIVES IN VITEST, NOT THE PLAYWRIGHT 0-architecture shard: reachability
 * is a property of the SEEDED DATA (registry ⋈ bridge after migrations), not of a
 * source file's shape. The structural `*.invariant.spec.ts` specs read source via
 * node:fs and have no DB; this one applies migrations against miniflare D1 and
 * queries the real seed, the same harness template-clearance-gate.spec.ts uses. It
 * runs in the T0 `tests` shard, so it gates every PR and push.
 *
 * @born-red OSE-800 | method: seeded-registry-vs-bridge reachability | date: 2026-08-20
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

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

// The reachability predicate, verbatim from the ticket: an active registry type
// with no bridge row is unreachable by any sponsor selection.
const UNREACHABLE_SQL = `
  SELECT COUNT(*) AS unreachable
  FROM event_type_registry r
  WHERE r.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM template_event_types t WHERE t.uec_code = r.uec_code
    )`;

// The 19 types that were dark before 0063 — pinned as regression anchors so a
// future migration that drops any mapping fails loudly and by name.
const FORMERLY_DARK = [
  'SOC-DINNER-001',
  'SOC-POTLUCK-001',
  'VOL-CLEANUP-001',
  'VOL-FOODDRIVE-001',
  'VOL-MUTUAL-001',
  'CIV-MEETING-001',
  'CIV-FORUM-001',
  'CIV-CAPTAIN-001',
  'GAR-PLANTING-001',
  'GAR-HARVEST-001',
  'GAR-TRAIL-001',
  'LIT-BOOKCLUB-001',
  'TAB-RPG-001',
  'ENT-FILM-001',
  'PER-COMEDY-001',
  'TAB-BOARDGAME-001',
  'PER-POETRY-001',
  'PER-STORY-001',
  'FIT-RUNNING-001',
];

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-800 — event-type reachability (M0)', () => {
  test('every active registry type is reachable via at least one template (unreachable = 0)', async () => {
    const row = await env.DB.prepare(UNREACHABLE_SQL).first<{ unreachable: number }>();
    // If this fails, a new event type was seeded without a template_event_types
    // mapping. Map it (extend the 0057/0063 suggestion layer) or deactivate it
    // with a reason — do not delete this assertion.
    expect(row?.unreachable, 'active event types with no sponsor-reachable template').toBe(0);
  });

  test('reachable count equals the active-registry count (nothing dark)', async () => {
    const active = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM event_type_registry WHERE is_active = 1'
    ).first<{ c: number }>();
    const reachable = await env.DB.prepare(
      `SELECT COUNT(DISTINCT r.uec_code) AS c
       FROM event_type_registry r
       JOIN template_event_types t ON t.uec_code = r.uec_code
       WHERE r.is_active = 1`
    ).first<{ c: number }>();
    expect(reachable?.c).toBe(active?.c);
  });

  test('each of the 19 formerly-dark types is now reachable', async () => {
    for (const uec of FORMERLY_DARK) {
      const hit = await env.DB.prepare(
        'SELECT COUNT(*) AS c FROM template_event_types WHERE uec_code = ?'
      )
        .bind(uec)
        .first<{ c: number }>();
      expect(hit?.c ?? 0, `${uec} must map to at least one template`).toBeGreaterThan(0);
    }
  });

  test('the mappings introduce no dangling FK (every bridge uec_code exists in the registry)', async () => {
    const dangling = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM template_event_types t
       LEFT JOIN event_type_registry r ON t.uec_code = r.uec_code
       WHERE r.uec_code IS NULL`
    ).first<{ c: number }>();
    expect(dangling?.c).toBe(0);
  });

  test('community_gathering exists, is tier-1, and is selectable (the fix is wired, not inert)', async () => {
    const tmpl = await env.DB.prepare(
      "SELECT max_clearance_tier AS t FROM event_templates WHERE id = 'community_gathering'"
    ).first<{ t: number | null }>();
    // Present (0063 seeded it) and tier 1 (all its Phase-1 mapped types are tier 1),
    // so it clears the launch ceiling and is a real, selectable home — not a
    // NULL/fail-safe stub like `custom`.
    expect(tmpl?.t).toBe(1);
  });
});
