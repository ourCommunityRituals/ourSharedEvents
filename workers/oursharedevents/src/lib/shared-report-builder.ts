/**
 * OSE-272 Session 5 — SharedReport builder
 *
 * Pure function that reads from D1 and assembles the SharedReport object
 * per the design contract:
 *   docs/features/SHARED-REPORT-READ-API.md
 *
 * Six fields per Session 1 ratified contract:
 *   1. scans        — the sum of the published poster_attribution rows
 *                                 (OSE-1784: the report's one figure: scans of the code, OSE-2214)
 *   2. (return_rate, retired by OSE-2214: it followed one phone across events)
 *   3. corridor_density         — scans vs the corridor's rolling baseline
 *   4. sponsor_displays[]    — per sponsor × surface
 *   5. poster_attribution[]     — per poster deployment
 *   6. scan_trend          — across confirmed event_series instances
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

import { campaignWithheldReasons, summarizeCampaigns, type CampaignLink } from './campaign-summary';
import { EFFECTIVE_CAMPAIGN_ID_SQL } from './campaigns';
import {
  classWithheldReasons,
  summarizeSponsorClasses,
  type ClassPlacement,
} from './sponsor-class-breakdown';
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from './shared-report';
import { renderLayerMap, type AreaCount, type LayerSummary } from './ncr/layer-stack';
import { OER_GEOGRAPHIES } from './ncr/corridor-geographies.generated';
import { OER_RINGS } from './ncr/report-rings';
import { gridRingUnsafe } from 'h3-js';
import { POSTER_HOUR_CAP } from './poster-hour-cap';
import { tagsConsistent } from './h3-tagging';
import {
  applyCountFloor,
  floorCorridorBaseline,
  floorTotalOfParts,
  publishCount,
  PUBLISH_ROUNDING,
  roundForPublish,
} from './count-floor';
import { eventUsesSponsorsSql, sponsorTitle } from './sponsor-card';
import {
  formatHourBucketLabel,
  parseUtcInstant,
  resolveEventZone,
  type EventZone,
} from './event-datetime';

/**
 * The corridor key an event is reported under (ADR-011 / OSE-616): its res7
 * cell, LOWERCASED, else a legacy corridor_id. refreshCorridorBaselines groups
 * by COALESCE(LOWER(h3_res7), corridor_id), so a reader that bound the raw
 * cell would miss the baseline of an event stored with an uppercase cell.
 */
function corridorKeyOf(event: {
  h3_res7: string | null;
  corridor_id: string | null;
}): string | null {
  return event.h3_res7 ? event.h3_res7.toLowerCase() : event.corridor_id;
}

// OSE-683 — ratified rule "K-anon Per-Bucket Consistency" (2026-08-09): the
// per-bucket K-anon floor (K = CORRIDOR_MAP_MIN_COUNT = 5) is applied PER
// CONTRIBUTING BUCKET BEFORE summation, never to the final sum alone. A
// contributing bucket whose count is below K is DROPPED (it never joins the
// sum); only survivors (count >= K) are summed, so a sub-K cohort can't be
// laundered into a large aggregate — nor recovered by differencing the
// aggregate against per-bucket views the same reader can see. The rule lives in
// ONE place, `floorTotalOfParts` (lib/count-floor.ts); every total below that
// is published beside its parts goes through it.

// OSE-596 (rank-8 finding): bucket raw DB timestamps to the hour boundary
// before surfacing in poster_attribution. Sub-second precision exposes timing
// patterns that can correlate individual scan events across anonymised reports.
/**
 * The event's series, when it is confirmed and belongs to the event's brand.
 *
 * Part of OSE-1421 (owner ruling 2026-10-01): a series never groups events
 * across brands. `event_series` has no brand column, so the series' brand is
 * its anchor event's brand; a series anchored at another brand's event is
 * withheld whole (its name is another tenant's label). Callers brand-fence the
 * series' instances as well, so legacy cross-brand rows cannot leak.
 */
async function confirmedSeriesOf(
  db: D1Database,
  event: { series_id: string | null; brand_id: string }
): Promise<{ id: string; series_name: string } | null> {
  if (!event.series_id) return null;
  const series = await db
    .prepare(
      `SELECT es.id, es.series_name, es.state
         FROM event_series es
         JOIN events anchor ON anchor.id = es.venue_id
        WHERE es.id = ? AND anchor.brand_id = ?`
    )
    .bind(event.series_id, event.brand_id)
    .first<{ id: string; series_name: string; state: string }>();
  return series && series.state === 'confirmed'
    ? { id: series.id, series_name: series.series_name }
    : null;
}

function bucketToHour(iso: string): string {
  // OSE-1376: created_at is SQLite `datetime('now')` ("YYYY-MM-DD HH:MM:SS", UTC,
  // no offset) — parse it as UTC explicitly, never as the runtime's local time.
  const d = parseUtcInstant(iso);
  if (!d) return iso; // pass through unparseable values unchanged
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}

export type SuppressionReasonCode =
  'below_min_sample_size' | 'no_baseline_yet' | 'no_series' | 'materialization_pending';

export interface SuppressionReason {
  field: string;
  reason: SuppressionReasonCode;
  detail?: string;
}

export interface PublishedCorridorBaseline {
  baseline_30d: number | null;
  baseline_90d: number | null;
  density_ratio_30d: number | null;
  density_ratio_90d: number | null;
  suppression: SuppressionReason[];
}

/**
 * What the report carries for one corridor_density_baseline row (OSE-1751).
 *
 * The windows go through `floorCorridorBaseline`, which the export also calls, so
 * the two surfaces cannot publish different numbers for one row. A ratio is built
 * on the published window and only when this event's own count was published
 * (DS-01: a ratio of a withheld count re-exposes it). Every withheld window gets
 * the same entry, whether it was under the floor or held back by the chain, so
 * the report does not say which case applied.
 */
export function publishCorridorBaseline(
  baseline: { window_30d_count: number; window_90d_count: number },
  thisEventCount: number | null
): PublishedCorridorBaseline {
  const { window_30d, window_90d } = floorCorridorBaseline(
    baseline.window_90d_count,
    baseline.window_30d_count
  );
  const suppression: SuppressionReason[] = [];
  const withheld = (field: string): void => {
    suppression.push({
      field,
      reason: 'below_min_sample_size',
      detail: `a baseline of fewer than ${CORRIDOR_BASELINE_MIN_SAMPLE} (the published poster figures of the corridor's events in this weekday and hour, added up), or one too close to the other window to publish, is withheld`,
    });
  };
  if (window_30d === null) withheld('corridor_density.baseline_30d');
  if (window_90d === null) withheld('corridor_density.baseline_90d');
  return {
    baseline_30d: window_30d,
    baseline_90d: window_90d,
    density_ratio_30d:
      thisEventCount !== null && window_30d !== null ? thisEventCount / window_30d : null,
    density_ratio_90d:
      thisEventCount !== null && window_90d !== null ? thisEventCount / window_90d : null,
    suppression,
  };
}

/**
 * The campaign of each sponsor placed at this event (OSE-2046).
 *
 * The campaign is read as the `sponsor_displays` statement in `buildSharedReport`
 * reads it: the EFFECTIVE one (the event's when the event is in one, else the
 * placement's own, ADR-030 D8), and only a campaign of the event's own brand.
 *
 * It starts from the placements, not from the displays, so which campaigns a
 * report lists never depends on how often anything was shown. A placement
 * counts when both sides accepted it and the event chose sponsors (invariant 6,
 * OSE-1900): a sponsor that has not agreed, or was declined, is not counted and
 * does not put its campaign on a report. The event's status is not read, since a
 * report is mostly read after the event has ended.
 */
async function readCampaignLinks(db: D1Database, eventId: string): Promise<CampaignLink[]> {
  const links = await db
    .prepare(
      `SELECT DISTINCT
         c.id                   AS campaign_id,
         c.title                AS campaign_title,
         sp.sponsor_business_id AS sponsor_id
       FROM sponsor_placement sp
       JOIN events e ON e.id = sp.event_id
       LEFT JOIN campaigns ec ON ec.id = e.campaign_id AND ec.brand_id = e.brand_id
       JOIN campaigns c ON c.id = ${EFFECTIVE_CAMPAIGN_ID_SQL} AND c.brand_id = e.brand_id
       WHERE sp.event_id = ?
         AND sp.is_active = 1
         AND sp.sponsor_accepted = 1
         AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
         AND ${eventUsesSponsorsSql('e')}
       ORDER BY c.id, sp.sponsor_business_id`
    )
    .bind(eventId)
    .all<CampaignLink>();
  return links.results ?? [];
}

/**
 * The sponsors taking part in the event, each with the class it is placed in,
 * for `sponsor_class_breakdown[].sponsor_count` (owner ruling 2026-11-16,
 * OSE-2089: the count is of each sponsor participating in the event).
 *
 * The same rule as `readCampaignLinks` above: a placement counts when both
 * sides accepted it and the event chose sponsors (invariant 6). It starts from
 * the placements, never the displays, so the count does not depend on how often
 * anything was shown.
 */
async function readClassPlacements(db: D1Database, eventId: string): Promise<ClassPlacement[]> {
  const rows = await db
    .prepare(
      `SELECT sp.sponsor_business_id AS sponsor_id,
              sp.tier                AS sponsor_tier,
              sp.locality_band       AS is_local
       FROM sponsor_placement sp
       JOIN events e ON e.id = sp.event_id
       WHERE sp.event_id = ?
         AND sp.is_active = 1
         AND sp.sponsor_accepted = 1
         AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
         AND ${eventUsesSponsorsSql('e')}
       ORDER BY sp.sponsor_business_id`
    )
    .bind(eventId)
    .all<{ sponsor_id: string; sponsor_tier: string | null; is_local: number | null }>();
  return (rows.results ?? []).map((r) => ({
    sponsor_id: r.sponsor_id,
    sponsor_tier: r.sponsor_tier ?? null,
    is_local: r.is_local === 1,
  }));
}

export interface SharedReport {
  event_id: string;
  event_title: string;
  event_start_date: string;
  event_end_date: string | null;

  /**
   * The report's one figure (OSE-1784; scans of the code since OSE-2214): the sum of the
   * published `poster_attribution` rows. `corridor_density.this_event_count` and
   * this event's `scan_trend` instance are the same number. Null when no
   * poster row is published.
   */
  scans: number | null;

  /**
   * OSE-2214: true when any published poster hour reached the cap of 100 stored
   * scans, so `scans` (and `corridor_density.this_event_count`, the same number)
   * is a lower bound and reads "or more". Never true when `scans` is null.
   */
  scans_at_least: boolean;

  /**
   * Rc — anonymous digital click-out counts from the /s/ routing layer, per
   * destination kind (public/donate/signup/…). Group-level counter only (no IP,
   * no per-visitor id, no cookie, no referrer); each kind passes the same K=5
   * floor as scans, and `total` is the sum of the kinds that are
   * published (null when none is), so a sub-K count never ships and cannot be
   * had by subtraction. This is the digital half of the flywheel — surfaced on
   * the SharedReport / post-event recap only (never pre/event/poster, OSE-509).
   */
  click_outs: {
    by_kind: Record<string, number | null>;
    total: number | null;
  } | null;

  corridor_density: {
    this_event_count: number | null;
    baseline_30d: number | null;
    baseline_90d: number | null;
    density_ratio_30d: number | null;
    density_ratio_90d: number | null;
    /** Q5: day-of-week (0=Sunday) used to look up the baseline — same bucket the builder queried. */
    bucket_dow: number | null;
    /**
     * Q5: hour-of-day (0-23 UTC) used to look up the baseline. A UTC LOOKUP KEY
     * that must match corridor_density_baseline's UTC-keyed rows — never a
     * display label (OSE-1376: the page does not render it as a time of day).
     */
    bucket_hour: number | null;
  };

  sponsor_displays: Array<{
    sponsor_id: string;
    sponsor_name: string;
    /** The name the public sees: display name, else the business name (OSE-1431). */
    sponsor_title: string;
    campaign_id: string | null;
    campaign_title: string | null;
    sponsor_tier: string | null;
    is_local: boolean;
    surface: string;
    count: number;
  }>;

  /**
   * Per-campaign aggregate for this event (`summarizeCampaigns`). Null when no
   * placement of the event is in a campaign. Exposed at mid/premium depth, the
   * enterprise comparison surface: a brand can compare campaign reach across
   * events via the batch endpoint, and displays_by_surface says which placement
   * formats drove it.
   */
  campaign_summary: Array<{
    campaign_id: string;
    campaign_title: string;
    /**
     * Displays of the campaign's sponsors at this event: the sum of the
     * (sponsor x surface) rows published in `sponsor_displays`. Null when no row
     * of the campaign reached the floor (withheld; 0 reads the same as 1 to 4).
     */
    total_displays: number | null;
    /**
     * Distinct sponsors in the campaign at this event: those placed and accepted
     * by both sides, and any other with a published row. A count of businesses
     * that agreed to be shown, not of people or what they did (the `entity`
     * class of lib/dashboard-contract.ts), so it is exact and has no floor, and
     * each sponsor counts once however many surfaces it is on. It does not move
     * with displays under the floor.
     */
    sponsor_count: number;
    /** Per surface, the published rows only. A surface with none is absent. */
    displays_by_surface: Record<string, number>;
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
  sponsor_class_breakdown: Record<
    'local' | 'mid' | 'premium',
    {
      /**
       * Distinct sponsors taking part in the event in this class: those placed
       * and accepted by both sides, and any other with a published row (owner
       * ruling 2026-11-16). A count of businesses that agreed to be shown (the
       * `entity` class of lib/dashboard-contract.ts), so it is exact and has no
       * floor, and it does not move with displays at all.
       */
      sponsor_count: number;
      /**
       * The sum of the (sponsor x surface) rows published for the class. Null
       * when no row of the class reached the floor (withheld; 0 reads the same
       * as 1 to 4, and a class with no sponsor reads the same too).
       */
      total_displays: number | null;
    }
  >;

  poster_attribution: Array<{
    poster_deployment_id: string;
    location: string;
    h3_res9: string | null;
    scan_count: number;
    /**
     * OSE-2214: true when at least one hour at this poster reached the cap of
     * POSTER_HOUR_CAP stored scans (lib/poster-hour-cap.ts). Scans past the cap
     * are sent on but not stored, so the count is then a lower bound and the
     * page reads it as "or more".
     */
    hour_cap_reached: boolean;
    /** UTC hour bucket (ISO-8601 `Z`) — the stored cell, unchanged. */
    first_scan_at: string;
    last_scan_at: string;
    /**
     * OSE-1376: the same UTC hour buckets labelled in the EVENT's zone
     * (`_meta.timezone.zone`), e.g. "Sat, Oct 24 · 7 PM CDT". Label only —
     * never a re-bucketing, so the hourly floor is untouched. '' if unparseable.
     */
    first_scan_label: string;
    last_scan_label: string;
  }>;

  scan_trend: {
    series_id: string | null;
    series_name: string | null;
    instances: Array<{
      event_id: string;
      start_date: string;
      scans: number | null;
      /** OSE-2214: that instance's own "or more" (see `scans_at_least`). */
      scans_at_least: boolean;
    }>;
  };

  corridor_map: {
    svg: string;
    suppressed: string[]; // cell IDs under privacy floor — also in _meta.suppression_reasons
    cell_count: number;
    /**
     * Q8: 'live' = per-cell res9 scan data; 'fallback' = res7 neighborhood hex
     * on launch day; 'suppressed' = poster cells exist but none clears the
     * K-floor, so no map (and no cell id) is published (OSE-1459).
     */
    source: 'live' | 'fallback' | 'suppressed';
    /**
     * OSE ADR-041: the NCR layer stack this map draws, bottom to top, with each
     * layer's meaning and how many marks it drew, so an agent reads the same
     * cues a person sees. Empty when the map is suppressed.
     */
    layers: LayerSummary[];
    /** Res 7, 6 and 5 areas: sums of the published poster-spot counts inside. */
    areas: AreaCount[];
  } | null;

  _meta: {
    materialized_at: string | null;
    suppression_reasons: SuppressionReason[];
    /**
     * OSE-1376: the zone every hour label on this report is rendered in. The
     * event's own IANA zone, or PLATFORM_HOME_TZ (America/Chicago) with
     * source='platform_default' when the event has none — the page states that.
     * In `_meta` so it reaches every depth (it is presentation, not paid data).
     */
    timezone: EventZone;
  };
}

export type BuildResult =
  | {
      ok: true;
      report: SharedReport;
      /**
       * Which sponsor is in which campaign at this event (`readCampaignLinks`).
       * Not part of the report: the read route uses it to rebuild the campaign
       * summary for one sponsor's own link. Absent reads as none.
       */
      campaignLinks?: CampaignLink[];
    }
  | { ok: false; error: 'NOT_FOUND' | 'MATERIALIZATION_PENDING' };

interface EventRow {
  id: string;
  brand_id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  corridor_id: string | null;
  series_id: string | null;
  h3_res9: string | null;
  h3_res7: string | null;
  timezone: string | null;
}

/**
 * poster_attribution for one event: its posters (never the room's vote code),
 * each the sum of its poster-hours that cleared the floor, rounded down to a
 * multiple of 5 hour by hour. A poster with nothing published is dropped.
 *
 * OSE-1784 (owner, 2026-11-23, "one number, from the posters"): this is the
 * report's ONE grain for scans. scans, this_event_count, the
 * density ratios and each scan_trend instance are the sum of these rows
 * (`scansFromPosters`), so no two published figures can be subtracted to name
 * a group under the floor.
 */
async function readPosterAttribution(
  db: D1Database,
  eventId: string,
  reportZone: EventZone
): Promise<SharedReport['poster_attribution']> {
  // OSE-2140 (owner, 2026-11-18): never the room's vote code. It is the room
  //    screen, not a poster, and its scans would publish a rough participation
  //    figure for the vote (OSE ADR-040).
  // 6. poster_attribution — per poster_deployment_id
  //    OSE-1459: the K-floor is applied per poster-HOUR before the hours are
  //    summed. Since OSE-2214 (owner, 2026-11-23) every scan counts and the
  //    floor is on scans of the code, never people: a poster-hour of >= K
  //    scans publishes, whoever scanned. A sub-K
  //    hour adds nothing, including to first/last scan times. Those times
  //    come from scan_bucket (the hour /q/ recorded), not created_at, which a
  //    queued scan gets when the consumer writes it, possibly an hour later.
  //    OSE-2151: each hour that clears the floor is rounded down to a multiple
  //    of 5 before the hours are added (the floorTotalOfParts rule), so the
  //    figure is the one the organizer's reach card shows for the same poster
  //    (lib/scan-cells.ts), and neither can be subtracted from the other.
  const posters = await db
    .prepare(
      `SELECT
         pd.id                  AS poster_deployment_id,
         COALESCE(pd.location_desc, pd.placement_label, '(no label)') AS location,
         pd.h3_res9             AS h3_res9,
         COALESCE(SUM(CASE WHEN ph.n >= ? THEN ph.n - (ph.n % ?) ELSE 0 END), 0) AS scan_count,
         MIN(CASE WHEN ph.n >= ? THEN ph.first_at END) AS first_scan_at,
         MAX(CASE WHEN ph.n >= ? THEN ph.last_at END)  AS last_scan_at,
         MAX(CASE WHEN ph.n >= ? THEN 1 ELSE 0 END)    AS hour_cap_reached
       FROM poster_deployments pd
       LEFT JOIN (SELECT poster_deployment_id,
                         COUNT(*)        AS n,
                         MIN(scan_bucket) AS first_at,
                         MAX(scan_bucket) AS last_at
                    FROM scan_placement_events
                   WHERE event_id = ?
                   GROUP BY poster_deployment_id, substr(scan_bucket, 1, 13)) ph
         ON ph.poster_deployment_id = pd.id
       WHERE pd.event_id = ? AND pd.is_vote_code = 0
       GROUP BY pd.id, pd.location_desc, pd.placement_label, pd.h3_res9
       HAVING scan_count > 0
       ORDER BY scan_count DESC`
    )
    .bind(
      CORRIDOR_MAP_MIN_COUNT,
      PUBLISH_ROUNDING,
      CORRIDOR_MAP_MIN_COUNT,
      CORRIDOR_MAP_MIN_COUNT,
      POSTER_HOUR_CAP,
      eventId,
      eventId
    )
    .all<{
      poster_deployment_id: string;
      location: string;
      h3_res9: string | null;
      scan_count: number;
      first_scan_at: string;
      last_scan_at: string;
      hour_cap_reached: number | null;
    }>();
  // OSE-711: K-anon floor on poster scan_count. `HAVING scan_count > 0` is a
  // presence filter, NOT a privacy floor — a poster with 1–4 scans would
  // publish an exact sub-K count ALONGSIDE its h3_res9 geolocation, i.e. a
  // location-correlated small-cohort disclosure available at mid+ depth. Every
  // other aggregate here already routes through applyCountFloor; poster rows did
  // not. Apply the same uniform floor and DROP any deployment below it: a
  // suppressed-but-present row still discloses "a poster at this hex drew a
  // small crowd," which is exactly the leak, so sub-K deployments must not
  // appear at all. Deployments at or above the floor publish their count rounded
  // down to a multiple of 5 (OSE-2151).
  return (posters.results ?? [])
    .map((r) => ({ r, floored: publishCount(r.scan_count) }))
    .filter((x) => !x.floored.suppressed)
    .map(({ r, floored }) => {
      const firstBucket = bucketToHour(r.first_scan_at);
      const lastBucket = bucketToHour(r.last_scan_at);
      return {
        poster_deployment_id: r.poster_deployment_id,
        location: r.location,
        h3_res9: r.h3_res9 ?? null,
        scan_count: floored.count as number,
        hour_cap_reached: r.hour_cap_reached === 1,
        first_scan_at: firstBucket,
        last_scan_at: lastBucket,
        // OSE-1376: label the already-hourly UTC bucket in the event's zone.
        first_scan_label: formatHourBucketLabel(firstBucket, reportZone.zone),
        last_scan_label: formatHourBucketLabel(lastBucket, reportZone.zone),
      };
    });
}

/**
 * The report's scan figure (OSE-1784, OSE-2214): the sum of the published poster rows,
 * through `floorTotalOfParts`. Null when no poster row is published, never 0.
 */
function scansFromPosters(rows: SharedReport['poster_attribution']): number | null {
  return rows.length > 0 ? floorTotalOfParts(rows.map((r) => r.scan_count)).count : null;
}

export async function buildSharedReport(db: D1Database, eventId: string): Promise<BuildResult> {
  // 1. Resolve the event.
  const event = await db
    .prepare(
      `SELECT id, brand_id, title, start_date, end_date, corridor_id, series_id, h3_res9, h3_res7, timezone
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
  // OSE-1376: hour labels render in the event's zone (fallback: platform home zone).
  const reportZone = resolveEventZone(event.timezone);

  // 2. poster_attribution, then scans from it (OSE-1784).
  //    The people figures used to come from three grains: scan_aggregates
  //    (scans), anon_id_returns (sample_size, this_event_count; retired by
  //    OSE-2214, migration 0119)
  //    and the poster-hours (poster_attribution). Each was floored on its own,
  //    so one could be subtracted from another: hours of 7 and 3 people at one
  //    poster published a poster sum of 5 beside a sample size of 10, and the
  //    3 were there to be read. Owner ruling 2026-11-23 ("one number, from the
  //    posters"): every people figure is the sum of the published poster rows.
  //    scan_aggregates is read only for when the report was materialized.
  const posterAttribution = await readPosterAttribution(db, eventId, reportZone);
  const saMeta = await db
    .prepare(`SELECT MAX(computed_at) AS computed_at FROM scan_aggregates WHERE event_id = ?`)
    .bind(eventId)
    .first<{ computed_at: string | null }>();
  const materializedAt = saMeta?.computed_at ?? null;
  const scans = scansFromPosters(posterAttribution);
  // Said in words, the same at 0 as at 1 to 4 (OSE-1649 item 2), so the card
  // never shows a bare dash.
  if (scans === null) {
    suppression.push({
      field: 'scans',
      reason: 'below_min_sample_size',
      detail: `fewer than ${CORRIDOR_MAP_MIN_COUNT} scans at any poster in any hour`,
    });
  }

  // 3. return_rate was retired by OSE-2214 (owner, 2026-11-23): it counted the
  //    same phone across events, and OSE counts traffic on the code, never a
  //    person. Section numbers below are kept so the history still reads.

  // 4. corridor_density — this event's scan count vs (corridor, dow, hour)
  //    baseline. NULL if no corridor or no baseline row yet.
  let thisEventCount: number | null = null;
  let baseline30d: number | null = null;
  let baseline90d: number | null = null;
  let densityRatio30d: number | null = null;
  let densityRatio90d: number | null = null;
  // Q5: hoisted so dow/hour are available in the return object regardless of branch taken.
  let corridorDow: number | null = null;
  let corridorHour: number | null = null;
  const densityCorridorKey = corridorKeyOf(event);
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

    // OSE-1784: this_event_count is the report's one scan figure, the sum of
    // the published poster rows (scans), never a count of its own.
    // It used to be COUNT(DISTINCT anon_id_hash), floored on its own (DS-01),
    // and the gap between it and the poster rows could name a group under K.
    // Null when no poster row is published; the ratios below are then null too.
    thisEventCount = scans;
    // Said at 0 as at 1 to 4 (OSE-1649 item 2).
    if (thisEventCount === null) {
      suppression.push({
        field: 'corridor_density.this_event_count',
        reason: 'below_min_sample_size',
        detail: `fewer than ${CORRIDOR_MAP_MIN_COUNT} scans at any poster in any hour`,
      });
    }

    if (baseline) {
      // Apply minimum-sample suppression per Q4 ratified (Session 1):
      // a corridor baseline below 10 events worth of signal is too sparse
      // to publish as a density ratio.
      // DS-01: density_ratio is ALSO gated on thisEventCount clearing the K-anon
      // floor. When this_event_count is suppressed (null), the ratio would re-expose
      // the exact sub-K numerator (raw = ratio * baseline), so it is left null.
      // OSE-1751: the two windows are one chain (90d holds 30d), published
      // through the call the BigQuery export makes, so 90d - 30d never names a
      // group under K. The ratios use the PUBLISHED baseline: a ratio on the raw
      // one gives it back (this_event_count / ratio), rounding and all.
      const published = publishCorridorBaseline(baseline, thisEventCount);
      baseline30d = published.baseline_30d;
      baseline90d = published.baseline_90d;
      densityRatio30d = published.density_ratio_30d;
      densityRatio90d = published.density_ratio_90d;
      suppression.push(...published.suppression);
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

  // 5. sponsor_displays — per sponsor × surface, including campaign linkage,
  //    sponsor tier, and local-sponsor flag. D1 returns INTEGER booleans (0/1).
  // OSE-799 A2: identity (name) comes from sponsor_business; the per-event
  // economics (campaign, tier, locality) come from the sponsor_placement for THIS
  // event. Join both off si.sponsor_id (= sponsor_business.id) — placement scoped
  // to si.event_id so a business at multiple events reads its own per-event tier.
  // Showcase S14: a campaign is read only when it is in THIS event's brand, so a
  // placement linked to another brand's campaign reports as having none, neither
  // its id nor its title.
  // ADR-030 D8: the campaign read is the placement's EFFECTIVE one, its event's
  // campaign when the event is in one, else its own (EFFECTIVE_CAMPAIGN_ID_SQL).
  const impressions = await db
    .prepare(
      `SELECT
         si.sponsor_id      AS sponsor_id,
         sb.name            AS sponsor_name,
         sb.display_name    AS sponsor_display_name,
         c.id               AS campaign_id,
         c.title            AS campaign_title,
         sp.tier            AS sponsor_tier,
         sp.locality_band   AS is_local,
         si.surface         AS surface,
         COUNT(*)           AS count
       FROM sponsor_displays si
       LEFT JOIN sponsor_placement sp
              ON sp.sponsor_business_id = si.sponsor_id AND sp.event_id = ?
       LEFT JOIN events e ON e.id = si.event_id
       LEFT JOIN campaigns ec ON ec.id = e.campaign_id AND ec.brand_id = e.brand_id
       LEFT JOIN campaigns c ON c.id = ${EFFECTIVE_CAMPAIGN_ID_SQL} AND c.brand_id = e.brand_id
       LEFT JOIN sponsor_business sb ON sb.id = si.sponsor_id
       WHERE si.event_id = ?
       GROUP BY si.sponsor_id, sb.name, sb.display_name, c.id, c.title, sp.tier, sp.locality_band, si.surface
       ORDER BY count DESC`
    )
    // Bound twice: the placement join and the WHERE both name this one event.
    .bind(eventId, eventId)
    .all<{
      sponsor_id: string;
      sponsor_name: string | null;
      sponsor_display_name: string | null;
      campaign_id: string | null;
      campaign_title: string | null;
      sponsor_tier: string | null;
      is_local: number | null;
      surface: string;
      count: number;
    }>();
  // Part of OSE-1421: the per-(sponsor x surface) row is a contributing bucket,
  // and it passes the same floor as the rollups computed from it below. A sub-K
  // row is DROPPED, not nulled: a row that is present with its count withheld
  // still says "this sponsor was seen on this surface by a small crowd" (the
  // OSE-711 reasoning for poster rows). Dropping also keeps the rows and the
  // campaign / class totals in agreement, so a reader cannot subtract one
  // against the other down to a sub-K cohort.
  const sponsorDisplays = (impressions.results ?? [])
    .filter((r) => !applyCountFloor(r.count).suppressed)
    .map((r) => ({
      sponsor_id: r.sponsor_id,
      sponsor_name: r.sponsor_name ?? 'unknown',
      // OSE-1431: sponsor_name stays the business name (identity stays with the name).
      sponsor_title: sponsorTitle({
        name: r.sponsor_name ?? 'unknown',
        display_name: r.sponsor_display_name,
      }),
      campaign_id: r.campaign_id ?? null,
      campaign_title: r.campaign_title ?? null,
      sponsor_tier: r.sponsor_tier ?? null,
      is_local: r.is_local === 1,
      surface: r.surface,
      // OSE-2151: rounded down to a multiple of 5 (the row cleared the floor).
      count: roundForPublish(r.count),
    }));

  // campaign_summary (OSE-2046): the campaigns come from the event's placements,
  // the numbers from the sponsorDisplays rows published above (each already at
  // or over the floor, OSE-683), so a total cannot be differenced against them.
  const campaignLinks = await readCampaignLinks(db, eventId);
  const campaignSummary = summarizeCampaigns(campaignLinks, sponsorDisplays);
  suppression.push(...campaignWithheldReasons(campaignSummary));

  // SR-25: sponsor_class_breakdown, class-level totals of the sponsorDisplays
  // rows published above. A class with no row at the floor has its total
  // withheld (null) and says so in words, never 0 (OSE-2089, invariant 2).
  const classPlacements = await readClassPlacements(db, eventId);
  const sponsorClassBreakdown = summarizeSponsorClasses(classPlacements, sponsorDisplays);
  suppression.push(...classWithheldReasons(sponsorClassBreakdown));

  // 7. corridor_map — premium hex map of per-cell scan densities (S-6.3.1b).
  //    Source: scan_cell_aggregates — scans per poster res9 cell (OSE-1459).
  //    Fallback (launch-day honesty): event's own h3_res7 corridor cell +
  //    gridRingUnsafe ring neighbors, so "one venue lighting one cell on
  //    day one IS the product" (ring gives the saturation promise context).
  let corridorMap: SharedReport['corridor_map'] = null;

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

  // OSE ADR-041: the map is the NCR layer stack (base, hexagons, corridors,
  // rings) drawn from counts this report already publishes. Only cells at or
  // above the floor reach the renderer, rounded as published (OSE-2151).
  function buildCorridorMap(
    cells: Array<{ cell: string; count: number }>,
    source: 'live' | 'fallback',
    around: string | null,
    suppressedCells: string[]
  ): void {
    const spots = cells
      .filter((c) => c.count >= CORRIDOR_MAP_MIN_COUNT)
      .map((c) => ({ cell: c.cell, count: roundForPublish(c.count) }));
    const { svg, layers, areas } = renderLayerMap({
      spots,
      around,
      geographies: OER_GEOGRAPHIES,
      rings: OER_RINGS,
    });
    corridorMap = {
      svg,
      suppressed: suppressedCells,
      cell_count: cells.length,
      source,
      layers,
      areas,
    };
    // Q: strip H3 cell IDs from suppression detail — cell IDs are trivially reverse-geocoded,
    // which would undermine the privacy floor's intent. Count is enough context.
    // One count-free line: how many areas were hidden is itself a count of small
    // crowds (OSE-1421), so the string says only that the floor was not met.
    if (suppressedCells.length > 0) {
      suppression.push({
        field: 'corridor_map',
        reason: 'below_min_sample_size',
        detail: `some areas not shown — fewer than ${CORRIDOR_MAP_MIN_COUNT} scans recorded`,
      });
    }
  }

  // OSE-1459 / ADR-011: a scan's place is the poster it was scanned at, so
  // each cell is a poster's res9 and its value is the SCANS there
  // (scan_cell_aggregates, place-side only). It is not distinct people:
  // doctrine rule 6 keeps any session-derived value off a placement. The
  // per-cell K-floor (CORRIDOR_MAP_MIN_COUNT) still applies in renderCorridorMap.
  const cellRows = await db
    .prepare(
      `SELECT h3_res9 AS cell,
              SUM(CASE WHEN scan_count >= ? THEN scan_count - (scan_count % ?) ELSE 0 END) AS count
         FROM scan_cell_aggregates
         WHERE event_id = ?
         GROUP BY h3_res9`
    )
    // OSE-683 drop-before-sum: an hourly bucket under K never joins the cell's
    // sum, so sub-K hours can't add up to a published count (3 + 3 is not 6).
    // A cell made only of sub-K hours stays as a 0 row, so it is dropped below
    // and an all-sub-K event still reads as 'suppressed', not 'no scans'.
    // OSE-2151: each hour is rounded down to a multiple of 5 before it joins
    // the sum, as floorTotalOfParts does.
    .bind(CORRIDOR_MAP_MIN_COUNT, PUBLISH_ROUNDING, eventId)
    .all<{ cell: string; count: number }>();

  const cellData = cellRows.results ?? [];
  // OSE-1459: these cells are poster locations. A cell under the K-floor is
  // DROPPED before rendering, never drawn as a suppressed outline: the
  // renderer would still serialize its res9 (data-cell + geometry), and "a
  // poster at this hex drew a small crowd" is the same small-cohort leak
  // poster_attribution drops (OSE-711). Only cells at or above the floor exist
  // on the map.
  const shownCells = cellData.filter((r) => r.count >= CORRIDOR_MAP_MIN_COUNT);
  // The note is given whenever the map is drawn from poster cells, not only
  // when one was dropped (OSE-1649 item 2): a note that appeared only then
  // would tell a poster with no scans from one with 1 to 4.
  if (cellData.length > 0) {
    suppression.push({
      field: 'corridor_map',
      reason: 'below_min_sample_size',
      detail: `areas with fewer than ${CORRIDOR_MAP_MIN_COUNT} scans are not shown`,
    });
  }

  if (shownCells.length > 0) {
    buildCorridorMap(
      shownCells.map((r) => ({ cell: r.cell, count: r.count })),
      'live',
      null,
      []
    );
  } else if (cellData.length > 0) {
    // Poster cells exist but none clears the floor: publish no map at all
    // (the page shows its "hidden to keep things anonymous" note), rather than
    // falling back to the venue preview as if there were no scans.
    corridorMap = {
      svg: '',
      suppressed: [],
      cell_count: 0,
      source: 'suppressed',
      layers: [],
      areas: [],
    };
  } else if (event.h3_res7 && !h3TagsCorrupt) {
    // Launch-day fallback: res7 neighborhood hex lit with scans count +
    // ring-1 neighbors at count=0 (suppressed by privacy floor — correct).
    // source='fallback' lets the client render accurate "neighborhood" copy (not "block").
    const ring = gridRingUnsafe(event.h3_res7, 1);
    const count = scans ?? 0;
    buildCorridorMap(
      [{ cell: event.h3_res7, count }, ...ring.map((c: string) => ({ cell: c, count: 0 }))],
      'fallback',
      event.h3_res7,
      count >= CORRIDOR_MAP_MIN_COUNT ? ring : [event.h3_res7, ...ring]
    );
  } else if (!h3TagsCorrupt) {
    suppression.push({
      field: 'corridor_map',
      reason: 'materialization_pending',
      detail: 'event has no h3 cells tagged; update event lat/lon to enable corridor map',
    });
  }

  // 8. scan_trend — across confirmed event_series instances
  let trendSeriesId: string | null = null;
  let trendSeriesName: string | null = null;
  const trendInstances: Array<{
    event_id: string;
    start_date: string;
    scans: number | null;
    scans_at_least: boolean;
  }> = [];
  if (event.series_id) {
    const series = await confirmedSeriesOf(db, event);
    if (series) {
      trendSeriesId = series.id;
      trendSeriesName = series.series_name;
      // OSE-1784: each instance is that event's own one scan figure, the sum
      // of its published poster rows, the same derivation as scans
      // above (it was the scan_aggregates grain). An instance with no published
      // poster row is null, never 0.
      const inst = await db
        .prepare(
          `SELECT id AS event_id, start_date
             FROM events
            WHERE series_id = ?
              AND brand_id = ?
              AND start_date IS NOT NULL
            ORDER BY start_date ASC`
        )
        .bind(event.series_id, event.brand_id)
        .all<{ event_id: string; start_date: string }>();
      for (const r of inst.results ?? []) {
        const rows =
          r.event_id === eventId
            ? posterAttribution
            : await readPosterAttribution(db, r.event_id, reportZone);
        trendInstances.push({
          event_id: r.event_id,
          start_date: r.start_date,
          scans: scansFromPosters(rows),
          scans_at_least: rows.some((p) => p.hour_cap_reached),
        });
      }
    } else {
      suppression.push({
        field: 'scan_trend',
        reason: 'no_series',
        detail: 'no confirmed event_series row for this event',
      });
    }
  } else {
    suppression.push({
      field: 'scan_trend',
      reason: 'no_series',
      detail: 'event has no series_id',
    });
  }

  // Surface materialization pending when essentially no signal exists yet.
  // OSE-2093: "nothing yet" is read through the floor, never as a raw 0. The
  // note used to appear at exactly 0 and go at 1, so its presence told 0
  // from 1 to 4. Under the floor reads the same as none (invariant 2).
  if (scans === null && sponsorDisplays.length === 0) {
    suppression.push({
      field: '_event',
      reason: 'materialization_pending',
      detail: 'no published scan or sponsor display count for this event yet',
    });
  }

  // 8. click_outs (Rc) — anonymous /s/ routing-layer clicks per destination kind.
  //    Read shortlinks.clicks grouped by kind (NULL/'' → 'public'); floor each
  //    kind independently at K=5 (never merged into the scan total — different
  //    metric, and a merge would double-count / enable differencing). The total
  //    is the sum of the kinds that are published, never of all of them: a raw
  //    total minus the published kinds is the withheld kind (9 − 6 = 3).
  const clickRows = await db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(kind), ''), 'public') AS kind, SUM(clicks) AS clicks
         FROM shortlinks WHERE event_id = ?
         GROUP BY COALESCE(NULLIF(TRIM(kind), ''), 'public')`
    )
    .bind(eventId)
    .all<{ kind: string; clicks: number | null }>();
  let clickOuts: { by_kind: Record<string, number | null>; total: number | null } | null = null;
  const clickData = clickRows.results ?? [];
  if (clickData.length > 0) {
    const byKind: Record<string, number | null> = {};
    for (const r of clickData) {
      const raw = Number.isFinite(Number(r.clicks)) ? Number(r.clicks) : 0;
      byKind[r.kind] = publishCount(raw).count;
    }
    clickOuts = { by_kind: byKind, total: floorTotalOfParts(Object.values(byKind)).count };
  }

  return {
    ok: true,
    campaignLinks,
    report: {
      event_id: event.id,
      event_title: event.title,
      event_start_date: event.start_date,
      event_end_date: event.end_date,
      scans,
      scans_at_least: posterAttribution.some((p) => p.hour_cap_reached),
      click_outs: clickOuts,
      corridor_density: {
        this_event_count: thisEventCount,
        baseline_30d: baseline30d,
        baseline_90d: baseline90d,
        density_ratio_30d: densityRatio30d,
        density_ratio_90d: densityRatio90d,
        bucket_dow: corridorDow,
        bucket_hour: corridorHour,
      },
      sponsor_displays: sponsorDisplays,
      campaign_summary: campaignSummary,
      sponsor_class_breakdown: sponsorClassBreakdown,
      poster_attribution: posterAttribution,
      scan_trend: {
        series_id: trendSeriesId,
        series_name: trendSeriesName,
        instances: trendInstances,
      },
      corridor_map: corridorMap,
      _meta: {
        materialized_at: materializedAt,
        suppression_reasons: suppression,
        timezone: reportZone,
      },
    },
  };
}
