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
