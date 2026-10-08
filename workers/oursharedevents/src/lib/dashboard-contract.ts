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
//                       by differencing. For taps the bucket is a poster code,
//                       not an event: the event's own card lists taps per
//                       code, so a total built from anything coarser could be
//                       subtracted against that list. For corridor scans the
//                       bucket is brand × data class × source cell ×
//                       destination, and a cell's figure is the sum of the
//                       buckets listed beside it, never a count of its own.
//                       Owner ruling, 2026-10-08: the floor has no exceptions.
//                       It holds against a brand's own admin, at every tier.
//   • its path       — where the value sits in the response, so the class can
//                       be checked against what is actually returned;
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

// 1.1.0 (2026-10-08): new metric corridor.source_cells.scans_no_destination.
export const DASHBOARD_CONTRACT_VERSION = '1.1.0';

export type DashboardId = 'operations' | 'event' | 'corridor';
export type PrivacyClass = 'entity' | 'anonymous_exact' | 'floored';

export interface MetricDef {
  dashboard: DashboardId;
  /** The class actually applied to every value at `path`. One metric, one class. */
  privacy: PrivacyClass;
  /**
   * Where the value sits in the response: dot-separated keys, and `name[]` maps
   * over an array (`flows[].scans`). tests/dashboards.spec.ts resolves every
   * path against a live response and checks the value has its class's shape.
   */
  path: string;
  source: string;
  description: string;
}

/** On show = active placement, both sides consented, active business, live event. */
const ON_SHOW = 'sponsor_placement + sponsor_business + events (PLACEMENT_ON_SHOW_SQL)';

export const DASHBOARD_METRICS = {
  // ── operations (founder cockpit; brand-scoped) ────────────────────────────
  'events.total': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'events.total',
    source: 'events',
    description: 'Events in scope.',
  },
  'events.by_status': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'events.by_status',
    source: 'events.status',
    description: 'Events per lifecycle state (draft, ready, active, archived).',
  },
  'events.published': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'events.published',
    source: "events.is_published = 1 AND status = 'active'",
    description: 'Events on the public list and map now (published and live).',
  },
  'events.created_30d': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'events.created_30d',
    source: 'events.created_at',
    description: 'Events created in the last 30 days.',
  },
  admin_activity_30d: {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'admin_activity_30d',
    source: 'admin_audit_log (brand_id, action, outcome)',
    description:
      'Admin actions on this brand in the last 30 days, one counter per audit action: created (CREATE_EVENT), updated (UPDATE_EVENT), qr_verified (VERIFY_QR), qr_unverified (UNVERIFY_QR), deleted (DELETE_EVENT), denied (any action refused).',
  },
  'reach.poster_scans': {
    dashboard: 'operations',
    privacy: 'anonymous_exact',
    path: 'reach.poster_scans',
    source: 'scan_placement_events',
    description: 'Poster QR scans, all time.',
  },
  'reach.link_taps': {
    dashboard: 'operations',
    privacy: 'floored',
    path: 'reach.link_taps',
    source:
      'shortlinks.clicks (per event and code, floored, survivors summed; then per event, floored, survivors summed)',
    description:
      'Short-link taps, all time, on the codes with 5 or more: the sum of the tap totals each event shows on its own.',
  },
  'reach.active_posters': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'reach.active_posters',
    source: 'poster_deployments (is_active = 1)',
    description: 'Posters out now.',
  },
  'reach.poster_places': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'reach.poster_places',
    source: 'poster_deployments.h3_res7 (distinct)',
    description: 'Distinct res-7 places those posters cover.',
  },
  'participation.anonymous_scans': {
    dashboard: 'operations',
    privacy: 'anonymous_exact',
    path: 'participation.anonymous.scans',
    source: 'scan_placement_events',
    description: 'Anonymous participation: scans, which name no one.',
  },
  'participation.registrations': {
    dashboard: 'operations',
    privacy: 'floored',
    path: 'participation.explicit.registrations',
    source: 'FORMS_DB.form_registrations (confirmed, unexpired; per event, floored)',
    description: 'Explicit choice: registrations.',
  },
  'participation.checkins': {
    dashboard: 'operations',
    privacy: 'floored',
    path: 'participation.explicit.checkins',
    source: 'FORMS_DB.checkin_counts (per event, floored)',
    description: 'Explicit choice: check-ins.',
  },
  'participation.email_signups': {
    dashboard: 'operations',
    privacy: 'floored',
    path: 'participation.explicit.email_signups',
    source: 'FORMS_DB.email_signups (per event, floored)',
    description: 'Explicit choice: next-event email signups.',
  },
  'sponsors.on_show': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'sponsors.on_show',
    source: ON_SHOW,
    description: 'Sponsor placements a visitor can see right now.',
  },
  'sponsors.pending_requests': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'sponsors.pending_requests',
    source: "sponsor_placement (source = 'sponsor_request', organizer_accepted IS NULL)",
    description: 'Sponsors asking to back an event, not yet answered.',
  },
  'shared_report.views_30d': {
    dashboard: 'operations',
    privacy: 'entity',
    path: 'shared_report.views_30d',
    source: "report_access_log (outcome = 'granted')",
    description: 'SharedReport opens through a signed link, last 30 days.',
  },

  // ── event (organizer / partner report; one event) ─────────────────────────
  'event.state': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'event',
    source: 'events',
    description: 'Lifecycle state, listed flag and days to go.',
  },
  'event.reach.posters': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'reach.posters',
    source: 'poster_deployments (is_active = 1)',
    description: 'Posters out for this event.',
  },
  'event.reach.places': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'reach.places',
    source: 'poster_deployments.h3_res7 (distinct)',
    description: 'Distinct res-7 places those posters cover.',
  },
  'event.reach.scans': {
    dashboard: 'event',
    privacy: 'anonymous_exact',
    path: 'reach.scans',
    source: 'scan_placement_events',
    description: 'Poster QR scans, all time.',
  },
  'event.reach.scans_by_day': {
    dashboard: 'event',
    privacy: 'anonymous_exact',
    path: 'reach.scansByDay',
    source: 'scan_placement_events.scan_bucket (event-local days)',
    description: 'Scans per day for the last 14 days.',
  },
  'event.reach.link_taps': {
    dashboard: 'event',
    privacy: 'floored',
    path: 'reach.clicks',
    source: 'shortlinks.clicks (per code, floored, survivors summed)',
    description: 'Short-link taps, all time, on the codes with 5 or more.',
  },
  'event.participation.anonymous_scans': {
    dashboard: 'event',
    privacy: 'anonymous_exact',
    path: 'participation.anonymous.scans',
    source: 'scan_placement_events',
    description: 'Anonymous participation: scans.',
  },
  'event.participation.registrations': {
    dashboard: 'event',
    privacy: 'floored',
    path: 'participation.explicit.registrations',
    source: 'FORMS_DB.form_registrations (confirmed, unexpired)',
    description: 'Explicit choice: registrations.',
  },
  'event.participation.checkins': {
    dashboard: 'event',
    privacy: 'floored',
    path: 'participation.explicit.checkins',
    source: 'FORMS_DB.checkin_counts',
    description: 'Explicit choice: check-ins.',
  },
  'event.participation.email_signups': {
    dashboard: 'event',
    privacy: 'floored',
    path: 'participation.explicit.email_signups',
    source: 'FORMS_DB.email_signups',
    description: 'Explicit choice: next-event email signups.',
  },
  'event.sponsors.on_show': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'sponsors.on_show',
    source: ON_SHOW,
    description: 'Sponsors a visitor can see on this event now.',
  },
  'event.sponsors.pending_requests': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'sponsors.pending_requests',
    source: "sponsor_placement (source = 'sponsor_request', organizer_accepted IS NULL)",
    description: 'Sponsors waiting for the organizer.',
  },
  'event.sponsors.declined': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'sponsors.declined',
    source: 'sponsor_placement (sponsor_accepted = 0 OR organizer_accepted = 0)',
    description: 'Placements either side declined.',
  },
  'event.shared_report_views_30d': {
    dashboard: 'event',
    privacy: 'entity',
    path: 'shared_report.views_30d',
    source: "report_access_log (outcome = 'granted')",
    description: 'SharedReport opens for this event, last 30 days.',
  },

  // ── corridor (community intelligence; brand-scoped) ───────────────────────
  'corridor.by_category': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'by_category',
    source: 'events → event_type_registry.category_code → event_type_category_registry',
    description: 'Events per UEC category; untyped events count under OTHER, never dropped.',
  },
  'corridor.event_cells': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'event_cells',
    source: 'events.h3_res7',
    description: 'Destination layer: events and live events per res-7 cell.',
  },
  'corridor.source_cells.cell': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'source_cells[].cell',
    source: 'poster_deployments.h3_res7',
    description: 'The res-7 cell each source-layer row describes (where posters hang).',
  },
  'corridor.source_cells.posters': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'source_cells[].posters',
    source: 'poster_deployments.h3_res7',
    description: 'Source layer: active posters per res-7 cell.',
  },
  'corridor.source_cells.scans': {
    dashboard: 'corridor',
    privacy: 'floored',
    path: 'source_cells[].scans',
    source:
      'scan_placement_events → poster cell → event cell or none (floored per brand × data class × source cell × destination, survivors summed)',
    description:
      'Source layer: scans per res-7 poster cell, on the parts with 5 or more: the sum of the flows listed from the cell and its scans_no_destination, and nothing else.',
  },
  'corridor.source_cells.scans_no_destination': {
    dashboard: 'corridor',
    privacy: 'floored',
    path: 'source_cells[].scans_no_destination',
    source:
      'scan_placement_events → poster cell, where events.h3_res7 IS NULL (floored per brand × data class × source cell, survivors summed)',
    description:
      'Scans on posters in this cell for events that have no place on the map, so they are in no flow. One part of the cell figure, floored like a flow.',
  },
  'corridor.flows.source': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'flows[].source',
    source: 'poster_deployments.h3_res7',
    description: 'The res-7 poster cell a flow starts from.',
  },
  'corridor.flows.destination': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'flows[].destination',
    source: 'events.h3_res7',
    description: 'The res-7 event cell a flow ends at.',
  },
  'corridor.flows': {
    dashboard: 'corridor',
    privacy: 'floored',
    path: 'flows[].scans',
    source:
      'scan_placement_events → poster cell → event cell (floored per brand × data class × pair, survivors summed)',
    description:
      'Scans from a source cell to an event cell; pairs under K are left out, of the list and of the source cell figure alike.',
  },
  'corridor.day_part': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'day_part',
    source: 'events.start_date',
    description: 'Events on weekdays, weekends, or undated.',
  },
  'corridor.series': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'series',
    source: 'events.series_id',
    description: 'Series count, events in a series, largest series.',
  },
  'corridor.partner_network': {
    dashboard: 'corridor',
    privacy: 'entity',
    path: 'partner_network',
    source: ON_SHOW,
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
    id: 'status_changes_via_update',
    dashboard: 'operations',
    reason:
      'PUT /api/v2/admin/events/:id can change status (e.g. archived to active), but it is audited as UPDATE_EVENT with no from/to status, so those changes count as updated, not as a lifecycle transition. Needs the audit row to carry the transition.',
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
