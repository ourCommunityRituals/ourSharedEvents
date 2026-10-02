// ─── Dashboard contract (OSE-1468, first slice) ──────────────────────────────
//
// One registry for every number the governed dashboards publish. A dashboard
// handler may only emit a metric that is named here, and every metric names:
//
//   • its dashboard   — operations (founder cockpit), event (organizer/partner,
//                       one event) or corridor (community intelligence);
//   • its privacy class — how the number is allowed to leave the Worker:
//       entity          a count of things, not people (events, posters, places,
//                       sponsor placements, admin actions). Exact.
//       anonymous_exact anonymous scan events: no session, no device, no person
//                       (scan_placement_events). Exact, the same rule as
//                       /stats and the pre-event card, so a first scan shows 1.
//       floored         identity-derived or digital counts (registrations,
//                       check-ins, email signups, short-link taps, scans per
//                       cell). K=5 through lib/count-floor.ts, applied PER
//                       CONTRIBUTING BUCKET before any sum (Invariant #7, the
//                       OSE-669 rule), so a total never exposes a sub-K bucket
//                       by differencing.
//   • its source      — the table(s) it is read from, so a reviewer can check it.
//
// Things the ticket asks for that have no data source today are listed in
// NOT_MEASURED with the reason, and every response carries that list. A
// dashboard that shows a gap honestly is better than one that invents a number.
//
// Bump DASHBOARD_CONTRACT_VERSION on any change to a response shape: a new
// metric is a minor bump, a removed or retyped one a major bump.

import { applyCountFloor, type FlooredCount } from './count-floor';
import { CORRIDOR_MAP_MIN_COUNT } from './shared-report';

export const DASHBOARD_CONTRACT_VERSION = '1.0.0';

export type DashboardId = 'operations' | 'event' | 'corridor';
export type PrivacyClass = 'entity' | 'anonymous_exact' | 'floored';

export interface MetricDef {
  dashboard: DashboardId;
  privacy: PrivacyClass;
  source: string;
  description: string;
}

export const DASHBOARD_METRICS = {
  // ── operations (founder cockpit; brand-scoped) ────────────────────────────
  'events.total': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'events',
    description: 'Events in scope.',
  },
  'events.by_status': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'events.status',
    description: 'Events per lifecycle state (draft, ready, active, archived).',
  },
  'events.published': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'events.is_published',
    description: 'Events listed on public surfaces.',
  },
  'events.created_30d': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'events.created_at',
    description: 'Events created in the last 30 days.',
  },
  admin_activity_30d: {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'admin_audit_log (brand_id, action, outcome)',
    description:
      'Admin actions on this brand in the last 30 days: created, revised, went live, taken offline, denied.',
  },
  'reach.poster_scans': {
    dashboard: 'operations',
    privacy: 'anonymous_exact',
    source: 'scan_placement_events',
    description: 'Poster QR scans, all time.',
  },
  'reach.link_taps': {
    dashboard: 'operations',
    privacy: 'floored',
    source: 'shortlinks.clicks (per event, floored, survivors summed)',
    description: 'Short-link taps, all time.',
  },
  'reach.active_posters': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'poster_deployments (is_active = 1)',
    description: 'Posters out now.',
  },
  'reach.poster_places': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'poster_deployments.h3_res7 (distinct)',
    description: 'Distinct res-7 places those posters cover.',
  },
  'participation.anonymous_scans': {
    dashboard: 'operations',
    privacy: 'anonymous_exact',
    source: 'scan_placement_events',
    description: 'Anonymous participation: scans, which name no one.',
  },
  'participation.registrations': {
    dashboard: 'operations',
    privacy: 'floored',
    source: 'FORMS_DB.form_registrations (confirmed, unexpired; per event, floored)',
    description: 'Explicit choice: registrations.',
  },
  'participation.checkins': {
    dashboard: 'operations',
    privacy: 'floored',
    source: 'FORMS_DB.checkin_counts (per event, floored)',
    description: 'Explicit choice: check-ins.',
  },
  'participation.email_signups': {
    dashboard: 'operations',
    privacy: 'floored',
    source: 'FORMS_DB.email_signups (per event, floored)',
    description: 'Explicit choice: next-event email signups.',
  },
  'sponsors.active_placements': {
    dashboard: 'operations',
    privacy: 'entity',
    source: 'sponsor_placement (is_active = 1)',
    description: 'Sponsors on show.',
  },
  'sponsors.pending_requests': {
    dashboard: 'operations',
    privacy: 'entity',
    source: "sponsor_placement (source = 'sponsor_request', organizer_accepted IS NULL)",
    description: 'Sponsors asking to back an event, not yet answered.',
  },
  'shared_report.views_30d': {
    dashboard: 'operations',
    privacy: 'entity',
    source: "report_access_log (outcome = 'granted')",
    description: 'SharedReport opens through a signed link, last 30 days.',
  },

  // ── event (organizer / partner report; one event) ─────────────────────────
  'event.status': {
    dashboard: 'event',
    privacy: 'entity',
    source: 'events',
    description: 'Lifecycle state, listed flag and days to go.',
  },
  'event.reach': {
    dashboard: 'event',
    privacy: 'anonymous_exact',
    source: 'lib/pre-event-activity.ts (organizer shape: scans exact, taps floored)',
    description: 'Posters, places, scans, taps and scans per day for the last 14 days.',
  },
  'event.participation': {
    dashboard: 'event',
    privacy: 'floored',
    source: 'scan_placement_events + FORMS_DB counts',
    description: 'Anonymous scans (exact) beside explicit choices (floored).',
  },
  'event.sponsors': {
    dashboard: 'event',
    privacy: 'entity',
    source: 'sponsor_placement',
    description: 'Sponsors on show, waiting for the organizer, declined.',
  },
  'event.shared_report_views_30d': {
    dashboard: 'event',
    privacy: 'entity',
    source: "report_access_log (outcome = 'granted')",
    description: 'SharedReport opens for this event, last 30 days.',
  },

  // ── corridor (community intelligence; brand-scoped) ───────────────────────
  'corridor.by_category': {
    dashboard: 'corridor',
    privacy: 'entity',
    source: 'events → event_type_registry.category_code → event_type_category_registry',
    description: 'Events per UEC category; untyped events count under OTHER, never dropped.',
  },
  'corridor.event_cells': {
    dashboard: 'corridor',
    privacy: 'entity',
    source: 'events.h3_res7',
    description: 'Destination layer: events and live events per res-7 cell.',
  },
  'corridor.source_cells': {
    dashboard: 'corridor',
    privacy: 'floored',
    source: 'poster_deployments.h3_res7 + scan_placement_events',
    description: 'Source layer: posters per cell (exact) and scans per cell (floored).',
  },
  'corridor.flows': {
    dashboard: 'corridor',
    privacy: 'floored',
    source: 'scan_placement_events → poster cell → event cell',
    description: 'Scans from a source cell to an event cell; pairs under K are left out.',
  },
  'corridor.day_part': {
    dashboard: 'corridor',
    privacy: 'entity',
    source: 'events.start_date',
    description: 'Events on weekdays, weekends, or undated.',
  },
  'corridor.series': {
    dashboard: 'corridor',
    privacy: 'entity',
    source: 'events.series_id',
    description: 'Series count, events in a series, largest series.',
  },
  'corridor.partner_network': {
    dashboard: 'corridor',
    privacy: 'entity',
    source: 'sponsor_placement (is_active = 1)',
    description: 'Distinct sponsors on show and their placements.',
  },
} as const satisfies Record<string, MetricDef>;

export type DashboardMetricId = keyof typeof DASHBOARD_METRICS;

export interface NotMeasured {
  id: string;
  dashboard: DashboardId;
  reason: string;
}

/** Asked for by OSE-1468, not measurable from today's data. Shown, not hidden. */
export const NOT_MEASURED: readonly NotMeasured[] = [
  {
    id: 'surface_visits',
    dashboard: 'operations',
    reason: 'No per-surface view counter exists for /public, /display or /sharedReport pages.',
  },
  {
    id: 'qr_resolution_failures',
    dashboard: 'operations',
    reason:
      'Failed QR / short-link resolutions are not stored in D1; successes are counted as scans and taps.',
  },
  {
    id: 'api_errors_and_transition_failures',
    dashboard: 'operations',
    reason:
      '4xx/5xx and 409 INVALID_TRANSITION responses go to the Worker log, not to D1. Needs a log-sink read.',
  },
  {
    id: 'ingestion_and_contract_health',
    dashboard: 'operations',
    reason:
      'OER export health, schema-guard results and CI gate status live in GitHub Actions and BigQuery, not D1.',
  },
  {
    id: 'profile_flag_actions',
    dashboard: 'operations',
    reason: 'OSE has no named-profile choice; that is the OW side and stays in its own spoke.',
  },
  {
    id: 'partner_page_visits',
    dashboard: 'event',
    reason: 'GET /sponsors/:id is not counted, and Invariant #25 forbids impression metrics.',
  },
  {
    id: 'repeat_participation',
    dashboard: 'corridor',
    reason:
      'Returns are published once, weekly and rounded, by corridor_returns_export (OSE-1460). A second read here would open a differencing surface.',
  },
  {
    id: 'local_showcase_engagement',
    dashboard: 'corridor',
    reason: 'No showcase entity exists yet.',
  },
];

export function notMeasuredFor(dashboard: DashboardId): NotMeasured[] {
  return NOT_MEASURED.filter((n) => n.dashboard === dashboard);
}

export function metricsFor(dashboard: DashboardId): DashboardMetricId[] {
  return (Object.keys(DASHBOARD_METRICS) as DashboardMetricId[]).filter(
    (k) => DASHBOARD_METRICS[k].dashboard === dashboard
  );
}

/** The `contract` block every dashboard response carries. */
export function contractBlock(dashboard: DashboardId) {
  return {
    version: DASHBOARD_CONTRACT_VERSION,
    dashboard,
    metrics: metricsFor(dashboard),
    floor: CORRIDOR_MAP_MIN_COUNT,
  };
}

/**
 * Invariant #7, the OSE-669 rule: floor each bucket first, sum the survivors,
 * then format. A bucket under K never enters the total, so the total cannot be
 * differenced against another view to recover it.
 */
export function floorBucketsThenSum(counts: Iterable<number>): FlooredCount {
  let sum = 0;
  for (const raw of counts) {
    const n = Number.isFinite(raw) ? Math.floor(raw) : 0;
    if (n >= CORRIDOR_MAP_MIN_COUNT) sum += n;
  }
  return applyCountFloor(sum);
}
