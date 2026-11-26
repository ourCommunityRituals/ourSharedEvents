/**
 * Voting S3c: the public open-objects read and the VOTING_ENABLED kill switch
 * (OSE-2135, part of OSE-1193; OSE ADR-040 decisions 5, 7 and 10).
 *
 *   GET /api/v2/vote/:eventId/objects  →  {"objects": [{"id", "kind", "label"}]}
 *
 * Rules held here, each named after the fault it was watched failing on:
 *   1. the switch: with VOTING_ENABLED anything but "on" (the default), the
 *      path is the router's own 404, byte for byte, and the limiter does not
 *      count it [switch ignored];
 *   2. the allowlist: the answer has one key, and each object exactly id, kind
 *      and label; no guarded key at any depth, and the bytes do not move when a
 *      counter does [a tally field added; the row spread];
 *   3. open now only: a draft, closed or lapsed object is not listed, nor any
 *      object of a draft, closed, final or void set, nor of an event that is not
 *      live [drafts returned; set state, final, void or event check removed];
 *      a reopened object is listed again; another event's objects never are;
 *   4. the limit: past the caller's minute the read is a 429; it skips the
 *      10-second edge layer, and 150 reads from one address are all served
 *      [limit removed; limit lowered to the API default];
 *   5. the display: display-config, the public event read and the TV page
 *      carry no vote word, no object id and no label, with a song open
 *      [list added to display-config];
 *   6. no cookie: none is set, and one sent changes nothing.
 *
 * @born-red OSE-2135 | method: injected-fault, each removed after; the list and
 * the counts are in the PR body | date: 2026-11-18
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { linkVenue } from './helpers/link-venue';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PUBLIC_PAGE_MAX, PUBLIC_READ_MAX } from '../src/lib/public-read-limit';
import { rateLimitKvKey } from '../src/lib/rate-limit';
import { VOTING_ON, votingEnabled } from '../src/lib/voting-switch';
import { projectOpenObject } from '../src/lib/vote-open-objects';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_KEY_PEPPER?: string;
  VOTING_ENABLED?: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;
const ON: Partial<RouterEnv> = { VOTING_ENABLED: VOTING_ON };

const BRAND = 'brand-voo-a';
const OWNER = 'owner-voo-a@example.com';
const NIGHT = 'evt-voo-night'; // live, a song night
const OTHER = 'evt-voo-other'; // live, another night of the same brand
const DRAFT = 'evt-voo-draft'; // not live yet
const GONE = 'evt-voo-gone'; // archived

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const now = () => Math.floor(Date.now() / 1000);
const ADMIN: Record<string, string> = {
  'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    email: OWNER,
    iat: now() - 10,
    exp: now() + 3600,
  })}.sig`,
  'Sec-Fetch-Site': 'same-origin',
};

type Json = Record<string, any>;

async function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
  envOverride: Partial<RouterEnv> = {}
): Promise<Response> {
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
  return res;
}

const admin = async (method: string, eventId: string, tail = '', body: unknown = {}) => {
  const res = await send(method, `/api/v2/admin/events/${eventId}/votables${tail}`, ADMIN, body);
  return { status: res.status, json: (await res.json()) as Json };
};

let ipSeq = 10;
/** A caller nobody else in this file uses. */
const freshIp = () => `198.18.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

const readPath = (eventId: string) => `/api/v2/vote/${eventId}/objects`;

/** The public read, as a phone in the room would make it. */
async function read(
  eventId: string,
  envOverride: Partial<RouterEnv> = ON,
  headers: Record<string, string> = {}
): Promise<{ status: number; text: string; res: Response }> {
  const res = await send(
    'GET',
    readPath(eventId),
    { 'CF-Connecting-IP': freshIp(), ...headers },
    undefined,
    envOverride
  );
  return { status: res.status, text: await res.text(), res };
}
const listed = async (eventId: string): Promise<Json[]> => {
  const r = await read(eventId);
  expect(r.status).toBe(200);
  return (JSON.parse(r.text) as { objects: Json[] }).objects;
};
const labels = async (eventId: string) => (await listed(eventId)).map((o) => o.label);

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

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();

async function seedEvent(id: string, status: string) {
  await run(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, 'Eagles Hall', '2099-06-01', '2099-06-01', 'America/Chicago')`,
    id,
    BRAND,
    `Song night fixture ${id}`,
    id,
    status
  );
  await linkVenue(tenv.DB, id);
}

/** Make the set, add songs, open the set; returns each song's id by label. */
async function night(eventId: string, songs: string[]): Promise<Record<string, string>> {
  expect((await admin('POST', eventId)).status).toBe(201);
  const ids: Record<string, string> = {};
  for (const [i, label] of songs.entries()) {
    const made = await admin('POST', eventId, '/objects', { kind: 'song', label, sort: i });
    expect(made.status).toBe(201);
    ids[label] = made.json.object.id;
  }
  expect((await admin('POST', eventId, '/open', { room_size: 200 })).status).toBe(200);
  return ids;
}
const openSong = async (eventId: string, id: string) =>
  expect((await admin('POST', eventId, `/objects/${id}/open`)).status).toBe(200);

/** Every key at any depth that is not one the answer may carry. */
const ALLOWED_KEYS = new Set(['objects', 'id', 'kind', 'label']);
function strayKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => strayKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(ALLOWED_KEYS.has(k) ? [] : [`${path}.${k}`]),
    ...strayKeys(v, `${path}.${k}`),
  ]);
}

beforeAll(async () => {
  await applyMigrations();
  await run(
    `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`,
    OWNER,
    BRAND
  );
});

beforeEach(async () => {
  const like = 'evt-voo-%';
  await run(
    `DELETE FROM vote_tallies WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    like
  );
  await run(
    `DELETE FROM vote_receipts WHERE object_id IN (SELECT id FROM votable_objects WHERE event_id LIKE ?)`,
    like
  );
  await run(
    `DELETE FROM vote_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id LIKE ?)`,
    like
  );
  await run(`DELETE FROM votable_objects WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM vote_sets WHERE event_id LIKE ?`, like);
  await run(`DELETE FROM admin_audit_log WHERE resource_id LIKE ?`, like);
  await run(`DELETE FROM events WHERE id LIKE ?`, like);
  await seedEvent(NIGHT, 'active');
  await seedEvent(OTHER, 'active');
  await seedEvent(DRAFT, 'draft');
  await seedEvent(GONE, 'archived');
});

// ── 1. The switch ────────────────────────────────────────────────────────────

describe('1. VOTING_ENABLED: off, the read does not exist', () => {
  test('the test pool runs with the switch off, as every block of wrangler.toml does', () => {
    expect(tenv.VOTING_ENABLED).toBe('off');
    expect(votingEnabled(tenv)).toBe(false);
  });

  test('only exactly "on" is on', () => {
    expect(votingEnabled({ VOTING_ENABLED: 'on' })).toBe(true);
    for (const v of ['off', 'ON', 'On', 'true', '1', 'yes', ' on', 'on ', '', undefined]) {
      expect(votingEnabled({ VOTING_ENABLED: v }), String(v)).toBe(false);
    }
    expect(votingEnabled(undefined)).toBe(false);
    expect(votingEnabled(null)).toBe(false);
  });

  test('off: an open song is not listed; the answer is the router 404 for a path that never existed', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    expect(await labels(NIGHT)).toEqual(['Song one']); // the control: on, it is listed

    const nowhere = await send('GET', '/api/v2/vote-never-was/objects');
    const nowhereText = await nowhere.text();
    expect(nowhere.status).toBe(404);
    for (const v of [undefined, 'off', 'ON', 'true', '1', '']) {
      const off = await read(NIGHT, { VOTING_ENABLED: v });
      expect(off.status, String(v)).toBe(404);
      expect(off.text, String(v)).toBe(nowhereText);
      expect(off.text).not.toContain('Song one');
      expect(off.text).not.toContain(ids['Song one']);
      expect(off.res.headers.get('Set-Cookie')).toBeNull();
    }
  });

  test('off: the limiter does not count the caller, so the path is not even a limited route', async () => {
    const ip = freshIp();
    const key = await rateLimitKvKey(`publicread:vote-objects:${ip}`, tenv.RATE_LIMIT_KEY_PEPPER);
    await send('GET', readPath(NIGHT), { 'CF-Connecting-IP': ip });
    expect(await tenv.RATE_LIMIT_KV.get(key)).toBeNull();
    await send('GET', readPath(NIGHT), { 'CF-Connecting-IP': ip }, undefined, ON);
    expect(await tenv.RATE_LIMIT_KV.get(key)).not.toBeNull();
  });

  test('on: only GET reads; any other method is the router 404', async () => {
    const nowhere = await (await send('POST', '/api/v2/vote-never-was/objects', {}, {})).text();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await send(method, readPath(NIGHT), {}, {}, ON);
      expect(res.status, method).toBe(404);
      expect(await res.text(), method).toBe(nowhere);
    }
  });
});

// ── 2. The allowlist ─────────────────────────────────────────────────────────

describe('2. the answer is an allowlist: id, kind, label, and nothing else', () => {
  test('one key, and exactly three fields per object, in a stated order', async () => {
    const ids = await night(NIGHT, ['Song one', 'Song two']);
    await openSong(NIGHT, ids['Song one']);
    await openSong(NIGHT, ids['Song two']);
    const r = await read(NIGHT);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Content-Type')).toContain('application/json');
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    const body = JSON.parse(r.text) as Json;
    expect(Object.keys(body)).toEqual(['objects']);
    expect(body.objects).toEqual([
      { id: ids['Song one'], kind: 'song', label: 'Song one' },
      { id: ids['Song two'], kind: 'song', label: 'Song two' },
    ]);
    for (const o of body.objects) expect(Object.keys(o)).toEqual(['id', 'kind', 'label']);
    expect(strayKeys(body)).toEqual([]);
    // Negative control: the scan sees a stray key at any depth.
    expect(strayKeys({ ...body, objects: [{ ...body.objects[0], up_count: 3 }] })).toEqual([
      '$.objects[0].up_count',
    ]);
  });

  test('no time, state, team, booth or set word appears anywhere in the bytes', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    const { text } = await read(NIGHT);
    for (const word of [
      'closes',
      'state',
      'open',
      'group',
      'booth',
      'set_',
      'vset_',
      'count',
      'tally',
      'secret',
      'margin',
      'floor',
      'epoch',
      'void',
      'final',
      'receipt',
      'marker',
      'participant',
      'played_by',
    ]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no date or time of any kind
  });

  test('the bytes do not move when a counter, a receipt or a marker does', async () => {
    const ids = await night(NIGHT, ['Song one', 'Song two']);
    await openSong(NIGHT, ids['Song one']);
    await openSong(NIGHT, ids['Song two']);
    const before = (await read(NIGHT)).text;
    await run(
      `UPDATE vote_tallies SET up_count = 7, down_count = 3 WHERE object_id = ?`,
      ids['Song one']
    );
    await run(`UPDATE vote_sets SET counted_votes = 10 WHERE event_id = ?`, NIGHT);
    expect((await read(NIGHT)).text).toBe(before);
    // "Has anyone voted on this song" is a count under the floor too (security
    // review M2): one song with a receipt, one without, must read alike.
    await run(
      `INSERT INTO vote_receipts (object_id, receipt) VALUES (?, ?)`,
      ids['Song one'],
      'a'.repeat(64)
    );
    await run(
      `INSERT INTO vote_participants (set_id, marker) SELECT id, ? FROM vote_sets WHERE event_id = ?`,
      'b'.repeat(64),
      NIGHT
    );
    expect((await read(NIGHT)).text).toBe(before);
  });

  test('the projection builds the object field by field, never from the row', () => {
    const row = { id: 'vobj_1', kind: 'song', label: 'L', up_count: 9, closes_at: 'x' } as never;
    expect(projectOpenObject(row)).toEqual({ id: 'vobj_1', kind: 'song', label: 'L' });
  });
});

// ── 3. Open now only ─────────────────────────────────────────────────────────

describe('3. only what is open now is listed', () => {
  test('a draft object is not listed; it is once it opens; a close or reopen is refused; closed by hand, it is not', async () => {
    const ids = await night(NIGHT, ['Song one', 'Song two']);
    expect(await labels(NIGHT)).toEqual([]); // both still draft
    await openSong(NIGHT, ids['Song two']);
    expect(await labels(NIGHT)).toEqual(['Song two']); // Song one is a draft
    // A window runs its full length (owner card 2026-11-26): no host close or reopen.
    for (const move of ['close', 'reopen']) {
      const r = await admin('POST', NIGHT, `/objects/${ids['Song two']}/${move}`);
      expect(r.status, move).toBe(409);
      expect(r.json.code, move).toBe('WINDOW_FIXED');
      expect(await labels(NIGHT), move).toEqual(['Song two']);
    }
    // A row closed before this rule (or by hand) is not listed.
    await run(`UPDATE votable_objects SET state = 'closed' WHERE id = ?`, ids['Song two']);
    expect(await labels(NIGHT)).toEqual([]);
  });

  test('an object whose window has passed is not listed, to the second', async () => {
    const ids = await night(NIGHT, ['Song one', 'Song two']);
    await openSong(NIGHT, ids['Song one']);
    await openSong(NIGHT, ids['Song two']);
    const past = new Date(Date.now() - 1000).toISOString();
    await run(`UPDATE votable_objects SET closes_at = ? WHERE id = ?`, past, ids['Song one']);
    expect(await labels(NIGHT)).toEqual(['Song two']);
    // A window in another spelling of the same instant is not listed either.
    await run(
      `UPDATE votable_objects SET closes_at = ? WHERE id = ?`,
      past.replace('T', ' ').replace('Z', ''),
      ids['Song two']
    );
    expect(await labels(NIGHT)).toEqual([]);
  });

  test('a set that never opened lists nothing', async () => {
    expect((await admin('POST', NIGHT)).status).toBe(201);
    const made = await admin('POST', NIGHT, '/objects', { kind: 'song', label: 'Song one' });
    expect(made.status).toBe(201);
    // Even an object written open by hand is not listed under a draft set.
    await run(
      `UPDATE votable_objects SET state = 'open', closes_at = ? WHERE id = ?`,
      new Date(Date.now() + 600_000).toISOString(),
      made.json.object.id
    );
    expect(await labels(NIGHT)).toEqual([]);
  });

  test('a closed set lists nothing, though its song is still open', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    expect((await admin('POST', NIGHT, '/close')).status).toBe(200);
    await run(
      `UPDATE votable_objects SET state = 'open', closes_at = ? WHERE id = ?`,
      new Date(Date.now() + 600_000).toISOString(),
      ids['Song one']
    );
    expect(await labels(NIGHT)).toEqual([]);
    // A window ran, so the host cannot reopen the set (WINDOWS_STARTED); set
    // open again by hand, the song is listed: the set's state alone hid it.
    expect((await admin('POST', NIGHT, '/reopen')).json.code).toBe('WINDOWS_STARTED');
    await run(`UPDATE vote_sets SET state = 'open' WHERE event_id = ?`, NIGHT);
    expect(await labels(NIGHT)).toEqual(['Song one']);
  });

  test('a void set lists nothing', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    await run(
      `UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE event_id = ?`,
      NIGHT
    );
    expect(await labels(NIGHT)).toEqual([]);
  });

  test('a final set lists nothing', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    expect(await labels(NIGHT)).toEqual(['Song one']);
    // What S5 will do when it computes results. 0111's CHECK makes a final set
    // closed, so this case passes on the set-state guard as well: removing only
    // `s.is_final = 0` from the read leaves it green. That guard is held by the
    // T0 gate instead (votes-never-who rule 8; security review L2).
    await run(
      `UPDATE vote_sets SET is_final = 1, final_at = '2026-11-18 20:00:00', state = 'closed',
              secret_margin = NULL, secret_floor = NULL WHERE event_id = ?`,
      NIGHT
    );
    expect(await labels(NIGHT)).toEqual([]);
  });

  test('an event that is not live lists nothing: draft, archived, unknown', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    const empty = (await read('evt-voo-unknown')).text;
    expect(JSON.parse(empty)).toEqual({ objects: [] });
    for (const status of ['draft', 'ready', 'archived']) {
      await run(`UPDATE events SET status = ? WHERE id = ?`, status, NIGHT);
      const r = await read(NIGHT);
      expect(r.status, status).toBe(200);
      expect(r.text, status).toBe(empty);
    }
    await run(`UPDATE events SET status = 'active' WHERE id = ?`, NIGHT);
    expect(await labels(NIGHT)).toEqual(['Song one']);
  });

  test('every reason for nothing gives the same bytes', async () => {
    const empty = (await read('evt-voo-unknown')).text;
    expect((await read(NIGHT)).text).toBe(empty); // a live event, no set
    expect((await read(DRAFT)).text).toBe(empty);
    expect((await read(GONE)).text).toBe(empty);
    expect((await read('not an id')).text).toBe(empty);
    expect((await read('x'.repeat(200))).text).toBe(empty);
  });

  test("another event's objects are never listed under this event", async () => {
    const a = await night(NIGHT, ['Night song']);
    const b = await night(OTHER, ['Other song']);
    await openSong(NIGHT, a['Night song']);
    await openSong(OTHER, b['Other song']);
    expect(await labels(NIGHT)).toEqual(['Night song']);
    expect(await labels(OTHER)).toEqual(['Other song']);
  });

  test('the host order: sort, then label', async () => {
    const ids = await night(NIGHT, ['Charlie', 'Alpha', 'Bravo']);
    for (const id of Object.values(ids)) await openSong(NIGHT, id);
    expect(await labels(NIGHT)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    await run(`UPDATE votable_objects SET sort = 0 WHERE event_id = ?`, NIGHT);
    expect(await labels(NIGHT)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});

// ── 4. The limit ─────────────────────────────────────────────────────────────

describe('4. the read is limited per caller, at the page limit', () => {
  test('past the caller minute: 429 with Retry-After; another caller is served', async () => {
    const ip = freshIp();
    const key = await rateLimitKvKey(`publicread:vote-objects:${ip}`, tenv.RATE_LIMIT_KEY_PEPPER);
    await tenv.RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: PUBLIC_PAGE_MAX, resetAt: Date.now() + 60_000, max: PUBLIC_PAGE_MAX })
    );
    const refused = await send('GET', readPath(NIGHT), { 'CF-Connecting-IP': ip }, undefined, ON);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBeTruthy();
    expect((await read(NIGHT)).status).toBe(200);
  });

  test('it skips the 10-second edge layer, so a room behind one address is not refused by it', async () => {
    let asked = 0;
    const refusingEdge = {
      limit: async () => {
        asked += 1;
        return { success: false };
      },
    };
    const res = await read(NIGHT, { ...ON, PUBLIC_READ_EDGE_LIMITER: refusingEdge } as never);
    expect(res.status).toBe(200);
    expect(asked).toBe(0);
    expect(PUBLIC_PAGE_MAX).toBeGreaterThan(PUBLIC_READ_MAX);
  });

  test('150 reads from one address are all served (the story load bar, at the mock layer)', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 150; i++) {
      const res = await send('GET', readPath(NIGHT), { 'CF-Connecting-IP': ip }, undefined, ON);
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });
});

// ── 5. The display carries no vote ───────────────────────────────────────────

const VOTE_WORDS = /vot(?:e|ing|able)|tall(?:y|ies)|ballot|receipt|participant|winner/i;

describe('5. the display and display-config carry nothing of the vote', () => {
  test('with a song open: no vote word, no object id, no label on the TV reads', async () => {
    const ids = await night(NIGHT, ['Zebra Crossing Anthem']);
    await openSong(NIGHT, ids['Zebra Crossing Anthem']);
    expect(await labels(NIGHT)).toEqual(['Zebra Crossing Anthem']); // the control
    const reads = [
      `/api/v2/events/${NIGHT}/display-config`,
      `/api/v2/events/${NIGHT}`,
      `/display?event=${NIGHT}`,
    ];
    for (const path of reads) {
      const res = await send('GET', path, { 'CF-Connecting-IP': freshIp() }, undefined, ON);
      const text = await res.text();
      expect(res.status, path).toBeLessThan(400);
      expect(text, path).not.toContain('Zebra Crossing Anthem');
      expect(text, path).not.toContain(ids['Zebra Crossing Anthem']);
      expect(text, path).not.toContain('/api/v2/vote');
      expect(text, path).not.toMatch(VOTE_WORDS);
    }
  });
});

// ── 6. No cookie ─────────────────────────────────────────────────────────────

describe('6. the read sets no cookie and reads none', () => {
  test('no Set-Cookie; a cookie sent changes nothing', async () => {
    const ids = await night(NIGHT, ['Song one']);
    await openSong(NIGHT, ids['Song one']);
    const plain = await read(NIGHT);
    expect(plain.res.headers.get('Set-Cookie')).toBeNull();
    const withCookie = await read(NIGHT, ON, { Cookie: 'ose_anon=anon_0123456789abcdef; x=1' });
    expect(withCookie.res.headers.get('Set-Cookie')).toBeNull();
    expect(withCookie.text).toBe(plain.text);
  });
});
