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
  distinct_scanners: 99,
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

  // OSE-1186 mutation kill: an EMPTY-string sponsor_id must NOT become a scope
  // (the `.length > 0` guard). Without this, `sponsor_id: ''` would set scope to
  // '' and the impression filter would match rows with an empty sponsor_id — the
  // one input distinguishing `length > 0` from `length >= 0`.
  it('scoping: sponsor with an empty-string sponsor_id gets NO scope (length guard)', () => {
    const r = resolveDepth({ role: 'sponsor', depth: 'mid', sponsor_id: '' });
    expect(r.sponsorScope).toBeNull();
    expect(r.sponsorScopeRequired).toBe(true);
  });

  it('OSE-577: internal service role resolves to premium (full payload, no sponsor scope)', () => {
    // Depth is keyed on role, not endpoint. The internal in-fleet batch consumer
    // gets full depth here; the cross-product WKRP token never reaches resolveDepth
    // (it fails closed at the handler auth boundary).
    const r = resolveDepth({ role: 'internal' });
    expect(r.depth).toBe('premium');
    expect(r.sponsorScope).toBeNull();
    expect(r.sponsorScopeRequired).toBe(false);
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
    expect(DEPTH_SECTIONS.local).toContain('distinct_scanners');
    expect(DEPTH_SECTIONS.local).toContain('sponsor_impressions');
  });

  it('equity-by-construction: premium tier passes all numeric values identically', () => {
    const resolved = resolveDepth({ role: 'admin' });
    const { report, upgrade } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    // Omission-only: no values are transformed
    expect(report.distinct_scanners).toBe(99);
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

  // OSE-1186 mutation kill: the scoped filter's row guard is
  // `typeof r === 'object' && r !== null && r.sponsor_id === scope`. The plain
  // fixture above (only well-formed peer rows) can't prove the `typeof`/`!== null`
  // limbs have teeth — a mutant dropping either survives. Feed a null and a
  // non-object row alongside the peer row and assert the scoped token gets ONLY
  // its own well-formed row (garbage never leaks through the filter).
  it('scoped filter strips null / non-object / competitor rows, keeps only own well-formed rows', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const adversarial = {
      ...SAMPLE_REPORT,
      sponsor_impressions: [
        { sponsor_id: 'sp_A', impressions: 200 },
        { sponsor_id: 'sp_B', impressions: 75 }, // competitor — must be stripped
        null, // malformed — must be stripped (the `r !== null` limb)
        'not-an-object', // malformed — must be stripped (the `typeof === object` limb)
      ],
    };
    const { report } = filterReportByDepth({ ...adversarial }, resolved);
    const rows = report.sponsor_impressions as Array<{ sponsor_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sponsor_id).toBe('sp_A');
  });

  // OSE-1186 mutation kill: the sponsor-scope filter must apply to
  // sponsor_impressions ONLY (`if (key === 'sponsor_impressions')`). A class-level
  // aggregate like sponsor_class_breakdown (present at every depth, OSE-719) is
  // NOT per-competitor and must pass through WHOLE for a scoped sponsor. Without
  // the key check, every array section would be sponsor-filtered and emptied.
  it('scoped sponsor gets class-level sections (sponsor_class_breakdown) WHOLE, not sponsor-filtered', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const withClassBreakdown = {
      ...SAMPLE_REPORT,
      // Array section, class-keyed (no sponsor_id) — must survive scoping intact.
      sponsor_class_breakdown: [
        { sponsor_class: 'primary', count: 3 },
        { sponsor_class: 'secondary', count: 5 },
      ],
    };
    const { report } = filterReportByDepth({ ...withClassBreakdown }, resolved);
    const breakdown = report.sponsor_class_breakdown as Array<{ sponsor_class: string }>;
    expect(breakdown).toHaveLength(2); // delivered whole — NOT filtered to zero by sponsor scope
    // …while sponsor_impressions IS still scoped in the same call (both behaviours hold together).
    expect((report.sponsor_impressions as unknown[]).length).toBe(1);
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

  it('local depth still allows base fields (event_id, event_title, distinct_scanners, _meta)', () => {
    const resolved = resolveDepth({ role: 'sponsor', depth: 'local', sponsor_id: 'sp_A' });
    const { report } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(report.event_id).toBe('evt_test');
    expect(report.event_title).toBe('Test Event');
    expect(report.distinct_scanners).toBe(99);
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

// OSE-817 — upgrade.locked_sections is the SOLE input the client renders the
// "printed refusal" from (the client never inspects the payload for section
// presence). That is only safe if locked_sections is a FAITHFUL, COMPLETE picture
// of the next rung: every next-tier section that exists in the full report but is
// withheld at the current depth must be named, and nothing named may actually be
// present in the delivered payload (no phantom lock, no silently-stripped rung).
// Proven at the lib level so it holds by construction — a section added to
// DEPTH_SECTIONS re-runs this symmetry with no client change (AC#4).
describe('OSE-817 | upgrade.locked_sections is a faithful next-rung picture (client renders solely from it)', () => {
  for (const depth of ['local', 'mid'] as const) {
    it(`${depth}: locked_sections === exactly the next-rung sections present-but-withheld`, () => {
      const resolved = resolveDepth({ role: 'sponsor', depth, sponsor_id: 'sp_A' });
      const { report, upgrade } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
      expect(upgrade).not.toBeNull();
      const next = upgrade!.next_depth!;
      expect(next).not.toBeNull();

      // Independently derive what the NEXT rung newly unlocks and that exists in
      // the full report — derived from DEPTH_SECTIONS + the fixture, NOT from the
      // impl's internal allow-set, so a filtering-logic change is caught.
      const allowedNow = new Set(DEPTH_SECTIONS[resolved.depth]);
      const expectedLocked = DEPTH_SECTIONS[next].filter(
        (s) => !allowedNow.has(s) && s in SAMPLE_REPORT
      );
      expect(new Set(upgrade!.locked_sections)).toEqual(new Set(expectedLocked));

      // No phantom lock: everything named as locked is genuinely absent from the
      // delivered payload — so the client can trust "named == withheld".
      for (const s of upgrade!.locked_sections) {
        expect(report[s], `locked section "${s}" must be absent from the payload`).toBeUndefined();
      }
    });
  }

  it('premium: no upgrade object at all (nothing locked → client renders no refusal)', () => {
    const resolved = resolveDepth({ role: 'admin' }); // resolves premium
    const { upgrade } = filterReportByDepth({ ...SAMPLE_REPORT }, resolved);
    expect(upgrade).toBeNull();
  });
});
