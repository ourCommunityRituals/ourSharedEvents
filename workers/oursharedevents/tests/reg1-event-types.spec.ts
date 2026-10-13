/**
 * REG-1: Phase 1 Event Type Registry Tests (OSE-133)
 *
 * Verifies:
 *   1. Exactly 47 Phase 1 event types seeded in event_type_registry
 *   2. All seeded types have phase=1 and legal_clearance_tier=1
 *   3. All 15 UEC cluster prefixes represented
 *   4. UEC codes are globally unique (schema enforces; test spot-checks)
 *   5. regulatory_notes = "LLC + ToS only" for all Phase 1 types
 *   6. No type requires PCI, age verification, or state licensing
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ─── REG-1: Core count and phase assertions ───────────────────────────────────

describe('REG-1: Phase 1 event type seed', () => {
  test('exactly 48 event types seeded (47 from 0024 + Watch Party from 0097)', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(48);
  });

  test('all seeded types have phase=1', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry WHERE phase != 1')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('all seeded types have legal_clearance_tier=1', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry WHERE legal_clearance_tier != 1')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('all seeded types are active', async () => {
    const result = await tenv()
      .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry WHERE is_active != 1')
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('all seeded types have regulatory_notes = "LLC + ToS only"', async () => {
    const result = await tenv()
      .DB.prepare(
        "SELECT COUNT(*) as cnt FROM event_type_registry WHERE regulatory_notes != 'LLC + ToS only'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });
});

// ─── REG-1: Cluster coverage — all 15 UEC prefixes present ───────────────────

describe('REG-1: All 15 UEC cluster prefixes represented', () => {
  const clusters: Array<{ prefix: string; min: number; label: string }> = [
    { prefix: 'REC-', min: 6, label: 'Recreational Sports' },
    { prefix: 'SOC-', min: 4, label: 'Social/Community Dining' },
    { prefix: 'MKT-', min: 3, label: 'Neighborhood Markets' },
    { prefix: 'ART-', min: 5, label: 'Arts/Culture/Music' },
    { prefix: 'VOL-', min: 3, label: 'Volunteer/Mutual Aid' },
    { prefix: 'CIV-', min: 3, label: 'Civic/Neighborhood' },
    { prefix: 'BIZ-', min: 3, label: 'Business Networking' },
    { prefix: 'FND-', min: 3, label: 'Non-Gambling Fundraisers' },
    { prefix: 'ENT-', min: 4, label: 'Entertainment' },
    { prefix: 'GAR-', min: 3, label: 'Gardening/Outdoor' },
    { prefix: 'FAI-', min: 2, label: 'Faith Community' },
    { prefix: 'PER-', min: 4, label: 'Performing Arts' },
    { prefix: 'TAB-', min: 2, label: 'Tabletop/Board Games' },
    { prefix: 'FIT-', min: 1, label: 'Fitness/Running' },
    { prefix: 'LIT-', min: 1, label: 'Literary/Book Club' },
  ];

  for (const { prefix, min, label } of clusters) {
    test(`${label} (${prefix}) has at least ${min} types`, async () => {
      const result = await tenv()
        .DB.prepare('SELECT COUNT(*) as cnt FROM event_type_registry WHERE uec_code LIKE ?')
        .bind(`${prefix}%`)
        .first<{ cnt: number }>();
      expect(result?.cnt).toBeGreaterThanOrEqual(min);
    });
  }
});

// ─── REG-1: Spot-check specific UEC codes ────────────────────────────────────

describe('REG-1: Spot-check key Phase 1 UEC codes', () => {
  const spotChecks = [
    'REC-BOCCE-001',
    'SOC-BLOCK-001',
    'SOC-WATCHPARTY-001',
    'MKT-CRAFT-001',
    'ART-MUSIC-001',
    'VOL-CLEANUP-001',
    'CIV-MEETING-001',
    'BIZ-NETWORK-001',
    'FND-WALKATHON-001',
    'ENT-TRIVIA-001',
    'GAR-PLANTING-001',
    'FAI-INTERFAITH-001',
    'PER-OPENMIC-001',
    'TAB-BOARDGAME-001',
    'FIT-RUNNING-001',
    'LIT-BOOKCLUB-001',
  ];

  for (const uec of spotChecks) {
    test(`${uec} exists with phase=1`, async () => {
      const row = await tenv()
        .DB.prepare('SELECT phase, legal_clearance_tier FROM event_type_registry WHERE uec_code=?')
        .bind(uec)
        .first<{ phase: number; legal_clearance_tier: number }>();
      expect(row?.phase).toBe(1);
      expect(row?.legal_clearance_tier).toBe(1);
    });
  }
});

// ─── REG-1: No prohibited regulatory requirements ─────────────────────────────

describe('REG-1: Phase 1 types have no high-tier regulatory triggers', () => {
  test('no types reference PCI in regulatory_notes', async () => {
    const result = await tenv()
      .DB.prepare(
        "SELECT COUNT(*) as cnt FROM event_type_registry WHERE regulatory_notes LIKE '%PCI%'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('no types reference HIPAA in regulatory_notes', async () => {
    const result = await tenv()
      .DB.prepare(
        "SELECT COUNT(*) as cnt FROM event_type_registry WHERE regulatory_notes LIKE '%HIPAA%'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('no types reference COPPA in regulatory_notes', async () => {
    const result = await tenv()
      .DB.prepare(
        "SELECT COUNT(*) as cnt FROM event_type_registry WHERE regulatory_notes LIKE '%COPPA%'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });

  test('no types reference age verification in regulatory_notes', async () => {
    const result = await tenv()
      .DB.prepare(
        "SELECT COUNT(*) as cnt FROM event_type_registry WHERE regulatory_notes LIKE '%age verif%'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });
});
