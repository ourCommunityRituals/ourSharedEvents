/**
 * OSE-581 — Geo encoding invariant: close conformance gap on #2 (hyperlocal_geo_resolution)
 *
 * Invariant #2 claims all H3 encoding uses exactly two resolutions:
 *   res 9  (NODE_RES)     ≈ 0.1 km² — venue-level granularity
 *   res 7  (CORRIDOR_RES) ≈ 5 km²   — corridor/reporting granularity
 *
 * TL-045: Geo coordinate stored at wrong H3 resolution
 *
 * Gates:
 *   G1 — NODE_RES export equals 9
 *   G2 — CORRIDOR_RES export equals 7
 *   G3 — tagCoordinates returns valid H3 cells at both resolutions
 *   G4 — tagsConsistent: res9 cell's parent at res7 = stored res7
 *   G5 — Static: latLngToCell never called with a literal resolution other than NODE_RES/CORRIDOR_RES
 *   G6 — maybeTag returns null on null coords (no phantom encoding)
 */

import { describe, test, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { NODE_RES, CORRIDOR_RES, tagCoordinates, tagsConsistent, maybeTag } from '../src/lib/h3-tagging';

interface TestEnv {
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

function loadSources(): Record<string, string> {
  return JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

// Known venue coordinates — Chicago Southside
const VENUE_LAT = 41.831;
const VENUE_LON = -87.629;

describe('OSE-581 G1/G2 — TL-045: H3 resolution constants are exactly node=9, corridor=7', () => {
  // @born-red TL-045 | method: design-time-negative-assertion | date: 2026-08-03
  test('NODE_RES is 9 (venue-level granularity ~0.1 km²)', () => {
    expect(NODE_RES).toBe(9);
  });

  // @born-red TL-045 | method: design-time-negative-assertion | date: 2026-08-03
  test('CORRIDOR_RES is 7 (corridor-level granularity ~5 km²)', () => {
    expect(CORRIDOR_RES).toBe(7);
  });

  test('NODE_RES and CORRIDOR_RES are distinct (no aliasing)', () => {
    expect(NODE_RES).not.toBe(CORRIDOR_RES);
  });
});

describe('OSE-581 G3/G4 — tagCoordinates produces valid, consistent H3 cells', () => {
  // @born-red TL-045 | method: design-time-negative-assertion | date: 2026-08-03
  test('tagCoordinates returns 15-char H3 index for h3_res9 (known venue)', () => {
    const tags = tagCoordinates(VENUE_LAT, VENUE_LON);
    expect(typeof tags.h3_res9).toBe('string');
    // H3 indices are 15 hex characters
    expect(tags.h3_res9).toHaveLength(15);
    expect(tags.h3_res9).toMatch(/^[0-9a-f]{15}$/);
  });

  // @born-red TL-045 | method: design-time-negative-assertion | date: 2026-08-03
  test('tagCoordinates returns 15-char H3 index for h3_res7 (known venue)', () => {
    const tags = tagCoordinates(VENUE_LAT, VENUE_LON);
    expect(typeof tags.h3_res7).toBe('string');
    expect(tags.h3_res7).toHaveLength(15);
    expect(tags.h3_res7).toMatch(/^[0-9a-f]{15}$/);
  });

  test('res9 cell is spatially contained within res7 cell (parent relationship)', () => {
    const tags = tagCoordinates(VENUE_LAT, VENUE_LON);
    expect(tagsConsistent(tags)).toBe(true);
  });

  test('tagCoordinates throws on invalid lat/lon (no phantom encoding)', () => {
    expect(() => tagCoordinates(999, 0)).toThrow('invalid coordinates');
    expect(() => tagCoordinates(0, 999)).toThrow('invalid coordinates');
    expect(() => tagCoordinates(NaN, 0)).toThrow('invalid coordinates');
  });

  test('tagsConsistent rejects mismatched cells', () => {
    // Fabricate inconsistent tags (different venue)
    const tagsA = tagCoordinates(VENUE_LAT, VENUE_LON);
    const tagsB = tagCoordinates(40.712, -74.006); // NYC
    const inconsistent = { h3_res9: tagsA.h3_res9, h3_res7: tagsB.h3_res7 };
    expect(tagsConsistent(inconsistent)).toBe(false);
  });
});

describe('OSE-581 G5 — Static gate: no wildcard H3 resolution calls in source', () => {
  // @born-red TL-045 | method: design-time-negative-assertion | date: 2026-08-03
  test('h3-tagging.ts only calls latLngToCell with NODE_RES or CORRIDOR_RES (no literal resolution numbers)', () => {
    const sources = loadSources();
    const taggingKey = Object.keys(sources).find((k) =>
      normalizePath(k).includes('lib/h3-tagging')
    );
    expect(taggingKey, 'h3-tagging.ts must be in TEST_SOURCE_FILES_JSON').toBeDefined();
    const src = sources[taggingKey!]!;

    // All latLngToCell calls must use a named constant (NODE_RES or CORRIDOR_RES)
    // — not a literal number as the third argument
    const literalResolutionCalls = src.match(/latLngToCell\([^)]+,\s*\d+\s*\)/g) ?? [];
    expect(
      literalResolutionCalls,
      `latLngToCell must not be called with a literal resolution number: ${literalResolutionCalls.join(', ')}`
    ).toHaveLength(0);
  });

  test('no source file calls latLngToCell with resolutions other than 9 or 7', () => {
    const sources = loadSources();
    const violations: string[] = [];
    const FORBIDDEN_RESOLUTIONS = /latLngToCell\([^)]+,\s*(?!9\b|7\b)\d+\s*\)/g;

    for (const [path, src] of Object.entries(sources)) {
      const matches = src.match(FORBIDDEN_RESOLUTIONS) ?? [];
      if (matches.length > 0) {
        violations.push(`${normalizePath(path)}: ${matches.join(', ')}`);
      }
    }

    expect(
      violations,
      `These files call latLngToCell with an unlisted resolution: ${violations.join(' | ')}`
    ).toHaveLength(0);
  });
});

describe('OSE-581 G6 — maybeTag null safety', () => {
  test('maybeTag returns null when lat is null', () => {
    expect(maybeTag(null, VENUE_LON)).toBeNull();
  });

  test('maybeTag returns null when lon is null', () => {
    expect(maybeTag(VENUE_LAT, null)).toBeNull();
  });

  test('maybeTag returns valid tags when both coords present', () => {
    const tags = maybeTag(VENUE_LAT, VENUE_LON);
    expect(tags).not.toBeNull();
    expect(tags!.h3_res9).toHaveLength(15);
    expect(tags!.h3_res7).toHaveLength(15);
  });

  test('OSE-581 evidence', () => {
    const report = {
      story: 'OSE-581',
      threats_covered: ['TL-045'],
      invariant: 2,
      node_res: NODE_RES,
      corridor_res: CORRIDOR_RES,
      date: '2026-08-03',
    };
    console.log(`[OSE-581-EVIDENCE] ${JSON.stringify(report)}`);
    expect(report.node_res).toBe(9);
    expect(report.corridor_res).toBe(7);
  });
});
