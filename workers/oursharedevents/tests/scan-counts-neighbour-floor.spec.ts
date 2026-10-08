/**
 * Neighbour-dataset harness for poster scans on every surface that shows them
 * (OSE-1656, K = 5).
 *
 * Owner ruling, 2026-10-08: "there should be no exceptions to the rule. Even
 * at enterprise. the <5 rule still applies so there is consistency." Until
 * then a signed-in admin read poster scans exactly, so a scan under the floor
 * showed up as a +1 somewhere the moment it happened. Every scan figure is
 * now the sum of the poster-hours that each clear the floor
 * (lib/scan-cells.ts), and this file holds every route to it the way a reader
 * would test it:
 *
 *   Seed two datasets one scan apart, in a poster-hour that is under the
 *   floor in both. Read every route as the admin (and the sponsor page as the
 *   sponsor). Nothing published may differ.
 *
 * The control makes the same one-scan change in a poster-hour ABOVE the floor:
 * it must move every route, or the harness proves nothing.
 *
 * Routes: the poster list, the pre-event card (activity + reach), /stats, the
 * event dashboard, the operations and corridor dashboards, and the sponsor's
 * page. Every key of every JSON answer is compared (bar `generated_at`).
 *
 * @born-red OSE-1656 | method: run against the handlers on main at 43d593f
 *   (exact scans for the organizer): each lever moved 6 or 7 of the 7 routes
 *   (5 of 5 tests red, with the corridor case above) | date: 2026-10-08
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND = 'nbr-scans';
const EVENT = 'nbr-scans-evt';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const CELL_EVENT = '872664c1affffff';
const CELL_VENUE = '872664c1effffff';
const CELL_COMMUNITY = '872664c18ffffff';
const POSTERS = { p1: CELL_VENUE, p2: CELL_COMMUNITY, p3: CELL_COMMUNITY } as const;
type Poster = keyof typeof POSTERS;

/** The hour `hoursAgo` before now, as scan_bucket stores it. */
const hour = (hoursAgo: number) =>
  new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString().slice(0, 13) + ':00';
const H1 = hour(2);
const H2 = hour(26);

/** Scans per poster and hour. Posters and the event never change. */
type World = Partial<Record<`${Poster}@${'H1' | 'H2'}`, number>>;

const BASE: World = { 'p1@H1': 7, 'p2@H1': 3, 'p1@H2': 2 };

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
    db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT),
  ];
  for (const [key, n] of Object.entries(w)) {
    const [poster, h] = key.split('@') as [Poster, 'H1' | 'H2'];
    for (let i = 0; i < (n ?? 0); i++) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
             VALUES (?, ?, ?, ?)`
          )
          .bind(`nbs-${key}-${i}`, EVENT, `nbs-${poster}`, h === 'H1' ? H1 : H2)
      );
    }
  }
  await db.batch(stmts);
}

let sponsorToken = '';

beforeAll(async () => {
  await runAll(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await runAll(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  const db = tenv().DB;
  await db.batch([
    db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM poster_deployments WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM sponsor_placement WHERE event_id = ?').bind(EVENT),
    db.prepare("DELETE FROM sponsor_business WHERE id = 'nbs-sponsor'"),
    db.prepare('DELETE FROM events WHERE id = ?').bind(EVENT),
  ]);
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, timezone,
                           location, h3_res7, data_class)
       VALUES (?, ?, 'Scan harness', 'nbr-scans', 'active', 1, '2099-06-01', 'America/Chicago',
               'Eagles Hall', ?, 'production')`
    )
    .bind(EVENT, BRAND, CELL_EVENT)
    .run();
  for (const [p, cell] of Object.entries(POSTERS)) {
    await db
      .prepare(
        `INSERT INTO poster_deployments (id, event_id, qr_token, is_active, h3_res7, placement_type, placement_label)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(`nbs-${p}`, EVENT, `qrt-nbs-${p}`, cell, p === 'p1' ? 'venue' : 'community', p)
      .run();
  }
  // A sponsor who has accepted: their page shows the event's pre-event reach.
  await db
    .prepare(
      `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES ('nbs-sponsor', ?, 'Corner Cafe', 1)`
    )
    .bind(BRAND)
    .run();
  await db
    .prepare(
      `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted)
       VALUES ('nbs-placement', 'nbs-sponsor', ?, 'standard', 'organizer', 1, 1)`
    )
    .bind(EVENT)
    .run();
  const minted = await mintSponsorHomeToken(tenv(), 'nbs-sponsor', BRAND);
  expect(minted).not.toBeNull();
  sponsorToken = minted!.token;
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

const ROUTES: Array<{ name: string; read: () => Promise<string> }> = [
  ...[
    `/api/v2/admin/events/${EVENT}/poster-deployments`,
    `/api/v2/admin/events/${EVENT}/pre-event-activity`,
    `/api/v2/admin/events/${EVENT}/stats`,
    `/api/v2/admin/events/${EVENT}/dashboard`,
    `/api/v2/admin/dashboards/operations?brand_id=${BRAND}`,
    `/api/v2/admin/dashboards/corridor?brand_id=${BRAND}`,
  ].map((path) => ({
    name: path.replace(`/api/v2/admin/`, '').replace(EVENT, ':id'),
    read: async () => {
      const res = await SELF.fetch(`https://t.test${path}`, { headers: ADMIN });
      expect(res.status, path).toBe(200);
      return JSON.stringify(stable(await res.json()));
    },
  })),
  {
    name: 'sponsor page reach line',
    read: async () => {
      const res = await SELF.fetch(`https://t.test/sponsor?t=${encodeURIComponent(sponsorToken)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      const at = html.indexOf('data-testid="placement-reach"');
      expect(at, 'the reach line is on the sponsor page').toBeGreaterThan(-1);
      return html.slice(at, html.indexOf('</p>', at));
    },
  },
];

async function readAll(w: World): Promise<Record<string, string>> {
  await seedWorld(w);
  const out: Record<string, string> = {};
  for (const r of ROUTES) out[r.name] = await r.read();
  return out;
}

function moved(a: Record<string, string>, b: Record<string, string>): string[] {
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

describe('OSE-1656 | one scan in a poster-hour under the floor moves nothing anyone reads', () => {
  const levers: Array<[string, World]> = [
    ['a poster with 3 in one hour gains a fourth', { ...BASE, 'p2@H1': 4 }],
    ['a busy poster with 2 in another hour gains a third', { ...BASE, 'p1@H2': 3 }],
    ['a poster with none gains its first', { ...BASE, 'p3@H1': 1 }],
  ];
  for (const [name, world] of levers) {
    test(name, async () => {
      const before = await readAll(BASE);
      const after = await readAll(world);
      expect(moved(before, after), 'routes whose answer moved').toEqual([]);
    });
  }

  test('control: one more scan in the poster-hour of 7 moves every route', async () => {
    const before = await readAll(BASE);
    const after = await readAll({ ...BASE, 'p1@H1': 8 });
    expect(moved(before, after).sort()).toEqual(ROUTES.map((r) => r.name).sort());
  });

  test('the base dataset publishes the poster-hour of 7 everywhere, and only it', async () => {
    const all = await readAll(BASE);
    const stats = JSON.parse(all['events/:id/stats']) as { stats: { scans: unknown } };
    expect(stats.stats.scans).toEqual({ count: 7, suppressed: false, floor: 5 });
    const ops = JSON.parse(all[`dashboards/operations?brand_id=${BRAND}`]) as {
      reach: { poster_scans: unknown };
    };
    expect(ops.reach.poster_scans).toEqual({ count: 7, suppressed: false, floor: 5 });
    expect(all['sponsor page reach line']).toContain('7 poster scans');
  });
});
