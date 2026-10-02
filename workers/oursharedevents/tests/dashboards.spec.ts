/**
 * OSE-1468 — governed dashboards, first vertical slice.
 *
 * Seeds tests/helpers/seed-dashboard-fixture.ts (a bocce tournament and a
 * teacher/parent workshop for brand dash-a, a large event for dash-b, one demo
 * event) and checks the three dashboards against it:
 *
 *   contract  every response carries the registry version, its metric list and
 *             its not-measured list; floored metrics have the FlooredCount shape.
 *   #7        identity-derived counts and taps are floored per event before the
 *             sum; scans per cell are floored; flows under K are left out.
 *   #9        a dash-a operator never sees dash-b numbers; a forged brand_id is
 *             403; a key actor must name a brand.
 *   #1        no response carries lat/lon or res-9 cells.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  handleCorridorDashboard,
  handleEventDashboard,
  handleOperationsDashboard,
  type DashboardsEnv,
} from '../src/handlers/dashboards';
import {
  DASHBOARD_CONTRACT_VERSION,
  DASHBOARD_METRICS,
  NOT_MEASURED,
  floorBucketsThenSum,
  type PrivacyClass,
} from '../src/lib/dashboard-contract';
import { normalizeOperation } from '../src/lib/cost-metric';
import {
  CELL_EVENT,
  CELL_SRC_1,
  CELL_SRC_2,
  DASH,
  seedDashboardFixture,
} from './helpers/seed-dashboard-fixture';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = env as unknown as TestEnv;
const denv = env as unknown as DashboardsEnv;

async function applyMigrations(): Promise<void> {
  const runAll = async (db: D1Database, json: string) => {
    for (const stmt of JSON.parse(json) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        if (
          m.includes('duplicate column name') ||
          m.includes('already exists') ||
          m.includes('no such column')
        )
          continue;
        throw e;
      }
    }
  };
  await runAll(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await runAll(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function reqAs(email: string, path: string): Request {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
  return new Request(`https://x${path}`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Resolve a registry path (`a.b`, `list[].field`) to the values it names. */
function resolvePath(root: unknown, path: string): unknown[] {
  let cur: unknown[] = [root];
  for (const seg of path.split('.')) {
    const isList = seg.endsWith('[]');
    const key = isList ? seg.slice(0, -2) : seg;
    const next: unknown[] = [];
    for (const v of cur) {
      if (v === null || typeof v !== 'object') continue;
      const child = (v as Body)[key];
      if (child === undefined) continue;
      if (isList) {
        if (Array.isArray(child)) next.push(...child);
      } else next.push(child);
    }
    cur = next;
  }
  return cur;
}

/** Every leaf path of a value, arrays normalised to `name[]`. */
function leafPaths(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) {
    const out = v.flatMap((item) => leafPaths(item, `${prefix}[]`));
    return out.length ? out : [`${prefix}[]`];
  }
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Body);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([k, child]) => leafPaths(child, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function isFloored(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const f = v as Body;
  return (
    typeof f.suppressed === 'boolean' &&
    f.floor === 5 &&
    (f.suppressed ? f.count === null : Number.isInteger(f.count) && f.count >= 5)
  );
}

function containsFloored(v: unknown): boolean {
  if (isFloored(v)) return true;
  if (v === null || typeof v !== 'object') return false;
  return Object.values(v as Body).some(containsFloored);
}

/** floored → a FlooredCount; exact classes → no FlooredCount anywhere inside. */
function hasClassShape(v: unknown, cls: PrivacyClass): boolean {
  return cls === 'floored' ? isFloored(v) : !containsFloored(v) && v !== undefined;
}

async function call(
  fn: (r: Request, e: DashboardsEnv) => Promise<Response>,
  req: Request
): Promise<{ status: number; body: Body }> {
  const res = await fn(req, denv);
  return { status: res.status, body: (await res.json()) as Body };
}

const A = 'a@dash-a.test';
const AB = 'ab@dash.test';
const OPS = '/api/v2/admin/dashboards/operations';
const COR = '/api/v2/admin/dashboards/corridor';

beforeAll(async () => {
  await applyMigrations();
  await seedDashboardFixture(tenv.DB, tenv.FORMS_DB);
  denv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [A]: [DASH.brandA],
    [AB]: [DASH.brandA, DASH.brandB],
  });
});

describe('contract', () => {
  test('every registry metric names a dashboard, privacy class and source', () => {
    for (const [id, m] of Object.entries(DASHBOARD_METRICS)) {
      expect(['operations', 'event', 'corridor'], id).toContain(m.dashboard);
      expect(['entity', 'anonymous_exact', 'floored'], id).toContain(m.privacy);
      expect(m.source.length, id).toBeGreaterThan(0);
    }
    for (const n of NOT_MEASURED) expect(n.reason.length, n.id).toBeGreaterThan(10);
  });

  test('each dashboard carries its contract block and not-measured list', async () => {
    for (const [fn, path, id] of [
      [handleOperationsDashboard, OPS, 'operations'],
      [handleCorridorDashboard, COR, 'corridor'],
    ] as const) {
      const { status, body } = await call(fn, reqAs(A, path));
      expect(status).toBe(200);
      expect(body.contract.version).toBe(DASHBOARD_CONTRACT_VERSION);
      expect(body.contract.dashboard).toBe(id);
      expect(body.contract.floor).toBe(5);
      expect(body.contract.metrics.length).toBeGreaterThan(0);
      for (const m of body.contract.metrics) expect(DASHBOARD_METRICS).toHaveProperty(m);
      expect(body.not_measured.every((n: Body) => n.dashboard === id)).toBe(true);
      expect(body.scope).toEqual({ brands: [DASH.brandA], data_class: 'production' });
    }
  });

  test('every metric path resolves, and the value has its class shape', async () => {
    const responses: Record<string, Body> = {
      operations: (await call(handleOperationsDashboard, reqAs(A, OPS))).body,
      corridor: (await call(handleCorridorDashboard, reqAs(A, COR))).body,
      event: (await (
        await handleEventDashboard(reqAs(A, `/x/${DASH.bocce}/dashboard`), denv, DASH.bocce)
      ).json()) as Body,
    };
    for (const [id, m] of Object.entries(DASHBOARD_METRICS)) {
      const values = resolvePath(responses[m.dashboard], m.path);
      expect(values.length, `${id} → ${m.path} resolves`).toBeGreaterThan(0);
      for (const v of values)
        expect(hasClassShape(v, m.privacy), `${id} is ${m.privacy}`).toBe(true);
    }
  });

  test('every response leaf is covered by a registered metric path', async () => {
    const envelopeKeys = ['ok', 'status', 'contract', 'scope', 'generated_at', 'not_measured'];
    const responses: Record<string, Body> = {
      operations: (await call(handleOperationsDashboard, reqAs(A, OPS))).body,
      corridor: (await call(handleCorridorDashboard, reqAs(A, COR))).body,
      event: (await (
        await handleEventDashboard(reqAs(A, `/x/${DASH.bocce}/dashboard`), denv, DASH.bocce)
      ).json()) as Body,
    };
    for (const [dash, body] of Object.entries(responses)) {
      const paths = Object.values(DASHBOARD_METRICS)
        .filter((m) => m.dashboard === dash)
        .map((m) => m.path);
      const rest = Object.fromEntries(
        Object.entries(body).filter(([k]) => !envelopeKeys.includes(k))
      );
      const leaves = leafPaths(rest);
      expect(leaves.length, dash).toBeGreaterThan(0);
      for (const leaf of leaves) {
        // A registered path covers itself and everything under it (an
        // object-valued terminal such as a FlooredCount or `event`).
        const covered = paths.some(
          (p) => leaf === p || leaf.startsWith(`${p}.`) || leaf.startsWith(`${p}[]`)
        );
        expect(covered, `${dash}: ${leaf} is registered`).toBe(true);
      }
    }
  });

  test('cost labels name the dashboard routes (no masked segments)', () => {
    expect(normalizeOperation('GET', OPS)).toBe('GET /api/v2/admin/dashboards/operations');
    expect(normalizeOperation('GET', COR)).toBe('GET /api/v2/admin/dashboards/corridor');
    expect(normalizeOperation('GET', `/api/v2/admin/events/${DASH.bocce}/dashboard`)).toBe(
      'GET /api/v2/admin/events/:x/dashboard'
    );
  });

  test('floorBucketsThenSum drops sub-K buckets before the sum', () => {
    expect(floorBucketsThenSum([9, 2])).toEqual({ count: 9, suppressed: false, floor: 5 });
    expect(floorBucketsThenSum([4, 4])).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(floorBucketsThenSum([])).toEqual({ count: null, suppressed: true, floor: 5 });
  });
});

describe('founder / operations cockpit', () => {
  test('lifecycle, reach and sponsors for brand dash-a (demo left out)', async () => {
    const { body } = await call(handleOperationsDashboard, reqAs(A, OPS));
    expect(body.events.total).toBe(3);
    expect(body.events.by_status).toEqual({ draft: 1, ready: 1, active: 1, archived: 0 });
    // bocce is live and published; the ready event is published but not live,
    // the workshop is a draft and unpublished. Only bocce is on the public list.
    expect(body.events.published).toBe(1);
    expect(body.events.created_30d).toBe(3);
    // 7 + 3 + 2 bocce + 3 workshop; the demo's 40 and dash-b's 50 are not here.
    expect(body.reach.poster_scans).toBe(15);
    expect(body.reach.active_posters).toBe(4);
    expect(body.reach.poster_places).toBe(2);
    expect(body.sponsors).toEqual({ on_show: 2, pending_requests: 1 });
    expect(body.shared_report.views_30d).toBe(4);
  });

  test('#7: taps and explicit choices are floored per event, then summed', async () => {
    const { body } = await call(handleOperationsDashboard, reqAs(A, OPS));
    // bocce 9 taps survive; workshop 2 is dropped, not added (9, not 11).
    expect(body.reach.link_taps).toEqual({ count: 9, suppressed: false, floor: 5 });
    // registrations: bocce 7 survives, workshop 3 dropped → 7, not 10.
    expect(body.participation.explicit.registrations).toEqual({
      count: 7,
      suppressed: false,
      floor: 5,
    });
    expect(body.participation.explicit.checkins.count).toBe(6);
    // 2 email signups: under K, suppressed.
    expect(body.participation.explicit.email_signups).toEqual({
      count: null,
      suppressed: true,
      floor: 5,
    });
    expect(body.participation.anonymous.scans).toBe(15);
  });

  test('data_class=all brings the demo event in; a bad value is 400', async () => {
    const { body } = await call(handleOperationsDashboard, reqAs(A, `${OPS}?data_class=all`));
    expect(body.events.total).toBe(4);
    expect(body.reach.poster_scans).toBe(58);
    expect(body.scope.data_class).toBe('all');
    const bad = await call(handleOperationsDashboard, reqAs(A, `${OPS}?data_class=nope`));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_FILTER');
  });
});

describe('#9 tenant isolation', () => {
  test('a dash-a operator never sees dash-b numbers', async () => {
    const { body } = await call(handleOperationsDashboard, reqAs(A, OPS));
    // dash-b holds 50 scans, 99 taps, 20 registrations, 30 check-ins.
    expect(body.reach.poster_scans).toBeLessThan(50);
    expect(body.reach.link_taps.count).not.toBe(108);
    expect(body.participation.explicit.registrations.count).toBe(7);
    expect(body.participation.explicit.checkins.count).toBe(6);
  });

  test('a forged brand_id is 403; an unmapped admin is 403', async () => {
    const forged = await call(
      handleOperationsDashboard,
      reqAs(A, `${OPS}?brand_id=${DASH.brandB}`)
    );
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('BRAND_FORBIDDEN');
    const unmapped = await call(handleCorridorDashboard, reqAs('nobody@x.test', COR));
    expect(unmapped.status).toBe(403);
    expect(unmapped.body.code).toBe('BRAND_SCOPE_DENIED');
    const junk = await call(handleOperationsDashboard, reqAs(A, `${OPS}?brand_id=a%20b`));
    expect(junk.status).toBe(400);
  });

  test('a member of two brands can narrow to one', async () => {
    const both = await call(handleOperationsDashboard, reqAs(AB, OPS));
    expect(both.body.scope.brands).toEqual([DASH.brandA, DASH.brandB]);
    expect(both.body.reach.poster_scans).toBe(65);
    const one = await call(handleOperationsDashboard, reqAs(AB, `${OPS}?brand_id=${DASH.brandB}`));
    expect(one.body.scope.brands).toEqual([DASH.brandB]);
    expect(one.body.reach.poster_scans).toBe(50);
  });

  test('the routes are behind requireAdmin', async () => {
    for (const p of [OPS, COR, `/api/v2/admin/events/${DASH.bocce}/dashboard`]) {
      const res = await SELF.fetch(`https://x${p}`);
      expect([401, 403], p).toContain(res.status);
    }
  });
});

describe('corridor / community intelligence', () => {
  test('category, day part, series and partner network', async () => {
    const { body } = await call(handleCorridorDashboard, reqAs(A, COR));
    expect(body.by_category).toEqual([
      { code: 'REC', label: 'Sports & Recreation', events: 2 },
      { code: 'OTHER', label: 'Other', events: 1 },
    ]);
    expect(body.day_part).toEqual({ weekday: 1, weekend: 2, undated: 0 });
    expect(body.series).toEqual({ series: 1, events_in_series: 2, largest: 2 });
    expect(body.partner_network).toEqual({ sponsors: 2, placements: 2 });
  });

  test('event layer vs source layer, scans floored per cell', async () => {
    const { body } = await call(handleCorridorDashboard, reqAs(A, COR));
    expect(body.event_cells).toEqual([
      { cell: CELL_EVENT, events: 2, live: 1 },
      { cell: CELL_SRC_1, events: 1, live: 0 },
    ]);
    const src = Object.fromEntries(body.source_cells.map((c: Body) => [c.cell, c]));
    // cell 1: bocce 7 + workshop 3 = 10 scans; cell 2: 3 + 2 = 5 scans.
    expect(src[CELL_SRC_1]).toEqual({
      cell: CELL_SRC_1,
      posters: 2,
      scans: { count: 10, suppressed: false, floor: 5 },
    });
    expect(src[CELL_SRC_2].scans).toEqual({ count: 5, suppressed: false, floor: 5 });
  });

  test('#7: a flow under K is left out, not shown', async () => {
    const { body } = await call(handleCorridorDashboard, reqAs(A, COR));
    // cell1 → event cell: 7; cell2 → event cell: 5; cell1 → cell1 (workshop): 3 → omitted.
    expect(body.flows).toEqual([
      {
        source: CELL_SRC_1,
        destination: CELL_EVENT,
        scans: { count: 7, suppressed: false, floor: 5 },
      },
      {
        source: CELL_SRC_2,
        destination: CELL_EVENT,
        scans: { count: 5, suppressed: false, floor: 5 },
      },
    ]);
  });

  test('#7: a sub-K bucket is not recoverable by subtracting two scopes', async () => {
    // Cell 2 holds 5 production scans and 3 demo scans for dash-a. Summing raw
    // counts before the floor would show 8 under data_class=all, and 8 - 5
    // would reveal the suppressed 3.
    const prod = await call(handleCorridorDashboard, reqAs(A, COR));
    const all = await call(handleCorridorDashboard, reqAs(A, `${COR}?data_class=all`));
    const cell2 = (b: Body) => b.source_cells.find((c: Body) => c.cell === CELL_SRC_2).scans;
    expect(cell2(prod.body).count).toBe(5);
    expect(cell2(all.body).count).toBe(5);
    const flow2 = (b: Body) =>
      b.flows.find((f: Body) => f.source === CELL_SRC_2 && f.destination === CELL_EVENT).scans;
    expect(flow2(all.body).count).toBe(5);
    // Across brands too: a member of both sees each brand's bucket floored alone.
    const both = await call(handleCorridorDashboard, reqAs(AB, COR));
    const onlyB = await call(handleCorridorDashboard, reqAs(AB, `${COR}?brand_id=${DASH.brandB}`));
    const cell1 = (b: Body) => b.source_cells.find((c: Body) => c.cell === CELL_SRC_1)?.scans;
    expect(cell1(both.body).count - (cell1(onlyB.body)?.count ?? 0)).toBe(10);
  });

  test('#1: no coordinates or res-9 cells in the response', async () => {
    const res = await handleCorridorDashboard(reqAs(A, COR), denv);
    const text = await res.text();
    expect(text).not.toMatch(/"(lat|lon|latitude|longitude|h3_res9)"/);
  });

  test('a key actor in all-scope must name a brand', async () => {
    const keyEnv = {
      ...denv,
      ADMIN_SCOPE_ALL: 'true',
      ALLOW_ADMIN_KEY_FALLBACK: 'true',
      ADMIN_KEY: 'k-dash',
    } as DashboardsEnv;
    const req = (q: string) =>
      new Request(`https://x${COR}${q}`, { headers: { Authorization: 'Bearer k-dash' } });
    const none = await handleCorridorDashboard(req(''), keyEnv);
    expect(none.status).toBe(400);
    expect(((await none.json()) as Body).code).toBe('BRAND_REQUIRED');
    const named = await handleCorridorDashboard(req(`?brand_id=${DASH.brandB}`), keyEnv);
    expect(named.status).toBe(200);
    expect(((await named.json()) as Body).scope.brands).toEqual([DASH.brandB]);
  });
});

describe('organizer / partner report — one event', () => {
  test('the bocce tournament end to end', async () => {
    const res = await handleEventDashboard(
      reqAs(A, `/api/v2/admin/events/${DASH.bocce}/dashboard`),
      denv,
      DASH.bocce
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.contract.dashboard).toBe('event');
    expect(body.event).toMatchObject({ id: DASH.bocce, status: 'active', is_published: true });
    expect(body.reach.posters).toBe(3);
    expect(body.reach.places).toBe(2);
    expect(body.reach.scans).toBe(12);
    expect(body.reach.clicks).toEqual({ count: 9, suppressed: false, floor: 5 });
    expect(body.participation.anonymous.scans).toBe(12);
    expect(body.participation.explicit.registrations.count).toBe(7);
    expect(body.participation.explicit.email_signups.suppressed).toBe(true);
    // on show, waiting and declined never overlap: the declined placement is
    // still is_active = 1 and must not count as on show.
    expect(body.sponsors).toEqual({ on_show: 2, pending_requests: 1, declined: 1 });
    expect(body.shared_report.views_30d).toBe(4);
  });

  test('the workshop: every identity-derived count under K is suppressed', async () => {
    const res = await handleEventDashboard(
      reqAs(A, `/api/v2/admin/events/${DASH.workshop}/dashboard`),
      denv,
      DASH.workshop
    );
    const body = (await res.json()) as Body;
    expect(body.participation.explicit.registrations).toEqual({
      count: null,
      suppressed: true,
      floor: 5,
    });
    expect(body.reach.clicks.suppressed).toBe(true);
    // Anonymous scans stay exact: a first scan must show.
    expect(body.participation.anonymous.scans).toBe(3);
  });

  test('an unknown event is 404', async () => {
    const res = await handleEventDashboard(
      reqAs(A, '/api/v2/admin/events/nope/dashboard'),
      denv,
      'nope'
    );
    expect(res.status).toBe(404);
  });
});

describe('query failures are 503, never zeroes', () => {
  /** The real DB, except any statement naming `table` fails. */
  function failingOn(db: D1Database, table: string): D1Database {
    return new Proxy(db, {
      get(target, prop) {
        if (prop !== 'prepare') return Reflect.get(target, prop);
        return (sql: string) => {
          if (!sql.includes(table)) return target.prepare(sql);
          const boom = () => Promise.reject(new Error(`no such table: ${table}`));
          const stmt = { bind: () => stmt, all: boom, first: boom, run: boom, raw: boom };
          return stmt;
        };
      },
    });
  }

  test('operations and corridor answer 503 DB_UNAVAILABLE', async () => {
    const broken = { ...denv, DB: failingOn(tenv.DB, 'scan_placement_events') } as DashboardsEnv;
    for (const [fn, path] of [
      [handleOperationsDashboard, OPS],
      [handleCorridorDashboard, COR],
    ] as const) {
      const res = await fn(reqAs(A, path), broken);
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as Body).code).toBe('DB_UNAVAILABLE');
    }
  });

  test('a FORMS_DB failure is 503, not a suppressed zero', async () => {
    const broken = {
      ...denv,
      FORMS_DB: failingOn(tenv.FORMS_DB, 'form_registrations'),
    } as DashboardsEnv;
    const res = await handleOperationsDashboard(reqAs(A, OPS), broken);
    expect(res.status).toBe(503);
  });

  test('the event report is 503 on a failed read, not 404 and not zeroes', async () => {
    const lookup = { ...denv, DB: failingOn(tenv.DB, 'FROM events') } as DashboardsEnv;
    const a = await handleEventDashboard(reqAs(A, '/x'), lookup, DASH.bocce);
    expect(a.status).toBe(503);
    const reach = { ...denv, DB: failingOn(tenv.DB, 'scan_placement_events') } as DashboardsEnv;
    const b = await handleEventDashboard(reqAs(A, '/x'), reach, DASH.bocce);
    expect(b.status).toBe(503);
  });
});
