/**
 * Voting S3d and S3e (OSE-2140, OSE-2142; part of OSE-1193; OSE ADR-040
 * decision 6 and the amendment "nothing is more live than its container";
 * owner decisions, 2026-11-18).
 *
 * Workers-pool layer (miniflare D1, the real router and migrations).
 *
 * S3d, the room's own vote code. Each rule is named after the fault it was
 * watched failing on:
 *   - "an ordinary poster code with ?type=vote mints no pass" [the old
 *     `?type=` check restored: the mint ignores which placement was scanned];
 *   - "only the vote code mints a pass" [any code of the event accepted: the
 *     `is_vote_code` test dropped from voteCodeMayMint];
 *   - "the vote code's token is in no public answer" [the token added to the
 *     poster bundle: the bundle's `is_vote_code = 0` dropped];
 *   - one vote code in use per event; a second make returns the first; the
 *     admin poster list leaves it out; the admin routes work with the switch off.
 *
 * S3e, a vote set follows its event's status:
 *   - "a set on a draft or ready event cannot open" [EVENT_ON kept for open];
 *   - "a set on a draft event can be made and given objects" [EVENT_LIVE used
 *     for create];
 *   - "/q mints no pass for an event that is not Published" [status check
 *     removed from the mint];
 *   - "unpublishing an event leaves no set readable as open by the admin card
 *     or the pass" [the close rule removed: closeVoteSetUnlessPublished taken
 *     out of the PUT status batch, and out of the verify undo];
 *   - "a set on an unlisted Published event opens" [listed required];
 *   - a set that has opened takes no new object while its event is not
 *     Published; a host reopens it once the event is Published again.
 *
 * Staging twin: bruno/ose-api/27. Vote code and event status (OSE-2140 OSE-2142).
 *
 * @born-red OSE-2140 OSE-2142 | method: injected-fault, each removed after;
 *   listed with counts in the PR body | date: 2026-11-18
 */

import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { linkVenue } from './helpers/link-venue';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { handleQrScan, qrScanTarget, type QrScanEnv } from '../src/handlers/qr-scan';
import { openVotePass } from '../src/lib/vote-pass';
import { EVENT_LIVE, EVENT_PUBLISHED_STATUS } from '../src/lib/event-live';
import { runVoteFinalJob } from '../src/lib/vote-sets';
import { readEventScanCells, scansOf } from '../src/lib/scan-cells';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { readPosterReach } from '../src/lib/poster-reach';
import { readPreEventActivity } from '../src/lib/pre-event-activity';
import { collectGoLiveEvidence } from '../src/lib/go-live-evidence';
import { voteCodeStamp } from '../src/lib/vote-code-window';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
  VOTING_ENABLED?: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;

const BRAND = 'brand-vcode';
const OWNER = 'owner-vcode@example.com';
const NIGHT = 'evt-vcode-night'; // Published (unlisted), a vote set open
const PREP = 'evt-vcode-prep'; // a draft night being set up
const ORIGIN = 'https://ose.test';
const POSTER_TOKEN = 'qrt_vcode_poster_0001'; // an ordinary poster placement of NIGHT
const POSTER_ID = 'pd-vcode-poster';
const COOKIE = 'anon_99999999-8888-7777-6666-555555555555';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = () => Math.floor(Date.now() / 1000);
const ADMIN = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now() - 10,
    exp: now() + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? ADMIN : { ...ADMIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

async function applyMigrations(db: D1Database, statements: string): Promise<void> {
  for (const stmt of JSON.parse(statements) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const one = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Record<string, any>>();

async function seedEvent(id: string, status: string, date = '2099-06-01') {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date, timezone,
                         starts_at, event_type_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 'Eagles Hall', ?, ?, 'America/Chicago',
             ? || 'T19:00:00-06:00', 'etr-rec-bocce', datetime('now'), datetime('now'))`,
    id,
    BRAND,
    `Vote code fixture ${id}`,
    id,
    status,
    date,
    date,
    date
  );
  await linkVenue(tenv.DB, id);
}

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      store.delete(k);
    },
  } as unknown as KVNamespace;
}

const scanEnv = (): QrScanEnv => ({
  DB: tenv.DB,
  RATE_LIMIT_KV: makeKV(),
  ANON_ID_HASH_PEPPER: PEPPER,
  VOTING_ENABLED: 'on',
});

/** Scan a token as /q does, with the switch on. `type` null sends no ?type=. */
async function scan(token: string, type: string | null = 'vote'): Promise<Response> {
  // The rotating code: a vote scan carries this minute's stamp, as the room screen shows it.
  const stamp = type === 'vote' ? `&w=${await voteCodeStamp(PEPPER, token, Date.now())}` : '';
  const url = `${ORIGIN}/q/${token}${type === null ? '' : `?type=${type}${stamp}`}`;
  return handleQrScan(
    new Request(url, { headers: { Cookie: `ose_anon=${COOKIE}`, 'User-Agent': 'vote-code-test' } }),
    scanEnv(),
    token,
    true
  );
}

function passOf(res: Response): string | null {
  const hash = new URL(res.headers.get('Location') ?? '', ORIGIN).hash;
  return hash.startsWith('#t=') ? hash.slice(3) : null;
}

/** The night's vote code: made through the admin route. Returns its token and placement id. */
async function makeCode(eventId = NIGHT): Promise<{ token: string; id: string; url: string }> {
  const r = await call('POST', vp(eventId, '/code'), {});
  expect([200, 201]).toContain(r.status);
  const url = String(r.json.code.url);
  const token = new URL(url).pathname.replace(/^\/q\//, '');
  return { token, id: String(r.json.code.id), url };
}

/** Make NIGHT's set with one song, open the set and the song. */
async function openNight(eventId = NIGHT, extra: string[] = []): Promise<string[]> {
  expect((await call('POST', vp(eventId), { played_by: 'object' })).status).toBe(201);
  const song = await call('POST', vp(eventId, '/objects'), { kind: 'song', label: 'Song one' });
  expect(song.status).toBe(201);
  // Everything is added before voting opens (OBJECTS_FIXED after).
  const ids: string[] = [];
  for (const label of extra) {
    const more = await call('POST', vp(eventId, '/objects'), { kind: 'song', label });
    expect(more.status).toBe(201);
    ids.push(more.json.object.id as string);
  }
  expect((await call('POST', vp(eventId, '/open'), { room_size: 200 })).status).toBe(200);
  expect((await call('POST', vp(eventId, `/objects/${song.json.object.id}/open`), {})).status).toBe(
    200
  );
  return ids;
}

const setState = async (eventId: string) =>
  (await one(`SELECT state FROM vote_sets WHERE event_id = ?`, eventId))?.state as string;

beforeAll(async () => {
  await applyMigrations(tenv.DB, tenv.TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv.FORMS_DB, tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

beforeEach(async () => {
  const like = 'evt-vcode-%';
  // Everything a scan or a public read may have written for these events.
  for (const t of [
    'scan_placement_events',
    'scan_node_returns',
    'scan_aggregates',
    'scan_cell_aggregates',
    'anon_id_returns',
    'share_opens_daily',
    'shortlinks',
    'event_codes',
  ])
    await run(`DELETE FROM ${t} WHERE event_id LIKE ?`, like).catch((e: unknown) => {
      if (!/no such (column|table)/.test(String(e))) throw e;
    });
  await run(
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    like
  );
  await run(`DELETE FROM votable_objects WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM vote_sets WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM poster_deployments WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM admin_audit_log WHERE resource_id LIKE ?`, like);
  await run(`DELETE FROM events WHERE id LIKE ?`, like);
  await seedEvent(NIGHT, 'active');
  await seedEvent(PREP, 'draft');
  await run(
    `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, created_at)
     VALUES (?, ?, ?, 'Front door', 1, datetime('now'))`,
    POSTER_ID,
    NIGHT,
    POSTER_TOKEN
  );
});

// ── S3d: the room's own vote code ────────────────────────────────────────────

describe('OSE-2140 | the room has its own vote code', () => {
  test('OSE-2140 | SECURITY | an ordinary poster code with ?type=vote mints no pass', async () => {
    await openNight();
    await makeCode();
    const res = await scan(POSTER_TOKEN);
    expect(res.status).toBe(302);
    expect(passOf(res)).toBeNull();
    expect(res.headers.get('Location')).toBe(qrScanTarget(ORIGIN, NIGHT, POSTER_ID, 'vote'));
  });

  test('OSE-2140 | SECURITY | only the vote code mints a pass', async () => {
    await openNight();
    const code = await makeCode();
    // The URL carries this minute's stamp (the rotating code).
    const prefix = `${ORIGIN}/q/${code.token}?type=vote&w=`;
    expect(code.url.startsWith(prefix)).toBe(true);
    expect(code.url.slice(prefix.length)).toMatch(/^\d+\.[0-9a-f]{32}$/);
    expect(code.token).toMatch(/^qrt_[0-9a-f]{32}$/);
    const res = await scan(code.token);
    const loc = new URL(res.headers.get('Location') ?? '');
    expect(loc.pathname).toBe(`/events/${NIGHT}/vote`);
    expect(loc.search).toBe('');
    const pass = passOf(res);
    expect(await openVotePass(PEPPER, pass, Date.now(), NIGHT)).not.toBeNull();
    // The poster code of the same event, in the same browser, still mints none.
    expect(passOf(await scan(POSTER_TOKEN))).toBeNull();
    // The vote code without ?type=vote keeps today's redirect.
    expect(passOf(await scan(code.token, null))).toBeNull();
    // A retired vote code resolves to nothing at all.
    await run(`UPDATE poster_deployments SET is_active = 0 WHERE id = ?`, code.id);
    const retired = await scan(code.token);
    expect(retired.headers.get('Location')).toBe('/');
  });

  test("OSE-2140 | SECURITY | the vote code's token is in no public answer", async () => {
    await openNight();
    const code = await makeCode();
    const publicReads = [
      `/api/v2/events/${NIGHT}/poster-bundle?deployment=${code.id}`,
      `/api/v2/events/${NIGHT}/poster-bundle`,
      `/api/v2/events/${NIGHT}`,
      `/events/${NIGHT}?type=register&deployment=${code.id}`,
    ];
    for (const path of publicReads) {
      const res = await SELF.fetch(`${ORIGIN}${path}`);
      const text = await res.text();
      expect(res.status, path).toBe(200);
      expect(text.includes(code.token), path).toBe(false);
    }
    // The bundle asked for the vote code answers as for no placement: no /q link at all.
    const bundle = (await (
      await SELF.fetch(`${ORIGIN}/api/v2/events/${NIGHT}/poster-bundle?deployment=${code.id}`)
    ).json()) as Json;
    expect(JSON.stringify(bundle.links ?? {})).not.toContain('/q/');
    // The same request with the ordinary poster's id does route through /q.
    const poster = (await (
      await SELF.fetch(`${ORIGIN}/api/v2/events/${NIGHT}/poster-bundle?deployment=${POSTER_ID}`)
    ).json()) as Json;
    expect(JSON.stringify(poster.links ?? {})).toContain(`/q/${POSTER_TOKEN}`);
  });

  test('OSE-2140 | one vote code in use per event; a second make returns the first', async () => {
    const first = await call('POST', vp(PREP, '/code'), {});
    expect(first.status).toBe(201);
    const again = await call('POST', vp(PREP, '/code'), {});
    expect(again.status).toBe(200);
    expect(again.json.code).toEqual(first.json.code);
    const listed = await call('GET', vp(PREP));
    expect(listed.json.code).toEqual(first.json.code);
    await expect(
      run(
        `INSERT INTO poster_deployments (id, event_id, qr_token, is_vote_code, is_active) VALUES ('pd-vcode-dupe', ?, 'qrt_vcode_dupe', 1, 1)`,
        PREP
      )
    ).rejects.toThrow(/UNIQUE/);
    // Retired, a new make gives a new token.
    await run(`UPDATE poster_deployments SET is_active = 0 WHERE id = ?`, first.json.code.id);
    const fresh = await call('POST', vp(PREP, '/code'), {});
    expect(fresh.status).toBe(201);
    expect(fresh.json.code.url).not.toBe(first.json.code.url);
  });

  test('OSE-2140 | SECURITY | replacing the vote code retires the old token at once', async () => {
    await openNight();
    const old = await makeCode();
    expect(passOf(await scan(old.token))).not.toBeNull();
    const r = await call('POST', vp(NIGHT, '/code/replace'), {});
    expect(r.status).toBe(201);
    const fresh = new URL(String(r.json.code.url)).pathname.replace(/^\/q\//, '');
    expect(fresh).not.toBe(old.token);
    expect(r.json.code.id).not.toBe(old.id);
    // The photographed code resolves to nothing; the new one mints.
    expect((await scan(old.token)).headers.get('Location')).toBe('/');
    expect(passOf(await scan(fresh))).not.toBeNull();
    expect((await call('GET', vp(NIGHT))).json.code.id).toBe(r.json.code.id);
    const audit = await one(
      `SELECT outcome FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_CODE_REPLACE'`,
      NIGHT
    );
    expect(audit?.outcome).toBe('success');
  });

  test('OSE-2140 | SECURITY | the placement edit never brings a vote code back, nor makes or unmakes one', async () => {
    const old = await makeCode();
    await call('POST', vp(NIGHT, '/code/replace'), {});
    const revive = await call('PUT', `/api/v2/admin/poster-deployments/${old.id}`, {
      is_active: 1,
    });
    expect(revive.status).toBe(409);
    expect(revive.json.code).toBe('VOTE_CODE_MANAGED');
    expect(
      (await one(`SELECT is_active FROM poster_deployments WHERE id = ?`, old.id))?.is_active
    ).toBe(0);
    // is_vote_code is not a field of the edit: a poster stays a poster, a code stays a code.
    for (const [id, want] of [
      [POSTER_ID, 0],
      [old.id, 1],
    ] as const) {
      await call('PUT', `/api/v2/admin/poster-deployments/${id}`, {
        is_vote_code: want === 1 ? 0 : 1,
        placement_label: 'Edited',
      });
      expect(
        (await one(`SELECT is_vote_code FROM poster_deployments WHERE id = ?`, id))?.is_vote_code
      ).toBe(want);
    }
  });

  test('OSE-2140 | the admin poster list leaves the vote code out; the make is audited', async () => {
    const code = await makeCode();
    const list = await call('GET', `/api/v2/admin/events/${NIGHT}/poster-deployments`);
    expect(list.status).toBe(200);
    const ids = (list.json.items as Json[]).map((i) => i.id);
    expect(ids).toContain(POSTER_ID);
    expect(ids).not.toContain(code.id);
    expect(JSON.stringify(list.json)).not.toContain(code.token);
    const audit = await one(
      `SELECT outcome, details FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_CODE_CREATE'`,
      NIGHT
    );
    expect(audit?.outcome).toBe('success');
  });

  test('OSE-2140 | the admin routes work with VOTING_ENABLED off (owner, 2026-11-18)', async () => {
    expect(tenv.VOTING_ENABLED).not.toBe('on');
    const r = await call('POST', vp(PREP, '/code'), {});
    expect(r.status).toBe(201);
    expect((await call('POST', vp(PREP), {})).status).toBe(201);
  });
});

describe('OSE-2140 | the vote code is not a poster in any number (owner, 2026-11-18)', () => {
  /** n placement scans in one hour, enough to clear the K-floor of 5. */
  async function seedScans(posterId: string, n: number) {
    for (let i = 0; i < n; i++)
      await run(
        `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket, created_at)
         VALUES (?, ?, ?, '2099-06-01T20:00', datetime('now'))`,
        `spe-vcode-${posterId}-${i}`,
        NIGHT,
        posterId
      );
  }

  test('OSE-2140 | PRIVACY | a vote-code scan is in no poster figure: not the SharedReport attribution, the cells, reach or the poster count', async () => {
    const code = await makeCode();
    await seedScans(POSTER_ID, 6);
    await seedScans(code.id, 7);

    const cells = await readEventScanCells(tenv.DB, NIGHT);
    expect(new Set(cells.map((c) => c.poster))).toEqual(new Set([POSTER_ID]));

    const report = await buildSharedReport(tenv.DB, NIGHT);
    expect(report.ok, JSON.stringify(report)).toBe(true);
    if (!report.ok) return;
    const ids = report.report.poster_attribution.map((p) => p.poster_deployment_id);
    expect(ids).toContain(POSTER_ID);
    expect(ids).not.toContain(code.id);
    expect(JSON.stringify(report.report)).not.toContain('(room screen)');

    const reach = await readPosterReach(tenv.DB, NIGHT);
    expect(JSON.stringify(reach)).not.toContain(code.id);
    expect(reach.totals.scans).toEqual(scansOf(cells));

    const activity = await readPreEventActivity(tenv.DB, NIGHT);
    expect(activity.posters).toBe(1);

    // The brand's operations dashboard: poster scans (also its anonymous
    // participation figure) and active posters leave the vote code out.
    const ops = await call('GET', '/api/v2/admin/dashboards/operations?data_class=all');
    expect(ops.status, JSON.stringify(ops.json)).toBe(200);
    expect(ops.json.reach.poster_scans).toEqual(scansOf(cells));
    expect(ops.json.participation.anonymous.scans).toEqual(scansOf(cells));
    expect(ops.json.reach.active_posters).toBe(1);
  });

  test('OSE-2140 | the vote code is never the working code an event needs to go live (#1456)', async () => {
    await makeCode(PREP);
    expect((await collectGoLiveEvidence(tenv.DB, PREP)).active_deployments).toBe(0);
    await run(
      `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, created_at)
       VALUES ('pd-vcode-prep-poster', ?, 'qrt_vcode_prep_0001', 'Front door', 1, datetime('now'))`,
      PREP
    );
    expect((await collectGoLiveEvidence(tenv.DB, PREP)).active_deployments).toBe(1);
  });
});

// ── S3e: nothing is more live than its container ─────────────────────────────

describe('OSE-2142 | a vote set follows its event status', () => {
  test('OSE-2142 | a set on a draft or ready event cannot open', async () => {
    for (const status of ['draft', 'ready']) {
      await run(`UPDATE events SET status = ? WHERE id = ?`, status, PREP);
      if (!(await one(`SELECT 1 FROM vote_sets WHERE event_id = ?`, PREP)))
        expect((await call('POST', vp(PREP), {})).status).toBe(201);
      const res = await call('POST', vp(PREP, '/open'), { room_size: 200 });
      expect(res.status, status).toBe(409);
      expect(res.json.code, status).toBe('EVENT_NOT_PUBLISHED');
      const row = await one(`SELECT state, pepper_epoch FROM vote_sets WHERE event_id = ?`, PREP);
      expect(row?.state, status).toBe('draft');
      expect(row?.pepper_epoch, status).toBeNull();
      const list = await call('GET', vp(PREP));
      expect(list.json.event_live, status).toBe(false);
    }
  });

  test('OSE-2142 | a set on a draft event can be made and given objects', async () => {
    expect((await call('POST', vp(PREP), { played_by: 'object' })).status).toBe(201);
    const song = await call('POST', vp(PREP, '/objects'), { kind: 'song', label: 'Song one' });
    expect(song.status).toBe(201);
    const edit = await call('PUT', vp(PREP, `/objects/${song.json.object.id}`), {
      label: 'Song one (live)',
    });
    expect(edit.status).toBe(200);
    expect(edit.json.object.label).toBe('Song one (live)');
    // Published, the same set opens.
    await run(`UPDATE events SET status = 'active' WHERE id = ?`, PREP);
    const open = await call('POST', vp(PREP, '/open'), { room_size: 200 });
    expect(open.status).toBe(200);
    expect(open.json.set.state).toBe('open');
  });

  test('OSE-2142 | a set on an unlisted Published event opens', async () => {
    const ev = await one(`SELECT status, is_published FROM events WHERE id = ?`, NIGHT);
    expect(ev).toMatchObject({ status: EVENT_PUBLISHED_STATUS, is_published: 0 });
    await openNight();
    expect(await setState(NIGHT)).toBe('open');
    expect((await call('GET', vp(NIGHT))).json.event_live).toBe(true);
  });

  test('OSE-2142 | SECURITY | /q mints no pass for an event that is not Published', async () => {
    await openNight();
    const code = await makeCode();
    expect(passOf(await scan(code.token))).not.toBeNull();
    // Held open by a write that bypassed the status change (an old row, a
    // seed): the mint itself still refuses every status but Published.
    for (const status of ['draft', 'ready', 'archived']) {
      await run(`UPDATE events SET status = ? WHERE id = ?`, status, NIGHT);
      await run(`UPDATE vote_sets SET state = 'open' WHERE event_id = ?`, NIGHT);
      expect(passOf(await scan(code.token)), status).toBeNull();
    }
    // Published but past its dates: not live either.
    await run(
      `UPDATE events SET status = 'active', start_date = '2020-01-01', end_date = '2020-01-01' WHERE id = ?`,
      NIGHT
    );
    await run(`UPDATE vote_sets SET state = 'open' WHERE event_id = ?`, NIGHT);
    expect(passOf(await scan(code.token))).toBeNull();
  });

  /** Move NIGHT through the admin's own doors, as a host would. */
  async function moveTo(status: string): Promise<void> {
    const r = await call('PUT', `/api/v2/admin/events/${NIGHT}`, { status });
    expect(r.status, `PUT status ${status}: ${JSON.stringify(r.json)}`).toBe(200);
  }

  test('OSE-2142 | SECURITY | unpublishing an event leaves no set readable as open by the admin card or the pass', async () => {
    // The set opens with its song still in draft: once a window has run, a
    // closed set stays closed (WINDOWS_STARTED, checked at the end).
    expect((await call('POST', vp(NIGHT), { played_by: 'object' })).status).toBe(201);
    const song = await call('POST', vp(NIGHT, '/objects'), { kind: 'song', label: 'Song one' });
    expect(song.status).toBe(201);
    expect((await call('POST', vp(NIGHT, '/open'), { room_size: 200 })).status).toBe(200);
    const code = await makeCode();
    // Each way out of Published, and back: Ready; Archived; Ready then Draft.
    const ways: [string[], string[]][] = [
      [['ready'], ['active']],
      [['archived'], ['active']],
      [
        ['ready', 'draft'],
        ['ready', 'active'],
      ],
    ];
    for (const [out, back] of ways) {
      const label = out.join(' > ');
      expect(await setState(NIGHT), label).toBe('open');
      for (const s of out) await moveTo(s);
      const card = await call('GET', vp(NIGHT));
      expect(card.json.set.state, label).toBe('closed');
      expect(card.json.event_live, label).toBe(false);
      expect(await setState(NIGHT), label).toBe('closed');
      expect(passOf(await scan(code.token)), label).toBeNull();
      // Published again, it stays closed: nothing reopens it but the host.
      for (const s of back) await moveTo(s);
      expect(await setState(NIGHT), label).toBe('closed');
      expect(passOf(await scan(code.token)), label).toBeNull();
      const re = await call('POST', vp(NIGHT, '/reopen'), {});
      expect(re.status, label).toBe(200);
      expect(passOf(await scan(code.token)), label).not.toBeNull();
    }
    // A window runs; an unpublish then closes the set, and it stays closed:
    // a status change is no pause button on a running window.
    const opened = await call('POST', vp(NIGHT, `/objects/${song.json.object.id}/open`), {});
    expect(opened.status).toBe(200);
    await moveTo('ready');
    await moveTo('active');
    const re = await call('POST', vp(NIGHT, '/reopen'), {});
    expect(re.status).toBe(409);
    expect(re.json.code).toBe('WINDOWS_STARTED');
    expect(await setState(NIGHT)).toBe('closed');
    expect(passOf(await scan(code.token))).toBeNull();
  });

  test('SECURITY | a date moved into the past is no pause button: the set closes and stays closed (CCR loop 6, F1)', async () => {
    await openNight();
    const code = await makeCode();
    expect(await setState(NIGHT)).toBe('open');
    // A field-only edit that keeps the event on its dates leaves voting alone.
    expect(
      (await call('PUT', `/api/v2/admin/events/${NIGHT}`, { title: 'Song night, renamed' })).status
    ).toBe(200);
    expect(await setState(NIGHT)).toBe('open');
    // The end date moved into the past, mid-window: the set closes in the same batch.
    const past = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      start_date: '2000-01-01',
      end_date: '2000-01-01',
    });
    expect(past.status, JSON.stringify(past.json)).toBe(200);
    expect(await setState(NIGHT)).toBe('closed');
    // Moved back, it stays closed, and a window has run, so it cannot reopen.
    const back = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      start_date: '2099-06-01',
      end_date: '2099-06-01',
    });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    expect(await setState(NIGHT)).toBe('closed');
    expect(passOf(await scan(code.token))).toBeNull();
    const re = await call('POST', vp(NIGHT, '/reopen'), {});
    expect(re.json.code).toBe('WINDOWS_STARTED');
  });

  test('SECURITY | dates that lapse on their own are no pause button: the next edit closes the set (CCR loop 7, M1)', async () => {
    await openNight();
    const code = await makeCode();
    expect(await setState(NIGHT)).toBe('open');
    // Time runs past the event's last date with no edit: the set row is still
    // open, and the live check refuses votes (written here as the date lapsing).
    await run(
      `UPDATE events SET start_date = '2000-01-01', end_date = '2000-01-01' WHERE id = ?`,
      NIGHT
    );
    expect(await setState(NIGHT)).toBe('open');
    // The host moves the dates forward to revive the running window: the edit
    // closes the set first, because the event was not live when it came in.
    const back = await call('PUT', `/api/v2/admin/events/${NIGHT}`, {
      start_date: '2099-06-01',
      end_date: '2099-06-01',
    });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
    expect(await setState(NIGHT)).toBe('closed');
    expect(passOf(await scan(code.token))).toBeNull();
    const re = await call('POST', vp(NIGHT, '/reopen'), {});
    expect(re.json.code).toBe('WINDOWS_STARTED');
  });

  test('OSE-2142 | SECURITY | the QR verify undo (active to ready) closes the set in the same batch', async () => {
    await openNight();
    const undo = await call('POST', `/api/v2/admin/events/${NIGHT}/unverify-qr`, {});
    expect(undo.status, JSON.stringify(undo.json)).toBe(200);
    expect(await setState(NIGHT)).toBe('closed');
    const reopen = await call('POST', vp(NIGHT, '/reopen'), {});
    expect(reopen.status).toBe(409);
    expect(reopen.json.code).toBe('EVENT_NOT_PUBLISHED');
  });

  test('OSE-2142 | a field-only edit of a Published event leaves its open set alone', async () => {
    await openNight();
    const r = await call('PUT', `/api/v2/admin/events/${NIGHT}`, { title: 'Renamed night' });
    expect(r.status).toBe(200);
    expect(await setState(NIGHT)).toBe('open');
  });

  test('OSE-2142 | the nightly job closes a set left open by a status write outside the app', async () => {
    await openNight();
    const code = await makeCode();
    await run(`UPDATE events SET status = 'ready' WHERE id = ?`, NIGHT);
    expect(await setState(NIGHT)).toBe('open');
    expect(passOf(await scan(code.token))).toBeNull();
    await runVoteFinalJob({ DB: tenv.DB });
    expect(await setState(NIGHT)).toBe('closed');
  });

  test('OSE-2142 | a set that has opened takes no object, and opens no object, while its event is not Published', async () => {
    const [songTwo] = await openNight(NIGHT, ['Song two']);
    const draftSong = { json: { object: { id: songTwo } } };
    await run(`UPDATE events SET status = 'ready' WHERE id = ?`, NIGHT);
    // An opened set takes no new object at all (OBJECTS_FIXED, 2026-11-26).
    const add = await call('POST', vp(NIGHT, '/objects'), { kind: 'song', label: 'Song three' });
    expect(add.status).toBe(409);
    expect(add.json.code).toBe('OBJECTS_FIXED');
    // Held open by a bypassing write, an object still does not open.
    await run(`UPDATE vote_sets SET state = 'open' WHERE event_id = ?`, NIGHT);
    const openObj = await call('POST', vp(NIGHT, `/objects/${draftSong.json.object.id}/open`), {});
    expect(openObj.status).toBe(409);
    expect(openObj.json.code).toBe('EVENT_NOT_PUBLISHED');
    // Archived reads as over, as before.
    await run(`UPDATE events SET status = 'archived' WHERE id = ?`, NIGHT);
    const over = await call('POST', vp(NIGHT, '/objects'), { kind: 'song', label: 'Song four' });
    expect(over.json.code).toBe('OBJECTS_FIXED');
  });

  test('OSE-2142 | migration 0113 closes a set already open on an event that is not Published', async () => {
    const statements = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[];
    const oneOff = statements.find(
      (s) =>
        /^UPDATE vote_sets/m.test(s.replace(/^--[^\n]*\n/gm, '')) && /status <> 'active'/.test(s)
    );
    expect(oneOff).toBeTruthy();
    await openNight();
    expect((await call('POST', vp(PREP), {})).status).toBe(201);
    // Both sets forced open, as S3 could leave them on staging; NIGHT stays Published.
    await run(`UPDATE vote_sets SET state = 'open' WHERE event_id IN (?, ?)`, NIGHT, PREP);
    await tenv.DB.prepare(oneOff as string).run();
    expect(await setState(PREP)).toBe('closed');
    expect(await setState(NIGHT)).toBe('open');
  });

  test('OSE-2142 | EVENT_LIVE is Published and on its dates, listed or unlisted', async () => {
    const live = async (id: string) =>
      !!(await tenv.DB.prepare(`SELECT 1 AS hit WHERE ${EVENT_LIVE}`).bind(id).first());
    expect(await live(NIGHT)).toBe(true);
    await run(`UPDATE events SET is_published = 1 WHERE id = ?`, NIGHT);
    expect(await live(NIGHT)).toBe(true);
    expect(await live(PREP)).toBe(false);
    expect(await live('evt-vcode-unknown')).toBe(false);
    await run(`UPDATE events SET start_date = NULL, end_date = NULL WHERE id = ?`, NIGHT);
    expect(await live(NIGHT)).toBe(true);
  });
});
