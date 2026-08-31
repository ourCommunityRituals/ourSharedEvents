/**
 * OSE-1138 — Display covenant conformance (Invariant #25).
 *
 * The vision: sponsors are displayed in RANDOM order; what's guaranteed is the
 * is_local FLOOR and the right to buy more VISIBILITY (frequency). Tier buys how
 * OFTEN a sponsor is seen (frequency), never size/slot/position. Order carries no
 * meaning — it's a seeded (deterministic, COST-101) shuffle, not a share ranking.
 *
 * These born-red tests lock the two orthogonal, non-positional axes + the floor:
 *   G1 — seededShuffle: deterministic per seed, a true permutation, actually reorders
 *   G2 — buildWeightedRotation: premium gets MORE slots (bought visibility), every
 *        sponsor ≥ 1 (min-presence), is_local floor held, order not share-desc
 *   G3 — buildSponsorBundle: temporal surface (tvSide) carries frequency; snapshot
 *        surfaces are unique + shuffled; deterministic per event; no share-ranking
 *
 * @born-red invariant#25 | method: covenant-frequency-not-position | date: 2026-08-31
 */

import { describe, test, expect } from 'vitest';
import {
  buildShareRotation,
  buildWeightedRotation,
  seededShuffle,
  buildSponsorBundle,
  type SponsorRow,
} from '../src/lib/sponsor-resolver';

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
    display_token: null,
    is_active: opts.active === false ? 0 : 1,
    is_local: opts.local ? 1 : 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function counts(ids: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const id of ids) m[id] = (m[id] ?? 0) + 1;
  return m;
}

const SEED = 'evt_ose1138';

describe('OSE-1138 G1 — seededShuffle: deterministic + non-positional (COST-101, no RNG)', () => {
  test('deterministic: same seed → identical order', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(seededShuffle(input, SEED)).toEqual(seededShuffle(input, SEED));
  });

  test('is a true permutation — no sponsor lost or duplicated', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect([...seededShuffle(input, SEED)].sort()).toEqual([...input].sort());
  });

  test('actually reorders, and different seeds give different orders', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(seededShuffle(input, 'seed-A')).not.toEqual(input); // not identity
    expect(seededShuffle(input, 'seed-A')).not.toEqual(seededShuffle(input, 'seed-B'));
  });
});

describe('OSE-1138 G2 — buildWeightedRotation: frequency bought, floor held, order random', () => {
  test('premium gets MORE slots than each base — the right to buy more visibility', () => {
    const sponsors = [
      row('prem', 'title'),
      row('b1', 'bronze'),
      row('b2', 'bronze'),
      row('b3', 'bronze'),
      row('b4', 'bronze'),
      row('b5', 'bronze'),
    ];
    const c = counts(buildWeightedRotation(buildShareRotation(sponsors), SEED).map((s) => s.id));
    for (const b of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      expect(c['prem']!, `premium must out-appear ${b}`).toBeGreaterThan(c[b]!);
    }
  });

  test('every active sponsor appears at least once (min-presence — never zeroed)', () => {
    const sponsors = [row('prem', 'title'), row('m1', 'gold'), row('b1', 'bronze')];
    const seq = buildWeightedRotation(buildShareRotation(sponsors), SEED).map((s) => s.id);
    expect(new Set(seq)).toEqual(new Set(['prem', 'm1', 'b1']));
  });

  test('is_local class holds ~30% floor of slots even against a premium non-local', () => {
    const sponsors = [
      row('prem', 'title'), // non-local premium
      row('L1', 'bronze', { local: true }),
      row('L2', 'bronze', { local: true }),
    ];
    const seq = buildWeightedRotation(buildShareRotation(sponsors), SEED).map((s) => s.id);
    const localSlots = seq.filter((id) => id === 'L1' || id === 'L2').length;
    // 30% floor, minus at most one granularity step of integer rounding.
    expect(localSlots / seq.length).toBeGreaterThanOrEqual(0.25);
  });

  test('order is NOT share-desc (no positional prominence), but deterministic per seed', () => {
    const sponsors = [row('prem', 'title'), row('b1', 'bronze'), row('b2', 'bronze')];
    const entries = buildShareRotation(sponsors);
    const shareDesc = entries.map((e) => e.sponsor.id); // premium first
    const seq = buildWeightedRotation(entries, SEED).map((s) => s.id);
    expect(
      buildWeightedRotation(entries, SEED).map((s) => s.id),
      'deterministic'
    ).toEqual(seq);
    expect(seq.slice(0, shareDesc.length), 'not the share-desc ranking').not.toEqual(shareDesc);
  });
});

describe('OSE-1138 G3 — buildSponsorBundle: temporal=frequency, snapshot=unique, all shuffled', () => {
  const sponsors = [
    row('prem', 'title'),
    row('b1', 'bronze'),
    row('b2', 'bronze'),
    row('b3', 'bronze'),
    row('b4', 'bronze'),
    row('b5', 'bronze'),
  ];

  test('tvSide carries frequency (premium repeats); snapshot surfaces are unique', () => {
    const b = buildSponsorBundle(sponsors, SEED);
    expect(counts(b.surface_sponsors.tvSide.map((s) => s.id))['prem']!).toBeGreaterThan(1);
    for (const key of ['posterTop', 'tvTop', 'mobileBanner'] as const) {
      const ids = b.surface_sponsors[key].map((s) => s.id);
      expect(ids.length, `${key} has no duplicates`).toBe(new Set(ids).size);
      expect(new Set(ids)).toEqual(new Set(sponsors.map((s) => s.id)));
    }
  });

  test('deterministic per event seed; different events shuffle differently', () => {
    const a1 = buildSponsorBundle(sponsors, 'evt-A').surface_sponsors.tvSide.map((s) => s.id);
    const a2 = buildSponsorBundle(sponsors, 'evt-A').surface_sponsors.tvSide.map((s) => s.id);
    const c = buildSponsorBundle(sponsors, 'evt-C').surface_sponsors.tvSide.map((s) => s.id);
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(c);
  });

  test('no positional prominence: top-level order is shuffled-unique, not share-desc', () => {
    const shareDesc = buildShareRotation(sponsors).map((e) => e.sponsor.id);
    const bundleOrder = buildSponsorBundle(sponsors, SEED).sponsors.map((s) => s.id);
    expect(new Set(bundleOrder)).toEqual(new Set(shareDesc)); // same set
    expect(bundleOrder, 'shuffled, not share-ranked').not.toEqual(shareDesc);
  });
});
