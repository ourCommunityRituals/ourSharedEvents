/**
 * OSE-1266 — Outcome preview: unit + contract-vs-engine + covenant red lines (born-red).
 *
 * The preview is the sponsorship page's centerpiece; these tests are what let us
 * "market exactly what the tests certify." Each red line goes red if the guarantee
 * is broken — verified by reverting the guard in the module.
 */

import { describe, it, expect } from 'vitest';
import { buildOutcomePreview, type PreviewInput } from '../src/lib/sponsor-preview';
import { DEPTH_SECTIONS, resolveDepth, filterReportByDepth } from '../src/lib/report-depth';
import { allocateShares, type RotationSponsor } from '../src/lib/sponsor-allocation';

const base = (over: Partial<PreviewInput> = {}): PreviewInput => ({
  tier: 'local',
  sponsorId: 'sp_self',
  isLocal: false,
  corridorSponsors: [],
  ...over,
});

// Aggregate section universe = every name the report can ever expose. Anything a
// preview surfaces must be in here (there is no per-attendee field anywhere in it).
const AGGREGATE_UNIVERSE = new Set(DEPTH_SECTIONS.premium);
const ATTENDEE_KEY = /anon|email|\bip\b|name|phone|device|attendee|per[_-]?person/i;

describe('OSE-1266 outcome preview — depth mapping (honest sponsor cap)', () => {
  it('local tier → local depth, local sections', () => {
    const p = buildOutcomePreview(base({ tier: 'local' }));
    expect(p.report_depth).toBe('local');
    expect(new Set(p.report_sections)).toEqual(new Set(DEPTH_SECTIONS.local));
  });

  it('mid tier → mid depth', () => {
    const p = buildOutcomePreview(base({ tier: 'mid', sponsorId: 'sp_self' }));
    expect(p.report_depth).toBe('mid');
    expect(p.report_sections).toContain('corridor_map');
    expect(p.report_sections).not.toContain('headcount_trend'); // premium-only, sponsor-capped
  });

  it('premium tier → still MID depth (sponsors cap at mid) — buys frequency, not deeper data', () => {
    const p = buildOutcomePreview(base({ tier: 'premium', sponsorId: 'sp_self' }));
    expect(p.report_depth).toBe('mid');
    expect(p.report_sections).not.toContain('headcount_trend');
  });
});

describe('OSE-1266 outcome preview — CONTRACT: preview == what the engine would deliver', () => {
  // Property over tiers: the preview's sections MUST equal the real filter's output
  // for the same resolved depth — no hand-copied list, no drift.
  for (const tier of ['local', 'mid', 'premium'] as const) {
    it(`${tier}: report_sections == filterReportByDepth(sponsor @ that depth)`, () => {
      const p = buildOutcomePreview(base({ tier, sponsorId: 'sp_self' }));
      const depthClaim = tier === 'local' ? 'local' : 'mid';
      const resolved = resolveDepth({ role: 'sponsor', depth: depthClaim, sponsor_id: 'sp_self' });
      const shape: Record<string, unknown> = {};
      for (const k of DEPTH_SECTIONS.premium) shape[k] = null;
      const { report } = filterReportByDepth(shape, resolved);
      expect(new Set(p.report_sections)).toEqual(new Set(Object.keys(report)));
    });
  }

  const corpora: Array<{
    name: string;
    tier: PreviewInput['tier'];
    isLocal: boolean;
    others: RotationSponsor[];
  }> = [
    { name: 'empty corridor', tier: 'local', isLocal: false, others: [] },
    {
      name: 'local mid sponsor among premium non-locals',
      tier: 'mid',
      isLocal: true,
      others: [
        { id: 'a', tier: 'premium', is_local: false },
        { id: 'b', tier: 'premium', is_local: false },
      ],
    },
    {
      name: 'premium non-local among local floor',
      tier: 'premium',
      isLocal: false,
      others: [
        { id: 'a', tier: 'base', is_local: true },
        { id: 'b', tier: 'mid', is_local: true },
        { id: 'c', tier: 'premium', is_local: false },
      ],
    },
  ];

  for (const corpus of corpora) {
    it(`${corpus.name}: frequency estimate == allocateShares for the same pool`, () => {
      const p = buildOutcomePreview(
        base({
          tier: corpus.tier,
          sponsorId: 'sp_self',
          isLocal: corpus.isLocal,
          corridorSponsors: corpus.others,
        })
      );
      const selfTier =
        corpus.tier === 'premium' ? 'premium' : corpus.tier === 'mid' ? 'mid' : 'base';
      const engine = allocateShares([
        ...corpus.others,
        { id: 'sp_self', tier: selfTier, is_local: corpus.isLocal },
      ]);
      const mine = engine.find((s) => s.id === 'sp_self')!;
      expect(p.frequency_share_pct).toBeCloseTo(Math.round(mine.sharePct * 10) / 10, 5);
    });
  }
});

describe('OSE-1266 outcome preview — RED LINES (born-red)', () => {
  // RL1 — no attendee data: no section is a per-attendee field, at any tier.
  it('RL1: never exposes a per-attendee field', () => {
    for (const tier of ['local', 'mid', 'premium'] as const) {
      const p = buildOutcomePreview(base({ tier }));
      for (const s of p.report_sections) {
        expect(ATTENDEE_KEY.test(s), `section "${s}" looks per-attendee`).toBe(false);
      }
    }
  });

  // RL2 — aggregate-only: every delivered section is in the known aggregate universe.
  it('RL2: report_sections ⊆ aggregate universe (no row-level field)', () => {
    for (const tier of ['local', 'mid', 'premium'] as const) {
      const p = buildOutcomePreview(base({ tier }));
      for (const s of p.report_sections) expect(AGGREGATE_UNIVERSE.has(s)).toBe(true);
    }
  });

  // RL3 — no bought "local": tier NEVER flips is_local; only the geo input does.
  it('RL3: tier cannot buy is_local', () => {
    for (const tier of ['local', 'mid', 'premium'] as const) {
      expect(buildOutcomePreview(base({ tier, isLocal: false })).is_local).toBe(false);
      expect(buildOutcomePreview(base({ tier, isLocal: true })).is_local).toBe(true);
    }
  });

  // RL4 — price never reaches the outcome: an injected price field changes nothing.
  it('RL4: a stray price/amount on the input cannot influence the outcome', () => {
    const clean = buildOutcomePreview(base({ tier: 'premium', isLocal: true }));
    const withPrice = buildOutcomePreview({
      ...base({ tier: 'premium', isLocal: true }),
      // deliberately smuggle payment fields — must be ignored
      amount_cents: 999_99,
      paid: true,
    } as unknown as PreviewInput);
    expect(withPrice).toEqual(clean);
  });

  // RL5 — no position/size/slot in the outcome: only depth + frequency are bought.
  it('RL5: outcome carries no position/size/slot dimension', () => {
    const p = buildOutcomePreview(base({ tier: 'premium' }));
    const keys = Object.keys(p);
    for (const forbidden of ['position', 'size', 'slot', 'rank', 'order', 'price', 'amount']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  // RL7 — local floor holds: with a local present in a busy corridor, the local
  // class keeps ≥ its floor even against a premium-heavy pool.
  it('RL7: local floor (≥30%) holds for a local sponsor vs a premium-heavy pool', () => {
    const pool: RotationSponsor[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      tier: 'premium' as const,
      is_local: false,
    }));
    const p = buildOutcomePreview(
      base({ tier: 'local', sponsorId: 'sp_self', isLocal: true, corridorSponsors: pool })
    );
    // sole local → the whole 30% floor is theirs.
    expect(p.frequency_share_pct).toBeGreaterThanOrEqual(30 - 0.1);
  });
});
