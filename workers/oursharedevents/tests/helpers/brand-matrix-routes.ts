/**
 * OSE-1554 — the brand test matrix: THE route list (pure module).
 *
 * A new brand-scoped admin route gets isolation coverage by being added here, and
 * `brand-matrix-selfcheck.spec.ts` fails the build when a route in `src/router.ts`
 * is in neither `MATRIX_ROUTES` nor `ROUTE_EXEMPTIONS`. The patterns are matched
 * against what `deriveAdminRoutePatterns()` reads out of the router source, so the
 * list cannot quietly drift from the router.
 *
 * Shapes:
 *   object  addresses ONE object by id (event, sponsor, placement, poster deployment).
 *           Cross-brand => 404 NOT_FOUND, indistinguishable from an unknown id.
 *   list    returns rows. A caller never receives another brand's marker.
 *   create  writes under a brand named in the request. Naming another brand is refused.
 */

import { BRANDS, UNKNOWN_ID, type BrandFx } from './brand-matrix-ids';

export type ObjectOf = 'event' | 'sponsor' | 'placement' | 'poster-deployment';

export interface KnownGap {
  /** Linear ticket that owns the fix. */
  ticket: string;
  reason: string;
}

interface Base {
  /** Canonical pattern, exactly as `deriveAdminRoutePatterns()` renders it. */
  pattern: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Distinguishes two entries that share a pattern and method. */
  variant?: string;
  /** Request body for the call (object routes: used for own AND cross-brand calls). */
  body?: (target: BrandFx) => unknown;
  /** Marks a cell expected to fail today. It is still RUN; it is asserted to still fail. */
  knownGap?: KnownGap;
}

export interface ObjectRoute extends Base {
  shape: 'object';
  objectOf: ObjectOf;
  path: (id: string) => string;
  /** True for a write: cross-brand attempts must leave every fixture row byte-identical. */
  mutates: boolean;
  /** Status the OWNER gets on their own object (default: anything but 404/5xx). */
  ownOk?: (status: number) => boolean;
}

export interface ListRoute extends Base {
  shape: 'list';
  path: string;
  /** The owner's own rows must show up (proves the cell is not passing on an empty body). */
  expectOwnMarker: boolean;
}

export interface CreateRoute extends Base {
  shape: 'create';
  path: string;
  /** Body that names `target`'s brand (or its event) while the caller is someone else. */
  crossBody: (target: BrandFx) => unknown;
}

export type MatrixRoute = ObjectRoute | ListRoute | CreateRoute;

export const idOf = (b: BrandFx, kind: ObjectOf): string =>
  kind === 'event'
    ? b.activeEventId
    : kind === 'sponsor'
      ? b.sponsorId
      : kind === 'placement'
        ? b.placementId
        : b.posterDeploymentId;

const ev =
  (suffix = '') =>
  (id: string) =>
    `/api/v2/admin/events/${id}${suffix}`;
const sp =
  (suffix = '') =>
  (id: string) =>
    `/api/v2/admin/sponsors/${id}${suffix}`;

function eventRoute(
  pattern: string,
  method: ObjectRoute['method'],
  suffix: string,
  extra: Partial<ObjectRoute> = {}
): ObjectRoute {
  return {
    shape: 'object',
    objectOf: 'event',
    pattern,
    method,
    path: ev(suffix),
    mutates: method !== 'GET',
    ...extra,
  };
}

export const MATRIX_ROUTES: readonly MatrixRoute[] = [
  // ── events: collection / roll-up ───────────────────────────────────────────
  {
    shape: 'list',
    pattern: '/api/v2/admin/events',
    method: 'GET',
    path: '/api/v2/admin/events',
    expectOwnMarker: true,
  },
  {
    shape: 'list',
    pattern: '/api/v2/admin/events/portfolio-rollup',
    method: 'GET',
    path: '/api/v2/admin/events/portfolio-rollup',
    expectOwnMarker: false,
  },
  {
    shape: 'list',
    pattern: '/api/v2/admin/dashboards/operations',
    method: 'GET',
    path: '/api/v2/admin/dashboards/operations',
    expectOwnMarker: false,
  },
  {
    shape: 'list',
    pattern: '/api/v2/admin/dashboards/corridor',
    method: 'GET',
    path: '/api/v2/admin/dashboards/corridor',
    expectOwnMarker: false,
  },
  {
    shape: 'list',
    pattern: '/api/v2/admin/audit-log',
    method: 'GET',
    path: '/api/v2/admin/audit-log?scope=brand',
    expectOwnMarker: false,
  },
  {
    shape: 'list',
    pattern: '/api/v2/admin/sponsors',
    method: 'GET',
    path: '/api/v2/admin/sponsors',
    expectOwnMarker: true,
  },
  {
    shape: 'create',
    pattern: '/api/v2/admin/events',
    method: 'POST',
    path: '/api/v2/admin/events',
    variant: 'names the target brand',
    crossBody: (t) => ({ title: 'bm-cross-event', brand_id: t.brandId, start_date: '2099-01-01' }),
  },
  {
    shape: 'create',
    pattern: '/api/v2/admin/sponsors',
    method: 'POST',
    path: '/api/v2/admin/sponsors',
    // Names the target's EVENT: the sponsor + placement would land inside that brand.
    variant: 'names the target event',
    crossBody: (t) => ({ name: 'bm-cross-sponsor', event_id: t.activeEventId, tier: 'primary' }),
  },
  {
    shape: 'create',
    pattern: '/api/v2/admin/sponsors',
    method: 'POST',
    path: '/api/v2/admin/sponsors',
    variant: 'names the target brand (pool sponsor)',
    crossBody: (t) => ({ name: 'bm-cross-sponsor', brand_id: t.brandId, tier: 'primary' }),
  },

  // ── events: by id ──────────────────────────────────────────────────────────
  eventRoute('/api/v2/admin/events/:id', 'PUT', '', {
    body: () => ({ description: 'bm-cross-write' }),
  }),
  eventRoute('/api/v2/admin/events/:id', 'DELETE', ''),
  eventRoute('/api/v2/admin/events/:id/stats', 'GET', '/stats'),
  eventRoute('/api/v2/admin/events/:id/live', 'GET', '/live'),
  eventRoute('/api/v2/admin/events/:id/dashboard', 'GET', '/dashboard'),
  eventRoute('/api/v2/admin/events/:id/pre-event-activity', 'GET', '/pre-event-activity'),
  eventRoute('/api/v2/admin/events/:id/preview', 'GET', '/preview'),
  eventRoute('/api/v2/admin/events/:id/poster-preview', 'GET', '/poster-preview'),
  eventRoute('/api/v2/admin/events/:id/poster-bundle', 'GET', '/poster-bundle'),
  eventRoute('/api/v2/admin/events/:id/display-config', 'GET', '/display-config'),
  // OSE-1684: the event's short code; a cross-brand POST must not mint or read it.
  eventRoute('/api/v2/admin/events/:id/short-links', 'POST', '/short-links', { body: () => ({}) }),
  eventRoute('/api/v2/admin/events/:id/poster-codes', 'GET', '/poster-codes'),
  eventRoute('/api/v2/admin/events/:id/poster-codes', 'PUT', '/poster-codes', {
    body: () => ({ codes: [] }),
  }),
  eventRoute('/api/v2/admin/events/:id/poster-deployments', 'GET', '/poster-deployments'),
  eventRoute('/api/v2/admin/events/:id/poster-deployments', 'POST', '/poster-deployments', {
    body: () => ({ lat: 41.9, lon: -87.6 }),
  }),
  eventRoute('/api/v2/admin/events/:id/forms/export', 'GET', '/forms/export'),
  eventRoute(
    '/api/v2/admin/events/:id/forms/(registrations|contacts|checkin-count|surveys|email-signups)',
    'GET',
    '/forms/registrations'
  ),
  // Owner 2026-10-11: registrants' names and emails; a cross-brand read must not see them.
  eventRoute(
    '/api/v2/admin/events/:id/forms/(registrations|contacts|checkin-count|surveys|email-signups)',
    'GET',
    '/forms/contacts'
  ),
  // OSE-1531: the copy lands in the SOURCE's brand, so a cross-brand call must 404 and make nothing.
  eventRoute('/api/v2/admin/events/:id/repeat', 'POST', '/repeat'),
  // OSE ADR-029: a series an organizer declares. A cross-brand call must 404 and
  // leave every row as it was; the body names the target's own event on purpose.
  eventRoute('/api/v2/admin/events/:id/series', 'GET', '/series'),
  eventRoute('/api/v2/admin/events/:id/series', 'POST', '/series', {
    variant: 'declare',
    body: (t) => ({
      name: 'Matrix series',
      cadence: 'weekly',
      day_of_week: 1,
      hour_of_day: 17,
      event_ids: [t.activeEventId],
    }),
  }),
  eventRoute('/api/v2/admin/events/:id/series', 'PUT', '/series', {
    variant: 'attach',
    body: () => ({ series_id: 'evtsrs_matrix' }),
  }),
  eventRoute('/api/v2/admin/events/:id/series', 'DELETE', '/series', { variant: 'detach' }),
  eventRoute('/api/v2/admin/events/:id/series/confirm', 'POST', '/series/confirm', {
    body: (t) => ({ series_id: 'evtsrs_matrix', event_ids: [t.activeEventId] }),
  }),
  eventRoute('/api/v2/admin/events/:id/series/reject', 'POST', '/series/reject', {
    body: () => ({ series_id: 'evtsrs_matrix' }),
  }),
  eventRoute('/api/v2/admin/events/:id/verify-qr', 'POST', '/verify-qr'),
  eventRoute('/api/v2/admin/events/:id/unverify-qr', 'POST', '/unverify-qr'),
  eventRoute('/api/v2/admin/events/:id/backup', 'POST', '/backup'),
  eventRoute('/api/v2/admin/events/:id/uploads', 'POST', '/uploads'),
  eventRoute('/api/v2/admin/events/:id/flags/:id', 'PUT', '/flags/config.demo', {
    body: () => ({ enabled: true }),
  }),
  eventRoute(
    '/api/v2/admin/events/:id/shared-report/mint-link',
    'POST',
    '/shared-report/mint-link',
    { body: () => ({ role: 'sponsor' }) }
  ),

  // ── poster deployments: by id (brand resolved through the owning event) ────
  {
    shape: 'object',
    objectOf: 'poster-deployment',
    pattern: '/api/v2/admin/poster-deployments/:id',
    method: 'GET',
    path: (id) => `/api/v2/admin/poster-deployments/${id}`,
    mutates: false,
  },

  // ── sponsors: by id ────────────────────────────────────────────────────────
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id',
    method: 'GET',
    path: sp(),
    mutates: false,
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id',
    method: 'PUT',
    path: sp(),
    mutates: true,
    body: () => ({ name: 'bm-cross-write' }),
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id',
    method: 'DELETE',
    path: sp(),
    mutates: true,
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id/areas',
    method: 'GET',
    path: sp('/areas'),
    mutates: false,
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id/areas',
    method: 'PUT',
    path: sp('/areas'),
    mutates: true,
    body: () => ({ areas: [] }),
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id/event-types',
    method: 'GET',
    path: sp('/event-types'),
    mutates: false,
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id/event-types',
    method: 'PUT',
    path: sp('/event-types'),
    mutates: true,
    body: () => ({ event_type_ids: [] }),
  },
  {
    shape: 'object',
    objectOf: 'sponsor',
    pattern: '/api/v2/admin/sponsors/:id/home-link',
    method: 'POST',
    path: sp('/home-link'),
    mutates: false,
  },
  {
    shape: 'object',
    objectOf: 'placement',
    pattern: '/api/v2/admin/sponsor-requests/:id/respond',
    method: 'POST',
    path: (id) => `/api/v2/admin/sponsor-requests/${id}/respond`,
    mutates: true,
    body: () => ({ approve: false }),
  },
];

/**
 * Admin routes in `router.ts` that are deliberately NOT in the matrix, each with the
 * reason. A route that reads or writes a brand-scoped table must not be added here
 * without a reason a reviewer would accept.
 */
export const ROUTE_EXEMPTIONS: Readonly<Record<string, string>> = {
  '/admin': 'HTML shell; carries no rows. The data calls it makes are the routes above.',
  '/api/v2/admin/screens/logs':
    'HTML shell; carries no rows. Its data call is /api/v2/admin/audit-log?scope=brand, which is in the matrix.',
  '/api/v2/admin/screens/settings':
    'HTML shell; carries no rows. Its data call is /api/v2/admin/settings, exempted below.',
  '/api/v2/admin/settings':
    'Read-only platform constants and the plan; reads no brand-scoped table (tests/admin-settings.spec.ts).',
  '/api/v2/admin/event-templates':
    'Global read-only catalogue of layout templates; no brand_id column.',
  '/api/v2/admin/event-types': 'Global read-only event-type registry; no brand_id column.',
  '/api/v2/admin/flags':
    'Platform flag registry (key actor / platform brand only, AUD-3); tested by global-flags-key-actor.invariant.spec.ts.',
  '/api/v2/admin/flags/tiers': 'Platform tier catalogue; platform-only, not a tenant table.',
  '/api/v2/admin/flags/current-tier': 'Platform tier read; platform-only.',
  '/api/v2/admin/flags/resolve': 'Flag resolution for the caller; reads no brand-scoped rows.',
  '/api/v2/admin/flags/:id':
    'Global flag write; key actor only (R-5), tested by global-flags-key-actor.invariant.spec.ts.',
  '/api/v2/admin/flags/apply-tier':
    'Tier application across every brand; key actor only (R-5), same spec.',
  '/api/v2/admin/data-subject/erase':
    'Platform-wide erase by hashed identifier; platform-only (AUD-3).',
  '/api/v2/admin/security/rate-limit-stats':
    'Platform telemetry (HMAC buckets); platform-only (AUD-3).',
  '/api/v2/admin/subscribers': 'Platform subscriber list; platform-only (AUD-3).',
  '/api/v2/admin/geocode': 'Stateless geocoding proxy; reads and writes no tenant table.',
  '/api/v2/admin/events/backfill-h3-cells': 'Platform maintenance backfill; platform-only (AUD-3).',
  '/api/v2/admin/poster-deployments/backfill-h3':
    'Platform maintenance backfill; platform-only (AUD-3).',
  '/api/v2/admin/sponsors/promote':
    'Promotes a sponsor onboarding draft the caller captured; brand comes from the event/actor scope (AUD-3 S16); covered by sponsors-draft specs.',
};

/** Public routes that touch brand-scoped tables, with how isolation holds on each. */
export const PUBLIC_ROUTE_NOTES: Readonly<Record<string, string>> = {
  '/api/v2/events':
    'Brand-filtered list (?brand=). Tested here: another brand is never in the body, a draft never is.',
  '/api/v2/events/map':
    'Place-first and brand-agnostic BY DESIGN (cell-scoped, res 7). Tested here: drafts and unlisted events never appear.',
  '/api/v2/events/:id':
    'Public fetch by id is deliberately unscoped (a public page). Allowlisted projection; drafts 404.',
};

// ── Derivation ───────────────────────────────────────────────────────────────

/**
 * Read every `/api/v2/admin/...` (and `/admin`) route pattern out of the router
 * source, in a canonical spelling shared with `MATRIX_ROUTES.pattern`:
 *   `([^/]+)` -> `:id`, regex anchors and escapes removed, string literals as written.
 */
export function deriveAdminRoutePatterns(routerSource: string): string[] {
  const out = new Set<string>();

  // String literals compared against pathname: `pathname === '/api/v2/admin/...'`.
  for (const m of routerSource.matchAll(/pathname === '(\/(?:api\/v2\/)?admin[^']*)'/g)) {
    out.add(m[1]);
  }

  // Regex literals: `/^\/api\/v2\/admin\/...$/` (may sit on the line after `match(`).
  // Plain string scanning: a regex over backslash-escaped slashes is unreadable.
  const START = '/^\\/api\\/v2\\/admin';
  let from = 0;
  for (;;) {
    const i = routerSource.indexOf(START, from);
    if (i === -1) break;
    const end = routerSource.indexOf('$/', i);
    if (end === -1) break;
    out.add(
      routerSource
        .slice(i + 2, end) // drop the leading `/^`
        .split('\\/')
        .join('/')
        .split('([^/]+)')
        .join(':id')
    );
    from = end + 2;
  }
  return [...out].sort();
}

export function matrixPatterns(): Set<string> {
  return new Set(MATRIX_ROUTES.map((r) => r.pattern));
}

export { BRANDS, UNKNOWN_ID };
