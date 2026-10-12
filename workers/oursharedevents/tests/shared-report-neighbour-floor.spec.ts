/**
 * Neighbour-dataset harness for the SharedReport count floor (K = 5).
 *
 * The promise is "never who, only how many": a count under K is withheld, and
 * nothing else in the report may give it back. A unit test of one field cannot
 * prove that, because the leak is usually in a DIFFERENT field (a total, a
 * rate, a note). So this harness asks the question the way a reader would:
 *
 *   Seed two datasets that differ by exactly ONE person (one scan, one click,
 *   one returning visitor) in a group that is under the floor in both. Read the
 *   report for each through the real routes. Nothing published may differ.
 *
 * It compares EVERY leaf of the response (numbers, strings, nulls, array
 * lengths), not a list of fields someone remembered, for every kind of token
 * the read path accepts, and it prints each field that differed.
 *
 * Two things keep it honest:
 *   - Each lever has a control: the same one-person change made ABOVE the floor
 *     must be visible. A lever that changes nothing in the report proves nothing.
 *   - The base dataset must light up every section, so a null-everywhere report
 *     cannot pass by having nothing to compare.
 *
 * Datasets are seeded at the tables the report reads (the materialised
 * aggregates), with fixed timestamps, so the only difference between the two
 * reads is the one unit under test.
 *
 * Requests go to the Worker's own `fetch` entry (router, limiter, handler,
 * builder, D1), not through `SELF.fetch`: the pool wraps its entrypoint one
 * layer deeper on every `SELF.fetch`, and a file that makes about a thousand of
 * them dies with "Maximum call stack size exceeded". This file makes more.
 *
 * What is still open is in `OPEN`, near the bottom: pairs where a published
 * field still moves, pinned exactly, so the list can only shrink. Every other
 * pair must not move at all.
 *
 * Last comes the field registry: every number any of those reads returned must
 * be listed with the rule that floors it, and must keep that rule in every
 * dataset. A new number in the response with no entry fails.
 *
 * Seen red: with main's report builder (before `floorTotalOfParts` and
 * `flooredRatePct`) 18 hidden pairs, 6 zero pairs and the registry fail, on
 * `click_outs.total`, `return_rate.venue_pct` and `return_rate.corridor_pct`.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { CORRIDOR_BASELINE_MIN_SAMPLE, CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { mintSignedLinkToken, type SignedLinkRole } from '../src/lib/shared-report-auth';
import { _deleteRateLimitKey, type RateLimitEnv } from '../src/lib/rate-limit';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const K = CORRIDOR_MAP_MIN_COUNT;
const SIGNING_SECRET = 'test-shared-report-signing-secret-do-not-use';
const INTERNAL_TOKEN = 'test-internal-batch-token-do-not-use';
const WKRP_TOKEN = 'test-wkrp-service-token-do-not-use';

const CELL7 = '872664544ffffff';
const CELL9_A = '89266454447ffff';
const CELL9_B = '8926645441bffff';
const STAMP = '2026-05-08 03:00:00';

// ─── The dataset ────────────────────────────────────────────────────────────

/**
 * Everything the report reads, as plain numbers. One field = one lever.
 * `BASE` clears the floor everywhere, so every section publishes.
 */
interface World {
  /** People in the event's second hour bucket (scan_aggregates). */
  hourPeople: number;
  /** People in a second hour bucket of the earlier event in the same series. */
  siblingHourPeople: number;
  /** People seen at this event (anon_id_returns rows). */
  attendees: number;
  /** Of those, how many were also at the earlier event of the series (OSE-1652). */
  cameTwice: number;
  /** Of those, how many were also seen at the sibling event in the corridor. */
  seenElsewhere: number;
  /** Corridor baseline, distinct attendees in 30 / 90 days. */
  baseline30: number;
  baseline90: number;
  /** Sponsor A's impressions on a second surface. */
  sponsorSurface: number;
  /** Sponsor C's only impressions (a sponsor whose every row may be small). */
  sponsorOnly: number;
  /** Scans at poster 1 in a second hour. */
  posterHour: number;
  /** Scans at poster 2 (its only hour). */
  posterOnly: number;
  /** Scans in map cell A in a second hour. */
  cellHour: number;
  /** Scans in map cell B (its only hour). */
  cellOnly: number;
  /** Short-link clicks per destination kind. */
  clicksPublic: number;
  clicksDonate: number;
}

const BASE: World = {
  hourPeople: 11,
  siblingHourPeople: 11,
  attendees: 20,
  cameTwice: 10,
  seenElsewhere: 10,
  baseline30: 40,
  baseline90: 80,
  sponsorSurface: 11,
  sponsorOnly: 11,
  posterHour: 11,
  posterOnly: 11,
  cellHour: 11,
  cellOnly: 11,
  clicksPublic: 20,
  clicksDonate: 11,
};

/** Rows the sibling event always has in anon_id_returns (shared + its own). */
const SIBLING_ATTENDEES = 30;

let migrated = false;
async function applyMigrations(): Promise<void> {
  // Once per isolate: a second apply rewrites sponsor_displays' foreign key
  // (see the note in shared-report-kanon-floor.spec.ts).
  if (migrated) return;
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
  migrated = true;
}

async function clearWorld(): Promise<void> {
  const db = tenv().DB;
  await db.batch([
    db.prepare(`DELETE FROM anon_id_returns`),
    db.prepare(`DELETE FROM corridor_density_baseline`),
    db.prepare(`DELETE FROM scan_aggregates`),
    db.prepare(`DELETE FROM scan_cell_aggregates`),
    db.prepare(`DELETE FROM scan_placement_events`),
    db.prepare(`DELETE FROM poster_deployments WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM sponsor_displays WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM sponsor_asset WHERE sponsor_business_id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM sponsor_placement WHERE sponsor_business_id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM sponsor_business WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM campaigns WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM shortlinks WHERE event_id LIKE 'nbr-%'`),
    db.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM event_series WHERE id LIKE 'nbr-%'`),
    db.prepare(`DELETE FROM events WHERE id LIKE 'nbr-%'`),
  ]);
}

const hash = (prefix: string, i: number): string => `${prefix}${String(i).padStart(4, '0')}`;

/** Seed one whole dataset for `eventId`. Deterministic: same world, same rows. */
async function seedWorld(eventId: string, w: World): Promise<void> {
  const db = tenv().DB;
  // Two other events, one per question, so each lever moves one thing. `sib`
  // shares the corridor cell and no series (corridor_pct); `ser` is the earlier
  // event of the series and has no cell (venue_pct and headcount_trend).
  const sib = `${eventId}-sib`;
  const ser = `${eventId}-ser`;
  const series = `${eventId}-series`;
  const camp = `${eventId}-camp`;
  const sp = (x: string) => `${eventId}-sp${x}`;

  const stmts: D1PreparedStatement[] = [];
  const event = (id: string, start: string, end: string, cell: string | null = CELL7) =>
    db
      .prepare(
        `INSERT INTO events
           (id, brand_id, title, slug, status, location, h3_res7, timezone,
            start_date, end_date, created_at, updated_at)
         VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, 'America/Chicago',
                 ?, ?, ?, ?)`
      )
      .bind(id, `Neighbour ${id}`, id, cell, start, end, STAMP, STAMP);
  stmts.push(event(eventId, '2026-05-07T19:00:00Z', '2026-05-07T23:00:00Z'));
  stmts.push(event(sib, '2026-04-30T19:00:00Z', '2026-04-30T23:00:00Z'));
  stmts.push(event(ser, '2026-04-23T19:00:00Z', '2026-04-23T23:00:00Z', null));
  stmts.push(
    db
      .prepare(
        `INSERT INTO event_series (id, venue_id, series_name, state, created_at, updated_at)
         VALUES (?, ?, 'Thursday League', 'confirmed', ?, ?)`
      )
      .bind(series, eventId, STAMP, STAMP),
    // The series points at its anchor event, so the events join it afterwards.
    db.prepare(`UPDATE events SET series_id = ? WHERE id IN (?, ?)`).bind(series, eventId, ser)
  );

  // People per hour bucket. A constant sub-K bucket rides along (3), so a rule
  // that let two small buckets add up past the floor would show.
  const bucket = (ev: string, hour: number, people: number) =>
    db
      .prepare(
        `INSERT INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-05-07', ?, ?, ?, ?)`
      )
      .bind(`${ev}-sa-${hour}`, ev, hour, people * 2, people, STAMP);
  stmts.push(bucket(eventId, 19, 20), bucket(eventId, 21, 3));
  if (w.hourPeople > 0) stmts.push(bucket(eventId, 20, w.hourPeople));
  stmts.push(bucket(sib, 19, 12), bucket(sib, 21, 3));
  stmts.push(bucket(ser, 19, 12), bucket(ser, 21, 3));
  if (w.siblingHourPeople > 0) stmts.push(bucket(ser, 20, w.siblingHourPeople));

  // People seen at the event. The first `cameTwice` were also at the earlier
  // event of the series; the LAST `seenElsewhere` were also at the corridor
  // sibling. `visit_count` stays 1: it counts job runs, and nothing reads it.
  // The sibling's own row count is held constant, so only the overlap moves.
  const anon = (h: string, venue: string, visits: number) =>
    db
      .prepare(
        `INSERT INTO anon_id_returns
           (anon_id_hash, venue_id, first_seen_at, last_seen_at, visit_count, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(h, venue, STAMP, STAMP, visits, STAMP);
  for (let i = 0; i < w.attendees; i++) {
    stmts.push(anon(hash('aaaa', i), eventId, 1));
    if (i < w.cameTwice) stmts.push(anon(hash('aaaa', i), ser, 1));
  }
  for (let i = 0; i < w.seenElsewhere; i++) {
    stmts.push(anon(hash('aaaa', w.attendees - 1 - i), sib, 1));
  }
  for (let i = 0; i < SIBLING_ATTENDEES - w.seenElsewhere; i++) {
    stmts.push(anon(hash('bbbb', i), sib, 1));
  }

  if (w.baseline30 > 0 || w.baseline90 > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO corridor_density_baseline
             (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
           VALUES (?, 4, 19, ?, ?, ?)`
        )
        .bind(CELL7, w.baseline30, w.baseline90, STAMP)
    );
  }

  stmts.push(
    db
      .prepare(
        `INSERT INTO campaigns (id, brand_id, title, status, created_at, updated_at)
         VALUES (?, 'test-brand', 'Spring Push', 'active', ?, ?)`
      )
      .bind(camp, STAMP, STAMP)
  );

  // Posters and the scans at them, per hour.
  const poster = (id: string, label: string, res9: string) =>
    db
      .prepare(
        `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, h3_res9, h3_res7)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, eventId, `qr-${id}`, label, res9, CELL7);
  const p1 = `${eventId}-p1`;
  const p2 = `${eventId}-p2`;
  stmts.push(poster(p1, 'Front window', CELL9_A), poster(p2, 'Side door', CELL9_B));
  const scans = (pid: string, hour: number, n: number) => {
    for (let i = 0; i < n; i++) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(`${pid}-s-${hour}-${i}`, eventId, pid, `2026-05-07T${hour}:00`, STAMP)
      );
    }
  };
  scans(p1, 19, 7);
  scans(p1, 21, 3);
  scans(p1, 20, w.posterHour);
  scans(p2, 19, w.posterOnly);

  // Scans per map cell, per hour.
  const cell = (res9: string, hour: number, n: number) =>
    db
      .prepare(
        `INSERT INTO scan_cell_aggregates
           (id, event_id, bucket_date, bucket_hour, h3_res9, h3_res7, scan_count, computed_at)
         VALUES (?, ?, '2026-05-07', ?, ?, ?, ?, ?)`
      )
      .bind(`${eventId}-c-${res9}-${hour}`, eventId, hour, res9, CELL7, n, STAMP);
  stmts.push(cell(CELL9_A, 19, 9), cell(CELL9_A, 21, 3));
  if (w.cellHour > 0) stmts.push(cell(CELL9_A, 20, w.cellHour));
  if (w.cellOnly > 0) stmts.push(cell(CELL9_B, 19, w.cellOnly));

  // Short links. The rows exist whether or not anyone clicked. A constant
  // sub-K kind (3) rides along, as with the hour buckets.
  const link = (kind: string, clicks: number) =>
    db
      .prepare(
        `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(`${eventId}-${kind}`, eventId, kind, clicks, STAMP);
  stmts.push(link('public', w.clicksPublic), link('donate', w.clicksDonate), link('signup', 3));

  await db.batch(stmts);

  // Sponsors: A and B share a campaign; C and D have none. One per class.
  await seedSplitSponsor(db, {
    id: sp('A'),
    eventId,
    name: 'Alpha Hardware',
    tier: 'gold',
    campaignId: camp,
  });
  await seedSplitSponsor(db, {
    id: sp('B'),
    eventId,
    name: 'Bravo Bakery',
    tier: 'primary',
    isLocal: 1,
    campaignId: camp,
  });
  await seedSplitSponsor(db, { id: sp('C'), eventId, name: 'Charlie Cycles', tier: 'silver' });
  await seedSplitSponsor(db, { id: sp('D'), eventId, name: 'Delta Diner', tier: 'silver' });
  const imps: D1PreparedStatement[] = [];
  const impressions = (sponsor: string, surface: string, n: number) => {
    for (let i = 0; i < n; i++) {
      imps.push(
        db
          .prepare(
            `INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at)
             VALUES (?, ?, ?, ?, 'p1', 'impression', ?)`
          )
          .bind(`${sponsor}-${surface}-${i}`, sponsor, eventId, surface, STAMP)
      );
    }
  };
  impressions(sp('A'), 'poster', 10);
  impressions(sp('A'), 'public', 3);
  impressions(sp('A'), 'display', w.sponsorSurface);
  impressions(sp('B'), 'poster', 8);
  impressions(sp('C'), 'poster', w.sponsorOnly);
  impressions(sp('D'), 'poster', 7);
  await db.batch(imps);
}

// ─── Reading it, as every kind of caller ────────────────────────────────────

type Leaf = string | number | boolean | null;

/** Every leaf of a JSON value, by path. Arrays also report their length. */
function flatten(value: unknown, path: string, out: Map<string, Leaf>): void {
  if (Array.isArray(value)) {
    out.set(`${path}.length`, value.length);
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, `${path}.${k}`, out);
    }
  } else {
    out.set(path, (value ?? null) as Leaf);
  }
}

interface Caller {
  name: string;
  read(eventId: string): Promise<unknown>;
}

/** One request through the Worker's fetch entry: router, limiter, handler. */
async function request(url: string, init: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let minted = 0;

function signedLink(
  name: string,
  role: SignedLinkRole,
  claims: (eventId: string) => { depth?: string; sponsor_id?: string } = () => ({})
): Caller {
  return {
    name,
    async read(eventId) {
      // The read is limited to 60 a minute per link. A different lifetime per
      // read makes each link its own bucket, so the limit stays on and unhit.
      const token = await mintSignedLinkToken(
        { SHARED_REPORT_SIGNING_SECRET: SIGNING_SECRET },
        eventId,
        role,
        3600 + ++minted,
        claims(eventId)
      );
      const res = await request(`https://test.local/api/v2/events/${eventId}/shared-report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
      return ((await res.json()) as { report: unknown }).report;
    },
  };
}

async function batch(token: string, ids: string[]): Promise<Response> {
  // The batch route is limited per token (30 a minute); this harness reads far
  // more than that, so it clears its own two buckets before each call.
  const rl = env as unknown as RateLimitEnv;
  await _deleteRateLimitKey(rl, `batch:${`Bearer ${token}`.slice(-16)}`);
  await _deleteRateLimitKey(rl, 'batch-sr:unknown');
  return request('https://test.local/api/v2/events/shared-reports/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

const sponsorA = (eventId: string) => `${eventId}-spA`;

/** Every token kind the read path serves. The cross-product token is refused (below). */
const CALLERS: Caller[] = [
  signedLink('admin link', 'admin'),
  signedLink('bar owner link', 'bar_owner'),
  signedLink('sponsor link, local', 'sponsor', (e) => ({
    depth: 'local',
    sponsor_id: sponsorA(e),
  })),
  signedLink('sponsor link, mid', 'sponsor', (e) => ({ depth: 'mid', sponsor_id: sponsorA(e) })),
  signedLink('sponsor link, premium asked', 'sponsor', (e) => ({
    depth: 'premium',
    sponsor_id: sponsorA(e),
  })),
  signedLink('sponsor link, no depth', 'sponsor', (e) => ({ sponsor_id: sponsorA(e) })),
  signedLink('sponsor link, mid, no sponsor id', 'sponsor', () => ({ depth: 'mid' })),
  {
    // The batch read returns the sibling event's report too: a change at one
    // event must not show through another event's numbers either.
    name: 'internal batch',
    async read(eventId) {
      const res = await batch(INTERNAL_TOKEN, [eventId, `${eventId}-sib`]);
      if (res.status !== 200) throw new Error(`internal batch: HTTP ${res.status}`);
      return ((await res.json()) as { reports: unknown }).reports;
    },
  },
];

type Snapshot = Map<string, Map<string, Leaf>>;

/** One event id throughout, so two reads differ only in what was seeded. */
const EVENT = 'nbr-evt';

/**
 * Seed `w`, then read the report as every caller. Remembered per dataset: the
 * report is a function of what is seeded, and neighbouring pairs share a side.
 */
const published = new Map<string, Snapshot>();
async function publish(w: World): Promise<Snapshot> {
  const key = JSON.stringify(w);
  const known = published.get(key);
  if (known) return known;
  await clearWorld();
  await seedWorld(EVENT, w);
  const snap: Snapshot = new Map();
  for (const caller of CALLERS) {
    const leaves = new Map<string, Leaf>();
    flatten(await caller.read(EVENT), 'report', leaves);
    snap.set(caller.name, leaves);
  }
  published.set(key, snap);
  return snap;
}

const show = (v: Leaf | undefined): string => {
  if (v === undefined) return '(absent)';
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

/** Every published leaf that differs between two reads, as readable lines. */
function differences(a: Snapshot, b: Snapshot): string[] {
  const lines: string[] = [];
  for (const [caller, before] of a) {
    const after = b.get(caller)!;
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(path);
      const y = after.get(path);
      if (x !== y) lines.push(`${caller} | ${path}: ${show(x)} -> ${show(y)}`);
    }
  }
  return lines;
}

/** The same lines without the caller and the values: which FIELDS moved. */
const fieldsOf = (lines: string[]): string[] =>
  [...new Set(lines.map((l) => l.split(' | ')[1]!.split(':')[0]!))].sort();

async function neighbours(a: World, b: World): Promise<string[]> {
  return differences(await publish(a), await publish(b));
}

// ─── The levers ─────────────────────────────────────────────────────────────

interface Lever {
  name: string;
  /** What one unit of it is, for the test title. */
  unit: string;
  /** The world where the hidden group has `n` in it. */
  at(n: number): World;
  /** A pair on the published side of the floor: must be visible. */
  control: [World, World];
}

const set = (patch: Partial<World>): World => ({ ...BASE, ...patch });
const plain = (key: keyof World, name: string, unit: string): Lever => ({
  name,
  unit,
  at: (n) => set({ [key]: n }),
  control: [set({ [key]: 11 }), set({ [key]: 12 })],
});

const LEVERS: Lever[] = [
  plain('hourPeople', 'people in one hour of the event', 'one person'),
  plain('siblingHourPeople', 'people in one hour of another event in the series', 'one person'),
  {
    name: 'people seen at the event',
    unit: 'one person',
    at: (n) => set({ attendees: n, cameTwice: 0, seenElsewhere: 0 }),
    control: [
      set({ attendees: 20, cameTwice: 10, seenElsewhere: 10 }),
      set({ attendees: 21, cameTwice: 10, seenElsewhere: 10 }),
    ],
  },
  plain('cameTwice', 'people who came more than once', 'one returning visitor'),
  {
    name: 'people who came only once',
    unit: 'one returning visitor',
    at: (n) => set({ cameTwice: BASE.attendees - n }),
    control: [set({ cameTwice: 10 }), set({ cameTwice: 9 })],
  },
  plain('seenElsewhere', 'people also seen elsewhere in the corridor', 'one returning visitor'),
  {
    name: 'people seen nowhere else in the corridor',
    unit: 'one returning visitor',
    at: (n) => set({ seenElsewhere: BASE.attendees - n }),
    control: [set({ seenElsewhere: 10 }), set({ seenElsewhere: 9 })],
  },
  plain('sponsorSurface', "a sponsor's impressions on one surface", 'one impression'),
  plain('sponsorOnly', "a sponsor's only impressions", 'one impression'),
  plain('posterHour', 'scans at a poster in one hour', 'one scan'),
  plain('posterOnly', "a poster's only scans", 'one scan'),
  plain('cellHour', 'scans in a map cell in one hour', 'one scan'),
  plain('cellOnly', "a map cell's only scans", 'one scan'),
  plain('clicksDonate', 'click-outs to one destination', 'one click-out'),
  {
    name: 'click-outs to one destination, when no destination clears the floor',
    unit: 'one click-out',
    at: (n) => set({ clicksPublic: 3, clicksDonate: n }),
    control: [
      set({ clicksPublic: 3, clicksDonate: 11 }),
      set({ clicksPublic: 3, clicksDonate: 12 }),
    ],
  },
];

/** The corridor baseline has its own, higher floor (10). */
const BASELINE_LEVERS: Lever[] = [
  plain('baseline30', 'corridor baseline, 30 days', 'one person'),
  plain('baseline90', 'corridor baseline, 90 days', 'one person'),
];

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
});

describe('the harness can see: a full report, and each lever above the floor', () => {
  test('the floors under test are K = 5 and 10', () => {
    expect(K).toBe(5);
    expect(CORRIDOR_BASELINE_MIN_SAMPLE).toBe(10);
  });

  test('the base dataset publishes every section to an admin link', async () => {
    const snap = await publish(BASE);
    const admin = snap.get('admin link')!;
    const numeric = [...admin].filter(([, v]) => typeof v === 'number').map(([p]) => p);
    // Every top-level section of the report has at least one number in it.
    for (const section of [
      'distinct_scanners',
      'click_outs',
      'return_rate',
      'corridor_density',
      'sponsor_displays',
      'campaign_summary',
      'sponsor_class_breakdown',
      'poster_attribution',
      'headcount_trend',
      'corridor_map',
    ]) {
      expect(
        numeric.some((p) => p.startsWith(`report.${section}`)),
        `no published number under ${section}: the base dataset does not exercise it`
      ).toBe(true);
    }
    // And nothing in it is withheld, so a later null is the floor, not the seed.
    // (A sponsor with no campaign has a null campaign id and title: labels.)
    const withheld = [...admin]
      .filter(([p, v]) => v === null && !/\.campaign_(id|title)$/.test(p))
      .map(([p]) => p);
    expect(withheld).toEqual([
      'report.click_outs.by_kind.signup', // the constant sub-K kind
    ]);
  });

  test('the cross-product service token is refused, so it is not a reader', async () => {
    await publish(BASE);
    const res = await batch(WKRP_TOKEN, [EVENT]);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toMatch(/"reports"/);
  });

  for (const lever of [...LEVERS, ...BASELINE_LEVERS]) {
    test(`control: ${lever.unit} more in "${lever.name}", above the floor, is visible`, async () => {
      const diffs = await neighbours(lever.control[0], lever.control[1]);
      expect(diffs.length, `the lever "${lever.name}" does not reach the report`).toBeGreaterThan(
        0
      );
    });
  }
});

/**
 * The list is empty (OSE-1649). The three kinds it held are closed in
 * `shared-report-builder.ts`, and each pair below now asserts that nothing
 * published moves:
 *
 * - ACROSS TWO REPORTS: with two events in a corridor, "seen at both" is one
 *   number each report divides by its own sample size, so the sibling's rate
 *   gave back this event's withheld group. A corridor's rates are now
 *   published together or not at all.
 * - NONE AGAINST SOME, by a note: the return-rate, head-count and map notes
 *   appeared only when something was under the floor. They are now given at
 *   0 as at 1 to 4.
 * - NONE AGAINST SOME, by rule: 100% was published and "all but one" was not.
 *   The report's rates never publish 100% now (the returns export keeps the
 *   shared nested rule: weekly snapshots rounded down to multiples of 5).
 *
 * A new leak goes here with the exact fields that move, and fails when it
 * stops reproducing, so the list can only shrink.
 */
const OPEN: Record<string, string[]> = {};

const titleOf = (lever: Lever, n: number): string => `${lever.name}: ${n} -> ${n + 1}`;

function pair(lever: Lever, n: number): void {
  test(`${titleOf(lever, n)} (${lever.unit})`, async () => {
    const diffs = await neighbours(lever.at(n), lever.at(n + 1));
    expect(fieldsOf(diffs), `published fields that moved:\n${diffs.join('\n')}`).toEqual(
      OPEN[titleOf(lever, n)] ?? []
    );
  });
}

/** Every pair this file runs: [lever, n] for n -> n+1, both under the lever's floor. */
const PAIRS: Array<[Lever, number]> = [
  ...LEVERS.flatMap((l) => Array.from({ length: K - 1 }, (_, n) => [l, n] as [Lever, number])),
  ...BASELINE_LEVERS.flatMap((l) =>
    Array.from({ length: CORRIDOR_BASELINE_MIN_SAMPLE - 1 }, (_, n) => [l, n] as [Lever, number])
  ),
];

describe('a group under the floor is invisible: one more in it changes nothing published', () => {
  for (const [lever, n] of PAIRS) if (n > 0) pair(lever, n);
});

// The floor's own definition is that 0 to K-1 read the same (`applyCountFloor`:
// "count < floor is suppressed (0..K-1)"), so none against one is a pair too.
describe('none against one: the zero boundary', () => {
  for (const [lever, n] of PAIRS) if (n === 0) pair(lever, n);
});

describe('the open list', () => {
  test('names only pairs this file runs', () => {
    const run = new Set(PAIRS.map(([lever, n]) => titleOf(lever, n)));
    expect(Object.keys(OPEN).filter((k) => !run.has(k))).toEqual([]);
  });
});

// ─── The field registry ─────────────────────────────────────────────────────

/**
 * Every number the SharedReport publishes, and how it is kept from being a
 * small group. The list of FIELDS is not kept by hand: it is whatever numbers
 * the reads above actually returned, over every dataset and every caller. A
 * number that appears in a response and is not listed here fails, so a new
 * field cannot ship without someone saying how it is floored; an entry that no
 * response carries fails too. Each entry's rule is then checked against every
 * value seen, including the datasets built to sit under the floor.
 *
 * Paths are relative to one report; `[]` is any row, `*` any key of a map.
 */
type How =
  /** One count. Withheld (null, or its row dropped) under `floor`. */
  | { how: 'floored'; floor: number }
  /** A sum of counts that each passed `floor` first. `orZero`: nothing passed. */
  | { how: 'sum of floored parts'; floor: number; orZero?: true }
  /** A percentage of the count at `of`, through `flooredRatePct`. */
  | { how: 'rate'; of: string }
  /** One published count divided by another. Null unless both are published. */
  | { how: 'ratio'; num: string; den: string }
  /** Things the organizer set up (sponsors, map cells), or rows shown: not people. */
  | { how: 'not people' }
  /** A lookup key (day of week, hour), not a count of anything. */
  | { how: 'key'; min: number; max: number };

const FLOORED: How = { how: 'floored', floor: K };
const SUM: How = { how: 'sum of floored parts', floor: K };
const NOT_PEOPLE: How = { how: 'not people' };

const REGISTRY: Record<string, How> = {
  distinct_scanners: SUM, // people per hour bucket, each bucket floored
  'click_outs.by_kind.*': FLOORED,
  'click_outs.total': SUM, // the published kinds
  'return_rate.sample_size': FLOORED,
  'return_rate.venue_pct': { how: 'rate', of: 'return_rate.sample_size' },
  'return_rate.corridor_pct': { how: 'rate', of: 'return_rate.sample_size' },
  'corridor_density.this_event_count': FLOORED,
  'corridor_density.baseline_30d': { how: 'floored', floor: CORRIDOR_BASELINE_MIN_SAMPLE },
  'corridor_density.baseline_90d': { how: 'floored', floor: CORRIDOR_BASELINE_MIN_SAMPLE },
  'corridor_density.density_ratio_30d': {
    how: 'ratio',
    num: 'corridor_density.this_event_count',
    den: 'corridor_density.baseline_30d',
  },
  'corridor_density.density_ratio_90d': {
    how: 'ratio',
    num: 'corridor_density.this_event_count',
    den: 'corridor_density.baseline_90d',
  },
  'corridor_density.bucket_dow': { how: 'key', min: 0, max: 6 },
  'corridor_density.bucket_hour': { how: 'key', min: 0, max: 23 },
  'sponsor_displays[].count': FLOORED, // a row under the floor is dropped
  'campaign_summary[].total_displays': SUM,
  'campaign_summary[].displays_by_surface.*': SUM,
  'campaign_summary[].sponsor_count': NOT_PEOPLE,
  'sponsor_class_breakdown.*.total_displays': { ...SUM, orZero: true },
  'sponsor_class_breakdown.*.sponsor_count': NOT_PEOPLE,
  'poster_attribution[].scan_count': SUM, // poster-hours, each hour floored
  'headcount_trend.instances[].distinct_scanners': SUM,
  'corridor_map.cell_count': NOT_PEOPLE, // cells drawn; a cell under the floor is not drawn
  // Row counts. Rows are dropped, never shown withheld, so these count what is shown.
  'sponsor_displays.length': NOT_PEOPLE,
  'campaign_summary.length': NOT_PEOPLE,
  'poster_attribution.length': NOT_PEOPLE,
  'headcount_trend.instances.length': NOT_PEOPLE,
  'corridor_map.suppressed.length': NOT_PEOPLE,
  '_meta.suppression_reasons.length': NOT_PEOPLE,
  'upgrade.locked_sections.length': NOT_PEOPLE,
};

const patternOf = (key: string): RegExp =>
  new RegExp(
    `^${key
      // Every regex character is escaped first, backslash included. The two
      // wildcards (`[]` any index, `*` any one name) are then read back out of
      // their escaped form.
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\[\\\]/g, '\\[\\d+\\]')
      .replace(/\\\*/g, '[^.\\[]+')}$`
  );
const PATTERNS = Object.keys(REGISTRY).map((key) => ({ key, re: patternOf(key) }));

/** The registry entries a field matches (it must be exactly one). Remembered per field. */
const matched = new Map<string, string[]>();
function entriesFor(rel: string): string[] {
  const field = rel.replace(/\[\d+\]/g, '[0]');
  let keys = matched.get(field);
  if (!keys) {
    keys = PATTERNS.filter((p) => p.re.test(field)).map((p) => p.key);
    matched.set(field, keys);
  }
  return keys;
}

/** `report.x` (a signed link) or `report.<event id>.x` (the batch) -> [root, x]. */
function splitRoot(path: string): [string, string] {
  const m = path.match(new RegExp(`^(report(?:\\.${EVENT}(?:-sib)?(?=\\.))?)\\.(.*)$`));
  if (!m) throw new Error(`unexpected path ${path}`);
  return [m[1]!, m[2]!];
}

/** Why `value` breaks its entry's rule, or null. `at` reads a sibling field of the same report. */
function broken(rule: How, value: number, at: (rel: string) => Leaf | undefined): string | null {
  const whole = Number.isInteger(value) && value >= 0;
  switch (rule.how) {
    case 'floored':
      return whole && value >= rule.floor ? null : `under the floor of ${rule.floor}`;
    case 'sum of floored parts':
      if (rule.orZero && value === 0) return null;
      return whole && value >= rule.floor ? null : `under the floor of ${rule.floor}`;
    case 'rate': {
      const sample = at(rule.of);
      if (typeof sample !== 'number') return `published without its sample (${rule.of})`;
      const counted = Math.round((value * sample) / 100);
      if (Math.abs((counted / sample) * 100 - value) > 1e-9) return 'not a share of its sample';
      if (counted < K) return `counts ${counted} people`;
      const rest = sample - counted;
      return rest === 0 || rest >= K ? null : `leaves ${rest} people`;
    }
    case 'ratio': {
      const num = at(rule.num);
      const den = at(rule.den);
      if (typeof num !== 'number' || typeof den !== 'number') {
        return 'published while one of its two counts is withheld';
      }
      return Math.abs(num / den - value) < 1e-9 ? null : 'not the ratio of its two counts';
    }
    case 'not people':
      return whole ? null : 'not a whole number';
    case 'key':
      return whole && value >= rule.min && value <= rule.max ? null : 'out of range';
  }
}

/**
 * After the pairs above, every dataset is already read and these two tests are
 * instant. Run on their own (`-t`), each builds all of them first.
 */
const ALL_DATASETS_MS = 240_000;

describe('every number in the report is registered, and keeps its rule in every dataset', () => {
  /** Every dataset this file builds: both sides of each pair, and each control. */
  async function everySnapshot(): Promise<Snapshot[]> {
    const worlds: World[] = [BASE];
    for (const [lever, n] of PAIRS) worlds.push(lever.at(n), lever.at(n + 1));
    for (const lever of [...LEVERS, ...BASELINE_LEVERS]) worlds.push(...lever.control);
    const snaps: Snapshot[] = [];
    for (const w of worlds) snaps.push(await publish(w));
    return snaps;
  }

  test(
    'no unregistered number, no entry without a number, no value off its rule',
    async () => {
      const unregistered = new Set<string>();
      const seen = new Set<string>();
      const offRule = new Set<string>();
      let checked = 0;

      for (const snap of await everySnapshot()) {
        for (const [caller, leaves] of snap) {
          for (const [path, value] of leaves) {
            if (typeof value !== 'number') continue;
            const [root, rel] = splitRoot(path);
            const hits = entriesFor(rel);
            if (hits.length !== 1) {
              unregistered.add(`${rel.replace(/\[\d+\]/g, '[]')} (${hits.length} entries match)`);
              continue;
            }
            const key = hits[0]!;
            seen.add(key);
            checked++;
            const why = broken(REGISTRY[key]!, value, (sibling) =>
              leaves.get(`${root}.${sibling}`)
            );
            if (why) offRule.add(`${key} = ${value}: ${why} [${caller}]`);
          }
        }
      }

      expect([...unregistered].sort(), 'numbers in the response with no registry entry').toEqual(
        []
      );
      expect(
        Object.keys(REGISTRY).filter((k) => !seen.has(k)),
        'registry entries no response carries'
      ).toEqual([]);
      expect([...offRule].sort(), 'published values that break their rule').toEqual([]);
      // Thousands of values, not a handful: the check is over every dataset.
      expect(checked).toBeGreaterThan(5000);
    },
    ALL_DATASETS_MS
  );

  test(
    'the map drawing carries no count under the floor either',
    async () => {
      // The corridor map is a string, so the walk above does not see inside it.
      const counts: number[] = [];
      for (const snap of await everySnapshot()) {
        for (const leaves of snap.values()) {
          for (const [path, value] of leaves) {
            if (typeof value !== 'string' || !path.endsWith('corridor_map.svg')) continue;
            for (const m of value.matchAll(/data-count="(\d+)"/g)) counts.push(Number(m[1]));
          }
        }
      }
      expect(counts.length, 'no drawn cell carried a count: the check saw nothing').toBeGreaterThan(
        0
      );
      expect([...new Set(counts.filter((c) => c < K))]).toEqual([]);
    },
    ALL_DATASETS_MS
  );
});
