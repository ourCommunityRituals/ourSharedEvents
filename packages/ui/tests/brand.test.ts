import { describe, it, expect } from 'vitest';
import { semanticDark } from '../src/tokens';
import { BRAND_CUSTOMIZABLE, BRAND_LOCKED, DESIGNATION, validateBrandOverride } from '../src/brand';

// OSE-1328 white-label ADR — the token designation + the locked-override gate.
describe('white-label token designation', () => {
  it('classifies EVERY semantic token exactly once — none un-designated, none in both', () => {
    const semantic = Object.keys(semanticDark).sort();
    const designated = [...BRAND_CUSTOMIZABLE, ...BRAND_LOCKED].sort();
    // completeness: the designation covers exactly the semantic token set
    expect(designated).toEqual(semantic);
    // disjoint: no token is both customizable and locked
    expect(new Set(designated).size).toBe(designated.length);
  });

  it('every DESIGNATION entry resolves to customizable | locked', () => {
    for (const v of Object.values(DESIGNATION)) {
      expect(['customizable', 'locked']).toContain(v);
    }
  });
});

describe('validateBrandOverride() — the locked-override gate', () => {
  it('accepts a brand override on a customizable token (empty violations)', () => {
    expect(validateBrandOverride({ '--accent': '#7B3FE4', '--surface': '#101418' })).toEqual([]);
  });

  it('rejects a LOCKED token (safety/semantic colors can never be branded)', () => {
    expect(validateBrandOverride({ '--danger': '#00FF00' })).toEqual([
      { token: '--danger', reason: 'locked' },
    ]);
    expect(validateBrandOverride({ '--live': '#FF0000' })).toEqual([
      { token: '--live', reason: 'locked' },
    ]);
  });

  it('rejects an unknown token', () => {
    expect(validateBrandOverride({ '--made-up': '#123456' })).toEqual([
      { token: '--made-up', reason: 'unknown' },
    ]);
  });

  it('reports every violation in a mixed set, passing the customizable one through', () => {
    const v = validateBrandOverride({
      '--accent': '#7B3FE4', // ok
      '--warn': '#0000FF', // locked
      '--nope': '#fff', // unknown
    });
    expect(v).toHaveLength(2);
    expect(v).toContainEqual({ token: '--warn', reason: 'locked' });
    expect(v).toContainEqual({ token: '--nope', reason: 'unknown' });
  });
});
