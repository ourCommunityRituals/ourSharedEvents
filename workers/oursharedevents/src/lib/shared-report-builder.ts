/**
 * OSE-272 Session 5 — SharedReport builder
 *
 * Pure function that reads from D1 and assembles the SharedReport object
 * per the design contract:
 *   docs/features/SHARED-REPORT-READ-API.md
 *
 * Six fields per Session 1 ratified contract:
 *   1. unique_gatherings        — from scan_aggregates.unique_agents (summed)
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

import { CORRIDOR_BASELINE_MIN_SAMPLE } from './shared-report';
import { renderCorridorMap } from './corridor-map';
import { gridRingUnsafe } from 'h3-js';

// Minimum number of distinct anons before return_rate is computed. Below
// this, the denominator is so small that the percentage is identifying
// (e.g., return_rate=50% with sample_size=2 narrows a returner to one
// of two specific people). Suppressed per S5-Q5.
const RETURN_RATE_MIN_SAMPLE = 3;

export type SuppressionReasonCode =
  | 'below_min_sample_size'
  | 'no_baseline_yet'
  | 'no_series'
  | 'materialization_pending';

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
  };

  sponsor_impressions: Array<{
    sponsor_id: string;
    sponsor_name: string;
    surface: string;
    count: number;
  }>;

  poster_attribution: Array<{
    poster_deployment_id: string;
    location: string;
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

  // 2. unique_gatherings — sum scan_aggregates.unique_agents over all
  //    buckets for this event. NULL if no scan_aggregates rows yet.
  const sa = await db
    .prepare(
      `SELECT SUM(unique_agents) AS total, MAX(computed_at) AS computed_at
       FROM scan_aggregates WHERE event_id = ?`
    )
    .bind(eventId)
    .first<{ total: number | null; computed_at: string | null }>();
  const uniqueGatherings = sa?.total ?? null;
  const materializedAt = sa?.computed_at ?? null;

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
    // OTHER event in the same corridor. Requires corridor_id.
    if (event.corridor_id) {
      const corridorRow = await db
        .prepare(
          `SELECT COUNT(DISTINCT a.anon_id_hash) AS c
           FROM anon_id_returns a
           JOIN events e ON e.id = a.venue_id
           WHERE e.corridor_id = ?
             AND a.venue_id != ?
             AND a.anon_id_hash IN (
               SELECT anon_id_hash FROM anon_id_returns WHERE venue_id = ?
             )`
        )
        .bind(event.corridor_id, eventId, eventId)
        .first<{ c: number }>();
      corridorPct = ((corridorRow?.c ?? 0) / distinctAnonsHere) * 100;
    } else {
      suppression.push({
        field: 'return_rate.corridor_pct',
        reason: 'no_baseline_yet',
        detail: 'event has no corridor_id',
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
  if (event.corridor_id) {
    const startDate = new Date(event.start_date);
    const dow = startDate.getUTCDay();
    const hour = startDate.getUTCHours();
    const baseline = await db
      .prepare(
        `SELECT window_30d_count, window_90d_count
         FROM corridor_density_baseline
         WHERE corridor_id = ? AND bucket_dow = ? AND bucket_hour = ?`
      )
      .bind(event.corridor_id, dow, hour)
      .first<{ window_30d_count: number; window_90d_count: number }>();

    thisEventCount = distinctAnonsHere;

    if (baseline) {
      // Apply minimum-sample suppression per Q4 ratified (Session 1):
      // a corridor baseline below 10 events worth of signal is too sparse
      // to publish as a density ratio.
      if (baseline.window_30d_count >= CORRIDOR_BASELINE_MIN_SAMPLE) {
        baseline30d = baseline.window_30d_count;
        densityRatio30d = thisEventCount / baseline.window_30d_count;
      } else {
        suppression.push({
          field: 'corridor_density.baseline_30d',
          reason: 'below_min_sample_size',
          detail: `${baseline.window_30d_count} of ${CORRIDOR_BASELINE_MIN_SAMPLE} required`,
        });
      }
      if (baseline.window_90d_count >= CORRIDOR_BASELINE_MIN_SAMPLE) {
        baseline90d = baseline.window_90d_count;
        densityRatio90d = thisEventCount / baseline.window_90d_count;
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
      detail: 'event has no corridor_id',
    });
  }

  // 5. sponsor_impressions — per sponsor × surface
  const impressions = await db
    .prepare(
      `SELECT
         si.sponsor_id      AS sponsor_id,
         s.name              AS sponsor_name,
         si.surface          AS surface,
         COUNT(*)            AS count
       FROM sponsor_impressions si
       LEFT JOIN sponsors s ON s.id = si.sponsor_id
       WHERE si.event_id = ?
       GROUP BY si.sponsor_id, s.name, si.surface
       ORDER BY count DESC`
    )
    .bind(eventId)
    .all<{ sponsor_id: string; sponsor_name: string | null; surface: string; count: number }>();
  const sponsorImpressions = (impressions.results ?? []).map((r) => ({
    sponsor_id: r.sponsor_id,
    sponsor_name: r.sponsor_name ?? 'unknown',
    surface: r.surface,
    count: r.count,
  }));

  // 6. poster_attribution — per poster_deployment_id
  const posters = await db
    .prepare(
      `SELECT
         pd.id                  AS poster_deployment_id,
         COALESCE(pd.location_desc, pd.placement_label, '(no label)') AS location,
         COUNT(s.id)            AS scan_count,
         MIN(s.created_at)      AS first_scan_at,
         MAX(s.created_at)      AS last_scan_at
       FROM poster_deployments pd
       LEFT JOIN scans s ON s.poster_deployment_id = pd.id AND s.event_id = ?
       WHERE pd.event_id = ?
       GROUP BY pd.id, pd.location_desc, pd.placement_label
       HAVING scan_count > 0
       ORDER BY scan_count DESC`
    )
    .bind(eventId, eventId)
    .all<{
      poster_deployment_id: string;
      location: string;
      scan_count: number;
      first_scan_at: string;
      last_scan_at: string;
    }>();
  const posterAttribution = (posters.results ?? []).map((r) => ({
    poster_deployment_id: r.poster_deployment_id,
    location: r.location,
    scan_count: r.scan_count,
    first_scan_at: r.first_scan_at,
    last_scan_at: r.last_scan_at,
  }));

  // 7. corridor_map — premium hex map of per-cell scan densities (S-6.3.1b).
  //    Source: scan_aggregates.h3_res9 rows for this event.
  //    Fallback (launch-day honesty): event's own h3_res7 corridor cell +
  //    gridRingUnsafe ring neighbors, so "one venue lighting one cell on
  //    day one IS the product" (ring gives the saturation promise context).
  let corridorMap: { svg: string; suppressed: string[]; cell_count: number } | null = null;

  const cellRows = await db
    .prepare(
      `SELECT h3_res9 AS cell, SUM(unique_agents) AS count
         FROM scan_aggregates
         WHERE event_id = ? AND h3_res9 IS NOT NULL
         GROUP BY h3_res9`
    )
    .bind(eventId)
    .all<{ cell: string; count: number }>();

  const cellData = cellRows.results ?? [];

  if (cellData.length > 0) {
    const { svg, suppressed: suppressedCells } = renderCorridorMap(
      cellData.map((r) => ({ cell: r.cell, count: r.count }))
    );
    corridorMap = { svg, suppressed: suppressedCells, cell_count: cellData.length };
    for (const cellId of suppressedCells) {
      suppression.push({
        field: 'corridor_map',
        reason: 'below_min_sample_size',
        detail: `h3 cell ${cellId} suppressed (below privacy floor)`,
      });
    }
  } else if (event.h3_res7) {
    // Launch-day fallback: corridor cell with uniqueGatherings count +
    // ring neighbors at count=0 (suppressed by privacy floor — correct).
    const ring = gridRingUnsafe(event.h3_res7, 1);
    const count = uniqueGatherings ?? 0;
    const cells = [
      { cell: event.h3_res7, count },
      ...ring.map((c: string) => ({ cell: c, count: 0 })),
    ];
    const { svg, suppressed: suppressedCells } = renderCorridorMap(cells);
    corridorMap = { svg, suppressed: suppressedCells, cell_count: cells.length };
    for (const cellId of suppressedCells) {
      suppression.push({
        field: 'corridor_map',
        reason: 'below_min_sample_size',
        detail: `h3 cell ${cellId} suppressed (below privacy floor)`,
      });
    }
  } else {
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
      const inst = await db
        .prepare(
          `SELECT
             e.id              AS event_id,
             e.start_date      AS start_date,
             (SELECT SUM(unique_agents) FROM scan_aggregates WHERE event_id = e.id)
                               AS unique_gatherings
           FROM events e
           WHERE e.series_id = ?
             AND e.start_date IS NOT NULL
           ORDER BY e.start_date ASC`
        )
        .bind(event.series_id)
        .all<{ event_id: string; start_date: string; unique_gatherings: number | null }>();
      for (const r of inst.results ?? []) {
        trendInstances.push({
          event_id: r.event_id,
          start_date: r.start_date,
          unique_gatherings: r.unique_gatherings,
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
      },
      sponsor_impressions: sponsorImpressions,
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
