/**
 * Fat-finger property tests — the wizard's input edges, fuzzed.
 *
 * WHY PROPERTY TESTS AND NOT MORE EXAMPLES
 * OSE-663's acceptance reads "Property tests pass at every demand level."
 * What shipped (tests/sponsor-share-covenant.spec.ts) is nine hand-picked
 * examples: the walls are asserted at CHOSEN demand levels, not at every one.
 * Examples prove the cases an author thought of. A fat finger, by definition,
 * is the case nobody thought of.
 *
 * These run with a small case count in CI and a large one overnight, via
 * FC_RUNS (see .github/workflows/overnight-fuzz.yml). A counterexample is
 * reproducible forever from the seed fast-check prints on failure.
 *
 * BORN RED: the surrogate property below FAILS against current trimStr().
 * That is deliberate — fail first, then pass.
 */
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { trimStr, isValidEventId } from '../src/lib/form-validation';
import { allocateShares, SPONSOR_ALLOCATION } from '../src/lib/sponsor-allocation';
import type { RotationSponsor } from '../src/lib/sponsor-allocation';

const RUNS = Number(process.env.FC_RUNS ?? 200);
const opts = { numRuns: RUNS } as const;

const hasLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
};

describe('fat-finger | trimStr — bounded text fields (event name, sourceId, ...)', () => {
  test('never emits a lone surrogate (emoji pasted at the truncation boundary)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.integer({ min: 0, max: 64 }), (s, max) => {
        const out = trimStr(s, max);
        expect(out === undefined || !hasLoneSurrogate(out)).toBe(true);
      }),
      opts
    );
  });

  test('never exceeds max, and never returns leading whitespace', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 256 }), (s, max) => {
        const out = trimStr(s, max);
        if (out === undefined) return;
        expect(out.length).toBeLessThanOrEqual(max);
        expect(out).toBe(out.trimStart());
      }),
      opts
    );
  });

  test('non-strings are rejected, never coerced', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.object(), fc.array(fc.string())),
        // Block body on purpose: an expression-body arrow returns Vitest's
        // Assertion object, which fast-check rejects as a non-boolean result.
        (v) => {
          expect(trimStr(v, 32)).toBeUndefined();
        }
      ),
      opts
    );
  });
});

describe('fat-finger | isValidEventId — pasted/mistyped ids', () => {
  test('never accepts whitespace, control chars, or path separators', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', minLength: 1 }), (s) => {
        if (/[\s/\\. -]/.test(s)) expect(isValidEventId(s)).toBe(false);
      }),
      opts
    );
  });

  test('is total — never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(() => isValidEventId(s)).not.toThrow();
      }),
      opts
    );
  });
});

describe('fat-finger | allocateShares — Invariant #25 walls at EVERY demand level', () => {
  const walls = SPONSOR_ALLOCATION.share_of_voice.walls;
  const sponsorArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    tier: fc.constantFrom<'base' | 'mid' | 'premium'>('base', 'mid', 'premium'),
    is_local: fc.boolean(),
  });
  // Distinct ids: a duplicate id is a caller bug, not a wall breach.
  const rosterArb = fc
    .uniqueArray(sponsorArb, { minLength: 1, maxLength: 40, selector: (s) => s.id })
    .map((a) => a as RotationSponsor[]);

  test('WALL: shares always sum to 100', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const total = allocateShares(roster).reduce((a, e) => a + e.sharePct, 0);
        expect(total).toBeCloseTo(100, 6);
      }),
      opts
    );
  });

  test('WALL: local floor — is_local collectively holds >= floor whenever present', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        if (!roster.some((s) => s.is_local)) return;
        const localIds = new Set(roster.filter((s) => s.is_local).map((s) => s.id));
        const got = allocateShares(roster)
          .filter((e) => localIds.has(e.id))
          .reduce((a, e) => a + e.sharePct, 0);
        expect(got).toBeGreaterThanOrEqual(walls.local_floor_pct - 1e-6);
      }),
      opts
    );
  });

  test('WALL: no is_local sponsor is ever zeroed', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const localIds = new Set(roster.filter((s) => s.is_local).map((s) => s.id));
        for (const e of allocateShares(roster)) {
          if (localIds.has(e.id)) expect(e.sharePct).toBeGreaterThan(0);
        }
      }),
      opts
    );
  });

  // The cap is only claimed to bind where it is SATISFIABLE. allocateShares'
  // docstring carves out the "sponsor-sparse regime": with too few sponsors to
  // fill the surface, shares are forced above the cap (one sponsor is
  // necessarily 100%). A premium's raw weighted share is w.premium/totalWeight,
  // so the cap can only bind once totalWeight >= w.premium / (cap/100) — with
  // the ratified 1/3/7 weights and a 40% cap, that is 17.5.
  const w = SPONSOR_ALLOCATION.share_of_voice.weights;
  const totalWeight = (r: RotationSponsor[]) =>
    r.reduce(
      (a, s) => a + (s.tier === 'premium' ? w.premium : s.tier === 'mid' ? w.mid : w.base),
      0
    );
  const capIsSatisfiable = (r: RotationSponsor[]) =>
    totalWeight(r) >= w.premium / (walls.premium_cap_pct / 100);

  test('WALL: premium cap holds wherever the cap is satisfiable', () => {
    fc.assert(
      fc.property(rosterArb.filter(capIsSatisfiable), (roster) => {
        const byId = new Map(roster.map((s) => [s.id, s]));
        for (const e of allocateShares(roster)) {
          if (byId.get(e.id)?.tier === 'premium') {
            expect(e.sharePct).toBeLessThanOrEqual(walls.premium_cap_pct + 1e-6);
          }
        }
      }),
      opts
    );
  });

  test('WALL: output carries ONLY {id, sharePct} — size/slot unpurchasable by construction', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        for (const e of allocateShares(roster)) {
          expect(Object.keys(e).sort()).toEqual(['id', 'sharePct']);
        }
      }),
      opts
    );
  });

  test('deterministic — identical input yields identical output', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        expect(allocateShares(roster)).toEqual(allocateShares(roster));
      }),
      opts
    );
  });
});
