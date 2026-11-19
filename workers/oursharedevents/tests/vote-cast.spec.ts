/**
 * OSE-2128 (S4a of OSE-1193) — the vote route: one vote per object per voter,
 * presence by the /q pass, no count in the answer. OSE ADR-040 decisions 1, 4,
 * 5, 6 and 11.
 *
 * Workers-pool layer (miniflare D1). It drives the route through the router
 * with VOTING_ENABLED "on" (the wrangler default stays "off"), the handler and
 * lib/vote-cast.ts directly, /q for the re-scan case, and the Worker's fetch
 * seam for the cost line. Every night here is made by lib/vote-sets.ts.
 *
 * Each case names, in brackets, the fault it was watched failing on first.
 *
 * Staging twin: bruno/ose-api/28. Vote route and the night's result (OSE-2128 OSE-2130).
 * Structural twin: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts
 * (the vote route reads no browser id; its files log nothing about a vote).
 *
 * @born-red OSE-2128 | method: injected-fault, each removed after; listed in
 *   the PR body | date: 2026-11-19
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index';
import { route, type RouterEnv } from '../src/router';
import { handleVote } from '../src/handlers/vote';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { castVote, epochsMatch } from '../src/lib/vote-cast';
import { mintVotePass, openVotePass, voterKey } from '../src/lib/vote-pass';
import { pepperEpoch } from '../src/lib/anon-id-hash';
import {
  adminFinalizeVoteSet,
  closeVoteSet,
  createVotable,
  createVoteSet,
  moveVotable,
  openVoteSet,
  reopenVoteSet,
} from '../src/lib/vote-sets';
import { voteParticipantMarker, voteReceipt, voteTeamMarker } from '../src/lib/votes';
import {
  createCostAccumulator,
  emitOperationCost,
  normalizeOperation,
} from '../src/lib/cost-metric';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const ROTATED = `${PEPPER}-rotated-for-the-test`;
const ORIGIN = 'https://vote-cast.test';
const BRAND = 'brand-vcast';
const OTHER_BRAND = 'brand-vcast-other';
const TEAM_X = 'grp_aaaaaaaa';
const TEAM_Y = 'grp_bbbbbbbb';

type Row = Record<string, any>;
const one = (sql: string, ...b: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...b)
    .first<Row>();
const all = async (sql: string, ...b: unknown[]) =>
  (
    await tenv.DB.prepare(sql)
      .bind(...b)
      .all<Row>()
  ).results;
const run = (sql: string, ...b: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...b)
    .run();

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

const nowIso = () => new Date().toISOString();

async function must<T>(p: Promise<{ ok: true; value: T } | { ok: false }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r)}`);
  return r.value;
}

interface Night {
  eventId: string;
  setId: string;
  objects: string[];
}

/**
 * A live night: a Published event dated today, its set made and opened, and
 * each song added and opened for `windowSeconds`.
 */
async function night(
  eventId: string,
  songs: { label: string; team?: string }[],
  opts: { playedBy?: 'object' | 'team'; brand?: string; windowSeconds?: number } = {}
): Promise<Night> {
  await run(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
     VALUES (?, ?, 'Vote night', ?, 'active', date('now'), datetime('now'), datetime('now'))`,
    eventId,
    opts.brand ?? BRAND,
    eventId
  );
  const set = await must(createVoteSet(tenv.DB, eventId, opts.playedBy ?? 'object'));
  const objects: string[] = [];
  for (const s of songs) {
    const o = await must(
      createVotable(tenv.DB, eventId, {
        kind: 'song',
        label: s.label,
        booth_id: null,
        group_id: s.team ?? null,
        sort: objects.length,
      })
    );
    objects.push(o.id);
  }
  await must(openVoteSet(tenv.DB, eventId, PEPPER, nowIso()));
  for (const id of objects)
    await must(moveVotable(tenv.DB, eventId, id, 'open', opts.windowSeconds ?? 3600, nowIso()));
  return { eventId, setId: set.id, objects };
}

const cookieOf = (n: number | string) => `anon_vcast-${String(n).padStart(4, '0')}-0000-0000`;
const passFor = async (eventId: string, who: number | string, pepper = PEPPER, at = Date.now()) =>
  (await mintVotePass(pepper, cookieOf(who), eventId, at)) as string;

function voteRequest(
  eventId: string,
  body: unknown,
  opts: { headers?: Record<string, string | null>; method?: string; raw?: string } = {}
): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Sec-Fetch-Site': 'same-origin',
  });
  for (const [k, v] of Object.entries(opts.headers ?? {}))
    if (v === null) headers.delete(k);
    else headers.set(k, v);
  const method = opts.method ?? 'POST';
  return new Request(`${ORIGIN}/api/v2/vote/${eventId}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : (opts.raw ?? JSON.stringify(body)),
  });
}

async function viaRouter(req: Request, over: Record<string, unknown> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await route(
    req,
    { ...(env as unknown as RouterEnv), VOTING_ENABLED: 'on', ...over } as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function vote(
  n: Night,
  objectIndex: number,
  who: number | string,
  side: 'up' | 'down' = 'up',
  over: Record<string, unknown> = {}
): Promise<Response> {
  const pass = await passFor(n.eventId, who);
  return viaRouter(voteRequest(n.eventId, { object_id: n.objects[objectIndex], side, pass }), over);
}

const tally = async (objectId: string) =>
  (await one(
    `SELECT up_count AS up, down_count AS down FROM vote_tallies WHERE object_id = ?`,
    objectId
  )) as {
    up: number;
    down: number;
  };

/** Everything a vote can write, for one night. */
async function written(n: Night) {
  const tallies = await all(
    `SELECT object_id, up_count AS up, down_count AS down FROM vote_tallies
      WHERE object_id IN (SELECT id FROM votable_objects WHERE set_id = ?) ORDER BY object_id`,
    n.setId
  );
  return {
    tallies: tallies.map((t) => `${t.object_id}:${t.up}/${t.down}`),
    receipts: (
      await all(
        `SELECT COUNT(*) AS c FROM vote_receipts
          WHERE object_id IN (SELECT id FROM votable_objects WHERE set_id = ?)`,
        n.setId
      )
    )[0].c,
    participants: (
      await one(`SELECT COUNT(*) AS c FROM vote_participants WHERE set_id = ?`, n.setId)
    )?.c,
    teams: (await one(`SELECT COUNT(*) AS c FROM vote_team_markers WHERE set_id = ?`, n.setId))?.c,
  };
}

const EMPTY = (n: Night) => ({
  tallies: n.objects.map((o) => `${o}:0/0`).sort(),
  receipts: 0,
  participants: 0,
  teams: 0,
});

// Fresh nights for every case: storage is shared across the file's tests, so
// each case makes its own events and starts from nothing.
let N: Night;
let B: Night; // another event, another brand
let T: Night; // a team night
let round = 0;

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  round++;
  N = await night(`evt-vcast-main-${round}`, [{ label: 'Song one' }, { label: 'Song two' }]);
  B = await night(`evt-vcast-other-${round}`, [{ label: 'Elsewhere' }], { brand: OTHER_BRAND });
  T = await night(
    `evt-vcast-teams-${round}`,
    [
      { label: 'X one', team: TEAM_X },
      { label: 'X two', team: TEAM_X },
      { label: 'X three', team: TEAM_X },
      { label: 'Y one', team: TEAM_Y },
    ],
    { playedBy: 'team' }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── counting ─────────────────────────────────────────────────────────────────

describe('OSE-2128 | one vote per object per voter', () => {
  test('OSE-2128 | POSITIVE | an open object counts one up vote [skip the increment]', async () => {
    const res = await vote(N, 0, 1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
    expect(await tally(N.objects[1])).toEqual({ up: 0, down: 0 });
    const w = await written(N);
    expect([w.receipts, w.participants, w.teams]).toEqual([1, 1, 0]);
  });

  test('OSE-2128 | a "not for me" counts on its own counter', async () => {
    expect((await vote(N, 0, 2, 'down')).status).toBe(200);
    expect(await tally(N.objects[0])).toEqual({ up: 0, down: 1 });
  });

  test('OSE-2128 | the same pass twice on one object counts once, whichever side [side in the receipt key]', async () => {
    const pass = await passFor(N.eventId, 3);
    for (const side of ['up', 'down', 'up', 'down'])
      expect(
        (await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side, pass }))).status
      ).toBe(200);
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
    const w = await written(N);
    expect([w.receipts, w.participants]).toEqual([1, 1]);
  });

  test('OSE-2128 | the counter rises only when the receipt is new [wrong batch order]', async () => {
    await vote(N, 1, 4);
    await vote(N, 1, 4);
    await vote(N, 1, 4, 'down');
    await vote(N, 1, 5);
    expect(await tally(N.objects[1])).toEqual({ up: 2, down: 0 });
    // One voter on two objects: two receipts, one participant marker.
    await vote(N, 0, 4);
    const w = await written(N);
    expect([w.receipts, w.participants]).toEqual([3, 2]);
  });

  test('OSE-2128 | a receipt cannot be computed from the pass alone [receipt = HMAC(k, object)]', async () => {
    const pass = await passFor(N.eventId, 6);
    await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }));
    const claims = await openVotePass(PEPPER, pass, Date.now(), N.eventId);
    const k = claims!.k;
    const stored = (
      await all(`SELECT receipt FROM vote_receipts WHERE object_id = ?`, N.objects[0])
    ).map((r) => r.receipt as string);
    expect(stored).toEqual([await voteReceipt(PEPPER, k, N.objects[0])]);
    // What a holder of the pass alone could make from k and the object id.
    const enc = new TextEncoder();
    const hex = (b: ArrayBuffer) =>
      Array.from(new Uint8Array(b))
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    const hmacUnderK = async (msg: string, keyText: string) => {
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(keyText),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
    };
    const fromPassAlone = [
      await hmacUnderK(N.objects[0], k),
      await hmacUnderK(`${k}${N.objects[0]}`, k),
      hex(await crypto.subtle.digest('SHA-256', enc.encode(`${k}${N.objects[0]}`))),
      hex(await crypto.subtle.digest('SHA-256', enc.encode(`${N.objects[0]}${k}`))),
    ];
    for (const guess of fromPassAlone) expect(stored).not.toContain(guess);
    // The receipt is not the participant marker or a team marker either.
    expect(stored[0]).not.toBe(await voteParticipantMarker(PEPPER, k, N.setId));
    expect(stored[0]).not.toBe(await voteTeamMarker(PEPPER, k, TEAM_X));
  });

  test('OSE-2128 | a re-scan gives the same voter key, so a second vote on one object counts once [event left out of k]', async () => {
    // Through /q, the vote code of each night, the same browser twice.
    const kv = new Map<string, string>();
    const RATE_LIMIT_KV = {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace;
    for (const [eventId, token] of [
      [N.eventId, `qrt_vcast_main_${round}`],
      [B.eventId, `qrt_vcast_other_${round}`],
    ])
      await run(
        `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_vote_code, is_active, created_at)
         VALUES (?, ?, ?, 'Room screen', 1, 1, datetime('now'))`,
        `pd-${eventId}`,
        eventId,
        token
      );
    const scanEnv = {
      DB: tenv.DB,
      RATE_LIMIT_KV,
      ANON_ID_HASH_PEPPER: PEPPER,
      VOTING_ENABLED: 'on',
    } as QrScanEnv;
    const cookie = cookieOf('rescan');
    const scan = async (token: string, at: number) => {
      vi.spyOn(Date, 'now').mockReturnValue(at);
      const res = await handleQrScan(
        new Request(`${ORIGIN}/q/${token}?type=vote`, {
          headers: { Cookie: `ose_anon=${cookie}`, 'User-Agent': 'vote-cast-test' },
        }),
        scanEnv,
        token,
        true
      );
      vi.restoreAllMocks();
      const hash = new URL(res.headers.get('Location') ?? '', ORIGIN).hash;
      return hash.startsWith('#t=') ? hash.slice(3) : null;
    };
    const t0 = Date.now();
    const first = await scan(`qrt_vcast_main_${round}`, t0);
    const second = await scan(`qrt_vcast_main_${round}`, t0 + 60_000);
    const elsewhere = await scan(`qrt_vcast_other_${round}`, t0);
    expect(first && second && elsewhere).toBeTruthy();
    expect(second).not.toBe(first);
    const k1 = (await openVotePass(PEPPER, first, Date.now(), N.eventId))!.k;
    const k2 = (await openVotePass(PEPPER, second, Date.now(), N.eventId))!.k;
    const kB = (await openVotePass(PEPPER, elsewhere, Date.now(), B.eventId))!.k;
    expect(k2).toBe(k1);
    expect(kB).not.toBe(k1);
    expect(k1).toBe(await voterKey(PEPPER, cookie, N.eventId));
    for (const pass of [first, second])
      expect(
        (await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass })))
          .status
      ).toBe(200);
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
  });

  test('OSE-2128 | after a reopen, a person who voted still cannot vote again on that object [receipts cleared at reopen or close]', async () => {
    await vote(N, 0, 7);
    await must(moveVotable(tenv.DB, N.eventId, N.objects[0], 'close', 0, nowIso()));
    await must(closeVoteSet(tenv.DB, N.eventId, nowIso()));
    expect((await vote(N, 0, 7)).status).toBe(409);
    await must(reopenVoteSet(tenv.DB, N.eventId, PEPPER, nowIso()));
    await must(moveVotable(tenv.DB, N.eventId, N.objects[0], 'reopen', 600, nowIso()));
    expect((await vote(N, 0, 7)).status).toBe(200);
    expect((await vote(N, 0, 7, 'down')).status).toBe(200);
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
    expect((await vote(N, 0, 8)).status).toBe(200);
    expect(await tally(N.objects[0])).toEqual({ up: 2, down: 0 });
  });

  test('OSE-2128 | on a team night, an up vote writes one team marker per voter per team; a "not for me" writes none', async () => {
    await vote(T, 0, 1); // X one, up
    await vote(T, 1, 1); // X two, up: the same team
    await vote(T, 2, 1, 'down'); // X three, not for me
    await vote(T, 3, 1, 'down'); // Y one, not for me
    await vote(T, 0, 1); // X one again: a duplicate
    const markers = await all(
      `SELECT team_id FROM vote_team_markers WHERE set_id = ? ORDER BY team_id`,
      T.setId
    );
    expect(markers.map((m) => m.team_id)).toEqual([TEAM_X]);
    await vote(T, 3, 2); // another voter backs Y
    const after = await all(
      `SELECT team_id, COUNT(*) AS c FROM vote_team_markers WHERE set_id = ? GROUP BY team_id ORDER BY team_id`,
      T.setId
    );
    expect(after.map((r) => `${r.team_id}:${r.c}`)).toEqual([`${TEAM_X}:1`, `${TEAM_Y}:1`]);
    // A "not for me" first, then up on the same song, is a duplicate: no marker.
    await vote(T, 3, 3, 'down');
    await vote(T, 3, 3, 'up');
    expect(
      (
        await one(
          `SELECT COUNT(*) AS c FROM vote_team_markers WHERE set_id = ? AND team_id = ?`,
          T.setId,
          TEAM_Y
        )
      )?.c
    ).toBe(1);
    // A night played by songs writes no team marker, whatever the vote.
    await vote(N, 0, 9);
    expect((await written(N)).teams).toBe(0);
  });
});

// ── the answer ───────────────────────────────────────────────────────────────

describe('OSE-2128 | the answer', () => {
  const headerBag = (res: Response) =>
    [...res.headers.entries()].filter(([k]) => k.toLowerCase() !== 'date').sort();

  test('OSE-2128 | SECURITY | answer bytes identical for counted and duplicate [up_count echoed]', async () => {
    const pass = await passFor(N.eventId, 10);
    const body = { object_id: N.objects[0], side: 'up', pass };
    const counted = await viaRouter(voteRequest(N.eventId, body));
    const duplicate = await viaRouter(voteRequest(N.eventId, body));
    const otherSide = await viaRouter(voteRequest(N.eventId, { ...body, side: 'down' }));
    const a = await counted.text();
    for (const r of [duplicate, otherSide]) {
      expect(r.status).toBe(counted.status);
      expect(headerBag(r)).toEqual(headerBag(counted));
      expect(await r.text()).toBe(a);
    }
    expect(a).toBe('{"ok":true}');
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
  });

  test('OSE-2128 | SECURITY | no count and no Set-Cookie in any answer, counted, duplicate or refused', async () => {
    const pass = await passFor(N.eventId, 11);
    const answers = [
      await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass })),
      await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass })),
      await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up' })),
      await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass: 'x' })),
      await viaRouter(voteRequest(N.eventId, { object_id: 'vobj_nope', side: 'up', pass })),
    ];
    for (const res of answers) {
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const text = await res.text();
      expect(text).not.toMatch(/count|tally|up_|down_|receipt|marker|voter|\d/i);
    }
  });

  test('OSE-2128 | GET and HEAD never vote', async () => {
    const pass = await passFor(N.eventId, 12);
    for (const method of ['GET', 'HEAD']) {
      const url = new URL(`${ORIGIN}/api/v2/vote/${N.eventId}`);
      url.searchParams.set('object_id', N.objects[0]);
      url.searchParams.set('side', 'up');
      url.searchParams.set('pass', pass);
      const res = await viaRouter(
        new Request(url, { method, headers: { 'Sec-Fetch-Site': 'same-origin' } })
      );
      expect(res.status, method).toBe(404);
      const direct = await handleVote(
        new Request(url, { method }),
        { DB: tenv.DB, ANON_ID_HASH_PEPPER: PEPPER, VOTING_ENABLED: 'on' },
        N.eventId
      );
      expect(direct.status, method).toBe(404);
    }
    expect(await written(N)).toEqual(EMPTY(N));
  });

  test('OSE-2128 | the switch off: the router answers its own 404 and nothing is written', async () => {
    const pass = await passFor(N.eventId, 13);
    for (const value of [undefined, 'off', '', 'ON', 'true']) {
      const res = await viaRouter(
        voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }),
        { VOTING_ENABLED: value }
      );
      expect(res.status, String(value)).toBe(404);
      expect(await res.json()).toEqual({ ok: false, status: 404, error: 'Not found' });
    }
    // The handler asks the switch itself too.
    const direct = await handleVote(
      voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }),
      { DB: tenv.DB, ANON_ID_HASH_PEPPER: PEPPER, VOTING_ENABLED: 'off' },
      N.eventId
    );
    expect(direct.status).toBe(404);
    expect(await written(N)).toEqual(EMPTY(N));
  });
});

// ── the request ──────────────────────────────────────────────────────────────

describe('OSE-2128 | the request: JSON only, same-origin, three fields', () => {
  test('OSE-2128 | SECURITY | a form-encoded or cross-site POST: refused [JSON or same-origin check removed]', async () => {
    const pass = await passFor(N.eventId, 20);
    const body = { object_id: N.objects[0], side: 'up', pass };
    const form = new URLSearchParams(body).toString();
    for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data'])
      expect(
        (
          await viaRouter(
            voteRequest(N.eventId, null, { raw: form, headers: { 'Content-Type': ct } })
          )
        ).status,
        ct
      ).toBe(415);
    expect(
      (
        await viaRouter(
          voteRequest(N.eventId, null, {
            raw: JSON.stringify(body),
            headers: { 'Content-Type': null },
          })
        )
      ).status
    ).toBe(415);
    for (const site of ['cross-site', 'same-site', 'none', null])
      expect(
        (await viaRouter(voteRequest(N.eventId, body, { headers: { 'Sec-Fetch-Site': site } })))
          .status,
        String(site)
      ).toBe(403);
    expect(await written(N)).toEqual(EMPTY(N));
    // Positive control: the same body, from the page, as JSON.
    expect((await viaRouter(voteRequest(N.eventId, body))).status).toBe(200);
  });

  test('OSE-2128 | a body of any other shape is refused, with nothing written', async () => {
    const pass = await passFor(N.eventId, 21);
    const good = { object_id: N.objects[0], side: 'up', pass };
    const bad: unknown[] = [
      { ...good, side: 'sideways' },
      { ...good, side: 'UP' },
      { ...good, object_id: '' },
      { ...good, object_id: 'x'.repeat(81) },
      { ...good, object_id: 'vobj_1; DROP' },
      { object_id: good.object_id, side: 'up' },
      { ...good, extra: 1 },
      { ...good, up_count: 5 },
      [good],
      'a string',
      null,
    ];
    for (const b of bad) expect((await viaRouter(voteRequest(N.eventId, b))).status).toBe(400);
    expect((await viaRouter(voteRequest(N.eventId, null, { raw: '{not json' }))).status).toBe(400);
    expect(
      (
        await viaRouter(
          voteRequest(N.eventId, null, { raw: JSON.stringify({ ...good, pad: 'x'.repeat(4000) }) })
        )
      ).status
    ).toBe(400);
    expect(await written(N)).toEqual(EMPTY(N));
  });
});

// ── the pass ─────────────────────────────────────────────────────────────────

describe('OSE-2128 | the pass', () => {
  test('OSE-2128 | SECURITY | no pass: refused, nothing written, no Set-Cookie [pass check skipped]', async () => {
    for (const body of [
      { object_id: N.objects[0], side: 'up' },
      { object_id: N.objects[0], side: 'up', pass: '' },
    ]) {
      const res = await viaRouter(voteRequest(N.eventId, body));
      expect(res.status).toBe(400);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    for (const junk of ['x', 'vp1.', 'vp1.a.b', 'vp2.abc.def', 'a'.repeat(600)]) {
      const res = await viaRouter(
        voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass: junk })
      );
      expect(res.status, junk.slice(0, 12)).toBe(403);
      expect(await res.text()).toBe('{"ok":false,"code":"PASS_REFUSED"}');
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    expect(await written(N)).toEqual(EMPTY(N));
  });

  test('OSE-2128 | SECURITY | tampered pass, or k altered: refused [MAC check dropped]', async () => {
    const pass = await passFor(N.eventId, 30);
    const [prefix, body, mac] = pass.split('.');
    const flipped = `${prefix}.${body}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const wire = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    const otherK = (await voterKey(PEPPER, cookieOf(31), N.eventId)) as string;
    const kAltered = `${prefix}.${b64(JSON.stringify({ ...wire, k: otherK }))}.${mac}`;
    const longer = `${prefix}.${b64(JSON.stringify({ ...wire, x: wire.x + 86_400 }))}.${mac}`;
    for (const p of [flipped, kAltered, longer]) {
      const res = await viaRouter(
        voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass: p })
      );
      expect(res.status).toBe(403);
    }
    expect(await written(N)).toEqual(EMPTY(N));
  });

  test('OSE-2128 | SECURITY | a pass for another event: refused', async () => {
    const forB = await passFor(B.eventId, 32);
    // B's pass, at N's route, on N's object and on B's object.
    for (const objectId of [N.objects[0], B.objects[0]]) {
      const res = await viaRouter(
        voteRequest(N.eventId, { object_id: objectId, side: 'up', pass: forB })
      );
      expect(res.status).toBe(403);
    }
    expect(await written(N)).toEqual(EMPTY(N));
    expect(await written(B)).toEqual(EMPTY(B));
  });

  test('OSE-2128 | SECURITY | an expired pass: refused (controlled clock)', async () => {
    const t0 = Date.now();
    const pass = await passFor(N.eventId, 33, PEPPER, t0);
    const body = { object_id: N.objects[0], side: 'up', pass };
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 30 * 60_000);
    expect((await viaRouter(voteRequest(N.eventId, body))).status).toBe(403);
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 3 * 60 * 60_000);
    expect((await viaRouter(voteRequest(N.eventId, body))).status).toBe(403);
    vi.restoreAllMocks();
    expect(await written(N)).toEqual(EMPTY(N));
    // One second inside its 30 minutes, the same pass counts.
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 30 * 60_000 - 1000);
    expect((await viaRouter(voteRequest(N.eventId, body))).status).toBe(200);
    vi.restoreAllMocks();
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
  });

  test('OSE-2128 | SECURITY | pepper or pass key missing: refused, nothing written [unkeyed fallback]', async () => {
    const pass = await passFor(N.eventId, 34);
    for (const pepper of [undefined, '']) {
      const res = await viaRouter(
        voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }),
        { ANON_ID_HASH_PEPPER: pepper }
      );
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('{"ok":false,"code":"VOTE_UNAVAILABLE"}');
      expect(
        await castVote(tenv.DB, pepper, {
          eventId: N.eventId,
          objectId: N.objects[0],
          side: 'up',
          pass,
          nowMs: Date.now(),
        })
      ).toBe('unavailable');
    }
    expect(await written(N)).toEqual(EMPTY(N));
  });
});

// ── the pepper epoch ─────────────────────────────────────────────────────────

describe('OSE-2128 | three epochs: the pass, the set and the current one', () => {
  test('OSE-2128 | UNIT | all three must match [only pass and set compared]', () => {
    expect(epochsMatch('e1', 'e1', 'e1')).toBe(true);
    expect(epochsMatch('e1', 'e1', 'e2')).toBe(false); // the pepper rotated since both
    expect(epochsMatch('e2', 'e1', 'e2')).toBe(false); // the set is from before a rotation
    expect(epochsMatch('e1', 'e2', 'e2')).toBe(false); // the pass is from before it
    expect(epochsMatch('e1', 'e2', 'e1')).toBe(false);
    for (const missing of [null, undefined, ''])
      expect(epochsMatch(missing, missing, missing)).toBe(false);
    expect(epochsMatch('e1', null, 'e1')).toBe(false);
  });

  test('OSE-2128 | SECURITY | on the first mismatch the vote is refused and the set is marked void with its reason', async () => {
    // The pepper rotates under the open set: a fresh pass carries the new
    // epoch, the set holds the old one.
    const fresh = await passFor(N.eventId, 40, ROTATED);
    const res = await viaRouter(
      voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass: fresh }),
      { ANON_ID_HASH_PEPPER: ROTATED }
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('{"ok":false,"code":"NOT_OPEN"}');
    expect(
      await one(`SELECT is_void, void_reason, state, is_final FROM vote_sets WHERE id = ?`, N.setId)
    ).toEqual({
      is_void: 1,
      void_reason: 'pepper_epoch',
      state: 'open',
      is_final: 0,
    });
    expect(await written(N)).toEqual(EMPTY(N));
    // Void for good: back on the old pepper, a valid pass is still refused.
    const back = await vote(N, 0, 41);
    expect(back.status).toBe(409);
    expect(await written(N)).toEqual(EMPTY(N));
    // And a reopen cannot clear it.
    await must(closeVoteSet(tenv.DB, N.eventId, nowIso()));
    await must(reopenVoteSet(tenv.DB, N.eventId, PEPPER, nowIso()));
    expect((await vote(N, 0, 42)).status).toBe(409);
    expect((await one(`SELECT is_void FROM vote_sets WHERE id = ?`, N.setId))?.is_void).toBe(1);
  });

  test('OSE-2128 | SECURITY | a pass minted before a pepper rotation is refused after it [old pass gets a receipt under the new key]', async () => {
    const old = await passFor(N.eventId, 43);
    const res = await viaRouter(
      voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass: old }),
      { ANON_ID_HASH_PEPPER: ROTATED }
    );
    expect(res.status).toBe(403);
    expect(await written(N)).toEqual(EMPTY(N));
    const claims = await openVotePass(PEPPER, old, Date.now(), N.eventId);
    expect(claims?.pepper_epoch).toBe(await pepperEpoch(PEPPER));
    expect(await voteReceipt(ROTATED, claims!.k, N.objects[0])).not.toBe(
      await voteReceipt(PEPPER, claims!.k, N.objects[0])
    );
  });
});

// ── the object, the set and the event ────────────────────────────────────────

describe('OSE-2128 | only an open object of a live event takes a vote', () => {
  test('OSE-2128 | SECURITY | object of another event (another brand): refused', async () => {
    const pass = await passFor(N.eventId, 50);
    const res = await viaRouter(
      voteRequest(N.eventId, { object_id: B.objects[0], side: 'up', pass })
    );
    expect(res.status).toBe(409);
    expect(await written(B)).toEqual(EMPTY(B));
    expect(await written(N)).toEqual(EMPTY(N));
    // And B's route with N's pass is a pass for another event.
    const res2 = await viaRouter(
      voteRequest(B.eventId, { object_id: B.objects[0], side: 'up', pass })
    );
    expect(res2.status).toBe(403);
    expect(await written(B)).toEqual(EMPTY(B));
  });

  test('OSE-2128 | SECURITY | closed, past closes_at, or final: refused', async () => {
    const pass = await passFor(N.eventId, 51);
    const try0 = async () =>
      viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }));
    // The object closed.
    await must(moveVotable(tenv.DB, N.eventId, N.objects[0], 'close', 0, nowIso()));
    expect((await try0()).status).toBe(409);
    await must(moveVotable(tenv.DB, N.eventId, N.objects[0], 'reopen', 600, nowIso()));
    // Past its closes_at, though its state still reads open.
    await run(
      `UPDATE votable_objects SET closes_at = ? WHERE id = ?`,
      new Date(Date.now() - 1000).toISOString(),
      N.objects[0]
    );
    expect((await try0()).status).toBe(409);
    await must(moveVotable(tenv.DB, N.eventId, N.objects[0], 'reopen', 600, nowIso()));
    // The set closed.
    await must(closeVoteSet(tenv.DB, N.eventId, nowIso()));
    expect((await try0()).status).toBe(409);
    await must(reopenVoteSet(tenv.DB, N.eventId, PEPPER, nowIso()));
    // Positive control, then final.
    expect((await vote(N, 1, 52)).status).toBe(200);
    expect(await tally(N.objects[1])).toEqual({ up: 1, down: 0 });
    await must(adminFinalizeVoteSet(tenv.DB, N.eventId, nowIso()));
    expect((await try0()).status).toBe(409);
    expect((await vote(N, 1, 53)).status).toBe(409);
    expect(
      await one(`SELECT COUNT(*) AS c FROM vote_receipts WHERE object_id IN (?, ?)`, ...N.objects)
    ).toEqual({ c: 0 });
  });

  test('OSE-2128 | SECURITY | a draft object, and an event that is not live: refused', async () => {
    const d = await must(
      createVotable(tenv.DB, N.eventId, {
        kind: 'song',
        label: 'Not yet',
        booth_id: null,
        group_id: null,
        sort: 9,
      })
    );
    const pass = await passFor(N.eventId, 54);
    expect(
      (await viaRouter(voteRequest(N.eventId, { object_id: d.id, side: 'up', pass }))).status
    ).toBe(409);
    // A status written outside the app leaves the set open; the route still
    // refuses, because it asks EVENT_LIVE in the batch (decision 11).
    for (const status of ['draft', 'ready', 'archived']) {
      await run(`UPDATE events SET status = ? WHERE id = ?`, status, N.eventId);
      expect(
        (await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass })))
          .status,
        status
      ).toBe(409);
    }
    await run(
      `UPDATE events SET status = 'active', start_date = ?, end_date = ? WHERE id = ?`,
      '2020-01-01',
      '2020-01-02',
      N.eventId
    );
    expect(
      (await viaRouter(voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass })))
        .status,
      'past its dates'
    ).toBe(409);
    expect(await written(N)).toEqual({
      ...EMPTY(N),
      tallies: [...EMPTY(N).tallies, `${d.id}:0/0`].sort(),
    });
  });

  test('OSE-2128 | SECURITY | a close that lands just before the batch is seen inside it [check outside the batch]', async () => {
    const pass = await passFor(N.eventId, 55);
    // The close runs after every read the vote makes, just before its batch.
    const racing = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'batch')
          return async (stmts: D1PreparedStatement[]) => {
            await target
              .prepare(`UPDATE votable_objects SET state = 'closed' WHERE id = ?`)
              .bind(N.objects[0])
              .run();
            return target.batch(stmts);
          };
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const res = await handleVote(
      voteRequest(N.eventId, { object_id: N.objects[0], side: 'up', pass }),
      { DB: racing, ANON_ID_HASH_PEPPER: PEPPER, VOTING_ENABLED: 'on' },
      N.eventId
    );
    expect(res.status).toBe(409);
    expect(await written(N)).toEqual(EMPTY(N));
  });
});

// ── logs and cost ────────────────────────────────────────────────────────────

describe('OSE-2128 | what is logged', () => {
  test('OSE-2128 | SECURITY | no log line carries object, side, event, pass, k or receipt', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) =>
      void lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation(capture);
    const pass = await passFor(N.eventId, 60);
    const body = { object_id: N.objects[0], side: 'up', pass };
    await viaRouter(voteRequest(N.eventId, body)); // counted
    await viaRouter(voteRequest(N.eventId, body)); // duplicate
    await viaRouter(voteRequest(N.eventId, { ...body, pass: 'x' })); // refused
    await viaRouter(voteRequest(N.eventId, { ...body, object_id: B.objects[0] })); // not open
    // A database failure: the one line the route writes.
    const broken = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'batch')
          return () => Promise.reject(new Error(`D1_ERROR: ${N.objects[0]} ${pass}`));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const failed = await handleVote(
      voteRequest(N.eventId, body),
      { DB: broken, ANON_ID_HASH_PEPPER: PEPPER, VOTING_ENABLED: 'on' },
      N.eventId
    );
    expect(failed.status).toBe(503);
    // Through the Worker's fetch seam, so the cost line is in it too.
    const ctx = createExecutionContext();
    await worker.fetch(
      voteRequest(N.eventId, { ...body, side: 'down' }),
      { ...(env as unknown as RouterEnv), VOTING_ENABLED: 'on' } as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    const claims = await openVotePass(PEPPER, pass, Date.now(), N.eventId);
    const receipt = await voteReceipt(PEPPER, claims!.k, N.objects[0]);
    const text = lines.join('\n');
    expect(lines.some((l) => l.includes('VOTE_WRITE_ERROR'))).toBe(true);
    expect(lines.some((l) => l.includes('OPERATION_COST'))).toBe(true);
    for (const secret of [
      N.objects[0],
      B.objects[0],
      N.eventId,
      pass,
      'vp1.',
      claims!.k,
      receipt!,
      N.setId,
    ])
      expect(text.includes(secret), secret.slice(0, 16)).toBe(false);
    expect(/"side"|\bup\b|\bdown\b/.test(text)).toBe(false);
  });

  test('OSE-2128 | OPERATION_COST rows-written is null for a vote', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])));
    const costOf = async (req: Request) => {
      lines.length = 0;
      const ctx = createExecutionContext();
      await worker.fetch(
        req,
        { ...(env as unknown as RouterEnv), VOTING_ENABLED: 'on' } as RouterEnv,
        ctx
      );
      await waitOnExecutionContext(ctx);
      const line = lines.find((l) => l.includes('"OPERATION_COST"'));
      return line ? JSON.parse(line) : null;
    };
    const pass = await passFor(N.eventId, 61);
    const body = { object_id: N.objects[0], side: 'up', pass };
    const counted = await costOf(voteRequest(N.eventId, body));
    const duplicate = await costOf(voteRequest(N.eventId, body));
    for (const c of [counted, duplicate]) {
      expect(c).toMatchObject({
        op: 'POST /api/v2/vote/:x',
        status: 200,
        d1RowsWritten: null,
        d1RowsRead: null,
      });
    }
    expect(counted.d1Queries).toBe(duplicate.d1Queries);
    expect(await tally(N.objects[0])).toEqual({ up: 1, down: 0 });
    // Another operation keeps its numbers.
    const acc = createCostAccumulator();
    acc.d1RowsWritten = 3;
    lines.length = 0;
    emitOperationCost({
      op: normalizeOperation('GET', `/api/v2/vote/${N.eventId}/objects`),
      wallMs: 1,
      acc,
      status: 200,
    });
    expect(JSON.parse(lines[0])).toMatchObject({
      op: 'GET /api/v2/vote/:x/objects',
      d1RowsWritten: 3,
    });
  });
});
