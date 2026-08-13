/**
 * OSE-744 / P1 — eligibility gate at the promotion seam. Born-red + unit + integration.
 *
 * The promotion seam now admits/denies via a PURE eligibility reducer; when no
 * source grants, it returns 402 PAYMENT_REQUIRED instead of minting a sponsor —
 * leaving the draft re-submittable, writing no sponsors row, and NEVER letting
 * price/tier influence allocation (#25). Eligibility is server-set (draft column),
 * not client-trusted.
 *
 * @born-red invariant#25,#8,#1 | method: eligibility-gate | date: 2026-08-13
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { promoteSponsorDraft, COVENANT_BASE_TIER } from '../../src/lib/sponsor-promotion';
import { resolveSponsorEligibility } from '../../src/lib/sponsor-eligibility';
import { allocateShares } from '../../src/lib/sponsor-allocation';

interface RawEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const e = () => env as unknown as RawEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(e().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw err;
    }
  }
}

async function seedDraft(token: string, opts: { eligible: boolean }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsor_business_draft
       (draft_token, brand_id, event_id, name, category_selections, covenant_acknowledged_at, status,
        free_tier_eligible, eligibility_source)
     VALUES (?, 'brand-E', 'evt-E', ?, ?, '2026-08-12T00:00:00Z', 'draft', ?, ?)`
  )
    .bind(
      token,
      `Co ${token}`,
      JSON.stringify([{ category: 'bar_events', mode: 'whole' }]),
      opts.eligible ? 1 : 0,
      opts.eligible ? 'community_benefit' : null
    )
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    "INSERT INTO events (id, brand_id, title, slug, status) VALUES ('evt-E','brand-E','E','slug-e','active')"
  ).run();
});

describe('OSE-744 — resolveSponsorEligibility (pure reducer)', () => {
  test('each source alone grants; precedence free_tier > comp', () => {
    expect(resolveSponsorEligibility({ free_tier: true, comp: false })).toEqual({
      eligible: true,
      source: 'free_tier',
    });
    expect(resolveSponsorEligibility({ free_tier: false, comp: true })).toEqual({
      eligible: true,
      source: 'comp',
    });
    expect(
      resolveSponsorEligibility({ free_tier: false, comp: false, subscription: true })
    ).toEqual({ eligible: true, source: 'subscription' });
    expect(
      resolveSponsorEligibility({ free_tier: false, comp: false, store_credit: true })
    ).toEqual({ eligible: true, source: 'store_credit' });
    // precedence: first truthy in fixed order wins
    expect(resolveSponsorEligibility({ free_tier: true, comp: true }).source).toBe('free_tier');
  });

  test('fail-closed: nothing granted / missing inputs → ineligible', () => {
    expect(resolveSponsorEligibility({ free_tier: false, comp: false })).toEqual({
      eligible: false,
      source: null,
    });
    // @ts-expect-error — missing keys must fail closed, never throw
    expect(resolveSponsorEligibility({}).eligible).toBe(false);
  });

  test('unknown/extra keys are ignored (forward-compat for OSE-745)', () => {
    const r = resolveSponsorEligibility({ free_tier: false, comp: false, mystery: true } as never);
    expect(r.eligible).toBe(false);
  });
});

describe('OSE-744 — gate at the promotion seam', () => {
  test('ineligible draft → 402 PAYMENT_REQUIRED, no sponsor, draft.status untouched (TL-C)', async () => {
    await seedDraft('elig_no', { eligible: false });
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsors').first<{
      c: number;
    }>();
    const res = await promoteSponsorDraft(e() as never, 'elig_no');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
    if (!res.ok) expect(res.code).toBe('PAYMENT_REQUIRED');
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsors').first<{ c: number }>();
    expect(after?.c).toBe(before?.c); // no sponsor minted
    const draft = await env.DB.prepare(
      "SELECT status, promoted_sponsor_id FROM sponsor_business_draft WHERE draft_token='elig_no'"
    ).first<{ status: string; promoted_sponsor_id: string | null }>();
    expect(draft?.status).toBe('draft'); // re-submittable
    expect(draft?.promoted_sponsor_id).toBeNull();
  });

  test('free_tier-eligible draft → 200 promoted', async () => {
    await seedDraft('elig_free', { eligible: true });
    const res = await promoteSponsorDraft(e() as never, 'elig_free');
    expect(res.ok).toBe(true);
  });

  test('comp claim (opts.compClaimValid) promotes an otherwise-ineligible draft', async () => {
    await seedDraft('elig_comp', { eligible: false });
    const res = await promoteSponsorDraft(e() as never, 'elig_comp', { compClaimValid: true });
    expect(res.ok).toBe(true);
  });

  test('server-set only: the gate reads the DB column, not caller intent (TL-B)', async () => {
    // free_tier_eligible=0 in the DB → 402 regardless. A client cannot forge it
    // because promoteSponsorDraft takes no client eligibility input.
    await seedDraft('elig_forge', { eligible: false });
    const res = await promoteSponsorDraft(e() as never, 'elig_forge');
    expect(res.ok).toBe(false);
  });
});

describe('OSE-744 — #25 allocation invariant to payment/eligibility', () => {
  test('eligibility SOURCE never changes the promoted tier (always covenant base)', async () => {
    await seedDraft('tier_free', { eligible: true });
    const r1 = await promoteSponsorDraft(e() as never, 'tier_free');
    await seedDraft('tier_comp', { eligible: false });
    const r2 = await promoteSponsorDraft(e() as never, 'tier_comp', { compClaimValid: true });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const t1 = await env.DB.prepare('SELECT tier FROM sponsors WHERE id = ?')
        .bind(r1.sponsor_id)
        .first<{ tier: string }>();
      const t2 = await env.DB.prepare('SELECT tier FROM sponsors WHERE id = ?')
        .bind(r2.sponsor_id)
        .first<{ tier: string }>();
      expect(t1?.tier).toBe(COVENANT_BASE_TIER);
      expect(t2?.tier).toBe(COVENANT_BASE_TIER); // comp vs free_tier → identical base tier
    }
  });

  test('allocateShares takes no payment/eligibility dimension; output is {id,sharePct} only', () => {
    const out = allocateShares([
      { id: 'a', tier: 'base', is_local: true },
      { id: 'b', tier: 'premium', is_local: false },
    ]);
    for (const row of out) expect(Object.keys(row).sort()).toEqual(['id', 'sharePct']);
  });
});
