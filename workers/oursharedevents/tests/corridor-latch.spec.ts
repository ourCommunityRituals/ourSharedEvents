/**
 * Corridor readiness latch (VISION §6.2b; migration 0084; CCR PR 700).
 *
 * The attendee map's gate is PER CORRIDOR (H3 res 7) and LATCHES: once a
 * corridor holds ≥ CORRIDOR_READY_MIN_EVENTS upcoming published events, the
 * nightly job records it, and the landing keeps drawing it after it drops
 * back below the threshold. Runs against real D1 (workers pool).
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import {
  latchLandingAreas,
  latchReadyCorridors,
  readLatchedCorridors,
  readLatches,
  LANDING_AREA_LATCH_KEY,
} from '../src/lib/corridor-latch';
import { LIST_MAX } from '../src/lib/landing-area';
import { CORRIDOR_READY_MIN_EVENTS } from '../src/lib/corridor-readiness';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

const BRAND = 'root';
const OTHER = 'ose-latch-other';
const BUSY = latLngToCell(41.657731, -87.680213, 7); // Blue Island
const QUIET = latLngToCell(41.717329, -87.673159, 7); // Beverly
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seed(
  id: string,
  cell: string,
  opts: { brand?: string; status?: string; published?: number; start?: string } = {}
) {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, location, is_published, h3_res7)
     VALUES (?, ?, ?, ?, ?, ?, 'Hall', ?, ?)`
  )
    .bind(
      id,
      opts.brand ?? BRAND,
      `Latch ${id}`,
      `slug-${id}`,
      opts.status ?? 'active',
      opts.start ?? day(10),
      opts.published ?? 1,
      cell
    )
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare(`DELETE FROM events WHERE id LIKE 'lt-%'`).run();
  await tenv.DB.prepare('DELETE FROM corridor_readiness_latch').run();
  // BUSY: exactly the threshold in root.
  for (let i = 0; i < CORRIDOR_READY_MIN_EVENTS; i++) await seed(`lt-busy-${i}`, BUSY);
  // QUIET: one short in root, padded with events that must NOT count.
  for (let i = 0; i < CORRIDOR_READY_MIN_EVENTS - 1; i++) await seed(`lt-quiet-${i}`, QUIET);
  await seed('lt-quiet-draft', QUIET, { status: 'draft' });
  await seed('lt-quiet-unpub', QUIET, { published: 0 });
  await seed('lt-quiet-past', QUIET, { start: day(-30) });
  await seed('lt-quiet-far', QUIET, { start: day(200) });
  // OTHER brand in QUIET: would make 5+ if brands were mixed.
  for (let i = 0; i < 3; i++) await seed(`lt-other-${i}`, QUIET, { brand: OTHER });
});

describe('latchReadyCorridors', () => {
  test('latches only corridors at the threshold, per brand; drafts/unpublished/past/far never count', async () => {
    const n = await latchReadyCorridors(tenv.DB);
    expect(n).toBe(1);
    expect([...(await readLatchedCorridors(tenv.DB, BRAND))]).toEqual([BUSY]);
    expect([...(await readLatchedCorridors(tenv.DB, OTHER))]).toEqual([]);
  });

  test('idempotent: a second run latches nothing new', async () => {
    expect(await latchReadyCorridors(tenv.DB)).toBe(0);
  });
});

// Owner decision 2026-10-03: the landing map is gated on the AREA total
// (LIST_MAX = 10 events on the page), not on a corridor and not on the latch.
// The corridor latch still records at CORRIDOR_READY_MIN_EVENTS (above), but it
// no longer decides what "/" draws. The landing has its own latch, recorded by
// the same nightly job at LIST_MAX events for the whole area.
describe('the landing area latch (LIST_MAX events on the page, recorded nightly)', () => {
  const areaLatched = async (brand: string) => (await readLatches(tenv.DB, brand)).landingArea;
  const insertListed = (id: string, listedFrom: string) =>
    tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, location, is_published, h3_res7, listed_from)
       VALUES (?, ?, 'Latch area', ?, 'active', ?, 'Hall', 1, ?, ?)`
    )
      .bind(id, BRAND, `slug-${id}`, day(12), QUIET, listedFrom)
      .run();

  test('the threshold is 10, and the seed holds one fewer countable event', async () => {
    expect(LIST_MAX).toBe(10);
    const row = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE brand_id = ? AND id LIKE 'lt-%'
        AND is_published = 1 AND status = 'active' AND start_date >= ? AND start_date <= ?`
    )
      .bind(BRAND, day(0), day(90))
      .first<{ n: number }>();
    expect(row?.n).toBe(LIST_MAX - 1);
  });

  test('one short of the threshold does not latch, and "/" leads with the doors', async () => {
    expect(await latchLandingAreas(tenv.DB)).toBe(0);
    expect(await areaLatched(BRAND)).toBe(false);
    const html = await (await SELF.fetch('https://x/')).text();
    expect(html.indexOf('data-testid="landing-doors"')).toBeLessThan(
      html.indexOf('data-testid="landing-area"')
    );
    expect(html).toContain('data-testid="amap-example"');
    expect(html).not.toContain('data-cell=');
  });

  test('a tenth event published a moment ago does not latch yet (settled events only)', async () => {
    await insertListed('lt-area-fresh', new Date().toISOString());
    expect(await latchLandingAreas(tenv.DB)).toBe(0);
    expect(await areaLatched(BRAND)).toBe(false);
    await tenv.DB.prepare(`DELETE FROM events WHERE id = 'lt-area-fresh'`).run();
  });

  test('a settled tenth event latches the area, once, for that brand only', async () => {
    await insertListed('lt-area-settled', new Date(Date.now() - 2 * 86_400_000).toISOString());
    expect(await latchLandingAreas(tenv.DB)).toBe(1);
    expect(await areaLatched(BRAND)).toBe(true);
    expect(await areaLatched(OTHER)).toBe(false);
    expect(await latchLandingAreas(tenv.DB)).toBe(0);
  });

  test('the area row is not a corridor: the corridor reader never returns its key', async () => {
    const cells = [...(await readLatchedCorridors(tenv.DB, BRAND))];
    expect(cells).toEqual([BUSY]);
    expect(cells).not.toContain(LANDING_AREA_LATCH_KEY);
  });

  test('after the count drops below 10, "/" still leads with the map and draws it (no flapping)', async () => {
    // Four of the five busy events wrap up: six events remain.
    await tenv.DB.prepare(
      `UPDATE events SET status = 'archived' WHERE id IN ('lt-busy-0','lt-busy-1','lt-busy-2','lt-busy-3')`
    ).run();
    const html = await (await SELF.fetch('https://x/')).text();
    expect(html.indexOf('data-testid="landing-area"')).toBeLessThan(
      html.indexOf('data-testid="landing-doors"')
    );
    expect(html).toContain(`data-cell="${BUSY}"`);
    expect(html).toContain(`data-cell="${QUIET}"`);
    expect(html).not.toContain('data-testid="amap-example"');
  });
});
