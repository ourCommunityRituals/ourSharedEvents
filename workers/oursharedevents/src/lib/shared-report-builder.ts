/**
 * OSE-272 Session 5 — SharedReport builder
 *
 * Pure function that reads from D1 and assembles the SharedReport object
 * per the design contract:
 *   docs/features/SHARED-REPORT-READ-API.md
 *
 * Six fields per Session 1 ratified contract:
 *   1. unique_gatherings        — from scan_aggregates.distinct_agent_hashes (summed)
 *   2. return_rate              — % of distinct anons seen at prior events
 *      (per-venue + per-corridor variants)
 *   3. corridor_density         — this event's anon count vs rolling baseline
 *   4. sponsor_impressions[]    — per sponsor × surface
 *   5. poster_attribution[]     — per poster deployment
 *   6. headcount_trend          — across confirmed event_series instances
 *
 * Plus `_meta.suppression_reasons[]` for below-min-sample fields (S5-Q5).
 *
 * Architectural commitments:
 *   - Reads from the main DB only — never reads the forms database
 *     (Gate 1 carries over from earlier sessions).
 *   - Returns aggregate counts only. No `anon_id_hash` ever surfaces.
 *   - Below-min-sample fields are nulled with a structured reason so
 *     consumers know WHY a field is missing (S5-Q5 ratified UX).
 *
 * Build cost: ~6 sequential D1 queries per event. The batch endpoint
 * calls this N times in parallel via Promise.all (S5-Q3 capped at 50).
 */

import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import { renderCorridorMap } from './corridor-map';
import { gridRingUnsafe } from 'h3-js';
import { tagsConsistent } from './h3-tagging';
import { applyCountFloor } from './count-floor';

// OSE-683 — ratified rule "K-anon Per-Bucket Consistency" (2026-08-09): the
// per-bucket K-anon floor (K = CORRIDOR_MAP_MIN_COUNT = 5) is applied PER
// CONTRIBUTING BUCKET BEFORE summation, never to the final sum alone. A
// contributing bucket whose count is below K is DROPPED (it never joins the
// sum); only survivors (count >= K) are summed. This mirrors the portfolio
// -rollup #7 pattern (sumContributingBuckets → applyCountFloor) so a sub-K
// cohort can't be laundered into a large aggregate — nor recovered by
// differencing the aggregate against per-bucket views the same reader can see.
function sumContributingBuckets(rows: Array<{ count: number | null }>): number {
  let sum = 0;
  for (const r of rows) {
    const raw = r.count ?? 0;
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (n >= CORRIDOR_MAP_MIN_COUNT) sum += n;
  }
  return sum;
}

// OSE-596 (rank-8 finding): bucket raw DB timestamps to the hour boundary
// before surfacing in poster_attribution. Sub-second precision exposes timing
// patterns that can correlate individual scan events across anonymised reports.
function bucketToHour(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // pass through unparseable values unchanged
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}

// Minimum number of distinct anons before return_rate is computed. Below
// this, the denominator is so small that the percentage is identifying
// (e.g., return_rate=50% with sample_size=2 narrows a returner to one
// of two specific people). Suppressed per S5-Q5.
const RETURN_RATE_MIN_SAMPLE = 3;

export type SuppressionReasonCode =
  'below_min_sample_size' | 'no_baseline_yet' | 'no_series' | 'materialization_pending';

export interface SuppressionReason {
  field: string;
  reason: SuppressionReasonCode;
  detail?: string;
}

export interface SharedReport {
  event_id: string;
  event_title: string;
  event_start_date: string;
  event_end_date: string | null;

  unique_gatherings: number | null;

  return_rate: {
    venue_pct: number | null;
    corridor_pct: number | null;
    sample_size: number | null;
  };

  corridor_density: {
    this_event_count: number | null;
    baseline_30d: number | null;
    baseline_90d: number | null;
    density_ratio_30d: number | null;
    density_ratio_90d: number | null;
    /** Q5: day-of-week (0=Sunday) used to look up the baseline — same bucket the builder queried. */
    bucket_dow: number | null;
    /** Q5: hour-of-day (0-23 UTC) used to look up the baseline. */
    bucket_hour: number | null;
  };

  sponsor_impressions: Array<{
    sponsor_id: string;
    sponsor_name: string;
    campaign_id: string | null;
    campaign_title: string | null;
    sponsor_tier: string | null;
    is_local: boolean;
    surface: string;
    count: number;
  }>;

  /**
   * Per-campaign aggregate for this event. Null when no sponsors have a
   * campaign_id. Exposed at mid/premium depth — enterprise comparison surface.
   * Each row aggregates all sponsor_impressions rows for the campaign so a
   * brand can compare campaign reach across events via the batch endpoint.
   * impressions_by_surface lets enterprise see which placement formats drove
   * reach without additional client-side grouping.
   */
  campaign_summary: Array<{
    campaign_id: string;
    campaign_title: string;
    total_impressions: number;
    sponsor_count: number;
    impressions_by_surface: Record<string, number>;
  }> | null;

  /**
   * SR-25: Competitive intelligence frame — class-level impression aggregates.
   * local   = community advertisers (is_local=true, Local Sponsor Covenant)
   * mid     = non-local sponsors at silver/bronze/primary tier or unknown tier
   * premium = non-local sponsors at title/platinum/gold tier
   *
   * Lets readers compute: "Are local organic advertisers out-clicking paid
   * investment, or is the spend doing real work?" Classification labels are
   * data IN the report, not access gates ON the reader.
   */
  sponsor_class_breakdown: {
    local: { sponsor_count: number; total_impressions: number };
    mid: { sponsor_count: number; total_impressions: number };
    premium: { sponsor_count: number; total_impressions: number };
  };

  poster_attribution: Array<{
    poster_deployment_id: string;
    location: string;
    h3_res9: string | null;
    scan_count: number;
    first_scan_at: string;
    last_scan_at: string;
  }>;

  headcount_trend: {
    series_id: string | null;
    series_name: string | null;
    instances: Array<{
      event_id: string;
      start_date: string;
      unique_gatherings: number | null;
    }>;
  };

  corridor_map: {
    svg: string;
    suppressed: string[]; // cell IDs under privacy floor — also in _meta.suppression_reasons
    cell_count: number;
    /** Q8: 'live' = per-cell res9 scan data; 'fallback' = res7 neighborhood hex on launch day. */
    source: 'live' | 'fallback';
  } | null;

  _meta: {
    materialized_at: string | null;
    suppression_reasons: SuppressionReason[];
  };
}

export type BuildResult =
  | { ok: true; report: SharedReport }
  | { ok: false; error: 'NOT_FOUND' | 'MATERIALIZATION_PENDING' };

interface EventRow {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  corridor_id: string | null;
  series_id: string | null;
  h3_res9: string | null;
  h3_res7: string | null;
}

export async function buildSharedReport(db: D1Database, eventId: string): Promise<BuildResult> {
  // 1. Resolve the event.
  const event = await db
    .prepare(
      `SELECT id, title, start_date, end_date, corridor_id, series_id, h3_res9, h3_res7
       FROM events WHERE id = ?`
    )
    .bind(eventId)
    .first<EventRow>();
  if (!event) return { ok: false, error: 'NOT_FOUND' };
  if (!event.start_date) {
    // Event exists but has no start_date → materialization can't have run
    // (corridor density bucket needs a start_date). Surface as pending.
    return { ok: false, error: 'MATERIALIZATION_PENDING' };
  }

  const suppression: SuppressionReason[] = [];

  // 2. unique_gatherings — sum scan_aggregates.distinct_agent_hashes over all buckets
  //    for this event. OSE-683: each bucket is a contributing bucket — apply the
  //    per-bucket K-anon floor BEFORE summation (a bucket with distinct_agent_hashes < K
  //    is dropped, not summed raw). NULL if no scan_aggregates rows exist at all
  //    (materialization pending); a suppressed sum (all buckets sub-K, or the
  //    survivors' sum somehow below K) is nulled too so a sub-K value never ships.
  const saMeta = await db
    .prepare(
      `SELECT COUNT(*) AS bucket_count, MAX(computed_at) AS computed_at
       FROM scan_aggregates WHERE event_id = ?`
    )
    .bind(eventId)
    .first<{ bucket_count: number; computed_at: string | null }>();
  const saBuckets = await db
    .prepare(
      `SELECT distinct_agent_hashes AS count
       FROM scan_aggregates WHERE event_id = ?`
    )
    .bind(eventId)
    .all<{ count: number | null }>();
  const materializedAt = saMeta?.computed_at ?? null;
  const hasAnyBucket = (saMeta?.bucket_count ?? 0) > 0;
  // Sum survivors (>= K) per the ratified per-bucket rule, then pass the sum
  // through the shared OSE-665 renderer. floored.count is exact when the
  // survivor sum clears K, else null (suppressed).
  const flooredGatherings = applyCountFloor(sumContributingBuckets(saBuckets.results ?? []));
  const uniqueGatherings = hasAnyBucket ? flooredGatherings.count : null;

  // 3. return_rate — for distinct anon_id_hashes at this event, how many
  //    were also seen at prior events (any other venue_id).
  let venuePct: number | null = null;
  let corridorPct: number | null = null;
  let sampleSize: number | null = null;
  const air = await db
    .prepare(`SELECT COUNT(DISTINCT anon_id_hash) AS c FROM anon_id_returns WHERE venue_id = ?`)
    .bind(eventId)
    .first<{ c: number }>();
  const distinctAnonsHere = air?.c ?? 0;
  if (distinctAnonsHere >= RETURN_RATE_MIN_SAMPLE) {
    sampleSize = distinctAnonsHere;
    // venue_pct — same-venue means same event_id in v1 (no separate venues
    // table). So venue_pct asks: of the anons at THIS event, what fraction
    // were also at the SAME event before? With (anon, venue) PK and an
    // event having a single venue_id, this would be 100% by construction
    // — so we instead interpret "venue" as "this event_id" and the answer
    // is "how many returners have visit_count > 1" (came multiple times
    // to the same event window — relevant only for multi-day events).
    const repeatRow = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM anon_id_returns
         WHERE venue_id = ? AND visit_count > 1`
      )
      .bind(eventId)
      .first<{ c: number }>();
    venuePct = ((repeatRow?.c ?? 0) / distinctAnonsHere) * 100;

    // corridor_pct — fraction of anons at THIS event who appeared at any
    // OTHER event in the same corridor. Uses h3_res7 (BE-24b) falling back
    // to corridor_id for legacy events geocoded before BE-24b landed.
    const corridorKey = event.h3_res7 ?? event.corridor_id;
    if (corridorKey) {
      const corridorRow = await db
        .prepare(
          `SELECT COUNT(DISTINCT a.anon_id_hash) AS c
           FROM anon_id_returns a
           JOIN events e ON e.id = a.venue_id
           WHERE COALESCE(e.h3_res7, e.corridor_id) = ?
             AND a.venue_id != ?
             AND a.anon_id_hash IN (
               SELECT anon_id_hash FROM anon_id_returns WHERE venue_id = ?
             )`
        )
        .bind(corridorKey, eventId, eventId)
        .first<{ c: number }>();
      corridorPct = ((corridorRow?.c ?? 0) / distinctAnonsHere) * 100;
    } else {
      suppression.push({
        field: 'return_rate.corridor_pct',
        reason: 'no_baseline_yet',
        detail: 'event has no h3_res7 or corridor_id',
      });
    }
  } else if (distinctAnonsHere > 0) {
    suppression.push({
      field: 'return_rate',
      reason: 'below_min_sample_size',
      detail: `${distinctAnonsHere} of ${RETURN_RATE_MIN_SAMPLE} required distinct anons`,
    });
  }

  // 4. corridor_density — this event's anon count vs (corridor, dow, hour)
  //    baseline. NULL if no corridor or no baseline row yet.
  let thisEventCount: number | null = null;
  let baseline30d: number | null = null;
  let baseline90d: number | null = null;
  let densityRatio30d: number | null = null;
  let densityRatio90d: number | null = null;
  // Q5: hoisted so dow/hour are available in the return object regardless of branch taken.
  let corridorDow: number | null = null;
  let corridorHour: number | null = null;
  const densityCorridorKey = event.h3_res7 ?? event.corridor_id;
  if (densityCorridorKey && event.start_date) {
    const startDate = new Date(event.start_date);
    corridorDow = startDate.getUTCDay();
    corridorHour = startDate.getUTCHours();
    const dow = corridorDow;
    const hour = corridorHour;
    const baseline = await db
      .prepare(
        `SELECT window_30d_count, window_90d_count
         FROM corridor_density_baseline
         WHERE corridor_id = ? AND bucket_dow = ? AND bucket_hour = ?`
      )
      .bind(densityCorridorKey, dow, hour)
      .first<{ window_30d_count: number; window_90d_count: number }>();

    // DS-01 (Critical): this_event_count = COUNT(DISTINCT anon_id_hash) is a raw
    // small-cohort count (can be 1–4). Every other aggregate in this report routes
    // through applyCountFloor (K = CORRIDOR_MAP_MIN_COUNT = 5); this one did not, so
    // it published the exact sub-K numerator — and density_ratio = count / baseline
    // re-exposed that exact numerator even had the count itself been hidden. Apply the
    // SAME uniform floor: sub-K → null (suppressed), >= K → exact. Below the floor the
    // ratios are NOT computed, so they cannot leak the raw numerator by division.
    const flooredThisEvent = applyCountFloor(distinctAnonsHere);
    thisEventCount = flooredThisEvent.count;
    if (flooredThisEvent.suppressed && distinctAnonsHere > 0) {
      suppression.push({
        field: 'corridor_density.this_event_count',
        reason: 'below_min_sample_size',
        detail: `fewer than ${CORRIDOR_MAP_MIN_COUNT} distinct attendees`,
      });
    }

    if (baseline) {
      // Apply minimum-sample suppression per Q4 ratified (Session 1):
      // a corridor baseline below 10 events worth of signal is too sparse
      // to publish as a density ratio.
      // DS-01: density_ratio is ALSO gated on thisEventCount clearing the K-anon
      // floor. When this_event_count is suppressed (null), the ratio would re-expose
      // the exact sub-K numerator (raw = ratio * baseline), so it is left null.
      if (baseline.window_30d_count >= CORRIDOR_BASELINE_MIN_SAMPLE) {
        baseline30d = baseline.window_30d_count;
        // DS-01: only compute the ratio when this_event_count cleared the K-anon
        // floor. If it is suppressed (null), the ratio (= raw / baseline) would
        // re-expose the exact sub-K numerator, so leave it null.
        densityRatio30d =
          thisEventCount !== null ? thisEventCount / baseline.window_30d_count : null;
      } else {
        suppression.push({
          field: 'corridor_density.baseline_30d',
          reason: 'below_min_sample_size',
          detail: `${baseline.window_30d_count} of ${CORRIDOR_BASELINE_MIN_SAMPLE} required`,
        });
      }
      if (baseline.window_90d_count >= CORRIDOR_BASELINE_MIN_SAMPLE) {
        baseline90d = baseline.window_90d_count;
        // DS-01: same K-anon gate as the 30d ratio above.
        densityRatio90d =
          thisEventCount !== null ? thisEventCount / baseline.window_90d_count : null;
      } else {
        suppression.push({
          field: 'corridor_density.baseline_90d',
          reason: 'below_min_sample_size',
          detail: `${baseline.window_90d_count} of ${CORRIDOR_BASELINE_MIN_SAMPLE} required`,
        });
      }
    } else {
      suppression.push({
        field: 'corridor_density',
        reason: 'no_baseline_yet',
        detail: 'no corridor_density_baseline row for this (corridor, dow, hour)',
      });
    }
  } else {
    suppression.push({
      field: 'corridor_density',
      reason: 'no_baseline_yet',
      detail: 'event has no h3_res7 or corridor_id',
    });
  }

  // 5. sponsor_impressions — per sponsor × surface, including campaign linkage,
  //    sponsor tier, and local-sponsor flag. D1 returns INTEGER booleans (0/1).
  // OSE-799 A2: identity (name) comes from sponsor_business; the per-event
  // economics (campaign, tier, locality) come from the sponsor_placement for THIS
  // event. Join both off si.sponsor_id (= sponsor_business.id) — placement scoped
  // to si.event_id so a business at multiple events reads its own per-event tier.
  const impressions = await db
    .prepare(
      `SELECT
         si.sponsor_id      AS sponsor_id,
         sb.name            AS sponsor_name,
         sp.campaign_id     AS campaign_id,
         c.title            AS campaign_title,
         sp.tier            AS sponsor_tier,
         sp.locality_band   AS is_local,
         si.surface         AS surface,
         COUNT(*)           AS count
       FROM sponsor_impressions si
       LEFT JOIN sponsor_business sb ON sb.id = si.sponsor_id
       LEFT JOIN sponsor_placement sp
              ON sp.sponsor_business_id = si.sponsor_id AND sp.event_id = si.event_id
       LEFT JOIN campaigns c ON c.id = sp.campaign_id
       WHERE si.event_id = ?
       GROUP BY si.sponsor_id, sb.name, sp.campaign_id, c.title, sp.tier, sp.locality_band, si.surface
       ORDER BY count DESC`
    )
    .bind(eventId)
    .all<{
      sponsor_id: string;
      sponsor_name: string | null;
      campaign_id: string | null;
      campaign_title: string | null;
      sponsor_tier: string | null;
      is_local: number | null;
      surface: string;
      count: number;
    }>();
  const sponsorImpressions = (impressions.results ?? []).map((r) => ({
    sponsor_id: r.sponsor_id,
    sponsor_name: r.sponsor_name ?? 'unknown',
    campaign_id: r.campaign_id ?? null,
    campaign_title: r.campaign_title ?? null,
    sponsor_tier: r.sponsor_tier ?? null,
    is_local: r.is_local === 1,
    surface: r.surface,
    count: r.count,
  }));

  // Derive campaign_summary by aggregating sponsorImpressions rows that have
  // a campaign_id. No extra DB call — the data is already fetched above.
  // OSE-683: each (sponsor × surface) impression row is a contributing bucket.
  // Apply the per-bucket K-anon floor BEFORE summation — a row with count < K is
  // DROPPED, never summed raw — so a sub-K impression cohort can't be laundered
  // into a campaign total (nor recovered by differencing against the exact
  // per-surface sponsor_impressions rows the same reader can already see).
  const campaignMap = new Map<
    string,
    {
      campaign_id: string;
      campaign_title: string;
      total_impressions: number;
      sponsor_count: number;
      impressions_by_surface: Record<string, number>;
    }
  >();
  for (const row of sponsorImpressions) {
    if (!row.campaign_id) continue;
    const floored = applyCountFloor(row.count);
    if (floored.count === null) continue; // sub-K bucket — drop before summation
    const contribution = floored.count;
    const existing = campaignMap.get(row.campaign_id);
    if (existing) {
      existing.total_impressions += contribution;
      existing.sponsor_count += 1;
      existing.impressions_by_surface[row.surface] =
        (existing.impressions_by_surface[row.surface] ?? 0) + contribution;
    } else {
      campaignMap.set(row.campaign_id, {
        campaign_id: row.campaign_id,
        campaign_title: row.campaign_title ?? 'unknown',
        total_impressions: contribution,
        sponsor_count: 1,
        impressions_by_surface: { [row.surface]: contribution },
      });
    }
  }
  const campaignSummary =
    campaignMap.size > 0
      ? [...campaignMap.values()].sort((a, b) => b.total_impressions - a.total_impressions)
      : null;

  // SR-25: sponsor_class_breakdown — class-level aggregates from sponsorImpressions.
  // Mapping: is_local=true → 'local'; non-local + tier in top set → 'premium'; else → 'mid'.
  // Inline classification — this file must stay tier-blind (invariant #5 tier_equity).
  const PREMIUM_TIERS = new Set(['title', 'platinum', 'gold']);
  function classifySponsor(tier: string | null, isLocal: boolean): 'local' | 'mid' | 'premium' {
    if (isLocal) return 'local';
    return tier !== null && PREMIUM_TIERS.has(tier) ? 'premium' : 'mid';
  }
  const sponsorClassBreakdown: {
    local: { sponsor_count: number; total_impressions: number };
    mid: { sponsor_count: number; total_impressions: number };
    premium: { sponsor_count: number; total_impressions: number };
  } = {
    local: { sponsor_count: 0, total_impressions: 0 },
    mid: { sponsor_count: 0, total_impressions: 0 },
    premium: { sponsor_count: 0, total_impressions: 0 },
  };
  // OSE-683: each (sponsor × surface) impression row is a contributing bucket —
  // floor it per bucket BEFORE summation. A sub-K row is dropped from the class
  // total (and does not, on its own, count the sponsor into the class): only
  // rows that individually clear K contribute, matching the campaign_summary and
  // unique_gatherings treatment so no surface leaks a sub-K aggregate.
  const seenSponsorClass = new Map<string, 'local' | 'mid' | 'premium'>();
  for (const row of sponsorImpressions) {
    const floored = applyCountFloor(row.count);
    if (floored.count === null) continue; // sub-K bucket — drop before summation
    const cls = classifySponsor(row.sponsor_tier, row.is_local);
    if (!seenSponsorClass.has(row.sponsor_id)) {
      seenSponsorClass.set(row.sponsor_id, cls);
      sponsorClassBreakdown[cls].sponsor_count += 1;
    }
    sponsorClassBreakdown[cls].total_impressions += floored.count;
  }

  // 6. poster_attribution — per poster_deployment_id
  const posters = await db
    .prepare(
      `SELECT
         pd.id                  AS poster_deployment_id,
         COALESCE(pd.location_desc, pd.placement_label, '(no label)') AS location,
         pd.h3_res9             AS h3_res9,
         COUNT(s.id)            AS scan_count,
         MIN(s.created_at)      AS first_scan_at,
         MAX(s.created_at)      AS last_scan_at
       FROM poster_deployments pd
       LEFT JOIN scan_placement_events s ON s.poster_deployment_id = pd.id AND s.event_id = ?
       WHERE pd.event_id = ?
       GROUP BY pd.id, pd.location_desc, pd.placement_label, pd.h3_res9
       HAVING scan_count > 0
       ORDER BY scan_count DESC`
    )
    .bind(eventId, eventId)
    .all<{
      poster_deployment_id: string;
      location: string;
      h3_res9: string | null;
      scan_count: number;
      first_scan_at: string;
      last_scan_at: string;
    }>();
  // OSE-711: K-anon floor on poster scan_count. `HAVING scan_count > 0` is a
  // presence filter, NOT a privacy floor — a poster with 1–4 scans would
  // publish an exact sub-K count ALONGSIDE its h3_res9 geolocation, i.e. a
  // location-correlated small-cohort disclosure available at mid+ depth. Every
  // other aggregate here already routes through applyCountFloor; poster rows did
  // not. Apply the same uniform floor and DROP any deployment below it: a
  // suppressed-but-present row still discloses "a poster at this hex drew a
  // small crowd," which is exactly the leak, so sub-K deployments must not
  // appear at all. Deployments at or above the floor keep their exact count.
  const posterAttribution = (posters.results ?? [])
    .map((r) => ({ r, floored: applyCountFloor(r.scan_count) }))
    .filter((x) => !x.floored.suppressed)
    .map(({ r, floored }) => ({
      poster_deployment_id: r.poster_deployment_id,
      location: r.location,
      h3_res9: r.h3_res9 ?? null,
      scan_count: floored.count as number,
      first_scan_at: bucketToHour(r.first_scan_at),
      last_scan_at: bucketToHour(r.last_scan_at),
    }));

  // 7. corridor_map — premium hex map of per-cell scan densities (S-6.3.1b).
  //    Source: scan_aggregates.h3_res9 rows for this event.
  //    Fallback (launch-day honesty): event's own h3_res7 corridor cell +
  //    gridRingUnsafe ring neighbors, so "one venue lighting one cell on
  //    day one IS the product" (ring gives the saturation promise context).
  let corridorMap: {
    svg: string;
    suppressed: string[];
    cell_count: number;
    source: 'live' | 'fallback';
  } | null = null;

  // Q10: integrity check — if stored H3 tags are inconsistent (res9 parent ≠ stored res7),
  // the map cells are geographically incoherent. Emit a suppression warning and skip the
  // fallback path so the map doesn't render misleading neighborhood geometry.
  let h3TagsCorrupt = false;
  if (
    event.h3_res9 &&
    event.h3_res7 &&
    !tagsConsistent({ h3_res9: event.h3_res9, h3_res7: event.h3_res7 })
  ) {
    h3TagsCorrupt = true;
    suppression.push({
      field: 'corridor_map',
      reason: 'materialization_pending',
      detail: 'stored H3 tags are inconsistent — re-tag the event to restore corridor map',
    });
  }

  function buildCorridorMap(
    cells: Array<{ cell: string; count: number }>,
    source: 'live' | 'fallback'
  ): void {
    const { svg, suppressed: suppressedCells } = renderCorridorMap(cells, {
      minCount: CORRIDOR_MAP_MIN_COUNT,
    });
    corridorMap = { svg, suppressed: suppressedCells, cell_count: cells.length, source };
    // Q: strip H3 cell IDs from suppression detail — cell IDs are trivially reverse-geocoded,
    // which would undermine the privacy floor's intent. Count is enough context.
    for (let i = 0; i < suppressedCells.length; i++) {
      suppression.push({
        field: 'corridor_map',
        reason: 'below_min_sample_size',
        detail: `area ${i + 1} of ${suppressedCells.length} suppressed — fewer than ${CORRIDOR_MAP_MIN_COUNT} scans recorded`,
      });
    }
  }

  const cellRows = await db
    .prepare(
      `SELECT h3_res9 AS cell, SUM(distinct_agent_hashes) AS count
         FROM scan_aggregates
         WHERE event_id = ? AND h3_res9 IS NOT NULL
         GROUP BY h3_res9`
    )
    .bind(eventId)
    .all<{ cell: string; count: number }>();

  const cellData = cellRows.results ?? [];

  if (cellData.length > 0) {
    buildCorridorMap(
      cellData.map((r) => ({ cell: r.cell, count: r.count })),
      'live'
    );
  } else if (event.h3_res7 && !h3TagsCorrupt) {
    // Launch-day fallback: res7 neighborhood hex lit with uniqueGatherings count +
    // ring-1 neighbors at count=0 (suppressed by privacy floor — correct).
    // source='fallback' lets the client render accurate "neighborhood" copy (not "block").
    const ring = gridRingUnsafe(event.h3_res7, 1);
    const count = uniqueGatherings ?? 0;
    buildCorridorMap(
      [{ cell: event.h3_res7, count }, ...ring.map((c: string) => ({ cell: c, count: 0 }))],
      'fallback'
    );
  } else if (!h3TagsCorrupt) {
    suppression.push({
      field: 'corridor_map',
      reason: 'materialization_pending',
      detail: 'event has no h3 cells tagged; update event lat/lon to enable corridor map',
    });
  }

  // 8. headcount_trend — across confirmed event_series instances
  let trendSeriesId: string | null = null;
  let trendSeriesName: string | null = null;
  const trendInstances: Array<{
    event_id: string;
    start_date: string;
    unique_gatherings: number | null;
  }> = [];
  if (event.series_id) {
    const series = await db
      .prepare(`SELECT id, series_name, state FROM event_series WHERE id = ?`)
      .bind(event.series_id)
      .first<{ id: string; series_name: string; state: string }>();
    if (series && series.state === 'confirmed') {
      trendSeriesId = series.id;
      trendSeriesName = series.series_name;
      // OSE-683: each scan_aggregates bucket is a contributing bucket to a trend
      // instance's headcount — the SAME grain as the top-level unique_gatherings.
      // The previous `SELECT SUM(distinct_agent_hashes) ...` subquery summed buckets RAW
      // per instance, so a per-instance trend point could publish a sub-K sum
      // (or launder a sub-K bucket into it) — exactly the leak the ratified
      // per-bucket rule forbids. Fetch the events in the series and their raw
      // buckets, then floor PER CONTRIBUTING BUCKET before summation (drop
      // sub-K buckets; a survivor sum that itself fails to clear K is nulled),
      // mirroring `uniqueGatherings` above. An instance with no buckets at all
      // stays null (materialization pending for that instance).
      const inst = await db
        .prepare(
          `SELECT id AS event_id, start_date
             FROM events
            WHERE series_id = ?
              AND start_date IS NOT NULL
            ORDER BY start_date ASC`
        )
        .bind(event.series_id)
        .all<{ event_id: string; start_date: string }>();
      for (const r of inst.results ?? []) {
        const instBuckets = await db
          .prepare(
            `SELECT distinct_agent_hashes AS count
               FROM scan_aggregates WHERE event_id = ?`
          )
          .bind(r.event_id)
          .all<{ count: number | null }>();
        const instRows = instBuckets.results ?? [];
        const instHasBucket = instRows.length > 0;
        const instFloored = applyCountFloor(sumContributingBuckets(instRows));
        trendInstances.push({
          event_id: r.event_id,
          start_date: r.start_date,
          unique_gatherings: instHasBucket ? instFloored.count : null,
        });
      }
    } else {
      suppression.push({
        field: 'headcount_trend',
        reason: 'no_series',
        detail: 'event_series row is not in confirmed state',
      });
    }
  } else {
    suppression.push({
      field: 'headcount_trend',
      reason: 'no_series',
      detail: 'event has no series_id',
    });
  }

  // Surface materialization pending when essentially no signal exists yet.
  if (uniqueGatherings === null && distinctAnonsHere === 0 && sponsorImpressions.length === 0) {
    suppression.push({
      field: '_event',
      reason: 'materialization_pending',
      detail: 'no scan_aggregates, anon_id_returns, or sponsor_impressions for this event yet',
    });
  }

  return {
    ok: true,
    report: {
      event_id: event.id,
      event_title: event.title,
      event_start_date: event.start_date,
      event_end_date: event.end_date,
      unique_gatherings: uniqueGatherings,
      return_rate: {
        venue_pct: venuePct,
        corridor_pct: corridorPct,
        sample_size: sampleSize,
      },
      corridor_density: {
        this_event_count: thisEventCount,
        baseline_30d: baseline30d,
        baseline_90d: baseline90d,
        density_ratio_30d: densityRatio30d,
        density_ratio_90d: densityRatio90d,
        bucket_dow: corridorDow,
        bucket_hour: corridorHour,
      },
      sponsor_impressions: sponsorImpressions,
      campaign_summary: campaignSummary,
      sponsor_class_breakdown: sponsorClassBreakdown,
      poster_attribution: posterAttribution,
      headcount_trend: {
        series_id: trendSeriesId,
        series_name: trendSeriesName,
        instances: trendInstances,
      },
      corridor_map: corridorMap,
      _meta: {
        materialized_at: materializedAt,
        suppression_reasons: suppression,
      },
    },
  };
}
