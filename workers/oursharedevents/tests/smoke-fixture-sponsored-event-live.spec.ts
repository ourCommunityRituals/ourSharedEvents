/**
 * T4a fixture: the seeded sponsored event must be LIVE every time CI re-seeds it.
 *
 * `tests/ui/smoke/fixtures/sponsored-event.sql` is applied on every push. Its event
 * row is `INSERT OR IGNORE`, so a staging row seeded once keeps its first
 * `start_date`/`end_date` (seeded as "now −1h … now +3h") for good. Six weeks later
 * the event is `post_event`, and the TV (which drops wrapped events, OSE-1521)
 * never loads its sponsors, so the never-who display test fires no impression and
 * proves nothing. That broke T4a on `main` from 2026-10-04.
 *
 * The fixture must therefore refresh the window on every pass, as it already does
 * for `sponsor_accepted`.
 */

import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { computeEventPhase } from '../src/domain/event-phase';
import fixtureSql from '../../../tests/ui/smoke/fixtures/sponsored-event.sql?raw';

const EVENT_ID = 'evt_smoke_sponsored';
const tenv = () => env as unknown as { DB: D1Database; TEST_MIGRATION_STATEMENTS: string };
const db = () => tenv().DB;

// Same bootstrap as migration-smoke.spec.ts: the bundled migration statements, with its two
// tolerated idempotent-rerun errors.
beforeAll(async () => {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('no such column')) continue;
      throw e;
    }
  }
});

/** Same split a `wrangler d1 execute --file` makes: statements end at `;`, `--` lines are comments. */
function statements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return noComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyFixture(): Promise<void> {
  for (const stmt of statements(fixtureSql)) await db().prepare(stmt).run();
}

/** The phase the API reports for the stored row: the same function, fed the stored row. */
async function phaseOf(): Promise<string> {
  const row = await db()
    .prepare('SELECT status, start_date, end_date FROM events WHERE id = ?')
    .bind(EVENT_ID)
    .first<{ status: string; start_date: string | null; end_date: string | null }>();
  expect(row, 'the fixture inserts the event').not.toBeNull();
  return computeEventPhase(row!);
}

describe('T4a | the seeded sponsored event stays live across re-seeds', () => {
  beforeEach(async () => {
    await db().prepare('DELETE FROM sponsor_placement WHERE event_id = ?').bind(EVENT_ID).run();
    await db().prepare('DELETE FROM events WHERE id = ?').bind(EVENT_ID).run();
  });

  test('a first seed is not post_event', async () => {
    await applyFixture();
    expect(await phaseOf()).not.toBe('post_event');
  });

  test('a row seeded weeks ago and re-seeded today is not post_event', async () => {
    await applyFixture();
    // What staging holds: the first seed's window, now six weeks in the past.
    await db()
      .prepare(`UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`)
      .bind('2026-08-25 02:25:18', '2026-08-25 06:25:18', EVENT_ID)
      .run();
    expect(await phaseOf(), 'precondition: the aged row is wrapped').toBe('post_event');

    await applyFixture(); // the next CI push

    expect(await phaseOf()).not.toBe('post_event');
  });

  test('re-seeding keeps the sponsor consented and active', async () => {
    await applyFixture();
    await applyFixture();
    const row = await db()
      .prepare(
        `SELECT is_active, sponsor_accepted FROM sponsor_placement WHERE event_id = ? AND id = 'spl_smoke_local'`
      )
      .bind(EVENT_ID)
      .first<{ is_active: number; sponsor_accepted: number }>();
    expect(row).toEqual({ is_active: 1, sponsor_accepted: 1 });
  });
});
