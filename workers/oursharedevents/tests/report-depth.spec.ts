/**
 * OSE-459 — Land lib/report-depth.ts (S-3.1.1)
 *
 * 8 unit tests for resolveDepth() and filterReportByDepth() covering the
 * six categories from the AC: roles, legacy default, scoping, fail-closed,
 * additive ladder, equity-by-construction.
 *
 * Invariant #5 (tier_equity) read side: depth filtering is by OMISSION only.
 * No value is ever transformed, rounded, or degraded per tier.
 */

import { describe, it, expect } from 'vitest';
import { resolveDepth, filterReportByDepth, DEPTH_SECTIONS } from '../src/lib/report-depth';

const SAMPLE_REPORT = {
  event_id: 'evt_test',
  event_title: 'Test Event',
  event_start_date: '2026-06-01T18:00:00Z',
  event_end_date: '2026-06-01T22:00:00Z',
  unique_gatherings: 99,
  sponsor_impressions: [
    { sponsor_id: 'sp_A', impressions: 200 },
    { sponsor_id: 'sp_B', impressions: 75 },
  ],
  poster_attribution: { views: 500, scans: 100 },
  return_rate: 0.42,
  corridor_density: [{ cell: '89266454447ffff', count: 20 }],
  headcount_trend: [{ date: '2026-06-01', count: 99 }],
  _meta: { built_at: '2026-07-28T00:00:00Z' },
} as const;

describe('OSE-459: report-depth — resolveDepth (roles + legacy + fail-closed)', () => {
  it('roles: admin resolves to premium with no sponsor scope', () => {
    const r = resolveDepth({ role: 'admin' });
    expect(r.depth).toBe('premium');
    expect(r.sponsorScope).toBeNull();
  });

  it('roles: bar_owner resolves to premium (organizer always gets full view)', () => {
    const r = resolveDepth({ role: 'bar_owner' });
    expect(r.depth).toBe('premium');
    expect(r.sponsorScope).toBeNull();
  });

  it('legacy default: sponsor with no depth claim defaults to local', () => {
    const r = resolveDepth({ role: 'sponsor' });
    expect(r.depth).toBe('local');
    expect(r.sponsorScope).toBeNull();
  });

  it('fail-closed: sponsor with garbage depth falls back to local, never crashes', () => {
    const r = resolveDepth({ role: 'sponsor', depth: 'superstar' });
    expect(r.depth).toBe('local');
  });

  it('scoping: sponsor with valid depth + sponsor_id carries scope through', () => {
    const r = resolveDepth({ role: 'sponsor', depth: 'mid', sponsor_id: 'sp_A' });
    expect(r.depth).toBe('mid');
    expect(r.sponsorScope).toBe('sp_A');
  });
});

describe('OSE-459: report-depth — filterReportByDepth (additive ladder + equity-by-construction)', () => {
  it('additive ladder: every local section is present in mid', () => {
    const localSet = new Set(DEPTH_SECTIONS.local);
    for (const section of localSet) {
      expect(
        DEPTH_SECTIONS.mid,
        `mid must include all local sections — missing "${section}"`
      ).toContain(section);
    }
  });

  it('additive ladder: every mid section is present in premium', () => {
    const midSet = new Set(DEPTH_SECTIONS.mid);
    for (const section of midSet) {
      expect(
        DEPTH_SECTIONS.premium,
        `premium must include all mid sections — missing "${section}"`
      ).toContain(section);
    }
  });

  it('equity-by-construction: premium tier passes all numeric values identically', () => {
    const resolved = resolveDepth({ role: 'admin' });
    const { report, upgrade } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    // Omission-only: no values are transformed
    expect(report.unique_gatherings).toBe(99);
    expect(report.return_rate).toBe(0.42);
    expect(report.headcount_trend).toEqual(SAMPLE_REPORT.headcount_trend);
    expect(report.corridor_density).toEqual(SAMPLE_REPORT.corridor_density);
    // Premium is the top tier — no upgrade hint
    expect(upgrade).toBeNull();
  });
});
