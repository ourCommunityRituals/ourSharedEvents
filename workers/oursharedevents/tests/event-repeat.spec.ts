/**
 * "Repeat this event" — POST /api/v2/admin/events/:id/repeat.
 *
 * An organizer finishes an event and wants the next one without retyping it. The
 * server makes the copy (so every create rule — brand scope, slug, shortlink,
 * the draft state, the audit row — is the one create path, not a second one) and
 * the copy is a DRAFT: same name, place, kind, start time and zone, settings and
 * text; a new date; never anything about who took part.
 *
 * What must NOT travel, and each has a test that goes red if it does:
 *   - registrations, check-ins, scans, poster codes, shortlinks: none of those
 *     tables is read, and the new event has none;
 *   - sponsors and their consent (a placement is the sponsor's own yes, ADR-019);
 *   - the live state: status, qr_verified, listed_from, is_published (the copy is
 *     off the map until its organizer chooses), created_by (the caller owns it);
 *   - the slug (unique) — two repeats of one event do not collide.
 *
 * @born-red OSE-1531 | method: written before the route existed — every request
 * answered 404 and nothing imported lib/event-repeat | date: 2026-10-04
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { nextRepeatDate } from '../src/lib/event-repeat';
import { zonedTimePart } from '../src/lib/event-datetime';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-rep-a';
const BRAND_B = 'brand-rep-b';
const OWNER_A = 'owner-a@example.com';
const OWNER_B = 'owner-b@example.com';
const SRC = 'evt-rep-src';
const SRC_BARE = 'evt-rep-bare';
const SRC_B = 'evt-rep-B';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    // A signed-in person is a browser on the admin site (admin write guard).
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function call(
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, { method, headers: { ...headers } }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}
// The route is limited per address and event, so every call gets its own
// address unless a test names one (the 429 test does).
let nextIp = 1;
const repeat = (id: string, headers: Record<string, string>) =>
  call('POST', `/api/v2/admin/events/${id}/repeat`, {
    'CF-Connecting-IP': `198.51.100.${nextIp++}`,
    ...headers,
  });

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

type Row = Record<string, unknown>;
const rowOf = (id: string) =>
  tenv.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<Row>() as Promise<Row>;
const count = async (sql: string, ...binds: unknown[]) =>
  (await tenv.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>())!.n;

/** First date, a whole number of weeks after `source`, that is later than `today` (UTC). */
function expectedDate(source: string, today: string): string {
  const d = new Date(`${source}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 7);
  while (d.toISOString().slice(0, 10) <= today);
  return d.toISOString().slice(0, 10);
}
const todayUtc = () => new Date().toISOString().slice(0, 10);

let typeId: string | null = null;

beforeAll(async () => {
  await applyMigrations();
  typeId =
    (
      await tenv.DB.prepare(
        'SELECT id FROM event_type_registry WHERE is_active = 1 LIMIT 1'
      ).first<{
        id: string;
      }>()
    )?.id ?? null;

  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, description, location, start_date,
                         timezone, starts_at, cover_image_url, what_short, who_host, why_purpose,
                         how_details, where_address, who_story, who_image_url, what_video_url,
                         what_url, what_url_enabled, what_url_type, lat, lon, is_published,
                         qr_verified, listed_from, created_by, event_type_id, settings_json)
     VALUES (?, ?, 'Harbor Bocce Night', 'harbor-bocce-night', 'active', 'Weekly bocce.',
             'Eagles Hall', '2026-09-26', 'America/Chicago', '2026-09-26T23:00:00Z',
             '/api/v2/uploads/poster-art/c.png', 'Bocce for everyone', 'Harbor County League',
             'Keep the league going', 'Bring your own balls', '12 Main St',
             'A long story about the host.', 'https://img.example.com/h.png',
             'https://video.example.com/v', 'https://tickets.example.com/bocce', 1, 'tickets',
             42.1, -86.3, 1, 1, '2026-09-20T00:00:00Z', 'someone-else@example.com', ?,
             '{"showQRSection":false,"displayPanes":["event","sponsors"],"displayDwellSeconds":20}')`
  )
    .bind(SRC, BRAND_A, typeId)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, 'Bare Event', 'bare-event', 'archived')`
  )
    .bind(SRC_BARE, BRAND_A)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date) VALUES (?, ?, 'Other Brand Event', 'other-brand-event', 'active', '2026-09-26')`
  )
    .bind(SRC_B, BRAND_B)
    .run();

  // What the source has that the copy must not: a sponsor who said yes, a poster, a shortlink.
  await tenv.DB.prepare(
    `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES ('sb-rep-A', ?, 'Rep Sponsor', 1)`
  )
    .bind(BRAND_A)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted)
     VALUES ('sp-rep-1', 'sb-rep-A', ?, 'standard', 'organizer', 1, 1, 1)`
  )
    .bind(SRC)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO poster_deployments (id, event_id, qr_token) VALUES ('pd-rep-1', ?, 'qrt-rep-1')`
  )
    .bind(SRC)
    .run();
  await tenv.DB.prepare(
    `INSERT INTO shortlinks (code, event_id, clicks) VALUES ('rep-src-1', ?, 41)`
  )
    .bind(SRC)
    .run();

  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
    )
      .bind(email, brand)
      .run();
  }
});

describe('nextRepeatDate: the same weekday, a week or more on, never in the past', () => {
  test.each([
    ['source last week', '2026-09-26', '2026-10-04', '2026-10-10'],
    ['source months ago', '2026-01-03', '2026-10-04', '2026-10-10'],
    ['source still ahead', '2026-10-24', '2026-10-04', '2026-10-31'],
    ['source is today', '2026-10-04', '2026-10-04', '2026-10-11'],
    ['over a year end', '2026-12-26', '2026-12-20', '2027-01-02'],
  ])('%s', (_label, source, today, want) => {
    const got = nextRepeatDate(source, today);
    expect(got).toBe(want);
    expect(new Date(`${got}T00:00:00Z`).getUTCDay()).toBe(
      new Date(`${source}T00:00:00Z`).getUTCDay()
    );
    expect(got > today).toBe(true);
    expect(got >= expectedDate(source, '0000-00-00')).toBe(true);
  });

  test('an unreadable source date yields no date rather than a guess', () => {
    expect(nextRepeatDate('', '2026-10-04')).toBeNull();
    expect(nextRepeatDate('2026-02-31', '2026-10-04')).toBeNull();
    expect(nextRepeatDate('soon', '2026-10-04')).toBeNull();
  });
});

describe('POST /api/v2/admin/events/:id/repeat — the copy', () => {
  test('makes a new DRAFT in the same brand, owned by the caller', async () => {
    const res = await repeat(SRC, asEmail(OWNER_A));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Row;
    expect(body.ok).toBe(true);
    expect(body.source_id).toBe(SRC);
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe(SRC);
    expect(body.state).toBe('draft');

    const row = await rowOf(body.id as string);
    expect(row.brand_id).toBe(BRAND_A);
    expect(row.status).toBe('draft');
    expect(row.created_by).toBe(OWNER_A);
  });

  test('carries the name, place, kind, text and links over', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const row = await rowOf(body.id);
    const src = await rowOf(SRC);
    for (const col of [
      'title',
      'description',
      'location',
      'where_address',
      'what_short',
      'who_host',
      'why_purpose',
      'how_details',
      'who_story',
      'who_image_url',
      'what_video_url',
      'what_url',
      'what_url_enabled',
      'what_url_type',
      'cover_image_url',
      'event_type_id',
      'timezone',
      'lat',
      'lon',
    ]) {
      expect(row[col], col).toEqual(src[col]);
    }
    expect(row.event_type_id).toBe(typeId);
  });

  // OSE-1658: artwork saved before the upload-only rule can be an outside
  // address. Create refuses one now, so a repeat that copied it would fail.
  test('artwork saved as an outside address is left behind, and the repeat still works', async () => {
    const LEGACY = 'evt-rep-legacy-art';
    await (env as unknown as { DB: D1Database }).DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, cover_image_url)
       VALUES (?, ?, 'Legacy Art Event', 'legacy-art-event', 'active', 'https://img.example.com/old.png')`
    )
      .bind(LEGACY, BRAND_A)
      .run();
    const res = await repeat(LEGACY, asEmail(OWNER_A));
    expect(res.status).toBe(201);
    const row = await rowOf(((await res.json()) as { id: string }).id);
    expect(row.title).toBe('Legacy Art Event');
    expect(row.cover_image_url).toBeNull();
  });

  test('carries the settings (TV screens, seconds, poster QR switch)', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const row = await rowOf(body.id);
    expect(JSON.parse(row.settings_json as string)).toEqual({
      showQRSection: false,
      displayPanes: ['event', 'sponsors'],
      displayDwellSeconds: 20,
    });
  });

  test('a source with the server-managed map marker still repeats, and the copy does not carry it', async () => {
    // New events store `mapDefault: true` in settings_json; a client may not write it.
    await tenv.DB.prepare(
      `UPDATE events SET settings_json = '{"showQRSection":false,"mapDefault":true}' WHERE id = ?`
    )
      .bind(SRC)
      .run();
    try {
      const res = await repeat(SRC, asEmail(OWNER_A));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      const row = await rowOf(body.id);
      expect(JSON.parse(row.settings_json as string)).toEqual({ showQRSection: false });
    } finally {
      await tenv.DB.prepare(
        `UPDATE events SET settings_json = '{"showQRSection":false,"displayPanes":["event","sponsors"],"displayDwellSeconds":20}' WHERE id = ?`
      )
        .bind(SRC)
        .run();
    }
  });

  test('OSE-1900: sponsors are chosen per event, so the copy starts with sponsors off', async () => {
    // @born-red: with the `delete out.useSponsors` line removed from settingsForCopy in
    // lib/event-settings.ts the copy carried `useSponsors: true` (2026-11-09).
    await tenv.DB.prepare(
      `UPDATE events SET settings_json = '{"showQRSection":false,"useSponsors":true}' WHERE id = ?`
    )
      .bind(SRC)
      .run();
    try {
      const res = await repeat(SRC, asEmail(OWNER_A));
      expect(res.status).toBe(201);
      const row = await rowOf(((await res.json()) as { id: string }).id);
      expect(JSON.parse(row.settings_json as string)).toEqual({ showQRSection: false });
    } finally {
      await tenv.DB.prepare(
        `UPDATE events SET settings_json = '{"showQRSection":false,"displayPanes":["event","sponsors"],"displayDwellSeconds":20}' WHERE id = ?`
      )
        .bind(SRC)
        .run();
    }
  });

  test('the date moves to the same weekday ahead; the start time and zone stay', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as {
      id: string;
      start_date: string;
      start_time: string;
    };
    const row = await rowOf(body.id);
    expect(row.start_date).toBe(expectedDate('2026-09-26', todayUtc()));
    expect(body.start_date).toBe(row.start_date);
    expect(zonedTimePart(row.starts_at as string, 'America/Chicago')).toBe('18:00');
    expect(body.start_time).toBe('18:00');
    expect(row.timezone).toBe('America/Chicago');
  });

  test('a date-only source stays date-only; a source with no date gets none', async () => {
    const dated = (await (await repeat(SRC_B, asEmail(OWNER_B))).json()) as { id: string };
    const r1 = await rowOf(dated.id);
    expect(r1.start_date).toBe(expectedDate('2026-09-26', todayUtc()));
    expect(r1.starts_at).toBeNull();

    const bare = (await (await repeat(SRC_BARE, asEmail(OWNER_A))).json()) as { id: string };
    const r2 = await rowOf(bare.id);
    expect(r2.start_date).toBeNull();
    expect(r2.starts_at).toBeNull();
  });

  test('a multi-day source keeps its length', async () => {
    await tenv.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES ('evt-rep-multi', ?, 'Tournament', 'tournament-rep', 'active', '2026-09-25', '2026-09-27')`
    )
      .bind(BRAND_A)
      .run();
    const body = (await (await repeat('evt-rep-multi', asEmail(OWNER_A))).json()) as { id: string };
    const row = await rowOf(body.id);
    const days =
      (Date.parse(`${row.end_date}T00:00:00Z`) - Date.parse(`${row.start_date}T00:00:00Z`)) /
      86_400_000;
    expect(days).toBe(2);
    expect(row.start_date).toBe(expectedDate('2026-09-25', todayUtc()));
  });
});

describe('POST /api/v2/admin/events/:id/repeat — what stays behind', () => {
  test('the copy is not live, not on the map, not verified and has no listing time', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const row = await rowOf(body.id);
    expect(row.status).toBe('draft');
    expect(row.is_published).toBe(0);
    expect(row.qr_verified ?? 0).toBe(0);
    expect(row.listed_from).toBeNull();
  });

  test('a new slug and a new shortlink, never the source ones', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const row = await rowOf(body.id);
    expect(row.slug).not.toBe('harbor-bocce-night');
    expect(await count('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?', body.id)).toBe(1);
    const link = await tenv.DB.prepare('SELECT code, clicks FROM shortlinks WHERE event_id = ?')
      .bind(body.id)
      .first<{ code: string; clicks: number }>();
    expect(link!.code).not.toBe('rep-src-1');
    expect(link!.clicks).toBe(0);
  });

  test('no sponsors, no poster, no scans come along', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    expect(
      await count('SELECT COUNT(*) AS n FROM sponsor_placement WHERE event_id = ?', body.id)
    ).toBe(0);
    expect(
      await count('SELECT COUNT(*) AS n FROM poster_deployments WHERE event_id = ?', body.id)
    ).toBe(0);
  });

  test('repeating twice makes two drafts with different slugs', async () => {
    const a = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const b = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    expect(a.id).not.toBe(b.id);
    expect((await rowOf(a.id)).slug).not.toBe((await rowOf(b.id)).slug);
  });

  test('the source event is left exactly as it was', async () => {
    const before = await rowOf(SRC);
    await repeat(SRC, asEmail(OWNER_A));
    expect(await rowOf(SRC)).toEqual(before);
    expect(await count('SELECT COUNT(*) AS n FROM sponsor_placement WHERE event_id = ?', SRC)).toBe(
      1
    );
  });
});

describe('POST /api/v2/admin/events/:id/repeat — who may do it', () => {
  test('another brand gets 404 and nothing is created', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM events');
    const res = await repeat(SRC, asEmail(OWNER_B));
    expect(res.status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  test('no credentials: 401 and nothing is created', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM events');
    const res = await repeat(SRC, {});
    expect(res.status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  test('an unknown event is 404, not a blank draft', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM events');
    const res = await repeat('evt-does-not-exist', {
      Authorization: 'Bearer test-admin-key-e2e-2026',
    });
    expect(res.status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM events')).toBe(before);
  });

  test('a signed report-link token cannot repeat an event', async () => {
    const res = await repeat(SRC, { Authorization: 'Bearer not-an-admin-key' });
    expect(res.status).toBe(401);
  });

  test('past 10 a minute from one address and event it answers 429', async () => {
    const ip = '203.0.113.77';
    const go = () => repeat('evt-rep-bare', { ...asEmail(OWNER_A), 'CF-Connecting-IP': ip });
    for (let i = 0; i < 10; i++) expect((await go()).status).not.toBe(429);
    const limited = await go();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  });
});

describe('POST /api/v2/admin/events/:id/repeat — the audit trail', () => {
  test('one REPEAT_EVENT row, success, on the new event, in the new event brand', async () => {
    const body = (await (await repeat(SRC, asEmail(OWNER_A))).json()) as { id: string };
    const rows = await tenv.DB.prepare(
      `SELECT action, outcome, resource_type, actor, brand_id FROM admin_audit_log WHERE resource_id = ?`
    )
      .bind(body.id)
      .all<Row>();
    const repeats = rows.results.filter((r) => r.action === 'REPEAT_EVENT');
    expect(repeats).toHaveLength(1);
    expect(repeats[0]).toMatchObject({
      outcome: 'success',
      resource_type: 'event',
      actor: OWNER_A,
      brand_id: BRAND_A,
    });
  });

  test('a refused request is audited as denied, not as a repeat', async () => {
    await repeat(SRC, {});
    const denied = await count(
      `SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'REPEAT_EVENT' AND outcome = 'denied' AND resource_id = ?`,
      SRC
    );
    expect(denied).toBeGreaterThanOrEqual(1);
  });
});

describe('the repeat code reads one table and none of the people tables', () => {
  const sources = (): Record<string, string> =>
    JSON.parse((env as unknown as { TEST_SOURCE_FILES_JSON: string }).TEST_SOURCE_FILES_JSON);
  const read = (suffix: string): string => {
    for (const [path, content] of Object.entries(sources())) {
      if (path.split('\\').join('/').endsWith(suffix)) return content;
    }
    throw new Error(`${suffix} not found in TEST_SOURCE_FILES_JSON`);
  };
  // Comments explain what is left behind, so they are cut before looking.
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test.each(['src/handlers/event-repeat.ts', 'src/lib/event-repeat.ts'])(
    '%s names no registration, scan, sponsor, poster, shortlink or forms table',
    (file) => {
      const src = code(read(file));
      expect(src).not.toMatch(
        /FORMS_DB|form_|registration|scan|sponsor|placement|poster|shortlink|check-?in|audience|anon/i
      );
    }
  );

  test('the only SQL it runs is one read of events by id', () => {
    const src = code(read('src/handlers/event-repeat.ts'));
    const sql = [...src.matchAll(/\.prepare\(\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^SELECT .* FROM events WHERE id = \?$/);
  });
});
