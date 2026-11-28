/**
 * Competitions: leagues, seasons and their matches (leagues phase 1:
 * OSE-525 data model, OSE-526 round robin + manual override, OSE-527 public
 * schedule and standings, OSE-529 host score entry and computed standings).
 *
 * Rules held here:
 *   1. a competition of another brand answers exactly as a missing one does,
 *      and nothing under it changes (the brand wall, both halves);
 *   2. a competition holds no person: no person column, no person field in a
 *      body, no contact detail in a label or a name;
 *   3. the round robin pairs every team once, sits one out each round when the
 *      count is odd, and regenerating keeps every round that has a score;
 *   4. standings are computed from confirmed scores, ordered points, wins,
 *      difference, scored, and shared ranks tie;
 *   5. a match is played on a night of the competition's own brand only;
 *   6. finishing makes every score final; nothing changes after; a mirrored
 *      competition refuses the host's writes;
 *   7. the public page shows a started competition only, teams and scores only,
 *      never the scoreboard photo key, and sets no cookie;
 *   8. every write is audited in the competition's brand; a read is not.
 *
 * @born-red leagues phase 1 | method: one fault at a time, each restored before
 * the next (33 tests):
 *   1. the competition kind taken out of matchAdminObjectTarget: 2 red;
 *   2. the unknown-field refusal switched off in parseEntryCreate: 1 red;
 *   3. `locked` emptied in handleGenerateSchedule: 1 red;
 *   4. the wins tiebreak dropped from computeStandings: 1 red;
 *   5. nightAllowed made to return true: 1 red;
 *   6. the status filter taken out of handleCompetitionPage: 1 red.
 * date: 2026-11-27
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import {
  COMPETITION_COLUMNS,
  ENTRY_COLUMNS,
  FIXTURE_COLUMNS,
  RESULT_COLUMNS,
  LINEUP_COLUMNS,
  RULESETS,
  WRITE_KEYS,
  byesOf,
  computeStandings,
  parseEntryCreate,
  roundRobin,
  slotFor,
} from '../src/lib/competitions';
import { matchAdminObjectTarget } from '../src/lib/admin-object-scope';
import { renderCompetitionPage, TABLE_PAGE } from '../src/lib/competition-page-render';
import { rulesetOf } from '../src/lib/competitions';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-cmp-a';
const BRAND_B = 'brand-cmp-b';
const OWNER_A = 'owner-cmp-a@example.com';
const OWNER_B = 'owner-cmp-b@example.com';
const NIGHTS = ['evt-cmp-a1', 'evt-cmp-a2', 'evt-cmp-a3', 'evt-cmp-a4', 'evt-cmp-a5'];
const B_NIGHT = 'evt-cmp-b1';

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

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; json: Json; text: string; res: Response }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  const text = await res.clone().text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* HTML or empty */
  }
  return { status: res.status, json, text, res };
}

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

type Row = Record<string, unknown>;
const all = async (sql: string, ...binds: unknown[]) =>
  (
    await tenv.DB.prepare(sql)
      .bind(...binds)
      .all<Row>()
  ).results;

async function seedEvent(id: string, brand: string, day: string, status = 'active') {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, 'Eagles Hall', ?, ?, 'America/Chicago')`
  )
    .bind(id, brand, `League night ${id}`, id, status, day, day)
    .run();
}

const P = '/api/v2/admin/competitions';

/** A started competition of brand A with `n` teams; returns its id and entry ids. */
async function league(n: number, extra: Json = {}): Promise<{ id: string; teams: string[] }> {
  const made = await call('POST', P, A, {
    name: 'Fall Bar League',
    format: 'seasonal',
    sport: 'bocce_league',
    starts_on: '2026-09-02',
    ends_on: '2026-11-18',
    ...extra,
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const id = made.json.id as string;
  const teams: string[] = [];
  for (let i = 1; i <= n; i++) {
    const e = await call('POST', `${P}/${id}/entries`, A, { label: `Team ${i}`, seed: i });
    expect(e.status, JSON.stringify(e.json)).toBe(201);
    teams.push(e.json.id);
  }
  return { id, teams };
}

const start = (id: string) => call('PUT', `${P}/${id}`, A, { status: 'active' });

beforeAll(async () => {
  await applyMigrations();
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
    )
      .bind(email, brand)
      .run();
  }
});

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`DELETE FROM fixture_lineups`).run();
  await db.prepare(`DELETE FROM fixture_results`).run();
  await db.prepare(`DELETE FROM fixtures`).run();
  await db.prepare(`DELETE FROM competition_entries`).run();
  await db.prepare(`DELETE FROM competition_stages`).run();
  await db.prepare(`DELETE FROM competitions`).run();
  await db.prepare(`DELETE FROM admin_audit_log WHERE resource_type = 'competition'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-cmp-%'`).run();
  for (const [i, id] of NIGHTS.entries()) await seedEvent(id, BRAND_A, `2099-01-0${2 + i}`);
  await seedEvent(B_NIGHT, BRAND_B, '2026-09-02');
});

// ── the pure half ─────────────────────────────────────────────────────────────

describe('round robin: the circle method', () => {
  test('every pair meets exactly once, in n-1 rounds for an even count', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const p = roundRobin(ids);
    expect(p).toHaveLength(15);
    expect(new Set(p.map((x) => x.round)).size).toBe(5);
    const pairs = new Set(p.map((x) => [x.a, x.b].sort().join('-')));
    expect(pairs.size).toBe(15);
    for (let r = 1; r <= 5; r++) {
      const playing = p.filter((x) => x.round === r).flatMap((x) => [x.a, x.b]);
      expect(new Set(playing).size).toBe(6);
    }
  });

  test('an odd count gives n rounds, one team sitting out each, each team once', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const p = roundRobin(ids);
    expect(p).toHaveLength(10);
    const byes = byesOf(ids, p);
    expect(byes.size).toBe(5);
    expect(new Set(byes.values()).size).toBe(5);
  });

  test('fewer than two teams make no matches', () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin(['a'])).toEqual([]);
  });

  test('courts in turn, then the next half hour', () => {
    const opts = {
      slots: ['Court 1', 'Court 2', 'Court 3'],
      start_time: '19:00',
      slot_minutes: 30,
    };
    expect(slotFor(0, opts)).toEqual({ slot_label: 'Court 1', slot_time: '19:00' });
    expect(slotFor(2, opts)).toEqual({ slot_label: 'Court 3', slot_time: '19:00' });
    expect(slotFor(3, opts)).toEqual({ slot_label: 'Court 1', slot_time: '19:30' });
    expect(slotFor(7, opts)).toEqual({ slot_label: 'Court 2', slot_time: '20:00' });
    expect(slotFor(1, { slots: [], start_time: null, slot_minutes: 30 })).toEqual({
      slot_label: null,
      slot_time: null,
    });
  });
});

describe('standings: computed, ordered, ties share a rank', () => {
  const entries = ['x', 'y', 'z', 'w'].map((id) => ({ id, label: id.toUpperCase(), is_active: 1 }));
  const played = (a: string, b: string, sa: number, sb: number, state = 'confirmed') => ({
    entry_a: a,
    entry_b: b,
    status: 'played',
    score_a: sa,
    score_b: sb,
    state,
  });

  test('points, then wins, then difference, then scored', () => {
    const t = computeStandings(
      entries,
      [
        played('x', 'y', 12, 3),
        played('z', 'w', 12, 11),
        played('x', 'z', 5, 12),
        played('y', 'w', 12, 10),
      ],
      RULESETS.win_loss
    );
    expect(t.map((r) => r.label)).toEqual(['Z', 'X', 'Y', 'W']);
    expect(t[0]).toMatchObject({ played: 2, won: 2, lost: 0, points: 2, diff: 8 });
    expect(t[1]).toMatchObject({ won: 1, diff: 2 });
  });

  test('level on points, more wins comes first (before difference or scored)', () => {
    const five = [...entries, { id: 'v', label: 'V', is_active: 1 }];
    const t = computeStandings(
      five,
      [
        played('x', 'y', 1, 0),
        played('w', 'x', 1, 0),
        played('z', 'y', 9, 9),
        played('z', 'w', 9, 9),
        played('z', 'v', 9, 9),
      ],
      RULESETS.three_one_zero
    );
    const x = t.find((r) => r.entry_id === 'x')!;
    const z = t.find((r) => r.entry_id === 'z')!;
    expect([x.points, z.points]).toEqual([3, 3]);
    expect(x.rank).toBeLessThan(z.rank);
  });

  test('a provisional or disputed score does not count yet', () => {
    const t = computeStandings(
      entries,
      [played('x', 'y', 12, 3, 'provisional'), played('z', 'w', 12, 3, 'disputed')],
      RULESETS.win_loss
    );
    expect(t.every((r) => r.played === 0 && r.rank === 1)).toBe(true);
  });

  test('draws score where the ruleset has them', () => {
    const t = computeStandings(entries, [played('x', 'y', 2, 2)], RULESETS.three_one_zero);
    expect(t.find((r) => r.entry_id === 'x')).toMatchObject({ drawn: 1, points: 1 });
  });

  test('teams level on every number share a rank', () => {
    const t = computeStandings(
      entries,
      [played('x', 'y', 5, 3), played('z', 'w', 5, 3)],
      RULESETS.win_loss
    );
    expect(t.map((r) => r.rank)).toEqual([1, 1, 3, 3]);
  });
});

// ── no person ─────────────────────────────────────────────────────────────────

describe('a competition holds no person', () => {
  const columns = async (table: string) =>
    (await all(`PRAGMA table_info(${table})`)).map((c) => String(c.name));

  test('the columns are exactly the reviewed lists', async () => {
    expect(await columns('competitions')).toEqual([...COMPETITION_COLUMNS]);
    expect(await columns('competition_entries')).toEqual([...ENTRY_COLUMNS]);
    expect(await columns('fixtures')).toEqual([...FIXTURE_COLUMNS]);
    expect(await columns('fixture_results')).toEqual([...RESULT_COLUMNS]);
    expect(await columns('fixture_lineups')).toEqual([...LINEUP_COLUMNS]);
  });

  test('no column or write key suggests a person (created_by is the admin actor, as on campaigns)', async () => {
    const PERSON =
      /email|phone|mobile|contact|captain|person|player|roster|first|last|note|address/i;
    for (const t of [
      'competitions',
      'competition_stages',
      'competition_entries',
      'fixtures',
      'fixture_results',
      'fixture_lineups',
    ])
      for (const name of await columns(t)) expect(`${t}.${name}`).not.toMatch(PERSON);
    for (const key of new Set(Object.values(WRITE_KEYS).flat())) expect(key).not.toMatch(PERSON);
  });

  test('a label shaped like a contact, and a field outside the list, are refused', async () => {
    expect(parseEntryCreate({ label: 'jo@example.com' }).ok).toBe(false);
    expect(parseEntryCreate({ label: 'Call 773 555 0100' }).ok).toBe(false);
    const { id } = await league(0);
    const r1 = await call('POST', `${P}/${id}/entries`, A, {
      label: 'Rollers',
      captain_email: 'a@b.co',
    });
    expect(r1.status).toBe(400);
    expect(r1.json.code).toBe('UNKNOWN_FIELD');
    const r2 = await call('POST', `${P}/${id}/entries`, A, { label: 'jo@example.com' });
    expect(r2.json.code).toBe('INVALID_LABEL');
    expect(await all(`SELECT 1 FROM competition_entries`)).toEqual([]);
  });

  test('an entry id has the team-id shape (ADR-040)', async () => {
    const { teams } = await league(1);
    expect(teams[0]).toMatch(/^grp_[0-9a-f]{32}$/);
  });
});

// ── the brand wall ────────────────────────────────────────────────────────────

describe('another brand’s competition answers as a missing one', () => {
  test('the path is a competition object', () => {
    expect(matchAdminObjectTarget('/api/v2/admin/competitions/cmp_x/fixtures/f/result')).toEqual({
      kind: 'competition',
      id: 'cmp_x',
    });
    expect(matchAdminObjectTarget('/api/v2/admin/competitions')).toBeNull();
  });

  test('read, change, add a team, score: all 404, nothing changes', async () => {
    const { id, teams } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: [NIGHTS[0]] });
    const fx = (await all(`SELECT id FROM fixtures`))[0].id as string;
    const missing = await call('GET', `${P}/cmp_${'0'.repeat(32)}`, B);
    for (const [method, path, body] of [
      ['GET', `${P}/${id}`, undefined],
      ['PUT', `${P}/${id}`, { name: 'Taken over' }],
      ['POST', `${P}/${id}/entries`, { label: 'Intruders' }],
      ['PUT', `${P}/${id}/entries/${teams[0]}`, { label: 'Renamed' }],
      ['PUT', `${P}/${id}/fixtures/${fx}/result`, { score_a: 1, score_b: 0 }],
      ['GET', `${P}/${id}/score-screen`, undefined],
    ] as const) {
      const r = await call(method, path, B, body);
      expect(r.status, `${method} ${path}`).toBe(404);
      if (r.json.code) expect(r.json.code).toBe(missing.json.code);
    }
    expect((await all(`SELECT name FROM competitions`))[0].name).toBe('Fall Bar League');
    expect(await all(`SELECT 1 FROM fixture_results`)).toEqual([]);
    expect(await all(`SELECT label FROM competition_entries ORDER BY label`)).toEqual([
      { label: 'Team 1' },
      { label: 'Team 2' },
    ]);
  });

  test('the list holds only the caller’s brands', async () => {
    await league(0);
    expect((await call('GET', P, A)).json.items).toHaveLength(1);
    expect((await call('GET', P, B)).json.items).toHaveLength(0);
  });

  test('a brand the caller is not in is refused at create', async () => {
    const r = await call('POST', P, A, { name: 'X', format: 'league', brand_id: BRAND_B });
    expect(r.status).toBe(403);
  });

  test('an entry of another competition is not found here', async () => {
    const one = await league(2);
    const two = await league(1);
    const r = await call('PUT', `${P}/${one.id}/entries/${two.teams[0]}`, A, { label: 'Moved' });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('ENTRY_NOT_FOUND');
  });

  test('a night of another brand is refused', async () => {
    const { id } = await league(2);
    const r = await call('POST', `${P}/${id}/schedule`, A, { event_ids: [B_NIGHT] });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('INVALID_EVENT');
    expect(await all(`SELECT 1 FROM fixtures`)).toEqual([]);
  });
});

// ── schedule, override, scores ────────────────────────────────────────────────

describe('a season from schedule to table', () => {
  test('the schedule puts each round on its night, with courts and times', async () => {
    const { id } = await league(5);
    const r = await call('POST', `${P}/${id}/schedule`, A, {
      event_ids: NIGHTS,
      slots: ['Court 1', 'Court 2'],
      start_time: '19:00',
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.fixtures).toHaveLength(10);
    const round1 = r.json.fixtures.filter((f: Json) => f.round === 1);
    expect(round1.every((f: Json) => f.event_id === NIGHTS[0])).toBe(true);
    expect(round1.map((f: Json) => `${f.slot_label} ${f.slot_time}`)).toEqual([
      'Court 1 19:00',
      'Court 2 19:00',
    ]);
  });

  test('a score cannot be entered before the season starts', async () => {
    const { id } = await league(2);
    await call('POST', `${P}/${id}/schedule`, A, {});
    const fx = (await all(`SELECT id FROM fixtures`))[0].id as string;
    const r = await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 12, score_b: 4 });
    expect(r.json.code).toBe('COMPETITION_DRAFT');
  });

  test('scores flow into the table at once; regenerating keeps scored rounds', async () => {
    const { id, teams } = await league(4);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    const r1 = (await all(
      `SELECT id, entry_a FROM fixtures WHERE round = 1 ORDER BY id`
    )) as Json[];
    for (const f of r1) {
      const s = await call('PUT', `${P}/${id}/fixtures/${f.id}/result`, A, {
        score_a: 12,
        score_b: 7,
      });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      expect(s.json.fixture.result).toMatchObject({ score_a: 12, score_b: 7, state: 'confirmed' });
    }
    const d = await call('GET', `${P}/${id}`, A);
    const leaders = d.json.standings
      .filter((s: Json) => s.points === 1)
      .map((s: Json) => s.entry_id);
    expect(leaders.sort()).toEqual(r1.map((f) => f.entry_a).sort());

    // A new team joins: rounds 2+ are made again, round 1 is kept as played.
    await call('POST', `${P}/${id}/entries`, A, { label: 'Late Rollers', seed: 9 });
    const again = await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    expect(again.json.rounds_kept).toEqual([1]);
    const kept = (await all(`SELECT id FROM fixtures WHERE round = 1 ORDER BY id`)) as Json[];
    expect(kept.map((f) => f.id)).toEqual(r1.map((f) => f.id));
    expect(teams).toHaveLength(4);
  });

  test('no draws in a win-loss league; a scored match keeps its teams', async () => {
    const { id, teams } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, {});
    const fx = (await all(`SELECT id FROM fixtures`))[0].id as string;
    const draw = await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, {
      score_a: 5,
      score_b: 5,
    });
    expect(draw.json.code).toBe('DRAW_NOT_ALLOWED');
    await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 5, score_b: 3 });
    const swap = await call('PUT', `${P}/${id}/fixtures/${fx}`, A, {
      entry_a: teams[1],
      entry_b: teams[0],
    });
    expect(swap.json.code).toBe('FIXTURE_HAS_RESULT');
    // Moving it to another court is fine.
    const move = await call('PUT', `${P}/${id}/fixtures/${fx}`, A, { slot_label: 'Court 4' });
    expect(move.status).toBe(200);
    // Taking the score back reopens it.
    const back = await call('DELETE', `${P}/${id}/fixtures/${fx}/result`, A);
    expect(back.json.fixture).toMatchObject({ status: 'scheduled', result: null });
  });

  test('postpone and place a makeup by hand', async () => {
    const { id, teams } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: [NIGHTS[0]] });
    const fx = (await all(`SELECT id FROM fixtures`))[0].id as string;
    const p = await call('PUT', `${P}/${id}/fixtures/${fx}`, A, { status: 'postponed' });
    expect(p.json.fixture.status).toBe('postponed');
    const back = await call('PUT', `${P}/${id}/fixtures/${fx}`, A, {
      status: 'scheduled',
      event_id: NIGHTS[3],
      slot_time: '20:30',
    });
    expect(back.json.fixture).toMatchObject({
      status: 'scheduled',
      event_id: NIGHTS[3],
      slot_time: '20:30',
    });
    const extra = await call('POST', `${P}/${id}/fixtures`, A, {
      round: 2,
      entry_a: teams[1],
      entry_b: teams[0],
      event_id: NIGHTS[1],
    });
    expect(extra.status).toBe(201);
  });

  test('finishing makes every score final, and nothing changes after', async () => {
    const { id } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, {});
    const fx = (await all(`SELECT id FROM fixtures`))[0].id as string;
    await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 12, score_b: 9 });
    expect((await call('PUT', `${P}/${id}`, A, { status: 'finished' })).status).toBe(200);
    expect((await all(`SELECT state FROM fixture_results`))[0].state).toBe('final');
    for (const r of [
      await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 1, score_b: 0 }),
      await call('DELETE', `${P}/${id}/fixtures/${fx}/result`, A),
      await call('POST', `${P}/${id}/entries`, A, { label: 'Too late' }),
      await call('PUT', `${P}/${id}`, A, { status: 'active' }),
    ])
      expect(r.json.code).toBe('COMPETITION_FINISHED');
    expect((await all(`SELECT score_a FROM fixture_results`))[0].score_a).toBe(12);
  });

  test('a mirrored competition refuses the host’s writes', async () => {
    const { id } = await league(2);
    await start(id);
    await tenv.DB.prepare(`UPDATE competitions SET source = 'mirrored' WHERE id = ?`)
      .bind(id)
      .run();
    const r = await call('POST', `${P}/${id}/entries`, A, { label: 'Hand typed' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('COMPETITION_MIRRORED');
  });

  test('a deleted night leaves its matches with no night', async () => {
    const { id } = await league(2);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: [NIGHTS[4]] });
    const del = await call('DELETE', `/api/v2/admin/events/${NIGHTS[4]}`, A);
    expect(del.status, JSON.stringify(del.json)).toBe(200);
    expect((await all(`SELECT event_id FROM fixtures`))[0].event_id).toBeNull();
  });
});

// ── the public page ───────────────────────────────────────────────────────────

describe('the public schedule and standings page', () => {
  async function season() {
    const { id } = await league(3);
    await call('POST', `${P}/${id}/schedule`, A, {
      event_ids: NIGHTS,
      slots: ['Court 1'],
      start_time: '19:00',
    });
    return id;
  }

  test('a draft, an unknown id and a malformed id are one 404', async () => {
    const id = await season();
    const draft = await call('GET', `/competitions/${id}`, {});
    const unknown = await call('GET', `/competitions/cmp_${'f'.repeat(32)}`, {});
    const bad = await call('GET', `/competitions/nope`, {});
    expect([draft.status, unknown.status, bad.status]).toEqual([404, 404, 404]);
  });

  test('a started season shows its name, next matches, table and rounds, and nothing else', async () => {
    const id = await season();
    await start(id);
    const fx = (await all(`SELECT id FROM fixtures WHERE round = 1`))[0].id as string;
    await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 12, score_b: 8 });
    await tenv.DB.prepare(
      `UPDATE fixture_results SET evidence_key = 'photos/secret-key.jpg'`
    ).run();
    const r = await call('GET', `/competitions/${id}`, {});
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Set-Cookie')).toBeNull();
    expect(r.res.headers.get('Cache-Control')).toContain('private');
    const html = r.text;
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('Fall Bar League');
    expect(html).not.toContain('secret-key');
    expect(html).not.toContain(OWNER_A);
    // Tabs, not one long page: the first screen is the next matches, and the
    // table and the rounds are each one tap away.
    expect(html).toContain('data-testid="competition-tabs"');
    expect(html).toContain('data-testid="competition-next"');
    expect(html).not.toContain('data-testid="competition-standings"');
    expect(html).toContain('sits out');
    const table = (await call('GET', `/competitions/${id}?tab=table`, {})).text;
    expect(table).toContain('data-testid="competition-standings"');
    expect(table).not.toContain('data-testid="competition-next"');
    // The rule sits behind the one Deeper Dive button, not on the screen.
    expect(table).toMatch(
      /<details class="deeper-dive"><summary[^>]*>Deeper Dive ›<\/summary><p[^>]*data-testid="competition-rule"/
    );
    const rounds = (await call('GET', `/competitions/${id}?tab=rounds&round=1`, {})).text;
    expect(rounds).toContain('data-testid="competition-rounds"');
    expect(rounds).toContain('data-score="12-8"');
    // One round per screen: only round 1 is on it.
    expect(rounds.match(/data-testid="competition-round"/g)).toHaveLength(1);
    expect(rounds).not.toContain('secret-key');
    // An unknown tab is never echoed and falls back to the first screen.
    const odd = (await call('GET', `/competitions/${id}?tab=%3Cscript%3E`, {})).text;
    expect(odd).not.toContain('<script>');
    expect(odd).toContain('data-testid="competition-next"');
  });

  test('a label in markup shape is escaped', async () => {
    const { id } = await league(0);
    await call('POST', `${P}/${id}/entries`, A, { label: '<b>Rollers</b>' });
    await call('POST', `${P}/${id}/entries`, A, { label: 'Pallinos' });
    await call('POST', `${P}/${id}/schedule`, A, {});
    await start(id);
    const r = await call('GET', `/competitions/${id}`, {});
    expect(r.text).not.toContain('<b>Rollers</b>');
    expect(r.text).toContain('&lt;b&gt;Rollers&lt;/b&gt;');
  });
});

describe('a big league table', () => {
  test('shows one screen of teams, and More shows the next ones', () => {
    const standings = Array.from({ length: TABLE_PAGE + 4 }, (_, i) => ({
      entry_id: `e${i}`,
      label: `Team ${i + 1}`,
      rank: i + 1,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      scored: 0,
      conceded: 0,
      diff: 0,
      points: 0,
    }));
    const base = {
      name: 'Big league',
      format: 'league' as const,
      status: 'active' as const,
      starts_on: null,
      ends_on: null,
      ruleset: rulesetOf('win_loss'),
      standings,
      fixtures: [],
      byes: new Map<number, string>(),
      today: '2026-11-27',
      tab: 'table',
    };
    const first = renderCompetitionPage(base);
    expect(first.match(/data-testid="competition-standing"/g)).toHaveLength(TABLE_PAGE);
    expect(first).toContain('href="?tab=table&amp;page=2"');
    expect(first).toContain('Team 1<');
    expect(first).not.toContain(`Team ${TABLE_PAGE + 1}<`);
    const second = renderCompetitionPage({ ...base, page: '2' });
    expect(second.match(/data-testid="competition-standing"/g)).toHaveLength(4);
    expect(second).toContain(`Team ${TABLE_PAGE + 1}<`);
    expect(second).not.toContain('data-testid="competition-more"');
    // A page out of range falls back to the first screen.
    expect(renderCompetitionPage({ ...base, page: '99' })).toContain('Team 1<');
  });
});

describe('soccer too, not only bocce (owner, 2026-11-28)', () => {
  test('a soccer league starts on 3 for a win, 1 for a tie; bocce stays win or lose', async () => {
    const soccer = await league(2, { name: 'Sunday Soccer', sport: 'soccer_league' });
    const bocce = await league(2);
    expect((await call('GET', `${P}/${soccer.id}`, A)).json.competition.ruleset).toBe(
      'three_one_zero'
    );
    expect((await call('GET', `${P}/${bocce.id}`, A)).json.competition.ruleset).toBe('win_loss');
    // The host can still name any ruleset.
    const picked = await league(2, { sport: 'soccer_league', ruleset: 'win_loss' });
    expect((await call('GET', `${P}/${picked.id}`, A)).json.competition.ruleset).toBe('win_loss');
  });

  test('a 1-1 soccer game is a tie: 1 point each, and no "No ties" on the score screen', async () => {
    const { id } = await league(2, { name: 'Sunday Soccer', sport: 'soccer_league' });
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, {
      event_ids: NIGHTS,
      slots: ['Field 1'],
      start_time: '10:00',
    });
    const screen = await call('GET', `${P}/${id}/score-screen`, A);
    expect(screen.text).not.toContain('No ties');
    expect(screen.text).toContain('Field 1');
    const fx = (await all(`SELECT id FROM fixtures WHERE competition_id = ?`, id))[0].id as string;
    const s = await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 1, score_b: 1 });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    const d = await call('GET', `${P}/${id}`, A);
    expect(d.json.standings.map((t: Json) => [t.drawn, t.points])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    const table = (await call('GET', `/competitions/${id}?tab=table`, {})).text;
    expect(table).toContain('A tie game is 1.');
  });

  test('bocce still refuses a tie, and says so on the score screen', async () => {
    const { id } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    expect((await call('GET', `${P}/${id}/score-screen`, A)).text).toContain('No ties');
    const fx = (await all(`SELECT id FROM fixtures WHERE competition_id = ?`, id))[0].id as string;
    const s = await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 9, score_b: 9 });
    expect(s.json.code).toBe('DRAW_NOT_ALLOWED');
  });
});

describe('team sizes and fuller rules (owner, 2026-11-28)', () => {
  const entries = ['x', 'y', 'z', 'w', 'v'].map((id) => ({
    id,
    label: id.toUpperCase(),
    is_active: 1,
  }));
  const played = (a: string, b: string, sa: number, sb: number) => ({
    entry_a: a,
    entry_b: b,
    status: 'played',
    score_a: sa,
    score_b: sb,
    state: 'confirmed',
  });
  // X: one win, one loss, 1 scored. Z: three ties, 27 scored. Both on 3 points.
  const games = [
    played('x', 'y', 1, 0),
    played('w', 'x', 1, 0),
    played('z', 'y', 9, 9),
    played('z', 'w', 9, 9),
    played('z', 'v', 9, 9),
  ];
  const rank = (t: { entry_id: string; rank: number }[], id: string) =>
    t.find((r) => r.entry_id === id)!.rank;

  test('the presets keep their words, and the new ones say the target and time', () => {
    expect(RULESETS.win_loss.says).toBe(
      'A win is 1 point. If teams tie on points: most wins, then the biggest score gap, then most points scored.'
    );
    expect(RULESETS.usbf_open.says).toContain('Play to 12.');
    expect(RULESETS.special_olympics.says).toContain(
      'Play to 12, or 20 minutes, then finish the frame.'
    );
  });

  test('the tie-break order comes from the rules, not from the code', () => {
    const byDefault = computeStandings(entries, games, RULESETS.three_one_zero);
    expect(rank(byDefault, 'x')).toBeLessThan(rank(byDefault, 'z'));
    const scoredFirst = computeStandings(
      entries,
      games,
      rulesetOf('three_one_zero', JSON.stringify({ tiebreak: ['scored', 'wins'] }))
    );
    expect(rank(scoredFirst, 'z')).toBeLessThan(rank(scoredFirst, 'x'));
    // Fewest let in: X let in 1, Z let in 27.
    const conceded = computeStandings(
      entries,
      games,
      rulesetOf('three_one_zero', JSON.stringify({ tiebreak: ['conceded'] }))
    );
    expect(rank(conceded, 'x')).toBeLessThan(rank(conceded, 'z'));
    // No tie-break at all: level on points share a place.
    const none = rulesetOf('three_one_zero', JSON.stringify({ tiebreak: [] }));
    const t = computeStandings(entries, games, none);
    expect(rank(t, 'x')).toBe(rank(t, 'z'));
    expect(none.says).toContain('Teams level on points share a place.');
  });

  test('a league can set its target, time limit, baci bonus and team size', async () => {
    const { id } = await league(2, {
      ruleset: 'usbf_open',
      rules: { time_limit_minutes: 20, baci: true, team_size: 3 },
    });
    const c = (await call('GET', `${P}/${id}`, A)).json.competition;
    expect(c.rules).toMatchObject({
      win: 1,
      draw: null,
      target: 12,
      time_limit_minutes: 20,
      baci: true,
      team_size: 3,
      tiebreak: ['wins', 'diff', 'scored'],
    });
    expect(c.rules.says).toContain('Play to 12, or 20 minutes, then finish the frame.');
    expect(c.rules.says).toContain('(a baci) scores 1 extra point');
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    // The game's limit is a must-know: on the score screen, not behind a tap.
    expect((await call('GET', `${P}/${id}/score-screen`, A)).text).toContain(
      'Play to 12, or 20 minutes, then finish the frame.'
    );
    const table = (await call('GET', `/competitions/${id}?tab=table`, {})).text;
    expect(table).toContain('(a baci) scores 1 extra point');
  });

  test('a soccer league can set its game length', async () => {
    const { id } = await league(2, { sport: 'soccer_league', rules: { time_limit_minutes: 90 } });
    const c = (await call('GET', `${P}/${id}`, A)).json.competition;
    expect(c.ruleset).toBe('three_one_zero');
    expect(c.rules.says).toContain('A game lasts 90 minutes.');
    expect(c.rules.says).not.toContain('frame');
  });

  test('ties can be turned on for bocce, and not off again while a tie stands', async () => {
    const { id } = await league(2);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    const fx = (await all(`SELECT id FROM fixtures WHERE competition_id = ?`, id))[0].id as string;
    const on = await call('PUT', `${P}/${id}`, A, { rules: { win: 2, draw: 1 } });
    expect(on.status, JSON.stringify(on.json)).toBe(200);
    expect(
      (await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, { score_a: 9, score_b: 9 })).status
    ).toBe(200);
    const d = await call('GET', `${P}/${id}`, A);
    expect(d.json.standings.map((t: Json) => t.points)).toEqual([1, 1]);
    const off = await call('PUT', `${P}/${id}`, A, { rules: null });
    expect(off.status).toBe(409);
    expect(off.json.code).toBe('DRAW_NOT_ALLOWED');
  });

  test('rules that do not fit together, or are not on the list, are refused', async () => {
    for (const rules of [
      { win: 1, draw: 1 },
      { win: 0, loss: 0 },
      { tiebreak: ['wins', 'wins'] },
      { tiebreak: ['coin_toss'] },
      { team_size: 5 },
      { target: 0 },
      { players: 3 },
      'win',
    ]) {
      const r = await call('POST', P, A, { name: 'Bad', format: 'league', rules });
      expect(r.status, JSON.stringify(rules)).toBe(400);
      expect(r.json.code, JSON.stringify(rules)).toBe('INVALID_RULES');
    }
    const { id } = await league(0);
    const r = await call('PUT', `${P}/${id}`, A, { rules: { draw: 5, win: 3 } });
    expect(r.json.code).toBe('INVALID_RULES');
  });

  test('a team can be 1 to 4 players a side', async () => {
    const { id } = await league(0);
    const made = await call('POST', `${P}/${id}/entries`, A, { label: 'Trio', team_size: 3 });
    expect(made.json.entry.team_size).toBe(3);
    const solo = await call('POST', `${P}/${id}/entries`, A, { label: 'Solo' });
    expect(solo.json.entry.team_size).toBeNull();
    for (const team_size of [0, 5, 2.5, '3']) {
      const r = await call('POST', `${P}/${id}/entries`, A, { label: 'Five', team_size });
      expect(r.json.code).toBe('INVALID_TEAM_SIZE');
    }
    const back = await call('PUT', `${P}/${id}/entries/${made.json.id}`, A, { team_size: null });
    expect(back.json.entry.team_size).toBeNull();
  });

  describe('a game’s lineup: positions per frame, never names', () => {
    // A 3v3 split: two at the near end throw 2 each, then the third throws 4
    // from the far end. The next frame another pair goes near (a rotation).
    const frames = [
      {
        frame: 1,
        a: [
          { position: 'A', end: 'near', balls: 2 },
          { position: 'B', end: 'near', balls: 2 },
        ],
        b: [
          { position: 'A', end: 'near', balls: 2 },
          { position: 'B', end: 'near', balls: 2 },
        ],
      },
      {
        frame: 2,
        a: [{ position: 'C', end: 'far', balls: 4 }],
        b: [{ position: 'C', end: 'far', balls: 4 }],
      },
      {
        frame: 3,
        a: [
          { position: 'B', end: 'near', balls: 2 },
          { position: 'C', end: 'near', balls: 2 },
        ],
        b: [
          { position: 'B', end: 'near', balls: 2 },
          { position: 'C', end: 'near', balls: 2 },
        ],
      },
    ];
    async function game() {
      const { id } = await league(2, { rules: { team_size: 3 } });
      await start(id);
      await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
      const fx = (await all(`SELECT id FROM fixtures WHERE competition_id = ?`, id))[0]
        .id as string;
      return { id, url: `${P}/${id}/fixtures/${fx}/result`, fx };
    }

    test('saved with the score, read back in the same shape', async () => {
      const { id, url, fx } = await game();
      const s = await call('PUT', url, A, { score_a: 12, score_b: 7, frames });
      expect(s.status, JSON.stringify(s.json)).toBe(200);
      expect(s.json.fixture.result.frames).toEqual(frames);
      expect(await all(`SELECT * FROM fixture_lineups WHERE fixture_id = ?`, fx)).toHaveLength(10);
      const d = await call('GET', `${P}/${id}`, A);
      expect(d.json.fixtures.find((f: Json) => f.id === fx).result.frames).toEqual(frames);
      // A score fix without frames keeps the lineup; new frames replace it.
      await call('PUT', url, A, { score_a: 12, score_b: 8 });
      expect(await all(`SELECT 1 FROM fixture_lineups WHERE fixture_id = ?`, fx)).toHaveLength(10);
      await call('PUT', url, A, { score_a: 12, score_b: 8, frames: [frames[1]] });
      expect(await all(`SELECT 1 FROM fixture_lineups WHERE fixture_id = ?`, fx)).toHaveLength(2);
      // Taking the score back takes its lineup with it.
      expect((await call('DELETE', url, A)).status).toBe(200);
      expect(await all(`SELECT 1 FROM fixture_lineups WHERE fixture_id = ?`, fx)).toEqual([]);
    });

    test('a position outside the team, a repeat, or a wrong ball count is refused', async () => {
      const { url, fx } = await game();
      const one = (a: unknown[]) => [{ frame: 1, a, b: frames[1].b }];
      for (const bad of [
        one([{ position: 'D', end: 'near', balls: 4 }]),
        one([
          { position: 'A', end: 'near', balls: 2 },
          { position: 'A', end: 'far', balls: 2 },
        ]),
        one([{ position: 'A', end: 'near', balls: 5 }]),
        one([{ position: 'A', end: 'middle', balls: 4 }]),
        one([{ position: 'A', end: 'near', balls: 4, name: 'Jo' }]),
        [frames[0], frames[0]],
        [],
      ]) {
        const r = await call('PUT', url, A, { score_a: 12, score_b: 7, frames: bad });
        expect(r.status, JSON.stringify(bad)).toBe(400);
        expect(r.json.code, JSON.stringify(bad)).toBe('INVALID_FRAMES');
      }
      expect(await all(`SELECT 1 FROM fixture_results WHERE fixture_id = ?`, fx)).toEqual([]);
    });

    test('a 4-player team may use position D', async () => {
      const { id } = await league(2);
      await start(id);
      await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
      const fx = (await all(`SELECT id FROM fixtures WHERE competition_id = ?`, id))[0]
        .id as string;
      const four = [{ position: 'D', end: 'far', balls: 4 }];
      const r = await call('PUT', `${P}/${id}/fixtures/${fx}/result`, A, {
        score_a: 12,
        score_b: 7,
        frames: [{ frame: 1, a: four, b: four }],
      });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    });
  });
});

describe('the host score screen', () => {
  test('lists the next round’s matches with two score boxes each', async () => {
    const { id } = await league(4);
    await start(id);
    await call('POST', `${P}/${id}/schedule`, A, { event_ids: NIGHTS });
    const r = await call('GET', `${P}/${id}/score-screen`, A);
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    expect(r.text.match(/data-testid="score-match"/g)).toHaveLength(2);
    expect(r.text).toContain('inputmode="numeric"');
  });
});

// ── audit ─────────────────────────────────────────────────────────────────────

describe('every write is audited, in the competition’s brand', () => {
  test('writes leave success rows with the brand; a read leaves none', async () => {
    const { id } = await league(2);
    await call('GET', `${P}/${id}`, A);
    const rows = await all(
      `SELECT action, outcome, brand_id FROM admin_audit_log WHERE resource_type = 'competition' AND resource_id = ? ORDER BY action`,
      id
    );
    expect(rows.map((r) => r.action)).toEqual([
      'CREATE_COMPETITION',
      'CREATE_COMPETITION_ENTRY',
      'CREATE_COMPETITION_ENTRY',
    ]);
    expect(rows.every((r) => r.outcome === 'success' && r.brand_id === BRAND_A)).toBe(true);
  });

  test('a refused write is denied, never a success', async () => {
    const { id } = await league(0);
    await call('POST', `${P}/${id}/entries`, A, { label: 'a@b.co' });
    const rows = await all(
      `SELECT outcome FROM admin_audit_log WHERE action = 'CREATE_COMPETITION_ENTRY' AND resource_id = ?`,
      id
    );
    expect(rows).toEqual([{ outcome: 'denied' }]);
  });
});
