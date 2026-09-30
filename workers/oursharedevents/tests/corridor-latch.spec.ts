/**
 * Corridor readiness latch (VISION §6.2b; migration 0083; CCR PR 700).
 *
 * The attendee map's gate is PER CORRIDOR (H3 res 7) and LATCHES: once a
 * corridor holds ≥ CORRIDOR_READY_MIN_EVENTS upcoming published events, the
 * nightly job records it, and the landing keeps drawing it after it drops
 * back below the threshold. Runs against real D1 (workers pool).
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { latchReadyCorridors, readLatchedCorridors } from '../src/lib/corridor-latch';
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

describe('the landing keeps a latched corridor on the map', () => {
  test('after BUSY drops below the threshold, / still draws it (no flapping)', async () => {
    // Four of the five busy events wrap up; one remains upcoming.
    await tenv.DB.prepare(
      `UPDATE events SET status = 'archived' WHERE id IN ('lt-busy-0','lt-busy-1','lt-busy-2','lt-busy-3')`
    ).run();
    const html = await (await SELF.fetch('https://x/')).text();
    expect(html).toContain(`data-cell="${BUSY}"`);
    // QUIET never latched and is below the threshold: never a hex.
    expect(html).not.toContain(`data-cell="${QUIET}"`);
  });
});
