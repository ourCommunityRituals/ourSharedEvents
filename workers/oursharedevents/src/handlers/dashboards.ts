/**
 * Governed dashboards — first slice of OSE-1468.
 *
 *   GET /api/v2/admin/dashboards/operations  → founder / operations cockpit
 *   GET /api/v2/admin/dashboards/corridor    → corridor / community intelligence
 *   GET /api/v2/admin/events/:id/dashboard   → organizer / partner report, one event
 *
 * Every number comes from the registry in lib/dashboard-contract.ts and carries
 * that registry's privacy class. Read that file first; this one only runs the
 * queries.
 *
 * Tenant isolation (#9). The brand set is server-derived from the verified actor
 * (resolveAdminBrandScopeAsync), exactly as the portfolio rollup does it. Each
 * brand is read with its own `brand_id = ?` query and the results are merged in
 * code: there is no cross-brand SQL here at all. A key actor in scope mode 'all'
 * must name one brand (`?brand_id=`); these dashboards never build an
 * all-tenants view. That belongs to OER, which reads exports, not D1.
 *
 * Aggregate only (#7). Nothing here returns a row about a person. Identity-
 * derived counts (FORMS_DB) are floored per event before they are summed.
 * Digital taps are floored per poster code, the grain an event's own card
 * lists, then per event, then summed (floorTotalOfParts, lib/count-floor.ts).
 * Corridor scans are floored per part (brand, data class, source cell and
 * destination), and a source cell's figure is the sum of the parts listed for
 * it, so no figure counts a scan the same reader is not shown.
 * Places are H3 res-7 cells only, never lat/lon or res-9 (Invariant #1).
 *
 * Demo and synthetic events are left out by default (`?data_class=production`).
 * `?data_class=all` includes them, so the cockpit is usable on seeded staging
 * data. The response echoes the filter.
 *
 * Two-DB isolation (#1): FORMS_DB is read only for per-event COUNTs, keyed by
 * the brand-scoped event ids; never a row, never a PII column, never a join.
 */

import { corsHeaders } from '../lib/cors';
import { applyCountFloor, floorTotalOfParts, type FlooredCount } from '../lib/count-floor';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import {
  contractBlock,
  floorBucketsThenSum,
  notMeasuredFor,
  type DashboardId,
} from '../lib/dashboard-contract';
import {
  TAP_CODE_SQL,
  organizerPreEventActivity,
  readPreEventActivity,
} from '../lib/pre-event-activity';
import { daysToGo } from './pre-event-activity';
import { scanHourSql } from '../lib/scan-cells';
import { PLACEMENT_ON_SHOW_SQL } from '../lib/sponsor-card';
import { perEventCounts } from './portfolio-rollup';

export interface DashboardsEnv extends AdminEnv, AdminBrandScopeEnv {
  DB: D1Database;
  FORMS_DB?: D1Database;
}

const WINDOW_DAYS = 30;
const BRAND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
type DataClassFilter = 'production' | 'all';

function rid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function json(request: Request, reqId: string, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': reqId },
  });
}

function fail(request: Request, reqId: string, status: number, code: string, error: string) {
  return json(request, reqId, { ok: false, status, code, error, requestId: reqId }, status);
}

/** `YYYY-MM-DD HH:MM:SS`, the format of datetime('now') columns. */
function sqliteDatetime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Query failures propagate. A dashboard that turned a D1 error into zeroes
// would publish numbers nobody read; the handler answers 503 instead.
async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  return (await stmt.all<T>()).results ?? [];
}

async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  return stmt.first<T>();
}

/** Run a dashboard body; any thrown query error becomes a logged 503. */
async function guarded(
  request: Request,
  reqId: string,
  dashboard: DashboardId,
  body: () => Promise<Response>
): Promise<Response> {
  try {
    return await body();
  } catch (e) {
    console.error(
      JSON.stringify({
        type: 'DASHBOARD_DB_ERROR',
        dashboard,
        requestId: reqId,
        error: e instanceof Error ? e.message : String(e),
      })
    );
    return fail(request, reqId, 503, 'DB_UNAVAILABLE', 'Dashboard data could not be read');
  }
}

/**
 * The brand set this caller may read, or the response that refuses it.
 * Exported for tests.
 */
export async function resolveDashboardBrands(
  request: Request,
  env: DashboardsEnv,
  reqId: string
): Promise<{ brands: string[] } | Response> {
  const brandId = new URL(request.url).searchParams.get('brand_id');
  if (brandId !== null && !BRAND_ID_RE.test(brandId)) {
    return fail(request, reqId, 400, 'INVALID_BRAND_ID', 'brand_id is not a brand slug');
  }
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') {
    return fail(request, reqId, 403, 'BRAND_SCOPE_DENIED', 'No brand membership for this caller');
  }
  if (scope.mode === 'all') {
    if (!brandId) {
      return fail(
        request,
        reqId,
        400,
        'BRAND_REQUIRED',
        'Name one brand with ?brand_id=; dashboards never merge every tenant'
      );
    }
    return { brands: [brandId] };
  }
  if (brandId && !scope.brandIds.includes(brandId)) {
    return fail(request, reqId, 403, 'BRAND_FORBIDDEN', `Not entitled to brand_id "${brandId}"`);
  }
  return { brands: brandId ? [brandId] : [...scope.brandIds] };
}

function parseDataClass(request: Request): DataClassFilter | null {
  const v = new URL(request.url).searchParams.get('data_class');
  if (v === null || v === 'production') return 'production';
  if (v === 'all') return 'all';
  return null;
}

/** Common preamble for the two brand-scoped dashboards. */
async function preamble(
  request: Request,
  env: DashboardsEnv,
  reqId: string
): Promise<{ brands: string[]; dataClass: DataClassFilter } | Response> {
  const dataClass = parseDataClass(request);
  if (!dataClass) {
    return fail(request, reqId, 400, 'INVALID_FILTER', "data_class must be 'production' or 'all'");
  }
  const scoped = await resolveDashboardBrands(request, env, reqId);
  if (scoped instanceof Response) return scoped;
  return { brands: scoped.brands, dataClass };
}

function envelope(dashboard: DashboardId, brands: string[], dataClass: DataClassFilter) {
  return {
    ok: true as const,
    status: 200 as const,
    contract: contractBlock(dashboard),
    scope: { brands, data_class: dataClass },
    generated_at: new Date().toISOString(),
    not_measured: notMeasuredFor(dashboard),
  };
}

// A sponsor's request the organizer has not answered (and the sponsor has not
// withdrawn). Never overlaps on-show, which needs organizer_accepted = 1 here.
// Every sponsor count also requires the sponsor and the event to share a brand:
// the schema allows a cross-brand placement row, and the public paths ignore it.
const PENDING_SQL = `(sp.source = 'sponsor_request' AND sp.organizer_accepted IS NULL
  AND COALESCE(sp.sponsor_accepted, 1) <> 0 AND e.brand_id = sb.brand_id)`;
const DECLINED_SQL = `((sp.organizer_accepted = 0 OR sp.sponsor_accepted = 0)
  AND e.brand_id = sb.brand_id)`;

// The SQL predicate for the data-class filter; bind the filter value twice.
const DC = `(e.data_class = 'production' OR ? = 'all')`;

// ═════════════════════════════════════════════════════════════════════════════
// Founder / operations cockpit
// ═════════════════════════════════════════════════════════════════════════════

interface BrandOps {
  eventIds: string[];
  byStatus: Map<string, number>;
  published: number;
  created30d: number;
  /**
   * The brand's poster-hour cells, raw (lib/scan-cells.ts). Only their floored
   * sum is published (OSE-1656): every scan figure on every surface is a sum
   * of the same cells, so this total cannot be subtracted against an event's
   * or the corridor's.
   */
  scanCells: number[];
  /**
   * One figure per event that has short links: the taps on its codes that
   * clear the floor on their own, or null when none does. It is the total the
   * event's own card and dashboard show (organizerPreEventActivity), built by
   * the same rule from the same parts, so a code under the floor never joins
   * it and it cannot be subtracted against the card's listed codes.
   */
  tapsPerEvent: (number | null)[];
  posters: number;
  places: Set<string>;
  onShow: number;
  pendingRequests: number;
  /**
   * Report opens per event per day, raw. Opens are actions by link holders,
   * so their total is floored like any other count (OSE-1656): the sum of the
   * event-days with 5 or more, the cell the event dashboard sums too.
   */
  reportViewCells: number[];
  admin: Map<string, number>;
}

async function readBrandOps(
  db: D1Database,
  brand: string,
  dc: DataClassFilter,
  now: Date
): Promise<BrandOps> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const sinceSql = sqliteDatetime(since);
  const sinceIso = since.toISOString();
  const sinceDay = sinceIso.slice(0, 10);

  const [events, scans, taps, posters, places, sponsors, views, admin] = await Promise.all([
    all<{ id: string; status: string | null; is_published: number; created_at: string }>(
      db
        .prepare(
          `SELECT e.id, e.status, e.is_published, e.created_at FROM events e
            WHERE e.brand_id = ? AND ${DC}`
        )
        .bind(brand, dc)
    ),
    // One row per poster-hour, the cell every scan figure is a sum of.
    all<{ n: number }>(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM scan_placement_events s
             JOIN events e ON e.id = s.event_id
            WHERE e.brand_id = ? AND ${DC}
            GROUP BY s.poster_deployment_id, ${scanHourSql('s')}`
        )
        .bind(brand, dc)
    ),
    // One row per event and poster code: TAP_CODE_SQL is the expression the
    // event's own card groups by, so these parts are the parts it lists.
    all<{ event_id: string; taps: number }>(
      db
        .prepare(
          `SELECT sl.event_id AS event_id, COALESCE(SUM(sl.clicks), 0) AS taps
             FROM shortlinks sl
             JOIN events e ON e.id = sl.event_id
            WHERE e.brand_id = ? AND ${DC}
            GROUP BY sl.event_id, ${TAP_CODE_SQL}`
        )
        .bind(brand, dc)
    ),
    first<{ cnt: number }>(
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM poster_deployments pd
             JOIN events e ON e.id = pd.event_id
            WHERE e.brand_id = ? AND ${DC} AND pd.is_active = 1`
        )
        .bind(brand, dc)
    ),
    all<{ cell: string }>(
      db
        .prepare(
          `SELECT DISTINCT pd.h3_res7 AS cell FROM poster_deployments pd
             JOIN events e ON e.id = pd.event_id
            WHERE e.brand_id = ? AND ${DC} AND pd.is_active = 1 AND pd.h3_res7 IS NOT NULL`
        )
        .bind(brand, dc)
    ),
    first<{ on_show: number; pending: number }>(
      db
        .prepare(
          `SELECT SUM(CASE WHEN ${PLACEMENT_ON_SHOW_SQL} THEN 1 ELSE 0 END) AS on_show,
                  SUM(CASE WHEN ${PENDING_SQL} THEN 1 ELSE 0 END) AS pending
             FROM sponsor_placement sp JOIN events e ON e.id = sp.event_id
             JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
            WHERE e.brand_id = ? AND ${DC}`
        )
        .bind(brand, dc)
    ),
    // One row per event and day: the cell the views total is a sum of.
    all<{ n: number }>(
      db
        .prepare(
          `SELECT COALESCE(SUM(r.access_count), 0) AS n FROM report_access_log r
             JOIN events e ON e.id = r.event_id
            WHERE e.brand_id = ? AND ${DC} AND r.outcome = 'granted' AND r.date >= ?
            GROUP BY r.event_id, r.date`
        )
        .bind(brand, dc, sinceDay)
    ),
    all<{ action: string; outcome: string; cnt: number }>(
      db
        .prepare(
          `SELECT action, outcome, COUNT(*) AS cnt FROM admin_audit_log
            WHERE brand_id = ? AND created_at >= ?
            GROUP BY action, outcome`
        )
        .bind(brand, sinceIso)
    ),
  ]);

  const byStatus = new Map<string, number>();
  let published = 0;
  let created30d = 0;
  for (const e of events) {
    const s = e.status ?? 'draft';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    // Listed = what the public list and map show: published AND live.
    if (num(e.is_published) === 1 && e.status === 'active') published++;
    if (typeof e.created_at === 'string' && e.created_at >= sinceSql) created30d++;
  }
  const adminMap = new Map<string, number>();
  for (const a of admin) {
    const key = a.outcome === 'denied' ? 'denied' : a.action;
    adminMap.set(key, (adminMap.get(key) ?? 0) + num(a.cnt));
  }
  const codesByEvent = new Map<string, number[]>();
  for (const t of taps) pushTo(codesByEvent, t.event_id, t.taps);

  return {
    eventIds: events.map((e) => e.id),
    byStatus,
    published,
    created30d,
    scanCells: scans.map((r) => num(r.n)),
    tapsPerEvent: [...codesByEvent.values()].map((codes) => floorTotalOfParts(codes).count),
    posters: num(posters?.cnt),
    places: new Set(places.map((p) => p.cell)),
    onShow: num(sponsors?.on_show),
    pendingRequests: num(sponsors?.pending),
    reportViewCells: views.map((r) => num(r.n)),
    admin: adminMap,
  };
}

/** Per-event FORMS_DB counts, floored per event, survivors summed. */
async function explicitChoices(
  formsDb: D1Database | undefined,
  eventIds: string[]
): Promise<{ registrations: FlooredCount; checkins: FlooredCount; email_signups: FlooredCount }> {
  if (eventIds.length === 0) {
    const zero = applyCountFloor(0);
    return { registrations: zero, checkins: zero, email_signups: zero };
  }
  // Events exist but their counts cannot be read: an outage, not a zero.
  if (!formsDb) throw new Error('FORMS_DB binding missing');
  const [reg, chk, mail] = await Promise.all([
    perEventCounts(
      formsDb,
      eventIds,
      (ph) => `SELECT event_id, COUNT(*) AS cnt FROM form_registrations
       WHERE event_id IN (${ph}) AND status = 'confirmed'
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       GROUP BY event_id`
    ),
    perEventCounts(
      formsDb,
      eventIds,
      (ph) => `SELECT event_id, total_count AS cnt FROM checkin_counts WHERE event_id IN (${ph})`
    ),
    perEventCounts(
      formsDb,
      eventIds,
      (ph) => `SELECT event_id, COUNT(*) AS cnt FROM email_signups
       WHERE event_id IN (${ph}) GROUP BY event_id`
    ),
  ]);
  // perEventCounts reports a failed chunk as null; that is an outage, not a zero.
  if (!reg || !chk || !mail) throw new Error('FORMS_DB per-event count failed');
  return {
    registrations: floorBucketsThenSum(reg.map((r) => num(r.cnt))),
    checkins: floorBucketsThenSum(chk.map((r) => num(r.cnt))),
    email_signups: floorBucketsThenSum(mail.map((r) => num(r.cnt))),
  };
}

const LIFECYCLE_STATES = ['draft', 'ready', 'active', 'archived'] as const;

export async function handleOperationsDashboard(
  request: Request,
  env: DashboardsEnv
): Promise<Response> {
  const reqId = rid();
  const pre = await preamble(request, env, reqId);
  if (pre instanceof Response) return pre;
  const { brands, dataClass } = pre;
  return guarded(request, reqId, 'operations', async () => {
    const now = new Date();
    const perBrand = await Promise.all(brands.map((b) => readBrandOps(env.DB, b, dataClass, now)));

    const byStatus: Record<string, number> = Object.fromEntries(
      LIFECYCLE_STATES.map((s) => [s, 0])
    );
    const places = new Set<string>();
    const admin = new Map<string, number>();
    const eventIds: string[] = [];
    const taps: (number | null)[] = [];
    const scanCells: number[] = [];
    const reportViewCells: number[] = [];
    let published = 0,
      created30d = 0,
      posters = 0,
      onShow = 0,
      pendingRequests = 0;
    for (const b of perBrand) {
      for (const [s, n] of b.byStatus) byStatus[s] = (byStatus[s] ?? 0) + n;
      for (const p of b.places) places.add(p);
      for (const [k, n] of b.admin) admin.set(k, (admin.get(k) ?? 0) + n);
      eventIds.push(...b.eventIds);
      taps.push(...b.tapsPerEvent);
      published += b.published;
      created30d += b.created30d;
      scanCells.push(...b.scanCells);
      posters += b.posters;
      onShow += b.onShow;
      pendingRequests += b.pendingRequests;
      reportViewCells.push(...b.reportViewCells);
    }
    // Cells under the floor join no sum (OSE-1656, lib/scan-cells.ts).
    const scans = floorTotalOfParts(scanCells);
    const explicit = await explicitChoices(env.FORMS_DB, eventIds);

    return json(request, reqId, {
      ...envelope('operations', brands, dataClass),
      events: {
        total: eventIds.length,
        by_status: byStatus,
        published,
        created_30d: created30d,
      },
      admin_activity_30d: {
        // Named for the audit action each one counts. A status change made
        // through PUT is audited as UPDATE_EVENT, so it lands in `updated`,
        // not in the QR verify counters (see NOT_MEASURED).
        created: admin.get('CREATE_EVENT') ?? 0,
        updated: admin.get('UPDATE_EVENT') ?? 0,
        qr_verified: admin.get('VERIFY_QR') ?? 0,
        qr_unverified: admin.get('UNVERIFY_QR') ?? 0,
        deleted: admin.get('DELETE_EVENT') ?? 0,
        denied: admin.get('denied') ?? 0,
      },
      reach: {
        poster_scans: scans,
        // Each event's figure is floored before the events are added, and is
        // itself a sum of codes that cleared the floor: withheld when no code
        // of any event in scope has 5 taps, however many taps there are.
        link_taps: floorTotalOfParts(taps),
        active_posters: posters,
        poster_places: places.size,
      },
      participation: {
        anonymous: { scans },
        explicit,
      },
      sponsors: { on_show: onShow, pending_requests: pendingRequests },
      shared_report: { views_30d: floorTotalOfParts(reportViewCells) },
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Corridor / community intelligence
// ═════════════════════════════════════════════════════════════════════════════

interface BrandCorridor {
  categories: Array<{ code: string; cnt: number }>;
  eventCells: Array<{ cell: string; events: number; live: number }>;
  posterCells: Array<{ cell: string; posters: number }>;
  /**
   * Scans, one row per part: source cell, destination cell and data class
   * (the brand is the query's). `destination` is null when the event has no
   * place on the map. This is the only scan read the corridor has: the cell
   * figures and the flows are both built from these rows.
   */
  scanParts: Array<{ source: string; destination: string | null; scans: number }>;
  dayParts: Array<{ part: string; cnt: number }>;
  series: Array<{ sid: string; cnt: number }>;
  partners: Array<{ business: string }>;
  placements: number;
}

async function readBrandCorridor(
  db: D1Database,
  brand: string,
  dc: DataClassFilter
): Promise<BrandCorridor> {
  const [categories, eventCells, posterCells, scanParts, dayParts, series, partners] =
    await Promise.all([
      all<{ code: string; cnt: number }>(
        db
          .prepare(
            `SELECT COALESCE(t.category_code, 'OTHER') AS code, COUNT(*) AS cnt FROM events e
               LEFT JOIN event_type_registry t ON t.id = e.event_type_id
              WHERE e.brand_id = ? AND ${DC}
              GROUP BY code`
          )
          .bind(brand, dc)
      ),
      all<{ cell: string; events: number; live: number }>(
        db
          .prepare(
            `SELECT e.h3_res7 AS cell, COUNT(*) AS events,
                    SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) AS live
               FROM events e
              WHERE e.brand_id = ? AND ${DC} AND e.h3_res7 IS NOT NULL
              GROUP BY e.h3_res7`
          )
          .bind(brand, dc)
      ),
      all<{ cell: string; posters: number }>(
        db
          .prepare(
            `SELECT pd.h3_res7 AS cell, COUNT(*) AS posters FROM poster_deployments pd
               JOIN events e ON e.id = pd.event_id
              WHERE e.brand_id = ? AND ${DC} AND pd.is_active = 1 AND pd.h3_res7 IS NOT NULL
              GROUP BY pd.h3_res7`
          )
          .bind(brand, dc)
      ),
      // One read for cells and flows alike. An event with no cell is kept, as
      // a destination of its own (NULL groups with NULL): its scans are a part
      // of the source cell like any other, not a remainder nobody floors.
      all<{ source: string; destination: string | null; scans: number }>(
        db
          .prepare(
            `SELECT pd.h3_res7 AS source, e.h3_res7 AS destination, COUNT(*) AS scans
               FROM scan_placement_events s
               JOIN events e ON e.id = s.event_id
               JOIN poster_deployments pd ON pd.id = s.poster_deployment_id
              WHERE e.brand_id = ? AND ${DC} AND pd.h3_res7 IS NOT NULL
              GROUP BY s.poster_deployment_id, ${scanHourSql('s')}, pd.h3_res7, e.h3_res7`
          )
          .bind(brand, dc)
      ),
      all<{ part: string; cnt: number }>(
        db
          .prepare(
            `SELECT CASE
                      WHEN strftime('%w', substr(e.start_date, 1, 10)) IS NULL THEN 'undated'
                      WHEN strftime('%w', substr(e.start_date, 1, 10)) IN ('0', '6') THEN 'weekend'
                      ELSE 'weekday'
                    END AS part, COUNT(*) AS cnt
               FROM events e
              WHERE e.brand_id = ? AND ${DC}
              GROUP BY part`
          )
          .bind(brand, dc)
      ),
      all<{ sid: string; cnt: number }>(
        db
          .prepare(
            `SELECT e.series_id AS sid, COUNT(*) AS cnt FROM events e
              WHERE e.brand_id = ? AND ${DC} AND e.series_id IS NOT NULL
              GROUP BY e.series_id`
          )
          .bind(brand, dc)
      ),
      all<{ business: string }>(
        db
          .prepare(
            `SELECT sp.sponsor_business_id AS business FROM sponsor_placement sp
               JOIN events e ON e.id = sp.event_id
               JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
              WHERE e.brand_id = ? AND ${DC} AND ${PLACEMENT_ON_SHOW_SQL}`
          )
          .bind(brand, dc)
      ),
    ]);
  return {
    categories,
    eventCells,
    posterCells,
    scanParts,
    dayParts,
    series,
    partners,
    placements: partners.length,
  };
}

function pushTo(map: Map<string, number[]>, key: string, n: unknown): void {
  const list = map.get(key) ?? [];
  list.push(num(n));
  map.set(key, list);
}

function addTo(map: Map<string, number>, key: string, n: unknown): void {
  map.set(key, (map.get(key) ?? 0) + num(n));
}

export async function handleCorridorDashboard(
  request: Request,
  env: DashboardsEnv
): Promise<Response> {
  const reqId = rid();
  const pre = await preamble(request, env, reqId);
  if (pre instanceof Response) return pre;
  const { brands, dataClass } = pre;
  return guarded(request, reqId, 'corridor', async () => {
    const perBrand = await Promise.all(brands.map((b) => readBrandCorridor(env.DB, b, dataClass)));

    // Category labels: a shared, non-tenant registry.
    const labels = new Map<string, string>(
      (
        await all<{ category_code: string; display_name: string }>(
          env.DB.prepare('SELECT category_code, display_name FROM event_type_category_registry')
        )
      ).map((r) => [r.category_code, r.display_name])
    );

    const cats = new Map<string, number>();
    const evCells = new Map<string, { events: number; live: number }>();
    const posterCells = new Map<string, number>();
    // Scans keep one raw count per part, and the part is one poster in one
    // hour (OSE-1656, lib/scan-cells.ts): the cell every other scan figure is
    // a sum of. A poster has one source cell, one event (so one destination
    // and one data class) and one brand. Each part is floored before any sum,
    // so every view a caller can select (one brand or several, production or
    // all) is a sum of parts that each cleared K, and no view can be
    // subtracted from another, or from the operations or an event's total, to
    // expose a sub-K count (#7, the OSE-669 rule). Before OSE-1656 a part was
    // a pair of cells, so a flow of 7 could be two posters of 4 and 3 that the
    // event's exact total then gave back.
    const flowParts = new Map<string, { source: string; destination: string; parts: number[] }>();
    const noDestinationParts = new Map<string, number[]>();
    const dayPart = new Map<string, number>([
      ['weekday', 0],
      ['weekend', 0],
      ['undated', 0],
    ]);
    const series: number[] = [];
    const businesses = new Set<string>();
    let placements = 0;

    for (const b of perBrand) {
      for (const c of b.categories) addTo(cats, c.code, c.cnt);
      for (const c of b.eventCells) {
        const cur = evCells.get(c.cell) ?? { events: 0, live: 0 };
        evCells.set(c.cell, { events: cur.events + num(c.events), live: cur.live + num(c.live) });
      }
      for (const c of b.posterCells) addTo(posterCells, c.cell, c.posters);
      for (const p of b.scanParts) {
        if (p.destination === null) {
          pushTo(noDestinationParts, p.source, p.scans);
          continue;
        }
        const key = `${p.source}>${p.destination}`;
        const flow = flowParts.get(key) ?? {
          source: p.source,
          destination: p.destination,
          parts: [],
        };
        flow.parts.push(num(p.scans));
        flowParts.set(key, flow);
      }
      for (const d of b.dayParts) addTo(dayPart, d.part, d.cnt);
      for (const s of b.series) series.push(num(s.cnt));
      for (const p of b.partners) businesses.add(p.business);
      placements += b.placements;
    }

    // A flow under K is left out entirely, not shown as suppressed: listing the
    // pair would tell a reader that someone scanned from that cell to that one.
    // Ties are broken by the cells, never by the order rows arrived in, which
    // follows parts that are not listed.
    const flowRows = [...flowParts.values()]
      .map((f) => ({
        source: f.source,
        destination: f.destination,
        scans: floorTotalOfParts(f.parts),
      }))
      .filter((f) => !f.scans.suppressed)
      .sort(
        (a, b) =>
          (b.scans.count ?? 0) - (a.scans.count ?? 0) ||
          a.source.localeCompare(b.source) ||
          a.destination.localeCompare(b.destination)
      );

    // A source cell's scans are the sum of what this response lists for it:
    // its flows, and its scans for events with no place (floored the same
    // way, and shown beside it). Counting the cell's scans on their own would
    // add in the flows left out above, and cell minus listed flows would hand
    // them back (10 in the cell, one flow of 7: the other flow has 3).
    const listedFlows = new Map<string, number[]>();
    for (const f of flowRows) pushTo(listedFlows, f.source, f.scans.count);
    const sourceCellIds = new Set([
      ...posterCells.keys(),
      ...listedFlows.keys(),
      ...noDestinationParts.keys(),
    ]);
    const sourceCells = [...sourceCellIds]
      .sort()
      .map((cell) => {
        const noDestination = floorTotalOfParts(noDestinationParts.get(cell) ?? []);
        return {
          cell,
          posters: posterCells.get(cell) ?? 0,
          scans: floorTotalOfParts([...(listedFlows.get(cell) ?? []), noDestination.count]),
          scans_no_destination: noDestination,
        };
      })
      // A cell with no poster out is listed for its number, or not at all: a
      // row with nothing to show would say that someone once scanned there.
      .filter((c) => c.posters > 0 || !c.scans.suppressed);

    return json(request, reqId, {
      ...envelope('corridor', brands, dataClass),
      by_category: [...cats.entries()]
        .map(([code, events]) => ({
          code,
          label: labels.get(code) ?? 'Other',
          events,
        }))
        .sort((a, b) => b.events - a.events || a.code.localeCompare(b.code)),
      event_cells: [...evCells.entries()]
        .map(([cell, v]) => ({ cell, ...v }))
        .sort((a, b) => b.events - a.events || a.cell.localeCompare(b.cell)),
      source_cells: sourceCells,
      flows: flowRows,
      day_part: Object.fromEntries(dayPart),
      series: {
        series: series.length,
        events_in_series: series.reduce((a, n) => a + n, 0),
        largest: series.length ? Math.max(...series) : 0,
      },
      partner_network: { sponsors: businesses.size, placements },
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Organizer / partner report — one event
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The router runs guardAdminObjectScope before this, so an event outside the
 * caller's brands is already a 404. The event read is keyed by the held id.
 */
export async function handleEventDashboard(
  request: Request,
  env: DashboardsEnv,
  eventId: string
): Promise<Response> {
  const reqId = rid();
  return guarded(request, reqId, 'event', async () => {
    const row = await first<{
      id: string;
      status: string | null;
      is_published: number;
      start_date: string | null;
      starts_at: string | null;
      timezone: string | null;
    }>(
      env.DB.prepare(
        `SELECT id, status, is_published, start_date, starts_at, timezone
           FROM events WHERE id = ? LIMIT 1`
      ).bind(eventId)
    );
    if (!row) return fail(request, reqId, 404, 'NOT_FOUND', 'Event not found');

    const now = new Date();
    const sinceDay = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    const [activity, sponsors, views, explicit] = await Promise.all([
      readPreEventActivity(env.DB, eventId, row.timezone, now, true),
      first<{ on_show: number; pending: number; declined: number }>(
        env.DB.prepare(
          `SELECT SUM(CASE WHEN ${PLACEMENT_ON_SHOW_SQL} THEN 1 ELSE 0 END) AS on_show,
                  SUM(CASE WHEN ${PENDING_SQL} THEN 1 ELSE 0 END) AS pending,
                  SUM(CASE WHEN ${DECLINED_SQL} THEN 1 ELSE 0 END) AS declined
             FROM sponsor_placement sp
             JOIN events e ON e.id = sp.event_id
             JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
            WHERE sp.event_id = ?`
        ).bind(eventId)
      ),
      // One row per day: the cell the operations view total sums too.
      all<{ n: number }>(
        env.DB.prepare(
          `SELECT COALESCE(SUM(access_count), 0) AS n FROM report_access_log
            WHERE event_id = ? AND outcome = 'granted' AND date >= ?
            GROUP BY date`
        ).bind(eventId, sinceDay)
      ),
      explicitChoices(env.FORMS_DB, [eventId]),
    ]);

    return json(request, reqId, {
      ok: true,
      status: 200,
      contract: contractBlock('event'),
      generated_at: now.toISOString(),
      not_measured: notMeasuredFor('event'),
      event: {
        id: row.id,
        status: row.status ?? 'draft',
        is_published: num(row.is_published) === 1,
        days_to_go: daysToGo(row, now),
      },
      reach: organizerPreEventActivity(activity),
      participation: {
        anonymous: { scans: activity.scans },
        explicit,
      },
      sponsors: {
        on_show: num(sponsors?.on_show),
        pending_requests: num(sponsors?.pending),
        declined: num(sponsors?.declined),
      },
      shared_report: { views_30d: floorTotalOfParts(views.map((r) => num(r.n))) },
    });
  });
}
