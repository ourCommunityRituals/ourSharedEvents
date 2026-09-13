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
 *   2. ACCEPTANCE IS TWO-SIDED, WITH A SPLIT DEFAULT (OSE-1301, ratified
 *      2026-09-13 — supersedes the original NULL-permissive rule):
 *        • ORGANIZER side stays permissive — creating the placement IS the
 *          organizer's pick (leg 1). NULL organizer does NOT hide; only an
 *          explicit organizer rejection (0) hides.
 *        • SPONSOR side is STRICT — the sponsor must confirm its own
 *          appearance (leg 3). "Silence never becomes consent," so NULL
 *          sponsor_accepted DOES hide; only an explicit 1 renders.
 *      Either side's rejection hides; a rejection is durable against Path 2
 *      re-proposal. (Path 2 auto-match keeps the old permissive rule pending
 *      the OSE-1301 open question — see sponsor-consent-trace.invariant.spec.ts.)
 *
 * Harness mirrors poster-attribution-kanon-floor.spec.ts: apply migrations
 * exactly once per isolate, seed directly, run the real resolver.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';
import { handleConfirmSponsorPlacement } from '../src/handlers/sponsors';

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
      `INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
       VALUES (?, 'wkrp', '0068 fixture event', 'evt-0068-fixture', 'published', ?, ?)`
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
  test('OSE-1301: an unconfirmed sponsor (NULL sponsor_accepted) does NOT resolve — silence is not consent', async () => {
    await seedBusiness('sb-live');
    await seedPlacement('sp-live', 'sb-live'); // both sides NULL (unanswered)
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });

  test('a soft-deleted business is gone from Path 1 even with an active, confirmed placement', async () => {
    await seedBusiness('sb-dead', 0);
    // sponsor confirmed → isolate the business-lifecycle reason for hiding (so this
    // test fails if the is_active gate breaks, not merely because silence hides).
    await seedPlacement('sp-dead', 'sb-dead', { organizer: 1, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved).toEqual([]);
  });
});

describe('0068 + OSE-1301 — two-sided acceptance, split default (organizer permissive, sponsor strict)', () => {
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

  test('OSE-1301: sponsor silence (NULL) hides even when the organizer accepted', async () => {
    await seedBusiness('sb-sil');
    await seedPlacement('sp-sil', 'sb-sil', { organizer: 1, sponsor: null });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved, 'an unconfirmed sponsor must not render').toEqual([]);
  });

  test('OSE-1301: organizer silence (NULL) is permissive — a confirmed sponsor still resolves', async () => {
    await seedBusiness('sb-osil');
    await seedPlacement('sp-osil', 'sb-osil', { organizer: null, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(
      resolved.map((s) => s.id),
      'organizer pick is implied by creation'
    ).toEqual(['sb-osil']);
  });

  test('both sides accepted resolves', async () => {
    await seedBusiness('sb-both');
    await seedPlacement('sp-both', 'sb-both', { organizer: 1, sponsor: 1 });
    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(resolved.map((s) => s.id)).toEqual(['sb-both']);
  });
});

describe('OSE-1301 — sponsor confirmation completes the loop (leg 3 write path)', () => {
  // The full loop end-to-end at the data layer: organizer picks (creates the
  // placement) → sponsor SILENT → hidden → sponsor CONFIRMS via the endpoint
  // handler → renders. Revert the handler's UPDATE and the "then renders" step
  // fails, so this is a live born-red for the write path, not just its presence.
  const asEnv = (): Parameters<typeof handleConfirmSponsorPlacement>[1] =>
    tenv() as unknown as Parameters<typeof handleConfirmSponsorPlacement>[1];

  test('an unconfirmed placement is hidden until the sponsor confirms, then renders', async () => {
    await seedBusiness('sb-confirm');
    await seedPlacement('sp-confirm', 'sb-confirm', { organizer: 1, sponsor: null });
    expect(await resolveSponsorsForEvent(tenv().DB, EVENT_ID), 'silence hides').toEqual([]);

    const res = await handleConfirmSponsorPlacement(
      new Request(`https://t.test/api/v2/admin/events/${EVENT_ID}/sponsors/sb-confirm/confirm`, {
        method: 'POST',
      }),
      asEnv(),
      EVENT_ID,
      'sb-confirm'
    );
    expect(res.status, 'confirm returns 200').toBe(200);

    const resolved = await resolveSponsorsForEvent(tenv().DB, EVENT_ID);
    expect(
      resolved.map((s) => s.id),
      'confirmed sponsor now renders'
    ).toEqual(['sb-confirm']);
  });

  test('confirming a placement that does not exist returns 404', async () => {
    const res = await handleConfirmSponsorPlacement(
      new Request('https://t.test/x', { method: 'POST' }),
      asEnv(),
      EVENT_ID,
      'no-such-sponsor'
    );
    expect(res.status).toBe(404);
  });

  test('confirm does NOT override an explicit sponsor rejection into a silent yes', async () => {
    // A rejected sponsor (0) that is then "confirmed" flips to 1 — confirmation is
    // an affirmative act, so this is allowed; but it must be an explicit call, never
    // a silent default. (Documents the intended semantics: 0 is durable until an
    // explicit confirm, and NULL never auto-becomes 1.)
    await seedBusiness('sb-rej');
    await seedPlacement('sp-rej', 'sb-rej', { organizer: 1, sponsor: 0 });
    expect(await resolveSponsorsForEvent(tenv().DB, EVENT_ID), 'rejected hidden').toEqual([]);
    await handleConfirmSponsorPlacement(
      new Request('https://t.test/x', { method: 'POST' }),
      asEnv(),
      EVENT_ID,
      'sb-rej'
    );
    expect(
      (await resolveSponsorsForEvent(tenv().DB, EVENT_ID)).map((s) => s.id),
      'an explicit confirm after a rejection renders'
    ).toEqual(['sb-rej']);
  });
});
