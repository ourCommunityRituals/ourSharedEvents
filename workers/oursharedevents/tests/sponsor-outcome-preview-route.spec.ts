/**
 * OSE-1266 — admin live outcome preview.
 *
 * This is the UI/API seam for the read-only sponsorship config preview. The
 * route must return the exact same object as buildOutcomePreview() for the same
 * accepted corridor pool, and the admin screen must frame frequency as an
 * estimate rather than a reserved slot.
 */

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildOutcomePreview } from '../src/lib/sponsor-preview';
import type { RotationSponsor } from '../src/lib/sponsor-allocation';

// Matches the ADMIN_KEY test binding in vitest.workers.config.mts (Method 3,
// ALLOW_ADMIN_KEY_FALLBACK) — same convention as every other spec's ADMIN header.
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose1266-preview-brand';
const EVENT = 'ose1266-preview-event';
const SELF_SPONSOR = 'ose1266-preview-self';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedSponsor(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, is_active = 1`
  )
    .bind(id, BRAND, name)
    .run();
}

async function seedPlacement(
  id: string,
  sponsorId: string,
  tier: string,
  isLocal: number,
  sponsorAccepted: number | null
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsor_placement
       (id, sponsor_business_id, event_id, tier, source, locality_band, organizer_accepted, sponsor_accepted, is_active)
     VALUES (?, ?, ?, ?, 'organizer', ?, 1, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       tier = excluded.tier,
       locality_band = excluded.locality_band,
       organizer_accepted = excluded.organizer_accepted,
       sponsor_accepted = excluded.sponsor_accepted,
       is_active = excluded.is_active`
  )
    .bind(id, sponsorId, EVENT, tier, isLocal, sponsorAccepted)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('DELETE FROM sponsor_placement WHERE id LIKE ?')
    .bind('ose1266-preview-%')
    .run();
  await env.DB.prepare('DELETE FROM sponsor_business WHERE id LIKE ?')
    .bind('ose1266-preview-%')
    .run();
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(EVENT).run();
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status)
     VALUES (?, ?, 'OSE-1266 Preview', ?, 'active')`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();

  await seedSponsor(SELF_SPONSOR, 'Preview Self');
  await seedSponsor('ose1266-preview-local', 'Accepted Local');
  await seedSponsor('ose1266-preview-premium', 'Accepted Premium');
  await seedSponsor('ose1266-preview-pending', 'Pending Sponsor');
  await seedPlacement('ose1266-preview-self-placement', SELF_SPONSOR, 'bronze', 0, 1);
  await seedPlacement('ose1266-preview-local-placement', 'ose1266-preview-local', 'gold', 1, 1);
  await seedPlacement(
    'ose1266-preview-premium-placement',
    'ose1266-preview-premium',
    'title',
    0,
    1
  );
  await seedPlacement(
    'ose1266-preview-pending-placement',
    'ose1266-preview-pending',
    'title',
    0,
    null
  );
});

describe('OSE-1266 sponsor outcome preview route', () => {
  test('returns exactly the engine preview for the accepted corridor corpus', async () => {
    const res = await SELF.fetch(
      `https://t.test/api/v2/admin/sponsors/preview?eventId=${encodeURIComponent(EVENT)}&sponsorId=${encodeURIComponent(SELF_SPONSOR)}&tier=title`,
      { headers: ADMIN }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      preview: unknown;
      copy: Record<string, string>;
    };
    expect(body.ok).toBe(true);

    const corridorSponsors: RotationSponsor[] = [
      { id: 'ose1266-preview-local', tier: 'mid', is_local: true },
      { id: 'ose1266-preview-premium', tier: 'premium', is_local: false },
    ];
    expect(body.preview).toEqual(
      buildOutcomePreview({
        tier: 'premium',
        sponsorId: SELF_SPONSOR,
        isLocal: false,
        corridorSponsors,
      })
    );
    expect(body.copy.frequencyCaveat).toContain('not a reserved slot');
  });

  test('admin form renders the live preview mount, sourced from server copy (no hardcoded promise text)', async () => {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="spon-outcome-preview"');
    expect(html).toContain('/api/v2/admin/sponsors/preview?');
    expect(html).toContain('aggregate-only, no attendee questions');
    // The frequency caveat copy is rendered from the server response
    // (data.copy.frequencyCaveat), never hardcoded client-side — so the actual
    // "not a reserved slot" wording lives only in the route's response (see
    // the contract test above), and the client just renders whatever the
    // server says.
    expect(html).toContain('data.copy.frequencyCaveat');
    expect(html).not.toContain('not a reserved slot, rank, size, or position');
  });
});
