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

/** The covenant's canonical rules (mirrors sponsor-allocation.yaml top-level fields). */
export interface SponsorAllocationCanonical {
  version: string;
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
  version: '1.0',
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
