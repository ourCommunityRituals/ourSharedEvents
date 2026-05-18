/**
 * OSE-330 — tierSort() functional invariant tests.
 *
 * Companion to tests/e2e/0-architecture/tier-equity.invariant.spec.ts
 * (Playwright structural). This vitest spec proves the locals-first
 * sort BEHAVIOR holds for synthetic inputs — the Playwright spec proves
 * the CODE SHAPE is in place.
 *
 * Property tested:
 *   For any non-empty mix of SponsorRow inputs, after sort():
 *     - All is_local=1 sponsors appear BEFORE all is_local=0 sponsors
 *     - Within each group, tier priority breaks ties
 *     - No tier value can push a non-local above a local
 *
 * This is the Local Sponsor Covenant — Brain Invariant #5, mechanical
 * enforcement layer.
 *
 * Note: tierSort is module-private in sponsor-resolver.ts. We test it
 * INDIRECTLY by calling resolveSponsorsForEvent() with seeded D1 data
 * AND by asserting the sort order property of the returned list. The
 * functional outcome is what matters; the function name is implementation.
 *
 * Per OCR_STANDARD_perStoryTestPyramid these tests carry no layer
 * qualifier (UNIT — pure-function sort behavior, runs in <100ms).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;
const BRAND = 'ose330-tier-equity';

beforeAll(async () => {
  // Apply main DB migrations (includes 0036_add_is_local_to_sponsors.sql).
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch {
      // Migrations may have idempotency notes; ignore re-apply errors.
    }
  }
});

/**
 * Seed a sponsor with controlled tier + is_local for the test event.
 * Each sponsor opts into ALL placement formats so it qualifies for every
 * surface. event_id is deterministic per-test to avoid cross-test bleed.
 */
async function seedSponsor(opts: {
  eventId: string;
  id: string;
  name: string;
  tier: string;
  is_local: 0 | 1;
}): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, tier, is_local, placement_formats, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET tier=excluded.tier, is_local=excluded.is_local`
    )
    .bind(
      opts.id,
      opts.eventId,
      opts.name,
      opts.tier,
      opts.is_local,
      JSON.stringify({ posterTop: true, tvTop: true, tvSide: true, mobileBanner: true })
    )
    .run();
}

async function seedEvent(eventId: string): Promise<void> {
  // Slug must be UNIQUE per migration 0001 — derive from eventId to keep
  // each test self-contained.
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
       ON CONFLICT(id) DO NOTHING`
    )
    .bind(eventId, BRAND, 'tier-equity test event', eventId)
    .run();
}

async function getResolvedSponsorIds(eventId: string): Promise<string[]> {
  // We call the public events sponsors endpoint and read the returned order.
  // This exercises the full resolver path (resolveSponsorsForEvent → sort →
  // surface filter) without depending on the internal tierSort being
  // exported. Response shape (per handlers/sponsors.ts handleGetSponsorsForEvent):
  //   { ok: true, status: 200, items: SponsorRow[] }
  const res = await SELF.fetch(
    `https://test.local/api/v2/events/${encodeURIComponent(eventId)}/sponsors`
  );
  if (res.status !== 200) {
    // Endpoint may not be public-readable in test env without seed; surface
    // a clear error so the test failure isn't ambiguous.
    throw new Error(`expected 200 from /api/v2/events/${eventId}/sponsors, got ${res.status}`);
  }
  const body = (await res.json()) as { items?: Array<{ id: string }> };
  return (body.items ?? []).map((s) => s.id);
}

describe('OSE-330 — tierSort Local Sponsor Covenant invariant', () => {
  test('OSE-330 | local primary beats non-local platinum (the covenant in one sentence)', async () => {
    const eventId = `ose330-evt-cov-1`;
    await seedEvent(eventId);
    // Adversarial seed: highest non-local tier vs lowest local tier.
    await seedSponsor({
      eventId,
      id: 'ose330-platinum-nonlocal',
      name: 'Platinum NonLocal',
      tier: 'platinum',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-primary-local',
      name: 'Primary Local',
      tier: 'primary',
      is_local: 1,
    });

    const ids = await getResolvedSponsorIds(eventId);
    // Local must appear BEFORE non-local regardless of tier
    const localIdx = ids.indexOf('ose330-primary-local');
    const nonLocalIdx = ids.indexOf('ose330-platinum-nonlocal');
    expect(localIdx, 'primary-local must be present').toBeGreaterThan(-1);
    expect(nonLocalIdx, 'platinum-nonlocal must be present').toBeGreaterThan(-1);
    expect(
      localIdx,
      'COVENANT VIOLATION: primary-tier local must appear before platinum-tier non-local'
    ).toBeLessThan(nonLocalIdx);
  });

  test('OSE-330 | within local group, tier breaks ties (platinum-local > primary-local)', async () => {
    const eventId = `ose330-evt-cov-2`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'ose330-primary-local-2',
      name: 'Primary Local',
      tier: 'primary',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-platinum-local-2',
      name: 'Platinum Local',
      tier: 'platinum',
      is_local: 1,
    });

    const ids = await getResolvedSponsorIds(eventId);
    const platinumIdx = ids.indexOf('ose330-platinum-local-2');
    const primaryIdx = ids.indexOf('ose330-primary-local-2');
    expect(
      platinumIdx,
      'within the local group, platinum tier must beat primary tier'
    ).toBeLessThan(primaryIdx);
  });

  test('OSE-330 | within non-local group, tier breaks ties (platinum-nonlocal > primary-nonlocal)', async () => {
    const eventId = `ose330-evt-cov-3`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'ose330-primary-nonlocal-3',
      name: 'Primary NonLocal',
      tier: 'primary',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-platinum-nonlocal-3',
      name: 'Platinum NonLocal',
      tier: 'platinum',
      is_local: 0,
    });

    const ids = await getResolvedSponsorIds(eventId);
    const platinumIdx = ids.indexOf('ose330-platinum-nonlocal-3');
    const primaryIdx = ids.indexOf('ose330-primary-nonlocal-3');
    expect(platinumIdx).toBeLessThan(primaryIdx);
  });

  test('OSE-330 | mixed 2 locals + 2 non-locals (full 4-sponsor sort order)', async () => {
    const eventId = `ose330-evt-cov-4`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'ose330-mix-platinum-nonlocal',
      name: 'Platinum NonLocal',
      tier: 'platinum',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-mix-gold-local',
      name: 'Gold Local',
      tier: 'gold',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-mix-bronze-nonlocal',
      name: 'Bronze NonLocal',
      tier: 'bronze',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-mix-title-local',
      name: 'Title Local',
      tier: 'title',
      is_local: 1,
    });

    const ids = await getResolvedSponsorIds(eventId);
    const expectedOrder = [
      'ose330-mix-title-local', // local + title (highest tier in local group)
      'ose330-mix-gold-local', // local + gold
      'ose330-mix-platinum-nonlocal', // non-local + platinum (highest tier in non-local group)
      'ose330-mix-bronze-nonlocal', // non-local + bronze
    ];
    for (const id of expectedOrder) {
      expect(ids).toContain(id);
    }
    // Assert the relative ordering matches expectedOrder
    const positions = expectedOrder.map((id) => ids.indexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i - 1],
        `expected ${expectedOrder[i - 1]} (pos ${positions[i - 1]}) to come before ${expectedOrder[i]} (pos ${positions[i]})`
      ).toBeLessThan(positions[i]);
    }
  });

  test('OSE-330 | all-local event (no non-locals) — sort is pure tier order within locals', async () => {
    const eventId = `ose330-evt-cov-5`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'ose330-all-local-bronze',
      name: 'Bronze Local',
      tier: 'bronze',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-all-local-gold',
      name: 'Gold Local',
      tier: 'gold',
      is_local: 1,
    });

    const ids = await getResolvedSponsorIds(eventId);
    const goldIdx = ids.indexOf('ose330-all-local-gold');
    const bronzeIdx = ids.indexOf('ose330-all-local-bronze');
    expect(goldIdx).toBeLessThan(bronzeIdx);
  });

  test('OSE-330 | all-non-local event (backward compat) — sort behavior unchanged', async () => {
    // Critical backward-compat check: existing events with no locals must
    // sort exactly as they did pre-OSE-330. The covenant only KICKS IN
    // when at least one sponsor is is_local=1. Otherwise: pure tier sort.
    const eventId = `ose330-evt-cov-6`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'ose330-all-nonlocal-silver',
      name: 'Silver NonLocal',
      tier: 'silver',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'ose330-all-nonlocal-platinum',
      name: 'Platinum NonLocal',
      tier: 'platinum',
      is_local: 0,
    });

    const ids = await getResolvedSponsorIds(eventId);
    const platinumIdx = ids.indexOf('ose330-all-nonlocal-platinum');
    const silverIdx = ids.indexOf('ose330-all-nonlocal-silver');
    expect(
      platinumIdx,
      'backward compat: non-local sort is unchanged when no locals exist'
    ).toBeLessThan(silverIdx);
  });

  test('OSE-330 | schema rejects NULL is_local — belt-and-suspenders for the covenant', async () => {
    // Migration 0036 declares `is_local INTEGER NOT NULL DEFAULT 0`, which
    // means SQLite physically refuses to land a NULL is_local row. This is
    // the schema-level guard that complements the sort-level guard in
    // tierSort() (which compares `is_local === 1` defensively — non-1
    // values, including NULL/undefined had they ever existed, sort as
    // non-local).
    //
    // We assert the schema constraint here so a future migration that
    // relaxes NOT NULL would fail this test, alerting the author that the
    // resolver's defensive code becomes load-bearing rather than
    // belt-and-suspenders.
    const eventId = `ose330-evt-cov-7`;
    await seedEvent(eventId);
    let rejected = false;
    try {
      await tenv()
        .DB.prepare(
          `INSERT INTO sponsors (id, event_id, name, tier, is_local, placement_formats, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, 1, datetime('now'), datetime('now'))`
        )
        .bind(
          'ose330-null-islocal-attempt',
          eventId,
          'Platinum NULL is_local attempt',
          'platinum',
          JSON.stringify({ posterTop: true, tvTop: true, tvSide: true, mobileBanner: true })
        )
        .run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Expected: SQLITE_CONSTRAINT_NOTNULL on sponsors.is_local
      expect(msg).toMatch(/NOT NULL constraint failed.*sponsors\.is_local/i);
      rejected = true;
    }
    expect(
      rejected,
      'SCHEMA GUARD: migration 0036 must keep is_local NOT NULL — a relaxed constraint would let NULL sneak in and make tierSort defensive coercion load-bearing'
    ).toBe(true);
  });
});
