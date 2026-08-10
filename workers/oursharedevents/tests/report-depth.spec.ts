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

  // OSE-682 (ratified 2026-08-10): the visible map is the PAID value line.
  // Free (local) = honest smoke test (headcount + own impressions), no map.
  // Both paid tiers (mid + premium) get corridor_map; premium differs by a
  // couple extra features (cross-event) + top governance covenant share.
  it('OSE-682: corridor_map is the paid value line — Mid + Premium, never free', () => {
    expect(DEPTH_SECTIONS.local, 'free must NOT get the map').not.toContain('corridor_map');
    expect(DEPTH_SECTIONS.mid, 'Mid (paid) gets the map').toContain('corridor_map');
    expect(DEPTH_SECTIONS.premium, 'Premium (paid) gets the map').toContain('corridor_map');
    // Free stays honest-essential, not crippled: it keeps the smoke-test basics.
    expect(DEPTH_SECTIONS.local).toContain('unique_gatherings');
    expect(DEPTH_SECTIONS.local).toContain('sponsor_impressions');
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

  // OSE-595 — TL-056 born-red: sponsor token without sponsor_id must not leak
  // competitor impression data. Pre-fix, sponsorScope=null fell through to the
  // else branch and returned all rows to any bearer of a scopeless sponsor token.

  // @born-red TL-056 | method: deliberate-fixture-break | date: 2026-08-03
  it('sponsor token without sponsor_id receives empty sponsor_impressions (no cross-competitor leak)', () => {
    // Resolve as sponsor role with no sponsor_id — simulates a legacy or
    // carelessly-minted sponsor token that omitted the sponsor_id claim.
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local' });
    expect(resolved.sponsorScope).toBeNull();
    expect(resolved.sponsorScopeRequired).toBe(true);

    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    // Must be empty — not [sp_A, sp_B]
    expect(report.sponsor_impressions).toEqual([]);
  });

  // @born-red TL-056 | method: deliberate-fixture-break | date: 2026-08-03
  it('admin token with null sponsorScope still receives all sponsor rows', () => {
    // Admin sees cross-sponsor intelligence — null scope here means "no filter"
    const resolved = resolveDepth({ role: 'admin' });
    expect(resolved.sponsorScope).toBeNull();
    expect(resolved.sponsorScopeRequired).toBe(false);

    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(Array.isArray(report.sponsor_impressions)).toBe(true);
    expect((report.sponsor_impressions as unknown[]).length).toBe(2);
  });

  // @born-red TL-056 | method: deliberate-fixture-break | date: 2026-08-03
  it('scoped sponsor token receives only own rows, not competitor rows', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    expect(resolved.sponsorScope).toBe('sp_A');

    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    const rows = report.sponsor_impressions as Array<{ sponsor_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sponsor_id).toBe('sp_A');
  });
});

// TL-010 | Depth escalation guard
//
// Threat: "Depth escalation: local-depth signed-link token used to request
// premium-depth SharedReport fields"
// Target: Invariant #21 — shared_report_schema_stability
// Mitigation: resolveDepth() caps sponsor depth at SPONSOR_MAX (mid);
//             filterReportByDepth() strips fields not in the resolved tier.

// @born-red TL-010 | method: design-time-negative-assertion | date: 2026-08-06
describe('TL-010 | Depth escalation guard — resolveDepth caps + filterReportByDepth strips', () => {
  it('sponsor cannot self-grant premium depth — premium claim is capped to local (SPONSOR_MAX = mid)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'premium', sponsor_id: 'sp_A' });
    expect(resolved.depth).toBe('local');
    expect(resolved.sponsorScopeRequired).toBe(true);
  });

  it('sponsor mid claim is accepted (within SPONSOR_MAX)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'mid', sponsor_id: 'sp_A' });
    expect(resolved.depth).toBe('mid');
  });

  it('local depth strips mid-tier fields (poster_attribution, return_rate, corridor_density)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(report.poster_attribution).toBeUndefined();
    expect(report.return_rate).toBeUndefined();
    expect(report.corridor_density).toBeUndefined();
  });

  it('local depth strips premium-tier field (headcount_trend)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(report.headcount_trend).toBeUndefined();
  });

  it('local depth still allows base fields (event_id, event_title, unique_gatherings, _meta)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(report.event_id).toBe('evt_test');
    expect(report.event_title).toBe('Test Event');
    expect(report.unique_gatherings).toBe(99);
    expect(report._meta).toBeDefined();
  });

  it('mid depth exposes mid-tier fields but strips premium-only field (headcount_trend)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'mid', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(report.poster_attribution).toBeDefined();
    expect(report.return_rate).toBe(0.42);
    expect(report.corridor_density).toBeDefined();
    expect(report.headcount_trend).toBeUndefined();
  });

  it('upgrade hint names the locked sections when depth is not premium', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { upgrade } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(upgrade).not.toBeNull();
    expect(upgrade!.next_depth).toBe('mid');
    // mid has fields not in local — upgrade hint lists them as locked
    expect(upgrade!.locked_sections.length).toBeGreaterThan(0);
  });
});
