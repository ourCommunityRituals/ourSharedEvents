/**
 * OSE-2234: flag a flood of vote passes on a vote set (detection only).
 * OSE ADR-040 decision 6, amended 2026-11-26 (owner: "add flood detection only").
 *
 * Workers-pool layer (miniflare D1). It drives handleQrScan with a stand-in
 * VOTE_FLOOD_LIMITER whose limit is small, so a "flood" is a handful of scans,
 * and reads the set with the same libs the admin and the voter page use.
 *
 * What it holds:
 *   - over the limit sets vote_sets.burst_seen, once; under it does not;
 *   - every minted pass counts, a renewal by the same browser included;
 *   - the write keeps no time: updated_at does not move;
 *   - a close and a reopen do not clear the flag, and final keeps it;
 *   - the flag is in no public answer, before or after final: it is the
 *     host's alarm only (owner, 2026-11-26, "Room check only, show room
 *     size"); the public "may be padded" line comes from the room check;
 *   - the host sees it: the admin set answer carries burst_seen;
 *   - the limiter key is the event only, and no new log line carries a
 *     cookie, the pass, k or the Location;
 *   - fail-safe: no binding, a throwing binding or a D1 error flag nothing,
 *     and the scan keeps its pass;
 *   - wrangler.toml's limit equals VOTE_FLOOD_PASSES_PER_MINUTE in every env.
 *
 * Staging twin: bruno/ose-api/23. Voting admin (OSE-2127), list 110 (the set
 * answer carries burst_seen false). The scripted burst on staging waits for
 * VOTING_ENABLED on staging (OSE-2227).
 * Structural twin: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts
 * (burst_seen is set only to the literal 1).
 *
 * @born-red OSE-2234 | method: injected-fault, each removed after; listed in
 *   the PR body | date: 2026-11-26
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { linkVenue } from './helpers/link-venue';
import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { handleQrScan, type QrScanEnv } from '../src/handlers/qr-scan';
import { route, type RouterEnv } from '../src/router';
import { signAnonId } from '../src/lib/anonymous-id';
import {
  adminFinalizeVoteSet,
  closeVoteSet,
  createVoteSet,
  openVoteSet,
  readVoteSet,
  reopenVoteSet,
} from '../src/lib/vote-sets';
import { readPublicVoteResult } from '../src/lib/vote-public-result';
import { PADDED_WORDS, roomSizeWords } from '../src/lib/vote-page-render';
import { VOTING_ON } from '../src/lib/voting-switch';
import {
  MARK_FLOOD_SQL,
  VOTE_FLOOD_PASSES_PER_MINUTE,
  noteVotePassMinted,
  resetVoteFloodMemo,
  voteFloodKey,
  type VoteFloodLimiter,
} from '../src/lib/vote-flood';
import { voteCodeStamp } from '../src/lib/vote-code-window';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_WRANGLER_TOML: string;
  ANON_ID_HASH_PEPPER: string;
}
const tenv = env as unknown as TestEnv;
const PEPPER = tenv.ANON_ID_HASH_PEPPER;
const ORIGIN = 'https://vote-flood.test';

const EV = 'evt-vfd-a';
const EV_2 = 'evt-vfd-b';
const TOKEN: Record<string, string> = { [EV]: 'qrt_vfdcode_a_0001', [EV_2]: 'qrt_vfdcode_b_0001' };
const DEPLOYMENT = (id: string) => `pd-${id}`;

/** A stand-in for the binding: refuses past `limit` calls per key. Records keys. */
function fakeLimiter(limit: number): VoteFloodLimiter & { keys: string[] } {
  const seen = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
  };
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

const run = (sql: string, ...binds: unknown[]) =>
  tenv.DB.prepare(sql)
    .bind(...binds)
    .run();
const row = (eventId: string) =>
  tenv.DB.prepare(`SELECT burst_seen, updated_at, is_final FROM vote_sets WHERE event_id = ?`)
    .bind(eventId)
    .first<{ burst_seen: number; updated_at: string; is_final: number }>();

const nowIso = () => new Date().toISOString();
async function ok<T>(p: Promise<{ ok: boolean } & T>): Promise<void> {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed: ${JSON.stringify(r)}`);
}

async function seedEvent(id: string): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
     VALUES (?, 'brand-vfd', 'Song night', ?, 'active', date('now'), datetime('now'), datetime('now'))`,
    id,
    id
  );
  await run(
    `INSERT OR REPLACE INTO poster_deployments (id, event_id, qr_token, placement_label, is_vote_code, is_active, created_at)
     VALUES (?, ?, ?, 'Room screen', 1, 1, datetime('now'))`,
    DEPLOYMENT(id),
    id,
    TOKEN[id]
  );
  await linkVenue(tenv.DB, id);
}

function scanEnv(limiter?: VoteFloodLimiter, over: Partial<QrScanEnv> = {}): QrScanEnv {
  return {
    DB: tenv.DB,
    RATE_LIMIT_KV: makeKV(),
    ANON_ID_HASH_PEPPER: PEPPER,
    VOTING_ENABLED: VOTING_ON,
    VOTE_FLOOD_LIMITER: limiter,
    ...over,
  };
}

let cookieSeq = 0;
const freshCookie = () => `anon_33333333-4444-5555-6666-${String(++cookieSeq).padStart(12, '0')}`;

/** One scan of the event's vote code, as a browser with `cookie` (a fresh one by default). */
async function scan(eventId: string, scanEnvValue: QrScanEnv, cookie = freshCookie()) {
  const req = new Request(
    `${ORIGIN}/q/${TOKEN[eventId]}?type=vote&w=${await voteCodeStamp(PEPPER, TOKEN[eventId], Date.now())}`,
    {
      headers: { Cookie: `ose_anon=${await signAnonId(cookie, PEPPER)}` },
    }
  );
  return handleQrScan(req, scanEnvValue, TOKEN[eventId], true);
}
const hasPass = (res: Response) => (res.headers.get('Location') ?? '').includes('/vote#t=');

async function votePage(eventId: string): Promise<string> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`${ORIGIN}/events/${eventId}/vote`),
    { ...(env as unknown as RouterEnv), VOTING_ENABLED: VOTING_ON } as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res.text();
}

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
});

beforeEach(async () => {
  resetVoteFloodMemo();
  for (const id of [EV, EV_2]) {
    await run(
      `DELETE FROM vote_participants WHERE set_id IN (SELECT id FROM vote_sets WHERE event_id = ?)`,
      id
    );
    await run(`DELETE FROM votable_objects WHERE event_id = ?`, id);
    await run(`DELETE FROM vote_sets WHERE event_id = ?`, id);
    await seedEvent(id);
    await ok(createVoteSet(tenv.DB, id, 'object'));
    await ok(openVoteSet(tenv.DB, id, PEPPER, nowIso(), 200));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the flag', () => {
  test('the column is a 0-or-1 flag, 0 by default', async () => {
    expect((await row(EV))?.burst_seen).toBe(0);
    await expect(
      run(`UPDATE vote_sets SET burst_seen = 2 WHERE event_id = ?`, EV)
    ).rejects.toThrow();
  });

  test('over the limit sets the flag; under it does not', async () => {
    const limiter = fakeLimiter(3);
    const e = scanEnv(limiter);
    for (let i = 0; i < 3; i++) expect(hasPass(await scan(EV, e))).toBe(true);
    expect((await row(EV))?.burst_seen).toBe(0);
    expect((await readVoteSet(tenv.DB, EV))?.burst_seen).toBe(false);
    // The fourth pass in the window trips it. Detection only: it still gets its pass.
    expect(hasPass(await scan(EV, e))).toBe(true);
    expect((await row(EV))?.burst_seen).toBe(1);
    expect((await readVoteSet(tenv.DB, EV))?.burst_seen).toBe(true);
    // Another event's set is untouched.
    expect((await row(EV_2))?.burst_seen).toBe(0);
  });

  test('every minted pass counts, a renewal by the same browser included', async () => {
    const limiter = fakeLimiter(2);
    const e = scanEnv(limiter);
    const same = freshCookie();
    for (let i = 0; i < 3; i++) expect(hasPass(await scan(EV, e, same))).toBe(true);
    expect(limiter.keys).toEqual([voteFloodKey(EV), voteFloodKey(EV), voteFloodKey(EV)]);
    expect((await row(EV))?.burst_seen).toBe(1);
  });

  test('a scan that mints no pass does not count', async () => {
    const limiter = fakeLimiter(0);
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    expect(hasPass(await scan(EV, scanEnv(limiter)))).toBe(false);
    expect(limiter.keys).toEqual([]);
    expect((await row(EV))?.burst_seen).toBe(0);
  });

  test('the write keeps no time: updated_at does not move', async () => {
    await run(`UPDATE vote_sets SET updated_at = '2000-01-01 00:00:00' WHERE event_id = ?`, EV);
    await scan(EV, scanEnv(fakeLimiter(0)));
    expect(await row(EV)).toMatchObject({ burst_seen: 1, updated_at: '2000-01-01 00:00:00' });
  });

  test('a close and a reopen do not clear it, and final keeps it', async () => {
    await scan(EV, scanEnv(fakeLimiter(0)));
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(reopenVoteSet(tenv.DB, EV, PEPPER, nowIso()));
    expect((await row(EV))?.burst_seen).toBe(1);
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    expect(await row(EV)).toMatchObject({ burst_seen: 1, is_final: 1 });
    expect((await readVoteSet(tenv.DB, EV))?.burst_seen).toBe(true);
  });

  test('the write never touches a final set', async () => {
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    await ok(adminFinalizeVoteSet(tenv.DB, EV, nowIso()));
    const res = await run(MARK_FLOOD_SQL, EV);
    expect(res.meta.changes).toBe(0);
    expect((await row(EV))?.burst_seen).toBe(0);
  });

  test('past the limit the flag is written once per isolate, not once per pass', async () => {
    const prepare = vi.spyOn(tenv.DB, 'prepare');
    const e = scanEnv(fakeLimiter(0));
    for (let i = 0; i < 4; i++) await scan(EV, e);
    expect(prepare.mock.calls.filter(([sql]) => sql === MARK_FLOOD_SQL)).toHaveLength(1);
  });
});

describe('who sees it', () => {
  test('before final, no public answer carries it: the voter page and the public result', async () => {
    await scan(EV, scanEnv(fakeLimiter(0)));
    expect((await row(EV))?.burst_seen).toBe(1);
    expect(await readPublicVoteResult(tenv.DB, EV)).toBeNull();
    const html = await votePage(EV);
    expect(html).not.toContain('vote-result-padded');
    expect(html).not.toContain(PADDED_WORDS);
    expect(html).not.toMatch(/flood|padded/i);
    await ok(closeVoteSet(tenv.DB, EV, nowIso()));
    expect(await readPublicVoteResult(tenv.DB, EV)).toBeNull();
    expect(await votePage(EV)).not.toContain(PADDED_WORDS);
  });

  test("after final, a burst alone never marks the public result: it is the host's alarm only", async () => {
    // Owner, decision card 2026-11-26, "Room check only, show room size".
    await scan(EV, scanEnv(fakeLimiter(0)));
    expect((await readVoteSet(tenv.DB, EV))?.burst_seen).toBe(true);
    for (const id of [EV, EV_2]) {
      await ok(closeVoteSet(tenv.DB, id, nowIso()));
      await ok(adminFinalizeVoteSet(tenv.DB, id, nowIso()));
    }
    expect(await readPublicVoteResult(tenv.DB, EV)).toMatchObject({ padded: false });
    expect(await readPublicVoteResult(tenv.DB, EV_2)).toMatchObject({ padded: false });
    const burst = await votePage(EV);
    expect(burst).not.toContain('vote-result-padded');
    expect(burst).not.toContain(PADDED_WORDS);
    expect(burst).not.toMatch(/burst/i);
    // The host still sees it after final.
    expect((await readVoteSet(tenv.DB, EV))?.burst_seen).toBe(true);
    expect((await readVoteSet(tenv.DB, EV))?.flood_seen).toBe(false);
  });
});

describe('the public result after final (owner, 2026-11-26: "Room check only, show room size")', () => {
  test("the room check's flag says may be padded; every final result shows the room size the host gave", async () => {
    for (const id of [EV, EV_2]) await ok(closeVoteSet(tenv.DB, id, nowIso()));
    // As the room check at final would (vote-integrity.spec.ts drives the real check).
    await run(`UPDATE vote_sets SET flood_seen = 1 WHERE event_id = ?`, EV);
    for (const id of [EV, EV_2]) await ok(adminFinalizeVoteSet(tenv.DB, id, nowIso()));
    expect(await readPublicVoteResult(tenv.DB, EV)).toMatchObject({ padded: true, room_size: 200 });
    expect(await readPublicVoteResult(tenv.DB, EV_2)).toMatchObject({
      padded: false,
      room_size: 200,
    });
    const flagged = await votePage(EV);
    expect(flagged).toContain('data-testid="vote-result-padded"');
    expect(flagged).toContain(PADDED_WORDS);
    expect(flagged).toContain('data-testid="vote-result-room"');
    expect(flagged).toContain(roomSizeWords(200));
    const clean = await votePage(EV_2);
    expect(clean).not.toContain(PADDED_WORDS);
    expect(clean).toContain(roomSizeWords(200));
  });

  test('before final the room size is in no public answer', async () => {
    expect(await readPublicVoteResult(tenv.DB, EV)).toBeNull();
    const html = await votePage(EV);
    expect(html).not.toContain('vote-result-room');
    expect(html).not.toContain(roomSizeWords(200));
  });
});

describe('never who', () => {
  test('the limiter key is the event only, and no log line carries a cookie, pass, k or Location', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const)
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        lines.push(a.map(String).join(' '));
      });
    const limiter = fakeLimiter(1);
    const cookie = freshCookie();
    const first = await scan(EV, scanEnv(limiter), cookie);
    const second = await scan(EV, scanEnv(limiter));
    expect(new Set(limiter.keys)).toEqual(new Set([`vote-flood:${EV}`]));
    const flood = lines.filter((l) => l.includes('VOTE_FLOOD_SEEN'));
    expect(flood).toHaveLength(1);
    expect(Object.keys(JSON.parse(flood[0])).sort()).toEqual(['event_id', 'type']);
    for (const res of [first, second]) {
      const loc = res.headers.get('Location') ?? '';
      const pass = loc.split('#t=')[1] ?? '';
      expect(pass.length).toBeGreaterThan(10);
      for (const l of lines) {
        expect(l).not.toContain(pass);
        expect(l).not.toContain(loc);
      }
    }
    for (const l of lines) expect(l).not.toContain(cookie);
  });
});

describe('fail-safe: detection never blocks a vote', () => {
  test('with a context, detection runs after the answer: a hung binding never delays the redirect', async () => {
    const hung: VoteFloodLimiter = { limit: () => new Promise(() => {}) };
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) };
    const req = new Request(
      `${ORIGIN}/q/${TOKEN[EV]}?type=vote&w=${await voteCodeStamp(PEPPER, TOKEN[EV], Date.now())}`,
      {
        headers: { Cookie: `ose_anon=${await signAnonId(freshCookie(), PEPPER)}` },
      }
    );
    const res = await handleQrScan(req, scanEnv(hung), TOKEN[EV], true, ctx);
    expect(hasPass(res)).toBe(true);
    expect(waited).toHaveLength(1);
  });

  test('no binding: the pass stands, nothing is flagged', async () => {
    for (let i = 0; i < 3; i++) expect(hasPass(await scan(EV, scanEnv(undefined)))).toBe(true);
    expect((await row(EV))?.burst_seen).toBe(0);
  });

  test('a binding that throws: the pass stands, nothing is flagged', async () => {
    const broken: VoteFloodLimiter = {
      async limit() {
        throw new Error('limiter down');
      },
    };
    expect(hasPass(await scan(EV, scanEnv(broken)))).toBe(true);
    expect((await row(EV))?.burst_seen).toBe(0);
  });

  test('a D1 error on the flag write: noteVotePassMinted answers false and does not throw', async () => {
    const db = {
      prepare() {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    await expect(
      noteVotePassMinted({ DB: db, VOTE_FLOOD_LIMITER: fakeLimiter(0) }, EV)
    ).resolves.toBe(false);
  });
});

describe('the limit', () => {
  test("wrangler.toml's VOTE_FLOOD_LIMITER is 300 a minute in every env, the constant's value", () => {
    const toml = tenv.TEST_WRANGLER_TOML;
    const blocks = [
      ...toml.matchAll(
        /\[\[(?:env\.(\w+)\.)?ratelimits\]\]\s*\nname = "VOTE_FLOOD_LIMITER"\s*\nnamespace_id = "(\d+)"\s*\nsimple = \{ limit = (\d+), period = (\d+) \}/g
      ),
    ];
    expect(blocks.map((m) => m[1] ?? 'top').sort()).toEqual(['production', 'staging', 'top']);
    for (const m of blocks) {
      expect(Number(m[3])).toBe(VOTE_FLOOD_PASSES_PER_MINUTE);
      expect(Number(m[4])).toBe(60);
    }
    expect(new Set(blocks.map((m) => m[2])).size).toBe(3);
  });
});
