/**
 * OSE-1266 — Sponsorship page: live OUTCOME PREVIEW (read-only against the engine).
 *
 * Given a sponsor's config (commercial tier + geo-derived is_local + the corridor's
 * current rotation), return exactly what they will RECEIVE: the SharedReport sections
 * their depth unlocks, plus an estimated rotation frequency-share. "Configure the
 * aperture, never the honesty."
 *
 * DRIFT-PROOF BY CONSTRUCTION: this module computes nothing itself — it calls the same
 * `resolveDepth` + `filterReportByDepth` (report-depth) and `allocateShares`
 * (sponsor-allocation, Invariant 25) the live read path uses. If those change, the
 * preview changes with them; the contract test asserts equality so it cannot drift.
 *
 * Honest coupling (do not "fix" without changing the engine): a sponsor's report depth
 * is capped at 'mid' by resolveDepth (SPONSOR_MAX). Premium therefore buys higher
 * FREQUENCY (premium cap 40% vs mid 20%), NOT deeper data. The preview shows this
 * plainly rather than implying premium-only report sections.
 *
 * Covenant red lines held here (see sponsor-preview.spec.ts, born-red):
 *   - no attendee data / aggregate-only  (Inv 1 / Inv 7)
 *   - tier never flips is_local          (Inv 2 / Inv 25 — local is geo-earned)
 *   - no price/position/size/slot output (Inv 25 — only frequency + depth are bought)
 *   - local floor holds                  (Inv 25 walls)
 */

import {
  DEPTH_SECTIONS,
  resolveDepth,
  filterReportByDepth,
  type ReportDepth,
} from './report-depth';
import { allocateShares, type RotationSponsor, type SponsorTier } from './sponsor-allocation';

/** The three commercial choices the sponsorship page offers. */
export type CommercialTier = 'local' | 'mid' | 'premium';

/**
 * Commercial tier → (report depth claim, allocation frequency tier).
 * depthClaim is what we ASK for; resolveDepth still caps a sponsor at 'mid', so
 * `premium` here claims 'mid' depth (never 'premium', which resolveDepth would
 * fail-closed to 'local') and buys its value as premium FREQUENCY.
 */
const COMMERCIAL_MAP: Record<CommercialTier, { depthClaim: ReportDepth; sovTier: SponsorTier }> = {
  local: { depthClaim: 'local', sovTier: 'base' },
  mid: { depthClaim: 'mid', sovTier: 'mid' },
  premium: { depthClaim: 'mid', sovTier: 'premium' },
};

export interface PreviewInput {
  tier: CommercialTier;
  sponsorId: string;
  /** Geo-derived (corridor-cell match). Passed in — NEVER set by tier (Invariant 25). */
  isLocal: boolean;
  /** Other sponsors already in the corridor's rotation, for the share estimate. */
  corridorSponsors?: RotationSponsor[];
}

export interface OutcomePreview {
  tier: CommercialTier;
  /** Effective depth after the sponsor cap — what the sponsor actually gets. */
  report_depth: ReportDepth;
  /** The report sections delivered at this depth (from the real filter). */
  report_sections: string[];
  /** Next-rung sections named-but-withheld (the honest upgrade hint). */
  locked_sections: string[];
  /** Estimated % of rotation impressions (frequency), from allocateShares. */
  frequency_share_pct: number;
  /** Echoed geo truth — mirrors input, provably independent of tier. */
  is_local: boolean;
  /** The covenant guarantees this config honors — rendered as visible promises. */
  guarantees: {
    no_attendee_data: true;
    aggregate_only: true;
    position_uniform: true;
    local_not_purchasable: true;
  };
}

/**
 * A full-premium report SHAPE (every section name present) so the REAL filter
 * decides what a sponsor at this depth receives — sections come from
 * filterReportByDepth, never a hand-copied list.
 */
function fullReportShape(): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const key of DEPTH_SECTIONS.premium) shape[key] = null;
  return shape;
}

/** Round to one decimal for display without misrepresenting the share. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the outcome preview. Pure + deterministic. Ignores any unknown input
 * fields (e.g. a stray price) — so price can never influence the outcome.
 */
export function buildOutcomePreview(input: PreviewInput): OutcomePreview {
  const { depthClaim, sovTier } = COMMERCIAL_MAP[input.tier];

  // Depth → sections (real resolve + filter).
  const resolved = resolveDepth({
    role: 'sponsor',
    depth: depthClaim,
    sponsor_id: input.sponsorId,
  });
  const { report, upgrade } = filterReportByDepth(fullReportShape(), resolved);

  // Frequency → share estimate (real allocation, this sponsor added to the pool).
  const others = input.corridorSponsors ?? [];
  const withSelf: RotationSponsor[] = [
    ...others,
    { id: input.sponsorId, tier: sovTier, is_local: input.isLocal },
  ];
  const mine = allocateShares(withSelf).find((s) => s.id === input.sponsorId);

  return {
    tier: input.tier,
    report_depth: resolved.depth,
    report_sections: Object.keys(report),
    locked_sections: upgrade ? upgrade.locked_sections : [],
    frequency_share_pct: mine ? round1(mine.sharePct) : 0,
    is_local: input.isLocal,
    guarantees: {
      no_attendee_data: true,
      aggregate_only: true,
      position_uniform: true,
      local_not_purchasable: true,
    },
  };
}
