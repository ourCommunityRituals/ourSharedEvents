/**
 * OSE-661 — covenant share rotation seam (Invariant #25).
 *
 * Tests the additive buildShareRotation() path + the 6→3 tier map (sovTierOf),
 * the single covenant seam both the renderer and the admin form consume. The
 * walls (cap, local floor, uniform size/slot, Σ=100) are proven THROUGH this
 * adapter, not just in allocateShares directly — so a regression in the mapping
 * or the active-filter is caught here.
 *
 * @born-red invariant#25 | method: covenant-walls-through-the-seam | date: 2026-08-08
 */

import { describe, test, expect } from 'vitest';
import { buildShareRotation, type SponsorRow } from '../src/lib/sponsor-resolver';
import { sovTierOf, SPONSOR_ALLOCATION } from '../src/lib/sponsor-allocation';

function row(
  id: string,
  tier: string,
  opts: { local?: boolean; active?: boolean } = {}
): SponsorRow {
  return {
    id,
    event_id: 'e',
    name: id,
    logo_url: null,
    website_url: null,
    tier,
    placement_formats: '{}',
    click_token: null,
    impression_token: null,
    is_active: opts.active === false ? 0 : 1,
    is_local: opts.local ? 1 : 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

const WALLS = SPONSOR_ALLOCATION.share_of_voice.walls;

describe('OSE-661 — sovTierOf: ratified 6→3 tier map (single source of truth)', () => {
  test('premium = {title, platinum}', () => {
    expect(sovTierOf('title')).toBe('premium');
    expect(sovTierOf('platinum')).toBe('premium');
  });
  test('mid = {gold, silver}', () => {
    expect(sovTierOf('gold')).toBe('mid');
    expect(sovTierOf('silver')).toBe('mid');
  });
  test('base = {bronze, primary}', () => {
    expect(sovTierOf('bronze')).toBe('base');
    expect(sovTierOf('primary')).toBe('base');
  });
  test('case-insensitive; unknown/empty → base (fail-safe, never premium)', () => {
    expect(sovTierOf('TITLE')).toBe('premium');
    expect(sovTierOf('mystery')).toBe('base');
    expect(sovTierOf('')).toBe('base');
  });
});

describe('OSE-661 — buildShareRotation covenant walls', () => {
  test('only active sponsors participate', () => {
    const r = buildShareRotation([row('a', 'gold'), row('b', 'gold', { active: false })]);
    expect(r.map((e) => e.sponsor.id)).toEqual(['a']);
  });

  test('empty / all-inactive → no rotation', () => {
    expect(buildShareRotation([])).toEqual([]);
    expect(buildShareRotation([row('x', 'gold', { active: false })])).toEqual([]);
  });

  test('Σ shares == 100 (WALL: full allocation)', () => {
    const r = buildShareRotation([
      row('t', 'title'),
      row('g', 'gold'),
      row('b', 'bronze'),
      row('p', 'primary', { local: true }),
    ]);
    const sum = r.reduce((a, e) => a + e.sharePct, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  test('WALL 1 — premium cap holds when satisfiable (enough sponsors)', () => {
    // Many sponsors so the cap is binding, not the sparse regime.
    const sponsors = [
      row('prem', 'title'),
      row('m1', 'gold'),
      row('m2', 'silver'),
      row('b1', 'bronze'),
      row('b2', 'primary'),
      row('b3', 'bronze'),
    ];
    const r = buildShareRotation(sponsors);
    const prem = r.find((e) => e.sponsor.id === 'prem')!;
    expect(prem.sharePct).toBeLessThanOrEqual(WALLS.premium_cap_pct + 1e-6);
  });

  test('WALL 2 — local floor: the is_local class holds >= local_floor_pct', () => {
    const sponsors = [
      row('prem', 'title'),
      row('prem2', 'platinum'),
      row('loc', 'primary', { local: true }),
    ];
    const r = buildShareRotation(sponsors);
    const localShare = r
      .filter((e) => e.sponsor.is_local === 1)
      .reduce((a, e) => a + e.sharePct, 0);
    expect(localShare).toBeGreaterThanOrEqual(WALLS.local_floor_pct - 1e-6);
  });

  test('WALL 3 — uniform size/slot: a RotationEntry exposes ONLY frequency, no size/slot field', () => {
    const [entry] = buildShareRotation([row('a', 'gold'), row('b', 'bronze')]);
    expect(Object.keys(entry)).toEqual(['sponsor', 'sharePct']);
    // No size/slot/position/placement key is purchasable on the entry.
    expect(entry).not.toHaveProperty('slot');
    expect(entry).not.toHaveProperty('size');
    expect(entry).not.toHaveProperty('position');
  });

  test('deterministic order by share desc (order carries no size meaning, just rotation sequence)', () => {
    const r = buildShareRotation([row('b', 'bronze'), row('t', 'title'), row('g', 'gold')]);
    const shares = r.map((e) => e.sharePct);
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i - 1]).toBeGreaterThanOrEqual(shares[i]!);
    }
  });

  // Regression guard for the covenant-rotation determinism gap: equal-share
  // sponsors (the floor splits evenly across locals, equal-weight tiers
  // water-fill equally) must order by a stable id tie-break, NOT by input /
  // D1 row order. Born-red: without the id tie-break in buildShareRotation the
  // sort is stable-by-input, so `forward` and `reversed` return DIFFERENT orders
  // and neither equals the id-sorted expectation below.
  test('equal-share sponsors get a stable id tie-break, independent of input order', () => {
    // Three base non-locals → identical sharePct (no local floor, equal weights).
    const forward = buildShareRotation([
      row('z', 'bronze'),
      row('a', 'bronze'),
      row('m', 'bronze'),
    ]);
    const reversed = buildShareRotation([
      row('m', 'bronze'),
      row('a', 'bronze'),
      row('z', 'bronze'),
    ]);

    // All three shares are equal, so ordering is decided purely by the id tie-break.
    const shares = forward.map((e) => e.sharePct);
    expect(shares[0]).toBeCloseTo(shares[2]!, 6); // confirm it really is a tie

    expect(forward.map((e) => e.sponsor.id)).toEqual(['a', 'm', 'z']);
    expect(reversed.map((e) => e.sponsor.id)).toEqual(['a', 'm', 'z']);
  });
});
