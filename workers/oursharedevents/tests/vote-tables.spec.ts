/**
 * The vote tables (OSE-2125, S2 of OSE-1193; OSE ADR-040 decisions 1 to 4).
 *
 * An anonymous vote is a counter on an object, never a row about a voter. This
 * spec reads the schema the migrations really build (sqlite_master and PRAGMA
 * table_info on both bindings) and writes rows straight into it, so it holds
 * the shape before any route exists (S3, S4a and S5 come later).
 *
 * The static half, which reads the migration files and the Worker source, is
 * tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0).
 *
 * @born-red OSE-2125 | method: injected-fault, each removed after: the
 *   migration moved to migrations-forms/ (lives in DB only), a `voter_hash`
 *   column on vote_receipts (no voter column), a `side` column on
 *   vote_receipts (receipts carry no side), the team marker keyed by the song
 *   (three up votes), T allowed to 10 (T and V ranges), the final CHECK
 *   dropped (final set), WITHOUT ROWID dropped (write order), the receipt CHECK
 *   dropped (marker shape), UNIQUE(event_id) dropped (one set per event), and
 *   after the security review: the state rule, the set-and-event foreign key,
 *   the team id shape and set_id on team markers | date: 2026-11-18
 */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  VOTABLE_KINDS,
  VOTE_PARTICIPANT_CONTEXT,
  VOTE_RECEIPT_CONTEXT,
  VOTE_TABLES,
  VOTE_TEAM_CONTEXT,
  isVoteMarker,
  isVoteTeamId,
  parseVotableLabel,
  voteParticipantMarker,
  voteReceipt,
  voteTeamMarker,
} from '../src/lib/votes';
import { SCAN_NODE_KEY_CONTEXT, scanNodeKey } from '../src/lib/scan-node-key';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const PEPPER = 'test-pepper-vote-tables';

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('no such column')) continue;
      throw e;
    }
  }
  for (const stmt of JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

async function tables(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

async function columns(table: string): Promise<string[]> {
  const rows = await tenv().DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

/** A column name split into its words: `pepper_epoch` -> ['pepper', 'epoch']. */
const words = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** A column about a voter or a browser. */
const VOTER_WORDS = new Set([
  'voter',
  'voters',
  'anon',
  'anonymous',
  'session',
  'snk',
  'cookie',
  'browser',
  'device',
  'agent',
  'ua',
  'ip',
  'fingerprint',
  'user',
  'person',
  'token',
  'key',
  'hash',
  'pass',
  'k',
]);
/** A column that holds a time. */
const TIME_WORDS = new Set(['at', 'time', 'date', 'day', 'hour', 'stamp', 'ts', 'clock', 'when']);

const voterShaped = (c: string) => words(c).some((w) => VOTER_WORDS.has(w));
const timeShaped = (c: string) => words(c).some((w) => TIME_WORDS.has(w));

let seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${seq++}`;
const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const hex64 = () => hex(32);
const teamId = () => `grp_${hex(8)}`;

async function seedEvent(): Promise<string> {
  const id = uid('evt_vote');
  await tenv()
    .DB.prepare('INSERT INTO events (id, brand_id, title, slug) VALUES (?, ?, ?, ?)')
    .bind(id, 'brand-vote', `Vote night ${id}`, `slug-${id}`)
    .run();
  return id;
}

async function seedSet(eventId: string): Promise<string> {
  const id = uid('vset');
  await tenv()
    .DB.prepare('INSERT INTO vote_sets (id, event_id) VALUES (?, ?)')
    .bind(id, eventId)
    .run();
  return id;
}

async function seedSong(eventId: string, setId: string, groupId: string | null): Promise<string> {
  const id = uid('vobj');
  await tenv().DB.batch([
    tenv()
      .DB.prepare(
        "INSERT INTO votable_objects (id, event_id, set_id, kind, label, group_id) VALUES (?, ?, ?, 'song', ?, ?)"
      )
      .bind(id, eventId, setId, `Song ${id}`, groupId),
    tenv().DB.prepare('INSERT INTO vote_tallies (object_id) VALUES (?)').bind(id),
  ]);
  return id;
}

/**
 * One up vote, as S4a will write it: a receipt, the tally, and the team marker
 * if new. The marker is made from the song's team, never from the song.
 */
async function upVote(k: string, setId: string, objectId: string, team: string): Promise<void> {
  const receipt = await voteReceipt(PEPPER, k, objectId);
  const marker = await voteTeamMarker(PEPPER, k, team);
  expect(receipt && marker).toBeTruthy();
  const res = await tenv()
    .DB.prepare('INSERT OR IGNORE INTO vote_receipts (object_id, receipt) VALUES (?, ?)')
    .bind(objectId, receipt)
    .run();
  if (res.meta.changes !== 1) return; // a duplicate changes nothing
  await tenv().DB.batch([
    tenv()
      .DB.prepare('UPDATE vote_tallies SET up_count = up_count + 1 WHERE object_id = ?')
      .bind(objectId),
    tenv()
      .DB.prepare(
        'INSERT OR IGNORE INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)'
      )
      .bind(setId, team, marker),
  ]);
}

async function teamTotal(setId: string, team: string): Promise<number> {
  const row = await tenv()
    .DB.prepare('SELECT COUNT(*) AS n FROM vote_team_markers WHERE set_id = ? AND team_id = ?')
    .bind(setId, team)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

/** Run a statement and say whether the database refused it. */
async function refused(sql: string, ...args: unknown[]): Promise<boolean> {
  try {
    await tenv()
      .DB.prepare(sql)
      .bind(...args)
      .run();
    return false;
  } catch {
    return true;
  }
}

beforeAll(applyMigrations);

describe('OSE-2125 | the vote tables: where they live and what they hold', () => {
  test('vote tables live in DB only', async () => {
    const db = await tables(tenv().DB);
    const forms = await tables(tenv().FORMS_DB);
    expect(
      VOTE_TABLES.filter((t) => !db.includes(t)),
      'missing from DB'
    ).toEqual([]);
    expect(
      forms.filter((t) => /vot|tall|ballot|receipt|participant/.test(t)),
      'a vote table in FORMS_DB'
    ).toEqual([]);
  });

  test('no voter, anon, session, snk or time column on a vote table', async () => {
    const found: string[] = [];
    for (const table of VOTE_TABLES) {
      for (const c of await columns(table)) {
        if (voterShaped(c)) found.push(`${table}.${c} (voter)`);
      }
    }
    // The counter and marker tables hold no time at all.
    for (const table of [
      'vote_tallies',
      'vote_receipts',
      'vote_participants',
      'vote_team_markers',
    ]) {
      for (const c of await columns(table)) if (timeShaped(c)) found.push(`${table}.${c} (time)`);
    }
    expect(found).toEqual([]);
    // The set and the object hold only these times: the hour, and a song's window.
    expect((await columns('vote_sets')).filter(timeShaped).sort()).toEqual([
      'created_at',
      'final_at',
      'updated_at',
    ]);
    expect((await columns('votable_objects')).filter(timeShaped).sort()).toEqual([
      'closes_at',
      'created_at',
      'updated_at',
    ]);
  });

  test('receipts carry no side: every vote table holds exactly these columns', async () => {
    expect(await columns('vote_receipts')).toEqual(['object_id', 'receipt']);
    expect(await columns('vote_participants')).toEqual(['set_id', 'marker']);
    expect(await columns('vote_team_markers')).toEqual(['set_id', 'team_id', 'marker']);
    expect(await columns('vote_tallies')).toEqual(['object_id', 'up_count', 'down_count']);
    expect(await columns('vote_sets')).toEqual([
      'id',
      'event_id',
      'state',
      'played_by',
      'pepper_epoch',
      'is_void',
      'void_reason',
      'is_final',
      'final_at',
      'secret_margin',
      'secret_floor',
      'counted_votes',
      'duplicate_votes',
      'refused_votes',
      'created_at',
      'updated_at',
      'outcome', // 0114 (OSE-2130): 'winner' or 'too_close', written at final
      'winner_object_id',
      'winner_team_id',
    ]);
    expect(await columns('votable_objects')).toEqual([
      'id',
      'event_id',
      'set_id',
      'kind',
      'label',
      'booth_id',
      'group_id',
      'state',
      'closes_at',
      'sort',
      'created_at',
      'updated_at',
    ]);
  });

  test('the marker tables number no rows in write order (WITHOUT ROWID)', async () => {
    for (const table of ['vote_receipts', 'vote_participants', 'vote_team_markers']) {
      expect(await refused(`SELECT rowid FROM ${table} LIMIT 1`), table).toBe(true);
    }
    // Control: a table with a rowid answers the same query.
    expect(await refused('SELECT rowid FROM vote_tallies LIMIT 1')).toBe(false);
  });

  test('the detectors see what they are for (negative controls)', () => {
    const voterish = ['voter_hash', 'anon_id', 'session_key', 'snk', 'ip', 'k', 'ua', 'pass_token'];
    expect(voterish.filter(voterShaped)).toEqual(voterish);
    expect(['created_at', 'voted_time', 'hour', 'ts', 'up_count'].filter(timeShaped)).toEqual([
      'created_at',
      'voted_time',
      'hour',
      'ts',
    ]);
    expect(
      ['receipt', 'marker', 'object_id', 'pepper_epoch', 'played_by'].filter(voterShaped)
    ).toEqual([]);
  });
});

describe('OSE-2125 | one set per event, and its secret numbers', () => {
  test('one vote set per event: a second set for the same event is refused', async () => {
    const eventId = await seedEvent();
    await seedSet(eventId);
    expect(
      await refused('INSERT INTO vote_sets (id, event_id) VALUES (?, ?)', uid('vset'), eventId)
    ).toBe(true);
  });

  test('an object belongs to its own set and event: never another event set', async () => {
    const e1 = await seedEvent();
    const e2 = await seedEvent();
    const s1 = await seedSet(e1);
    expect(
      await refused(
        "INSERT INTO votable_objects (id, event_id, set_id, kind, label) VALUES (?, ?, ?, 'song', 'x')",
        uid('vobj'),
        e2,
        s1
      )
    ).toBe(true);
    expect(
      await refused(
        "INSERT INTO votable_objects (id, event_id, set_id, kind, label) VALUES (?, ?, ?, 'song', 'x')",
        uid('vobj'),
        e1,
        s1
      )
    ).toBe(false);
  });

  test('T is a whole number from 5 to 9, and V from 10 to 14', async () => {
    const setId = await seedSet(await seedEvent());
    const set = (col: string, v: number) =>
      refused(`UPDATE vote_sets SET ${col} = ? WHERE id = ?`, v, setId);
    for (const v of [4, 10, 0, -1, 5.5]) expect(await set('secret_margin', v), `T=${v}`).toBe(true);
    for (const v of [9, 15, 0, 12.9]) expect(await set('secret_floor', v), `V=${v}`).toBe(true);
    for (const v of [5, 7, 9]) expect(await set('secret_margin', v), `T=${v}`).toBe(false);
    for (const v of [10, 12, 14]) expect(await set('secret_floor', v), `V=${v}`).toBe(false);
  });

  test('a final set is closed, holds no T or V, and names the hour it became final', async () => {
    const setId = await seedSet(await seedEvent());
    await tenv()
      .DB.prepare(
        "UPDATE vote_sets SET state = 'open', secret_margin = 6, secret_floor = 11 WHERE id = ?"
      )
      .bind(setId)
      .run();
    const finalSql =
      "UPDATE vote_sets SET is_final = 1, final_at = '2026-11-18 21:00:00', secret_margin = NULL, secret_floor = NULL WHERE id = ?";
    // Final while still open: refused.
    expect(await refused(finalSql, setId)).toBe(true);
    await tenv().DB.prepare("UPDATE vote_sets SET state = 'closed' WHERE id = ?").bind(setId).run();
    // Final while T and V are still there: refused.
    expect(
      await refused(
        "UPDATE vote_sets SET is_final = 1, final_at = '2026-11-18 21:00:00' WHERE id = ?",
        setId
      )
    ).toBe(true);
    // Final with no final_at: refused.
    expect(
      await refused(
        'UPDATE vote_sets SET is_final = 1, secret_margin = NULL, secret_floor = NULL WHERE id = ?',
        setId
      )
    ).toBe(true);
    // Final, closed, with both nulled in the same write: accepted.
    expect(await refused(finalSql, setId)).toBe(false);
    // Nothing reopens it, and T cannot come back.
    expect(await refused("UPDATE vote_sets SET state = 'open' WHERE id = ?", setId)).toBe(true);
    expect(await refused("UPDATE vote_sets SET state = 'draft' WHERE id = ?", setId)).toBe(true);
    expect(await refused('UPDATE vote_sets SET secret_margin = 7 WHERE id = ?', setId)).toBe(true);
  });

  test('a void set names its reason, and only a void set has one', async () => {
    const setId = await seedSet(await seedEvent());
    expect(await refused('UPDATE vote_sets SET is_void = 1 WHERE id = ?', setId)).toBe(true);
    for (const empty of ['', '   ']) {
      expect(
        await refused(
          'UPDATE vote_sets SET is_void = 1, void_reason = ? WHERE id = ?',
          empty,
          setId
        )
      ).toBe(true);
    }
    expect(
      await refused("UPDATE vote_sets SET void_reason = 'pepper_epoch' WHERE id = ?", setId)
    ).toBe(true);
    expect(
      await refused(
        "UPDATE vote_sets SET is_void = 1, void_reason = 'pepper_epoch' WHERE id = ?",
        setId
      )
    ).toBe(false);
  });

  test('a new set and object are stamped at the hour, never finer', async () => {
    const eventId = await seedEvent();
    const setId = await seedSet(eventId);
    const objId = await seedSong(eventId, setId, null);
    const set = await tenv()
      .DB.prepare('SELECT created_at, updated_at FROM vote_sets WHERE id = ?')
      .bind(setId)
      .first<{ created_at: string; updated_at: string }>();
    const obj = await tenv()
      .DB.prepare('SELECT created_at, updated_at FROM votable_objects WHERE id = ?')
      .bind(objId)
      .first<{ created_at: string; updated_at: string }>();
    for (const v of [set?.created_at, set?.updated_at, obj?.created_at, obj?.updated_at]) {
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00:00$/);
    }
  });
});

describe('OSE-2125 | receipts and markers', () => {
  test('a marker column takes 64 lowercase hex only: no cookie, no scan key', async () => {
    const eventId = await seedEvent();
    const setId = await seedSet(eventId);
    const objId = await seedSong(eventId, setId, null);
    const snk = await scanNodeKey('anon_00000000-0000-4000-8000-000000000000', PEPPER);
    for (const value of [
      'anon_00000000-0000-4000-8000-000000000000',
      snk,
      hex64().toUpperCase(),
      hex64().slice(1),
      `${hex64()}0`,
      '',
    ]) {
      expect(
        await refused('INSERT INTO vote_receipts (object_id, receipt) VALUES (?, ?)', objId, value),
        `receipt ${value}`
      ).toBe(true);
      expect(
        await refused('INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)', setId, value),
        `participant ${value}`
      ).toBe(true);
      expect(
        await refused(
          'INSERT INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)',
          setId,
          teamId(),
          value
        ),
        `team marker ${value}`
      ).toBe(true);
    }
    expect(
      await refused('INSERT INTO vote_receipts (object_id, receipt) VALUES (?, ?)', objId, hex64())
    ).toBe(false);
  });

  test('a team is an opaque OSE id: a name or a cookie is refused', async () => {
    const eventId = await seedEvent();
    const setId = await seedSet(eventId);
    for (const bad of [
      'The Smith Family',
      'grp_Smiths',
      'anon_00000000-0000-4000-8000-000000000000',
      'grp_',
      'grp_123',
    ]) {
      expect(isVoteTeamId(bad), bad).toBe(false);
      expect(
        await refused(
          "INSERT INTO votable_objects (id, event_id, set_id, kind, label, group_id) VALUES (?, ?, ?, 'song', 'x', ?)",
          uid('vobj'),
          eventId,
          setId,
          bad
        ),
        `group_id ${bad}`
      ).toBe(true);
      expect(
        await refused(
          'INSERT INTO vote_team_markers (set_id, team_id, marker) VALUES (?, ?, ?)',
          setId,
          bad,
          hex64()
        ),
        `team_id ${bad}`
      ).toBe(true);
    }
    const good = 'grp_0b5e2c1a-7f4d-4e2b-9a61-3c8d5f0e9b27';
    expect(isVoteTeamId(good)).toBe(true);
    expect(await seedSong(eventId, setId, good)).toBeTruthy();
  });

  test('a second receipt for the same object and browser changes nothing', async () => {
    const eventId = await seedEvent();
    const setId = await seedSet(eventId);
    const objId = await seedSong(eventId, setId, null);
    const receipt = await voteReceipt(PEPPER, hex64(), objId);
    const insert = () =>
      tenv()
        .DB.prepare('INSERT OR IGNORE INTO vote_receipts (object_id, receipt) VALUES (?, ?)')
        .bind(objId, receipt)
        .run();
    expect((await insert()).meta.changes).toBe(1);
    expect((await insert()).meta.changes).toBe(0);
  });

  test("three up votes on one team's songs add one to its total", async () => {
    const eventId = await seedEvent();
    const setId = await seedSet(eventId);
    const team = teamId();
    const songs = [
      await seedSong(eventId, setId, team),
      await seedSong(eventId, setId, team),
      await seedSong(eventId, setId, team),
    ];
    const voter = hex64();
    for (const song of songs) await upVote(voter, setId, song, team);
    expect(await teamTotal(setId, team)).toBe(1);
    // Each song still counts its own up vote.
    const ups = await tenv()
      .DB.prepare('SELECT SUM(up_count) AS n FROM vote_tallies WHERE object_id IN (?, ?, ?)')
      .bind(...songs)
      .first<{ n: number }>();
    expect(ups?.n).toBe(3);
    // A second voter adds one more; a repeat of the first adds nothing.
    await upVote(hex64(), setId, songs[1], team);
    await upVote(voter, setId, songs[2], team);
    expect(await teamTotal(setId, team)).toBe(2);
  });

  test('two nights never share a team total, even with the same team id', async () => {
    const team = teamId();
    const e1 = await seedEvent();
    const e2 = await seedEvent();
    const s1 = await seedSet(e1);
    const s2 = await seedSet(e2);
    await upVote(hex64(), s1, await seedSong(e1, s1, team), team);
    await upVote(hex64(), s1, await seedSong(e1, s1, team), team);
    await upVote(hex64(), s2, await seedSong(e2, s2, team), team);
    expect(await teamTotal(s1, team)).toBe(2);
    expect(await teamTotal(s2, team)).toBe(1);
  });

  test('the three markers differ for one browser, and none is the scan key', async () => {
    const k = hex64();
    const id = 'grp_0123456789abcdef';
    const receipt = await voteReceipt(PEPPER, k, id);
    const participant = await voteParticipantMarker(PEPPER, k, id);
    const team = await voteTeamMarker(PEPPER, k, id);
    for (const m of [receipt, participant, team]) expect(isVoteMarker(m)).toBe(true);
    expect(new Set([receipt, participant, team]).size).toBe(3);
    const snk = await scanNodeKey(k, PEPPER);
    expect([receipt, participant, team]).not.toContain(snk?.replace(/^snk1_/, ''));
    expect(
      new Set([
        VOTE_RECEIPT_CONTEXT,
        VOTE_PARTICIPANT_CONTEXT,
        VOTE_TEAM_CONTEXT,
        SCAN_NODE_KEY_CONTEXT,
      ]).size
    ).toBe(4);
    // Same inputs, same marker: the dedup holds across requests.
    expect(await voteReceipt(PEPPER, k, id)).toBe(receipt);
  });

  test('no pepper, no key, no id or no team id: no marker is made', async () => {
    const k = hex64();
    expect(await voteReceipt(undefined, k, 'o')).toBeNull();
    expect(await voteReceipt('', k, 'o')).toBeNull();
    expect(await voteReceipt(PEPPER, 'anon_00000000-0000-4000-8000-000000000000', 'o')).toBeNull();
    expect(await voteParticipantMarker(PEPPER, k, '')).toBeNull();
    expect(await voteTeamMarker(PEPPER, k.toUpperCase(), teamId())).toBeNull();
    expect(await voteTeamMarker(PEPPER, k, 'The Smith Family')).toBeNull();
  });
});

describe('OSE-2125 | what an object may be', () => {
  test('an object is a song, a stall or an entry (ADR-040 decisions 2, 4 and 12)', () => {
    // No event-level object, and a team is a group_id, never an object.
    expect([...VOTABLE_KINDS]).toEqual(['song', 'stall', 'entry']);
  });

  test('a label refuses email- and phone-shaped text', () => {
    for (const bad of [
      'call me at 555 123 4567',
      'Song by ann@example.com',
      '(312) 555-0199',
      '',
      '   ',
      'x'.repeat(81),
      'tab\there',
      42,
      null,
    ]) {
      expect(parseVotableLabel(bad).ok, String(bad)).toBe(false);
    }
    expect(parseVotableLabel('  Blue   Moon  ')).toEqual({ ok: true, value: 'Blue Moon' });
    expect(parseVotableLabel('Stall 12: Hot Pies').ok).toBe(true);
  });
});
