/**
 * Feature Flags — 3-Tier System Tests
 *
 * Exercises the complete feature flag lifecycle:
 *   Scenario 1: Free tier seed — 17 flags seeded, 3 ON / 14 OFF
 *   Scenario 2: Tier upgrade — free → mid → enterprise, flags match presets
 *   Scenario 3: Event-level overrides — enterprise override wins over global
 *   Scenario 4: Lookup hierarchy — event > global > default ON
 *   Scenario 5: Tier detection — detectCurrentTier matches applied tier
 *   Scenario 6: Flag CRUD via admin handlers — list, set, resolve
 *   Scenario 7: Admin auth gates — flag endpoints reject without token
 *   Scenario 8: Input validation — bad flag keys, bad tiers rejected
 *   Scenario 9: Event flag removal — override removed, reverts to global
 *   Scenario 10: Idempotency — apply same tier twice, no errors
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  isFeatureEnabled,
  listFlags,
  setFlag,
  applyTier,
  setEventFlag,
  removeEventFlag,
  resolveFlags,
  detectCurrentTier,
  FLAG_KEYS,
  TIER_PRESETS,
} from '../src/lib/feature-flags';

// ── Test env ─────────────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const MOCK_ADMIN_KEY = 'test-admin-key-e2e-2026';
const tenv = () => env as unknown as TestEnv;
const formsDb = () => tenv().FORMS_DB;
const mainDb = () => tenv().DB;

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${MOCK_ADMIN_KEY}` };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await mainDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }

  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Free Tier Seed
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 1: Free tier seed migration', () => {
  test('19 global flags seeded — forms.register + forms.checkin + report.export-json ON, rest OFF', async () => {
    const flags = await listFlags(formsDb(), { scope: 'global' });

    // 17 business flags from seed migration + 2 operational flags (seeded by OSE-190 migration)
    expect(flags.length).toBe(19);

    const flagMap = Object.fromEntries(flags.map((f) => [f.flag_key, f.enabled]));

    // Free tier: 3 ON
    expect(flagMap['forms.register']).toBe(1);
    expect(flagMap['forms.checkin']).toBe(1);
    expect(flagMap['report.export-json']).toBe(1);

    // Free tier: 14 OFF
    expect(flagMap['forms.survey']).toBe(0);
    expect(flagMap['forms.email-signup']).toBe(0);
    expect(flagMap['config.self-serve']).toBe(0);
    expect(flagMap['config.event-settings']).toBe(0);
    expect(flagMap['analytics.shared-report']).toBe(0);
    expect(flagMap['report.advanced-metrics']).toBe(0);
    expect(flagMap['report.export-pdf']).toBe(0);
    expect(flagMap['report.custom-window']).toBe(0);
    expect(flagMap['report.portfolio']).toBe(0);
    expect(flagMap['assets.file-upload']).toBe(0);
    expect(flagMap['assets.custom-qr']).toBe(0);
    expect(flagMap['branding.white-label']).toBe(0);
    expect(flagMap['branding.custom-domain']).toBe(0);
    expect(flagMap['branding.color-palette']).toBe(0);
  });

  test('isFeatureEnabled reflects free tier — register ON, survey OFF', async () => {
    expect(await isFeatureEnabled(formsDb(), 'forms.register')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.checkin')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'forms.email-signup')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'config.self-serve')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'assets.file-upload')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'branding.white-label')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Tier Upgrade Flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 2: Tier upgrade free → mid → enterprise', () => {
  test('apply mid tier — surveys + email + config ON, assets still OFF', async () => {
    const result = await applyTier(formsDb(), 'mid');
    expect(result.tier).toBe('mid');
    expect(result.applied).toBe(19);

    expect(await isFeatureEnabled(formsDb(), 'forms.register')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.email-signup')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'config.self-serve')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'config.event-settings')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'analytics.shared-report')).toBe(true);

    // Still OFF at mid
    expect(await isFeatureEnabled(formsDb(), 'assets.file-upload')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'assets.custom-qr')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'branding.white-label')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'branding.custom-domain')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'branding.color-palette')).toBe(false);
  });

  test('apply enterprise tier — all 17 business flags ON, operational flags remain OFF', async () => {
    const result = await applyTier(formsDb(), 'enterprise');
    expect(result.tier).toBe('enterprise');

    // Operational flags are explicit-opt-in, not enabled by tier preset
    const OPERATIONAL_FLAGS = new Set([
      FLAG_KEYS.CONFIG_MOCK_MODE,
      FLAG_KEYS.CONFIG_MOCK_SPONSOR_COUNT,
    ]);

    for (const key of Object.values(FLAG_KEYS)) {
      if (OPERATIONAL_FLAGS.has(key)) {
        expect(await isFeatureEnabled(formsDb(), key)).toBe(false);
      } else {
        expect(await isFeatureEnabled(formsDb(), key)).toBe(true);
      }
    }
  });

  test('downgrade back to free — assets + branding OFF again', async () => {
    await applyTier(formsDb(), 'free');

    expect(await isFeatureEnabled(formsDb(), 'forms.register')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'assets.file-upload')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'branding.white-label')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Event-Level Overrides
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 3: Event-level overrides (enterprise)', () => {
  test('global OFF + event ON → event wins', async () => {
    // Ensure survey is globally OFF (free tier)
    await setFlag(formsDb(), 'forms.survey', false, 'global');
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(false);

    // Set event override: ON for evt-enterprise
    await setEventFlag(formsDb(), 'evt-enterprise', 'forms.survey', true);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey', 'evt-enterprise')).toBe(true);

    // Other events still get global (OFF)
    expect(await isFeatureEnabled(formsDb(), 'forms.survey', 'evt-other')).toBe(false);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(false);
  });

  test('global ON + event OFF → event wins', async () => {
    await setFlag(formsDb(), 'forms.register', true, 'global');
    await setEventFlag(formsDb(), 'evt-restricted', 'forms.register', false);

    expect(await isFeatureEnabled(formsDb(), 'forms.register')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'forms.register', 'evt-restricted')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Lookup Hierarchy
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 4: Lookup hierarchy (event > global > default)', () => {
  test('unknown flag key with no rows → default ON', async () => {
    expect(await isFeatureEnabled(formsDb(), 'unknown.future.feature')).toBe(true);
    expect(await isFeatureEnabled(formsDb(), 'unknown.future.feature', 'evt-any')).toBe(true);
  });

  test('event-scoped flag checked before global', async () => {
    // global = ON
    await setFlag(formsDb(), 'branding.white-label', true, 'global');
    // event = OFF (event restriction overrides global)
    await setEventFlag(formsDb(), 'evt-hierarchy', 'branding.white-label', false);

    // Without eventId → global (ON)
    expect(await isFeatureEnabled(formsDb(), 'branding.white-label')).toBe(true);
    // With eventId → event (OFF)
    expect(await isFeatureEnabled(formsDb(), 'branding.white-label', 'evt-hierarchy')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Tier Detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 5: Tier detection', () => {
  test('detectCurrentTier returns correct tier after apply', async () => {
    await applyTier(formsDb(), 'free');
    expect(await detectCurrentTier(formsDb())).toBe('free');

    await applyTier(formsDb(), 'mid');
    expect(await detectCurrentTier(formsDb())).toBe('mid');

    await applyTier(formsDb(), 'enterprise');
    expect(await detectCurrentTier(formsDb())).toBe('enterprise');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Admin CRUD via HTTP (SELF.fetch)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 6: Admin flag CRUD via HTTP', () => {
  test('GET /api/v2/admin/flags → list all flags', async () => {
    await applyTier(formsDb(), 'free');

    const res = await SELF.fetch('https://t.test/api/v2/admin/flags', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect((body.items as unknown[]).length).toBeGreaterThanOrEqual(17);
  });

  test('GET /api/v2/admin/flags/tiers → list tier presets', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/tiers', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);
    const items = body.items as { tier: string }[];
    expect(items.map((i) => i.tier)).toEqual(['free', 'mid', 'enterprise']);
  });

  test('POST /api/v2/admin/flags/apply-tier → apply mid tier', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'mid' }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('mid');
    expect(body.applied).toBe(19);
  });

  test('GET /api/v2/admin/flags/current-tier → detect applied tier', async () => {
    // Apply mid directly to ensure DB state is set
    await applyTier(formsDb(), 'mid');

    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/current-tier', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.tier).toBe('mid');
  });

  test('PUT /api/v2/admin/flags/forms.survey → toggle single flag', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/forms.survey', {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.flagKey).toBe('forms.survey');
    expect(body.enabled).toBe(false);

    // Verify it took effect
    expect(await isFeatureEnabled(formsDb(), 'forms.survey')).toBe(false);
  });

  test('GET /api/v2/admin/flags/resolve → resolved flags for event', async () => {
    await applyTier(formsDb(), 'free');
    await setEventFlag(formsDb(), 'evt-resolve', 'forms.survey', true);

    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/resolve?eventId=evt-resolve', {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    const flags = body.flags as Record<string, boolean>;
    expect(flags['forms.survey']).toBe(true); // event override
    expect(flags['forms.register']).toBe(true); // global ON
    expect(flags['assets.file-upload']).toBe(false); // global OFF
  });

  test('PUT /api/v2/admin/events/:id/flags/:key → set event override', async () => {
    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-http/flags/assets.file-upload',
      {
        method: 'PUT',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.eventId).toBe('evt-http');
    expect(body.scope).toBe('event');

    expect(await isFeatureEnabled(formsDb(), 'assets.file-upload', 'evt-http')).toBe(true);
  });

  test('DELETE /api/v2/admin/events/:id/flags/:key → remove event override', async () => {
    // Set event flag directly to ensure it exists before deleting via HTTP
    await setEventFlag(formsDb(), 'evt-http-del', 'assets.file-upload', true);

    const res = await SELF.fetch(
      'https://t.test/api/v2/admin/events/evt-http-del/flags/assets.file-upload',
      {
        method: 'DELETE',
        headers: adminHeaders(),
      }
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(true);

    // Reverts to global
    await applyTier(formsDb(), 'free');
    expect(await isFeatureEnabled(formsDb(), 'assets.file-upload', 'evt-http-del')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Auth Gates
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 7: Auth enforcement on flag endpoints', () => {
  test('all flag admin endpoints reject without auth', async () => {
    const endpoints = [
      ['GET', '/api/v2/admin/flags'],
      ['GET', '/api/v2/admin/flags/tiers'],
      ['GET', '/api/v2/admin/flags/current-tier'],
      ['GET', '/api/v2/admin/flags/resolve'],
    ];

    for (const [method, path] of endpoints) {
      const res = await SELF.fetch(`https://t.test${path}`, { method });
      expect(res.status).toBe(401);
    }

    const putRes = await SELF.fetch('https://t.test/api/v2/admin/flags/forms.survey', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(putRes.status).toBe(401);

    const tierRes = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'mid' }),
    });
    expect(tierRes.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Input Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 8: Input validation', () => {
  test('PUT unknown flag key → 400 INVALID_FLAG_KEY', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/unknown.flag', {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('INVALID_FLAG_KEY');
  });

  test('PUT flag without enabled field → 400 MISSING_FIELD', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/forms.survey', {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: true }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('MISSING_FIELD');
  });

  test('POST apply-tier with invalid tier → 400 INVALID_TIER', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'platinum' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('INVALID_TIER');
  });

  test('PUT event flag with unknown key → 400', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/evt-x/flags/bad.key', {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(400);
  });

  test('PUT flag with invalid JSON → 400 INVALID_BODY', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/flags/forms.survey', {
      method: 'PUT',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('INVALID_BODY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Event Flag Removal
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 9: Event flag removal reverts to global', () => {
  test('remove override → flag reverts to global value', async () => {
    await applyTier(formsDb(), 'free'); // survey globally OFF

    // Add event override: ON
    await setEventFlag(formsDb(), 'evt-revert', 'forms.survey', true);
    expect(await isFeatureEnabled(formsDb(), 'forms.survey', 'evt-revert')).toBe(true);

    // Remove override
    const removed = await removeEventFlag(formsDb(), 'evt-revert', 'forms.survey');
    expect(removed).toBe(true);

    // Reverts to global (OFF)
    expect(await isFeatureEnabled(formsDb(), 'forms.survey', 'evt-revert')).toBe(false);
  });

  test('remove non-existent override → returns false', async () => {
    const removed = await removeEventFlag(formsDb(), 'evt-nope', 'forms.register');
    expect(removed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: Idempotency
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scenario 10: Idempotency', () => {
  test('apply same tier twice — no errors, same result', async () => {
    const r1 = await applyTier(formsDb(), 'enterprise');
    const r2 = await applyTier(formsDb(), 'enterprise');
    expect(r1.applied).toBe(r2.applied);

    const OPERATIONAL_FLAGS = new Set([
      FLAG_KEYS.CONFIG_MOCK_MODE,
      FLAG_KEYS.CONFIG_MOCK_SPONSOR_COUNT,
    ]);
    for (const key of Object.values(FLAG_KEYS)) {
      if (OPERATIONAL_FLAGS.has(key)) {
        expect(await isFeatureEnabled(formsDb(), key)).toBe(false);
      } else {
        expect(await isFeatureEnabled(formsDb(), key)).toBe(true);
      }
    }
  });

  test('setFlag twice with same value — no errors', async () => {
    await setFlag(formsDb(), 'forms.register', true, 'global');
    await setFlag(formsDb(), 'forms.register', true, 'global');
    expect(await isFeatureEnabled(formsDb(), 'forms.register')).toBe(true);
  });
});
