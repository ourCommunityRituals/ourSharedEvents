/**
 * The SharedReport class breakdown (SR-25, floor repaired in OSE-2089): pure
 * functions, no database. `lib/shared-report-builder.ts` hands in the
 * `sponsor_displays` rows it publishes.
 */
import { floorTotalOfParts } from './count-floor';
import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import type { SharedReport, SuppressionReason } from './shared-report-builder';
import { fewerThan } from './withheld-words';

export type SponsorClass = 'local' | 'mid' | 'premium';
export type SponsorClassBreakdown = SharedReport['sponsor_class_breakdown'];

/** `_meta.suppression_reasons[].field` for a class whose total is withheld. */
export const CLASS_TOTAL_WITHHELD_FIELD = 'sponsor_class_breakdown.total_displays';

// The classes are labels IN the report, never a gate on its reader (invariant 7).
const PREMIUM_TIERS = new Set(['title', 'platinum', 'gold']);

/** local = a local sponsor at any tier; premium = non-local at a top tier; mid = the rest. */
export function classifySponsor(tier: string | null, isLocal: boolean): SponsorClass {
  if (isLocal) return 'local';
  return tier !== null && PREMIUM_TIERS.has(tier) ? 'premium' : 'mid';
}

/**
 * The class breakdown of a report, from its (sponsor x surface) display rows.
 *
 *   - `total_displays` goes through `floorTotalOfParts`: a row under the floor
 *     never joins a sum, so a class total is the sum of the rows published for
 *     that class. With no row at the floor it is withheld (null), and a class
 *     with no sponsor reads the same as one whose sponsors have 1 to 4.
 *   - `sponsor_count` is the distinct sponsors with a row at the floor, once
 *     each however many surfaces they are on. It counts businesses, so it has no
 *     floor; it steps only at 5, with the row that is published at 5.
 */
export function summarizeSponsorClasses(
  rows: readonly {
    sponsor_id: string;
    sponsor_tier: string | null;
    is_local: boolean;
    count: number;
  }[]
): SponsorClassBreakdown {
  const classes: Record<SponsorClass, { sponsors: Set<string>; parts: number[] }> = {
    local: { sponsors: new Set(), parts: [] },
    mid: { sponsors: new Set(), parts: [] },
    premium: { sponsors: new Set(), parts: [] },
  };
  // A sponsor is one business in one class: the class of its first row.
  const classOf = new Map<string, SponsorClass>();
  for (const row of rows) {
    // A part under the floor adds nothing, to the total or to the sponsors.
    if (floorTotalOfParts([row.count]).count === null) continue;
    const cls = classifySponsor(row.sponsor_tier, row.is_local);
    if (!classOf.has(row.sponsor_id)) {
      classOf.set(row.sponsor_id, cls);
      classes[cls].sponsors.add(row.sponsor_id);
    }
    classes[cls].parts.push(row.count);
  }
  const one = (c: { sponsors: Set<string>; parts: number[] }) => ({
    sponsor_count: c.sponsors.size,
    total_displays: floorTotalOfParts(c.parts).count,
  });
  return { local: one(classes.local), mid: one(classes.mid), premium: one(classes.premium) };
}

/**
 * The `_meta.suppression_reasons` entry for a breakdown with a withheld total:
 * one entry however many classes are withheld. The words are `fewerThan`
 * (lib/withheld-words.ts). A total is a sum of floored parts, so the tail says
 * which part: withheld means no sponsor reached the floor on any one surface,
 * not fewer than that in all.
 */
export function classWithheldReasons(breakdown: SponsorClassBreakdown): SuppressionReason[] {
  if (Object.values(breakdown).every((c) => c.total_displays !== null)) return [];
  return [
    {
      field: CLASS_TOTAL_WITHHELD_FIELD,
      reason: 'below_min_sample_size',
      detail: fewerThan(
        CORRIDOR_MAP_MIN_COUNT,
        'displays of any one sponsor on any one surface',
        true
      ),
    },
  ];
}
