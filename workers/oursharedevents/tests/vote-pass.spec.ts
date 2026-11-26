/**
 * OSE-2133 (S3b of OSE-1193) — `/q` issues the vote pass. OSE ADR-040 decision 6.
 *
 * Workers-pool layer (miniflare D1). It drives handleQrScan directly, and once
 * through the router, with a vote set made and opened by lib/vote-sets.ts.
 *
 * What it holds:
 *   - A vote code (`/q/<token>?type=vote`) with an open set and VOTING_ENABLED
 *     "on" lands on `/events/<id>/vote#t=<pass>`: the pass is only in the
 *     fragment, never in the query string.
 *   - No pass with no set open, the switch off, on the uncounted path, with no
 *     pepper, or when the scan write failed; a duplicate of a stored scan gets
 *     one.
 *   - k = HMAC(K_voter, len(cookie) ‖ cookie ‖ event_id) under its own label:
 *     two events give two keys, k is never the scan key or any other label's
 *     HMAC, and cookies of different lengths cannot collide.
 *   - A pass lasts 30 minutes; a re-scan renews it with the same k.
 *   - No log line carries the pass, k or the Location header.
 *   - Every other code kind keeps qrScanTarget's redirect.
 *
 * Since OSE-2140 (S3d) only the event's own vote code mints a pass, so each
 * event's placement here is marked as its vote code (is_vote_code = 1). That an
 * ordinary poster code mints none is held in tests/vote-code.spec.ts.
 *
 * Staging twin: bruno/ose-api/25. Vote pass at scan (OSE-2133).
 * Structural twin: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts
 * (the labels and the no-Location-log rule).
 *
 * @born-red OSE-2133 | method: injected-fault, each removed after; listed in
 *   the PR body | date: 2026-11-18
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { linkVenue } from './helpers/link-venue';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { handleQrScan, qrScanTarget, type QrScanEnv } from '../src/handlers/qr-scan';
import { route, type RouterEnv } from '../src/router';
import {
  issueVotePass,
  mintVotePass,
  openVotePass,
  voterKey,
  voterKeyMessage,
  VOTE_PASS_TTL_SECONDS,
} from '../src/lib/vote-pass';
import { scanNodeKey, SCAN_NODE_KEY_CONTEXT } from '../src/lib/scan-node-key';
import { signAnonId } from '../src/lib/anonymous-id';
import {
  VOTE_PARTICIPANT_CONTEXT,
  VOTE_RECEIPT_CONTEXT,
  VOTE_TEAM_CONTEXT,
} from '../src/lib/votes';
import { closeVoteSet, createVoteSet, openVoteSet } from '../src/lib/vote-sets';
import { voteCodeStamp } from '../src/lib/vote-code-window';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;

const ORIGIN = 'https://vote-pass.test';
const OPEN = 'evt-vpass-open'; // its set is open
const OPEN_2 = 'evt-vpass-open-2'; // a second event with its set open
const NOSET = 'evt-vpass-noset'; // no vote set
const DRAFT = 'evt-vpass-draft'; // set made, never opened
const CLOSED = 'evt-vpass-closed'; // set opened then closed
const TOKEN: Record<string, string> = {
  [OPEN]: 'qrt_vpass_open_0001',
  [OPEN_2]: 'qrt_vpass_open_0002',
  [NOSET]: 'qrt_vpass_noset_0001',
  [DRAFT]: 'qrt_vpass_draft_0001',
  [CLOSED]: 'qrt_vpass_closed_0001',
};
const DEPLOYMENT = (eventId: string) => `pd-${eventId}`;
const COOKIE = 'anon_11111111-2222-3333-4444-555555555555';

function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

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

async function seedEvent(id: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
     VALUES (?, 'brand-vpass', 'Vote pass night', ?, 'active', date('now'), datetime('now'), datetime('now'))`
  )
    .bind(id, id)
    .run();
  await tenv.DB.prepare(
    `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_vote_code, is_active, created_at)
     VALUES (?, ?, ?, 'Room screen', 1, 1, datetime('now'))`
  )
    .bind(DEPLOYMENT(id), id, TOKEN[id])
    .run();
  await linkVenue(tenv.DB, id);
}

const nowIso = () => new Date().toISOString();

async function mustOk<T>(p: Promise<{ ok: boolean } & T>): Promise<void> {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r)}`);
}

beforeAll(async () => {
  await applyMigrations();
  for (const id of [OPEN, OPEN_2, NOSET, DRAFT, CLOSED]) await seedEvent(id);
  for (const id of [OPEN, OPEN_2, DRAFT, CLOSED])
    await mustOk(createVoteSet(tenv.DB, id, 'object'));
  for (const id of [OPEN, OPEN_2, CLOSED])
    await mustOk(openVoteSet(tenv.DB, id, PEPPER, nowIso(), 200));
  await mustOk(closeVoteSet(tenv.DB, CLOSED, nowIso()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function scanEnv(over: Partial<QrScanEnv> = {}): QrScanEnv {
  return {
    DB: tenv.DB,
    RATE_LIMIT_KV: makeKV(),
    ANON_ID_HASH_PEPPER: PEPPER,
    VOTING_ENABLED: 'on',
    ...over,
  };
}

// A returning visitor presents the cookie the Worker signed for them (OSE-1496).
async function scanRequest(
  eventId: string,
  opts: { type?: string | null; cookie?: string } = {}
): Promise<Request> {
  const type = opts.type === undefined ? 'vote' : opts.type;
  // The rotating code: a vote scan carries this minute's stamp, as the room screen shows it.
  const stamp =
    type === 'vote' ? `&w=${await voteCodeStamp(PEPPER, TOKEN[eventId], Date.now())}` : '';
  const url = `${ORIGIN}/q/${TOKEN[eventId]}${type === null ? '' : `?type=${type}${stamp}`}`;
  const headers: Record<string, string> = { 'User-Agent': 'vote-pass-test' };
  if (opts.cookie !== undefined) {
    const pepper = (env as unknown as { ANON_ID_HASH_PEPPER: string }).ANON_ID_HASH_PEPPER;
    headers.Cookie = `ose_anon=${await signAnonId(opts.cookie, pepper)}`;
  }
  return new Request(url, { headers });
}

async function scan(
  eventId: string,
  opts: { type?: string | null; cookie?: string; env?: QrScanEnv; countable?: boolean } = {}
): Promise<Response> {
  return handleQrScan(
    await scanRequest(eventId, opts),
    opts.env ?? scanEnv(),
    TOKEN[eventId],
    opts.countable ?? true
  );
}

/** The pass in a Location, or null. Reads the fragment only. */
function passOf(res: Response): string | null {
  const loc = res.headers.get('Location') ?? '';
  const hash = new URL(loc, ORIGIN).hash;
  return hash.startsWith('#t=') ? hash.slice(3) : null;
}

/** Today's redirect for a code, as qrScanTarget makes it. */
const todays = (eventId: string, type: string | null = 'vote') =>
  qrScanTarget(ORIGIN, eventId, DEPLOYMENT(eventId), type);

/** A reference HMAC of the voter-key message under any HKDF label and salt. */
async function hmacUnder(label: string, salt: string, msg: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PEPPER),
    'HKDF',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      info: new TextEncoder().encode(label),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('OSE-2133 | /q issues the vote pass', () => {
  test('OSE-2133 | SECURITY | a vote-kind code with an open set redirects to /vote with the pass in the fragment only', async () => {
    const res = await scan(OPEN);
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const loc = new URL(res.headers.get('Location') ?? '');
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe(`/events/${OPEN}/vote`);
    expect(loc.search).toBe('');
    expect(loc.searchParams.has('t')).toBe(false);
    const pass = passOf(res);
    expect(pass).toMatch(/^vp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const claims = await openVotePass(PEPPER, pass, Date.now(), OPEN);
    expect(claims?.event_id).toBe(OPEN);
    // A first scan still gets its cookie, so a re-scan finds the same browser.
    expect(res.headers.get('Set-Cookie') ?? '').toMatch(/^ose_anon=anon_/);
  });

  test('OSE-2133 | SECURITY | no pass when no set is open (none, draft, closed)', async () => {
    for (const id of [NOSET, DRAFT, CLOSED]) {
      const res = await scan(id, { cookie: COOKIE });
      expect(res.status, id).toBe(302);
      expect(res.headers.get('Location'), id).toBe(todays(id));
      expect(passOf(res), id).toBeNull();
    }
    expect(await issueVotePass(scanEnv(), COOKIE, NOSET, Date.now())).toBeNull();
  });

  test('OSE-2133 | SECURITY | no pass when VOTING_ENABLED is off (or not exactly "on")', async () => {
    for (const value of [undefined, 'off', '', 'true', '1', 'ON', ' on']) {
      const res = await scan(OPEN, { cookie: COOKIE, env: scanEnv({ VOTING_ENABLED: value }) });
      expect(res.headers.get('Location'), String(value)).toBe(todays(OPEN));
      expect(passOf(res), String(value)).toBeNull();
    }
  });

  test('OSE-2133 | SECURITY | no pass on the uncounted path', async () => {
    const res = await scan(OPEN, { cookie: COOKIE, countable: false });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(todays(OPEN));
    expect(passOf(res)).toBeNull();
  });

  test('OSE-2133 | SECURITY | no pass when the pepper is missing', async () => {
    for (const pepper of [undefined, '']) {
      const res = await scan(OPEN, {
        cookie: COOKIE,
        env: scanEnv({ ANON_ID_HASH_PEPPER: pepper }),
      });
      expect(res.headers.get('Location')).toBe(todays(OPEN));
      expect(passOf(res)).toBeNull();
      expect(await voterKey(pepper, COOKIE, OPEN)).toBeNull();
      expect(await mintVotePass(pepper, COOKIE, OPEN, Date.now())).toBeNull();
    }
  });

  test('OSE-2133 | SECURITY | no pass when the scan write failed; a duplicate of a stored scan gets one', async () => {
    const kv = makeKV();
    let failWrites = true;
    const flaky = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'batch' && failWrites) return () => Promise.reject(new Error('D1_ERROR'));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const cookie = 'anon_failed-write-0000-0000-000000000001';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await scan(OPEN, { cookie, env: scanEnv({ DB: flaky, RATE_LIMIT_KV: kv }) });
    expect(failed.headers.get('Location')).toBe(todays(OPEN));
    expect(passOf(failed)).toBeNull();
    // The failed write released its hour marker, so a retry is not a "duplicate".
    const retryFails = await scan(OPEN, { cookie, env: scanEnv({ DB: flaky, RATE_LIMIT_KV: kv }) });
    expect(passOf(retryFails)).toBeNull();

    failWrites = false;
    const stored = await scan(OPEN, { cookie, env: scanEnv({ DB: flaky, RATE_LIMIT_KV: kv }) });
    expect(passOf(stored)).not.toBeNull();
    const duplicate = await scan(OPEN, { cookie, env: scanEnv({ DB: flaky, RATE_LIMIT_KV: kv }) });
    expect(passOf(duplicate)).not.toBeNull();
  });

  test('OSE-2133 | SECURITY | the scan queue: a pass once the queue takes the scan, none when the queue and the direct write both fail', async () => {
    // Staging binds SCAN_QUEUE (security review F3). "Stored" there means the
    // queue accepted the scan; a queue outage falls back to the direct write.
    const sent: unknown[] = [];
    const queue = { send: async (m: unknown) => void sent.push(m) };
    const queued = await scan(OPEN, {
      cookie: 'anon_queue-ok-0000-0000-000000000001',
      env: scanEnv({ SCAN_QUEUE: queue as never }),
    });
    expect(sent.length).toBe(1);
    expect(passOf(queued)).not.toBeNull();

    const down = { send: async () => Promise.reject(new Error('queue down')) };
    const noWrite = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'batch') return () => Promise.reject(new Error('D1_ERROR'));
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const lost = await scan(OPEN, {
      cookie: 'anon_queue-down-0000-0000-000000000001',
      env: scanEnv({ SCAN_QUEUE: down as never, DB: noWrite }),
    });
    expect(lost.headers.get('Location')).toBe(todays(OPEN));
    expect(passOf(lost)).toBeNull();
  });

  test('OSE-1784 | RAINY | KV fails on the vote code | the scan is stored and the pass still issued', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = new Proxy(makeKV(), {
      get(target, prop) {
        if (prop === 'get' || prop === 'put') {
          return () => Promise.reject(new Error('KV GET/PUT failed: 503 Service Unavailable'));
        }
        return Reflect.get(target, prop);
      },
    });
    const before = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM scan_placement_events WHERE poster_deployment_id = ?`
    )
      .bind(DEPLOYMENT(OPEN_2))
      .first<{ n: number }>();
    const res = await scan(OPEN_2, {
      cookie: 'anon_99999999-8888-7777-6666-555555555555',
      env: scanEnv({ RATE_LIMIT_KV: failing }),
    });
    // Owner, 2026-11-23 ("keep voting working"): the vote code's scans are
    // never a published count, so a storage fault does not stop the room voting.
    expect(passOf(res)).not.toBeNull();
    const after = await tenv.DB.prepare(
      `SELECT COUNT(*) AS n FROM scan_placement_events WHERE poster_deployment_id = ?`
    )
      .bind(DEPLOYMENT(OPEN_2))
      .first<{ n: number }>();
    expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
  });

  test('OSE-2133 | SECURITY | a failure reading the set mints no pass and keeps the redirect', async () => {
    const broken = new Proxy(tenv.DB, {
      get(target, prop) {
        if (prop === 'prepare')
          return (sql: string) => {
            if (/\bvote_sets\b/.test(sql)) throw new Error('D1_ERROR: Network connection lost.');
            return target.prepare(sql);
          };
        const v = Reflect.get(target, prop);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await scan(OPEN, { cookie: COOKIE, env: scanEnv({ DB: broken }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(todays(OPEN));
    expect(passOf(res)).toBeNull();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('VOTE_PASS_SKIPPED'))).toBe(true);
  });

  test('OSE-2133 | SECURITY | one cookie at two events gives two different voter keys', async () => {
    const a = await openVotePass(
      PEPPER,
      passOf(await scan(OPEN, { cookie: COOKIE })),
      Date.now(),
      OPEN
    );
    const b = await openVotePass(
      PEPPER,
      passOf(await scan(OPEN_2, { cookie: COOKIE })),
      Date.now(),
      OPEN_2
    );
    expect(a?.k).toMatch(/^[0-9a-f]{64}$/);
    expect(b?.k).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.k).not.toBe(b?.k);
    expect(await voterKey(PEPPER, COOKIE, OPEN)).toBe(a?.k);
    expect(await voterKey(PEPPER, COOKIE, OPEN_2)).toBe(b?.k);
  });

  test('OSE-2133 | SECURITY | the voter key is never the scan key, and is HMAC under its own label', async () => {
    const k = await voterKey(PEPPER, COOKIE, OPEN);
    const msg = voterKeyMessage(COOKIE, OPEN);
    // Pinned construction: HKDF(pepper, salt, 'ose:vote:voter-key:v1') signs len ‖ cookie ‖ event.
    expect(k).toBe(await hmacUnder('ose:vote:voter-key:v1', 'oursharedevents:vote-pass', msg));
    // Not the scan key, with or without its prefix.
    const snk = await scanNodeKey(COOKIE, PEPPER);
    expect(snk).not.toBeNull();
    expect(k).not.toBe(snk);
    expect(k).not.toBe(String(snk).replace(/^snk1_/, ''));
    // Not the HMAC of the same message, or of the bare cookie, under any other
    // label in the Worker, with this file's salt or the others' (S2 review L7).
    const others = [
      SCAN_NODE_KEY_CONTEXT,
      VOTE_RECEIPT_CONTEXT,
      VOTE_PARTICIPANT_CONTEXT,
      VOTE_TEAM_CONTEXT,
      'ose:vote:pass-seal:v1',
    ];
    const salts = [
      'oursharedevents:vote-pass',
      'oursharedevents:vote-markers',
      'oursharedevents:scan-node-returns',
    ];
    for (const label of others)
      for (const salt of salts)
        for (const m of [msg, new TextEncoder().encode(COOKIE)])
          expect(k, `${label} / ${salt}`).not.toBe(await hmacUnder(label, salt, m));
  });

  test('OSE-2133 | SECURITY | a cookie of a different length cannot collide', async () => {
    // Without the length prefix both messages are `anon_abcdef`.
    const one = await voterKey(PEPPER, 'anon_ab', 'cdef');
    const two = await voterKey(PEPPER, 'anon_abc', 'def');
    expect(one).not.toBeNull();
    expect(one).not.toBe(two);
    const m = voterKeyMessage('anon_ab', 'cdef');
    expect(Array.from(m.slice(0, 4))).toEqual([0, 0, 0, 7]);
  });

  test('OSE-2133 | UNIT | the pass expires after 30 minutes; a re-scan renews it and gives the same voter key', async () => {
    expect(VOTE_PASS_TTL_SECONDS).toBe(1800);
    const t0 = Date.UTC(2026, 10, 18, 20, 0, 0);
    const kv = makeKV();
    const cookie = 'anon_clock-0000-0000-0000-000000000001';
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const first = passOf(await scan(OPEN, { cookie, env: scanEnv({ RATE_LIMIT_KV: kv }) }));
    expect(first).not.toBeNull();
    expect(await openVotePass(PEPPER, first, t0 + 1800_000 - 1000, OPEN)).not.toBeNull();
    expect(await openVotePass(PEPPER, first, t0 + 1800_000, OPEN)).toBeNull();
    expect(await openVotePass(PEPPER, first, t0 + 3600_000, OPEN)).toBeNull();

    clock.mockReturnValue(t0 + 20 * 60_000); // the same hour: a duplicate scan
    const second = passOf(await scan(OPEN, { cookie, env: scanEnv({ RATE_LIMIT_KV: kv }) }));
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    const later = t0 + 45 * 60_000;
    expect(await openVotePass(PEPPER, first, later, OPEN)).toBeNull();
    const renewed = await openVotePass(PEPPER, second, later, OPEN);
    expect(renewed).not.toBeNull();
    expect(renewed?.expires_at).toBe(Math.floor(t0 / 1000) + 20 * 60 + 1800);
    const firstClaims = await openVotePass(PEPPER, first, t0, OPEN);
    expect(renewed?.k).toBe(firstClaims?.k);
  });

  test('OSE-2133 | SECURITY | a pass is refused when tampered with, for another event, or under another pepper', async () => {
    const now = Date.now();
    const pass = (await mintVotePass(PEPPER, COOKIE, OPEN, now)) as string;
    expect(await openVotePass(PEPPER, pass, now, OPEN)).not.toBeNull();
    expect(await openVotePass(PEPPER, pass, now, OPEN_2)).toBeNull();
    expect(await openVotePass(`${PEPPER}-rotated`, pass, now, OPEN)).toBeNull();
    expect(await openVotePass(undefined, pass, now, OPEN)).toBeNull();
    const [prefix, body, mac] = pass.split('.');
    const flipped = mac[0] === 'A' ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
    expect(await openVotePass(PEPPER, `${prefix}.${body}.${flipped}`, now, OPEN)).toBeNull();
    // A body re-encoded for another event, with the old seal.
    const wire = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    const forged = btoa(JSON.stringify({ ...wire, e: OPEN_2 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await openVotePass(PEPPER, `${prefix}.${forged}.${mac}`, now, OPEN)).toBeNull();
    // One spelling only (security review F9): the MAC's last character has two
    // unused bits, so atob reads four characters there as the same bytes.
    const last = mac[mac.length - 1];
    const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(last);
    const alias = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[idx ^ 1];
    const aliased = `${prefix}.${body}.${mac.slice(0, -1)}${alias}`;
    expect(aliased).not.toBe(pass);
    expect(await openVotePass(PEPPER, aliased, now, OPEN)).toBeNull();
    // The event id is required: an empty one accepts nothing (review F5).
    expect(await openVotePass(PEPPER, pass, now, '')).toBeNull();
    for (const junk of ['', 'vp1.', 'vp1..', 'x'.repeat(600), 42, null, `vp2.${body}.${mac}`])
      expect(await openVotePass(PEPPER, junk, now, OPEN)).toBeNull();
  });

  test('OSE-2133 | SECURITY | no log line, and no CI output, carries the pass, the voter key or the Location header', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) =>
      void lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, m).mockImplementation(capture);

    const seen: string[] = [];
    const record = (res: Response) => {
      const loc = res.headers.get('Location') ?? '';
      seen.push(loc);
      const p = passOf(res);
      if (p) seen.push(p);
    };
    record(await scan(OPEN)); // new visitor, counted, pass
    record(await scan(OPEN, { cookie: COOKIE })); // returning visitor
    record(await scan(OPEN, { cookie: COOKIE, env: scanEnv({ ANON_ID_HASH_PEPPER: undefined }) }));
    record(await scan(OPEN, { cookie: COOKIE, countable: false }));
    const k = (await voterKey(PEPPER, COOKIE, OPEN)) as string;

    expect(seen.filter((s) => s.includes('#t=')).length).toBeGreaterThanOrEqual(2);
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const s of seen) expect(all.includes(s)).toBe(false);
    expect(all.includes(k)).toBe(false);
    expect(all.includes('#t=')).toBe(false);
    expect(all.includes('vp1.')).toBe(false);
    expect(/location|redirect/i.test(all)).toBe(false);
  });

  test('OSE-2133 | SECURITY | the vote code with any other type is a copy: the vote page, no pass, nothing set (CCR loop 5, L2)', async () => {
    // The room screen only ever shows the vote code with type=vote, so the same
    // code with the type cut or changed is a copied link: like a stale stamp it
    // counts nothing, mints no pass and sets no cookie (it once fell through to
    // qrScanTarget and wrote a scan row).
    for (const type of [
      null,
      'register',
      'checkin',
      'survey',
      'email-signup',
      'votes',
      'VOTE',
      'x',
    ]) {
      const res = await scan(OPEN, { cookie: COOKIE, type });
      expect(res.status, String(type)).toBe(302);
      expect(res.headers.get('Location'), String(type)).toBe(`${ORIGIN}/events/${OPEN}/vote`);
      expect(passOf(res), String(type)).toBeNull();
      expect(res.headers.get('Set-Cookie'), String(type)).toBeNull();
    }
  });

  test('OSE-2133 | INTEGRATION | through the router: the wrangler default (off) mints none; on mints one', async () => {
    const call = async (over: Partial<RouterEnv>) => {
      const ctx = createExecutionContext();
      const res = await route(
        await scanRequest(OPEN, { cookie: COOKIE }),
        { ...(env as unknown as RouterEnv), ...over } as RouterEnv,
        ctx
      );
      await waitOnExecutionContext(ctx);
      return res;
    };
    const off = await call({});
    expect((env as unknown as { VOTING_ENABLED?: string }).VOTING_ENABLED).not.toBe('on');
    expect(off.status).toBe(302);
    expect(passOf(off)).toBeNull();
    const on = await call({ VOTING_ENABLED: 'on' } as Partial<RouterEnv>);
    expect(on.status).toBe(302);
    const loc = new URL(on.headers.get('Location') ?? '');
    expect(loc.pathname).toBe(`/events/${OPEN}/vote`);
    expect(loc.search).toBe('');
    expect(passOf(on)).not.toBeNull();
  });
});
