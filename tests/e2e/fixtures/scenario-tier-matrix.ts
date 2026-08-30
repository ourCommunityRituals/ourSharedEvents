/**
 * scenario-tier-matrix.ts — the ONE place the consolidated FE test matrix is defined.
 *
 * Feature intent: this fixture exists so that every screen (sponsor card, admin,
 * display, public) is proven under every admin creation path (wizard | advanced)
 * and every tier — as ONE parameterized journey, not hand-written spec sprawl.
 * It serves the organizer (two paths through one admin), the sponsor (tier truth
 * rendered the same on every surface), and the attendee (public/display parity).
 *
 * Plan: docs/plans/FE-DEV-PREP-2026-08-29.md
 *
 * TIER VOCABULARY — pulled from code, not invented (see the header of
 * workers/oursharedevents/src/handlers/demo.ts, the sole translation point):
 *   matrix "local"      ↔ flag tier "free"       ↔ report depth "local"
 *   matrix "mid"        ↔ flag tier "mid"        ↔ report depth "mid"
 *   matrix "enterprise" ↔ flag tier "enterprise" ↔ report depth "premium"
 * If demo.ts's DEMO_TIERS mapping ever changes, this table is the drift point —
 * reconcile here first, then the specs.
 *
 * WHY wizard × enterprise is absent: enterprise is a provisioned tier (OA layer,
 * custom onboarding) — it is never reached through a first-timer self-serve
 * wizard. The gap is a design decision, not missing coverage.
 *
 * WHY is_local rides separately: `is_local` is a geographic covenant floor
 * (h3_res7 match), enforced independently of the paid tier axis (#25/OSE-661).
 * Every cell asserts it on its own — never derived from tier.
 */

export type Scenario = 'wizard' | 'advanced';
export type MatrixTier = 'local' | 'mid' | 'enterprise';

export interface TierConfig {
  /** Matrix name — the plain-language name used in test titles. */
  tier: MatrixTier;
  /** Flag-tier vocabulary (getFlagsForTier / feature-flags.ts). */
  flagTier: 'free' | 'mid' | 'enterprise';
  /** Report-depth vocabulary (report-depth.ts DEPTH_SECTIONS). */
  depth: 'local' | 'mid' | 'premium';
  /** Plain-language label a human should see on screen (first-read clarity). */
  friendlyLabel: string;
}

export const TIERS: Record<MatrixTier, TierConfig> = {
  local: { tier: 'local', flagTier: 'free', depth: 'local', friendlyLabel: 'Free plan' },
  mid: { tier: 'mid', flagTier: 'mid', depth: 'mid', friendlyLabel: 'Pro plan' },
  enterprise: {
    tier: 'enterprise',
    flagTier: 'enterprise',
    depth: 'premium',
    friendlyLabel: 'Enterprise plan',
  },
};

export const SCENARIOS: Scenario[] = ['wizard', 'advanced'];
export const TIER_ORDER: MatrixTier[] = ['local', 'mid', 'enterprise'];

/** Applicability rule — the one exclusion, as executable truth. */
export function applicable(scenario: Scenario, tier: MatrixTier): boolean {
  return !(scenario === 'wizard' && tier === 'enterprise');
}

/** Every applicable {scenario × tier} cell, for parameterized iteration. */
export function matrixCells(): Array<{ scenario: Scenario; tier: TierConfig }> {
  const cells: Array<{ scenario: Scenario; tier: TierConfig }> = [];
  for (const scenario of SCENARIOS) {
    for (const t of TIER_ORDER) {
      if (applicable(scenario, t)) cells.push({ scenario, tier: TIERS[t] });
    }
  }
  return cells;
}

/**
 * A tier-parameterized sponsor fixture for API mocking, shaped like the
 * /api/v2 envelope the surfaces consume ({ ok, items } / { ok, item }).
 * data_class declares provenance structurally — a demo row can never
 * masquerade as real (provenance self-declaration doctrine).
 */
export function sponsorFixture(tier: TierConfig, overrides: Record<string, unknown> = {}) {
  return {
    id: `spn_matrix_${tier.tier}`,
    name: `Matrix ${tier.friendlyLabel} Sponsor`,
    tier: tier.flagTier,
    is_local: true, // asserted independently of tier in every cell
    brand_id: 'root',
    data_class: 'demo',
    logo_url: null,
    ...overrides,
  };
}

/** A tier-parameterized event fixture matching the public/display envelope. */
export function eventFixture(tier: TierConfig, overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_matrix_${tier.tier}`,
    title: `Matrix Night — ${tier.friendlyLabel}`,
    name: `Matrix Night — ${tier.friendlyLabel}`,
    slug: `matrix-night-${tier.tier}`,
    status: 'active',
    brand_id: 'root',
    start_date: '2026-09-15',
    startDateISO: '2026-09-15T18:00:00Z',
    venue: 'Rock Island Public House',
    location: 'Blue Island',
    data_class: 'demo',
    ...overrides,
  };
}
