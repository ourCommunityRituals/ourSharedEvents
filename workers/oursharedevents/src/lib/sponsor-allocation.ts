/**
 * Local Sponsor Covenant — OSE consumed canonical copy (OSE-330 Phase 2).
 *
 * This is the OSE substrate's local copy of the brain artifact at
 * `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml`. Manually mirrored as a
 * TypeScript module per ADR-012 — zero runtime YAML parsing, statically
 * typed, tree-shakeable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Source of truth: ocr-docs-brain/sponsor-allocation.yaml @ OCR-docs#53 (OSE-330 P1)
 * Brain invariant: architectural-invariants.yaml #5 (Local Sponsor Covenant)
 * Drift check:     OSE-336 will extend OSE-323 pattern to this artifact
 *                  (file as follow-on; until then, drift is PR-review-gated)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The covenant: local sponsors get top-of-display position regardless of
 * pricing tier. A premium sponsor's payment buys position WITHIN the
 * non-local group — never the ability to displace a local sponsor.
 *
 * Current OSE architecture has no slot cap on sponsor surfaces; the
 * covenant is mechanically enforced via display-priority (locals-first
 * sort in sponsor-resolver.tierSort()). When a future surface adds a
 * top-N selection (TV-cycle picker, etc.), the SLOT_FLOOR config below
 * is the canonical scaffolding the slot-cap consumer reads.
 */

/** Per-surface allocation rule (future-proof scaffolding for slot-cap surfaces). */
export interface SurfaceAllocation {
  /** Slot cap — null means no top-N selection today (display all qualifying). */
  cap: number | null;
  /** Minimum local sponsors that must appear when cap > 0. */
  local_floor: number;
  /** Why this floor at this surface. */
  rationale: string;
}

/** Share-of-voice frequency allocation (OSE-663, brain Invariant #25). */
export interface ShareOfVoiceConfig {
  status: 'planned' | 'active';
  unit: string;
  walls: {
    local_floor_pct: number;
    premium_cap_pct: number;
    mid_cap_pct: number;
    min_presence_pct: number;
    uniform_size_slot: true;
  };
  weights: { base: number; mid: number; premium: number };
}

/** The covenant's canonical rules (mirrors sponsor-allocation.yaml top-level fields). */
export interface SponsorAllocationCanonical {
  version: string;
  share_of_voice: ShareOfVoiceConfig;
  classification: {
    field: 'is_local';
    type: 'boolean';
    default: false;
  };
  display_priority: {
    /** Today's only rule — locals before non-locals, tier breaks ties within each group. */
    rule: 'locals_first';
  };
  slot_floor: {
    /** scaffolded = no current consumer; active = at least one surface enforces cap. */
    status: 'scaffolded' | 'active';
    surfaces: Record<string, SurfaceAllocation>;
  };
}

/**
 * Brain-canonical mirror (kept byte-equivalent at the data level with
 * sponsor-allocation.yaml). Editing rule: NEVER edit independently of
 * brain — any change MUST originate in OCR-docs/ocr-docs-brain/
 * sponsor-allocation.yaml + flow here via PR review until OSE-336 drift
 * check ships.
 */
export const SPONSOR_ALLOCATION: SponsorAllocationCanonical = {
  version: '1.1',
  share_of_voice: {
    status: 'active',
    unit: 'percent_of_rotation_impressions',
    walls: {
      local_floor_pct: 30,
      premium_cap_pct: 40,
      mid_cap_pct: 20,
      min_presence_pct: 2,
      uniform_size_slot: true,
    },
    weights: { base: 1, mid: 3, premium: 7 },
  },
  classification: {
    field: 'is_local',
    type: 'boolean',
    default: false,
  },
  display_priority: {
    rule: 'locals_first',
  },
  slot_floor: {
    status: 'scaffolded',
    surfaces: {
      // Rationale strings INTENTIONALLY include trailing `\n` to match brain
      // canonical's YAML folded-scalar (`>` style) output byte-for-byte. The
      // OSE-336 drift check (tests/sponsor-allocation-drift-check.spec.ts)
      // enforces this byte-equivalence. If you edit a rationale here, also
      // edit the matching brain canonical and re-run the drift check.
      posterTop: {
        cap: null,
        local_floor: 1,
        rationale:
          'Poster is the highest-visibility physical surface. Local sponsors guaranteed at least 1 of the cap slots when cap > 0.\n',
      },
      tvTop: {
        cap: null,
        local_floor: 1,
        rationale: 'TV top banner. Same local-first guarantee as poster.\n',
      },
      tvSide: {
        cap: null,
        local_floor: 2,
        rationale: 'TV sidebar has more slots historically; double the local floor.\n',
      },
      mobileBanner: {
        cap: null,
        local_floor: 0,
        rationale:
          'Mobile banner is a single-impression surface; tier sort already delivers locals-first via display_priority above. No additional floor needed when cap is set.\n',
      },
    },
  },
};

/**
 * Pure helper — does the brain-canonical config currently enforce slot caps?
 * Returns false today (status: scaffolded). When the first surface activates
 * a cap, status flips to 'active' and this returns true; slot-cap consumers
 * in resolver-land branch on this.
 */
export function isSlotFloorActive(): boolean {
  return SPONSOR_ALLOCATION.slot_floor.status === 'active';
}

/**
 * Pure helper — get the per-surface floor for the named surface.
 * Returns 0 if the surface isn't in the brain config (defensive default).
 */
export function getLocalFloor(surface: string): number {
  return SPONSOR_ALLOCATION.slot_floor.surfaces[surface]?.local_floor ?? 0;
}

// ─── Share-of-voice allocation (OSE-663, brain Invariant #25 sponsor_share_covenant) ──
// Pure function turning sponsor demand + tiers into a rotation FREQUENCY % per
// sponsor, under three walls: (1) premium cap, (2) local floor, (3) uniform
// size/slot — only frequency is purchasable. It returns ONLY a sharePct, never
// a size/slot/position, so WALL 3 holds by construction. Params come from
// SPONSOR_ALLOCATION.share_of_voice (mirror of the brain canonical).

export type SponsorTier = 'base' | 'mid' | 'premium';

export interface RotationSponsor {
  id: string;
  tier: SponsorTier;
  /** Geo-derived (corridor-cell match), NEVER purchasable — see Invariant #25. */
  is_local: boolean;
}

export interface ShareAllocation {
  id: string;
  /** Percent of rotation impressions — the only purchasable dimension (WALL 3). */
  sharePct: number;
}

/**
 * OSE-661 — map the 6 legacy pricing tiers (the DB `tier` column) to the 3
 * share-of-voice tiers allocateShares() consumes. SINGLE SOURCE OF TRUTH: both
 * the backend renderer (sponsor-resolver.buildShareRotation) and the admin
 * authoring form resolve tiers through here, so the covenant is one seam.
 *
 * Ratified 2026-08-08:  premium = {title, platinum}
 *                       mid     = {gold, silver}
 *                       base    = {bronze, primary}
 * An unrecognized tier maps to `base` — the LOWEST weight + no premium cap
 * exemption. Fail-safe, not fail-open: an unknown tier can never buy a premium
 * share (matches OSE-663 AC "unknown tier ⇒ base, never > cap").
 */
const SOV_TIER_MAP: Record<string, SponsorTier> = {
  title: 'premium',
  platinum: 'premium',
  gold: 'mid',
  silver: 'mid',
  bronze: 'base',
  primary: 'base',
};

export function sovTierOf(dbTier: string): SponsorTier {
  return SOV_TIER_MAP[(dbTier || '').toLowerCase()] ?? 'base';
}

const SOV_EPS = 1e-9;

function sovWeightOf(t: SponsorTier): number {
  const w = SPONSOR_ALLOCATION.share_of_voice.weights;
  return t === 'premium' ? w.premium : t === 'mid' ? w.mid : w.base;
}

function sovCapOf(t: SponsorTier): number {
  const walls = SPONSOR_ALLOCATION.share_of_voice.walls;
  // base has no per-sponsor cap (bounded by the pool); premium/mid do.
  return t === 'premium' ? walls.premium_cap_pct : t === 'mid' ? walls.mid_cap_pct : 100;
}

function sovNormalizeTo100(a: ShareAllocation[]): void {
  const t = a.reduce((x, e) => x + e.sharePct, 0);
  if (t > SOV_EPS) for (const e of a) e.sharePct = (e.sharePct * 100) / t;
}

/**
 * Allocate rotation frequency shares. Pure + deterministic.
 *
 * Guarantees (brain Invariant #25):
 *   - sum(sharePct) === 100 for any non-empty input.
 *   - the is_local class collectively holds >= local_floor_pct whenever any
 *     is_local sponsor is present (WALL 2).
 *   - no premium/mid sponsor exceeds its cap WHEN the cap is satisfiable —
 *     i.e. enough sponsors that the weighted share falls at/below the cap
 *     (WALL 1). With too few sponsors to fill the surface, shares are forced
 *     above the cap: the sponsor-sparse regime, where the cap is not binding
 *     (a single sponsor is necessarily 100%). This is the demand-driven
 *     behavior — fewer sponsors → each a higher share.
 *   - fail-closed: an unknown tier throws.
 *
 * Returns ONLY frequency (sharePct); no size/slot field exists, so size/slot
 * are uniform by construction (WALL 3).
 */
export function allocateShares(sponsors: RotationSponsor[]): ShareAllocation[] {
  for (const s of sponsors) {
    if (s.tier !== 'base' && s.tier !== 'mid' && s.tier !== 'premium') {
      throw new Error(`allocateShares: unknown sponsor tier "${String(s.tier)}" (fail-closed)`);
    }
  }
  const n = sponsors.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: sponsors[0]!.id, sharePct: 100 }];

  const walls = SPONSOR_ALLOCATION.share_of_voice.walls;
  const locals = sponsors.filter((s) => s.is_local);
  const localIds = new Set(locals.map((s) => s.id));
  const floor = locals.length > 0 ? walls.local_floor_pct : 0;

  const share: Record<string, number> = {};
  for (const s of sponsors) share[s.id] = 0;

  // Step 1 — reserve the local floor collectively, split evenly across locals.
  if (locals.length > 0) {
    const per = floor / locals.length;
    for (const s of locals) share[s.id] = per;
  }

  // Step 2 — weighted water-fill of the remaining pool over ALL sponsors,
  // clamped to per-sponsor caps (locals may earn above their floor).
  let pool = 100 - floor;
  const capped = new Set<string>();
  for (let iter = 0; iter < 128 && pool > SOV_EPS; iter++) {
    const active = sponsors.filter(
      (s) => !capped.has(s.id) && share[s.id] < sovCapOf(s.tier) - SOV_EPS
    );
    if (active.length === 0) break;
    const wSum = active.reduce((a, s) => a + sovWeightOf(s.tier), 0);
    let distributed = 0;
    for (const s of active) {
      const want = (pool * sovWeightOf(s.tier)) / wSum;
      const room = sovCapOf(s.tier) - share[s.id];
      const give = Math.min(want, room);
      share[s.id] += give;
      distributed += give;
      if (room - give <= SOV_EPS) capped.add(s.id);
    }
    pool -= distributed;
    if (distributed <= SOV_EPS) break; // all capped; residual pool normalized away
  }

  const out: ShareAllocation[] = sponsors.map((s) => ({ id: s.id, sharePct: share[s.id]! }));
  sovNormalizeTo100(out);

  // Step 3 — min-presence: no accepted sponsor rounded below the visibility
  // floor. Steal proportionally from NON-local donors above the min so the
  // local floor is never raided. Skipped when infeasible (n*min > 100).
  const min = walls.min_presence_pct;
  if (n * min <= 100) {
    const below = out.filter((e) => e.sharePct < min - SOV_EPS);
    if (below.length > 0) {
      const donors = out.filter((e) => e.sharePct > min + SOV_EPS && !localIds.has(e.id));
      const surplus = donors.reduce((a, e) => a + (e.sharePct - min), 0);
      const need = below.reduce((a, e) => a + (min - e.sharePct), 0);
      if (surplus > SOV_EPS) {
        const take = Math.min(need, surplus);
        for (const e of below) e.sharePct = min;
        for (const e of donors) e.sharePct -= ((e.sharePct - min) / surplus) * take;
        sovNormalizeTo100(out);
      }
    }
  }

  return out;
}
