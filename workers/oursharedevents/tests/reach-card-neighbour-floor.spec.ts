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
 * The organizer is served two reads:
 *   card  GET /api/v2/admin/events/:id/pre-event-activity  (admin.html, the
 *         "Before the event" card: `activity.clicks` is the Link taps tile and
 *         the lede, `reach.taps` the per-code line)
 *   live  GET /api/v2/admin/events/:id/dashboard  (the Live page's Link taps
 *         tile reads `reach.clicks`)
 *
 * Every leaf of both responses is compared, not a list of fields someone
 * remembered. Two things keep it honest: the same one-tap change made ABOVE the
 * floor must be visible on both reads (a lever that changes nothing proves
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

/** The event keeps its id and its links' codes; only the tap counters change. */
async function seedWorld(w: World): Promise<void> {
  const db = tenv().DB;
  await db.prepare('DELETE FROM shortlinks WHERE event_id = ?').bind(EVENT).run();
  for (const kind of KINDS) {
    const taps = w[kind];
    if (taps === null) continue;
    await db
      .prepare(
        `INSERT INTO shortlinks (code, event_id, created_at, clicks, kind)
         VALUES (?, ?, '2026-05-08 03:00:00', ?, ?)`
      )
      .bind(`rn${kind}`, EVENT, taps, kind === 'legacy' ? null : kind)
      .run();
  }
}

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
async function card(w: World): Promise<CardBody> {
  await publish(w);
  return bodies.get(`card|${JSON.stringify(w)}`) as unknown as CardBody;
}
async function live(w: World): Promise<LiveBody> {
  await publish(w);
  return bodies.get(`live|${JSON.stringify(w)}`) as unknown as LiveBody;
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

  test('a dataset above the floor publishes its tap numbers on both reads', async () => {
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
  });

  test('the same dataset read twice differs in nothing', async () => {
    const w = world(20, 11, 2, 1);
    const first = await publish(w);
    published.delete(JSON.stringify(w));
    expect(differences(first, await publish(w))).toEqual([]);
  });

  test.each(BASES.flatMap((b) => KINDS.filter((k) => b.w[k] !== null).map((k) => ({ ...b, k }))))(
    'control: one more tap on $k, above the floor, shows on both reads ($label)',
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
  test('the reported case: 10 listed, two codes withheld, total 10 on the card and on Live', async () => {
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
    // One tap short of the floor between them: nothing published.
    const short = world(3, null, null, null, 1);
    const none = { count: null, suppressed: true, floor: 5 };
    expect((await card(short)).reach.taps.total).toEqual(none);
    expect((await card(short)).activity.clicks).toEqual(none);
    expect((await live(short)).reach.clicks).toEqual(none);
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

  test('in every dataset read in this file: total = listed codes + the "other" figure, and all four totals agree', async () => {
    // Last in the file, so `bodies` holds every dataset the tests above read
    // (the starting points are read here too, in case it is run on its own).
    for (const b of BASES) await publish(b.w);
    const keys = [...bodies.keys()].filter((k) => k.startsWith('card|'));
    expect(keys.length).toBeGreaterThanOrEqual(BASES.length);
    for (const key of keys) {
      const c = bodies.get(key) as unknown as CardBody;
      const l = bodies.get(key.replace('card|', 'live|')) as unknown as LiveBody;
      const t = c.reach.taps;
      const listed = t.codes.reduce((sum, x) => sum + (x.taps.count ?? 0), 0);
      const beside = listed + (t.other?.taps.count ?? 0);
      expect(t.total.count ?? 0, key).toBe(beside);
      expect(c.reach.totals.taps, key).toEqual(t.total);
      expect(c.activity.clicks, key).toEqual(t.total);
      expect(l.reach.clicks, key).toEqual(t.total);
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

// ─── Still open ─────────────────────────────────────────────────────────────
//
// Two other reads publish the same taps as a raw sum that is floored
// afterwards. Neither is the organizer's card and neither is changed with it.
// They are pinned here, with their numbers, so the list can only shrink: when
// one is closed its test fails. Delete it then, and add the read to READS.
//
//   operations  GET /api/v2/admin/dashboards/operations: `reach.link_taps`
//               floors each EVENT's raw tap sum, then adds the events up. For
//               a brand with one event that is the event's raw sum.
//   sponsor     the sponsor's home page line "So far: N link taps"
//               (floorPreEventActivity). A sponsor is shown no per-code counts,
//               but an organizer can open the sponsor's page.

describe('still open: two other reads floor the raw tap sum', () => {
  const before = world(10, null, 2, 1);
  const after = world(10, null, 2, 2);

  test('operations dashboard, reach.link_taps: 13, then 14 after one tap on a withheld code', async () => {
    const at = async (w: World): Promise<number | null> => {
      await seedWorld(w);
      const body = (await read(`/api/v2/admin/dashboards/operations?brand_id=${BRAND}`)) as {
        reach: { link_taps: Floored };
      };
      return body.reach.link_taps.count;
    };
    expect([await at(before), await at(after)]).toEqual([13, 14]);
  });

  test('sponsor shape, clicks: 13, then 14 after one tap on a withheld code', async () => {
    const at = async (w: World): Promise<number | null> => {
      await seedWorld(w);
      const a = await readPreEventActivity(tenv().DB, EVENT, 'America/Chicago');
      return floorPreEventActivity(a).clicks.count;
    };
    expect([await at(before), await at(after)]).toEqual([13, 14]);
  });
});
