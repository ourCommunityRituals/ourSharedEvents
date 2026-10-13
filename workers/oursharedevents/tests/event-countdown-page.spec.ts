/**
 * Pre-event countdown on the public event page, through the deployed handler
 * (workers pool). OSE-474.
 *
 * The text at each boundary, DST and the browser tick are covered by
 * `event-countdown.spec.ts` (node pool). This spec proves the wiring: a future
 * event's page carries the countdown inside its labelled when line, rendered by
 * the server; the script that ticks it runs under the page's CSP nonce; a live
 * or past event's page has no countdown.
 *
 * @born-red method: run against main at be0ba4c (no countdown on the page) —
 * the four "has the countdown" tests fail; the "no countdown" tests pass on
 * both, as they should.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { zonedDatePart } from '../src/lib/event-datetime';

const BRAND = 'ose474-countdown';
const TZ = 'America/Chicago';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

async function seed(
  id: string,
  startDate: string,
  startsAt: string | null,
  endDate: string | null = null
): Promise<void> {
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                         start_date, end_date, timezone, starts_at, created_at, updated_at)
       VALUES (?, ?, 'Countdown night', ?, 'active', 1, 'Eagles Hall', ?, ?, ?, ?,
               datetime('now'), datetime('now'))`
  )
    .bind(id, BRAND, id, startDate, endDate, TZ, startsAt)
    .run();
}

async function page(id: string): Promise<{ html: string; csp: string }> {
  const res = await SELF.fetch(`https://t.test/events/${id}`);
  expect(res.status).toBe(200);
  return { html: await res.text(), csp: res.headers.get('Content-Security-Policy') ?? '' };
}

const isoSecond = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The local calendar date in TZ, `days` after today. */
function localDayPlus(days: number): string {
  const [y, m, d] = zonedDatePart(new Date().toISOString(), TZ).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The when line's opening tag through its close, as served. */
function whenBlock(html: string): string {
  return html.match(/<p class="ose-meta" data-testid="event-when">[\s\S]*?<\/p>/)?.[0] ?? '';
}

describe('a future event shows the countdown, rendered by the server', () => {
  test('timed: "Starts in 5 hours" inside the labelled when line', async () => {
    const id = 'evt_ose474_timed';
    const startsAt = isoSecond(Date.now() + 5 * 3600_000 + 30 * 60_000);
    await seed(id, zonedDatePart(startsAt, TZ), startsAt);
    const { html } = await page(id);

    const when = whenBlock(html);
    expect(when, 'the when line renders').not.toBe('');
    // The labelled event-zone time stays the authority, first in the line.
    expect(when).toMatch(/data-testid="event-when">[^<]*\d{1,2}:\d{2}\s?(AM|PM) C[DS]T</);
    expect(when).toMatch(
      /<small class="sub-line" data-testid="event-countdown" aria-live="off" data-starts-at="[^"]+" data-tz="America\/Chicago">Starts in 5 hours<\/small><\/p>$/
    );
    // Inside the page header, above the sponsor strip and the facts.
    const header = html.match(/<header data-testid="event-header">[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).toContain('data-testid="event-countdown"');
    expect(html.match(/<small[^>]*data-testid="event-countdown"/g)).toHaveLength(1);
  });

  test('date-only: whole days, never hours', async () => {
    const id = 'evt_ose474_date_only';
    await seed(id, localDayPlus(3), null);
    const { html } = await page(id);
    const countdown = html.match(/data-testid="event-countdown"[^>]*>([^<]*)</)?.[1];
    expect(countdown).toBe('Starts in 3 days');
    expect(whenBlock(html)).toContain(`data-start-day="${localDayPlus(3)}"`);
  });

  test('date-only tomorrow reads "Starts tomorrow"', async () => {
    const id = 'evt_ose474_tomorrow';
    await seed(id, localDayPlus(1), null);
    const { html } = await page(id);
    expect(html.match(/data-testid="event-countdown"[^>]*>([^<]*)</)?.[1]).toBe('Starts tomorrow');
  });

  test('the tick script runs under the page nonce, after the when line', async () => {
    const id = 'evt_ose474_nonce';
    const startsAt = isoSecond(Date.now() + 2 * 3600_000 + 30 * 60_000);
    await seed(id, zonedDatePart(startsAt, TZ), startsAt);
    const { html, csp } = await page(id);
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, 'CSP carries a nonce').toBeTruthy();
    const after = html.slice(html.indexOf('data-testid="event-countdown"'));
    const script = after.match(/<\/p><script nonce="([^"]+)">([\s\S]*?)<\/script\s*>/i);
    expect(script, 'script follows the when line').not.toBeNull();
    expect(script![1]).toBe(nonce);
    expect(script![2]).toContain('event-countdown');
    expect(script![2]).toContain('setInterval');
  });
});

describe('no countdown where it does not belong', () => {
  test('a live event (started an hour ago) has none', async () => {
    const id = 'evt_ose474_live';
    const startsAt = isoSecond(Date.now() - 3600_000);
    await seed(id, zonedDatePart(startsAt, TZ), startsAt);
    const { html } = await page(id);
    expect(html).toContain('data-testid="event-live-badge"');
    expect(html).not.toContain('event-countdown');
    expect(html).not.toContain('Starts in');
  });

  test('a past event (the recap) has none', async () => {
    const id = 'evt_ose474_past';
    await seed(id, '2020-10-24', '2020-10-24T23:00:00Z', '2020-10-24');
    const { html } = await page(id);
    expect(html).toContain('data-testid="event-when-post"');
    expect(html).not.toContain('event-countdown');
  });

  test('more than 30 days out: the date line alone, unchanged', async () => {
    const id = 'evt_ose474_far';
    await seed(id, '2099-10-24', '2099-10-24T23:00:00Z');
    const { html } = await page(id);
    expect(html).not.toContain('event-countdown');
    expect(whenBlock(html)).toMatch(/data-testid="event-when">[^<]*CDT<\/p>$/);
  });
});
