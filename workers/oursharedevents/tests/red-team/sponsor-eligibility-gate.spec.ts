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
import { mintSponsorInviteToken, type SponsorInviteEnv } from '../../src/lib/sponsor-invite';
import { allocateShares } from '../../src/lib/sponsor-allocation';
import { handlePromoteSponsorDraft } from '../../src/handlers/sponsors-draft';

interface RawEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SPONSOR_INVITE_SIGNING_SECRET?: string;
}
const e = () => env as unknown as RawEnv;
const inviteEnv = () => env as unknown as SponsorInviteEnv;

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
  // @born-red TL-062 | method: design-time-negative-assertion | date: 2026-08-13
  test('ineligible draft → 402 PAYMENT_REQUIRED, no sponsor, draft.status untouched', async () => {
    await seedDraft('elig_no', { eligible: false });
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    const res = await promoteSponsorDraft(e() as never, 'elig_no');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
    if (!res.ok) expect(res.code).toBe('PAYMENT_REQUIRED');
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
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

  // @born-red TL-061 | method: design-time-negative-assertion | date: 2026-08-13
  test('server-set only: the gate reads the DB column, not caller intent', async () => {
    // free_tier_eligible=0 in the DB → 402 regardless. A client cannot forge it
    // because promoteSponsorDraft takes no client eligibility input.
    await seedDraft('elig_forge', { eligible: false });
    const res = await promoteSponsorDraft(e() as never, 'elig_forge');
    expect(res.ok).toBe(false);
  });
});

describe('OSE-744 — comp invite token is brand-bound', () => {
  test('a valid comp token whose signed brand_id matches the draft admits promotion', async () => {
    await seedDraft('elig_tok_ok', { eligible: false }); // brand-E, not free-tier
    const token = await mintSponsorInviteToken(inviteEnv(), { brand_id: 'brand-E' });
    expect(
      token,
      'mint requires SPONSOR_INVITE_SIGNING_SECRET bound in vitest.config'
    ).toBeTruthy();
    const res = await promoteSponsorDraft(e() as never, 'elig_tok_ok', {
      compInviteToken: token!,
    });
    expect(res.ok).toBe(true);
  });

  // @born-red TL-063 | method: design-time-negative-assertion | date: 2026-08-13
  test('cross-brand comp token is rejected → 402 (brand read from the signed claim, #9)', async () => {
    await seedDraft('elig_tok_bad', { eligible: false }); // draft brand is brand-E
    const foreignToken = await mintSponsorInviteToken(inviteEnv(), { brand_id: 'brand-OTHER' });
    expect(foreignToken).toBeTruthy();
    const res = await promoteSponsorDraft(e() as never, 'elig_tok_bad', {
      compInviteToken: foreignToken!,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
  });

  test('a malformed / unsigned comp token does not admit (fail-closed)', async () => {
    await seedDraft('elig_tok_junk', { eligible: false });
    const res = await promoteSponsorDraft(e() as never, 'elig_tok_junk', {
      compInviteToken: 'not.a.real.token',
    });
    expect(res.ok).toBe(false);
  });
});

describe('OSE-744 — #25 allocation invariant to payment/eligibility', () => {
  // @born-red TL-064 | method: design-time-negative-assertion | date: 2026-08-13
  test('eligibility SOURCE never changes the promoted tier (always covenant base)', async () => {
    await seedDraft('tier_free', { eligible: true });
    const r1 = await promoteSponsorDraft(e() as never, 'tier_free');
    await seedDraft('tier_comp', { eligible: false });
    const r2 = await promoteSponsorDraft(e() as never, 'tier_comp', { compClaimValid: true });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      const t1 = await env.DB.prepare(
        'SELECT tier FROM sponsor_placement WHERE sponsor_business_id = ?'
      )
        .bind(r1.sponsor_id)
        .first<{ tier: string }>();
      const t2 = await env.DB.prepare(
        'SELECT tier FROM sponsor_placement WHERE sponsor_business_id = ?'
      )
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

describe('OSE-744 — the eligibility decision is audited, PII-free (#24)', () => {
  function fakeCtx(): { ctx: ExecutionContext; flush: () => Promise<unknown[]> } {
    const waits: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return { ctx, flush: () => Promise.all(waits) };
  }

  async function promoteViaHandler(token: string, reqId: string): Promise<Response> {
    const { ctx, flush } = fakeCtx();
    const req = new Request('https://t.test/api/v2/admin/sponsors/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft_token: token }),
    });
    // No admin actor: the handler runs as under the DEV_OPEN_ADMIN local bypass, the
    // one place a null actor may promote (OSE-1801).
    const devOpen = { ...e(), DEV_OPEN_ADMIN: 'true' };
    const res = await handlePromoteSponsorDraft(req, devOpen as never, ctx, reqId);
    await flush(); // drain waitUntil so the fire-and-forget audit row lands
    return res;
  }

  // @born-red TL-065 | method: design-time-negative-assertion | date: 2026-08-13
  test('grant writes a SPONSOR_ELIGIBILITY_DECISION row carrying only decision+source (no PII)', async () => {
    await seedDraft('aud_grant', { eligible: true });
    await promoteViaHandler('aud_grant', 'req-aud-1');

    const row = await env.DB.prepare(
      `SELECT outcome, resource_type, resource_id, ip, details
         FROM admin_audit_log
        WHERE request_id = 'req-aud-1' AND action = 'SPONSOR_ELIGIBILITY_DECISION'`
    ).first<{
      outcome: string;
      resource_type: string;
      resource_id: string;
      ip: string | null;
      details: string;
    }>();

    expect(row, 'a decision audit row must be written').toBeTruthy();
    expect(row!.outcome).toBe('success');
    expect(row!.resource_type).toBe('sponsor_draft');
    expect(row!.resource_id).toBe('brand-E'); // tenant id, not PII
    expect(row!.ip).toBeNull(); // no IP captured at this layer
    const details = JSON.parse(row!.details) as Record<string, unknown>;
    expect(details.decision).toBe('granted');
    expect(details.source).toBe('free_tier');
    // PII-free by construction: the ONLY detail keys are decision + source.
    expect(Object.keys(details).sort()).toEqual(['decision', 'source']);
  });

  test('402 deny writes an audited denial (decision=payment_required)', async () => {
    await seedDraft('aud_deny', { eligible: false });
    const res = await promoteViaHandler('aud_deny', 'req-aud-2');
    expect(res.status).toBe(402);

    const row = await env.DB.prepare(
      `SELECT outcome, details FROM admin_audit_log
        WHERE request_id = 'req-aud-2' AND action = 'SPONSOR_ELIGIBILITY_DECISION'`
    ).first<{ outcome: string; details: string }>();
    expect(row?.outcome).toBe('denied');
    expect((JSON.parse(row!.details) as Record<string, unknown>).decision).toBe('payment_required');
  });
});
