/**
 * GET /api/v2/admin/events/:id/booths/counts (OSE-2004, OSE ADR-034 decision 6):
 * scans per stall for the organizer, through the router, at the workers-pool layer.
 *
 * The fair below, one dataset for every test:
 *   stall A1 (food)            table card 4 scans at 10:00, banner 3 at 11:00
 *   stall A2 (craft)           table card 7 scans at 10:00
 *   stall A3 (food, out of use) no placement
 *   a placement with no stall  6 scans at 12:00
 *   a placement pointing at another brand's stall (seeded past the API) 5 at 13:00
 *
 * Rules held here:
 *   1. the wire shape: every count a FlooredCount, withheld as
 *      `{count:null, suppressed:true, floor:5}`, the shape /stats and the poster
 *      list use; any_withheld a boolean; no count field outside the shape;
 *   2. what each surface shows for A1 (4 + 3) and A2 (7), and that the route,
 *      /stats and the poster list agree field by field;
 *   3. the brand wall: another brand's admin gets the unknown-event 404, and a
 *      stall of another event or brand never joins the list;
 *   4. the plan cap (OSE-682) and the platform read's audit.
 *
 * @born-red OSE-2004 | method: run with the route switched off in router.ts
 *   (8 of 10 red; the 2 that pass are 404s the router's object-scope guard
 *   answers with or without this route); then one
 *   fault at a time, each restored before the next:
 *   (1) the floor removed on the stall count (raw sum, never withheld): 5 of 10 red;
 *   (2) the pooled total from the raw cell sum: 3 of 10 red;
 *   (3) `any_withheld` replaced by the number of withheld rows: 2 of 10 red;
 *   (4) the stall read's event predicate loosened (`OR 1 = 1`): 4 of 10 red;
 *   (5) the plan cap skipped (hasPaidReport forced true): 1 of 10 red
 * | date: 2026-11-16
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { BOOTH_COUNTS_KEYS, BOOTH_COUNT_ROW_KEYS } from '../src/lib/booth-counts';
import { usePaidReportPlan } from './helpers/paid-report-plan';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-bcr-a';
const BRAND_B = 'brand-bcr-b';
const OWNER_A = 'owner-bcr-a@example.com';
const OWNER_B = 'owner-bcr-b@example.com';
const FAIR = 'evt-bcr-a1';
const FREE_FAIR = 'evt-bcr-a2'; // same brand, on a plan without the paid report
const OTHER = 'evt-bcr-b1'; // another brand's fair

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
  };
}
const A = asEmail(OWNER_A);
const B = asEmail(OWNER_B);
/** Automation with ADMIN_SCOPE_ALL (workers vitest config): a platform reader. */
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

type Json = Record<string, any>;

async function get(
  path: string,
  headers: Record<string, string>
): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, { headers }), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}
const counts = (id: string) => `/api/v2/admin/events/${id}/booths/counts`;

const WITHHELD = { count: null, suppressed: true, floor: 5 };
const shown = (count: number) => ({ count, suppressed: false, floor: 5 });

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();

async function scans(eventId: string, poster: string, hour: string, n: number) {
  for (let i = 0; i < n; i++)
    await run(
      `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, ?, ?)`,
      `bcr-${poster}-${hour}-${i}`,
      eventId,
      poster,
      `2026-12-05T${hour}:00`
    );
}

beforeAll(async () => {
  await applyMigrations();
  await usePaidReportPlan();
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ])
    await run(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
      email,
      brand
    );
  for (const [id, brand] of [
    [FAIR, BRAND_A],
    [FREE_FAIR, BRAND_A],
    [OTHER, BRAND_B],
  ])
    await run(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
       VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', '2026-12-05T15:00:00.000Z', '2026-12-05T21:00:00.000Z', 'America/Chicago')`,
      id,
      brand,
      `Fair ${id}`,
      id
    );
  const booth = (
    id: string,
    eventId: string,
    number: string,
    category: string | null,
    active = 1,
    sort = 0
  ) =>
    run(
      `INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      eventId,
      number,
      `Stall ${number}`,
      category,
      active,
      sort
    );
  await booth('bcr-a1', FAIR, 'A1', 'food', 1, 1);
  await booth('bcr-a2', FAIR, 'A2', 'craft', 1, 2);
  await booth('bcr-a3', FAIR, 'A3', 'food', 0, 0);
  await booth('bcr-b1', OTHER, 'B1', 'food', 1, 0);
  await booth('bcr-f1', FREE_FAIR, 'F1', 'art', 1, 0);
  const placement = (id: string, eventId: string, boothId: string | null) =>
    run(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id)
       VALUES (?, ?, ?, 'Table card', 1, ?)`,
      id,
      eventId,
      `qrt_${id}`,
      boothId
    );
  await placement('bcr-p1', FAIR, 'bcr-a1');
  await placement('bcr-p2', FAIR, 'bcr-a1');
  await placement('bcr-p3', FAIR, 'bcr-a2');
  await placement('bcr-p4', FAIR, null);
  // Past the API (which refuses it): a placement of this fair pointing at
  // another brand's stall. It must count as "no stall" here and never there.
  await placement('bcr-p5', FAIR, 'bcr-b1');
  await placement('bcr-pb', OTHER, 'bcr-b1');
  await placement('bcr-pf', FREE_FAIR, 'bcr-f1');
  await scans(FAIR, 'bcr-p1', '10', 4);
  await scans(FAIR, 'bcr-p2', '11', 3);
  await scans(FAIR, 'bcr-p3', '10', 7);
  await scans(FAIR, 'bcr-p4', '12', 6);
  await scans(FAIR, 'bcr-p5', '13', 5);
  await scans(OTHER, 'bcr-pb', '10', 40);
  await scans(FREE_FAIR, 'bcr-pf', '10', 9);
  await scans(FREE_FAIR, 'bcr-pf', '11', 2);
  await tenv.FORMS_DB.prepare(
    `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
     VALUES ('bcr-free', 'event', ?, 'analytics.shared-report', 0, datetime('now'))
     ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = 0`
  )
    .bind(FREE_FAIR)
    .run();
});

describe('the wire shape, and what a stall of 4 + 3 and a stall of 7 read', () => {
  test('each stall, category, "no stall" and the total', async () => {
    const { status, json } = await get(counts(FAIR), A);
    expect(status).toBe(200);
    expect(json.booths).toEqual([
      {
        id: 'bcr-a1',
        number: 'A1',
        name: 'Stall A1',
        category: 'food',
        is_active: true,
        scans: WITHHELD,
      },
      {
        id: 'bcr-a2',
        number: 'A2',
        name: 'Stall A2',
        category: 'craft',
        is_active: true,
        scans: shown(7),
      },
      {
        id: 'bcr-a3',
        number: 'A3',
        name: 'Stall A3',
        category: 'food',
        is_active: false,
        scans: WITHHELD,
      },
    ]);
    expect(json.categories).toEqual([
      { category: 'food', booths: 2, scans: WITHHELD },
      { category: 'craft', booths: 1, scans: shown(7) },
    ]);
    expect(json.no_stall).toEqual({ placements: 2, scans: shown(11) });
    expect(json.total).toEqual(shown(18));
    expect(json.any_withheld).toBe(true);
  });

  test('only the declared keys; every number sits in a FlooredCount or is a count of things', async () => {
    const { json } = await get(counts(FAIR), A);
    expect(Object.keys(json).sort()).toEqual(
      ['ok', 'status', 'event_id', ...BOOTH_COUNTS_KEYS].sort()
    );
    for (const b of json.booths)
      expect(Object.keys(b).sort()).toEqual([...BOOTH_COUNT_ROW_KEYS].sort());
    for (const c of json.categories)
      expect(Object.keys(c).sort()).toEqual(['booths', 'category', 'scans']);
    expect(Object.keys(json.no_stall).sort()).toEqual(['placements', 'scans']);
    expect(typeof json.any_withheld).toBe('boolean');
    // Walk every leaf: a number is allowed only as a FlooredCount's count or
    // floor, the HTTP status, or a count of stalls or placements.
    const ENTITY = new Set(['status', 'categories[].booths', 'no_stall.placements']);
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, `${path}[]`));
      if (v && typeof v === 'object') {
        const keys = Object.keys(v).sort().join(',');
        if (keys === 'count,floor,suppressed') {
          const f = v as { count: unknown; floor: unknown; suppressed: unknown };
          if (f.floor !== 5) bad.push(`${path}.floor`);
          if (f.count !== null && !(typeof f.count === 'number' && f.count >= 5))
            bad.push(`${path}.count`);
          if ((f.count === null) !== (f.suppressed === true)) bad.push(`${path}.suppressed`);
          return;
        }
        for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
        return;
      }
      if (typeof v === 'number' && !ENTITY.has(path)) bad.push(path);
    };
    walk(json, '');
    expect(bad).toEqual([]);
  });

  test('the route, /stats and the poster list agree, field by field', async () => {
    const mine = (await get(counts(FAIR), A)).json;
    const stats = (await get(`/api/v2/admin/events/${FAIR}/stats`, A)).json;
    const posters = (await get(`/api/v2/admin/events/${FAIR}/poster-deployments`, A)).json;
    expect(stats.stats.scans).toEqual(mine.total);
    const byId = new Map<string, Json>((posters.items as Json[]).map((p) => [p.id, p.scans]));
    // A1: both its posters are withheld; the stall is withheld, not 7.
    expect([byId.get('bcr-p1'), byId.get('bcr-p2')]).toEqual([WITHHELD, WITHHELD]);
    expect(byId.get('bcr-p3')).toEqual(shown(7));
    // Each stall is the sum of its posters' published counts, exactly.
    for (const b of mine.booths as Json[]) {
      const own = (posters.items as Json[]).filter((p) => p.booth_id === b.id);
      const sum = own.reduce((s, p) => s + (p.scans.count ?? 0), 0);
      expect(b.scans.count ?? 0, b.number).toBe(sum);
    }
    // And the classic subtraction finds nothing.
    const listed = (mine.booths as Json[]).reduce((s, b) => s + (b.scans.count ?? 0), 0);
    expect(mine.total.count - listed - (mine.no_stall.scans.count ?? 0)).toBe(0);
  });
});

describe('the brand wall', () => {
  test('another brand’s admin gets the 404 an unknown event gets', async () => {
    const theirs = await get(counts(FAIR), B);
    const missing = await get(counts('evt-bcr-none'), B);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    // The same body bar the per-request fields and the id the path named.
    const same = (j: Json, id: string) => {
      const { requestId: _r, timestamp: _t, ...rest } = j;
      return JSON.parse(JSON.stringify(rest).split(id).join(':id'));
    };
    expect(same(theirs.json, FAIR)).toEqual(same(missing.json, 'evt-bcr-none'));
  });

  test('an admin cannot read another brand’s fair either way round', async () => {
    expect((await get(counts(OTHER), A)).status).toBe(404);
    expect((await get(counts(OTHER), B)).status).toBe(200);
  });

  test('another brand’s stall never joins this fair’s list, even with a placement pointing at it', async () => {
    const { json } = await get(counts(FAIR), A);
    expect((json.booths as Json[]).map((b) => b.id)).not.toContain('bcr-b1');
    const theirs = (await get(counts(OTHER), B)).json;
    expect(theirs.booths).toEqual([
      {
        id: 'bcr-b1',
        number: 'B1',
        name: 'Stall B1',
        category: 'food',
        is_active: true,
        scans: shown(40),
      },
    ]);
  });

  test('without a session the route answers 401', async () => {
    expect((await get(counts(FAIR), {})).status).toBe(401);
  });
});

describe('the plan (OSE-682) and the platform read', () => {
  test('Free plan, brand admin: the stalls and the fair total only, and a note naming what is left out', async () => {
    const { status, json } = await get(counts(FREE_FAIR), A);
    expect(status).toBe(200);
    expect(json.booths).toEqual([
      { id: 'bcr-f1', number: 'F1', name: 'Stall F1', category: 'art', is_active: true },
    ]);
    expect(json.categories).toEqual([{ category: 'art', booths: 1 }]);
    expect(json.no_stall).toEqual({ placements: 0 });
    expect(json.total).toEqual(shown(9));
    expect('any_withheld' in json).toBe(false);
    expect(json.plan).toEqual({
      paid_report: false,
      locked_sections: ['booths.scans', 'categories.scans', 'no_stall.scans', 'any_withheld'],
      next_plan: 'mid',
    });
    const stats = (await get(`/api/v2/admin/events/${FREE_FAIR}/stats`, A)).json;
    expect(stats.stats.scans).toEqual(json.total);
  });

  test('a platform admin reads the Free fair whole, and that read is audited', async () => {
    const { status, json } = await get(counts(FREE_FAIR), KEY);
    expect(status).toBe(200);
    expect(json.booths[0].scans).toEqual(shown(9));
    const row = await tenv.DB.prepare(
      `SELECT action, outcome FROM admin_audit_log WHERE action = 'READ_PAST_PLAN' AND resource_id = ? ORDER BY rowid DESC LIMIT 1`
    )
      .bind(FREE_FAIR)
      .first<{ action: string; outcome: string }>();
    expect(row).toEqual({ action: 'READ_PAST_PLAN', outcome: 'success' });
  });

  test('an unknown event, to a platform admin, is a 404', async () => {
    expect((await get(counts('evt-bcr-none'), KEY)).status).toBe(404);
  });
});
