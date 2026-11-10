/**
 * OSE-1900 (CI/CD ticket OSE-1899) — sponsors show only if the event chose them.
 *
 * The event switch `useSponsors` (events.settings_json, lib/event-settings.ts)
 * is opt-in: absent means OFF. It is the event's own yes and comes before the
 * two-sided placement consent. This spec holds, at the workers-pool layer:
 *
 *   1. ONE SPEC OVER EVERY READER. An accepted placement on an event that has
 *      not opted in shows on no reader; the same placement on an opted-in event
 *      shows on all of them. The reader list is `READERS` below: add a reader
 *      there and every case in this file runs against it.
 *   2. THE CONSENT MATRIX, PAIRWISE: switch x sponsor accepted x organizer
 *      accepted x source x is_local x level. Rows are data (`MATRIX`), so a new
 *      factor value is a new row, not a new test.
 *   3. DISCOVERY: a sponsor cannot ask an event that has not opted in. The
 *      request is refused and no row is written.
 *   4. THE ADMIN SWITCH: on shows, off hides everything and deletes nothing, on
 *      again restores; fast on/off is idempotent and every change is audited; a
 *      bad value is a 400; an admin of another brand gets 404 and changes
 *      nothing; no tier is read.
 *   5. FAILURES: unreadable settings read as off and break no statement; a
 *      failed read leaves the page rendering with no sponsor line.
 *   6. THE BACKFILL (migration 0107): events that already had an
 *      organizer-accepted active placement are switched on; nothing else is.
 *
 * The staging layer is bruno/ose-api "17. Opt-in sponsors (OSE-1900)".
 *
 * @born-red OSE-1900 | method: this file was run against main's readers with
 * only the settings key added (no gate): every "off"/"absent" reader case, the
 * matrix rows with the switch off, the discovery refusal and the audit cases
 * failed. Then each reader's gate was removed in turn and its own case was
 * watched failing (the list is in the PR) | date: 2026-11-09
 *
 * Runtime-bound (SELF.fetch, env.DB) → workers pool.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { fetchSponsorTitles } from '../src/lib/sponsor-titles';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';
import { readDiscoverableEvents } from '../src/lib/sponsor-discovery';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import { mintBeaconToken } from '../src/lib/beacon-token';
import { handleSponsorAsset } from '../src/handlers/sponsor-asset-route';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { BRANDS, callAs, seedBrandFixture } from './helpers/brand-matrix';

// 'root' is the brand the landing and /events read.
const BRAND = 'root';
const MATRIX_BRAND = 'ose-optin-matrix';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(id: string, settingsJson: string, brand = BRAND): Promise<void> {
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events
       (id, brand_id, title, slug, status, start_date, location, is_published, settings_json)
     VALUES (?, ?, ?, ?, 'active', ?, 'Eagles Hall', 1, ?)`
  )
    .bind(id, brand, `Optin ${id}`, `slug-${id}`, day(10), settingsJson)
    .run();
}

async function setPlacement(
  sponsorId: string,
  f: { sponsor: number | null; organizer: number | null; source: string }
): Promise<void> {
  // seedSplitSponsor turns null into 1, so the three consent columns are set here.
  await tenv.DB.prepare(
    `UPDATE sponsor_placement SET sponsor_accepted = ?, organizer_accepted = ?, source = ?
      WHERE sponsor_business_id = ?`
  )
    .bind(f.sponsor, f.organizer, f.source, sponsorId)
    .run();
}

async function settingsOf(eventId: string): Promise<Record<string, unknown>> {
  const row = await tenv.DB.prepare('SELECT settings_json FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ settings_json: string }>();
  return JSON.parse(row?.settings_json ?? '{}') as Record<string, unknown>;
}

async function displayRows(eventId: string): Promise<number> {
  const row = await tenv.DB.prepare('SELECT COUNT(*) AS n FROM sponsor_displays WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── The reader list ──────────────────────────────────────────────────────────
// Each reader answers one question: does this sponsor show for this event here?

interface Target {
  eventId: string;
  sponsorId: string;
  name: string;
}
type Reader = (t: Target) => Promise<boolean>;

const text = async (path: string) => (await SELF.fetch(`https://t.test${path}`)).text();
const json = async (path: string) =>
  (await (await SELF.fetch(`https://t.test${path}`)).json()) as Record<string, unknown>;

const READERS: Record<string, Reader> = {
  'fetchSponsorTitles (the card line query)': async (t) =>
    (await fetchSponsorTitles(tenv.DB, BRAND)).get(t.eventId) === t.name,
  'resolveSponsorsForEvent (the resolver)': async (t) =>
    (await resolveSponsorsForEvent(tenv.DB, t.eventId)).some((s) => s.id === t.sponsorId),
  'GET /api/v2/events sponsor_titles (the TV "also coming up")': async (t) => {
    const body = await json(`/api/v2/events?brand=${BRAND}`);
    return (body.sponsor_titles as Record<string, string>)[t.eventId] === t.name;
  },
  'GET /events (list card line)': async (t) => (await text('/events')).includes(t.name),
  'GET / (landing card line and map list)': async (t) => (await text('/')).includes(t.name),
  'GET /events/:id (event page strip)': async (t) =>
    (await text(`/events/${t.eventId}`)).includes(t.name),
  'GET /api/v2/events/:id/sponsors': async (t) => {
    const body = await json(`/api/v2/events/${t.eventId}/sponsors`);
    return (body.items as { id: string }[]).some((s) => s.id === t.sponsorId);
  },
  'GET /api/v2/events/:id/sponsor-bundle?surface=display (the TV)': async (t) =>
    JSON.stringify(
      await json(`/api/v2/events/${t.eventId}/sponsor-bundle?surface=display`)
    ).includes(t.sponsorId),
  'GET /api/v2/events/:id/poster-bundle (the poster)': async (t) => {
    const body = await json(`/api/v2/events/${t.eventId}/poster-bundle`);
    return ((body.sponsors as { id: string }[] | undefined) ?? []).some(
      (s) => s.id === t.sponsorId
    );
  },
  'GET /sponsors/:id (the public card)': async (t) =>
    (await SELF.fetch(`https://t.test/sponsors/${t.sponsorId}`)).status === 200,
  // The seeded logo URL is refused by the logo proxy (not a public host), so a
  // sponsor that is on show answers 422 with no outbound fetch; hidden is 404.
  'GET /api/v2/sponsors/:id/logo': async (t) =>
    (await SELF.fetch(`https://t.test/api/v2/sponsors/${t.sponsorId}/logo`)).status !== 404,
  'GET /api/v2/sponsors/:id/asset/square (creative or monogram)': async (t) =>
    (
      await handleSponsorAsset(
        new Request('https://t.test'),
        env as unknown as Parameters<typeof handleSponsorAsset>[1],
        t.sponsorId,
        'square'
      )
    ).status === 200,
  'POST impression beacon (writes a display row)': async (t) => {
    const before = await displayRows(t.eventId);
    const res = await SELF.fetch(
      `https://t.test/api/v2/events/${t.eventId}/sponsors/${t.sponsorId}/impression`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'CF-Connecting-IP': `198.51.100.${40 + (before % 200)}`,
        },
        body: JSON.stringify({
          surface: 'public',
          placement: 'mobileBanner',
          beacon_token: await mintBeaconToken(
            env as unknown as Parameters<typeof mintBeaconToken>[0],
            t.eventId,
            t.sponsorId
          ),
        }),
      }
    );
    const wrote = (await displayRows(t.eventId)) > before;
    // A refused pair is 404 and writes nothing; the two must agree.
    expect(wrote, `beacon status ${res.status}`).toBe(res.status === 201);
    return wrote;
  },
};

const ON: Target = { eventId: 'optin-on', sponsorId: 'optin-s-on', name: 'Optin Harbor Lanes' };
const OFF: Target = { eventId: 'optin-off', sponsorId: 'optin-s-off', name: 'Optin Quiet Bakery' };
const ABSENT: Target = {
  eventId: 'optin-absent',
  sponsorId: 'optin-s-absent',
  name: 'Optin Corner Hardware',
};

async function seedAccepted(t: Target, settingsJson: string): Promise<void> {
  await seedEvent(t.eventId, settingsJson);
  await seedSplitSponsor(tenv.DB, {
    id: t.sponsorId,
    eventId: t.eventId,
    brandId: BRAND,
    name: t.name,
    logoUrl: 'https://localhost/logo.png',
  });
}

// ── The pairwise consent matrix ──────────────────────────────────────────────
// Every pair of values across the six factors appears in at least one row.
// `shows` is the rule: the event opted in, the sponsor accepted, and the
// organizer accepted (silence counts only for a placement the organizer made).

interface Row {
  sw: 'on' | 'off' | 'absent';
  sponsor: number | null;
  organizer: number | null;
  source: 'organizer' | 'sponsor_request';
  local: 0 | 1;
  tier: 'anchor' | 'primary' | 'standard';
}
const MATRIX: Row[] = [
  { sw: 'on', sponsor: 1, organizer: 1, source: 'organizer', local: 1, tier: 'anchor' },
  { sw: 'on', sponsor: 1, organizer: null, source: 'organizer', local: 0, tier: 'primary' },
  { sw: 'on', sponsor: 1, organizer: 1, source: 'sponsor_request', local: 0, tier: 'standard' },
  { sw: 'on', sponsor: 1, organizer: null, source: 'sponsor_request', local: 1, tier: 'anchor' },
  { sw: 'on', sponsor: 1, organizer: 0, source: 'organizer', local: 1, tier: 'standard' },
  { sw: 'on', sponsor: 0, organizer: 1, source: 'organizer', local: 0, tier: 'anchor' },
  { sw: 'on', sponsor: null, organizer: 1, source: 'sponsor_request', local: 1, tier: 'primary' },
  { sw: 'on', sponsor: 0, organizer: 0, source: 'sponsor_request', local: 0, tier: 'primary' },
  { sw: 'off', sponsor: 1, organizer: 1, source: 'organizer', local: 0, tier: 'primary' },
  { sw: 'off', sponsor: 1, organizer: null, source: 'sponsor_request', local: 1, tier: 'standard' },
  { sw: 'off', sponsor: 0, organizer: 0, source: 'organizer', local: 1, tier: 'anchor' },
  { sw: 'off', sponsor: null, organizer: 1, source: 'sponsor_request', local: 0, tier: 'anchor' },
  { sw: 'absent', sponsor: 1, organizer: 1, source: 'sponsor_request', local: 1, tier: 'standard' },
  { sw: 'absent', sponsor: 1, organizer: null, source: 'organizer', local: 0, tier: 'anchor' },
  { sw: 'absent', sponsor: 0, organizer: 1, source: 'organizer', local: 1, tier: 'primary' },
  {
    sw: 'absent',
    sponsor: null,
    organizer: 0,
    source: 'sponsor_request',
    local: 0,
    tier: 'standard',
  },
  { sw: 'absent', sponsor: null, organizer: null, source: 'organizer', local: 1, tier: 'primary' },
  { sw: 'off', sponsor: null, organizer: null, source: 'organizer', local: 0, tier: 'standard' },
  { sw: 'on', sponsor: null, organizer: 0, source: 'organizer', local: 0, tier: 'anchor' },
  { sw: 'on', sponsor: 0, organizer: null, source: 'sponsor_request', local: 1, tier: 'standard' },
];
const SETTINGS = {
  on: '{"useSponsors":true}',
  off: '{"useSponsors":false}',
  absent: '{}',
} as const;
const shows = (r: Row): boolean =>
  r.sw === 'on' &&
  r.sponsor === 1 &&
  (r.organizer === 1 || (r.organizer === null && r.source === 'organizer'));
const label = (r: Row) =>
  `switch ${r.sw}, sponsor ${r.sponsor}, organizer ${r.organizer}, ${r.source}, ` +
  `${r.local ? 'local' : 'not local'}, ${r.tier}`;

beforeAll(async () => {
  await seedBrandFixture(); // applies migrations; the four-brand tree for the scope case
  // The poster bundle reads the forms database for its form links.
  for (const stmt of JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column name') && !msg.includes('already exists')) throw e;
    }
  }
  await tenv.DB.prepare(
    `DELETE FROM sponsor_displays WHERE event_id LIKE 'optin-%' OR event_id LIKE 'optm-%'`
  ).run();
  await seedAccepted(ON, SETTINGS.on);
  await seedAccepted(OFF, SETTINGS.off);
  await seedAccepted(ABSENT, SETTINGS.absent);
  for (const [i, r] of MATRIX.entries()) {
    const eventId = `optm-e-${i}`;
    await seedEvent(eventId, SETTINGS[r.sw], MATRIX_BRAND);
    await seedSplitSponsor(tenv.DB, {
      id: `optm-s-${i}`,
      eventId,
      brandId: MATRIX_BRAND,
      name: `Optm Sponsor ${i}`,
      isLocal: r.local,
      tier: r.tier,
    });
    await setPlacement(`optm-s-${i}`, r);
  }
});

describe('one spec over every reader', () => {
  test.each(Object.keys(READERS))(
    'opted in and both sides accepted: the sponsor shows on %s',
    async (reader) => {
      expect(await READERS[reader](ON)).toBe(true);
    }
  );

  test.each(Object.keys(READERS))(
    'accepted placement but the switch is off: no sponsor on %s',
    async (reader) => {
      expect(await READERS[reader](OFF)).toBe(false);
    }
  );

  test.each(Object.keys(READERS))(
    'accepted placement and the switch was never set (absent means off): no sponsor on %s',
    async (reader) => {
      expect(await READERS[reader](ABSENT)).toBe(false);
    }
  );

  test('the pages of an event that has not opted in still render, with no sponsor line', async () => {
    const page = await SELF.fetch(`https://t.test/events/${OFF.eventId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Optin optin-off');
    expect(html).not.toContain('data-testid="pre-sponsor-strip"');
  });
});

describe('the consent matrix, pairwise', () => {
  test('the rows cover every pair of factor values', () => {
    const factors: Array<keyof Row> = ['sw', 'sponsor', 'organizer', 'source', 'local', 'tier'];
    const values = (f: keyof Row) => [...new Set(MATRIX.map((r) => String(r[f])))];
    // A matrix that lost a row would lose a pair; this fails before the readers run.
    expect(values('sw').sort()).toEqual(['absent', 'off', 'on']);
    expect(values('sponsor').sort()).toEqual(['0', '1', 'null']);
    expect(values('organizer').sort()).toEqual(['0', '1', 'null']);
    for (let a = 0; a < factors.length; a++) {
      for (let b = a + 1; b < factors.length; b++) {
        for (const va of values(factors[a])) {
          for (const vb of values(factors[b])) {
            const hit = MATRIX.some(
              (r) => String(r[factors[a]]) === va && String(r[factors[b]]) === vb
            );
            expect(hit, `${factors[a]}=${va} with ${factors[b]}=${vb}`).toBe(true);
          }
        }
      }
    }
  });

  test.each(MATRIX.map((r, i) => [label(r), i] as const))('%s', async (_label, i) => {
    const r = MATRIX[i];
    const eventId = `optm-e-${i}`;
    const sponsorId = `optm-s-${i}`;
    const want = shows(r);
    const seen = {
      titles: (await fetchSponsorTitles(tenv.DB, MATRIX_BRAND)).has(eventId),
      resolver: (await resolveSponsorsForEvent(tenv.DB, eventId)).some((s) => s.id === sponsorId),
      api: await READERS['GET /api/v2/events/:id/sponsors']({ eventId, sponsorId, name: '' }),
      page: (await text(`/events/${eventId}`)).includes(`Optm Sponsor ${i}`),
      card: (await SELF.fetch(`https://t.test/sponsors/${sponsorId}`)).status === 200,
    };
    expect(seen).toEqual({ titles: want, resolver: want, api: want, page: want, card: want });
  });
});

describe('sponsor discovery: a sponsor can ask only an event that opted in', () => {
  const SEEKER = 'optin-seeker';
  let token = '';

  async function ask(eventId: string) {
    const res = await SELF.fetch('https://t.test/api/v2/sponsor/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, event_id: eventId }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const rowsFor = async (eventId: string) =>
    (
      await tenv.DB.prepare(
        'SELECT COUNT(*) AS n FROM sponsor_placement WHERE sponsor_business_id = ? AND event_id = ?'
      )
        .bind(SEEKER, eventId)
        .first<{ n: number }>()
    )?.n ?? 0;

  beforeAll(async () => {
    await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE sponsor_business_id = ?')
      .bind(SEEKER)
      .run();
    await tenv.DB.prepare(
      `INSERT OR REPLACE INTO sponsor_business (id, brand_id, name, tier, is_active)
       VALUES (?, ?, 'Optin Seeker Co', 'standard', 1)`
    )
      .bind(SEEKER, BRAND)
      .run();
    token = (await mintSponsorHomeToken(tenv, SEEKER, BRAND))!.token;
  });

  test('the list offers the opted-in event and neither of the others', async () => {
    const ids = (
      await readDiscoverableEvents(tenv.DB, { id: SEEKER, brand_id: BRAND, h3_res7: null })
    ).map((e) => e.id);
    expect(ids).toContain(ON.eventId);
    expect(ids).not.toContain(OFF.eventId);
    expect(ids).not.toContain(ABSENT.eventId);
  });

  test('the sponsor page has an Ask button for the opted-in event only', async () => {
    const html = await text(`/sponsor?t=${encodeURIComponent(token)}`);
    expect(html).toContain(`data-event-id="${ON.eventId}"`);
    expect(html).not.toContain(`data-event-id="${OFF.eventId}"`);
    expect(html).not.toContain(`data-event-id="${ABSENT.eventId}"`);
  });

  test.each([
    ['the switch is off', OFF.eventId],
    ['the switch was never set', ABSENT.eventId],
  ])('a request to an event where %s is refused and writes no row', async (_why, eventId) => {
    const { status, body } = await ask(eventId);
    expect(status).toBe(404);
    // The same answer as an event that does not exist: no oracle.
    expect(body.code).toBe('NOT_DISCOVERABLE');
    expect(await rowsFor(eventId)).toBe(0);
    const audit = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit_log
        WHERE action = 'SPONSOR_REQUEST_PLACEMENT' AND actor = ? AND details LIKE ?`
    )
      .bind(`sponsor:${SEEKER}`, `%${eventId}%`)
      .first<{ n: number }>();
    expect(audit?.n).toBe(0);
  });

  test('a request to the opted-in event is taken, and stays off every surface until approved', async () => {
    const { status } = await ask(ON.eventId);
    expect(status).toBe(201);
    expect(await rowsFor(ON.eventId)).toBe(1);
    expect((await resolveSponsorsForEvent(tenv.DB, ON.eventId)).some((s) => s.id === SEEKER)).toBe(
      false
    );
  });
});

describe('the admin switch (PUT /api/v2/admin/events/:id settings.useSponsors)', () => {
  const T: Target = {
    eventId: 'optin-toggle',
    sponsorId: 'optin-s-toggle',
    name: 'Optin Toggle Diner',
  };
  const put = (settings: unknown, eventId = T.eventId) =>
    callAs({ kind: 'key-all' }, 'PUT', `/api/v2/admin/events/${eventId}`, { settings });
  const everyReader = async (t: Target) => {
    const out: Record<string, boolean> = {};
    for (const [name, read] of Object.entries(READERS)) out[name] = await read(t);
    return out;
  };
  const all = (v: boolean) => Object.fromEntries(Object.keys(READERS).map((k) => [k, v]));
  const placements = async () =>
    tenv.DB.prepare(
      `SELECT id, is_active, sponsor_accepted, organizer_accepted, source
         FROM sponsor_placement WHERE event_id = ? ORDER BY id`
    )
      .bind(T.eventId)
      .all();
  const switchAudit = async (eventId = T.eventId) =>
    (
      await tenv.DB.prepare(
        `SELECT actor, outcome, details, brand_id FROM admin_audit_log
          WHERE action = 'EVENT_SPONSORS_SWITCH' AND resource_type = 'event' AND resource_id = ?
          ORDER BY rowid`
      )
        .bind(eventId)
        .all<{ actor: string; outcome: string; details: string; brand_id: string | null }>()
    ).results;

  beforeAll(async () => {
    await tenv.DB.prepare(`DELETE FROM admin_audit_log WHERE resource_id = ?`)
      .bind(T.eventId)
      .run();
    await seedAccepted(T, SETTINGS.absent);
  });

  test('a new event shows no sponsor, even with a placement both sides accepted', async () => {
    expect(await everyReader(T)).toEqual(all(false));
  });

  test('on shows it everywhere; off hides it everywhere and deletes nothing; on again restores it', async () => {
    const before = (await placements()).results;

    expect((await put({ useSponsors: true })).status).toBe(200);
    expect((await settingsOf(T.eventId)).useSponsors).toBe(true);
    expect(await everyReader(T)).toEqual(all(true));

    expect((await put({ useSponsors: false })).status).toBe(200);
    expect((await settingsOf(T.eventId)).useSponsors).toBe(false);
    expect(await everyReader(T)).toEqual(all(false));
    // Hidden, not removed: the placement row is exactly as both sides left it.
    expect((await placements()).results).toEqual(before);

    expect((await put({ useSponsors: true })).status).toBe(200);
    expect(await everyReader(T)).toEqual(all(true));
    expect((await placements()).results).toEqual(before);
  });

  test('turning it on changes nothing until both sides accept', async () => {
    await setPlacement(T.sponsorId, { sponsor: null, organizer: 1, source: 'organizer' });
    expect(await everyReader(T)).toEqual(all(false));
    await setPlacement(T.sponsorId, { sponsor: 1, organizer: 0, source: 'organizer' });
    expect(await everyReader(T)).toEqual(all(false));
    await setPlacement(T.sponsorId, { sponsor: 1, organizer: 1, source: 'organizer' });
    expect(await everyReader(T)).toEqual(all(true));
  });

  test('fat finger: on, on, off, off, on in a row is idempotent, and every write is audited', async () => {
    await tenv.DB.prepare(`DELETE FROM admin_audit_log WHERE resource_id = ?`)
      .bind(T.eventId)
      .run();
    const taps = [true, true, false, false, true];
    for (const v of taps) {
      const res = await put({ useSponsors: v });
      expect(res.status).toBe(200);
      expect((await settingsOf(T.eventId)).useSponsors).toBe(v);
    }
    const rows = await switchAudit();
    expect(rows.map((r) => JSON.parse(r.details))).toEqual(taps.map((v) => ({ use_sponsors: v })));
    for (const r of rows) {
      expect(r.outcome).toBe('success');
      expect(r.actor).toMatch(/^key:/);
      // The audit row belongs to the event's brand, so a brand-scoped read finds it.
      expect(r.brand_id).toBe(BRAND);
    }
    expect((await placements()).results).toHaveLength(1);
  });

  test('two taps at once leave one of the two values, never a broken setting', async () => {
    const [a, b] = await Promise.all([put({ useSponsors: true }), put({ useSponsors: false })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(typeof (await settingsOf(T.eventId)).useSponsors).toBe('boolean');
    await put({ useSponsors: true });
  });

  test('the switch does not disturb the other settings, and they do not disturb it', async () => {
    expect((await put({ showQRSection: false })).status).toBe(200);
    expect(await settingsOf(T.eventId)).toMatchObject({ useSponsors: true, showQRSection: false });
    expect((await put({ useSponsors: false })).status).toBe(200);
    expect(await settingsOf(T.eventId)).toMatchObject({ useSponsors: false, showQRSection: false });
    await put({ useSponsors: true, showQRSection: true });
  });

  test.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['an object', { on: true }],
  ])('fat finger: %s is a 400, changes nothing and writes no switch audit row', async (_n, bad) => {
    const before = await settingsOf(T.eventId);
    const audits = (await switchAudit()).length;
    const res = await put({ useSponsors: bad });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('INVALID_SETTINGS');
    expect(await settingsOf(T.eventId)).toEqual(before);
    expect((await switchAudit()).length).toBe(audits);
  });

  test('a write that does not name the switch writes no switch audit row', async () => {
    const audits = (await switchAudit()).length;
    expect((await put({ displayDwellSeconds: 20 })).status).toBe(200);
    expect((await switchAudit()).length).toBe(audits);
  });

  test('an admin of another brand gets 404, and neither the setting nor the audit trail changes', async () => {
    const [a, b] = BRANDS;
    const target = b.activeEventId;
    const before = await settingsOf(target);
    const res = await callAs({ kind: 'owner', brand: a }, 'PUT', `/api/v2/admin/events/${target}`, {
      settings: { useSponsors: true },
    });
    expect(res.status).toBe(404);
    expect(await settingsOf(target)).toEqual(before);
    expect(await switchAudit(target)).toHaveLength(0);
  });

  test('the brand’s own admin can turn it on (no tier is asked for), and it is audited under their name', async () => {
    const [, b] = BRANDS;
    const res = await callAs(
      { kind: 'owner', brand: b },
      'PUT',
      `/api/v2/admin/events/${b.activeEventId}`,
      { settings: { useSponsors: true } }
    );
    expect(res.status).toBe(200);
    expect((await settingsOf(b.activeEventId)).useSponsors).toBe(true);
    const rows = await switchAudit(b.activeEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(b.ownerEmail);
    expect(rows[0].brand_id).toBe(b.brandId);
  });

  test('no caller, and a key with no scope, cannot flip it', async () => {
    const [, b] = BRANDS;
    const before = await settingsOf(b.activeEventId);
    for (const caller of [{ kind: 'anonymous' }, { kind: 'key-none' }] as const) {
      const res = await callAs(caller, 'PUT', `/api/v2/admin/events/${b.activeEventId}`, {
        settings: { useSponsors: false },
      });
      expect(res.status).toBeGreaterThanOrEqual(401);
      expect(await settingsOf(b.activeEventId)).toEqual(before);
    }
  });

  test('the admin list says whether the event uses sponsors', async () => {
    const res = await callAs({ kind: 'key-all' }, 'GET', '/api/v2/admin/events?limit=100');
    const items = ((await res.json()) as { items: { id: string; use_sponsors: number }[] }).items;
    const by = (id: string) => items.find((e) => e.id === id)?.use_sponsors;
    expect(by(ON.eventId)).toBe(1);
    expect(by(OFF.eventId)).toBe(0);
    expect(by(ABSENT.eventId)).toBe(0);
  });

  test('an event created with the switch on is on; one created without it is off', async () => {
    const make = async (settings?: unknown) => {
      const res = await callAs({ kind: 'key-all' }, 'POST', '/api/v2/admin/events', {
        title: `Optin created ${Math.random().toString(36).slice(2, 8)}`,
        brand_id: MATRIX_BRAND,
        ...(settings ? { settings } : {}),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    expect((await settingsOf(await make())).useSponsors).toBeUndefined();
    expect((await settingsOf(await make({ useSponsors: true }))).useSponsors).toBe(true);
  });
});

describe('failures', () => {
  test.each([
    ['text that is not JSON', 'not json'],
    ['a JSON array', '[true]'],
    ['the number 1', '{"useSponsors":1}'],
    ['the string "true"', '{"useSponsors":"true"}'],
    ['null', '{"useSponsors":null}'],
    ['an empty string', ''],
  ])('settings holding %s read as off, and no reader fails', async (_n, stored) => {
    const t: Target = { eventId: 'optin-odd', sponsorId: 'optin-s-odd', name: 'Optin Odd Grocer' };
    await seedAccepted(t, stored);
    for (const [name, read] of Object.entries(READERS)) {
      expect(await read(t), name).toBe(false);
    }
    expect((await SELF.fetch(`https://t.test/events/${t.eventId}`)).status).toBe(200);
    expect((await SELF.fetch('https://t.test/events')).status).toBe(200);
    expect((await SELF.fetch('https://t.test/')).status).toBe(200);
  });

  test('a failed sponsor read leaves the card list with no sponsor line, not an error', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 is down');
      },
    } as unknown as D1Database;
    expect((await fetchSponsorTitles(broken, BRAND)).size).toBe(0);
    expect((await fetchSponsorTitles(null, BRAND)).size).toBe(0);
  });
});

describe('the backfill (migration 0107)', () => {
  const BF = 'ose-optin-backfill';
  const statement = (): string => {
    const all = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[];
    const mine = all.filter((s) => s.includes('useSponsors'));
    expect(mine, 'migration 0107 is one UPDATE').toHaveLength(1);
    return mine[0];
  };
  const seed = async (
    key: string,
    settingsJson: string,
    p: null | {
      active?: number;
      sponsor?: number | null;
      organizer: number | null;
      source?: string;
      sponsorBrand?: string;
      businessActive?: number;
    }
  ) => {
    await seedEvent(`optb-${key}`, settingsJson, BF);
    if (!p) return;
    await seedSplitSponsor(tenv.DB, {
      id: `optb-s-${key}`,
      eventId: `optb-${key}`,
      brandId: p.sponsorBrand ?? BF,
      isActive: p.active ?? 1,
    });
    await setPlacement(`optb-s-${key}`, {
      sponsor: p.sponsor === undefined ? 1 : p.sponsor,
      organizer: p.organizer,
      source: p.source ?? 'organizer',
    });
    if (p.businessActive === 0) {
      await tenv.DB.prepare('UPDATE sponsor_business SET is_active = 0 WHERE id = ?')
        .bind(`optb-s-${key}`)
        .run();
    }
  };
  const on = async (key: string) => (await settingsOf(`optb-${key}`)).useSponsors;

  beforeAll(async () => {
    await seed('accepted', '{}', { organizer: 1 });
    await seed('silent', '{}', { organizer: null });
    await seed('pending-sponsor', '{}', { organizer: 1, sponsor: null });
    await seed('keeps-settings', '{"showQRSection":false,"displayDwellSeconds":30}', {
      organizer: 1,
    });
    await seed('approved-request', '{}', { organizer: 1, source: 'sponsor_request' });
    await seed('none', '{}', null);
    await seed('declined', '{}', { organizer: 0 });
    await seed('waiting-request', '{}', { organizer: null, source: 'sponsor_request', active: 0 });
    await seed('switched-off', '{}', { organizer: 1, active: 0 });
    await seed('other-brand', '{}', { organizer: 1, sponsorBrand: 'ose-optin-elsewhere' });
    await seed('deleted-business', '{}', { organizer: 1, businessActive: 0 });
    await seed('chose-off', '{"useSponsors":false}', { organizer: 1 });
    await seed('garbled', 'not json', { organizer: 1 });
    await tenv.DB.prepare(statement()).run();
  });

  test.each(['accepted', 'silent', 'pending-sponsor', 'approved-request'])(
    'an event whose organizer already chose a sponsor (%s) is switched on',
    async (key) => {
      expect(await on(key)).toBe(true);
    }
  );

  test('the event’s other settings are kept', async () => {
    expect(await settingsOf('optb-keeps-settings')).toEqual({
      showQRSection: false,
      displayDwellSeconds: 30,
      useSponsors: true,
    });
  });

  test.each([
    'none',
    'declined',
    'waiting-request',
    'switched-off',
    'other-brand',
    'deleted-business',
  ])('an event the organizer did not choose a sponsor for (%s) stays off', async (key) => {
    expect(await on(key)).toBeUndefined();
  });

  test('an explicit off is never turned on by the backfill', async () => {
    expect(await on('chose-off')).toBe(false);
  });

  test('unreadable settings are replaced, so the sponsor the organizer chose still shows', async () => {
    expect(await settingsOf('optb-garbled')).toEqual({ useSponsors: true });
  });

  test('running it twice changes nothing more', async () => {
    const before = await tenv.DB.prepare(
      `SELECT id, settings_json FROM events WHERE brand_id = ? ORDER BY id`
    )
      .bind(BF)
      .all();
    const res = await tenv.DB.prepare(statement()).run();
    expect(res.meta.changes).toBe(0);
    const after = await tenv.DB.prepare(
      `SELECT id, settings_json FROM events WHERE brand_id = ? ORDER BY id`
    )
      .bind(BF)
      .all();
    expect(after.results).toEqual(before.results);
  });
});
