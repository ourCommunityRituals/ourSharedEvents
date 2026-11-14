/**
 * OSE-2013 — GET /brands/:brand/calendar.ics, a brand's public events as one feed.
 *
 * The four checks marked BORN RED were each watched failing on an injected
 * fault before they were trusted (the faults are listed in the pull request):
 *   1. another brand's event never appears;
 *   2. a draft is left out;
 *   3. no field outside the public projection is in the feed;
 *   4. no cookie is set.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { PUBLIC_EVENT_COLUMNS } from '../src/lib/public-event-projection';
import { PUBLIC_READ_MAX } from '../src/lib/public-read-limit';
import { EDGE_WINDOW_SECONDS } from '../src/lib/edge-rate-limit';
import { rateLimitKvKey } from '../src/lib/rate-limit';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_KEY_PEPPER?: string;
}

const tenv = (): TestEnv => env as unknown as TestEnv;

const BRAND = 'ose2013-feed-a';
const OTHER_BRAND = 'ose2013-feed-b';
const DRAFT_ONLY_BRAND = 'ose2013-drafts-only';
const ORIGIN = 'https://t.test';

const feedUrl = (brand: string): string => `${ORIGIN}/brands/${brand}/calendar.ics`;

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
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
  brand?: string;
  status?: string;
  isPublished?: number;
  title?: string;
  slug?: string;
  description?: string;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startsAt?: string | null;
  listedFrom?: string | null;
}): Promise<void> {
  await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(opts.id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, description,
                           start_date, end_date, timezone, starts_at, listed_from,
                           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'America/Chicago', ?, ?,
                 '2026-11-01 10:00:00', '2026-11-02 12:30:00')`
    )
    .bind(
      opts.id,
      opts.brand ?? BRAND,
      opts.title ?? `Title of ${opts.id}`,
      opts.slug ?? opts.id.replace(/_/g, '-'),
      opts.status ?? 'active',
      opts.isPublished ?? 1,
      opts.location === undefined ? 'Eagles Bowl' : opts.location,
      opts.description ?? 'Bring friends.',
      opts.startDate === undefined ? '2026-12-02T02:00:00.000Z' : opts.startDate,
      opts.endDate === undefined ? '2026-12-02T04:00:00.000Z' : opts.endDate,
      opts.startsAt ?? null,
      opts.listedFrom ?? null
    )
    .run();
}

/** The feed with its folded lines joined again (RFC 5545 §3.1). */
function unfold(body: string): string {
  return body.replace(/\r\n /g, '');
}

/** Each VEVENT as its list of unfolded lines. */
function entries(body: string): string[][] {
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const line of unfold(body).split('\r\n')) {
    if (line === 'BEGIN:VEVENT') current = [];
    else if (line === 'END:VEVENT') {
      if (current) out.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  return out;
}

async function getFeed(brand: string): Promise<{ res: Response; body: string }> {
  const res = await SELF.fetch(feedUrl(brand));
  return { res, body: unfold(await res.text()) };
}

beforeAll(async () => {
  await applyMigrations();
  await tenv()
    .DB.prepare(`DELETE FROM events WHERE brand_id IN (?, ?, ?)`)
    .bind(BRAND, OTHER_BRAND, DRAFT_ONLY_BRAND)
    .run();
  // The brand under test: two public events, and one of every kind that must stay out.
  await seedEvent({ id: 'evt_2013_a_first', title: 'First, with commas; and more' });
  await seedEvent({
    id: 'evt_2013_a_second',
    startDate: '2026-12-10',
    endDate: '2026-12-10',
    startsAt: '2026-12-11T00:30:00Z',
  });
  await seedEvent({ id: 'evt_2013_a_draft', status: 'draft', title: 'DRAFT-NEVER-PUBLIC' });
  await seedEvent({ id: 'evt_2013_a_ready', status: 'ready', title: 'READY-NEVER-PUBLIC' });
  await seedEvent({ id: 'evt_2013_a_archived', status: 'archived', title: 'ARCHIVED-NOT-LISTED' });
  await seedEvent({ id: 'evt_2013_a_offmap', isPublished: 0, title: 'OFFMAP-NOT-LISTED' });
  await seedEvent({
    id: 'evt_2013_a_grace',
    title: 'GRACE-NOT-LISTED-YET',
    listedFrom: '2099-01-01T00:00:00.000Z',
  });
  // Another brand, with its own public event.
  await seedEvent({ id: 'evt_2013_b_only', brand: OTHER_BRAND, title: 'OTHER-BRAND-EVENT' });
  // A brand that has nothing public.
  await seedEvent({ id: 'evt_2013_c_draft', brand: DRAFT_ONLY_BRAND, status: 'draft' });
});

describe('OSE-2013 brand calendar feed: what it returns', () => {
  test('a known brand gets one calendar with an entry per public event', async () => {
    const { res, body } = await getFeed(BRAND);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="${BRAND}-events.ics"`);

    expect(body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(body.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(body).toContain(`X-WR-CALNAME:OurSharedEvents: ${BRAND}`);
    expect(entries(body)).toHaveLength(2);
  });

  test('an entry is written by the per-event writer: zone, escaping, description and link', async () => {
    const { body } = await getFeed(BRAND);
    const first = entries(body).find((e) =>
      e.includes('UID:ose-event-evt_2013_a_first@oursharedevents.com')
    );
    expect(first, 'the first event has an entry').toBeDefined();
    const pageUrl = `${ORIGIN}/events/evt_2013_a_first/evt-2013-a-first`;
    expect(first).toEqual([
      'UID:ose-event-evt_2013_a_first@oursharedevents.com',
      'DTSTAMP:20261102T123000Z',
      'DTSTART;TZID=America/Chicago:20261201T200000',
      'DTEND;TZID=America/Chicago:20261201T220000',
      'SUMMARY:First\\, with commas\\; and more',
      `DESCRIPTION:Bring friends.\\n\\n${pageUrl}`,
      'LOCATION:Eagles Bowl',
      `URL:${pageUrl}`,
    ]);
  });

  test('a timed event starts at its wall time in the event zone (the per-event rule)', async () => {
    const { body } = await getFeed(BRAND);
    const second = entries(body).find((e) => e.some((l) => l.includes('evt_2013_a_second@')));
    // 2026-12-11T00:30Z is 18:30 on the 10th in Chicago; a same-day date-only end
    // keeps the one-hour default.
    expect(second).toContain('DTSTART;TZID=America/Chicago:20261210T183000');
    expect(second).toContain('DTEND;TZID=America/Chicago:20261210T193000');
  });

  test('an online event (no place) is in the feed, with an empty location', async () => {
    await seedEvent({ id: 'evt_2013_a_online', location: null, title: 'Online only' });
    try {
      const { body } = await getFeed(BRAND);
      const online = entries(body).find((e) => e.some((l) => l.includes('evt_2013_a_online@')));
      expect(online, 'the online event has an entry').toBeDefined();
      expect(online).toContain('LOCATION:');
      expect(online).toContain(`URL:${ORIGIN}/events/evt_2013_a_online/evt-2013-a-online`);
    } finally {
      await tenv().DB.prepare(`DELETE FROM events WHERE id = 'evt_2013_a_online'`).run();
    }
  });

  test('an event with no start date has no entry; the rest of the feed is unchanged', async () => {
    await seedEvent({ id: 'evt_2013_a_nodate', startDate: null, endDate: null });
    try {
      const { res, body } = await getFeed(BRAND);
      expect(res.status).toBe(200);
      expect(body).not.toContain('evt_2013_a_nodate');
      expect(entries(body)).toHaveLength(2);
    } finally {
      await tenv().DB.prepare(`DELETE FROM events WHERE id = 'evt_2013_a_nodate'`).run();
    }
  });

  test('it lists the same events as the brand API', async () => {
    const api = await SELF.fetch(`${ORIGIN}/api/v2/events?brand=${BRAND}`);
    const json = (await api.json()) as { items: { id: string }[] };
    const apiIds = json.items.map((i) => i.id).sort();
    const { body } = await getFeed(BRAND);
    const feedIds = entries(body)
      .map((e) => /^UID:ose-event-(.+)@oursharedevents\.com$/.exec(e[0])?.[1])
      .sort();
    expect(feedIds).toEqual(apiIds);
    expect(feedIds).toEqual(['evt_2013_a_first', 'evt_2013_a_second']);
  });
});

describe('OSE-2013 brand calendar feed: born-red checks', () => {
  test("BORN RED 1: another brand's event never appears", async () => {
    const mine = await getFeed(BRAND);
    expect(mine.body).not.toContain('evt_2013_b_only');
    expect(mine.body).not.toContain('OTHER-BRAND-EVENT');

    const theirs = await getFeed(OTHER_BRAND);
    expect(theirs.res.status).toBe(200);
    expect(theirs.body).toContain('OTHER-BRAND-EVENT');
    expect(theirs.body).not.toContain('evt_2013_a_');
    expect(entries(theirs.body)).toHaveLength(1);
  });

  test('BORN RED 2: a draft is left out, and so is everything else the brand API does not list', async () => {
    const { body } = await getFeed(BRAND);
    expect(body).not.toContain('evt_2013_a_draft');
    expect(body).not.toContain('DRAFT-NEVER-PUBLIC');
    for (const hidden of [
      'evt_2013_a_ready',
      'READY-NEVER-PUBLIC',
      'evt_2013_a_archived',
      'ARCHIVED-NOT-LISTED',
      'evt_2013_a_offmap',
      'OFFMAP-NOT-LISTED',
      'evt_2013_a_grace',
      'GRACE-NOT-LISTED-YET',
    ]) {
      expect(body, hidden).not.toContain(hidden);
    }
  });

  test('BORN RED 3: no field outside the public projection is in the feed', async () => {
    // Put a marker in every column of `events` that the public projection does
    // not carry, then look for a marker in the feed. The column list is read
    // from the table, so a column added later is covered without a change here.
    const id = 'evt_2013_a_markers';
    await seedEvent({ id, title: 'Marked event' });
    try {
      const { results } = await tenv()
        .DB.prepare(`PRAGMA table_info(events)`)
        .all<{ name: string }>();
      const projected = new Set<string>(PUBLIC_EVENT_COLUMNS);
      // Columns the list query itself filters on: changing them would take the
      // row out of the feed instead of testing the feed.
      const filters = new Set(['is_published', 'listed_from']);
      const marked: string[] = [];
      for (const { name } of results) {
        if (projected.has(name) || filters.has(name)) continue;
        try {
          await tenv()
            .DB.prepare(`UPDATE events SET "${name}" = ? WHERE id = ?`)
            .bind(`LEAK_${name}`, id)
            .run();
          marked.push(name);
        } catch {
          // A CHECK or foreign key refused the marker; that column keeps its value.
        }
      }
      // The gate can only fail if markers were really written, and h3_res9 (the
      // finer cell the projection withholds) must be one of them.
      expect(marked.length).toBeGreaterThan(10);
      expect(marked).toContain('h3_res9');

      const { res, body } = await getFeed(BRAND);
      expect(res.status).toBe(200);
      expect(body).toContain('SUMMARY:Marked event');
      expect(body).not.toContain('LEAK_');

      // And every line of every entry is one of the eight properties an entry has.
      const allowed = /^(UID|DTSTAMP|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|URL)[;:]/;
      for (const entry of entries(body)) {
        for (const line of entry) expect(line).toMatch(allowed);
      }
    } finally {
      await tenv().DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
    }
  });

  test('BORN RED 4: no cookie is set, on the feed or on a refusal', async () => {
    const ok = await SELF.fetch(feedUrl(BRAND), { headers: { Cookie: 'ose_anon=abc123' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Set-Cookie')).toBeNull();
    // A feed is the same for every caller, so it does not vary on the cookie either.
    expect(ok.headers.get('Vary') ?? '').not.toMatch(/cookie/i);

    const missing = await SELF.fetch(feedUrl('ose2013-no-such-brand'));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('OSE-2013 brand calendar feed: links and people', () => {
  test("each entry's link is the event page on this site, never a short link or another site", async () => {
    await seedEvent({
      id: 'evt_2013_a_link',
      description: 'Join at https://meet.example.com/room-123 tonight.',
    });
    try {
      const { body } = await getFeed(BRAND);
      const all = entries(body);
      expect(all.length).toBeGreaterThan(0);
      for (const entry of all) {
        const url = entry.find((l) => l.startsWith('URL:'));
        expect(url).toMatch(/^URL:https:\/\/t\.test\/events\/[A-Za-z0-9_-]+(\/[a-z0-9-]+)?$/);
      }
      expect(body).not.toContain('/s/');
      expect(body).not.toContain('/q/');
      expect(body).not.toContain('utm_');
      // What an organizer typed in the description is theirs and stays as text;
      // the entry's own link is still the event page.
      const linked = all.find((e) => e.some((l) => l.includes('evt_2013_a_link@')));
      expect(linked).toContain(`URL:${ORIGIN}/events/evt_2013_a_link/evt-2013-a-link`);
    } finally {
      await tenv().DB.prepare(`DELETE FROM events WHERE id = 'evt_2013_a_link'`).run();
    }
  });

  test('nothing about attendees or organizers as people is in it', async () => {
    const { body } = await getFeed(BRAND);
    for (const property of ['ATTENDEE', 'ORGANIZER', 'CONTACT', 'RSVP', 'PARTSTAT']) {
      expect(body, property).not.toMatch(new RegExp(`^${property}[;:]`, 'm'));
    }
    expect(body).not.toMatch(/mailto:/i);
  });

  test('reading the feed writes nothing: no row in any table, no click', async () => {
    // Every table's row count, plus the click total: a read must change none.
    const state = async (): Promise<Record<string, number>> => {
      const { results } = await tenv()
        .DB.prepare(
          `SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
            ORDER BY name`
        )
        .all<{ name: string }>();
      const out: Record<string, number> = {};
      for (const { name } of results) {
        const row = await tenv()
          .DB.prepare(`SELECT COUNT(*) AS n FROM "${name}"`)
          .first<{ n: number }>();
        out[name] = row?.n ?? 0;
      }
      const clicks = await tenv()
        .DB.prepare(`SELECT COALESCE(SUM(clicks), 0) AS n FROM shortlinks`)
        .first<{ n: number }>();
      out['shortlinks.clicks'] = clicks?.n ?? 0;
      return out;
    };
    const before = await state();
    await getFeed(BRAND);
    expect(await state()).toEqual(before);
  });
});

describe('OSE-2013 brand calendar feed: refusals', () => {
  test('an unknown brand is a 404', async () => {
    const res = await SELF.fetch(feedUrl('ose2013-no-such-brand'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' });
  });

  test('a brand with only drafts answers exactly like an unknown brand', async () => {
    const unknown = await SELF.fetch(feedUrl('ose2013-no-such-brand'));
    const draftsOnly = await SELF.fetch(feedUrl(DRAFT_ONLY_BRAND));
    expect(draftsOnly.status).toBe(404);
    expect(await draftsOnly.text()).toBe(await unknown.text());
  });

  test('a badly formed brand is the same 404, and no query runs on what was typed', async () => {
    const unknownBody = await (await SELF.fetch(feedUrl('ose2013-no-such-brand'))).text();
    for (const bad of [
      'UPPER',
      'a'.repeat(65),
      'has%20space',
      'a.b',
      "x'%20OR%20'1'='1",
      '%3Cscript%3E',
      'root%2F..',
      `${BRAND}%00`,
    ]) {
      const res = await SELF.fetch(feedUrl(bad));
      expect(res.status, bad).toBe(404);
      expect(await res.text(), bad).toBe(unknownBody);
    }
  });

  test('only GET is the feed', async () => {
    const res = await SELF.fetch(feedUrl(BRAND), { method: 'POST' });
    expect(res.status).not.toBe(200);
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/calendar');
  });

  test('it is rate-limited like other public reads, per caller', async () => {
    const ip = '203.0.113.213';
    const headers = { 'CF-Connecting-IP': ip };
    expect((await SELF.fetch(feedUrl(BRAND), { headers })).status).toBe(200);
    // Spend the rest of this caller's minute.
    const key = await rateLimitKvKey(
      `publicread:brand-calendar:${ip}`,
      tenv().RATE_LIMIT_KEY_PEPPER
    );
    await tenv().RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: PUBLIC_READ_MAX, resetAt: Date.now() + 60_000, max: PUBLIC_READ_MAX })
    );
    const limited = await SELF.fetch(feedUrl(BRAND), { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe(String(EDGE_WINDOW_SECONDS));
    // A refused unknown brand is limited the same way: the limit comes first.
    expect((await SELF.fetch(feedUrl('ose2013-no-such-brand'), { headers })).status).toBe(429);
    // Another caller is unaffected.
    const other = await SELF.fetch(feedUrl(BRAND), {
      headers: { 'CF-Connecting-IP': '203.0.113.214' },
    });
    expect(other.status).toBe(200);
  });
});
