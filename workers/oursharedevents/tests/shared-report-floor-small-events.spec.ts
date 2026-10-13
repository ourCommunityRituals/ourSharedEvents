/**
 * OSE-1707 (CCR B2): what the hourly K=5 floor publishes for small, real-shaped events.
 *
 * The per-bucket floor drops an hour with fewer than 5 browsers BEFORE the sum
 * (OSE-683). At the scale of the first venues that may blank most of an event.
 * This is a measurement, written as a characterization test so the numbers are
 * pinned: a change to the floor or to the sum has to change them on purpose.
 *
 * Shapes are SYNTHETIC. Staging holds test traffic, which is not representative,
 * and production has no scans. `hours` is the distinct browsers seen in each
 * hour; `people` is the true number of different browsers over the event, given
 * by the shape (a browser present in two hours appears in two entries of `hours`).
 *
 * Read the result as: published vs people. `null` means the report shows nothing
 * for the count.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { buildSharedReport } from '../src/lib/shared-report-builder';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const db = () => tenv().DB;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

interface Shape {
  name: string;
  people: number;
  hours: number[];
  /** What the report publishes today, pinned. */
  published: number | null;
}

const SHAPES: Shape[] = [
  {
    name: 'quiet start, busy middle, quiet end (30 people, 3 h)',
    people: 30,
    hours: [4, 22, 4],
    published: 22,
  },
  {
    name: 'steady trickle (30 people, 6 h of 5)',
    people: 30,
    hours: [5, 5, 5, 5, 5, 5],
    published: 30,
  },
  {
    name: 'slow trickle (30 people, 8 h of 3 to 4)',
    people: 30,
    hours: [4, 4, 4, 4, 4, 4, 3, 3],
    published: null,
  },
  {
    name: 'league night curve (25 people, 5 h)',
    people: 25,
    hours: [3, 8, 12, 5, 2],
    published: 25,
  },
  { name: 'small gathering (12 people, 2 h, even)', people: 12, hours: [6, 6], published: 12 },
  { name: 'small gathering (12 people, 2 h, lopsided)', people: 12, hours: [8, 4], published: 8 },
  { name: 'a good night (60 people, 4 h)', people: 60, hours: [15, 25, 15, 5], published: 60 },
  { name: 'tiny (4 people, 1 h)', people: 4, hours: [4], published: null },
  // The other direction (B1): the same 20 people scanned in two hours.
  { name: 'everyone scans twice (20 people, in 2 h)', people: 20, hours: [20, 20], published: 40 },
];

let n = 0;
async function publishedFor(shape: Shape): Promise<number | null> {
  n++;
  const id = `evt-floor-${n}`;
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(id, shape.name, id)
    .run();
  for (const [i, count] of shape.hours.entries()) {
    await db()
      .prepare(
        `INSERT INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-05-07', ?, ?, ?, datetime('now'))`
      )
      .bind(`sa-${id}-${i}`, id, 18 + i, count, count)
      .run();
  }
  const r = await buildSharedReport(db(), id);
  if (!r.ok) throw new Error(`report did not build for ${shape.name}: ${r.error}`);
  return (r.report as unknown as { distinct_scanners: number | null }).distinct_scanners;
}

beforeAll(applyMigrations);

describe('OSE-1707: what the hourly floor publishes for small events (synthetic shapes)', () => {
  test.each(SHAPES.map((s) => [s.name, s] as const))('%s', async (_name, shape) => {
    const got = await publishedFor(shape);
    expect(got, `${shape.name}: hours ${JSON.stringify(shape.hours)}`).toBe(shape.published);
  });

  test('the table, for the ticket', async () => {
    const rows: string[] = [];
    for (const s of SHAPES) {
      const got = await publishedFor(s);
      const note =
        got === null
          ? 'nothing shown'
          : got < s.people
            ? `undercounts by ${s.people - got}`
            : got > s.people
              ? `overcounts by ${got - s.people}`
              : 'exact';
      rows.push(
        `| ${s.name} | ${JSON.stringify(s.hours)} | ${s.people} | ${got ?? 'null'} | ${note} |`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`FLOOR_TABLE\n${rows.join('\n')}\nEND_FLOOR_TABLE`);
    expect(rows.length).toBe(SHAPES.length);
  });

  test('an event-level count would publish what the hourly floor withholds', () => {
    // Not built (OSE-1706 fix 2). For each shape, a distinct count taken over the whole event
    // (floored once at K=5) shows the people figure whenever people >= 5.
    for (const s of SHAPES) {
      const eventLevel = s.people >= 5 ? s.people : null;
      if (s.published === null && s.people >= 5) expect(eventLevel).toBe(s.people);
    }
  });
});
