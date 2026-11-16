/**
 * The SharedReport campaign summary (OSE-2046): pure functions, no database.
 *
 * `lib/shared-report-builder.ts` reads the campaign links and the display rows
 * and calls these for the whole event; the read route calls them again with one
 * sponsor's links and rows, so the two cannot count differently.
 */
import { floorTotalOfParts } from './count-floor';
import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import type { SharedReport, SuppressionReason } from './shared-report-builder';
import { fewerThan } from './withheld-words';

/** One placement of the event and the campaign it is read as in. */
export interface CampaignLink {
  campaign_id: string;
  campaign_title: string;
  sponsor_id: string;
}

/** One row of `SharedReport.campaign_summary` (the fields are described on that interface). */
export type CampaignSummaryRow = NonNullable<SharedReport['campaign_summary']>[number];

/** `_meta.suppression_reasons[].field` for a campaign whose total is withheld. */
export const CAMPAIGN_TOTAL_WITHHELD_FIELD = 'campaign_summary.total_displays';

/**
 * The campaign summary of a report (OSE-2046), from the campaign links and the
 * `sponsor_displays` rows the same reader is given. The builder calls it with
 * every row; the read route calls it again with one sponsor's links and rows.
 *
 *   - A campaign is listed because a placement is in it. A campaign whose rows
 *     are all under the floor is listed with `total_displays` null: leaving it
 *     out read as "no campaign", and listing it only once it had a display
 *     would tell 0 from 1 to 4.
 *   - `sponsor_count` is distinct sponsors placed, once each however many
 *     surfaces they are on.
 *   - Each total goes through `floorTotalOfParts`: a row under the floor never
 *     joins a sum, so a total can be differenced against the published rows
 *     only down to zero.
 */
export function summarizeCampaigns(
  links: readonly CampaignLink[],
  rows: readonly {
    campaign_id: string | null;
    campaign_title: string | null;
    sponsor_id: string;
    surface: string;
    count: number;
  }[]
): CampaignSummaryRow[] | null {
  const byCampaign = new Map<
    string,
    { title: string; sponsors: Set<string>; parts: number[]; surfaces: Map<string, number[]> }
  >();
  const entry = (id: string, title: string) => {
    let c = byCampaign.get(id);
    if (!c) {
      c = { title, sponsors: new Set(), parts: [], surfaces: new Map() };
      byCampaign.set(id, c);
    }
    return c;
  };
  for (const link of links) {
    entry(link.campaign_id, link.campaign_title).sponsors.add(link.sponsor_id);
  }
  for (const row of rows) {
    if (!row.campaign_id) continue;
    // A published row always enters, so a total is the sum of the rows shown
    // beside it. Most are among the links already; one that is not is a sponsor
    // that was shown at least 5 times on a surface and is no longer placed.
    const c = entry(row.campaign_id, row.campaign_title ?? 'unknown');
    c.sponsors.add(row.sponsor_id);
    c.parts.push(row.count);
    const surface = c.surfaces.get(row.surface) ?? [];
    surface.push(row.count);
    c.surfaces.set(row.surface, surface);
  }
  if (byCampaign.size === 0) return null;
  const summary: CampaignSummaryRow[] = [...byCampaign].map(([campaign_id, c]) => {
    const displays_by_surface: Record<string, number> = {};
    for (const [surface, parts] of c.surfaces) {
      const total = floorTotalOfParts(parts).count;
      if (total !== null) displays_by_surface[surface] = total;
    }
    return {
      campaign_id,
      campaign_title: c.title,
      total_displays: floorTotalOfParts(c.parts).count,
      sponsor_count: c.sponsors.size,
      displays_by_surface,
    };
  });
  // Published totals first, largest first; withheld ones after. Ties and the
  // withheld rows go by campaign id, so the order says nothing about a count.
  return summary.sort(
    (a, b) =>
      (b.total_displays ?? -1) - (a.total_displays ?? -1) ||
      (a.campaign_id < b.campaign_id ? -1 : a.campaign_id > b.campaign_id ? 1 : 0)
  );
}

/**
 * The `_meta.suppression_reasons` entry for a summary with a withheld total:
 * one entry however many campaigns are withheld, naming none of them. The words
 * are `fewerThan` (lib/withheld-words.ts). A total is a sum of floored parts,
 * so the tail says which part: withheld means no sponsor reached the floor on
 * any one surface, not fewer than that in all.
 */
export function campaignWithheldReasons(summary: CampaignSummaryRow[] | null): SuppressionReason[] {
  if (!summary || summary.every((c) => c.total_displays !== null)) return [];
  return [
    {
      field: CAMPAIGN_TOTAL_WITHHELD_FIELD,
      reason: 'below_min_sample_size',
      detail: fewerThan(
        CORRIDOR_MAP_MIN_COUNT,
        'displays of any one sponsor on any one surface',
        true
      ),
    },
  ];
}
