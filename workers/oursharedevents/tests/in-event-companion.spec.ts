/**
 * OSE-656 — In-event companion ("the display TV in your pocket") wall guard.
 *
 * The companion renders EVENT STATE on the device during the event. The wall
 * (B1 / #1 never-who): it must NEVER count the VIEWER in real time — viewing is
 * an anonymous session reference, not a tracked presence. The only count it may
 * show is the server-authoritative check-in aggregate (people who checked in via
 * the form), never a per-viewer/"watching now" number, and never an optimistic
 * client-incremented count. Born-red seed for OSE-662 (never-who).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column') ||
        m.includes('already exists') ||
        m.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seedLive(id: string): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const start = new Date(Date.now() - 3600_000).toISOString(); // started 1h ago
  const end = new Date(Date.now() + 7200_000).toISOString(); // ends in 2h  → 'event' phase
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date,
                         what_short, who_host, where_address, created_at, updated_at)
     VALUES (?, 'live-test', 'Live Now Event', ?, 'active', 'The Venue', ?, ?,
             'Whats happening', 'The host', '1 Main St', datetime('now'), datetime('now'))`
  )
    .bind(id, id, start, end)
    .run();
}

beforeAll(applyMigrations);

describe('OSE-656 | in-event companion — never counts the viewer', () => {
  test('renders the live companion for an in-progress event', async () => {
    const id = 'evt_live_now';
    await seedLive(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('data-testid="event-main-live"');
    expect(html).toContain('data-testid="event-live-badge"');
    expect(html).toContain('data-testid="event-checkin"'); // check-in path (server round-trip)
  });

  test('shows NO viewer/presence count — viewing is an anonymous session reference (#1)', async () => {
    const id = 'evt_live_now';
    await seedLive(id);
    const html = (await (await SELF.fetch(`https://t.test/events/${id}`)).text()).toLowerCase();
    // no language that would imply counting the person viewing right now
    for (const phrase of [
      'viewing now',
      'watching now',
      'people viewing',
      'viewers',
      'here now',
      'online now',
      'watching live',
    ]) {
      expect(html, `must not render viewer-presence count: "${phrase}"`).not.toContain(phrase);
    }
  });

  test('the live page shows no count at all — not a viewer tally, not a check-in tally', async () => {
    const id = 'evt_live_now';
    await seedLive(id);
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    // Counts are post-event only (founder decision 2026-09-04). This assertion
    // used to be conditional ("if a count is shown it must be the check-in
    // aggregate"); it is now absolute, so a reintroduced live tally fails here
    // rather than passing vacuously.
    expect(html).not.toContain('data-testid="checkin-count"');
    expect(html).not.toMatch(/checked in so far/i);
    // no client-side interval incrementing a count (no realtime viewer tally)
    expect(html).not.toMatch(/setInterval[\s\S]{0,200}(count|viewer|watching)/i);
  });
});
