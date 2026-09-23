/**
 * OSE-1265/1266 narrow slice — sponsor self-serve onboarding screen.
 *
 * The page is allowed to create only resolver-invisible drafts and render a
 * live outcome preview. It must not promote, accept, or start Connect/payment.
 */

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { mintSponsorInviteToken } from '../src/lib/sponsor-invite';
import { buildOutcomePreview } from '../src/lib/sponsor-preview';
import type { RotationSponsor } from '../src/lib/sponsor-allocation';

const BRAND = 'ose1265-onboard-brand';
const EVENT = 'ose1265-onboard-event';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SPONSOR_INVITE_SIGNING_SECRET: string;
}

const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
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

async function seedSponsor(id: string, tier: string, isLocal: number): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, is_active = 1`
  )
    .bind(id, BRAND, id)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement
       (id, sponsor_business_id, event_id, tier, source, locality_band, organizer_accepted, sponsor_accepted, is_active)
     VALUES (?, ?, ?, ?, 'organizer', ?, 1, 1, 1)
     ON CONFLICT(id) DO UPDATE SET tier = excluded.tier, locality_band = excluded.locality_band, sponsor_accepted = 1, is_active = 1`
  )
    .bind(`${id}-placement`, id, EVENT, tier, isLocal)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE id LIKE ?')
    .bind('ose1265-onboard-%')
    .run();
  await tenv.DB.prepare('DELETE FROM sponsor_business WHERE id LIKE ?')
    .bind('ose1265-onboard-%')
    .run();
  await tenv.DB.prepare('DELETE FROM sponsor_business_draft WHERE brand_id = ?').bind(BRAND).run();
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(EVENT).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status)
     VALUES (?, ?, 'Sponsor Onboard Event', ?, 'active')`
  )
    .bind(EVENT, BRAND, EVENT)
    .run();
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO category_registry (category, display_name, display_order, is_active)
     VALUES ('food', 'Food', 1, 1)`
  ).run();
  await seedSponsor('ose1265-onboard-local', 'gold', 1);
  await seedSponsor('ose1265-onboard-premium', 'title', 0);
});

async function invite(): Promise<string> {
  const token = await mintSponsorInviteToken(tenv, { brand_id: BRAND, event_id: EVENT });
  expect(token).not.toBeNull();
  return token!;
}

describe('sponsor self-serve onboarding page', () => {
  test('valid invite renders the draft-capture screen and no payment/promotion surface', async () => {
    const token = await invite();
    const res = await SELF.fetch(`https://t.test/sponsor/onboard?t=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const html = await res.text();
    expect(html).toContain('data-testid="sponsor-onboard-form"');
    expect(html).toContain('data-testid="sponsor-onboard-preview"');
    expect(html).toContain('/api/v2/sponsors/draft');
    expect(html).toContain('/api/v2/sponsors/draft/preview');
    expect(html).toContain('Base-node availability is free');
    expect(html).toContain('standard');
    expect(html).toContain('frequent');
    expect(html).toContain('headline');
    expect(html).toContain('Stripe Payment Links/Wave');
    expect(html).toContain('free/community-benefit sponsors receive no payment link');
    expect(html).not.toMatch(/connect|promote/i);
  });

  test('invalid invite fails closed', async () => {
    const res = await SELF.fetch('https://t.test/sponsor/onboard?t=bad-token');
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  test('draft preview equals the real preview engine for the accepted corridor corpus', async () => {
    const token = await invite();
    const res = await SELF.fetch(
      `https://t.test/api/v2/sponsors/draft/preview?t=${encodeURIComponent(token)}&tier=title`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      preview: unknown;
      copy: Record<string, string>;
    };
    expect(body.ok).toBe(true);
    const corridorSponsors: RotationSponsor[] = [
      { id: 'ose1265-onboard-local', tier: 'mid', is_local: true },
      { id: 'ose1265-onboard-premium', tier: 'premium', is_local: false },
    ];
    expect(body.preview).toEqual(
      buildOutcomePreview({
        tier: 'premium',
        sponsorId: 'draft-preview',
        isLocal: false,
        corridorSponsors,
      })
    );
    expect(body.copy.frequencyCaveat).toContain('not a reserved slot');
  });

  test('public form target creates a resolver-invisible draft only', async () => {
    const token = await invite();
    const res = await SELF.fetch('https://t.test/api/v2/sponsors/draft', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: EVENT,
        name: 'Self Serve Sponsor',
        website_url: 'https://example.test',
        category_selections: [{ category: 'food', mode: 'whole' }],
        covenant_acknowledged: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; draft_token: string };
    expect(body.ok).toBe(true);
    expect(body.draft_token).toBeTruthy();

    const draft = await tenv.DB.prepare(
      'SELECT status, promoted_sponsor_id FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind(body.draft_token)
      .first<{ status: string; promoted_sponsor_id: string | null }>();
    expect(draft).toEqual({ status: 'draft', promoted_sponsor_id: null });

    const live = await tenv.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_business WHERE name = 'Self Serve Sponsor'"
    ).first<{ c: number }>();
    expect(live?.c).toBe(0);
  });
});
