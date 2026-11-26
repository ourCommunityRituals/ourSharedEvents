/**
 * Voting S3: an admin opens, closes and reopens a vote set and its objects
 * (OSE-2127, part of OSE-1193; OSE ADR-040 decisions 3, 4, 6, 7 and 10).
 *
 *   /api/v2/admin/events/:id/votables[/open|reopen|close|finalize]
 *   /api/v2/admin/events/:id/votables/objects[/:oid[/open|reopen|close]]
 *   runVoteFinalJob (the nightly job)
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. another brand's admin gets 404, and nothing changes [scope guard removed];
 *   2. an object of another event under this path gets 404 [event check removed];
 *   3. an email- or phone-shaped label is refused; so is any field not listed;
 *   4. reopen is allowed before final, refused after final, even after an
 *      event-date change [final check removed];
 *   5. the first open stamps the pepper epoch and draws T (5 to 9) and V (10 to
 *      14); a reopen changes none of them [redrawn / restamped at reopen];
 *      with no pepper the set does not open;
 *   6. after the first open, a song's team cannot change [team edited mid-set];
 *   7. a booth must be a stall of the same event, in use (S2 review);
 *   8. every change is audited, and no audit row carries a detail;
 *   9. no admin answer carries a guarded key: no counter, T, V, epoch, void
 *      flag, receipt or marker (S2 review, M4 remainder);
 *  10. the nightly job makes final a set left 7 days after its event that can
 *      hold no vote, and deletes its receipts and markers [job skipped]; since
 *      S5 (OSE-2130) a set that opened is made final too, with its result;
 *      tallies go 30 days after final;
 *  11. an event with a vote set is archived, never deleted.
 *
 * @born-red OSE-2127 | method: injected-fault, each removed after; the list and
 * the counts are in the PR body | date: 2026-11-18
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { pepperEpoch } from '../src/lib/anon-id-hash';
import { matchVotablesRoute } from '../src/handlers/votables';
import {
  drawUniform,
  finalizeVoteSet,
  runVoteFinalJob,
  VOTE_WINDOW_DEFAULT_SECONDS,
  VOTE_WINDOW_MAX_SECONDS,
} from '../src/lib/vote-sets';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-vts-a';
const BRAND_B = 'brand-vts-b';
const OWNER_A = 'owner-vts-a@example.com';
const OWNER_B = 'owner-vts-b@example.com';

const A1 = 'evt-vts-a1'; // a night still to come
const A2 = 'evt-vts-a2'; // another event of the same brand
const B1 = 'evt-vts-b1'; // another brand's night
const OLD = 'evt-vts-old'; // ended 10 days ago
const NODATE = 'evt-vts-nodate'; // no date at all

const TEAM_1 = 'grp_00000001';
const TEAM_2 = 'grp_00000002';
const HEX = (c: string) => c.repeat(64);

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
    'Sec-Fetch-Site': 'same-origin',
  };
}
const A = asEmail(OWNER_A);
const B = asEmail(OWNER_B);

type Json = Record<string, any>;

/** Every answer this file receives, so rule 9 can read them all at the end. */
const ANSWERS: { path: string; json: Json }[] = [];

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
  envOverride: Partial<RouterEnv> = {}
): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...routerEnv, ...envOverride } as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* an empty body reads as {} */
  }
  ANSWERS.push({ path, json });
  return { status: res.status, json };
}

const vp = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/votables${tail}`;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

type Row = Record<string, any>;
const one = async (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .first<Row>();
const all = async (sql: string, ...binds: unknown[]) =>
  (
    await tenv.DB.prepare(sql)
      .bind(...binds)
      .all<Row>()
  ).results;
const run = async (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();

const setRow = (eventId: string) =>
  one(
    `SELECT id, state, played_by, pepper_epoch, secret_margin, secret_floor, is_final, final_at, is_void,
            outcome, winner_object_id, winner_team_id
       FROM vote_sets WHERE event_id = ?`,
    eventId
  );
const objectRow = (id: string) =>
  one(
    `SELECT id, event_id, label, group_id, booth_id, state, closes_at FROM votable_objects WHERE id = ?`,
    id
  );

async function seedEvent(id: string, brand: string, date: string | null) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', ?, ?, 'America/Chicago')`,
    id,
    brand,
    `Vote fixture ${id}`,
    id,
    date,
    date
  );
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Make the set and one song, open the set. Returns the song's id. */
async function openNight(
  eventId = A1,
  playedBy: 'object' | 'team' = 'object',
  extra: string[] = []
): Promise<string> {
  expect((await call('POST', vp(eventId), A, { played_by: playedBy })).status).toBe(201);
  const song = await call('POST', vp(eventId, '/objects'), A, {
    kind: 'song',
    label: 'Song one',
    ...(playedBy === 'team' ? { group_id: TEAM_1 } : {}),
  });
  expect(song.status).toBe(201);
  // Everything is added before voting opens (OBJECTS_FIXED after).
  for (const label of extra)
    expect(
      (
        await call('POST', vp(eventId, '/objects'), A, {
          kind: 'song',
          label,
          ...(playedBy === 'team' ? { group_id: TEAM_1 } : {}),
        })
      ).status
    ).toBe(201);
  expect((await call('POST', vp(eventId, '/open'), A, { room_size: 200 })).status).toBe(200);
  return song.json.object.id as string;
}

/** What S5 will do when it computes results: final, closed, no T or V. */
async function makeFinalAsS5Would(eventId: string) {
  await run(
    `UPDATE vote_sets SET is_final = 1, final_at = '2026-11-18 20:00:00', state = 'closed',
            secret_margin = NULL, secret_floor = NULL WHERE event_id = ?`,
    eventId
  );
}

const same = (json: Json) => {
  const { requestId: _r, timestamp: _t, ...rest } = json;
  return rest;
};

beforeAll(async () => {
  await applyMigrations();
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ]) {
    await run(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
      email,
      brand
    );
  }
});

beforeEach(async () => {
  const like = 'evt-vts-%';
  await run(
    `DELETE FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    like
  );
  await run(
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    like
  );
  await run(
    `DELETE FROM vote_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    like
  );
  await run(
    `DELETE FROM vote_team_markers WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    like
  );
  await run(`DELETE FROM votable_objects WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM vote_sets WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM event_booths WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM admin_audit_log WHERE resource_id LIKE ?`, like);
  await run(`DELETE FROM events WHERE id LIKE ?`, like);
  await seedEvent(A1, BRAND_A, '2099-06-01');
  await seedEvent(A2, BRAND_A, '2099-06-01');
  await seedEvent(B1, BRAND_B, '2099-06-01');
  await seedEvent(OLD, BRAND_A, daysAgo(10));
  await seedEvent(NODATE, BRAND_A, null);
});

// ── 1 and 2: the brand wall and the event wall ───────────────────────────────

describe('1. another brand admin gets 404, and nothing changes', () => {
  test('every route answers 404 for brand B on brand A event', async () => {
    const songId = await openNight();
    const before = await setRow(A1);
    const tries: [string, string, unknown?][] = [
      ['GET', vp(A1)],
      ['POST', vp(A1), {}],
      ['POST', vp(A1, '/close'), {}],
      ['POST', vp(A1, '/reopen'), {}],
      ['POST', vp(A1, '/finalize'), {}],
      ['POST', vp(A1, '/objects'), { kind: 'song', label: 'Sneaky' }],
      ['PUT', vp(A1, `/objects/${songId}`), { label: 'Renamed' }],
      ['POST', vp(A1, `/objects/${songId}/open`), {}],
      ['POST', vp(A1, `/objects/${songId}/close`), {}],
    ];
    for (const [method, path, body] of tries) {
      const res = await call(method, path, B, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(JSON.stringify(res.json)).not.toContain('Song one');
    }
    expect(await setRow(A1)).toEqual(before);
    expect((await objectRow(songId))?.label).toBe('Song one');
    expect(await all(`SELECT id FROM votable_objects WHERE event_id = ?`, A1)).toHaveLength(1);
  });

  test('brand B on its own event works, so the 404 is the wall', async () => {
    expect((await call('POST', vp(B1), B, {})).status).toBe(201);
  });
});

describe('2. an object of another event under this path gets 404', () => {
  test('an A2 object addressed under A1 answers as a missing one, and is not changed', async () => {
    await call('POST', vp(A1), A, {});
    await call('POST', vp(A2), A, {});
    const other = await call('POST', vp(A2, '/objects'), A, { kind: 'song', label: 'A2 song' });
    expect(other.status).toBe(201);
    const oid = other.json.object.id as string;
    await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    await call('POST', vp(A2, '/open'), A, { room_size: 200 });
    const missing = await call('PUT', vp(A1, '/objects/vobj_nope'), A, { label: 'X' });
    for (const [method, tail, body] of [
      ['PUT', `/objects/${oid}`, { label: 'Moved' }],
      ['POST', `/objects/${oid}/open`, {}],
      ['POST', `/objects/${oid}/close`, {}],
      ['POST', `/objects/${oid}/reopen`, {}],
    ] as const) {
      const res = await call(method, vp(A1, tail), A, body);
      expect(res.status, `${method} ${tail}`).toBe(404);
      expect(same(res.json)).toEqual(same(missing.json));
    }
    expect(await objectRow(oid)).toMatchObject({ label: 'A2 song', state: 'draft', event_id: A2 });
  });
});

// ── 3: labels and fields ─────────────────────────────────────────────────────

describe('3. a label names a thing, never a person', () => {
  beforeEach(async () => {
    await call('POST', vp(A1), A, {});
  });
  test.each([
    ['an email address', 'rosa@example.com'],
    ['a phone number', 'call 555 123 4567'],
  ])('%s is refused, on create and on change', async (_name, label) => {
    const res = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_LABEL');
    const ok = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Fine' });
    const put = await call('PUT', vp(A1, `/objects/${ok.json.object.id}`), A, { label });
    expect(put.status).toBe(400);
    expect((await objectRow(ok.json.object.id))?.label).toBe('Fine');
  });
  test.each([
    ['a fullwidth at sign', 'rosa＠example.com'],
    ['fullwidth digits', 'call ５５５ １２３ ４５６７'],
    ['zero-width spaces between digits', 'call 555\u200b123\u200b45'],
    ['Arabic-Indic digits', 'call ٥٥٥١٢٣٤٥٦٧'],
  ])('%s does not hide a contact detail (security review L4)', async (_name, label) => {
    const res = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_LABEL');
  });
  test('a label with an emoji sequence is kept as typed', async () => {
    const res = await call('POST', vp(A1, '/objects'), A, {
      kind: 'song',
      label: 'Rock 👩\u200d🎤 night',
    });
    expect(res.status).toBe(201);
    expect(res.json.object.label).toBe('Rock 👩\u200d🎤 night');
  });
  test('a field not listed is refused, so no person field rides along', async () => {
    const res = await call('POST', vp(A1, '/objects'), A, {
      kind: 'song',
      label: 'Song',
      presenter_email: 'x@example.com',
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('UNKNOWN_FIELD');
    expect(await all(`SELECT id FROM votable_objects WHERE event_id = ?`, A1)).toHaveLength(0);
  });
  test('a kind off the list is refused: no team and no event object (ADR-040 decisions 2, 4)', async () => {
    for (const kind of ['team', 'event', 'person'])
      expect((await call('POST', vp(A1, '/objects'), A, { kind, label: 'X' })).status).toBe(400);
  });
  test('a set holds one kind', async () => {
    expect((await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'S' })).status).toBe(
      201
    );
    const stall = await call('POST', vp(A1, '/objects'), A, { kind: 'stall', label: 'T' });
    expect(stall.status).toBe(409);
    expect(stall.json.code).toBe('KIND_MISMATCH');
  });

  // OSE-2224 (ADR-040 decision 12): anything the organizer names can be voted on.
  test('a host can add an entry object', async () => {
    const res = await call('POST', vp(A1, '/objects'), A, {
      kind: 'entry',
      label: 'The blue float',
    });
    expect(res.status).toBe(201);
    expect(res.json.object).toMatchObject({ kind: 'entry', label: 'The blue float' });
    expect(
      await one(`SELECT kind, label FROM votable_objects WHERE event_id = ?`, A1)
    ).toMatchObject({ kind: 'entry', label: 'The blue float' });
  });
  test('a set of entries refuses a song', async () => {
    expect(
      (await call('POST', vp(A1, '/objects'), A, { kind: 'entry', label: 'Chili, batch 2' })).status
    ).toBe(201);
    const song = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Song' });
    expect(song.status).toBe(409);
    expect(song.json.code).toBe('KIND_MISMATCH');
  });
  test('an entry label that names a contact is refused with the rule in words', async () => {
    const res = await call('POST', vp(A1, '/objects'), A, {
      kind: 'entry',
      label: 'Painting by ann@example.com',
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_LABEL');
    expect(JSON.stringify(res.json)).toContain('cannot hold an email address');
  });
});

// ── create and the one set ───────────────────────────────────────────────────

describe('one vote set per event', () => {
  test('the set is made in draft; a second is refused', async () => {
    const res = await call('POST', vp(A1), A, {});
    expect(res.status).toBe(201);
    expect(res.json.set).toEqual({
      id: expect.stringMatching(/^vset_/),
      event_id: A1,
      state: 'draft',
      played_by: 'object',
      opened: false,
      final: false,
      result: null,
      flood_seen: false,
      burst_seen: false,
      room_size: null,
    });
    const again = await call('POST', vp(A1), A, { played_by: 'team' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('VOTE_SET_EXISTS');
    expect((await setRow(A1))?.played_by).toBe('object');
  });
  test('the list of an event with no set is empty', async () => {
    const res = await call('GET', vp(A1), A);
    expect(res.status).toBe(200);
    expect(res.json.set).toBeNull();
    expect(res.json.objects).toEqual([]);
  });
  test('played_by must be object or team; no other field', async () => {
    expect((await call('POST', vp(A1), A, { played_by: 'song' })).status).toBe(400);
    expect((await call('POST', vp(A1), A, { secret_margin: 5 })).status).toBe(400);
    expect(await setRow(A1)).toBeNull();
  });
});

// ── 4 and 5: open, close, reopen, the epoch, T and V, final ─────────────────

describe('5. the first open stamps the epoch and draws T and V, once', () => {
  test('first open: epoch of the running pepper, T in 5..9, V in 10..14', async () => {
    await openNight();
    const row = await setRow(A1);
    expect(row?.state).toBe('open');
    expect(row?.pepper_epoch).toBe(await pepperEpoch(tenv.ANON_ID_HASH_PEPPER));
    expect(row?.secret_margin).toBeGreaterThanOrEqual(5);
    expect(row?.secret_margin).toBeLessThanOrEqual(9);
    expect(row?.secret_floor).toBeGreaterThanOrEqual(10);
    expect(row?.secret_floor).toBeLessThanOrEqual(14);
  });

  test('a reopen leaves T, V and the epoch unchanged, every time', async () => {
    await openNight();
    const first = await setRow(A1);
    for (let i = 0; i < 12; i++) {
      expect((await call('POST', vp(A1, '/close'), A, {})).status).toBe(200);
      expect((await call('POST', vp(A1, '/reopen'), A, {})).status).toBe(200);
      const now = await setRow(A1);
      expect(now?.secret_margin).toBe(first?.secret_margin);
      expect(now?.secret_floor).toBe(first?.secret_floor);
      expect(now?.pepper_epoch).toBe(first?.pepper_epoch);
    }
  });

  test('open twice: the second is refused and draws nothing', async () => {
    await openNight();
    const first = await setRow(A1);
    const again = await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('WRONG_STATE');
    expect(await setRow(A1)).toEqual(first);
  });

  test('with no pepper the set does not open, and nothing is stamped', async () => {
    await call('POST', vp(A1), A, {});
    const res = await call(
      'POST',
      vp(A1, '/open'),
      A,
      { room_size: 200 },
      { ANON_ID_HASH_PEPPER: undefined }
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PEPPER_NOT_SET');
    expect(await setRow(A1)).toMatchObject({
      state: 'draft',
      pepper_epoch: null,
      secret_margin: null,
      secret_floor: null,
    });
  });

  test('a final set says final even with no pepper; no set says so too', async () => {
    const none = await call(
      'POST',
      vp(A2, '/open'),
      A,
      { room_size: 200 },
      { ANON_ID_HASH_PEPPER: undefined }
    );
    expect(none.json.code).toBe('VOTE_SET_NOT_FOUND');
    await call('POST', vp(A1), A, {});
    await call('POST', vp(A1, '/finalize'), A, {});
    for (const tail of ['/open', '/reopen']) {
      const res = await call('POST', vp(A1, tail), A, {}, { ANON_ID_HASH_PEPPER: undefined });
      expect(res.status, tail).toBe(409);
      expect(res.json.code, tail).toBe('VOTE_SET_FINAL');
    }
  });

  test('a reopen under another pepper is refused: no vote could count there', async () => {
    await openNight();
    await call('POST', vp(A1, '/close'), A, {});
    const res = await call(
      'POST',
      vp(A1, '/reopen'),
      A,
      {},
      { ANON_ID_HASH_PEPPER: 'another-pepper-of-at-least-32-characters' }
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PEPPER_CHANGED');
    expect((await setRow(A1))?.state).toBe('closed');
  });

  test('voting does not open on an event that is over; an open set can still close', async () => {
    await call('POST', vp(OLD), A, {});
    const res = await call('POST', vp(OLD, '/open'), A, { room_size: 200 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('EVENT_OVER');
    const objects = await call('POST', vp(OLD, '/objects'), A, { kind: 'song', label: 'Late' });
    expect(objects.status).toBe(409);
    expect(objects.json.code).toBe('EVENT_OVER');
  });

  test('after the event, nothing reopens: not the set, not an object (security review M2)', async () => {
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      '2099-06-01',
      '2099-06-01',
      OLD
    );
    const songId = await openNight(OLD, 'object', ['Never opened']);
    const fresh = (await tenv.DB.prepare(
      `SELECT id FROM votable_objects WHERE event_id = ? AND label = 'Never opened'`
    )
      .bind(OLD)
      .first<{ id: string }>())!.id;
    await call('POST', vp(OLD, `/objects/${songId}/open`), A, {});
    await call('POST', vp(OLD, `/objects/${songId}/close`), A, {});
    // The set stays open; the event moves into the past.
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(3),
      daysAgo(3),
      OLD
    );
    for (const [tail, code] of [
      [`/objects/${songId}/reopen`, 'EVENT_OVER'],
      [`/objects/${fresh}/open`, 'EVENT_OVER'],
    ] as const) {
      const res = await call('POST', vp(OLD, tail), A, { window_seconds: 60 });
      expect(res.status, tail).toBe(409);
      expect(res.json.code, tail).toBe(code);
    }
    expect((await objectRow(songId))?.state).toBe('closed');
    expect((await objectRow(fresh))?.state).toBe('draft');
    expect((await call('POST', vp(OLD, '/close'), A, {})).status).toBe(200);
    const re = await call('POST', vp(OLD, '/reopen'), A, {});
    expect(re.status).toBe(409);
    expect(re.json.code).toBe('EVENT_OVER');
    expect((await setRow(OLD))?.state).toBe('closed');
  });

  test('an archived event does not open voting (security review L5)', async () => {
    await call('POST', vp(A1), A, {});
    await run(`UPDATE events SET status = 'archived' WHERE id = ?`, A1);
    const res = await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('EVENT_OVER');
    expect((await setRow(A1))?.pepper_epoch).toBeNull();
  });

  test('an event with no date stays on', async () => {
    await call('POST', vp(NODATE), A, {});
    expect((await call('POST', vp(NODATE, '/open'), A, { room_size: 200 })).status).toBe(200);
  });

  test('yesterday is still on (an evening event west of UTC)', async () => {
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(1),
      daysAgo(1),
      A1
    );
    await call('POST', vp(A1), A, {});
    expect((await call('POST', vp(A1, '/open'), A, { room_size: 200 })).status).toBe(200);
  });
});

describe('4. reopen is allowed before final, refused after final, even after a date change', () => {
  test('before final: close and reopen the set and an object', async () => {
    const songId = await openNight();
    expect((await call('POST', vp(A1, `/objects/${songId}/open`), A, {})).status).toBe(200);
    expect((await call('POST', vp(A1, `/objects/${songId}/close`), A, {})).status).toBe(200);
    expect((await call('POST', vp(A1, `/objects/${songId}/reopen`), A, {})).status).toBe(200);
    expect((await call('POST', vp(A1, '/close'), A, {})).status).toBe(200);
    const re = await call('POST', vp(A1, '/reopen'), A, {});
    expect(re.status).toBe(200);
    expect(re.json.set).toMatchObject({ state: 'open', opened: true, final: false });
  });

  test('after final (as S5 will set it): no reopen, no new object, no change, no object open', async () => {
    const songId = await openNight();
    await call('POST', vp(A1, `/objects/${songId}/open`), A, {});
    await call('POST', vp(A1, `/objects/${songId}/close`), A, {});
    await call('POST', vp(A1, '/close'), A, {});
    await makeFinalAsS5Would(A1);
    const before = await setRow(A1);
    const tries: [string, string, unknown][] = [
      ['POST', vp(A1, '/reopen'), {}],
      ['POST', vp(A1, '/open'), {}],
      ['POST', vp(A1, '/objects'), { kind: 'song', label: 'Encore' }],
      ['PUT', vp(A1, `/objects/${songId}`), { label: 'Renamed' }],
      ['POST', vp(A1, `/objects/${songId}/reopen`), {}],
      ['POST', vp(A1, `/objects/${songId}/open`), {}],
      ['POST', vp(A1, `/objects/${songId}/close`), {}],
    ];
    for (const [method, path, body] of tries) {
      const res = await call(method, path, A, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(res.json.code, `${method} ${path}`).toBe('VOTE_SET_FINAL');
    }
    // The event's date moves, as a host might after the night: final holds.
    const put = await call('PUT', `/api/v2/admin/events/${A1}`, A, {
      start_date: '2099-09-01',
      end_date: '2099-09-01',
    });
    expect(put.status, JSON.stringify(put.json)).toBeLessThan(300);
    const after = await call('POST', vp(A1, '/reopen'), A, {});
    expect(after.status).toBe(409);
    expect(after.json.code).toBe('VOTE_SET_FINAL');
    expect(await setRow(A1)).toEqual(before);
    expect(await all(`SELECT id FROM votable_objects WHERE event_id = ?`, A1)).toHaveLength(1);
    expect((await objectRow(songId))?.label).toBe('Song one');
  });

  test('an admin finalize makes a set that never opened final, for good', async () => {
    await call('POST', vp(A1), A, {});
    await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Unplayed' });
    const fin = await call('POST', vp(A1, '/finalize'), A, {});
    expect(fin.status).toBe(200);
    expect(fin.json.set).toMatchObject({ state: 'closed', final: true, opened: false });
    expect(await setRow(A1)).toMatchObject({
      is_final: 1,
      secret_margin: null,
      secret_floor: null,
      final_at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:00:00$/),
    });
    await call('PUT', `/api/v2/admin/events/${A1}`, A, {
      start_date: '2099-09-02',
      end_date: '2099-09-02',
    });
    const open = await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    expect(open.status).toBe(409);
    expect(open.json.code).toBe('VOTE_SET_FINAL');
    expect((await call('POST', vp(A1, '/finalize'), A, {})).json.code).toBe('VOTE_SET_FINAL');
  });

  test('an admin finalize of a set still open is refused, the same for a void set (OSE-2130)', async () => {
    await openNight(A1);
    await openNight(A2);
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE event_id = ?`,
      A2
    );
    const plain = await call('POST', vp(A1, '/finalize'), A, {});
    const voided = await call('POST', vp(A2, '/finalize'), A, {});
    expect(plain.status).toBe(409);
    expect(plain.json.code).toBe('VOTE_SET_OPEN');
    expect(same(voided.json)).toEqual(same(plain.json));
    expect((await setRow(A1))?.is_final).toBe(0);
    expect((await setRow(A2))?.is_final).toBe(0);
  });
});

// ── objects: windows, teams, booths ──────────────────────────────────────────

describe('an object window is set by the server', () => {
  test('an object opens only inside an open set', async () => {
    await call('POST', vp(A1), A, {});
    const song = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Early' });
    const res = await call('POST', vp(A1, `/objects/${song.json.object.id}/open`), A, {});
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('VOTE_SET_NOT_OPEN');
  });

  test('closes_at is now plus the window; the default follows the kind; the maximum holds', async () => {
    const songId = await openNight();
    const t0 = Date.now();
    const res = await call('POST', vp(A1, `/objects/${songId}/open`), A, { window_seconds: 136 });
    expect(res.status).toBe(200);
    const closes = Date.parse(res.json.object.closes_at);
    expect(closes - t0).toBeGreaterThanOrEqual(135_000);
    expect(closes - t0).toBeLessThanOrEqual(140_000);
    expect(res.json.object).toMatchObject({ state: 'open', open_now: true });

    await call('POST', vp(A1, `/objects/${songId}/close`), A, {});
    const def = await call('POST', vp(A1, `/objects/${songId}/reopen`), A, {});
    const span = Date.parse(def.json.object.closes_at) - Date.now();
    expect(span).toBeGreaterThan((VOTE_WINDOW_DEFAULT_SECONDS.song - 10) * 1000);
    expect(span).toBeLessThanOrEqual(VOTE_WINDOW_DEFAULT_SECONDS.song * 1000);

    await call('POST', vp(A1, `/objects/${songId}/close`), A, {});
    for (const w of [VOTE_WINDOW_MAX_SECONDS + 1, 5, 1.5, '60'])
      expect(
        (await call('POST', vp(A1, `/objects/${songId}/reopen`), A, { window_seconds: w })).status
      ).toBe(400);
  });

  test("an entry's window defaults to the whole event, as a stall's (OSE-2224)", async () => {
    expect((await call('POST', vp(A1), A, {})).status).toBe(201);
    const entry = await call('POST', vp(A1, '/objects'), A, { kind: 'entry', label: 'Float one' });
    expect(entry.status).toBe(201);
    expect((await call('POST', vp(A1, '/open'), A, { room_size: 200 })).status).toBe(200);
    expect(VOTE_WINDOW_DEFAULT_SECONDS.entry).toBe(VOTE_WINDOW_MAX_SECONDS);
    const t0 = Date.now();
    const res = await call('POST', vp(A1, `/objects/${entry.json.object.id}/open`), A, {});
    expect(res.status).toBe(200);
    const span = Date.parse(res.json.object.closes_at) - t0;
    expect(span).toBeGreaterThan((VOTE_WINDOW_MAX_SECONDS - 10) * 1000);
    expect(span).toBeLessThanOrEqual((VOTE_WINDOW_MAX_SECONDS + 5) * 1000);
  });

  test('a reopen of an object still open is refused; once its window ran out, it re-arms', async () => {
    const songId = await openNight();
    await call('POST', vp(A1, `/objects/${songId}/open`), A, { window_seconds: 60 });
    expect((await call('POST', vp(A1, `/objects/${songId}/reopen`), A, {})).status).toBe(409);
    await run(
      `UPDATE votable_objects SET closes_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
      songId
    );
    const list = await call('GET', vp(A1), A);
    expect(list.json.objects[0]).toMatchObject({ state: 'open', open_now: false });
    const re = await call('POST', vp(A1, `/objects/${songId}/reopen`), A, { window_seconds: 60 });
    expect(re.status).toBe(200);
    expect(re.json.object.open_now).toBe(true);
  });

  test('closing the set leaves no object open_now', async () => {
    const songId = await openNight();
    await call('POST', vp(A1, `/objects/${songId}/open`), A, {});
    await call('POST', vp(A1, '/close'), A, {});
    const list = await call('GET', vp(A1), A);
    expect(list.json.objects[0].open_now).toBe(false);
  });
});

describe('6. after the first open, a song team cannot change', () => {
  test('before the first open a team may change; after it, never', async () => {
    await call('POST', vp(A1), A, { played_by: 'team' });
    const song = await call('POST', vp(A1, '/objects'), A, {
      kind: 'song',
      label: 'Team song',
      group_id: TEAM_1,
    });
    const id = song.json.object.id as string;
    expect((await call('PUT', vp(A1, `/objects/${id}`), A, { group_id: TEAM_2 })).status).toBe(200);
    await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    const res = await call('PUT', vp(A1, `/objects/${id}`), A, { group_id: TEAM_1 });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('TEAM_FIXED');
    expect((await objectRow(id))?.group_id).toBe(TEAM_2);
    // The order may still change; the team stays.
    expect((await call('PUT', vp(A1, `/objects/${id}`), A, { sort: 3 })).status).toBe(200);
    expect((await objectRow(id))?.group_id).toBe(TEAM_2);
  });

  test('a name is fixed once voting opens: a rename would move votes to another name', async () => {
    await call('POST', vp(A1), A, {});
    const song = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'First name' });
    const id = song.json.object.id as string;
    // Before the first open a typo can be fixed.
    expect((await call('PUT', vp(A1, `/objects/${id}`), A, { label: 'Fixed name' })).status).toBe(
      200
    );
    await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    const res = await call('PUT', vp(A1, `/objects/${id}`), A, { label: 'Another song' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('LABEL_FIXED');
    expect((await objectRow(id))?.label).toBe('Fixed name');
    // The same name again, or only the order, still saves.
    expect(
      (await call('PUT', vp(A1, `/objects/${id}`), A, { label: 'Fixed name', sort: 2 })).status
    ).toBe(200);
  });

  test('once voting opens, nothing can be added: no decoy, no second copy, no late favourite', async () => {
    // Owner, 2026-11-26 (after CCR loops 1 to 3).
    await call('POST', vp(A1), A, {});
    expect(
      (await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Song A' })).status
    ).toBe(201);
    await call('POST', vp(A1, '/open'), A, { room_size: 200 });
    for (const label of ['  song a ', 'Song B']) {
      const res = await call('POST', vp(A1, '/objects'), A, { kind: 'song', label });
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('OBJECTS_FIXED');
    }
    // Closed and reopened, still fixed.
    await call('POST', vp(A1, '/close'), A, {});
    expect(
      (await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'Song C' })).json.code
    ).toBe('OBJECTS_FIXED');
    const n = await tenv.DB.prepare(`SELECT COUNT(*) AS n FROM votable_objects WHERE event_id = ?`)
      .bind(A1)
      .first<{ n: number }>();
    expect(Number(n?.n)).toBe(1);
  });

  test('a team night needs a team on each object; an object night refuses one', async () => {
    await call('POST', vp(A1), A, { played_by: 'team' });
    expect(
      (await call('POST', vp(A1, '/objects'), A, { kind: 'song', label: 'No team' })).json.code
    ).toBe('GROUP_REQUIRED');
    await call('POST', vp(A2), A, {});
    expect(
      (await call('POST', vp(A2, '/objects'), A, { kind: 'song', label: 'X', group_id: TEAM_1 }))
        .json.code
    ).toBe('GROUP_NOT_ALLOWED');
  });

  test('the play mode has no route to change it', async () => {
    await call('POST', vp(A1), A, {});
    expect((await call('PUT', vp(A1), A, { played_by: 'team' })).status).toBe(404);
    expect((await setRow(A1))?.played_by).toBe('object');
  });

  test('a team name cannot be stored: the team is an opaque id', async () => {
    await call('POST', vp(A1), A, { played_by: 'team' });
    const res = await call('POST', vp(A1, '/objects'), A, {
      kind: 'song',
      label: 'X',
      group_id: 'The Rosa Band',
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_GROUP');
  });
});

describe('7. a booth must be a stall of the same event, in use', () => {
  test('another event booth is refused; this event booth is taken; a booth out of use is refused', async () => {
    await run(
      `INSERT INTO event_booths (id, event_id, number, name, is_active) VALUES ('booth_vts_a1', ?, '1', 'Honey', 1)`,
      A1
    );
    await run(
      `INSERT INTO event_booths (id, event_id, number, name, is_active) VALUES ('booth_vts_a2', ?, '1', 'Rye', 1)`,
      A2
    );
    await run(
      `INSERT INTO event_booths (id, event_id, number, name, is_active) VALUES ('booth_vts_off', ?, '2', 'Gone', 0)`,
      A1
    );
    await call('POST', vp(A1), A, {});
    const foreign = await call('POST', vp(A1, '/objects'), A, {
      kind: 'stall',
      label: 'Rye stall',
      booth_id: 'booth_vts_a2',
    });
    expect(foreign.status).toBe(400);
    expect(foreign.json.code).toBe('BOOTH_NOT_FOUND');
    const off = await call('POST', vp(A1, '/objects'), A, {
      kind: 'stall',
      label: 'Gone stall',
      booth_id: 'booth_vts_off',
    });
    expect(off.json.code).toBe('BOOTH_NOT_FOUND');
    const own = await call('POST', vp(A1, '/objects'), A, {
      kind: 'stall',
      label: 'Honey stall',
      booth_id: 'booth_vts_a1',
    });
    expect(own.status).toBe(201);
    const moved = await call('PUT', vp(A1, `/objects/${own.json.object.id}`), A, {
      booth_id: 'booth_vts_a2',
    });
    expect(moved.json.code).toBe('BOOTH_NOT_FOUND');
    expect((await objectRow(own.json.object.id))?.booth_id).toBe('booth_vts_a1');
    expect(
      await all(`SELECT id FROM votable_objects WHERE booth_id = 'booth_vts_a2'`)
    ).toHaveLength(0);
  });
});

// ── 8: audit ─────────────────────────────────────────────────────────────────

describe('8. every change is audited, with no detail', () => {
  test('the audit row holds the reference the answer carries (PR #1432 review)', async () => {
    const ctx = createExecutionContext();
    const res = await route(
      new Request(`https://ose.test${vp(A1)}`, {
        method: 'POST',
        headers: { ...A, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      routerEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    const header = res.headers.get('X-Request-Id');
    const body = (await res.json()) as Json;
    expect(header).toBeTruthy();
    expect(body.requestId).toBe(header);
    const rows = await all(
      `SELECT request_id FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_SET_CREATE'`,
      A1
    );
    expect(rows.map((r) => r.request_id)).toEqual([header]);
  });

  test('each write writes its row; a refusal is denied; a read writes none', async () => {
    const songId = await openNight(); // create, object create, open
    await call('PUT', vp(A1, `/objects/${songId}`), A, { sort: 2 });
    await call('POST', vp(A1, `/objects/${songId}/open`), A, {});
    await call('POST', vp(A1, `/objects/${songId}/close`), A, {});
    await call('POST', vp(A1, `/objects/${songId}/reopen`), A, {});
    await call('POST', vp(A1, '/close'), A, {});
    await call('POST', vp(A1, '/reopen'), A, {});
    await call('POST', vp(A1, '/finalize'), A, {}); // refused: VOTE_SET_OPEN
    await call('GET', vp(A1), A);
    const rows = await all(
      `SELECT action, outcome, details, brand_id FROM admin_audit_log
        WHERE resource_type = 'event' AND resource_id = ? ORDER BY rowid`,
      A1
    );
    expect(rows.map((r) => `${r.action}:${r.outcome}`)).toEqual([
      'VOTE_SET_CREATE:success',
      'VOTABLE_CREATE:success',
      'VOTE_SET_OPEN:success',
      'VOTABLE_UPDATE:success',
      'VOTABLE_OPEN:success',
      'VOTABLE_CLOSE:success',
      'VOTABLE_REOPEN:success',
      'VOTE_SET_CLOSE:success',
      'VOTE_SET_REOPEN:success',
      'VOTE_SET_FINALIZE:denied',
    ]);
    for (const r of rows) {
      expect(r.details).toBeNull();
      expect(r.brand_id).toBe(BRAND_A);
    }
  });
});

// ── 10: the nightly job ──────────────────────────────────────────────────────

describe('10. every set reaches final: the nightly job', () => {
  async function seedMarkers(eventId: string) {
    const set = await setRow(eventId);
    const obj = await one(`SELECT id FROM votable_objects WHERE event_id = ? LIMIT 1`, eventId);
    await run(`INSERT INTO vote_receipts (object_id, receipt) VALUES (?, ?)`, obj?.id, HEX('a'));
    await run(`INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)`, set?.id, HEX('b'));
    await run(
      `INSERT INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)`,
      set?.id,
      TEAM_1,
      HEX('c')
    );
    return { setId: set?.id as string, objectId: obj?.id as string };
  }
  const markers = async (setId: string, objectId: string) => ({
    receipts: (await all(`SELECT 1 FROM vote_receipts WHERE object_id = ?`, objectId)).length,
    participants: (await all(`SELECT 1 FROM vote_participants WHERE set_id = ?`, setId)).length,
    teams: (await all(`SELECT 1 FROM vote_team_markers WHERE set_id = ?`, setId)).length,
  });

  test('the job runs every night: it is in the scheduled job list', () => {
    const sources = JSON.parse(tenv.TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const index = Object.entries(sources).find(([p]) =>
      p.replace(/\\/g, '/').endsWith('src/index.ts')
    )?.[1];
    expect(index, 'src/index.ts in TEST_SOURCE_FILES_JSON').toBeTruthy();
    const jobs = index!.match(/const jobs = \[([\s\S]*?)\];/)?.[1] ?? '';
    expect(jobs).toMatch(/\brunVoteFinalJob\(env\)/);
  });

  test('a void set left open 7 days after its event is made final, and its markers are deleted', async () => {
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      '2099-06-01',
      '2099-06-01',
      OLD
    );
    await openNight(OLD);
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(10),
      daysAgo(10),
      OLD
    );
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE event_id = ?`,
      OLD
    );
    const { setId, objectId } = await seedMarkers(OLD);
    const out = await runVoteFinalJob({ DB: tenv.DB });
    expect(out.finalized).toBeGreaterThanOrEqual(1);
    expect(await setRow(OLD)).toMatchObject({
      is_final: 1,
      state: 'closed',
      secret_margin: null,
      secret_floor: null,
    });
    expect(await markers(setId, objectId)).toEqual({ receipts: 0, participants: 0, teams: 0 });
    expect((await objectRow(objectId))?.state).toBe('closed');
    const audit = await all(
      `SELECT action, actor, details, brand_id FROM admin_audit_log WHERE resource_id = ? AND action = 'VOTE_SET_FINAL'`,
      OLD
    );
    expect(audit).toEqual([
      { action: 'VOTE_SET_FINAL', actor: 'system:lifecycle', details: null, brand_id: BRAND_A },
    ]);
  });

  test('a set that never opened is made final 7 days after its event', async () => {
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      '2099-06-01',
      '2099-06-01',
      OLD
    );
    await call('POST', vp(OLD), A, {});
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(8),
      daysAgo(8),
      OLD
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect((await setRow(OLD))?.is_final).toBe(1);
  });

  test('a set that opened and is not void is made final with its result, its markers deleted (OSE-2130)', async () => {
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      '2099-06-01',
      '2099-06-01',
      OLD
    );
    await openNight(OLD);
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(10),
      daysAgo(10),
      OLD
    );
    const { setId, objectId } = await seedMarkers(OLD);
    await runVoteFinalJob({ DB: tenv.DB });
    expect(await setRow(OLD)).toMatchObject({
      is_final: 1,
      state: 'closed',
      secret_margin: null,
      secret_floor: null,
      outcome: 'too_close',
    });
    expect(await markers(setId, objectId)).toEqual({ receipts: 0, participants: 0, teams: 0 });
  });

  test('inside the 7 days, nothing is made final', async () => {
    await call('POST', vp(A1), A, {});
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(6),
      daysAgo(6),
      A1
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect((await setRow(A1))?.is_final).toBe(0);
  });

  test('with no event date: a void set closed for 7 days is made final', async () => {
    await openNight(NODATE);
    await call('POST', vp(NODATE, '/close'), A, {});
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch', updated_at = ? WHERE event_id = ?`,
      `${daysAgo(8)} 10:00:00`,
      NODATE
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect((await setRow(NODATE))?.is_final).toBe(1);
  });

  test('with no event date: a void set left open, with no window in 7 days, is made final (security review M1)', async () => {
    const songId = await openNight(NODATE);
    await call('POST', vp(NODATE, `/objects/${songId}/open`), A, { window_seconds: 60 });
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch', updated_at = ? WHERE event_id = ?`,
      `${daysAgo(8)} 10:00:00`,
      NODATE
    );
    // A window still recent: not yet.
    await runVoteFinalJob({ DB: tenv.DB });
    expect((await setRow(NODATE))?.is_final).toBe(0);
    await run(
      `UPDATE votable_objects SET closes_at = ? WHERE id = ?`,
      `${daysAgo(8)}T10:00:00.000Z`,
      songId
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect(await setRow(NODATE)).toMatchObject({ is_final: 1, state: 'closed' });
  });

  test('the final step checks again that the set is due: an event moved into the future is left alone (PR #1432 review)', async () => {
    await call('POST', vp(A1), A, {});
    const setId = (await setRow(A1))?.id as string;
    // The job chose this set while its event was past; the event then moved.
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      '2099-06-01',
      '2099-06-01',
      A1
    );
    expect(await finalizeVoteSet(tenv.DB, setId, A1, 'job', new Date().toISOString())).toBe(false);
    expect((await setRow(A1))?.is_final).toBe(0);
    // Still past: the same call makes it final.
    await run(
      `UPDATE events SET start_date = ?, end_date = ? WHERE id = ?`,
      daysAgo(9),
      daysAgo(9),
      A1
    );
    expect(await finalizeVoteSet(tenv.DB, setId, A1, 'job', new Date().toISOString())).toBe(true);
    expect((await setRow(A1))?.is_final).toBe(1);
  });

  test('tallies go 30 days after final, not before', async () => {
    const songId = await openNight(A1);
    await makeFinalAsS5Would(A1);
    await run(
      `UPDATE vote_sets SET final_at = ? WHERE event_id = ?`,
      `${daysAgo(29)} 10:00:00`,
      A1
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect(
      await all(`SELECT object_id FROM vote_tallies WHERE object_id = ?`, songId)
    ).toHaveLength(1);
    await run(
      `UPDATE vote_sets SET final_at = ? WHERE event_id = ?`,
      `${daysAgo(31)} 10:00:00`,
      A1
    );
    await runVoteFinalJob({ DB: tenv.DB });
    expect(
      await all(`SELECT object_id FROM vote_tallies WHERE object_id = ?`, songId)
    ).toHaveLength(0);
  });
});

// ── 11: delete ───────────────────────────────────────────────────────────────

describe('11. an event with a vote set is archived, never deleted', () => {
  test('the hard delete is refused, and the set stays', async () => {
    await call('POST', vp(A2), A, {});
    const res = await call('DELETE', `/api/v2/admin/events/${A2}`, A);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('EVENT_HAS_VOTE_SET');
    expect(await setRow(A2)).not.toBeNull();
  });
});

// ── pure parts ───────────────────────────────────────────────────────────────

describe('the route table and the draw', () => {
  test('matchVotablesRoute names each route and its audit action', () => {
    expect(matchVotablesRoute('GET', '')).toMatchObject({ op: 'list', action: null });
    expect(matchVotablesRoute('POST', '')).toMatchObject({ action: 'VOTE_SET_CREATE' });
    expect(matchVotablesRoute('POST', '/reopen')).toMatchObject({ action: 'VOTE_SET_REOPEN' });
    expect(matchVotablesRoute('PUT', '/objects/vobj_1')).toMatchObject({
      action: 'VOTABLE_UPDATE',
      objectId: 'vobj_1',
    });
    expect(matchVotablesRoute('POST', '/objects/vobj_1/reopen')).toMatchObject({
      action: 'VOTABLE_REOPEN',
    });
    for (const [m, p] of [
      ['PUT', ''],
      ['DELETE', ''],
      ['POST', '/tally'],
      ['GET', '/objects'],
      ['DELETE', '/objects/vobj_1'],
      ['POST', '/objects/vobj_1/vote'],
    ])
      expect(matchVotablesRoute(m, p), `${m} ${p}`).toBeNull();
  });

  test('drawUniform gives every value in range and nothing outside', () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const v = drawUniform(5, 9);
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([5, 6, 7, 8, 9]);
    for (const n of seen.values()) expect(n).toBeGreaterThan(800);
  });
});

// ── 9: last, so it reads every answer above ─────────────────────────────────

describe('9. no admin answer carries a guarded key', () => {
  const GUARDED =
    /secret|margin|floor|counted|duplicate|refused|up_count|down_count|tall(y|ies)|receipt|marker|participant|epoch|void|^t$|^v$|count/i;
  function keys(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v) => keys(v, out));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keys(v, out);
      }
    return out;
  }

  test('a full night, then every answer this file saw is read for a guarded key or value', async () => {
    const songId = await openNight();
    await call('POST', vp(A1, `/objects/${songId}/open`), A, {});
    await call('GET', vp(A1), A);
    await call('POST', vp(A1, `/objects/${songId}/close`), A, {});
    await call('POST', vp(A1, '/close'), A, {});
    await call('POST', vp(A1, '/reopen'), A, {});
    await call('GET', vp(A1), A);
    const epoch = await pepperEpoch(tenv.ANON_ID_HASH_PEPPER);
    const votables = ANSWERS.filter((a) => a.path.includes('/votables'));
    expect(votables.length).toBeGreaterThan(50);
    const bad = votables.flatMap((a) =>
      keys(a.json)
        .filter((k) => GUARDED.test(k))
        .map((k) => `${a.path}: ${k}`)
    );
    expect(bad).toEqual([]);
    for (const a of votables) expect(JSON.stringify(a.json)).not.toContain(String(epoch));
    // The set answer is exactly these fields, and an object exactly these.
    const list = await call('GET', vp(A1), A);
    expect(Object.keys(list.json.set).sort()).toEqual(
      [
        'burst_seen',
        'event_id',
        'final',
        'flood_seen',
        'id',
        'opened',
        'played_by',
        'result',
        'room_size',
        'state',
      ].sort()
    );
    expect(Object.keys(list.json.objects[0]).sort()).toEqual(
      [
        'booth_id',
        'closes_at',
        'group_id',
        'id',
        'kind',
        'label',
        'open_now',
        'sort',
        'state',
      ].sort()
    );
  });
});
