/**
 * REG-6: Regulatory Phase Schema Tests (OSE-138)
 *
 * Verifies:
 *   1. event_type_registry table — CRUD, UEC code uniqueness
 *   2. corridor_regulatory_status — UNIQUE(corridor_id) enforced
 *   3. events table — legal_clearance_tier + event_type_id columns present
 *   4. Regulatory feature flags — global defaults seeded, corridor override resolves
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

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

  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ─── event_type_registry ──────────────────────────────────────────────────────

describe('REG-6: event_type_registry table', () => {
  test('table exists and is queryable', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBeGreaterThanOrEqual(0);
  });

  test('can insert a Phase 1 event type', async () => {
    await tenv()
      .DB.prepare(
        `
      INSERT INTO event_type_registry (id, uec_code, name, description, phase, legal_clearance_tier)
      VALUES ('etr-bocce-1', 'REC-BOCCE-001', 'Bocce Tournament', 'Recreational bocce league play', 1, 1)
    `
      )
      .run();

    const row = await tenv()
      .DB.prepare("SELECT * FROM event_type_registry WHERE id='etr-bocce-1'")
      .first<{
        uec_code: string;
        phase: number;
        legal_clearance_tier: number;
        is_active: number;
      }>();

    expect(row?.uec_code).toBe('REC-BOCCE-001');
    expect(row?.phase).toBe(1);
    expect(row?.legal_clearance_tier).toBe(1);
    expect(row?.is_active).toBe(1);
  });

  test('UEC code uniqueness enforced', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `
        INSERT INTO event_type_registry (id, uec_code, name, phase)
        VALUES ('etr-bocce-dupe', 'REC-BOCCE-001', 'Bocce Duplicate', 1)
      `
        )
        .run()
    ).rejects.toThrow();
  });

  test('phase CHECK constraint rejects phase=0', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `
        INSERT INTO event_type_registry (id, uec_code, name, phase)
        VALUES ('etr-invalid', 'INVALID-000', 'Bad Phase', 0)
      `
        )
        .run()
    ).rejects.toThrow();
  });

  test('phase CHECK constraint rejects phase=6', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `
        INSERT INTO event_type_registry (id, uec_code, name, phase)
        VALUES ('etr-invalid-6', 'INVALID-006', 'Phase 6 Does Not Exist', 6)
      `
        )
        .run()
    ).rejects.toThrow();
  });

  test('all 10 columns present', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(event_type_registry)').all();
    expect(info.results.length).toBe(10);
    const colNames = info.results.map((r: Record<string, unknown>) => r.name);
    for (const col of [
      'id',
      'uec_code',
      'name',
      'description',
      'phase',
      'legal_clearance_tier',
      'regulatory_notes',
      'is_active',
      'created_at',
      'updated_at',
    ]) {
      expect(colNames).toContain(col);
    }
  });
});

// ─── corridor_regulatory_status ───────────────────────────────────────────────

describe('REG-6: corridor_regulatory_status table', () => {
  const corridorId = 'corr-test-reg-001';
  const nodeIdA = 'node-test-a';
  const nodeIdB = 'node-test-b';

  beforeAll(async () => {
    await tenv()
      .DB.prepare(
        `
      INSERT INTO node_hierarchy (id, brand_id, name, level, level_label)
      VALUES ('${nodeIdA}', 'brand-reg-test', 'Origin Node', 5, 'Region'),
             ('${nodeIdB}', 'brand-reg-test', 'Dest Node',   5, 'Region')
    `
      )
      .run();
    await tenv()
      .DB.prepare(
        `
      INSERT INTO corridors (id, brand_id, name, origin_node_id, destination_node_id, corridor_signal_class, corridor_status)
      VALUES ('${corridorId}', 'brand-reg-test', 'I-94 Chicago-Detroit', '${nodeIdA}', '${nodeIdB}', 'CLASS_A', 'HYPOTHESIZED')
    `
      )
      .run();
  });

  test('table exists and is queryable', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM corridor_regulatory_status')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBeGreaterThanOrEqual(0);
  });

  test('can insert a corridor at Phase 1', async () => {
    await tenv()
      .DB.prepare(
        `
      INSERT INTO corridor_regulatory_status (id, corridor_id, phase_unlocked)
      VALUES ('crs-001', '${corridorId}', 1)
    `
      )
      .run();

    const row = await tenv()
      .DB.prepare('SELECT phase_unlocked FROM corridor_regulatory_status WHERE corridor_id=?')
      .bind(corridorId)
      .first<{ phase_unlocked: number }>();

    expect(row?.phase_unlocked).toBe(1);
  });

  test('UNIQUE(corridor_id) prevents duplicate rows', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `
        INSERT INTO corridor_regulatory_status (id, corridor_id, phase_unlocked)
        VALUES ('crs-dupe', '${corridorId}', 2)
      `
        )
        .run()
    ).rejects.toThrow();
  });

  test('phase_unlocked CHECK constraint rejects phase=6', async () => {
    await expect(
      tenv()
        .DB.prepare(
          `
        INSERT INTO corridor_regulatory_status (id, corridor_id, phase_unlocked)
        VALUES ('crs-bad', 'nonexistent-corr', 6)
      `
        )
        .run()
    ).rejects.toThrow();
  });

  test('all 5 columns present', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(corridor_regulatory_status)').all();
    expect(info.results.length).toBe(5);
    const colNames = info.results.map((r: Record<string, unknown>) => r.name);
    for (const col of ['id', 'corridor_id', 'phase_unlocked', 'unlocked_at', 'notes']) {
      expect(colNames).toContain(col);
    }
  });
});

// ─── events table regulatory columns ─────────────────────────────────────────

describe('REG-6: events table regulatory columns', () => {
  test('events has legal_clearance_tier column', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(events)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toContain('legal_clearance_tier');
  });

  test('events has event_type_id column', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(events)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toContain('event_type_id');
  });

  test('legal_clearance_tier defaults to 1', async () => {
    await tenv()
      .DB.prepare(
        `
      INSERT INTO events (id, brand_id, title, slug, status)
      VALUES ('evt-reg-test-001', 'brand-reg-test', 'Reg Test Event', 'reg-test-001', 'draft')
    `
      )
      .run();

    const row = await tenv()
      .DB.prepare(
        "SELECT legal_clearance_tier, event_type_id FROM events WHERE id='evt-reg-test-001'"
      )
      .first<{ legal_clearance_tier: number | null; event_type_id: string | null }>();

    expect(row?.legal_clearance_tier).toBe(1);
    expect(row?.event_type_id).toBeNull();
  });
});

// ─── Regulatory feature flags ─────────────────────────────────────────────────

describe('REG-6: regulatory feature flags global defaults seeded', () => {
  test('regulatory.phase1.enabled is ON globally', async () => {
    const row = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase1.enabled'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(1);
  });

  test('regulatory.phase2.commerce is OFF globally', async () => {
    const row = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase2.commerce'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  test('regulatory.phase3.licensed is OFF globally', async () => {
    const row = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase3.licensed'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  test('regulatory.phase4.hipaa is OFF globally', async () => {
    const row = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase4.hipaa'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });

  test('regulatory.phase5.coppa is OFF globally', async () => {
    const row = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase5.coppa'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(0);
  });
});

describe('REG-6: corridor-scoped regulatory flag override', () => {
  const testCorridorId = 'corr-phase2-unlocked';

  test('corridor can override global phase2 to ON', async () => {
    await tenv()
      .FORMS_DB.prepare(
        `
      INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
      VALUES ('corridor-phase2-test', 'corridor', ?, 'regulatory.phase2.commerce', 1, datetime('now'))
      ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled=excluded.enabled
    `
      )
      .bind(testCorridorId)
      .run();

    const corridorFlag = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='corridor' AND scope_id=? AND flag_key='regulatory.phase2.commerce'"
      )
      .bind(testCorridorId)
      .first<{ enabled: number }>();

    const globalFlag = await tenv()
      .FORMS_DB.prepare(
        "SELECT enabled FROM feature_flags WHERE scope='global' AND flag_key='regulatory.phase2.commerce'"
      )
      .first<{ enabled: number }>();

    expect(corridorFlag?.enabled).toBe(1);
    expect(globalFlag?.enabled).toBe(0);
  });

  test('UNIQUE(scope, scope_id, flag_key) prevents duplicate corridor flag rows', async () => {
    await expect(
      tenv()
        .FORMS_DB.prepare(
          `
        INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
        VALUES ('corridor-phase2-dupe', 'corridor', ?, 'regulatory.phase2.commerce', 0, datetime('now'))
      `
        )
        .bind(testCorridorId)
        .run()
    ).rejects.toThrow();
  });
});
