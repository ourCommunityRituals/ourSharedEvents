/**
 * The publishing rule, the product's SQL against the plain model (OSE ADR-040
 * decisions 7 and 13). Workers pool, real D1. Random nights (seeded) are
 * written straight into the vote tables, the product's own statements decide
 * them (resultStatements for the Room Pick, finalizeOnlinePickAndPasses for the
 * Online Pick), and each result must equal tests/helpers/vote-outcome-model.ts.
 * That is what lets tests/vote-swarm-simulation.spec.ts argue about the rule
 * the product runs, not a copy of it.
 *
 * Down counts are seeded at random too: the model never reads them, so a SQL
 * that ranked or decided by them would differ here.
 *
 * @born-red decisions 7 and 13 | method: injected-fault, each removed after:
 *   the room OUTCOME_UPDATE's `>= secret_margin` changed to `> secret_margin`
 *   (room case red), CROWD_OUTCOME ordering by `t.up_count + t.down_count`
 *   (crowd case red) | date: 2026-11-26
 */

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { resultStatements } from '../src/lib/vote-results';
import { finalizeOnlinePickAndPasses } from '../src/lib/vote-crowd';
import { decide, rng, T_VALUES, V_VALUES, type Outcome } from './helpers/vote-outcome-model';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const db = tenv.DB;

const NIGHTS = 60;
const hex = (r: () => number) =>
  Array.from({ length: 64 }, () => Math.floor(r() * 16).toString(16)).join('');

beforeAll(async () => {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
});

interface Seeded {
  setId: string;
  objects: string[];
  room: { ups: number[]; voters: number; T: number; V: number };
  crowd: { ups: number[]; voters: number; T: number; V: number };
}

/** One random night: 2 to 4 objects, counts near the line so both outcomes occur. */
async function seedNight(i: number, r: () => number): Promise<Seeded> {
  const eventId = `evt-vod-${i}`;
  const setId = `set-vod-${i}`;
  const k = 2 + Math.floor(r() * 3);
  const objects = Array.from({ length: k }, (_, j) => `obj-vod-${i}-${j}`);
  const pick = () => {
    const T = T_VALUES[Math.floor(r() * T_VALUES.length)];
    const V = V_VALUES[Math.floor(r() * V_VALUES.length)];
    const base = Math.floor(r() * 20);
    const ups = objects.map(() => base + Math.floor(r() * 14));
    const voters = 6 + Math.floor(r() * 14);
    return { ups, voters, T, V };
  };
  const room = pick();
  const crowd = pick();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'brand-vod', ?, ?, 'active')`
      )
      .bind(eventId, `Differential ${i}`, eventId),
    db
      .prepare(
        `INSERT INTO vote_sets (id, event_id, state, pepper_epoch, secret_margin, secret_floor)
         VALUES (?, ?, 'open', '2026-11-26', ?, ?)`
      )
      .bind(setId, eventId, room.T, room.V),
    db
      .prepare(
        `INSERT INTO vote_crowd_sets (set_id, event_id, is_on, pepper_epoch, secret_margin, secret_floor)
         VALUES (?, ?, 1, '2026-11-26', ?, ?)`
      )
      .bind(setId, eventId, crowd.T, crowd.V),
  ];
  objects.forEach((id, j) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO votable_objects (id, event_id, set_id, kind, label, state) VALUES (?, ?, ?, 'song', ?, 'open')`
        )
        .bind(id, eventId, setId, `Song ${j}`),
      db
        .prepare(`INSERT INTO vote_tallies (object_id, up_count, down_count) VALUES (?, ?, ?)`)
        .bind(id, room.ups[j], Math.floor(r() * 40)),
      db
        .prepare(
          `INSERT INTO vote_crowd_tallies (object_id, up_count, down_count) VALUES (?, ?, ?)`
        )
        .bind(id, crowd.ups[j], Math.floor(r() * 40))
    );
  });
  for (let v = 0; v < room.voters; v++)
    stmts.push(
      db.prepare(`INSERT INTO vote_participants (set_id, marker) VALUES (?, ?)`).bind(setId, hex(r))
    );
  for (let v = 0; v < crowd.voters; v++)
    stmts.push(
      db
        .prepare(`INSERT INTO vote_crowd_participants (set_id, marker) VALUES (?, ?)`)
        .bind(setId, hex(r))
    );
  await db.batch(stmts);
  return { setId, objects, room, crowd };
}

const asOutcome = (
  row: { outcome: string; winner_object_id: string | null },
  objects: string[]
): Outcome =>
  row.outcome === 'winner'
    ? { outcome: 'winner', index: objects.indexOf(row.winner_object_id ?? '') }
    : { outcome: 'too_close' };

describe('decisions 7 and 13: the SQL decides every night the way the model does', () => {
  test(`${NIGHTS} random nights, Room Pick and Online Pick`, async () => {
    const r = rng(7013);
    let winners = 0;
    let tooClose = 0;
    for (let i = 0; i < NIGHTS; i++) {
      const s = await seedNight(i, r);
      const eventId = `evt-vod-${i}`;

      // Room Pick: the product's two UPDATEs, with no extra guard.
      await db.batch(resultStatements(db, s.setId, eventId, '', []));
      const roomRow = (await db
        .prepare(`SELECT outcome, winner_object_id FROM vote_sets WHERE id = ?`)
        .bind(s.setId)
        .first()) as { outcome: string; winner_object_id: string | null };
      const roomExpected = decide(s.room);
      expect(asOutcome(roomRow, s.objects), `room night ${i} ${JSON.stringify(s.room)}`).toEqual(
        roomExpected
      );
      roomExpected.outcome === 'winner' ? winners++ : tooClose++;

      // The room set goes final, then the Online Pick is decided by the product's batch.
      await db
        .prepare(
          `UPDATE vote_sets SET is_final = 1, final_at = '2026-11-26 23:00:00', state = 'closed',
                  secret_margin = NULL, secret_floor = NULL WHERE id = ?`
        )
        .bind(s.setId)
        .run();
      await finalizeOnlinePickAndPasses(db, s.setId);
      const crowdRow = (await db
        .prepare(`SELECT outcome, winner_object_id, is_final FROM vote_crowd_sets WHERE set_id = ?`)
        .bind(s.setId)
        .first()) as { outcome: string; winner_object_id: string | null; is_final: number };
      expect(crowdRow.is_final).toBe(1);
      const crowdExpected = decide(s.crowd);
      expect(asOutcome(crowdRow, s.objects), `crowd night ${i} ${JSON.stringify(s.crowd)}`).toEqual(
        crowdExpected
      );
      crowdExpected.outcome === 'winner' ? winners++ : tooClose++;
    }
    // The seed reaches both outcomes, so neither branch is untested.
    expect(winners).toBeGreaterThan(10);
    expect(tooClose).toBeGreaterThan(10);
  });
});
