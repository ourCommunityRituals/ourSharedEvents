/**
 * 0068 — sponsor business lifecycle + two-sided placement acceptance.
 *
 * Born-red pair for the 0068 fix (dormant-control rule: prove the control
 * LIVE, not merely present):
 *
 *   1. DELETE IS REAL. handleAdminDeleteSponsor used to cascade
 *      is_active = 0 onto placements while leaving sponsor_business
 *      untouched — so Path 2 (template+geo) re-surfaced the "deleted"
 *      business on every matching event, and any new placement resurrected
 *      it on Path 1. Now deletion is sponsor_business.is_active = 0, and
 *      BOTH resolver paths must honour it.
 *
 *   2. ACCEPTANCE IS TWO-SIDED AND ASYMMETRIC (ADR-019, "silence != consent").
 *      SPONSOR side is STRICT: a placement renders publicly only when
 *      sponsor_accepted = 1 — NULL ("not answered yet") and 0 (rejected) both
 *      hide, because a sponsor's silence is not consent to appear on a public
 *      surface. ORGANIZER side stays PERMISSIVE: COALESCE(organizer_accepted,
 *      1) = 1, so only an explicit organizer rejection (0) hides — the
 *      organizer created the placement, so their silence IS consent. Either
 *      side still hides on rejection; a rejection is durable against Path 2
 *      re-proposal. (Was NULL-permissive on both sides; flipped per CCR-PR567
 *      M4 + ADR-019.)
 *
 * Harness mirrors poster-attribution-kanon-floor.spec.ts: apply migrations
 * exactly once per isolate, seed directly, run the real resolver.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

let migrated = false;
async function applyMigrations(): Promise<void> {
  if (migrated) return;
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
  migrated = true;
}

const EVENT_ID = 'evt-0068';
const NOW = '2026-08-01T00:00:00.000Z';

async function seedEvent(): Promise<void> {
  await tenv()
    .DB.prepare(
      // OSE-1900: the event chose to have sponsors; the two sides are what is under test.
      `INSERT INTO events (id, brand_id, title, slug, status, settings_json, created_at, updated_at)
       VALUES (?, 'wkrp', '0068 fixture event', 'evt-0068-fixture', 'published', '{"useSponsors":true}', ?, ?)`
    )
    .bind(EVENT_ID, NOW, NOW)
    .run();
}

async function seedBusiness(id: string, active = 1): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO sponsor_business (id, brand_id, name, is_active, created_at, updated_at)
       VALUES (?, 'wkrp', ?, ?, ?, ?)`
    )
    .bind(id, `biz ${id}`, active, NOW, NOW)
    .run();
}

async function seedPlacement(
  id: string,
  businessId: string,
  opts: { organizer?: number | null; sponsor?: number | null } = {}
): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT INTO sponsor_placement
         (id, sponsor_business_id, event_id, tier, source, is_active,
          organizer_accepted, sponsor_accepted, created_at, updated_at)
       VALUES (?, ?, ?, 'standard', 'organizer', 1, ?, ?, ?, ?)`
    )
    .bind(id, businessId, EVENT_ID, opts.organizer ?? null, opts.sponsor ?? null, NOW, NOW)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await tenv().DB.prepare('DELETE FROM sponsor_placement').run();
  await tenv().DB.prepare('DELETE FROM sponsor_business').run();
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(EVENT_ID).run();
  await seedEvent();
});

describe('0068 — business lifecycle governs both resolver paths', () => {
  test('an unanswered SPONSOR (NULL) does NOT render — silence != consent (ADR-019)', async () => {
    await seedBusiness('sb-live');
    await seedPlacement('sp-live', 'sb-live'); // organizer NULL, sponsor NULL
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });

  test('a soft-deleted business is gone from Path 1 even with an active placement', async () => {
    await seedBusiness('sb-dead', 0);
    await seedPlacement('sp-dead', 'sb-dead');
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });
});

describe('0068 — two-sided acceptance', () => {
  test('organizer rejection hides the placement', async () => {
    await seedBusiness('sb-orj');
    await seedPlacement('sp-orj', 'sb-orj', { organizer: 0, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });

  test('sponsor rejection hides the placement', async () => {
    await seedBusiness('sb-spr');
    await seedPlacement('sp-spr', 'sb-spr', { organizer: 1, sponsor: 0 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });

  test('both sides accepted resolves', async () => {
    await seedBusiness('sb-both');
    await seedPlacement('sp-both', 'sb-both', { organizer: 1, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved.map((s) => s.id)).toEqual(['sb-both']);
  });

  test('sponsor silence hides even when the organizer accepted (strict sponsor consent)', async () => {
    await seedBusiness('sb-spnull');
    await seedPlacement('sp-spnull', 'sb-spnull', { organizer: 1, sponsor: null });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });

  test('organizer silence stays permissive: sponsor accepted + organizer NULL renders', async () => {
    await seedBusiness('sb-orgnull');
    await seedPlacement('sp-orgnull', 'sb-orgnull', { organizer: null, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved.map((s) => s.id)).toEqual(['sb-orgnull']);
  });
});
