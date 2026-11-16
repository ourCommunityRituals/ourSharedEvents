/**
 * The differencing proof for scans per stall, as a property (OSE-2004, OSE
 * ADR-034 decision 6), at the workers-pool layer: real D1, the real router.
 *
 * For random fairs (stalls in and out of use, categories, placements with and
 * without a stall, scans per placement per hour), read the three admin routes
 * that publish scans for one event beside each other:
 *
 *   GET …/booths/counts         per stall, per category, "no stall", the total
 *   GET …/stats                 the event's scans
 *   GET …/poster-deployments    per placement
 *
 * and hold, for every dataset:
 *
 *   P1  no published count is between 1 and 4; `suppressed` iff `count` is null;
 *   P2  the pooled total is the sum of the published stall counts and "no
 *       stall", it equals /stats, it equals the sum of the poster list, and
 *       each stall equals the sum of its own posters on the poster list;
 *   P3  (the neighbour property) take a withheld stall and set every one of
 *       its cells to 0, or to other values under the floor: NOTHING published
 *       on any of the three routes moves. So any arithmetic over published
 *       numbers (a difference of two, of two subsets, the total minus the
 *       list) gives the same value whether the stall's true count is what it
 *       was or 0: no such expression can equal the stall's true count unless
 *       it gives the same value when the stall has none. The test also checks
 *       that literally for every pairwise difference;
 *   P4  the same for any one withheld cell, in any stall or none.
 *
 * What this does NOT prove is in docs/features/FAIR-REPORTING.md ("What is
 * proved, and what is not"): reads at two moments, and what a placement's
 * move between stalls shows.
 *
 * Runs: FC_RUNS (default 25). A counterexample is reproducible from the seed
 * fast-check prints.
 *
 * @born-red OSE-2004 | method: run with the route switched off in router.ts
 *   (4 of 4 red, 404); then one fault at a time in lib/booth-counts.ts, each
 *   restored before the next:
 *   (1) the floor removed on the stall count: 4 of 4 red (P3 goes red by
 *       running out of datasets with a withheld stall, not by a difference);
 *   (2) the pooled total from the raw cells: 3 of 4 red (P2, P3, P4);
 *   (3) the stall summed raw and floored once, so 4 + 3 reads 7: 3 of 4 red
 *       (P1 passes, as 7 is not under the floor: the neighbour properties
 *       catch it);
 *   (4) `any_withheld` as the number of withheld stalls: 1 of 4 red (P1)
 * | date: 2026-11-16
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { route, type RouterEnv } from '../src/router';
import { usePaidReportPlan } from './helpers/paid-report-plan';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const RUNS = Number(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.FC_RUNS ?? 25
);
const BRAND = 'brand-bcp';
const OWNER = 'owner-bcp@example.com';
const EVENT = 'evt-bcp-fair';
const HOURS = ['10', '11', '12', '13'] as const;
const CATEGORIES = ['food', 'craft', null] as const;

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = Math.floor(Date.now() / 1000);
const AS_OWNER = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now - 10,
    exp: now + 7200,
  })}.sig`,
};

type Json = Record<string, any>;
interface Fair {
  stalls: { category: (typeof CATEGORIES)[number]; active: boolean }[];
  /** For each placement, the index of its stall, or -1 for none. */
  placements: number[];
  /** scans[placement][hour] */
  scans: number[][];
}

/** A small count, most often under the floor, sometimes well over it. */
const scanCount = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 4 }) },
  { weight: 2, arbitrary: fc.integer({ min: 5, max: 12 }) }
);

const fairArb: fc.Arbitrary<Fair> = fc
  .record({
    stalls: fc.array(
      fc.record({ category: fc.constantFrom(...CATEGORIES), active: fc.boolean() }),
      { minLength: 1, maxLength: 6 }
    ),
    placementCount: fc.integer({ min: 1, max: 7 }),
  })
  .chain(({ stalls, placementCount }) =>
    fc.record({
      stalls: fc.constant(stalls),
      placements: fc.array(fc.integer({ min: -1, max: stalls.length - 1 }), {
        minLength: placementCount,
        maxLength: placementCount,
      }),
      scans: fc.array(fc.array(scanCount, { minLength: HOURS.length, maxLength: HOURS.length }), {
        minLength: placementCount,
        maxLength: placementCount,
      }),
    })
  );

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

const stallId = (i: number) => `bcp-s${i}`;
const placementId = (i: number) => `bcp-p${i}`;

async function seedStructure(f: Fair): Promise<void> {
  const db = tenv.DB;
  await db.batch([
    db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM poster_deployments WHERE event_id = ?').bind(EVENT),
    db.prepare('DELETE FROM event_booths WHERE event_id = ?').bind(EVENT),
    ...f.stalls.map((s, i) =>
      db
        .prepare(
          `INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(stallId(i), EVENT, `N${i}`, `Stall ${i}`, s.category, s.active ? 1 : 0, i)
    ),
    ...f.placements.map((stall, i) =>
      db
        .prepare(
          `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(
          placementId(i),
          EVENT,
          `qrt_bcp_${i}`,
          `Code ${i}`,
          stall === -1 ? null : stallId(stall),
          `2026-12-01T00:00:${String(i).padStart(2, '0')}Z`
        )
    ),
  ]);
}

async function seedScans(scans: number[][]): Promise<void> {
  const db = tenv.DB;
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM scan_placement_events WHERE event_id = ?').bind(EVENT),
  ];
  scans.forEach((row, p) =>
    row.forEach((n, h) => {
      for (let i = 0; i < n; i++)
        stmts.push(
          db
            .prepare(
              `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, ?, ?)`
            )
            .bind(`bcp-${p}-${h}-${i}`, EVENT, placementId(p), `2026-12-05T${HOURS[h]}:00`)
        );
    })
  );
  await db.batch(stmts);
}

async function get(path: string): Promise<Json> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, { headers: AS_OWNER }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  expect(res.status, path).toBe(200);
  return (await res.json()) as Json;
}

/** The three published answers. */
async function readAll(): Promise<{ stalls: Json; stats: Json; posters: Json }> {
  return {
    stalls: await get(`/api/v2/admin/events/${EVENT}/booths/counts`),
    stats: await get(`/api/v2/admin/events/${EVENT}/stats`),
    posters: await get(`/api/v2/admin/events/${EVENT}/poster-deployments`),
  };
}

/** Every FlooredCount anywhere in a body, with its path. */
function flooredCounts(v: unknown, path = ''): { path: string; f: Json }[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => flooredCounts(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const o = v as Json;
    if ('suppressed' in o && 'count' in o && 'floor' in o) return [{ path, f: o }];
    return Object.entries(o).flatMap(([k, x]) => flooredCounts(x, `${path}.${k}`));
  }
  return [];
}

/** Every published number of people's actions on the three routes. */
function published(r: { stalls: Json; stats: Json; posters: Json }): number[] {
  return [
    ...flooredCounts(r.stalls),
    ...flooredCounts(r.stats.stats.scans),
    ...flooredCounts(r.posters.items),
  ]
    .map((x) => x.f.count)
    .filter((n): n is number => typeof n === 'number');
}

function differences(ns: number[]): Set<number> {
  const out = new Set<number>(ns);
  for (const a of ns) for (const b of ns) out.add(Math.abs(a - b));
  return out;
}

const trueCount = (f: Fair, stall: number) =>
  f.placements.reduce(
    (s, st, p) => (st === stall ? s + f.scans[p].reduce((x, y) => x + y, 0) : s),
    0
  );
const stableJson = (r: unknown) => JSON.stringify(r);

beforeAll(async () => {
  await applyMigrations();
  await usePaidReportPlan();
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
  )
    .bind(OWNER, BRAND)
    .run();
  await tenv.DB.prepare(
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, 'Property fair', 'bcp-fair', 'active', 'Eagles Hall', '2026-12-05T15:00:00.000Z', '2026-12-05T21:00:00.000Z', 'America/Chicago')`
  )
    .bind(EVENT, BRAND)
    .run();
});

describe('OSE-2004 | scans per stall: nothing published can be worked back to a withheld stall', () => {
  test('P1 no published count is 1 to 4, and withheld reads null', async () => {
    await fc.assert(
      fc.asyncProperty(fairArb, async (f) => {
        await seedStructure(f);
        await seedScans(f.scans);
        const r = await readAll();
        for (const { path, f: c } of [
          ...flooredCounts(r.stalls),
          ...flooredCounts(r.stats),
          ...flooredCounts(r.posters),
        ]) {
          expect(c.floor, path).toBe(5);
          expect(c.suppressed, path).toBe(c.count === null);
          if (c.count !== null) expect(c.count, path).toBeGreaterThanOrEqual(5);
        }
        expect(typeof r.stalls.any_withheld).toBe('boolean');
      }),
      { numRuns: RUNS }
    );
  });

  test('P2 the total is the sum of the published rows, /stats, and the poster list', async () => {
    await fc.assert(
      fc.asyncProperty(fairArb, async (f) => {
        await seedStructure(f);
        await seedScans(f.scans);
        const { stalls, stats, posters } = await readAll();
        const c = (x: Json) => (x.count as number | null) ?? 0;
        const listed = (stalls.booths as Json[]).reduce((s, b) => s + c(b.scans), 0);
        expect(c(stalls.total)).toBe(listed + c(stalls.no_stall.scans));
        expect(stats.stats.scans).toEqual(stalls.total);
        const items = posters.items as Json[];
        expect(items.reduce((s, p) => s + c(p.scans), 0)).toBe(c(stalls.total));
        for (const b of stalls.booths as Json[]) {
          const own = items.filter((p) => p.booth_id === b.id);
          expect(c(b.scans), b.number).toBe(own.reduce((s, p) => s + c(p.scans), 0));
        }
        const cats = (stalls.categories as Json[]).reduce((s, x) => s + c(x.scans), 0);
        expect(cats).toBe(listed);
      }),
      { numRuns: RUNS }
    );
  });

  test('P3 a withheld stall set to 0 (or other values under the floor) moves nothing published', async () => {
    await fc.assert(
      fc.asyncProperty(
        fairArb,
        fc.nat(),
        fc.array(fc.integer({ min: 0, max: 4 })),
        async (f, pick, refill) => {
          await seedStructure(f);
          await seedScans(f.scans);
          const before = await readAll();
          // The list is in the organizer's order (in use first), so map back by id.
          const withheld = (before.stalls.booths as Json[])
            .filter((b) => b.scans.suppressed)
            .map((b) => ({ i: Number(String(b.id).replace('bcp-s', '')) }));
          fc.pre(withheld.length > 0);
          const { i: stall } = withheld[pick % withheld.length];
          const t = trueCount(f, stall);
          // Zero the stall, then, in a second neighbour, refill it under the floor.
          for (const mode of ['zero', 'refill'] as const) {
            let k = 0;
            const scans = f.scans.map((row, p) =>
              f.placements[p] === stall
                ? row.map(() => (mode === 'zero' ? 0 : (refill[k++] ?? 0)))
                : [...row]
            );
            await seedScans(scans);
            const after = await readAll();
            expect(stableJson(after), `stall ${stall} (${t} scans) set by ${mode}`).toBe(
              stableJson(before)
            );
            // Literally: every difference of published numbers is the same set
            // whether the stall holds t or holds none.
            expect([...differences(published(after))].sort()).toEqual(
              [...differences(published(before))].sort()
            );
          }
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('P4 any one cell under the floor, changed under the floor, moves nothing published', async () => {
    await fc.assert(
      fc.asyncProperty(fairArb, fc.nat(), fc.integer({ min: 0, max: 4 }), async (f, pick, to) => {
        const small: [number, number][] = [];
        f.scans.forEach((row, p) => row.forEach((n, h) => n < 5 && small.push([p, h])));
        fc.pre(small.length > 0);
        const [p, h] = small[pick % small.length];
        fc.pre(f.scans[p][h] !== to);
        await seedStructure(f);
        await seedScans(f.scans);
        const before = await readAll();
        const scans = f.scans.map((row) => [...row]);
        scans[p][h] = to;
        await seedScans(scans);
        expect(stableJson(await readAll())).toBe(stableJson(before));
      }),
      { numRuns: RUNS }
    );
  });
});
