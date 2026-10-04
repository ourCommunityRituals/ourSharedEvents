/**
 * The date line on a public event page never shows a stored timestamp as is.
 *
 * `events.start_date` is meant to be date-only ("2026-08-25"), and events made
 * through the API store it that way. A row written another way (a fixture, an
 * import, an older path) can hold a full timestamp. The page used to print that
 * string verbatim: staging showed "Happened 2026-08-25 02:25:18" on the smoke
 * fixture event (seen 2026-10-03).
 *
 * The rule: read the leading calendar date of whatever is stored, and show it
 * the way every other date is shown. A value with no leading date shows no date
 * at all, never the raw string.
 *
 * @born-red method: ran against the pre-change formatter — the SQL-shaped and
 * ISO-shaped cases printed the stored string and the garbage case printed
 * "not-a-date"; the date-only case passed on both | date: 2026-10-03
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { humanDate } from '../src/lib/sponsor-home-render';

const BRAND = 'ose-date-line';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seed(id: string, startDate: string, endDate: string): Promise<void> {
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, what_short, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'Test Venue', ?, ?, 'A community gathering.', datetime('now'), datetime('now'))`
  )
    .bind(id, BRAND, `Event ${id}`, id, startDate, endDate)
    .run();
}

async function whenLine(id: string, testid: string): Promise<string> {
  const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
  const m = new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`).exec(html);
  expect(m, `${testid} renders`).not.toBeNull();
  return m![1]!;
}

beforeAll(async () => {
  await applyMigrations();
});

describe('post-event date line', () => {
  test('a SQL-shaped timestamp shows as a date, not as stored', async () => {
    await seed('evt-dl-sql', '2026-08-25 02:25:18', '2026-08-25 06:25:18');
    const line = await whenLine('evt-dl-sql', 'event-when-post');
    expect(line).toContain('Happened Tuesday, August 25, 2026');
    expect(line).not.toContain('02:25:18');
    expect(line).not.toContain('2026-08-25');
  });

  test('an ISO timestamp shows as a date, not as stored', async () => {
    await seed('evt-dl-iso', '2026-08-25T02:25:18.000Z', '2026-08-25T06:25:18.000Z');
    const line = await whenLine('evt-dl-iso', 'event-when-post');
    expect(line).toContain('Happened Tuesday, August 25, 2026');
    expect(line).not.toContain('T02:25');
  });

  test('a date-only value is unchanged', async () => {
    await seed('evt-dl-date', '2026-08-25', '2026-08-25');
    const line = await whenLine('evt-dl-date', 'event-when-post');
    expect(line).toContain('Happened Tuesday, August 25, 2026');
  });
});

describe('a start date with no leading calendar date', () => {
  // Whatever phase such a row lands in, the stored string is not on the page.
  test('the page renders and never shows the raw string', async () => {
    await seed('evt-dl-junk', 'not-a-date', '2020-01-01');
    const res = await SELF.fetch('https://t.test/events/evt-dl-junk');
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('not-a-date');
  });
});

describe('event time metadata', () => {
  const meta = async (id: string, prop: string) =>
    new RegExp(`${prop}" content="([^"]+)"`).exec(
      await (await SELF.fetch(`https://t.test/events/${id}`)).text()
    )?.[1];

  test('a SQL-shaped timestamp is published as its calendar date', async () => {
    await seed('evt-dl-og-sql', '2026-08-25 02:25:18', '2026-08-25 06:25:18');
    expect(await meta('evt-dl-og-sql', 'og:event:start_time')).toBe('2026-08-25');
    expect(await meta('evt-dl-og-sql', 'og:event:end_time')).toBe('2026-08-25');
  });

  test('date-only and ISO values pass through unchanged', async () => {
    await seed('evt-dl-og-iso', '2026-08-25', '2026-08-25T06:25:18.000Z');
    expect(await meta('evt-dl-og-iso', 'og:event:start_time')).toBe('2026-08-25');
    expect(await meta('evt-dl-og-iso', 'og:event:end_time')).toBe('2026-08-25T06:25:18.000Z');
  });
});

describe('sponsor home date', () => {
  test('a stored timestamp shows as a date', () => {
    expect(humanDate('2026-08-25')).toBe('Tue, Aug 25, 2026');
    expect(humanDate('2026-08-25 02:25:18')).toBe('Tue, Aug 25, 2026');
  });

  test('an unreadable value says the date is to be announced, never the raw string', () => {
    expect(humanDate('not-a-date')).toBe('Date to be announced');
    expect(humanDate(null)).toBe('Date to be announced');
  });
});

describe('pre-event date line', () => {
  test('a stored timestamp shows as a date', async () => {
    await seed('evt-dl-pre', '2099-03-07 18:00:00', '2099-03-07 21:00:00');
    const line = await whenLine('evt-dl-pre', 'event-when');
    expect(line).toContain('Saturday, March 7, 2099');
    expect(line).not.toContain('18:00:00');
  });
});
