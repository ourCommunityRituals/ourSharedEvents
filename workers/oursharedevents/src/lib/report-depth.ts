/**
 * SharedReport depth resolution — the missing tier gate (Invariant #5 read side).
 *
 * Three tier vocabularies exist in OSE; this module is deliberately the ONLY
 * place they meet:
 *   • sponsors.tier (title…primary)      → DISPLAY priority. Never consulted here.
 *   • flags tiers (free/mid/enterprise)  → feature presets. Never consulted here.
 *   • REPORT DEPTH (local/mid/premium)   → what a report viewer sees. This module.
 *
 * Depth is carried in the signed link token, minted by the organizer when
 * generating the share link ("organizer generates, sponsor receives; tier
 * controls depth, not access"). Claim extensions are OPTIONAL and backward
 * compatible:
 *   { event_id, role, exp, depth?: 'local'|'mid'|'premium', sponsor_id?: string }
 * Legacy tokens (no depth): admin/bar_owner → premium (full); sponsor → local.
 *
 * INVARIANT #5 (tier_equity) COMPLIANCE, by construction:
 *   – This module runs at READ time only. It filters a built report; it never
 *     touches ingest, materialization, or storage. Data collection is
 *     tier-blind (see tier-equity.invariant.spec.ts which enforces that the
 *     scan path contains zero tier references).
 *   – Filtering is by OMISSION only — no value is ever transformed, rounded,
 *     or degraded per tier. Same pipeline, same numbers, fewer sections.
 *   – Sponsor slice isolation: role=sponsor sees only their own
 *     sponsor_impressions rows (cross-contamination = critical bug per the
 *     April 7 CCR).
 */

import type { SignedLinkRole } from './shared-report-auth';

export type ReportDepth = 'local' | 'mid' | 'premium';

/** Sections of the SharedReport payload, mapped to the commercial tier matrix. */
export const DEPTH_SECTIONS: Record<ReportDepth, readonly string[]> = {
  // Local buys proof: "I was there." Headcount + own logo counts.
  local: [
    'event_id',
    'event_title',
    'event_start_date',
    'event_end_date',
    'unique_gatherings',
    'sponsor_impressions',
    '_meta',
  ],
  // Mid buys the MAP + optimization: the visible corridor map (its own corridor),
  // placement breakdown, temporal signal, campaign comparison. The map is the
  // paid value line (OSE-682, ratified 2026-08-10) — paid tiers get it, free does
  // not. Premium goes deeper (cross-corridor + cross-event) below.
  mid: [
    'event_id',
    'event_title',
    'event_start_date',
    'event_end_date',
    'unique_gatherings',
    'sponsor_impressions',
    'campaign_summary',
    'poster_attribution',
    'return_rate',
    'corridor_density',
    'corridor_map',
    '_meta',
  ],
  // Premium buys deeper intelligence: everything Mid has PLUS cross-event
  // comparison (headcount_trend) and the fuller cross-corridor picture.
  premium: [
    'event_id',
    'event_title',
    'event_start_date',
    'event_end_date',
    'unique_gatherings',
    'sponsor_impressions',
    'campaign_summary',
    'poster_attribution',
    'return_rate',
    'corridor_density',
    'corridor_map',
    'headcount_trend',
    '_meta',
  ],
} as const;

const DEPTH_ORDER: ReportDepth[] = ['local', 'mid', 'premium'];

/**
 * Depth is resolved by ROLE, never by endpoint (OSE-577). Beyond the three
 * signed-link viewer roles, the in-fleet batch consumer resolves here too, as
 * the `internal` service role — so a future depth filter (OSE-816) keys off the
 * caller's class, not off "is this the batch handler". The cross-product WKRP
 * token is NOT a role here: it fails closed at the handler auth boundary and
 * never reaches depth resolution.
 */
export type DepthRole = SignedLinkRole | 'internal';

export interface DepthClaimInput {
  role: DepthRole;
  depth?: unknown; // untrusted claim field
  sponsor_id?: unknown; // untrusted claim field
}

export interface ResolvedDepth {
  depth: ReportDepth;
  /** When set, sponsor_impressions is filtered to this sponsor only. */
  sponsorScope: string | null;
  /**
   * True when the token role is 'sponsor'. Distinguishes the two null-scope cases:
   *   admin/bar_owner + null → see ALL sponsor rows (cross-event intelligence)
   *   sponsor + null         → see NONE (no sponsor_id on token = block all rows)
   * Without this flag, filterReportByDepth cannot tell them apart and would
   * leak every competitor's impression data to an un-scoped sponsor token.
   */
  sponsorScopeRequired: boolean;
}

/** Resolve effective depth from token claims. Fail-closed on garbage. */
export function resolveDepth(claim: DepthClaimInput): ResolvedDepth {
  const requested =
    typeof claim.depth === 'string' && (DEPTH_ORDER as string[]).includes(claim.depth)
      ? (claim.depth as ReportDepth)
      : null;

  if (claim.role === 'admin' || claim.role === 'bar_owner' || claim.role === 'internal') {
    // Organizer/admin links and the internal in-fleet batch consumer always see
    // everything; a depth claim on these roles is ignored rather than trusted
    // downward (least surprise). 'internal' is the anonymity-respecting service
    // class (OSE-577) — the cross-product WKRP token never reaches here (it
    // fails closed at the handler), so full depth by role is safe.
    return { depth: 'premium', sponsorScope: null, sponsorScopeRequired: false };
  }
  // role === 'sponsor' — scope is required; null scope blocks all impressions.
  // Sponsors cannot self-grant premium depth; cap at 'mid' (fail-closed to 'local').
  const SPONSOR_MAX: ReportDepth = 'mid';
  const sponsorDepth: ReportDepth =
    requested && DEPTH_ORDER.indexOf(requested) <= DEPTH_ORDER.indexOf(SPONSOR_MAX)
      ? requested
      : 'local';
  return {
    depth: sponsorDepth,
    sponsorScope:
      typeof claim.sponsor_id === 'string' && claim.sponsor_id.length > 0 ? claim.sponsor_id : null,
    sponsorScopeRequired: true,
  };
}

export interface UpgradeHint {
  locked_sections: string[];
  next_depth: ReportDepth | null;
}

/**
 * Filter a built SharedReport to the resolved depth.
 * Pure. Never mutates the input. Values pass through untouched or not at all.
 */
export function filterReportByDepth<T extends Record<string, unknown>>(
  report: T,
  resolved: ResolvedDepth
): { report: Record<string, unknown>; upgrade: UpgradeHint | null } {
  const allowed = new Set(DEPTH_SECTIONS[resolved.depth]);
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(report)) {
    if (!allowed.has(key)) continue;
    if (key === 'sponsor_impressions') {
      const rows = report[key];
      if (resolved.sponsorScope) {
        // Scoped sponsor token — filter to own rows only
        out[key] = Array.isArray(rows)
          ? rows.filter(
              (r) =>
                typeof r === 'object' &&
                r !== null &&
                (r as Record<string, unknown>).sponsor_id === resolved.sponsorScope
            )
          : rows;
      } else if (resolved.sponsorScopeRequired) {
        // Sponsor role but no sponsor_id on token — return empty rather than
        // leaking every competitor's impression data (OSE-595, rank-6 finding)
        out[key] = [];
      } else {
        // admin / bar_owner — see all rows
        out[key] = report[key];
      }
    } else {
      out[key] = report[key];
    }
  }

  // Inline upgrade hint (the "blurred Mid section" hook — rendering decides
  // presentation; the API states exactly which sections exist but are locked).
  const idx = DEPTH_ORDER.indexOf(resolved.depth);
  const next = idx < DEPTH_ORDER.length - 1 ? DEPTH_ORDER[idx + 1]! : null;
  const upgrade: UpgradeHint | null = next
    ? {
        locked_sections: DEPTH_SECTIONS[next].filter(
          (s) => !allowed.has(s) && s in report
        ) as string[],
        next_depth: next,
      }
    : null;

  return { report: out, upgrade };
}
