/**
 * Neighbour-dataset harness for the corridor dashboard's scan counts (K = 5).
 *
 * GET /api/v2/admin/dashboards/corridor publishes scans twice over: per source
 * cell (`source_cells[].scans`, where the posters hang) and per flow
 * (`flows[].scans`, from a source cell to the cell of the event). A flow under
 * the floor is left out of the list. The rule this file holds the route to is
 * the product's, and the owner's ruling of 2026-10-08 is that it has no
 * exceptions, a brand's own admin and every tier included: a count under 5 is
 * withheld, and nothing else published may give it back.
 *
 * A total is where that fails (a cell reads 10, its one listed flow reads 7:
 * the flow that was left out has 3), so the question is asked the way a reader
 * would ask it:
 *
 *   Seed two datasets that differ by ONE scan on a part that is under the
 *   floor in both. Read the dashboard through the real route, as every reader
 *   who can pick a different view of it. Nothing published may differ.
 *
 * A "part" is the smallest bucket the dashboard counts scans in: one brand,
 * one data class, one source cell, and one destination (the event's cell, or
 * none when the event has no place on the map). The views are one brand or
 * both, and production data or all of it: six reads.
 *
 * Every leaf of every response is compared, not a list of fields someone
 * remembered; the order of the two lists is compared too. Two things keep it
 * honest: the same one-scan change made ABOVE the floor must be visible on
 * every read that covers it (a lever that changes nothing proves nothing), and
 * the base datasets must publish numbers.
 *
 * Requests go to the Worker's own `fetch` entry (router, admin guard, handler,
 * D1), as tests/reach-card-neighbour-floor.spec.ts does.
 *
 * Seen red at 0c6ff64b, before a cell's scans were built from its listed
 * parts: see the list at the end of this file.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { CORRIDOR_MAP_MIN_COUNT } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const K = CORRIDOR_MAP_MIN_COUNT;

// ─── The dataset ────────────────────────────────────────────────────────────

const BRANDS = { a: 'ose-cor-nbr-a', b: 'ose-cor-nbr-b' } as const;
/** A third brand in the same cells with far more scans. No read may count it. */
const BYSTANDER = 'ose-cor-nbr-x';
const BYSTANDER_SCANS = 60;

/**
 * Where posters hang. `off` holds one poster only, and it has been retired.
 * Its id sorts ahead of the other two, though its row is the last to be built.
 * `nowhere` is a poster that was never given a cell: it is in no cell's row.
 */
const SOURCE = {
  s1: '872664d00ffffff',
  s2: '872664d01ffffff',
  off: '872664c02ffffff',
  nowhere: null,
} as const;
/** Where events are held. `none`: the event has no place on the map. */
const DEST = { d1: '872664d10ffffff', d2: '872664d11ffffff', none: null } as const;

type Brand = keyof typeof BRANDS;
type DataClass = 'production' | 'demo';
type Source = keyof typeof SOURCE;
type Dest = keyof typeof DEST;

/** One part: `brand|data class|source|destination`. */
type PartKey = `${Brand}|${DataClass}|${Source}|${Dest}`;
/** Scans per part. A part left out has none. */
type World = Partial<Record<PartKey, number>>;

const DATA_CLASSES: DataClass[] = ['production', 'demo'];
const eventId = (b: Brand, dc: DataClass, d: Dest): string => `cn-${b}-${dc}-${d}`;

function split(key: PartKey): { brand: Brand; dc: DataClass; source: Source; dest: Dest } {
  const [brand, dc, source, dest] = key.split('|') as [Brand, DataClass, Source, Dest];
  return { brand, dc, source, dest };
}

/**
 * The two retired posters (one for an event with a place, one for an event
 * with none) and the poster with no cell each belong to one event; every
 * other part has a poster of its own.
 */
const OFF_PART: PartKey = 'a|production|off|d1';
const OFF_NO_PLACE_PART: PartKey = 'a|production|off|none';
const NOWHERE_PART: PartKey = 'a|production|nowhere|d1';
const ONE_OFF_POSTERS: Partial<Record<PartKey, string>> = {
  [OFF_PART]: 'cnp-off',
  [OFF_NO_PLACE_PART]: 'cnp-off-none',
  [NOWHERE_PART]: 'cnp-nowhere',
};
function posterOf(key: PartKey): { event: string; poster: string } {
  const p = split(key);
  const event = eventId(p.brand, p.dc, p.dest);
  if (p.source === 'off' || p.source === 'nowhere') {
    const poster = ONE_OFF_POSTERS[key];
    if (!poster) throw new Error(`no such poster: ${key}`);
    return { event, poster };
  }
  return { event, poster: `cnp-${event}-${p.source}` };
}

const canonical = (w: World): string =>
  JSON.stringify(
    Object.entries(w)
      .filter(([, n]) => (n ?? 0) > 0)
      .sort(([x], [y]) => (x < y ? -1 : 1))
  );

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

const SCAN_SQL = `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
                  VALUES (?, ?, ?, '2026-09-26T18:00')`;

let seeded: World = {};

/** Make the scans in D1 match `w`. Events and posters never change. */
async function seedWorld(w: World): Promise<void> {
  const db = tenv().DB;
  const stmts: D1PreparedStatement[] = [];
  const keys = new Set([...Object.keys(seeded), ...Object.keys(w)]) as Set<PartKey>;
  for (const key of keys) {
    const want = w[key] ?? 0;
    let have = seeded[key] ?? 0;
    if (want === have) continue;
    const { event, poster } = posterOf(key);
    if (want < have) {
      stmts.push(
        db.prepare('DELETE FROM scan_placement_events WHERE poster_deployment_id = ?').bind(poster)
      );
      have = 0;
    }
    for (let i = have; i < want; i++) {
      stmts.push(db.prepare(SCAN_SQL).bind(`cns-${poster}-${i}`, event, poster));
    }
  }
  if (stmts.length) await db.batch(stmts);
  seeded = { ...w };
}

// ─── Reading it, as each reader who can pick a view ─────────────────────────

const COR = '/api/v2/admin/dashboards/corridor';
const KEY_ACTOR = { Authorization: 'Bearer test-admin-key-e2e-2026' };
/** A person who is a member of both brands (and of nothing else). */
const MEMBER = 'cor-both@example.com';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function memberHeaders(): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email: MEMBER, iat: now - 10, exp: now + 3600 })}.sig`;
  return { 'Cf-Access-Jwt-Assertion': jwt };
}

interface Read {
  name: string;
  path: string;
  member?: true;
  /** Which parts this view covers. */
  brands: Brand[];
  all: boolean;
}
const READS: Read[] = [
  { name: 'a', path: `${COR}?brand_id=${BRANDS.a}`, brands: ['a'], all: false },
  { name: 'a+demo', path: `${COR}?brand_id=${BRANDS.a}&data_class=all`, brands: ['a'], all: true },
  { name: 'b', path: `${COR}?brand_id=${BRANDS.b}`, brands: ['b'], all: false },
  { name: 'b+demo', path: `${COR}?brand_id=${BRANDS.b}&data_class=all`, brands: ['b'], all: true },
  { name: 'both', path: COR, member: true, brands: ['a', 'b'], all: false },
  { name: 'both+demo', path: `${COR}?data_class=all`, member: true, brands: ['a', 'b'], all: true },
];
const covers = (r: Read, key: PartKey): boolean => {
  const p = split(key);
  return r.brands.includes(p.brand) && (r.all || p.dc === 'production');
};

/** One request through the Worker's fetch entry: router, admin guard, handler. */
async function fetchJson(path: string, headers: Record<string, string>): Promise<unknown> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://test.local${path}`, { headers }),
    env as never,
    ctx
  );
  await waitOnExecutionContext(ctx);
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

interface Floored {
  count: number | null;
  suppressed: boolean;
  floor: number;
}
interface CellRow {
  cell: string;
  posters: number;
  scans: Floored;
  scans_no_destination: Floored;
}
interface FlowRow {
  source: string;
  destination: string;
  scans: Floored;
}
interface CorridorBody {
  scope: { brands: string[]; data_class: string };
  source_cells: CellRow[];
  flows: FlowRow[];
}

type Leaf = string | number | boolean | null;
type Snapshot = Map<string, Map<string, Leaf>>;

/** Every leaf of a JSON value, by path. */
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

const cellName = (id: string): string =>
  (Object.entries(SOURCE).find(([, v]) => v === id)?.[0] ??
    Object.entries(DEST).find(([, v]) => v === id)?.[0] ??
    id) as string;

/**
 * The same response with its two scan lists keyed by what each row is about,
 * so a difference reads `source_cells.s1.scans.count: 10 -> 11` whatever rows
 * come and go. The order the rows were sent in is kept as a leaf of its own:
 * order is published too.
 */
function byName(body: CorridorBody): Record<string, unknown> {
  const flowName = (f: FlowRow) => `${cellName(f.source)}>${cellName(f.destination)}`;
  return {
    ...body,
    source_cells: Object.fromEntries(body.source_cells.map((c) => [cellName(c.cell), c])),
    source_cells_order: body.source_cells.map((c) => cellName(c.cell)).join(' '),
    flows: Object.fromEntries(body.flows.map((f) => [flowName(f), f])),
    flows_order: body.flows.map(flowName).join(' '),
  };
}

const bodies = new Map<string, CorridorBody>();
const published = new Map<string, Snapshot>();

/** Seed `w`, then read it as every reader. Remembered per dataset. */
async function publish(w: World): Promise<Snapshot> {
  const key = canonical(w);
  const known = published.get(key);
  if (known) return known;
  await seedWorld(w);
  const snap: Snapshot = new Map();
  for (const r of READS) {
    const body = (await fetchJson(r.path, r.member ? memberHeaders() : KEY_ACTOR)) as CorridorBody;
    bodies.set(`${r.name}|${key}`, body);
    const leaves = new Map<string, Leaf>();
    flatten(byName(body), '', leaves);
    // The time the response was built follows the clock, not the data.
    leaves.delete('generated_at');
    snap.set(r.name, leaves);
  }
  published.set(key, snap);
  return snap;
}

async function bodyOf(w: World, reader: string): Promise<CorridorBody> {
  await publish(w);
  return bodies.get(`${reader}|${canonical(w)}`)!;
}

interface Moved {
  reader: string;
  path: string;
  before: Leaf | undefined;
  after: Leaf | undefined;
}
const show = (v: Leaf | undefined): string => (v === undefined ? '(absent)' : JSON.stringify(v));
const line = (m: Moved): string => `${m.reader} | ${m.path}: ${show(m.before)} -> ${show(m.after)}`;

/** Every published leaf that differs between two datasets. */
function differences(a: Snapshot, b: Snapshot): Moved[] {
  const moved: Moved[] = [];
  for (const [reader, before] of a) {
    const after = b.get(reader)!;
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(path);
      const y = after.get(path);
      if (x !== y) moved.push({ reader, path, before: x, after: y });
    }
  }
  return moved;
}

async function neighbours(a: World, b: World): Promise<Moved[]> {
  return differences(await publish(a), await publish(b));
}

// ─── What a response says, read out of it ───────────────────────────────────

const withheld: Floored = { count: null, suppressed: true, floor: 5 };
const shown = (n: number): Floored => ({ count: n, suppressed: false, floor: 5 });

const cell = (b: CorridorBody, s: Source): CellRow | undefined =>
  b.source_cells.find((c) => c.cell === SOURCE[s]);
const flow = (b: CorridorBody, s: Source, d: Exclude<Dest, 'none'>): Floored | undefined =>
  b.flows.find((f) => f.source === SOURCE[s] && f.destination === DEST[d])?.scans;
const flowList = (b: CorridorBody): [string, number | null][] =>
  b.flows.map((f) => [`${cellName(f.source)}>${cellName(f.destination)}`, f.scans.count]);

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await applyMigrations();
  const db = tenv().DB;
  const stmts: D1PreparedStatement[] = [];
  const event = db.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, data_class, h3_res7)
     VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`
  );
  const poster = db.prepare(
    `INSERT INTO poster_deployments (id, event_id, qr_token, is_active, h3_res7)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const b of Object.keys(BRANDS) as Brand[]) {
    for (const dc of DATA_CLASSES) {
      for (const d of Object.keys(DEST) as Dest[]) {
        const id = eventId(b, dc, d);
        stmts.push(event.bind(id, BRANDS[b], `Corridor ${id}`, id, dc, DEST[d]));
        for (const s of ['s1', 's2'] as const) {
          stmts.push(poster.bind(`cnp-${id}-${s}`, id, `tok-cnp-${id}-${s}`, 1, SOURCE[s]));
        }
      }
    }
  }
  // The only poster the `off` cell has ever had, and it is no longer out.
  stmts.push(
    poster.bind('cnp-off', eventId('a', 'production', 'd1'), 'tok-cnp-off', 0, SOURCE.off)
  );
  // A second retired poster in that cell, for the event that has no place.
  stmts.push(
    poster.bind(
      'cnp-off-none',
      eventId('a', 'production', 'none'),
      'tok-cnp-off-none',
      0,
      SOURCE.off
    )
  );
  // A poster that is out, and was never given a cell.
  stmts.push(
    poster.bind('cnp-nowhere', eventId('a', 'production', 'd1'), 'tok-cnp-nowhere', 1, null)
  );
  // The bystander brand: same cells, 60 scans, never deleted.
  stmts.push(
    event.bind('cn-x', BYSTANDER, 'Corridor bystander', 'cn-x', 'production', DEST.d1),
    poster.bind('cnp-x', 'cn-x', 'tok-cnp-x', 1, SOURCE.s1)
  );
  for (let i = 0; i < BYSTANDER_SCANS; i++) {
    stmts.push(db.prepare(SCAN_SQL).bind(`cnx-${i}`, 'cn-x', 'cnp-x'));
  }
  const member = db.prepare(
    `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
  );
  stmts.push(member.bind(MEMBER, BRANDS.a), member.bind(MEMBER, BRANDS.b));
  await db.batch(stmts);
});

/** Six parts, each at or above the floor, across both brands and both classes. */
const BIG: World = {
  'a|production|s1|d1': 7,
  'a|production|s1|d2': 6,
  'a|production|s1|none': 8,
  'a|demo|s1|d1': 5,
  'b|production|s1|d1': 9,
  'b|production|s2|d2': 11,
};

describe('the harness can see', () => {
  test('the floor under test is K = 5', () => {
    expect(K).toBe(5);
  });

  test('the member of both brands is scoped to exactly those two', async () => {
    const both = await bodyOf(BIG, 'both');
    expect([...both.scope.brands].sort()).toEqual([BRANDS.a, BRANDS.b]);
    expect((await bodyOf(BIG, 'a')).scope).toEqual({
      brands: [BRANDS.a],
      data_class: 'production',
    });
    expect((await bodyOf(BIG, 'b+demo')).scope).toEqual({ brands: [BRANDS.b], data_class: 'all' });
  });

  test('a dataset above the floor publishes its numbers on every read', async () => {
    const a = await bodyOf(BIG, 'a');
    // 7 + 6 to the two event cells, 8 for the event with no place: 21.
    expect(cell(a, 's1')).toEqual({
      cell: SOURCE.s1,
      posters: 3,
      scans: shown(21),
      scans_no_destination: shown(8),
    });
    expect(flowList(a)).toEqual([
      ['s1>d1', 7],
      ['s1>d2', 6],
    ]);
    // Posters hang in the second cell too; it has no scans to show.
    expect(cell(a, 's2')).toEqual({
      cell: SOURCE.s2,
      posters: 3,
      scans: withheld,
      scans_no_destination: withheld,
    });

    // The demo event's 5 join only when demo data is asked for.
    const aAll = await bodyOf(BIG, 'a+demo');
    expect(cell(aAll, 's1')?.scans).toEqual(shown(26));
    expect(flow(aAll, 's1', 'd1')).toEqual(shown(12));

    const b = await bodyOf(BIG, 'b');
    expect(cell(b, 's1')?.scans).toEqual(shown(9));
    expect(cell(b, 's2')?.scans).toEqual(shown(11));
    expect(cell(b, 's1')?.scans_no_destination).toEqual(withheld);

    const both = await bodyOf(BIG, 'both');
    expect(cell(both, 's1')?.scans).toEqual(shown(30));
    expect(cell(both, 's1')?.scans_no_destination).toEqual(shown(8));
    expect(flowList(both)).toEqual([
      ['s1>d1', 16],
      ['s2>d2', 11],
      ['s1>d2', 6],
    ]);
    expect(cell(await bodyOf(BIG, 'both+demo'), 's1')?.scans).toEqual(shown(35));
  });

  test('no read counts the third brand: its 60 scans in the same cells are in none of them', async () => {
    await publish(BIG);
    for (const r of READS) {
      const body = bodies.get(`${r.name}|${canonical(BIG)}`)!;
      expect(body.scope.brands, r.name).not.toContain(BYSTANDER);
      const numbers = [
        ...body.source_cells.flatMap((c) => [c.scans.count, c.scans_no_destination?.count]),
        ...body.flows.map((f) => f.scans.count),
      ].filter((n): n is number => typeof n === 'number');
      expect(numbers.length, r.name).toBeGreaterThan(0);
      for (const n of numbers) expect(n, r.name).toBeLessThan(BYSTANDER_SCANS);
    }
  });

  test('the same dataset read twice differs in nothing', async () => {
    const first = await publish(BIG);
    published.delete(canonical(BIG));
    expect(differences(first, await publish(BIG)).map(line)).toEqual([]);
  });

  test.each(Object.keys(BIG) as PartKey[])(
    'control: one more scan on %s, above the floor, shows on every read that covers it and on no other',
    async (key) => {
      const moved = await neighbours(BIG, { ...BIG, [key]: BIG[key]! + 1 });
      const p = split(key);
      const part =
        p.dest === 'none'
          ? `source_cells.${p.source}.scans_no_destination.count`
          : `flows.${p.source}>${p.dest}.scans.count`;
      const total = `source_cells.${p.source}.scans.count`;
      for (const r of READS) {
        const mine = moved.filter((m) => m.reader === r.name);
        if (!covers(r, key)) {
          expect(mine.map(line), `${r.name} does not cover ${key}`).toEqual([]);
          continue;
        }
        // The part it was added to, and the cell that part belongs to: both
        // by one, and nothing else.
        expect(mine.map((m) => m.path).sort(), r.name).toEqual([part, total].sort());
        for (const m of mine) {
          expect((m.after as number) - (m.before as number), line(m)).toBe(1);
        }
      }
    }
  );

  test('control: the fifth scan on a part shows (the floor is 5, not more)', async () => {
    const at = (n: number): World => ({ 'a|production|s1|d1': 7, 'a|production|s1|d2': n });
    const moved = (await neighbours(at(4), at(5))).filter((m) => m.reader === 'a').map(line);
    expect(moved).toContain('a | source_cells.s1.scans.count: 7 -> 12');
    expect(moved).toContain('a | flows.s1>d2.scans.count: (absent) -> 5');
  });
});

/**
 * Starting points, each with the one part that is walked from 0 up to 4. The
 * part is under the floor at every step, so it is withheld throughout.
 */
const LADDERS: { label: string; base: World; hidden: PartKey }[] = [
  {
    label: 'the reported shape: one flow listed, one left out',
    base: { 'a|production|s1|d1': 7 },
    hidden: 'a|production|s1|d2',
  },
  {
    label: 'a cell with no flow listed at all',
    base: { 'a|production|s1|d1': 3 },
    hidden: 'a|production|s1|d2',
  },
  {
    label: 'a flow listed, and scans for an event with no place',
    base: { 'a|production|s1|d1': 7 },
    hidden: 'a|production|s1|none',
  },
  {
    label: 'scans for an event with no place listed, and a flow left out',
    base: { 'a|production|s1|none': 8 },
    hidden: 'a|production|s1|d1',
  },
  {
    label: 'a demo flow left out beside listed production and demo flows',
    base: { 'a|production|s1|d1': 7, 'a|demo|s1|d1': 6 },
    hidden: 'a|demo|s1|d2',
  },
  {
    label: 'the same pair in two data classes: 3 production scans and a demo part',
    base: { 'a|production|s1|d1': 3 },
    hidden: 'a|demo|s1|d1',
  },
  {
    label: 'two brands: the other brand lists the pair this brand has left out',
    base: { 'a|production|s1|d1': 6, 'b|production|s1|d2': 9 },
    hidden: 'a|production|s1|d2',
  },
  {
    label: 'two brands: the other brand lists the cell, this brand has nothing listed',
    base: { 'b|production|s1|d1': 9 },
    hidden: 'a|production|s1|d1',
  },
  {
    label: 'two brands: two flows of the other brand tie at 7',
    base: { 'b|production|s1|d1': 7, 'b|production|s2|d1': 7 },
    hidden: 'a|production|s2|d1',
  },
  {
    label: 'two brands: two flows of this brand tie at 7',
    base: { 'a|production|s1|d1': 7, 'a|production|s2|d1': 7 },
    hidden: 'b|production|s2|d1',
  },
  {
    label: 'a cell whose only poster has been retired',
    base: { 'a|production|s1|d1': 7 },
    hidden: OFF_PART,
  },
  {
    label: 'a retired poster, the only one in its cell, for an event with no place',
    base: { 'a|production|s1|d1': 7 },
    hidden: OFF_NO_PLACE_PART,
  },
  {
    label: 'scans with no destination in two brands: 3 in the other brand',
    base: { 'a|production|s1|d1': 7, 'b|production|s1|none': 3 },
    hidden: 'a|production|s1|none',
  },
  {
    label: 'a poster that has no cell',
    base: { 'a|production|s1|d1': 7 },
    hidden: NOWHERE_PART,
  },
];

describe('one more scan on a part that is withheld changes nothing any reader is served', () => {
  test('the reported case: a cell with flows of 7 and 3 reads the same after one more scan on the 3', async () => {
    const before: World = { 'a|production|s1|d1': 7, 'a|production|s1|d2': 3 };
    const after: World = { 'a|production|s1|d1': 7, 'a|production|s1|d2': 4 };
    expect((await neighbours(before, after)).map(line)).toEqual([]);
    // What it reads: the cell is the flow that is listed, not 10 and then 11.
    for (const w of [before, after]) {
      const a = await bodyOf(w, 'a');
      expect(cell(a, 's1')?.scans).toEqual(shown(7));
      expect(flowList(a)).toEqual([['s1>d1', 7]]);
    }
  });

  test.each(LADDERS)('$label: $hidden from 0 up to 4, one scan at a time', async (l) => {
    const moved: string[] = [];
    let pairs = 0;
    for (let n = 0; n + 1 < K; n++) {
      pairs++;
      const before = { ...l.base, [l.hidden]: n };
      const after = { ...l.base, [l.hidden]: n + 1 };
      for (const m of await neighbours(before, after)) {
        moved.push(`[${l.hidden} ${n} -> ${n + 1}] ${line(m)}`);
      }
    }
    expect(pairs).toBe(4);
    expect(moved).toEqual([]);
  });
});

describe('small parts never add up to a published number', () => {
  test('one cell, three parts of 4: the cell is withheld, never 12, and no flow is listed', async () => {
    const w: World = {
      'a|production|s1|d1': 4,
      'a|production|s1|d2': 4,
      'a|production|s1|none': 4,
    };
    for (const r of READS.filter((x) => x.brands.includes('a'))) {
      const body = await bodyOf(w, r.name);
      expect(cell(body, 's1'), r.name).toEqual({
        cell: SOURCE.s1,
        // Three events per brand and data class, each with a poster here.
        posters: 3 * r.brands.length * (r.all ? 2 : 1),
        scans: withheld,
        scans_no_destination: withheld,
      });
      expect(body.flows, r.name).toEqual([]);
    }
  });

  test('3 scans in each of two brands on the same pair: withheld for the member of both', async () => {
    const w: World = { 'a|production|s1|d1': 3, 'b|production|s1|d1': 3 };
    const both = await bodyOf(w, 'both');
    expect(cell(both, 's1')?.scans).toEqual(withheld);
    expect(both.flows).toEqual([]);
  });

  test('3 production scans and 3 demo scans on the same pair: withheld when demo is included', async () => {
    const w: World = { 'a|production|s1|d1': 3, 'a|demo|s1|d1': 3 };
    const all = await bodyOf(w, 'a+demo');
    expect(cell(all, 's1')?.scans).toEqual(withheld);
    expect(all.flows).toEqual([]);
  });

  test('scans with no destination, 4 in each of two brands: withheld for the member of both, and not in the cell', async () => {
    const w: World = {
      'a|production|s1|d1': 7,
      'a|production|s1|none': 4,
      'b|production|s1|none': 4,
    };
    const both = await bodyOf(w, 'both');
    expect(cell(both, 's1')?.scans_no_destination).toEqual(withheld);
    // 7, the one listed flow: not 15, and not 11.
    expect(cell(both, 's1')?.scans).toEqual(shown(7));
  });

  test('a withheld part beside listed ones is dropped, not rounded: 6 + 4 + 9 reads 15', async () => {
    const w: World = {
      'a|production|s1|d1': 6,
      'a|production|s1|d2': 4,
      'b|production|s1|d2': 9,
    };
    expect(cell(await bodyOf(w, 'a'), 's1')?.scans).toEqual(shown(6));
    const both = await bodyOf(w, 'both');
    expect(cell(both, 's1')?.scans).toEqual(shown(15));
    expect(flowList(both)).toEqual([
      ['s1>d2', 9],
      ['s1>d1', 6],
    ]);
  });
});

describe('which rows are listed', () => {
  test('a cell with no poster out is listed once its scans are, and not before', async () => {
    const at = (n: number): World => ({ 'a|production|s1|d1': 7, [OFF_PART]: n });
    for (const n of [0, 1, 4]) {
      const a = await bodyOf(at(n), 'a');
      expect(cell(a, 'off'), `${n} scans`).toBeUndefined();
      expect(a.source_cells.map((c) => cellName(c.cell))).toEqual(['s1', 's2']);
    }
    // The same for scans that have no destination: no row for 4 of them.
    const noPlace = await bodyOf({ 'a|production|s1|d1': 7, [OFF_NO_PLACE_PART]: 4 }, 'a');
    expect(cell(noPlace, 'off')).toBeUndefined();
    expect(
      cell(await bodyOf({ 'a|production|s1|d1': 7, [OFF_NO_PLACE_PART]: 6 }, 'a'), 'off')
    ).toEqual({
      cell: SOURCE.off,
      posters: 0,
      scans: shown(6),
      scans_no_destination: shown(6),
    });
    const listed = await bodyOf(at(5), 'a');
    expect(cell(listed, 'off')).toEqual({
      cell: SOURCE.off,
      posters: 0,
      scans: shown(5),
      scans_no_destination: withheld,
    });
    // Rows are in cell order, wherever a row came from.
    expect(listed.source_cells.map((c) => cellName(c.cell))).toEqual(['off', 's1', 's2']);
  });

  test('scans on a poster with no cell are in no cell and no flow, however many there are', async () => {
    const at = (n: number): World => ({ 'a|production|s1|d1': 7, [NOWHERE_PART]: n });
    expect((await neighbours(at(9), at(10))).map(line)).toEqual([]);
    const a = await bodyOf(at(10), 'a');
    expect(a.source_cells.map((c) => [cellName(c.cell), c.scans.count])).toEqual([
      ['s1', 7],
      ['s2', null],
    ]);
    expect(flowList(a)).toEqual([['s1>d1', 7]]);
  });

  test('flows that tie are listed in a fixed order, by source and then destination', async () => {
    const w: World = {
      'a|production|s2|d2': 7,
      'a|production|s2|d1': 7,
      'a|production|s1|d2': 7,
      'b|production|s1|d1': 7,
    };
    expect(flowList(await bodyOf(w, 'both'))).toEqual([
      ['s1>d1', 7],
      ['s1>d2', 7],
      ['s2>d1', 7],
      ['s2>d2', 7],
    ]);
  });
});

describe('a cell is the sum of what is listed for it', () => {
  test('in every response read in this file: scans = its listed flows + its scans with no destination', async () => {
    // Last of the corridor reads, so `bodies` holds every dataset the tests
    // above read (two are read here in case this test runs on its own).
    await publish(BIG);
    await publish({ 'a|production|s1|d1': 7, 'a|production|s1|d2': 3 });
    expect(bodies.size).toBeGreaterThanOrEqual(2 * READS.length);
    for (const [key, body] of bodies) {
      for (const c of body.source_cells) {
        const flows = body.flows
          .filter((f) => f.source === c.cell)
          .reduce((sum, f) => sum + (f.scans.count ?? 0), 0);
        const parts = flows + (c.scans_no_destination.count ?? 0);
        expect(c.scans.count ?? 0, `${key} ${cellName(c.cell)}`).toBe(parts);
        // A row is there for a reason a reader may know: a poster, or a number.
        expect(c.posters > 0 || !c.scans.suppressed, `${key} ${cellName(c.cell)}`).toBe(true);
      }
      // Every flow belongs to a listed cell.
      for (const f of body.flows) {
        expect(
          body.source_cells.some((c) => c.cell === f.source),
          `${key} ${cellName(f.source)}`
        ).toBe(true);
        // A flow under the floor is not in the list at all.
        expect(f.scans.suppressed, key).toBe(false);
      }
      // Nothing published is a number under the floor; withheld is null, never 0.
      for (const f of [
        ...body.source_cells.flatMap((c) => [c.scans, c.scans_no_destination]),
        ...body.flows.map((x) => x.scans),
      ]) {
        expect(f.floor, key).toBe(K);
        expect(f.count === null || f.count >= K, key).toBe(true);
        expect(f.suppressed, key).toBe(f.count === null);
      }
    }
  });
});

// ─── Still open ─────────────────────────────────────────────────────────────
//
// The owner's ruling also reaches the exact scan counts the same admin is
// served elsewhere. They are not corridor reads and are not changed here; this
// pins one of them, with its numbers, so the gap is written down where a test
// fails the day it is closed. Delete it then.
//
//   operations  GET /api/v2/admin/dashboards/operations  reach.poster_scans is
//               every scan of the brand, exact. Corridor cells are sums of
//               listed parts, so the difference is the scans the corridor
//               withholds.
//   event       GET /api/v2/admin/events/:id/dashboard  reach.scans is exact
//               for one event, and an event is one destination.

describe('still open: exact scan counts elsewhere give back what the corridor withholds', () => {
  test('operations total minus the corridor cells is the left-out flow: 3, then 4', async () => {
    const at = async (n: number): Promise<{ left: number; event: number }> => {
      const w: World = {
        'a|production|s1|d1': 7,
        'a|production|s1|d2': n,
        'a|production|s2|d1': 5,
      };
      const cor = await bodyOf(w, 'a');
      expect(cell(cor, 's1')?.scans).toEqual(shown(7));
      expect(cell(cor, 's2')?.scans).toEqual(shown(5));
      const ops = (await fetchJson(
        `/api/v2/admin/dashboards/operations?brand_id=${BRANDS.a}`,
        KEY_ACTOR
      )) as { reach: { poster_scans: number } };
      const one = (await fetchJson(
        `/api/v2/admin/events/${eventId('a', 'production', 'd2')}/dashboard`,
        KEY_ACTOR
      )) as { reach: { scans: number } };
      return { left: ops.reach.poster_scans - 7 - 5, event: one.reach.scans };
    };
    expect(await at(3)).toEqual({ left: 3, event: 3 });
    expect(await at(4)).toEqual({ left: 4, event: 4 });
  });
});

// ─── Seen red ───────────────────────────────────────────────────────────────
//
// Run against the handler at 0c6ff64b (a cell counted on its own, floored per
// brand, data class and cell): 21 of the 37 tests fail.
//
// Eleven of them (the reported case and ten of the ladders) fail on something
// published that moved for one scan on a withheld part. For instance:
//   the reported case, a cell with flows of 7 and 3, then 7 and 4
//     a | source_cells.s1.scans.count: 10 -> 11        (now 7, 7)
//   a cell with no flow listed, parts of 3 and 1, then 3 and 2
//     a | source_cells.s1.scans.count: null -> 5       (now withheld, withheld)
//   scans for an event with no place beside a listed flow of 7
//     a | source_cells.s1.scans.count: 7 -> 8          (now 7, 7)
//   a demo flow left out beside listed flows, demo data included
//     a+demo | source_cells.s1.scans.count: 13 -> 14   (now 13, 13)
//   two brands, the member of both
//     both | source_cells.s1.scans.count: 15 -> 16     (now 15, 15)
//   two flows of the other brand tie at 7, first scan of this brand on one
//     both | flows_order: "s1>d1 s2>d1" -> "s2>d1 s1>d1"
//   a cell whose only poster is retired, its first scan
//     a | source_cells.off.posters: (absent) -> 0      (a row appears)
//
// Six fail on what a dataset reads: 12 published for three parts of 4, 10 for
// parts of 6 and 4, a row for a cell with no poster and 1 scan, flows that tie
// in arrival order, the cell of the fifth-scan control (11, not 7), and the
// pin above (which reads the cell as 7).
//
// Four fail first on `scans_no_destination`, which did not exist: the dataset
// above the floor, the control on a part with no destination, the identity
// check, and 4 + 4 scans with no destination across two brands.
//
// The other 16 are green there too, so they are guards and were not seen red
// until faults were planted in the handler: the floor is 5, the member's
// scope, the third brand, the same dataset read twice, the five controls on
// parts that have a destination, four ladders (the same pair in two data
// classes, the other brand listing a cell this brand has nothing in, two of
// this brand's flows tying, a poster with no cell), 3 + 3 across two brands,
// 3 + 3 across two data classes, and a poster with no cell holding 9 scans.
