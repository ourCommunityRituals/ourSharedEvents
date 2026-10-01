/**
 * Sponsor Share Covenant — functional/integration tests (Invariant #25).
 *
 * Companion to tests/e2e/0-architecture/tier-equity.invariant.spec.ts
 * (Playwright structural). This vitest spec exercises the OBSERVABLE covenant
 * guarantees through the public /api/v2/events/:id/sponsors endpoint
 * (resolveSponsorsForEvent → buildShareRotation), seeding D1 per-test.
 *
 * MODEL NOTE (OSE-661 / OSE-663, ratified 2026-08-08): the old OSE-330
 * locals-first *rank* (`tierSort`, Brain Invariant #5) is RETIRED. The local
 * guarantee is now a rotation-frequency FLOOR (Brain Invariant #25): the
 * is_local class collectively holds >= local_floor_pct of rotation share via
 * allocateShares() — a local is never zeroed, but order carries no slot/rank
 * meaning. See ADR-013 (Superseded) and tests/sponsor-share-rotation.spec.ts
 * for the share-magnitude unit tests.
 *
 * Properties asserted here (via seeded D1 + SELF.fetch):
 *   - uniform placement: every seeded sponsor is returned (no named-slot drop)
 *   - local floor: a local is never dropped, even against many premium non-locals
 *   - deterministic covenant order: stable across repeated calls
 *   - schema guard: sponsors.is_local stays NOT NULL (migration 0036)
 *
 * Per OCR_STANDARD_perStoryTestPyramid these are integration tests (they seed
 * D1 and hit the endpoint via SELF.fetch), not pure-unit.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';

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
  // OSE-799 A2: split model. tier + is_local(→locality_band) live on the
  // placement; placement_formats is retired (#25). Helper is idempotent by id.
  await seedSplitSponsor(tenv().DB, {
    id: opts.id,
    eventId: opts.eventId,
    name: opts.name,
    tier: opts.tier,
    isLocal: opts.is_local,
  });
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

describe('OSE-661 — covenant share rotation (Invariant #25)', () => {
  // The local guarantee is a FLOOR in rotation frequency, NOT a rank (ratified
  // 2026-08-08). These integration tests assert the OBSERVABLE guarantees via
  // the /sponsors endpoint (uniform presence, local never zeroed, determinism);
  // the floor(>=30%)/cap(<=40%) MAGNITUDES are unit-tested in
  // tests/sponsor-share-rotation.spec.ts against buildShareRotation directly.

  test('#25 | uniform placement: every seeded sponsor is returned (no named-slot drop)', async () => {
    const eventId = `ose661-evt-uniform`;
    await seedEvent(eventId);
    await seedSponsor({ eventId, id: 'u-title-nl', name: 'Title NL', tier: 'title', is_local: 0 });
    await seedSponsor({
      eventId,
      id: 'u-primary-loc',
      name: 'Primary Local',
      tier: 'primary',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'u-bronze-nl',
      name: 'Bronze NL',
      tier: 'bronze',
      is_local: 0,
    });

    const ids = await getResolvedSponsorIds(eventId);
    // Every sponsor is eligible for the surface — none filtered by a named slot.
    expect(ids).toContain('u-title-nl');
    expect(ids).toContain('u-primary-loc');
    expect(ids).toContain('u-bronze-nl');
  });

  test('public sponsor reads are not browser-cacheable across write→read journeys', async () => {
    const eventId = 'ose661-evt-cache-control';
    await seedEvent(eventId);

    for (const path of ['sponsors', 'sponsor-bundle?surface=display']) {
      const res = await SELF.fetch(
        `https://test.local/api/v2/events/${encodeURIComponent(eventId)}/${path}`
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  test('public sponsor reads reflect a sponsor written after an empty read', async () => {
    const eventId = 'ose661-evt-write-read';
    await seedEvent(eventId);

    const before = await getResolvedSponsorIds(eventId);
    expect(before).toEqual([]);

    await seedSponsor({
      eventId,
      id: 'wr-gold',
      name: 'Write Read Gold',
      tier: 'gold',
      is_local: 0,
    });

    const after = await getResolvedSponsorIds(eventId);
    expect(after).toContain('wr-gold');
  });

  test('#25 | local floor: a local is never zeroed, even against many premium non-locals', async () => {
    const eventId = `ose661-evt-floor`;
    await seedEvent(eventId);
    await seedSponsor({ eventId, id: 'f-loc', name: 'Local', tier: 'primary', is_local: 1 });
    await seedSponsor({ eventId, id: 'f-p1', name: 'Prem1', tier: 'title', is_local: 0 });
    await seedSponsor({ eventId, id: 'f-p2', name: 'Prem2', tier: 'platinum', is_local: 0 });
    await seedSponsor({ eventId, id: 'f-p3', name: 'Prem3', tier: 'title', is_local: 0 });

    const ids = await getResolvedSponsorIds(eventId);
    // The local guarantee is a FLOOR (never zeroed) — the local is always in the
    // rotation regardless of how many premium non-locals want in.
    expect(ids, 'local sponsor must never be dropped from the rotation').toContain('f-loc');
  });

  test('#25 | deterministic covenant order (share-based, stable across calls)', async () => {
    const eventId = `ose661-evt-determ`;
    await seedEvent(eventId);
    await seedSponsor({ eventId, id: 'd-a', name: 'A', tier: 'gold', is_local: 0 });
    await seedSponsor({ eventId, id: 'd-b', name: 'B', tier: 'bronze', is_local: 1 });
    await seedSponsor({ eventId, id: 'd-c', name: 'C', tier: 'title', is_local: 0 });

    const first = await getResolvedSponsorIds(eventId);
    const second = await getResolvedSponsorIds(eventId);
    expect(first.length).toBe(3);
    expect(second).toEqual(first);
  });

  test('#25 | OSE-INV5 covenant twin: local-bronze survives vs nonlocal-title (floor, NOT a locals-first rank)', async () => {
    // OSE-891: the RUNNABLE in-process twin of the Newman OSE-INV5 covenant
    // section (bruno/ose-api). Same 4 fixtures + the same
    // adversarial case (lowest-tier local vs highest-tier non-local), asserted
    // against the real resolver via SELF.fetch so the covenant is proven WITHOUT
    // staging/admin creds. The Newman L3 layer proves the same thing over the
    // network once OSE-889 clears; this is its corroborating L1.
    //
    // CRITICAL: under #25 the covenant is a rotation-frequency FLOOR, not a
    // locals-first DISPLAY RANK (the OSE-330 tierSort is retired). So we assert
    // the local is never ZEROED/dropped — NOT that it renders before the
    // non-local. Asserting "local-bronze before nonlocal-title" would re-encode
    // the retired model (which is exactly the stale Newman assertion this fixes).
    const eventId = `ose-inv5-covenant-twin`;
    await seedEvent(eventId);
    await seedSponsor({
      eventId,
      id: 'covenant-fixture-local-bronze',
      name: 'Local Bronze',
      tier: 'bronze',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'covenant-fixture-local-platinum',
      name: 'Local Platinum',
      tier: 'platinum',
      is_local: 1,
    });
    await seedSponsor({
      eventId,
      id: 'covenant-fixture-nonlocal-bronze',
      name: 'NonLocal Bronze',
      tier: 'bronze',
      is_local: 0,
    });
    await seedSponsor({
      eventId,
      id: 'covenant-fixture-nonlocal-title',
      name: 'NonLocal Title',
      tier: 'title',
      is_local: 0,
    });

    const ids = await getResolvedSponsorIds(eventId);

    // 1. Uniform eligibility — all 4 present (the correct half of the Newman assert).
    expect(ids).toContain('covenant-fixture-local-bronze');
    expect(ids).toContain('covenant-fixture-local-platinum');
    expect(ids).toContain('covenant-fixture-nonlocal-bronze');
    expect(ids).toContain('covenant-fixture-nonlocal-title');

    // 2. Local floor (the real covenant): the lowest-tier local is never zeroed,
    //    even against the highest-tier non-local (the adversarial case).
    expect(ids, 'local-bronze must survive vs nonlocal-title (floor, never dropped)').toContain(
      'covenant-fixture-local-bronze'
    );

    // 3. Deterministic covenant order (share desc + id tie-break), stable across calls.
    const again = await getResolvedSponsorIds(eventId);
    expect(again).toEqual(ids);
  });

  test('#25 | schema rejects NULL is_local — belt-and-suspenders for the covenant', async () => {
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
    // OSE-799 A2: the locality class is now sponsor_placement.locality_band
    // (NOT NULL DEFAULT 0, migration 0067) — it replaced sponsors.is_local. An
    // explicit NULL must still be rejected so the resolver's defensive coercion
    // stays belt-and-suspenders, never load-bearing.
    const eventId = `ose330-evt-cov-7`;
    await seedEvent(eventId);
    let rejected = false;
    try {
      await tenv()
        .DB.prepare(
          `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, locality_band, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))`
        )
        .bind('ose330-null-islocal-attempt', 'sb-null-islocal', eventId, 'platinum')
        .run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Expected: SQLITE_CONSTRAINT_NOTNULL on sponsor_placement.locality_band
      expect(msg).toMatch(/NOT NULL constraint failed.*sponsor_placement\.locality_band/i);
      rejected = true;
    }
    expect(
      rejected,
      'SCHEMA GUARD: migration 0067 must keep locality_band NOT NULL — a relaxed constraint would let NULL sneak in and make tierSort defensive coercion load-bearing'
    ).toBe(true);
  });
});
