/**
 * OSE-475 — the TV board (/display) and the public event page agree on an
 * event's phase (pre_event → event → post_event), at every moment, because
 * both read the ONE canonical resolver (lib/event-enrich.ts eventPhaseOf →
 * domain/event-phase.ts computeEventPhase over lib/event-datetime.ts
 * phaseTimesFor).
 *
 * The display reads phase from two payloads:
 *   - GET /api/v2/events (every 5 minutes): `items[].phase`, which picks the
 *     featured event, its "Happening now" / "Coming up" label, and drops a
 *     wrapped event;
 *   - GET /api/v2/events/:id/display-config (every minute, ETag/304): `phase`
 *     for the featured event, so a crossing repaints on the minute check.
 * The public page /events/:id renders one of three bodies by phase, each with
 * its own "when" line (event-when / event-when-live / event-when-post).
 *
 * The expected phase is DERIVED from the resolver for each fixture and moment,
 * never restated here, and the moments are derived from the fixture's own
 * phase boundaries (phaseTimesFor), so a timed event, a date-only event, a
 * multi-day event, a legacy ISO-dated event and a start-only event are each
 * read just before, at, and just after their pivots.
 *
 * Time is moved with fake Date timers (as qr-scan.spec.ts does); the worker
 * runs in this isolate, so the handlers read the same mocked clock.
 */

import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { computeEventPhase, type EventPhase } from '../src/domain/event-phase';
import { phaseTimesFor } from '../src/lib/event-datetime';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const BRAND = 'ose475-display-parity';
const HEADERS = { 'CF-Connecting-IP': '198.51.100.75' };

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

interface Fixture {
  id: string;
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  timezone: string | null;
}

// Every shape of dated event the platform stores (OSE-1313): a time + zone
// with a date-only end, a time with no end, a date-only day, a date-only
// multi-day run, and legacy full-ISO start/end with no zone.
const FIXTURES: Fixture[] = [
  {
    id: 'evt_ose475_timed_end',
    start_date: '2026-11-06',
    end_date: '2026-11-06',
    starts_at: '2026-11-07T00:00:00Z', // 18:00 CST
    timezone: 'America/Chicago',
  },
  {
    id: 'evt_ose475_timed_open',
    start_date: '2026-11-06',
    end_date: null,
    starts_at: '2026-11-07T00:00:00Z',
    timezone: 'America/Chicago',
  },
  {
    id: 'evt_ose475_date_only',
    start_date: '2026-11-06',
    end_date: null,
    starts_at: null,
    timezone: 'America/Chicago',
  },
  {
    id: 'evt_ose475_multi_day',
    start_date: '2026-11-06',
    end_date: '2026-11-08',
    starts_at: null,
    timezone: 'America/New_York',
  },
  {
    id: 'evt_ose475_legacy_iso',
    start_date: '2026-11-06T18:00:00Z',
    end_date: '2026-11-06T21:00:00Z',
    starts_at: null,
    timezone: null,
  },
];

/** The canonical answer: the resolver itself, over the fixture's own row. */
function expected(f: Fixture, at: Date): EventPhase {
  return computeEventPhase({ status: 'active', ...phaseTimesFor(f) }, at);
}

/** Before, at, and after each pivot the resolver itself reports for the row. */
function moments(f: Fixture): Date[] {
  const { start_date, end_date } = phaseTimesFor(f);
  const out: Date[] = [];
  const s = start_date ? new Date(start_date).getTime() : NaN;
  const e = end_date ? new Date(end_date).getTime() : NaN;
  if (!Number.isNaN(s)) {
    out.push(new Date(s - 7 * 86_400_000), new Date(s - 1000), new Date(s), new Date(s + 1000));
  }
  if (!Number.isNaN(e)) {
    out.push(new Date(e - 1000), new Date(e), new Date(e + 1000), new Date(e + 7 * 86_400_000));
  } else if (!Number.isNaN(s)) {
    out.push(new Date(s + 30 * 86_400_000));
  }
  return out;
}

const PAGE_PHASE: Record<string, EventPhase> = {
  'event-when': 'pre_event',
  'event-when-live': 'event',
  'event-when-post': 'post_event',
};

async function readSurfaces(id: string) {
  const list = (await (
    await SELF.fetch(`https://t.test/api/v2/events?brand=${BRAND}`, { headers: HEADERS })
  ).json()) as { items: Array<{ id: string; phase: EventPhase }> };
  const cfgRes = await SELF.fetch(`https://t.test/api/v2/events/${id}/display-config`, {
    headers: HEADERS,
  });
  expect(cfgRes.status).toBe(200);
  const cfg = (await cfgRes.json()) as { phase?: EventPhase };
  const html = await (await SELF.fetch(`https://t.test/events/${id}`, { headers: HEADERS })).text();
  const markers = [...html.matchAll(/data-testid="(event-when(?:-live|-post)?)"/g)].map(
    (m) => m[1]
  );
  // Exactly one body was rendered, so exactly one "when" line.
  expect(new Set(markers).size, `one phase body on /events/${id}`).toBe(1);
  return {
    list: list.items.find((i) => i.id === id)?.phase,
    config: cfg.phase,
    page: PAGE_PHASE[markers[0]],
  };
}

beforeAll(async () => {
  await applyMigrations(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  await tenv().DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  for (const f of FIXTURES) {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                             start_date, end_date, timezone, starts_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, 'Eagles Hall', ?, ?, ?, ?,
                   datetime('now'), datetime('now'))`
      )
      .bind(f.id, BRAND, `Parity ${f.id}`, f.id, f.start_date, f.end_date, f.timezone, f.starts_at)
      .run();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OSE-475: the TV board and the public page agree on phase', () => {
  test('the fixtures exercise every phase, so parity is not vacuous', () => {
    const seen = new Set(FIXTURES.flatMap((f) => moments(f).map((m) => expected(f, m))));
    expect([...seen].sort()).toEqual(['event', 'post_event', 'pre_event']);
  });

  for (const f of FIXTURES) {
    test(`${f.id}: list, display-config and /events/:id match the resolver at every pivot`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      for (const at of moments(f)) {
        vi.setSystemTime(at);
        const want = expected(f, at);
        const got = await readSurfaces(f.id);
        expect(got, `${f.id} at ${at.toISOString()}`).toEqual({
          list: want,
          config: want,
          page: want,
        });
      }
    });
  }
});

describe('OSE-475: a phase crossing reaches the TV through its minute check', () => {
  const f = FIXTURES[0];
  const { start_date, end_date } = phaseTimesFor(f);
  const start = new Date(start_date as string).getTime();
  const end = new Date(end_date as string).getTime();

  async function check(at: number, etag?: string) {
    vi.setSystemTime(new Date(at));
    return SELF.fetch(`https://t.test/api/v2/events/${f.id}/display-config`, {
      headers: { ...HEADERS, ...(etag ? { 'If-None-Match': etag } : {}) },
    });
  }

  test('pre → live → post: each crossing is a new body and a new ETag, never a 304', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    const pre = await check(start - 60_000);
    expect(pre.status).toBe(200);
    expect(((await pre.json()) as { phase?: string }).phase).toBe('pre_event');
    const preTag = pre.headers.get('ETag') as string;
    expect(preTag).toBeTruthy();
    // Nothing crossed yet: the TV's next check is still the cheap 304.
    expect((await check(start - 1000, preTag)).status).toBe(304);

    // The start passes between two checks: the old ETag must not hide it.
    const live = await check(start + 1000, preTag);
    expect(live.status).toBe(200);
    expect(((await live.json()) as { phase?: string }).phase).toBe('event');
    const liveTag = live.headers.get('ETag') as string;
    expect(liveTag).not.toBe(preTag);
    expect((await check(start + 60_000, liveTag)).status).toBe(304);

    // And the end.
    const post = await check(end + 1000, liveTag);
    expect(post.status).toBe(200);
    expect(((await post.json()) as { phase?: string }).phase).toBe('post_event');
    const postTag = post.headers.get('ETag') as string;
    expect(postTag).not.toBe(liveTag);
    expect(postTag).not.toBe(preTag);
  });

  test('the admin TV card read is unchanged: no phase, and its ETag does not move with time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ADMIN = { ...HEADERS, Authorization: 'Bearer test-admin-key-e2e-2026' };
    const read = async (at: number) => {
      vi.setSystemTime(new Date(at));
      return SELF.fetch(`https://t.test/api/v2/admin/events/${f.id}/display-config`, {
        headers: ADMIN,
      });
    };
    const a = await read(start - 60_000);
    const b = await read(end + 60_000);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get('ETag')).toBe(b.headers.get('ETag'));
    expect((await a.json()) as Record<string, unknown>).not.toHaveProperty('phase');
  });
});
