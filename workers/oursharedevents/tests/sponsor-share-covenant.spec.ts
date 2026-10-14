/**
 * INVARIANT #25 — Sponsor Share Covenant (behavioral / property-based).
 *
 * Enforcement half of brain Invariant #25 `sponsor_share_covenant`. Tests the
 * PURE allocateShares() function (src/lib/sponsor-allocation.ts, OSE-663)
 * against the three walls at many demand levels:
 *   WALL 1 — premium cap: no premium/mid share exceeds its cap (where satisfiable)
 *   WALL 2 — local floor: is_local class collectively >= local_floor_pct
 *   WALL 3 — uniform size/slot: the function returns ONLY frequency (no size/slot)
 * plus Σ=100, demand-driven compression, and fail-closed behavior.
 *
 * BORN-RED (per Invariant #23): the cap/floor properties are demonstrated to
 * CATCH a violation — a naive allocator that ignores the caps breaches WALL 1,
 * and the same assertion that passes for allocateShares() fails for it. A test
 * that can never go red proves nothing; this one is shown red-capable in-suite.
 *
 * Structural companion (code-shape lock): tests/e2e/0-architecture/
 * sponsor-share-covenant.invariant.spec.ts.
 *
 * @born-red invariant#25 | method: design-time-negative-assertion | date: 2026-08-07
 */

import { describe, test, expect } from 'vitest';
import {
  allocateShares,
  SPONSOR_ALLOCATION,
  type RotationSponsor,
  type ShareAllocation,
} from '../src/lib/sponsor-allocation';

const WALLS = SPONSOR_ALLOCATION.share_of_voice.walls;
const CAP = WALLS.premium_cap_pct; // 40
const MID_CAP = WALLS.mid_cap_pct; // 20
const FLOOR = WALLS.local_floor_pct; // 30
const TOL = 1e-6;

// ─── Fixtures across demand levels (deterministic, no RNG) ──────────────────

function make(n: number, spec: (i: number) => Partial<RotationSponsor>): RotationSponsor[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    tier: 'base',
    is_local: false,
    ...spec(i),
  }));
}

/** A healthy mix where the cap is satisfiable: premiums + mids + base + locals. */
function mixedDemand(premium: number, mid: number, base: number, local: number): RotationSponsor[] {
  const out: RotationSponsor[] = [];
  let k = 0;
  for (let i = 0; i < premium; i++) out.push({ id: `p${k++}`, tier: 'premium', is_local: false });
  for (let i = 0; i < mid; i++) out.push({ id: `m${k++}`, tier: 'mid', is_local: false });
  for (let i = 0; i < base; i++) out.push({ id: `b${k++}`, tier: 'base', is_local: false });
  for (let i = 0; i < local; i++) out.push({ id: `l${k++}`, tier: 'base', is_local: true });
  return out;
}

const sum = (a: ShareAllocation[]) => a.reduce((x, e) => x + e.sharePct, 0);
const byId = (a: ShareAllocation[]) => Object.fromEntries(a.map((e) => [e.id, e.sharePct]));

// Demand levels where the cap is satisfiable (enough sponsors to absorb the pool).
const SATISFIABLE = [
  mixedDemand(1, 1, 1, 1),
  mixedDemand(2, 2, 2, 2),
  mixedDemand(3, 3, 3, 3),
  mixedDemand(2, 3, 4, 3),
  mixedDemand(1, 2, 5, 2),
  mixedDemand(4, 4, 4, 4),
];

describe('Invariant #25 | WALL 1 — premium cap holds at satisfiable demand', () => {
  test.each(SATISFIABLE.map((s, i) => [i, s] as const))(
    'demand set %i: no premium > CAP, no mid > MID_CAP',
    (_i, sponsors) => {
      const shares = byId(allocateShares(sponsors));
      for (const s of sponsors) {
        if (s.tier === 'premium') expect(shares[s.id]).toBeLessThanOrEqual(CAP + TOL);
        if (s.tier === 'mid') expect(shares[s.id]).toBeLessThanOrEqual(MID_CAP + TOL);
      }
    }
  );
});

describe('Invariant #25 | WALL 2 — local floor holds at every demand level', () => {
  test.each(SATISFIABLE.map((s, i) => [i, s] as const))(
    'demand set %i: is_local class collectively >= FLOOR',
    (_i, sponsors) => {
      const shares = byId(allocateShares(sponsors));
      const localTotal = sponsors.filter((s) => s.is_local).reduce((x, s) => x + shares[s.id], 0);
      expect(localTotal).toBeGreaterThanOrEqual(FLOOR - TOL);
    }
  );

  // @born-red TL-080 | method: deliberate-fixture-break | date: 2026-10-13
  test('a single local among many premiums is never crowded below the floor', () => {
    const sponsors = mixedDemand(8, 0, 0, 1); // 8 premium, 1 local
    const shares = byId(allocateShares(sponsors));
    expect(shares['l8']).toBeGreaterThanOrEqual(FLOOR - TOL);
  });
});

describe('Invariant #25 | WALL 3 — uniform size/slot (frequency only)', () => {
  test('allocateShares returns ONLY {id, sharePct} — no size/slot/position field', () => {
    const shares = allocateShares(mixedDemand(2, 2, 2, 2));
    for (const s of shares) {
      expect(Object.keys(s).sort()).toEqual(['id', 'sharePct']);
    }
  });
});

describe('Invariant #25 | conservation — shares sum to 100', () => {
  test.each([...SATISFIABLE, make(20, (i) => ({ tier: i % 3 === 0 ? 'premium' : 'base', is_local: i % 4 === 0 }))].map((s, i) => [i, s] as const))(
    'demand set %i: sum(sharePct) === 100',
    (_i, sponsors) => {
      expect(sum(allocateShares(sponsors))).toBeCloseTo(100, 4);
    }
  );
});

describe('Invariant #25 | demand-driven — premium compresses as demand rises', () => {
  test('the same premium sponsor holds a SMALLER share when more sponsors want in', () => {
    const few = allocateShares(mixedDemand(1, 1, 1, 1)); // premium among 4
    const many = allocateShares(mixedDemand(1, 3, 6, 4)); // same 1 premium among 14
    const pFew = byId(few)['p0'];
    const pMany = byId(many)['p0'];
    expect(pMany).toBeLessThan(pFew); // fewer sponsors → higher %, exactly as observed
  });
});

describe('Invariant #25 | fail-closed + edges', () => {
  test('unknown tier throws (fail-closed)', () => {
    const bad = [{ id: 'x', tier: 'diamond' as unknown as 'premium', is_local: false }];
    expect(() => allocateShares(bad)).toThrow(/unknown sponsor tier/i);
  });

  test('empty input → empty allocation', () => {
    expect(allocateShares([])).toEqual([]);
  });

  test('single sponsor → 100% (cap is moot; you cannot show a fraction of one)', () => {
    expect(allocateShares([{ id: 'solo', tier: 'premium', is_local: false }])).toEqual([
      { id: 'solo', sharePct: 100 },
    ]);
  });

  test('no locals → floor releases; weights govern the whole 100%', () => {
    const shares = allocateShares(mixedDemand(2, 2, 4, 0));
    expect(sum(shares)).toBeCloseTo(100, 4);
    // premiums still capped
    expect(byId(shares)['p0']).toBeLessThanOrEqual(CAP + TOL);
  });

  test('determinism — same input yields identical output', () => {
    const s = mixedDemand(3, 3, 3, 3);
    expect(allocateShares(s)).toEqual(allocateShares(s));
  });
});

// ─── BORN-RED: prove the cap assertion has teeth ────────────────────────────
// A naive allocator that ignores the caps MUST breach WALL 1 on the same
// fixture where allocateShares() holds it. If this "red" allocator ever
// satisfied the cap, the WALL-1 test above would be vacuous.
function naiveNoCap(sponsors: RotationSponsor[]): ShareAllocation[] {
  const w = SPONSOR_ALLOCATION.share_of_voice.weights;
  const weightOf = (t: RotationSponsor['tier']) =>
    t === 'premium' ? w.premium : t === 'mid' ? w.mid : w.base;
  const W = sponsors.reduce((a, s) => a + weightOf(s.tier), 0);
  return sponsors.map((s) => ({ id: s.id, sharePct: (100 * weightOf(s.tier)) / W }));
}

describe('Invariant #25 | born-red — the cap test catches a real violation', () => {
  test('naive (no-cap) allocator BREACHES the premium cap — proving the guard is red-capable', () => {
    const sponsors = mixedDemand(1, 1, 1, 0); // 1 premium among 3 → weight 7/11 ≈ 63.6%
    const naive = byId(naiveNoCap(sponsors));
    expect(naive['p0']).toBeGreaterThan(CAP); // the violation the wall exists to stop
    // …and the real allocator holds the same fixture at/under the cap:
    const real = byId(allocateShares(sponsors));
    expect(real['p0']).toBeLessThanOrEqual(CAP + TOL);
  });
});
