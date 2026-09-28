import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const BRAND = 'ose1358-test';

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

async function seedEvent(opts: {
  id: string;
  status?: string;
  isPublished?: number;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  startsAt?: string | null;
  title?: string;
  description?: string;
}): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(`DELETE FROM shortlinks WHERE event_id = ?`).bind(opts.id).run();
  await tenv.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(opts.id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, description,
                         start_date, end_date, timezone, starts_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(
      opts.id,
      BRAND,
      opts.title ?? 'Calendar, commas; and details',
      opts.id,
      opts.status ?? 'active',
      opts.isPublished ?? 1,
      'Eagles Bowl',
      opts.description ?? 'Bring friends.',
      opts.startDate ?? '2026-12-02T02:00:00.000Z',
      opts.endDate ?? '2026-12-02T04:00:00.000Z',
      opts.timezone ?? 'America/Chicago',
      opts.startsAt ?? null
    )
    .run();
}

async function seedShortlink(eventId: string, code = 'AbC123', clicks = 0): Promise<void> {
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare(
    `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
       VALUES (?, ?, 'public', ?, datetime('now'))`
  )
    .bind(code, eventId, clicks)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-1358 public event calendar action', () => {
  test('public event page renders Add to calendar beside Share', async () => {
    const eventId = 'evt_ose1358_page_action';
    await seedEvent({ id: eventId });

    const res = await SELF.fetch(`https://t.test/events/${eventId}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('data-testid="event-actions"');
    expect(html).toContain('data-testid="share-btn"');
    expect(html).toContain('data-testid="add-to-calendar"');
    expect(html).toContain(`href="/events/${eventId}/calendar.ics"`);
  });
});

describe('OSE-1358 public event calendar download', () => {
  test('server-generates an ICS in the event timezone with the public shortlink', async () => {
    const eventId = 'evt_ose1358_calendar_ics';
    await seedEvent({ id: eventId });
    await seedShortlink(eventId);

    const res = await SELF.fetch(`https://t.test/events/${eventId}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    expect(res.headers.get('Content-Disposition')).toContain('.ics');
    expect(res.headers.get('Set-Cookie')).toBeNull();

    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('DTSTART;TZID=America/Chicago:20261201T200000');
    expect(body).toContain('DTEND;TZID=America/Chicago:20261201T220000');
    expect(body).toContain('SUMMARY:Calendar\\, commas\\; and details');
    expect(body).toContain('DESCRIPTION:Bring friends.\\n\\nhttps://t.test/s/AbC123');
    expect(body).toContain('URL:https://t.test/s/AbC123');
    expect(body).not.toContain(eventId);
    expect(body).not.toContain('/q/');
    expect(body).not.toContain('utm_');
    expect(body).not.toContain('anon');
    expect(body).not.toContain('cookie');
    expect(body).not.toContain('session');
  });

  test('calendar download follows public gating for draft, ready, and unpublished events', async () => {
    const cases = [
      { id: 'evt_ose1358_draft', status: 'draft', isPublished: 1 },
      { id: 'evt_ose1358_ready', status: 'ready', isPublished: 1 },
      { id: 'evt_ose1358_unpublished', status: 'active', isPublished: 0 },
    ];

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      await seedEvent({ id: c.id, status: c.status, isPublished: c.isPublished });
      await seedShortlink(c.id, `Gate${i}A`);
      const res = await SELF.fetch(`https://t.test/events/${c.id}/calendar.ics`);
      expect(res.status).toBe(404);
    }
  });

  test('calendar download requires an existing public shortlink and does not mutate click counts', async () => {
    const missingEventId = 'evt_ose1358_no_shortlink';
    await seedEvent({ id: missingEventId });
    const missing = await SELF.fetch(`https://t.test/events/${missingEventId}/calendar.ics`);
    expect(missing.status).toBe(409);
    expect(await missing.text()).toContain('PUBLIC_SHORTLINK_MISSING');

    const eventId = 'evt_ose1358_no_mutation';
    await seedEvent({ id: eventId });
    await seedShortlink(eventId, 'NoMut8', 0);
    const res = await SELF.fetch(`https://t.test/events/${eventId}/calendar.ics`);
    expect(res.status).toBe(200);

    const row = await (env as unknown as TestEnv).DB.prepare(
      `SELECT clicks FROM shortlinks WHERE code = ?`
    )
      .bind('NoMut8')
      .first<{ clicks: number }>();
    expect(row?.clicks).toBe(0);
  });
});

describe('OSE-1313 calendar prefers the canonical UTC start instant', () => {
  test('a timed event (starts_at) anchors DTSTART at its wall time in the event zone, not UTC midnight', async () => {
    const eventId = 'evt_ose1313_calendar_starts_at';
    // Date-only start_date + 18:30 in Chicago (CDT, UTC-5) → 23:30Z.
    await seedEvent({
      id: eventId,
      startDate: '2026-10-24',
      endDate: '2026-10-24',
      timezone: 'America/Chicago',
      startsAt: '2026-10-24T23:30:00Z',
    });
    await seedShortlink(eventId, 'Tz13A1');

    const res = await SELF.fetch(`https://t.test/events/${eventId}/calendar.ics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('DTSTART;TZID=America/Chicago:20261024T183000');
    // A date-only end_date lands before the timed start → one-hour default, never a negative span.
    expect(body).toContain('DTEND;TZID=America/Chicago:20261024T193000');
  });

  test('a date-only event (no starts_at) keeps the prior start_date behaviour', async () => {
    const eventId = 'evt_ose1313_calendar_date_only';
    await seedEvent({ id: eventId, startsAt: null });
    await seedShortlink(eventId, 'Tz13B1');

    const res = await SELF.fetch(`https://t.test/events/${eventId}/calendar.ics`);
    const body = await res.text();
    expect(body).toContain('DTSTART;TZID=America/Chicago:20261201T200000');
  });
});
