/**
 * OSE-1313 — event start date + time + timezone → canonical UTC `starts_at`,
 * through the deployed handlers (workers pool).
 *
 * The pure zone/DST math is covered by `event-datetime.spec.ts` (node pool).
 * This spec proves the wiring: create + update store the right instant, bad
 * input is refused (400) rather than silently stored, `starts_at` is always
 * server-computed, and the public surfaces (JSON projection + event page)
 * render the EVENT's zone — never the viewer's.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { handleAdminPage } from '../src/handlers/pages';
import { handleUpdateEvent } from '../src/handlers/events';

const ADMIN_HEADERS = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'ose1313-test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

interface ApiResponse {
  ok: boolean;
  id?: string;
  code?: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Idempotency-safe re-runs only; a missing column is real schema drift
      // and must fail this suite loudly (PR #657 review).
      if (msg.includes('duplicate column name') || msg.includes('already exists')) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

async function createEvent(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      brand_id: BRAND,
      ...body,
    }),
  });
}

async function updateEvent(id: string, body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`https://t.test/api/v2/admin/events/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
    body: JSON.stringify(body),
  });
}

async function readRow(
  id: string
): Promise<{ start_date: string | null; timezone: string | null; starts_at: string | null }> {
  const tenv = env as unknown as TestEnv;
  const row = await tenv.DB.prepare(
    'SELECT start_date, timezone, starts_at FROM events WHERE id = ?'
  )
    .bind(id)
    .first<{ start_date: string | null; timezone: string | null; starts_at: string | null }>();
  return row!;
}

async function createTimed(
  title: string,
  date: string,
  time: string,
  timezone: string
): Promise<string> {
  const res = await createEvent({ title, start_date: date, start_time: time, timezone });
  expect(res.status).toBe(201);
  const body = (await res.json()) as ApiResponse;
  return body.id as string;
}

describe('OSE-1313 create path stores the UTC instant', () => {
  test.each([
    ['America/Chicago', '2026-10-24', '18:00', '2026-10-24T23:00:00Z'],
    ['America/Phoenix', '2026-07-04', '20:00', '2026-07-05T03:00:00Z'], // no DST, crosses UTC day
    ['Europe/London', '2026-12-31', '23:30', '2026-12-31T23:30:00Z'],
    ['Asia/Kolkata', '2026-10-24', '09:15', '2026-10-24T03:45:00Z'], // half-hour offset
  ])('%s %s %s → %s', async (tz, date, time, expected) => {
    const id = await createTimed(`OSE-1313 create ${tz}`, date, time, tz);
    const row = await readRow(id);
    expect(row.starts_at).toBe(expected);
    expect(row.timezone).toBe(tz);
  });

  test('date-only create leaves starts_at NULL (prior behaviour)', async () => {
    const res = await createEvent({ title: 'OSE-1313 date only', start_date: '2026-10-24' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as ApiResponse;
    expect((await readRow(id!)).starts_at).toBeNull();
  });

  test('a client-supplied starts_at is ignored — the instant is server-computed', async () => {
    const res = await createEvent({
      title: 'OSE-1313 spoofed instant',
      start_date: '2026-10-24',
      start_time: '18:00',
      timezone: 'America/Chicago',
      starts_at: '1999-01-01T00:00:00Z',
    });
    const { id } = (await res.json()) as ApiResponse;
    expect((await readRow(id!)).starts_at).toBe('2026-10-24T23:00:00Z');
  });

  test.each([
    [
      { start_date: '2026-10-24', start_time: '18:00', timezone: 'America/Chicagoo' },
      'INVALID_TIMEZONE',
    ],
    [{ start_date: '2026-10-24', start_time: '6pm' }, 'INVALID_TIME'],
    [{ start_time: '18:00' }, 'INVALID_TIME'],
    // PR #657 review: validated whole, not sliced to 5 chars first.
    [{ start_date: '2026-10-24', start_time: '18:00garbage' }, 'INVALID_TIME'],
    // PR #657 review: JS normalizes impossible days (2026-02-31 → March 3);
    // they are refused, dated or timed, rather than stored.
    [{ start_date: '2026-02-31' }, 'INVALID_DATE'],
    // A non-string time is refused, not silently treated as absent (PR #657 review).
    [{ start_date: '2026-10-24', start_time: 1800 }, 'INVALID_TIME'],
    [{ start_date: '2026-04-31', start_time: '18:00' }, 'INVALID_DATE'],
  ])('refuses %j with 400 %s', async (fields, code) => {
    const res = await createEvent({ title: 'OSE-1313 bad', ...fields });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiResponse).code).toBe(code);
  });
});

describe('OSE-1313 update path recomputes starts_at', () => {
  test('changing the time moves the instant', async () => {
    const id = await createTimed('OSE-1313 upd time', '2026-10-24', '18:00', 'America/Chicago');
    const res = await updateEvent(id, { start_time: '19:30' });
    expect(res.status).toBe(200);
    expect((await readRow(id)).starts_at).toBe('2026-10-25T00:30:00Z');
  });

  test('changing only the date keeps the wall time (tracks the new date, across DST)', async () => {
    // 18:00 CDT (UTC-5) → move to a CST date (UTC-6): wall time stays 18:00.
    const id = await createTimed('OSE-1313 upd date', '2026-10-24', '18:00', 'America/Chicago');
    await updateEvent(id, { start_date: '2026-11-14' });
    const row = await readRow(id);
    expect(row.start_date).toBe('2026-11-14');
    expect(row.starts_at).toBe('2026-11-15T00:00:00Z');
  });

  test('changing only the zone keeps the wall time in the new zone', async () => {
    const id = await createTimed('OSE-1313 upd zone', '2026-10-24', '18:00', 'America/Chicago');
    await updateEvent(id, { timezone: 'America/New_York' });
    expect((await readRow(id)).starts_at).toBe('2026-10-24T22:00:00Z');
  });

  test('clearing start_time makes it a date-only event again', async () => {
    const id = await createTimed('OSE-1313 upd clear', '2026-10-24', '18:00', 'America/Chicago');
    await updateEvent(id, { start_time: null });
    const row = await readRow(id);
    expect(row.starts_at).toBeNull();
    expect(row.start_date).toBe('2026-10-24');
  });

  test('adding a time to a date-only event', async () => {
    const res = await createEvent({ title: 'OSE-1313 upd add', start_date: '2026-03-08' });
    const { id } = (await res.json()) as ApiResponse;
    // Spring-forward day in Chicago: 14:00 is CDT (UTC-5).
    await updateEvent(id!, { start_time: '14:00' });
    expect((await readRow(id!)).starts_at).toBe('2026-03-08T19:00:00Z');
  });

  test('a field-only update leaves starts_at untouched', async () => {
    const id = await createTimed('OSE-1313 upd other', '2026-10-24', '18:00', 'America/Chicago');
    await updateEvent(id, { title: 'renamed' });
    expect((await readRow(id)).starts_at).toBe('2026-10-24T23:00:00Z');
  });

  test.each([
    [{ timezone: 'Not/AZone' }, 'INVALID_TIMEZONE'],
    [{ start_time: '24:00' }, 'INVALID_TIME'],
    [{ start_time: 1800 }, 'INVALID_TIME'],
    // PR #657 review: the zone cannot be cleared (would render every surface in UTC),
    // and a time is validated whole rather than truncated to HH:MM.
    [{ timezone: null }, 'INVALID_TIMEZONE'],
    [{ start_time: '19:30garbage' }, 'INVALID_TIME'],
    [{ start_date: '2026-02-30' }, 'INVALID_DATE'],
  ])('refuses %j with 400 %s and stores nothing', async (fields, code) => {
    const id = await createTimed(
      `OSE-1313 upd bad ${code} ${JSON.stringify(fields)}`,
      '2026-10-24',
      '18:00',
      'America/Chicago'
    );
    const res = await updateEvent(id, fields);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiResponse).code).toBe(code);
    const row = await readRow(id);
    expect(row.starts_at).toBe('2026-10-24T23:00:00Z');
    expect(row.timezone).toBe('America/Chicago');
  });
});

describe('OSE-1313 public surfaces render the event zone', () => {
  async function seedPublic(id: string, startsAt: string | null, tz: string): Promise<void> {
    const tenv = env as unknown as TestEnv;
    await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, timezone, starts_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, 'Eagles Bowl', ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, BRAND, 'OSE-1313 public', id, '2099-10-24', tz, startsAt)
      .run();
  }

  test('event page shows the event-zone time with its abbreviation (viewer zone is irrelevant)', async () => {
    const id = 'evt_ose1313_page_timed';
    // 18:00 in Chicago on 2099-10-24 (CDT).
    await seedPublic(id, '2099-10-24T23:00:00Z', 'America/Chicago');
    const res = await SELF.fetch(`https://t.test/events/${id}`, {
      // A viewer in Tokyo: nothing about the request can move the rendered zone.
      headers: { 'Accept-Language': 'ja-JP', 'CF-Timezone': 'Asia/Tokyo' },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    const when = html.match(/data-testid="event-when">([^<]*)</)?.[1] ?? '';
    expect(when).toContain('October 24, 2099');
    expect(when).toContain('6:00');
    expect(when).toContain('PM');
    expect(when).toContain('CDT');
    expect(when).not.toContain('JST');
  });

  test('date-only event page keeps the date · zone shape', async () => {
    const id = 'evt_ose1313_page_date_only';
    await seedPublic(id, null, 'America/Chicago');
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const when = html.match(/data-testid="event-when">([^<]*)</)?.[1] ?? '';
    expect(when).toContain('October 24, 2099');
    // OSE-1518: the zone reads as a name, not the IANA id.
    expect(when).toContain('Central Time');
    expect(when).not.toContain('America/Chicago');
  });

  test('public JSON projection carries starts_at', async () => {
    const id = 'evt_ose1313_json';
    await seedPublic(id, '2099-10-24T23:00:00Z', 'America/Chicago');
    const res = await SELF.fetch(`https://t.test/api/v2/events/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(body.item.starts_at).toBe('2099-10-24T23:00:00Z');
    expect(body.item.timezone).toBe('America/Chicago');
  });
});

describe('OSE-1313 admin create paths collect time + event zone', () => {
  const html = () => handleAdminPage({} as never).text();

  test.each([
    ['wizard', 'wizard-event-date', 'wizard-event-time', 'wizard-event-tz'],
    ['advanced form', 'create-date', 'create-time', 'create-tz'],
  ])('%s: date, then a time input, then a curated IANA zone select', async (_p, d, t, z) => {
    const h = await html();
    const di = h.indexOf(`id="${d}"`);
    const ti = h.indexOf(`id="${t}"`);
    const zi = h.indexOf(`id="${z}"`);
    expect(di).toBeGreaterThan(-1);
    expect(ti).toBeGreaterThan(di);
    expect(zi).toBeGreaterThan(ti);
    expect(h).toMatch(new RegExp(`<input[^>]*type="time"[^>]*id="${t}"`));
    // A select (not free text), defaulting to the founding node's zone, and
    // carrying every zone in the ticket's test matrix.
    const select = h.slice(zi, h.indexOf('</select>', zi));
    expect(select).toContain('value="America/Chicago" selected');
    for (const zone of [
      'America/New_York',
      'America/Phoenix',
      'Pacific/Honolulu',
      'Europe/London',
      'Africa/Nairobi',
      'America/Argentina/Buenos_Aires',
      'Asia/Kolkata',
    ]) {
      expect(select).toContain(`value="${zone}"`);
    }
  });

  test('both paths submit start_time + timezone', async () => {
    const h = await html();
    expect(h).toContain('if (timeVal) body.start_time = timeVal;');
    expect(h).toContain('if (timeVal && dateVal) body.start_time = timeVal;');
    expect(h).toContain('if (tzVal) body.timezone = tzVal;');
    expect(h).toContain('if (tzSel && tzSel.value) body.timezone = tzSel.value;');
  });

  test('wizard summary renders the server instant in the EVENT zone', async () => {
    const h = await html();
    expect(h).toMatch(/timeZone: data\.timezone \|\| tzVal \|\| 'UTC'/);
    expect(h).toContain('new Date(data.starts_at)');
  });
});

describe('OSE-1313 poster + display render the event zone, never the viewer zone', () => {
  test.each([
    ['/poster', 'fmtEventTime'],
    ['/display', 'fmt'],
  ])('%s formats starts_at in ev.timezone and pins date-only dates via UTC', async (path) => {
    const res = await SELF.fetch(`https://t.test${path}`);
    expect(res.status).toBe(200);
    const h = await res.text();
    expect(h).toContain('inZone(ev.starts_at, ev.timezone');
    expect(h).toContain("inZone(d + 'T00:00:00Z', 'UTC'");
    // A dirty date renders nothing instead of throwing twice (PR #657 review).
    expect(h).toContain('if (isNaN(d.getTime())) return');
    // The viewer-zone formatters that produced the off-by-one / invented time are gone.
    expect(h).not.toMatch(/new Date\(iso\)\.toLocale(Date|Time)String/);
  });
});

describe('OSE-1313 phase pivots at the timed start, not UTC midnight of the date', () => {
  const tenv = () => env as unknown as TestEnv;

  function localParts(instant: Date, tz: string): { date: string; hour: number } {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const m: Record<string, string> = {};
    for (const x of p) if (x.type !== 'literal') m[x.type] = x.value;
    return { date: `${m.year}-${m.month}-${m.day}`, hour: Number(m.hour) };
  }

  // A zone where "now" is mid-day, so now±3h stays on the same local date —
  // keeps the assertions independent of when CI happens to run.
  function midDayZone(now: Date): string {
    for (const tz of ['America/Chicago', 'Europe/London', 'Asia/Tokyo', 'Pacific/Honolulu']) {
      const h = localParts(now, tz).hour;
      if (h >= 4 && h <= 19) return tz;
    }
    throw new Error('no mid-day zone found');
  }

  async function seed(
    id: string,
    startsAt: string,
    tz: string,
    startDate: string,
    endDate: string | null
  ): Promise<void> {
    await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                             start_date, end_date, timezone, starts_at, created_at, updated_at)
           VALUES (?, ?, 'OSE-1313 phase', ?, 'active', 1, 'Eagles Bowl', ?, ?, ?, ?,
                   datetime('now'), datetime('now'))`
      )
      .bind(id, BRAND, id, startDate, endDate, tz, startsAt)
      .run();
  }

  test('today, starting in 3h → still pre-event on the page and in the API', async () => {
    const now = new Date();
    const tz = midDayZone(now);
    const startsAt = new Date(now.getTime() + 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const day = localParts(now, tz).date;
    const id = 'evt_ose1313_phase_pre';
    await seed(id, startsAt, tz, day, day);

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).not.toContain('data-testid="event-live-badge"');
    expect(html).not.toContain('data-testid="event-phase-chip"');

    const api = (await (await SELF.fetch(`https://t.test/api/v2/events/${id}`)).json()) as {
      item: { phase: string };
    };
    expect(api.item.phase).toBe('pre_event');
  });

  test('started 1h ago with a same-day date-only end → live, not already a recap', async () => {
    const now = new Date();
    const tz = midDayZone(now);
    const startsAt = new Date(now.getTime() - 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const day = localParts(now, tz).date;
    const id = 'evt_ose1313_phase_live';
    await seed(id, startsAt, tz, day, day);

    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    expect(html).toContain('data-testid="event-live-badge"');
    // The scheduled time stays visible on the live page, in the event zone.
    const when = html.match(/data-testid="event-when-live">([^<]*)</)?.[1] ?? '';
    expect(when).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  test('post-event recap keeps the entered time in the event zone', async () => {
    const id = 'evt_ose1313_phase_post';
    // 18:00 Chicago (CDT) on 2020-10-24 → long past.
    await seed(id, '2020-10-24T23:00:00Z', 'America/Chicago', '2020-10-24', '2020-10-24');
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const when = html.match(/data-testid="event-when-post">([^<]*)</)?.[1] ?? '';
    expect(when).toContain('October 24, 2020');
    expect(when).toContain('6:00');
    expect(when).toContain('CDT');
  });

  test('a spring-forward gap time is refused with 400 INVALID_TIME', async () => {
    const res = await createEvent({
      title: 'OSE-1313 dst gap',
      start_date: '2026-03-08',
      start_time: '02:30',
      timezone: 'America/New_York',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiResponse).code).toBe('INVALID_TIME');
  });
});

describe('OSE-1313 real calendar dates still pass the round-trip check', () => {
  test('a leap day is accepted and timed correctly', async () => {
    const id = await createTimed('OSE-1313 leap day', '2028-02-29', '18:00', 'America/Chicago');
    const row = await readRow(id);
    expect(row.start_date).toBe('2028-02-29');
    expect(row.starts_at).toBe('2028-03-01T00:00:00Z'); // 18:00 CST = 00:00Z next day
  });
});

describe('OSE-1313 update is guarded against a concurrent time edit (PR #657 review)', () => {
  // A fake D1 that plays the race deterministically: the handler reads the
  // row, then another edit lands before its UPDATE, so the guarded UPDATE
  // matches nothing while the row still exists.
  function racingDb(log: { sql: string; args: unknown[] }[]): D1Database {
    return {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            log.push({ sql, args });
            return {
              async first() {
                if (sql.startsWith('SELECT start_date, timezone, starts_at')) {
                  return {
                    start_date: '2026-10-24',
                    timezone: 'America/Chicago',
                    starts_at: '2026-10-24T23:00:00Z',
                  };
                }
                if (sql.startsWith('SELECT id FROM events')) return { id: args[0] };
                return null;
              },
              async run() {
                return { meta: { changes: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
  }

  test('a stale read yields 409 EVENT_TIME_CONFLICT, never a mismatched write', async () => {
    const log: { sql: string; args: unknown[] }[] = [];
    const res = await handleUpdateEvent(
      new Request('https://t.test/api/v2/admin/events/evt_race', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: '19:30' }),
      }),
      { DB: racingDb(log) } as never,
      'evt_race'
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiResponse).code).toBe('EVENT_TIME_CONFLICT');

    const update = log.find((l) => l.sql.startsWith('UPDATE events SET'));
    expect(update?.sql).toContain('AND start_date IS ? AND timezone IS ? AND starts_at IS ?');
    // Guard binds are the values the recompute was based on.
    expect(update?.args.slice(-3)).toEqual([
      '2026-10-24',
      'America/Chicago',
      '2026-10-24T23:00:00Z',
    ]);
  });

  test('an update that does not touch the time is not guarded', async () => {
    const id = await createTimed('OSE-1313 unguarded', '2026-10-24', '18:00', 'America/Chicago');
    const res = await updateEvent(id, { title: 'renamed again' });
    expect(res.status).toBe(200);
  });
});

describe('OSE-1313 OpenGraph end never precedes the timed start (PR #657 review)', () => {
  test('same-day timed event: og:event:end_time is after og:event:start_time', async () => {
    const tenv = env as unknown as TestEnv;
    const id = 'evt_ose1313_og_order';
    await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, end_date, timezone, starts_at, created_at, updated_at)
         VALUES (?, ?, 'OSE-1313 og', ?, 'active', 1, 'Eagles Bowl', '2099-10-24', '2099-10-24',
                 'America/Chicago', '2099-10-24T23:00:00Z', datetime('now'), datetime('now'))`
    )
      .bind(id, BRAND, id)
      .run();
    const html = await (await SELF.fetch(`https://t.test/events/${id}`)).text();
    const start = html.match(/og:event:start_time" content="([^"]+)"/)?.[1] ?? '';
    const end = html.match(/og:event:end_time" content="([^"]+)"/)?.[1] ?? '';
    expect(start).toBe('2099-10-24T23:00:00Z');
    expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
  });
});

describe('OSE-1313 same-day events are listed in start-time order (PR #657 review)', () => {
  test('the list orders by start_date, then starts_at', async () => {
    const tenv = env as unknown as TestEnv;
    const brand = 'ose1313order';
    await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(brand).run();
    // Inserted late-first so insertion order can't make the test pass.
    for (const [id, startsAt] of [
      ['evt_ose1313_order_late', '2099-10-24T23:00:00Z'],
      ['evt_ose1313_order_early', '2099-10-24T15:00:00Z'],
    ]) {
      await tenv.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                             start_date, timezone, starts_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, 'Eagles Bowl', '2099-10-24', 'America/Chicago', ?,
                   datetime('now'), datetime('now'))`
      )
        .bind(id, brand, id, id, startsAt)
        .run();
    }
    const res = await SELF.fetch(`https://t.test/api/v2/events?brand=${brand}`);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toEqual([
      'evt_ose1313_order_early',
      'evt_ose1313_order_late',
    ]);
  });
});
