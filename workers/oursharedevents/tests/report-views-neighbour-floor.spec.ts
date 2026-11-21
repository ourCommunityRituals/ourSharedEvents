/**
 * Neighbour-dataset harness for report views (OSE-2087, K = 5).
 *
 * `shared_report.views_30d` counts how often an event's SharedReport was
 * opened. It is the sum of the event-days that each reach 5
 * (`floorTotalOfParts` in handlers/dashboards.ts). With one partner holding a
 * report link, an exact figure is a log of that one person's visits, so a view
 * under the floor must not show up anywhere as a +1.
 *
 *   Seed two datasets one view apart, in an event-day that is under the floor
 *   in both. Read both routes that publish the figure, as the admin. Nothing
 *   published may differ.
 *
 * The control makes the same one-view change in an event-day ABOVE the floor:
 * it must move both routes, or the harness proves nothing.
 *
 * Routes: the event dashboard and the operations dashboard. No other route
 * reads `report_access_log`. Every key of each JSON answer is compared (bar
 * `generated_at`).
 *
 * A view is stored per day, event, role and outcome; the cell that is floored
 * is the event-day, all roles together. Denied opens are not views.
 *
 * @born-red OSE-2087 | method: one fault at a time in handlers/dashboards.ts.
 *   The event dashboard's views summed unfloored: 6 of 8 red (every under-floor
 *   lever moved the event route; the base check read 12, not 7). The operations
 *   cells summed unfloored: 6 of 8 red, the same way on the operations route.
 *   The event query without `outcome = 'granted'`: 1 of 8 red (the denied
 *   lever) | date: 2026-11-16
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND = 'nbr-views';
const EVENT = 'nbr-views-evt';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

/** The UTC day `daysAgo` before today, as report_access_log stores it. */
const day = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const DAYS = { D1: day(2), D2: day(5), D3: day(8) } as const;
type Day = keyof typeof DAYS;
type Role = 'bar_owner' | 'admin';

/** Views per day, role and outcome ("granted" unless the key says denied). */
type World = Partial<Record<`${Day}/${Role}` | `${Day}/${Role}/denied`, number>>;

/** D1 is a day of 7 (4 + 3 across two roles). D2 is a day of 3. D3 has none. */
const BASE: World = { 'D1/bar_owner': 4, 'D1/admin': 3, 'D2/bar_owner': 3 };

async function runAll(db: D1Database, json: string) {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function seedWorld(w: World): Promise<void> {
  const db = tenv().DB;
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM report_access_log WHERE event_id = ?').bind(EVENT),
  ];
  for (const [key, n] of Object.entries(w)) {
    if (!n) continue;
    const [d, role, denied] = key.split('/') as [Day, Role, 'denied' | undefined];
    stmts.push(
      db
        .prepare(
          `INSERT INTO report_access_log (id, date, event_id, role, outcome, access_count)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(`nbv-${key}`, DAYS[d], EVENT, role, denied ? 'denied' : 'granted', n)
    );
  }
  await db.batch(stmts);
}

beforeAll(async () => {
  await runAll(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await runAll(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  const db = tenv().DB;
  await db.batch([
    db.prepare('DELETE FROM report_access_log WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM events WHERE id = ?').bind(EVENT),
  ]);
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, timezone,
                           location, data_class)
       VALUES (?, ?, 'Views harness', 'nbr-views', 'active', 1, '2099-06-01', 'America/Chicago',
               'Eagles Hall', 'production')`
    )
    .bind(EVENT, BRAND)
    .run();
});

/** Drop the clock: two reads a moment apart must compare equal. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== 'generated_at')
        .map(([k, x]) => [k, stable(x)])
    );
  }
  return v;
}

const EVENT_ROUTE = 'events/:id/dashboard';
const OPS_ROUTE = 'dashboards/operations';
const ROUTES: Array<{ name: string; path: string }> = [
  { name: EVENT_ROUTE, path: `/api/v2/admin/events/${EVENT}/dashboard` },
  { name: OPS_ROUTE, path: `/api/v2/admin/dashboards/operations?brand_id=${BRAND}` },
];

async function readAll(w: World): Promise<Record<string, string>> {
  await seedWorld(w);
  const out: Record<string, string> = {};
  for (const r of ROUTES) {
    const res = await SELF.fetch(`https://t.test${r.path}`, { headers: ADMIN });
    expect(res.status, r.path).toBe(200);
    out[r.name] = JSON.stringify(stable(await res.json()));
  }
  return out;
}

function moved(a: Record<string, string>, b: Record<string, string>): string[] {
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

const views = (json: string) =>
  (JSON.parse(json) as { shared_report: { views_30d: unknown } }).shared_report.views_30d;

describe('OSE-2087 | one report view in an event-day under the floor moves nothing anyone reads', () => {
  const levers: Array<[string, World]> = [
    ['a day of 3 gains a fourth view', { ...BASE, 'D2/bar_owner': 4 }],
    ['a day of 3 gains a view by a second role', { ...BASE, 'D2/admin': 1 }],
    ['a day with none gains its first view', { ...BASE, 'D3/bar_owner': 1 }],
    [
      'two days of 4 and 3 (7 in all, never 5 in one day) read as the day of 3',
      { ...BASE, 'D2/bar_owner': 4, 'D3/bar_owner': 3 },
    ],
    [
      'a refused open is not a view, on a day under the floor or over it',
      {
        ...BASE,
        'D1/bar_owner/denied': 6,
        'D2/bar_owner/denied': 6,
      },
    ],
  ];
  for (const [name, world] of levers) {
    test(name, async () => {
      const before = await readAll(BASE);
      const after = await readAll(world);
      expect(moved(before, after), 'routes whose answer moved').toEqual([]);
    });
  }

  // Published counts are rounded down to a multiple of 5 (OSE-2151), so the
  // control crosses a step: a day of 9 -> 10 moves both routes, where 7 -> 8
  // would not.
  test('control: one more view on a day, from 9 to 10, moves both routes', async () => {
    const before = await readAll({ ...BASE, 'D1/bar_owner': 6 });
    const after = await readAll({ ...BASE, 'D1/bar_owner': 7 });
    expect(moved(before, after).sort()).toEqual(ROUTES.map((r) => r.name).sort());
  });

  test('the base dataset publishes the day of 7 on both routes, and only it', async () => {
    const all = await readAll(BASE);
    for (const r of ROUTES)
      expect(views(all[r.name]), r.name).toEqual({ count: 5, suppressed: false, floor: 5 }); // 7, rounded down
  });

  test('with no day at 5 the figure is withheld, and reads the same as no views at all', async () => {
    const none = await readAll({});
    const some = await readAll({ 'D1/bar_owner': 4, 'D2/bar_owner': 4, 'D3/admin': 4 });
    expect(moved(none, some)).toEqual([]);
    for (const r of ROUTES)
      expect(views(some[r.name]), r.name).toEqual({ count: null, suppressed: true, floor: 5 });
  });
});
