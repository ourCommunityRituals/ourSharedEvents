/**
 * Neighbour-dataset harness for the organizer's link-tap counts (K = 5).
 *
 * The admin "Before the event" card lists short-link taps per code and
 * withholds any code with fewer than 5. The rule this file holds it to is the
 * product's: a count under the floor is withheld, and nothing else published
 * may give it back. A total is where that usually fails (10 listed, two codes
 * withheld, total 13: the withheld codes have 3 between them), so the question
 * is asked the way a reader would ask it:
 *
 *   Seed two datasets that differ by ONE tap on a code that is under the floor
 *   in both. Read everything the organizer is served about the event's taps,
 *   through the real routes. Nothing published may differ.
 *
 * The organizer is served three reads:
 *   card  GET /api/v2/admin/events/:id/pre-event-activity  (admin.html, the
 *         "Before the event" card: `activity.clicks` is the Link taps tile and
 *         the lede, `reach.taps` the per-code line)
 *   live  GET /api/v2/admin/events/:id/dashboard  (the Live page's Link taps
 *         tile reads `reach.clicks`)
 *   ops   GET /api/v2/admin/dashboards/operations  (`reach.link_taps`: one
 *         figure for every event of the brand; no page renders it yet)
 *
 * Every leaf of every response is compared, not a list of fields someone
 * remembered. Two things keep it honest: the same one-tap change made ABOVE the
 * floor must be visible on every read (a lever that changes nothing proves
 * nothing), and the base dataset must publish tap numbers.
 *
 * Requests go to the Worker's own `fetch` entry (router, admin guard, handler,
 * D1), as tests/shared-report-neighbour-floor.spec.ts does.
 *
 * Seen red on main at 424fa274 (before `floorTaps` and the organizer's tap
 * total used `floorTotalOfParts`): 29 of the 63 tests fail. Every hidden pair
 * moved a published number, except in the dataset with one code only (its
 * total IS that code, and was already floored). The reported case, taps
 * 10 / 2 / 1 against 10 / 2 / 2:
 *   card | activity.clicks.count: 13 -> 14
 *   card | reach.taps.total.count: 13 -> 14
 *   card | reach.totals.taps.count: 13 -> 14
 *   live | reach.clicks.count: 13 -> 14
 * The "other links" figure moved too: 20 / 11 / 3 against 20 / 11 / 4 gave
 * `reach.taps.other.taps.count: 14 -> 15`, and four small codes (4 / 4 / 2 / 4
 * against 4 / 4 / 3 / 4) were published as 14, then 15, with no code listed.
 * The other 34 tests are green on main too: the controls (a tap above the
 * floor shows), the one-code dataset, the grouping check, the check that the
 * per-code parts are not sent, and the two reads pinned as still open at the
 * end of the file.
 *
 * One of those two, the operations dashboard, has since been closed and is
 * the third read above. Its own red run is described at its block, near the
 * end of the file.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';
import { floorPreEventActivity, readPreEventActivity } from '../src/lib/pre-event-activity';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const K = CORRIDOR_MAP_MIN_COUNT;
const BRAND = 'ose-reach-nbr';
const EVENT = 'reach-nbr-evt';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

// ─── The dataset ────────────────────────────────────────────────────────────

/**
 * The codes on the poster. One short link each; `null` = that code is not on
 * it. `legacy` is a second link to the event page, stored with no kind (as
 * links were before kinds existed): it counts with `public`, as one code.
 */
const KINDS = ['public', 'donation', 'register', 'checkin', 'legacy'] as const;
type Kind = (typeof KINDS)[number];
type World = Record<Kind, number | null>;

const world = (
  pub: number | null,
  donation: number | null,
  register: number | null,
  checkin: number | null,
  legacy: number | null = null
): World => ({ public: pub, donation, register, checkin, legacy });

const name = (w: World): string =>
  KINDS.filter((k) => w[k] !== null)
    .map((k) => `${k} ${w[k]}`)
    .join(', ');

/** Taps on the code that link `k` belongs to (the two event links are one code). */
const codeTaps = (w: World, k: Kind): number =>
  k === 'public' || k === 'legacy' ? (w.public ?? 0) + (w.legacy ?? 0) : (w[k] ?? 0);

/**
 * Starting points. Each is a different shape of card: codes listed beside
 * withheld ones, a lone withheld code, nothing listed at all.
 */
const BASES: { label: string; w: World }[] = [
  { label: 'the reported case: one code listed, two withheld', w: world(10, null, 2, 1) },
  { label: 'two codes listed, two withheld', w: world(20, 11, 2, 1) },
  { label: 'one code listed, one withheld', w: world(20, null, 3, null) },
  { label: 'two codes listed, one withheld', w: world(20, 11, 3, null) },
  { label: 'three codes listed, one withheld', w: world(20, 11, 7, 3) },
  { label: 'no code listed, few taps in all', w: world(3, null, 1, null) },
  { label: 'no code listed, many taps in all', w: world(4, 4, 3, 4) },
  { label: 'one code only', w: world(3, null, null, null) },
  { label: 'two links that are one code, one other code listed', w: world(1, 11, null, null, 1) },
];

async function applyMigrations(): Promise<void> {
  const runAll = async (db: D1Database, json: string) => {
    for (const stmt of JSON.parse(json) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes('duplicate column name') ||
          msg.includes('already exists') ||
          msg.includes('no such column')
        )
          continue;
        throw e;
      }
    }
  };
  await runAll(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await runAll(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
}

/** One event's short links, replaced: `prefix` keeps each event's codes its own. */
async function seedLinks(eventId: string, prefix: string, w: World | undefined): Promise<void> {
  const db = tenv().DB;
  await db.prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(eventId).run();
  if (!w) return;
  for (const kind of KINDS) {
    const taps = w[kind];
    if (taps === null) continue;
    await db
      .prepare(
        `INSERT INTO shortlinks (code, event_id, created_at, clicks, kind)
         VALUES (?, ?, '2026-05-08 03:00:00', ?, ?)`
      )
      .bind(`${prefix}${kind}`, eventId, taps, kind === 'legacy' ? null : kind)
      .run();
  }
}

/** The event keeps its id and its links' codes; only the tap counters change. */
const seedWorld = (w: World): Promise<void> => seedLinks(EVENT, 'rn', w);

// ─── Reading it, as the organizer ───────────────────────────────────────────

type Leaf = string | number | boolean | null;
type Snapshot = Map<string, Map<string, Leaf>>;

/** Every leaf of a JSON value, by path. Arrays also report their length. */
function flatten(value: unknown, path: string, out: Map<string, Leaf>): void {
  if (Array.isArray(value)) {
    out.set(`${path}.length`, value.length);
    value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, path ? `${path}.${k}` : k, out);
    }
  } else {
    out.set(path, (value ?? null) as Leaf);
  }
}

/**
 * Leaves that follow the clock, not the data: the time the dashboard was
 * built, and the calendar day each of the 14 scan bars stands for. Two reads
 * either side of midnight differ in these whatever was seeded. Their counts
 * (`scansByDay[i].count`) are compared like everything else.
 */
const followsTheClock = (path: string): boolean =>
  path === 'generated_at' || path === 'event.days_to_go' || path.endsWith('].day');

const READS: { name: string; path: string }[] = [
  { name: 'card', path: `/api/v2/admin/events/${EVENT}/pre-event-activity` },
  { name: 'live', path: `/api/v2/admin/events/${EVENT}/dashboard` },
  // The brand holds this one event, so its figure here is the event's.
  { name: 'ops', path: `/api/v2/admin/dashboards/operations?brand_id=${BRAND}` },
];

/** One request through the Worker's fetch entry: router, admin guard, handler. */
async function read(path: string): Promise<unknown> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://test.local${path}`, { headers: ADMIN }),
    env as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const bodies = new Map<string, Record<string, unknown>>();
const published = new Map<string, Snapshot>();

/** Seed `w`, then read it as the organizer. Remembered per dataset. */
async function publish(w: World): Promise<Snapshot> {
  const key = JSON.stringify(w);
  const known = published.get(key);
  if (known) return known;
  await seedWorld(w);
  const snap: Snapshot = new Map();
  for (const r of READS) {
    const body = await read(r.path);
    bodies.set(`${r.name}|${key}`, body as Record<string, unknown>);
    const leaves = new Map<string, Leaf>();
    flatten(body, '', leaves);
    for (const path of [...leaves.keys()]) if (followsTheClock(path)) leaves.delete(path);
    snap.set(r.name, leaves);
  }
  published.set(key, snap);
  return snap;
}

const show = (v: Leaf | undefined): string => (v === undefined ? '(absent)' : JSON.stringify(v));

/** Every published leaf that differs between two reads, as readable lines. */
function differences(a: Snapshot, b: Snapshot): string[] {
  const lines: string[] = [];
  for (const [reader, before] of a) {
    const after = b.get(reader)!;
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(path);
      const y = after.get(path);
      if (x !== y) lines.push(`${reader} | ${path}: ${show(x)} -> ${show(y)}`);
    }
  }
  return lines;
}

async function neighbours(a: World, b: World): Promise<string[]> {
  return differences(await publish(a), await publish(b));
}

// ─── What the card says about taps, read out of a response ──────────────────

interface Floored {
  count: number | null;
  suppressed: boolean;
  floor: number;
}
interface CardBody {
  activity: { clicks: Floored } & Record<string, unknown>;
  reach: {
    taps: {
      codes: { kind: string; word: string; taps: Floored }[];
      other: { codes: number; taps: Floored } | null;
      total: Floored;
    };
    totals: { scans: number; taps: Floored };
  };
}
interface LiveBody {
  reach: { clicks: Floored } & Record<string, unknown>;
}
interface OpsBody {
  reach: { link_taps: Floored } & Record<string, unknown>;
}
async function card(w: World): Promise<CardBody> {
  await publish(w);
  return bodies.get(`card|${JSON.stringify(w)}`) as unknown as CardBody;
}
async function live(w: World): Promise<LiveBody> {
  await publish(w);
  return bodies.get(`live|${JSON.stringify(w)}`) as unknown as LiveBody;
}
async function ops(w: World): Promise<OpsBody> {
  await publish(w);
  return bodies.get(`ops|${JSON.stringify(w)}`) as unknown as OpsBody;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
  const db = tenv().DB;
  await db.prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(EVENT).run();
  await db.prepare('DELETE FROM events WHERE id = ?').bind(EVENT).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, timezone, location)
       VALUES (?, ?, 'Reach neighbours', 'reach-nbr', 'active', '2099-06-01', 'America/Chicago', 'Eagles Hall')`
    )
    .bind(EVENT, BRAND)
    .run();
});

describe('the harness can see', () => {
  test('the floor under test is K = 5', () => {
    expect(K).toBe(5);
  });

  test('a dataset above the floor publishes its tap numbers on every read', async () => {
    const w = world(20, 11, 7, 6);
    const c = await card(w);
    expect(c.reach.taps.codes.map((x) => [x.kind, x.taps.count])).toEqual([
      ['public', 20],
      ['donation', 11],
      ['register', 7],
      ['checkin', 6],
    ]);
    expect(c.reach.taps.other).toBeNull();
    expect(c.reach.taps.total.count).toBe(44);
    expect(c.reach.totals.taps.count).toBe(44);
    expect(c.activity.clicks.count).toBe(44);
    expect((await live(w)).reach.clicks.count).toBe(44);
    expect((await ops(w)).reach.link_taps.count).toBe(44);
  });

  test('the same dataset read twice differs in nothing', async () => {
    const w = world(20, 11, 2, 1);
    const first = await publish(w);
    published.delete(JSON.stringify(w));
    expect(differences(first, await publish(w))).toEqual([]);
  });

  test.each(BASES.flatMap((b) => KINDS.filter((k) => b.w[k] !== null).map((k) => ({ ...b, k }))))(
    'control: one more tap on $k, above the floor, shows on every read ($label)',
    async ({ w, k }) => {
      const lines = await neighbours({ ...w, [k]: 11 }, { ...w, [k]: 12 });
      for (const r of READS) {
        expect(
          lines.some((l) => l.startsWith(`${r.name} | `)),
          `${r.name} did not move for a tap above the floor: ${JSON.stringify(lines)}`
        ).toBe(true);
      }
    }
  );
});

describe('one more tap on a withheld code changes nothing the organizer is served', () => {
  test('the reported case: taps 10, 2, 1 and taps 10, 2, 2 read the same', async () => {
    expect(await neighbours(world(10, null, 2, 1), world(10, null, 2, 2))).toEqual([]);
  });

  test.each(BASES.flatMap((b) => KINDS.filter((k) => b.w[k] !== null).map((k) => ({ ...b, k }))))(
    '$label: $k from 0 up to 4, one tap at a time',
    async ({ w, k }) => {
      const moved: string[] = [];
      let pairs = 0;
      for (let n = 0; n + 1 < K; n++) {
        const after = { ...w, [k]: n + 1 };
        // Only pairs where the CODE is withheld on both sides (two links can
        // share a code, and together they may reach the floor: that shows).
        if (codeTaps(after, k) >= K) continue;
        pairs++;
        const lines = await neighbours({ ...w, [k]: n }, after);
        for (const l of lines) moved.push(`[${name({ ...w, [k]: n })} -> ${k} ${n + 1}] ${l}`);
      }
      expect(pairs).toBeGreaterThan(0);
      expect(moved).toEqual([]);
    }
  );
});

describe('the tap total is the sum of the counts published beside it', () => {
  test('the reported case: 10 listed, two codes withheld, total 10 on the card, on Live and on the operations dashboard', async () => {
    const w = world(10, null, 2, 1);
    const c = await card(w);
    expect(c.reach.taps.codes.map((x) => [x.kind, x.taps.count])).toEqual([['public', 10]]);
    expect(c.reach.taps.other).toEqual({
      codes: 2,
      taps: { count: null, suppressed: true, floor: 5 },
    });
    const ten = { count: 10, suppressed: false, floor: 5 };
    expect(c.reach.taps.total).toEqual(ten);
    expect(c.reach.totals.taps).toEqual(ten);
    expect(c.activity.clicks).toEqual(ten);
    expect((await live(w)).reach.clicks).toEqual(ten);
    expect((await ops(w)).reach.link_taps).toEqual(ten);
  });

  test('small codes never add up to a published total: 4 + 4 + 3 + 4 is withheld', async () => {
    const w = world(4, 4, 3, 4);
    const none = { count: null, suppressed: true, floor: 5 };
    const c = await card(w);
    expect(c.reach.taps.codes).toEqual([]);
    expect(c.reach.taps.other).toEqual({ codes: 4, taps: none });
    expect(c.reach.taps.total).toEqual(none);
    expect(c.reach.totals.taps).toEqual(none);
    expect(c.activity.clicks).toEqual(none);
    expect((await live(w)).reach.clicks).toEqual(none);
    // Withheld, never 0: the operations figure has no number to show either.
    expect((await ops(w)).reach.link_taps).toEqual(none);
  });

  test('two links to the event page are one code: listed, and totalled, as their sum', async () => {
    // The list and the totals are read by different queries. If they grouped
    // links differently, a total would stop being the sum of what is listed.
    const six = { count: 6, suppressed: false, floor: 5 };
    const both = world(3, null, null, null, 3);
    const c = await card(both);
    expect(c.reach.taps.codes.map((x) => [x.kind, x.taps.count])).toEqual([['public', 6]]);
    expect(c.reach.taps.other).toBeNull();
    expect(c.reach.taps.total).toEqual(six);
    expect(c.reach.totals.taps).toEqual(six);
    expect(c.activity.clicks).toEqual(six);
    expect((await live(both)).reach.clicks).toEqual(six);
    // The operations dashboard reads the links with a query of its own. Grouped
    // any other way (by link, or by the stored kind) it would see 3 and 3.
    expect((await ops(both)).reach.link_taps).toEqual(six);
    // One tap short of the floor between them: nothing published.
    const short = world(3, null, null, null, 1);
    const none = { count: null, suppressed: true, floor: 5 };
    expect((await card(short)).reach.taps.total).toEqual(none);
    expect((await card(short)).activity.clicks).toEqual(none);
    expect((await live(short)).reach.clicks).toEqual(none);
    expect((await ops(short)).reach.link_taps).toEqual(none);
  });

  test('the per-code tap counts are sent nowhere but the floored list', async () => {
    for (const w of [world(10, null, 2, 1), world(4, 4, 3, 4), world(20, 11, 7, 6)]) {
      await publish(w);
      for (const r of READS) {
        const raw = JSON.stringify(bodies.get(`${r.name}|${JSON.stringify(w)}`));
        expect(raw, r.name).not.toContain('clicksByCode');
      }
    }
  });

  test('in every dataset read in this file: total = listed codes + the "other" figure, and all five totals agree', async () => {
    // Last in the file, so `bodies` holds every dataset the tests above read
    // (the starting points are read here too, in case it is run on its own).
    for (const b of BASES) await publish(b.w);
    const keys = [...bodies.keys()].filter((k) => k.startsWith('card|'));
    expect(keys.length).toBeGreaterThanOrEqual(BASES.length);
    for (const key of keys) {
      const c = bodies.get(key) as unknown as CardBody;
      const l = bodies.get(key.replace('card|', 'live|')) as unknown as LiveBody;
      const o = bodies.get(key.replace('card|', 'ops|')) as unknown as OpsBody;
      const t = c.reach.taps;
      const listed = t.codes.reduce((sum, x) => sum + (x.taps.count ?? 0), 0);
      const beside = listed + (t.other?.taps.count ?? 0);
      expect(t.total.count ?? 0, key).toBe(beside);
      expect(c.reach.totals.taps, key).toEqual(t.total);
      expect(c.activity.clicks, key).toEqual(t.total);
      expect(l.reach.clicks, key).toEqual(t.total);
      expect(o.reach.link_taps, key).toEqual(t.total);
      // Nothing published is a number under the floor.
      for (const f of [
        ...t.codes.map((x) => x.taps),
        ...(t.other ? [t.other.taps] : []),
        t.total,
      ]) {
        expect(f.count === null || f.count >= K, key).toBe(true);
        expect(f.suppressed, key).toBe(f.count === null);
      }
    }
  });
});

// ─── The operations dashboard: one figure for a whole brand ─────────────────
//
// `reach.link_taps` adds up every event of a brand. The organizer is shown taps
// per code on each event's own card, so the brand figure has to be a sum of
// those same published parts: within an event, the codes that clear the floor
// on their own; across events, the events that have such a code. A second
// brand with three events, so the single event above stays the only one of its
// brand.
//
// Seen red on main at ba247322, where the dashboard floored each event's raw
// tap sum and then added the events (all 7 tests of this block fail there, and
// with them 29 of the tests above, once `ops` joined READS; only `ops` lines
// moved, for instance `ops | reach.link_taps.count: 13 -> 14`):
//   10 / 2 / 1 and 8                 21, then 22 after a tap on the "1"  (now 18, 18)
//   10 and 3 + 3                     16                                  (now 10)
//   4 + 4, 3 + 4 and 2               15                                  (now withheld)
//   20 / 11 / 2 / 1, 3 + 3 one code, 4 / 4 / 3 / 4
//                                    55                                  (now 37)

const OPS_BRAND = 'ose-reach-nbr-ops';
const OPS_EVENTS = ['reach-ops-a', 'reach-ops-b', 'reach-ops-c'] as const;
type OpsEvent = (typeof OPS_EVENTS)[number];
/** The links of each event of the brand; an event left out has none. */
type BrandWorld = Partial<Record<OpsEvent, World>>;

const BRAND_READS: { name: string; path: string }[] = [
  { name: 'ops', path: `/api/v2/admin/dashboards/operations?brand_id=${OPS_BRAND}` },
  ...OPS_EVENTS.flatMap((id) => [
    { name: `card ${id}`, path: `/api/v2/admin/events/${id}/pre-event-activity` },
    { name: `live ${id}`, path: `/api/v2/admin/events/${id}/dashboard` },
  ]),
];

const brandBodies = new Map<string, Record<string, unknown>>();

/** Seed the brand's three events, then read the brand and each event. */
async function publishBrand(bw: BrandWorld): Promise<Snapshot> {
  for (const [i, id] of OPS_EVENTS.entries()) await seedLinks(id, `ro${i}`, bw[id]);
  const snap: Snapshot = new Map();
  for (const r of BRAND_READS) {
    const body = (await read(r.path)) as Record<string, unknown>;
    brandBodies.set(r.name, body);
    const leaves = new Map<string, Leaf>();
    flatten(body, '', leaves);
    for (const path of [...leaves.keys()]) if (followsTheClock(path)) leaves.delete(path);
    snap.set(r.name, leaves);
  }
  return snap;
}

/** What the brand dashboard and each event's own reads say, after `publishBrand`. */
function brandTaps(): { ops: Floored; live: Floored[]; card: Floored[] } {
  const reach = <T>(name: string): T => (brandBodies.get(name) as unknown as { reach: T }).reach;
  return {
    ops: reach<OpsBody['reach']>('ops').link_taps,
    live: OPS_EVENTS.map((id) => reach<LiveBody['reach']>(`live ${id}`).clicks),
    card: OPS_EVENTS.map((id) => reach<CardBody['reach']>(`card ${id}`).taps.total),
  };
}

describe('the operations dashboard adds up a brand: only links that clear the floor on their own', () => {
  const withheld = { count: null, suppressed: true, floor: 5 };
  const shown = (n: number) => ({ count: n, suppressed: false, floor: 5 });
  const opsLine = (lines: string[]) => lines.filter((l) => l.startsWith('ops | '));

  beforeAll(async () => {
    const db = tenv().DB;
    for (const id of OPS_EVENTS) {
      await db.prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(id).run();
      await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
      await db
        .prepare(
          `INSERT INTO events (id, brand_id, title, slug, status, start_date, timezone, location)
           VALUES (?, ?, ?, ?, 'active', '2099-06-01', 'America/Chicago', 'Eagles Hall')`
        )
        .bind(id, OPS_BRAND, `Reach ${id}`, id)
        .run();
    }
    // The other brand's event, with a link well above the floor: no figure of
    // this brand may count it (every expected number below would be 50 out).
    await seedWorld(world(50, null, null, null));
  });

  test('two events, one with two withheld links: 18, the listed links only (10 + 8)', async () => {
    await publishBrand({
      'reach-ops-a': world(10, null, 2, 1),
      'reach-ops-b': world(8, null, null, null),
    });
    const t = brandTaps();
    // Each event's own reads: 10 (2 and 1 withheld), 8, and an event with no links.
    expect(t.live).toEqual([shown(10), shown(8), withheld]);
    expect(t.card).toEqual(t.live);
    // 13 + 8 = 21 would hand back the 3 taps the first event's card withholds.
    expect(t.ops).toEqual(shown(18));
  });

  test('one more tap on a withheld link of one event moves nothing, the brand figure included', async () => {
    const b = world(8, null, null, null);
    const before = await publishBrand({ 'reach-ops-a': world(10, null, 2, 1), 'reach-ops-b': b });
    const after = await publishBrand({ 'reach-ops-a': world(10, null, 2, 2), 'reach-ops-b': b });
    expect(differences(before, after)).toEqual([]);
  });

  test('control: one more tap on a listed link of either event shows on the brand figure', async () => {
    const a = world(10, null, 2, 1);
    const b = world(8, null, null, null);
    const base = await publishBrand({ 'reach-ops-a': a, 'reach-ops-b': b });
    const moreA = await publishBrand({ 'reach-ops-a': { ...a, public: 11 }, 'reach-ops-b': b });
    expect(opsLine(differences(base, moreA))).toEqual(['ops | reach.link_taps.count: 18 -> 19']);
    const moreB = await publishBrand({ 'reach-ops-a': a, 'reach-ops-b': { ...b, public: 9 } });
    expect(opsLine(differences(base, moreB))).toEqual(['ops | reach.link_taps.count: 18 -> 19']);
  });

  test('an event with no link at 5 adds nothing, however many taps its links have together', async () => {
    const a = world(10, null, null, null);
    // 3 + 3: six taps on the event, and no number its own card can show.
    const before = await publishBrand({ 'reach-ops-a': a, 'reach-ops-b': world(null, 3, 3, null) });
    expect(brandTaps().live).toEqual([shown(10), withheld, withheld]);
    expect(brandTaps().ops).toEqual(shown(10));
    const after = await publishBrand({ 'reach-ops-a': a, 'reach-ops-b': world(null, 3, 4, null) });
    expect(differences(before, after)).toEqual([]);
  });

  test('a brand where no link has 5 taps is withheld, never 0 and never the taps added up', async () => {
    await publishBrand({
      'reach-ops-a': world(4, 4, null, null),
      'reach-ops-b': world(3, null, 4, null),
      'reach-ops-c': world(2, null, null, null),
    });
    expect(brandTaps().live).toEqual([withheld, withheld, withheld]);
    expect(brandTaps().ops).toEqual(withheld);
  });

  test('the brand figure is the sum of what each event shows on its own', async () => {
    const worlds: { bw: BrandWorld; total: number }[] = [
      {
        // 20 + 11 listed; two links that are one code of 6; nothing listed.
        bw: {
          'reach-ops-a': world(20, 11, 2, 1),
          'reach-ops-b': world(3, null, null, null, 3),
          'reach-ops-c': world(4, 4, 3, 4),
        },
        total: 37,
      },
      {
        bw: {
          'reach-ops-a': world(5, null, 4, null),
          'reach-ops-b': world(6, 7, null, null),
          'reach-ops-c': world(1, null, null, null, 3),
        },
        total: 18,
      },
      { bw: { 'reach-ops-c': world(9, 5, 5, 4) }, total: 19 },
    ];
    for (const { bw, total } of worlds) {
      await publishBrand(bw);
      const t = brandTaps();
      const sum = (xs: Floored[]) => xs.reduce((n, x) => n + (x.count ?? 0), 0);
      expect(t.card, JSON.stringify(bw)).toEqual(t.live);
      expect(sum(t.live), JSON.stringify(bw)).toBe(total);
      expect(t.ops, JSON.stringify(bw)).toEqual(shown(total));
    }
  });

  test('a withheld link on any of three events, from 0 up to 4 one tap at a time', async () => {
    const base: BrandWorld = {
      'reach-ops-a': world(10, null, 2, 1),
      'reach-ops-b': world(null, 3, null, 0),
      'reach-ops-c': world(6, 7, null, 0),
    };
    const moved: string[] = [];
    for (const id of OPS_EVENTS) {
      for (let n = 0; n + 1 < K; n++) {
        const at = (taps: number): BrandWorld => ({
          ...base,
          [id]: { ...base[id]!, checkin: taps },
        });
        for (const l of differences(await publishBrand(at(n)), await publishBrand(at(n + 1)))) {
          moved.push(`[${id} checkin ${n} -> ${n + 1}] ${l}`);
        }
      }
    }
    expect(moved).toEqual([]);
  });
});

// ─── Still open ─────────────────────────────────────────────────────────────
//
// One other read publishes the same taps as a raw sum that is floored
// afterwards. It is not the organizer's card and is not changed with it. It is
// pinned here, with its numbers, so the list can only shrink: when it is
// closed its test fails. Delete it then.
//
//   sponsor     the sponsor's home page line "So far: N link taps"
//               (floorPreEventActivity). A sponsor is shown no per-code counts,
//               but an organizer can open the sponsor's page. It changes a
//               number sponsors see, so it waits on the owner.
//
// The operations dashboard's `reach.link_taps` was the other one (13, then 14).
// It is closed: the read is in READS above, and has a block of its own.

describe('still open: one other read floors the raw tap sum', () => {
  const before = world(10, null, 2, 1);
  const after = world(10, null, 2, 2);

  test('sponsor shape, clicks: 13, then 14 after one tap on a withheld code', async () => {
    const at = async (w: World): Promise<number | null> => {
      await seedWorld(w);
      const a = await readPreEventActivity(tenv().DB, EVENT, 'America/Chicago');
      return floorPreEventActivity(a).clicks.count;
    };
    expect([await at(before), await at(after)]).toEqual([13, 14]);
  });
});
