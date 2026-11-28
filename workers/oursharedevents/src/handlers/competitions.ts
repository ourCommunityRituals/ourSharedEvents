/**
 * Competitions: the admin API (OSE-525, OSE-526, OSE-529; phase 1 of the leagues
 * design, OCR-docs PROPOSAL_leagues-tournaments-referees.md).
 *
 *   GET    /api/v2/admin/competitions                           the caller's brands' competitions
 *   POST   /api/v2/admin/competitions                           make one, with its round-robin stage
 *   GET    /api/v2/admin/competitions/:id                       it, its teams, matches, results, table
 *   PUT    /api/v2/admin/competitions/:id                       change name, sport, dates, ruleset, status
 *   POST   /api/v2/admin/competitions/:id/entries               add a team entry (a public label)
 *   PUT    /api/v2/admin/competitions/:id/entries/:entryId      rename, reseed or withdraw it
 *   POST   /api/v2/admin/competitions/:id/schedule              make the round robin; played rounds stay
 *   POST   /api/v2/admin/competitions/:id/fixtures              add one match by hand
 *   PUT    /api/v2/admin/competitions/:id/fixtures/:fid         move, swap or postpone a match
 *   PUT    /api/v2/admin/competitions/:id/fixtures/:fid/result  enter its score
 *   DELETE /api/v2/admin/competitions/:id/fixtures/:fid/result  take a mistaken score back
 *
 * THE BRAND WALL HAS TWO HALVES, as for booths (handlers/event-booths.ts).
 *   1. The competition in the path. Every by-id route is under
 *      /api/v2/admin/competitions/:id, so the router's guardAdminObjectScope has
 *      proved the competition is in the caller's brand scope (and, in the public
 *      brand, the caller's own), and the admin write guard has checked every
 *      write's origin and body type. The collection routes scope their own SQL.
 *   2. Everything under it. An entry or a fixture is read with the path
 *      competition as a bound predicate, so one of another competition answers
 *      the same 404 as one that does not exist. An event night must be of the
 *      competition's own brand (and, in the public brand, made by the same
 *      organizer), or it is refused.
 *
 * MANUAL OVERRIDE IS FIRST CLASS (OSE-526). The generator writes a plain round
 * robin; the host can then move any match to another night, court or time,
 * swap the teams, postpone it, or add one by hand. Regenerating replaces only
 * the rounds with no score in them.
 *
 * A FINISHED COMPETITION IS FINAL. Setting status `finished` makes every result
 * `final`, and nothing under it can change after that.
 *
 * NEVER WHO. This file reads and writes the five competition tables and reads
 * `events` to check a night's brand. No people table, no FORMS_DB, no count of
 * anyone. `entered_by` is a role, never the actor; the router's audit line
 * records who wrote.
 */

import { extractAdminActor, type AdminEnv } from '../auth/admin';
import {
  PUBLIC_BRAND_ID,
  resolveAdminBrandScopeAsync,
  type AdminBrandScopeEnv,
} from '../lib/admin-brand-scope';
import { ownerAndSql, resolveOwnerRule } from '../lib/admin-owner-scope';
import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';
import {
  COMPETITION_COLUMNS,
  ENTRIES_MAX,
  ENTRY_COLUMNS,
  FIXTURE_COLUMNS,
  RESULT_COLUMNS,
  computeStandings,
  newCompetitionId,
  newEntryId,
  newFixtureId,
  newStageId,
  parseCompetitionCreate,
  parseCompetitionUpdate,
  parseEntryCreate,
  parseEntryUpdate,
  parseFixtureCreate,
  parseFixtureUpdate,
  parseId,
  parseResult,
  parseSchedule,
  projectCompetition,
  projectEntry,
  projectFixture,
  roundRobin,
  rulesetOf,
  slotFor,
  type CompetitionRow,
  type EntryRow,
  type FixtureRow,
  type ResultRow,
} from '../lib/competitions';

export interface CompetitionsEnv extends AdminEnv, AdminBrandScopeEnv {
  DB?: D1Database;
}

const COMPETITION_SELECT = COMPETITION_COLUMNS.join(', ');
const ENTRY_SELECT = ENTRY_COLUMNS.join(', ');
const FIXTURE_SELECT = FIXTURE_COLUMNS.join(', ');
const RESULT_SELECT = RESULT_COLUMNS.map((c) => `r.${c}`).join(', ');
const LIST_MAX = 200;
const MAX_BODY = 16_384;

function requestId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function reply(request: Request, status: number, body: Record<string, unknown>): Response {
  const rid = requestId();
  return Response.json(
    { ok: status < 400, status, ...body, requestId: rid, timestamp: new Date().toISOString() },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}

const fail = (request: Request, status: number, code: string, error: string): Response =>
  reply(request, status, { code, error });

const noDb = (request: Request) =>
  fail(request, 503, 'DB_NOT_CONFIGURED', 'Database not available');
/** The same words guardAdminObjectScope answers with, so the two cannot be told apart. */
const noCompetition = (request: Request, id: string) =>
  fail(request, 404, 'NOT_FOUND', `Competition not found: ${id}`);
const noEntry = (request: Request) => fail(request, 404, 'ENTRY_NOT_FOUND', 'Team entry not found');
const noFixture = (request: Request) => fail(request, 404, 'FIXTURE_NOT_FOUND', 'Match not found');
const finished = (request: Request) =>
  fail(request, 409, 'COMPETITION_FINISHED', 'This competition is finished; its results are final');
/**
 * Matches and scores have one source (migration 0125). A finished competition
 * is final; a mirrored one takes them only from its mirror job (OSE-2240), so a
 * host's write would fight the sheet and is refused.
 */
function closedToHost(request: Request, c: CompetitionRow): Response | null {
  if (c.status === 'finished') return finished(request);
  if (c.source === 'mirrored')
    return fail(
      request,
      409,
      'COMPETITION_MIRRORED',
      'This competition is copied from its own sheet; change it there'
    );
  return null;
}
const labelTaken = (request: Request) =>
  fail(request, 409, 'DUPLICATE_LABEL', 'Another team in this competition has that name');

const isUniqueClash = (err: unknown) => /UNIQUE constraint failed/i.test(String(err));

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return { ok: false };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function guarded(
  request: Request,
  handler: string,
  work: () => Promise<Response>
): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueClash(err)) return labelTaken(request);
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return fail(request, 503, 'DB_ERROR', 'The competition could not be saved');
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function readCompetition(db: D1Database, id: string): Promise<CompetitionRow | null> {
  return db
    .prepare(`SELECT ${COMPETITION_SELECT} FROM competitions WHERE id = ?`)
    .bind(id)
    .first<CompetitionRow>();
}

export async function readEntries(db: D1Database, competitionId: string): Promise<EntryRow[]> {
  const rs = await db
    .prepare(
      `SELECT ${ENTRY_SELECT} FROM competition_entries
        WHERE competition_id = ?
        ORDER BY is_active DESC, seed ASC, created_at ASC, id ASC`
    )
    .bind(competitionId)
    .all<EntryRow>();
  return rs.results ?? [];
}

export type FixtureWithResult = FixtureRow & {
  score_a: number | null;
  score_b: number | null;
  state: ResultRow['state'] | null;
  entered_by: ResultRow['entered_by'] | null;
  evidence_key: string | null;
};

export async function readFixtures(
  db: D1Database,
  competitionId: string
): Promise<FixtureWithResult[]> {
  const rs = await db
    .prepare(
      `SELECT ${FIXTURE_COLUMNS.map((c) => `f.${c}`).join(', ')},
              r.score_a, r.score_b, r.state, r.entered_by, r.evidence_key
         FROM fixtures f
         LEFT JOIN fixture_results r ON r.fixture_id = f.id
        WHERE f.competition_id = ?
        ORDER BY f.round ASC, f.slot_time ASC, f.slot_label ASC, f.created_at ASC, f.id ASC`
    )
    .bind(competitionId)
    .all<FixtureWithResult>();
  return rs.results ?? [];
}

function resultOf(f: FixtureWithResult): ResultRow | null {
  if (f.score_a === null || f.score_b === null || f.state === null) return null;
  return {
    fixture_id: f.id,
    score_a: f.score_a,
    score_b: f.score_b,
    state: f.state,
    entered_by: f.entered_by ?? 'host',
    evidence_key: null,
    updated_at: f.updated_at,
  };
}

async function entryOf(db: D1Database, entryId: string, competitionId: string) {
  return db
    .prepare(`SELECT ${ENTRY_SELECT} FROM competition_entries WHERE id = ? AND competition_id = ?`)
    .bind(entryId, competitionId)
    .first<EntryRow>();
}

async function fixtureOf(db: D1Database, fixtureId: string, competitionId: string) {
  return db
    .prepare(`SELECT ${FIXTURE_SELECT} FROM fixtures WHERE id = ? AND competition_id = ?`)
    .bind(fixtureId, competitionId)
    .first<FixtureRow>();
}

async function resultRow(db: D1Database, fixtureId: string): Promise<ResultRow | null> {
  return db
    .prepare(`SELECT ${RESULT_SELECT} FROM fixture_results r WHERE r.fixture_id = ?`)
    .bind(fixtureId)
    .first<ResultRow>();
}

async function stageOf(db: D1Database, competitionId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM competition_stages WHERE competition_id = ? ORDER BY sort ASC LIMIT 1`)
    .bind(competitionId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Is this event a night the competition may be played on? Same brand, and in
 * the public brand the same organizer. Anything else is the same refusal, so a
 * caller learns nothing about an event outside their reach.
 */
async function nightAllowed(
  db: D1Database,
  competition: CompetitionRow,
  eventId: string
): Promise<boolean> {
  const sameMaker = competition.brand_id === PUBLIC_BRAND_ID;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM events WHERE id = ? AND brand_id = ?${sameMaker ? ' AND created_by IS ?' : ''}`
    )
    .bind(eventId, competition.brand_id, ...(sameMaker ? [competition.created_by] : []))
    .first();
  return !!row;
}

const badNight = (request: Request) =>
  fail(
    request,
    400,
    'INVALID_EVENT',
    'A match is played on an event night of the same brand; that event cannot be used'
  );

async function entriesBelong(
  db: D1Database,
  competitionId: string,
  ids: string[]
): Promise<boolean> {
  for (const id of ids) if (!(await entryOf(db, id, competitionId))) return false;
  return true;
}

/** The whole picture the admin works from: teams, matches, scores, table. */
async function detail(db: D1Database, competition: CompetitionRow) {
  const entries = await readEntries(db, competition.id);
  const fixtures = await readFixtures(db, competition.id);
  return {
    competition: projectCompetition(competition),
    entries: entries.map(projectEntry),
    fixtures: fixtures.map((f) => projectFixture(f, resultOf(f))),
    standings: computeStandings(entries, fixtures, rulesetOf(competition.ruleset)),
  };
}

async function loaded(
  request: Request,
  env: CompetitionsEnv,
  id: string,
  work: (db: D1Database, c: CompetitionRow) => Promise<Response>,
  handler: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, handler, async () => {
    const c = await readCompetition(db, id);
    if (!c) return noCompetition(request, id);
    return work(db, c);
  });
}

// ─── Collection ───────────────────────────────────────────────────────────────

export async function handleListCompetitions(
  request: Request,
  env: CompetitionsEnv
): Promise<Response> {
  const db = env.DB;
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (!db || scope.mode === 'deny') return reply(request, 200, { items: [] });
  const own = ownerAndSql(await resolveOwnerRule(request, env, scope), 'brand_id', 'created_by');
  const where =
    scope.mode === 'scoped'
      ? `WHERE brand_id IN (${scope.brandIds.map(() => '?').join(', ')})${own.sql}`
      : '';
  const params = scope.mode === 'scoped' ? [...scope.brandIds, ...own.binds] : [];
  return guarded(request, 'handleListCompetitions', async () => {
    const rs = await db
      .prepare(
        `SELECT ${COMPETITION_SELECT} FROM competitions ${where}
          ORDER BY created_at DESC, id LIMIT ${LIST_MAX}`
      )
      .bind(...params)
      .all<CompetitionRow>();
    return reply(request, 200, { items: (rs.results ?? []).map(projectCompetition) });
  });
}

export async function handleCreateCompetition(
  request: Request,
  env: CompetitionsEnv
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const json = await readJson(request);
  if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
  const input = parseCompetitionCreate(json.body);
  if (!input.ok) return fail(request, 400, input.code, input.error);

  // The brand comes from the server-verified caller: a scoped caller may name
  // only a brand they are a member of, as for a campaign.
  const actor = extractAdminActor(request, env);
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'deny')
    return fail(request, 403, 'BRAND_FORBIDDEN', 'Your admin account is not a member of any brand');
  const requested = input.value.brand_id;
  if (scope.mode === 'scoped' && requested && !scope.brandIds.includes(requested))
    return fail(request, 403, 'BRAND_FORBIDDEN', `Not entitled to brand_id "${requested}"`);
  const brandId = requested || (scope.mode === 'scoped' ? scope.brandIds[0] : PUBLIC_BRAND_ID);

  return guarded(request, 'handleCreateCompetition', async () => {
    const id = newCompetitionId();
    const now = new Date().toISOString();
    const v = input.value;
    await db.batch([
      db
        .prepare(
          `INSERT INTO competitions
             (id, brand_id, created_by, name, sport, format, status, starts_on, ends_on, ruleset, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          brandId,
          actor,
          v.name,
          v.sport,
          v.format,
          v.starts_on,
          v.ends_on,
          v.ruleset,
          now,
          now
        ),
      // Phase 1: one round-robin stage. Brackets come as a second stage later.
      db
        .prepare(
          `INSERT INTO competition_stages (id, competition_id, kind, sort, created_at)
           VALUES (?, ?, 'round_robin', 0, ?)`
        )
        .bind(newStageId(), id, now),
    ]);
    const made = await readCompetition(db, id);
    if (!made) return fail(request, 503, 'DB_ERROR', 'The competition could not be saved');
    return reply(request, 201, { id, competition: projectCompetition(made) });
  });
}

// ─── One competition ──────────────────────────────────────────────────────────

export function handleGetCompetition(request: Request, env: CompetitionsEnv, id: string) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => reply(request, 200, await detail(db, c)),
    'handleGetCompetition'
  );
}

export function handleUpdateCompetition(request: Request, env: CompetitionsEnv, id: string) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseCompetitionUpdate(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      if (c.status === 'finished') return finished(request);
      const p = input.value;
      const starts = p.starts_on !== undefined ? p.starts_on : c.starts_on;
      const ends = p.ends_on !== undefined ? p.ends_on : c.ends_on;
      if (starts && ends && ends < starts)
        return fail(request, 400, 'INVALID_DATE', 'ends_on must not be before starts_on');
      if (p.ruleset !== undefined && rulesetOf(p.ruleset).draw === null) {
        const draw = await db
          .prepare(
            `SELECT 1 FROM fixture_results r JOIN fixtures f ON f.id = r.fixture_id
              WHERE f.competition_id = ? AND r.score_a = r.score_b LIMIT 1`
          )
          .bind(c.id)
          .first();
        if (draw)
          return fail(
            request,
            409,
            'DRAW_NOT_ALLOWED',
            'A drawn result exists; that ruleset has no draws'
          );
      }
      const sets: string[] = [];
      const values: (string | null)[] = [];
      const set = (column: string, value: string | null) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (p.name !== undefined) set('name', p.name);
      if (p.sport !== undefined) set('sport', p.sport);
      if (p.status !== undefined) set('status', p.status);
      if (p.starts_on !== undefined) set('starts_on', p.starts_on);
      if (p.ends_on !== undefined) set('ends_on', p.ends_on);
      if (p.ruleset !== undefined) set('ruleset', p.ruleset);
      set('updated_at', new Date().toISOString());
      const statements = [
        db.prepare(`UPDATE competitions SET ${sets.join(', ')} WHERE id = ?`).bind(...values, c.id),
      ];
      // Finishing makes every score final, for good.
      if (p.status === 'finished')
        statements.push(
          db
            .prepare(
              `UPDATE fixture_results SET state = 'final', updated_at = ?
                WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)`
            )
            .bind(new Date().toISOString(), c.id)
        );
      await db.batch(statements);
      const saved = await readCompetition(db, c.id);
      return reply(request, 200, { competition: projectCompetition(saved ?? c) });
    },
    'handleUpdateCompetition'
  );
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export function handleCreateEntry(request: Request, env: CompetitionsEnv, id: string) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseEntryCreate(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      const n = await db
        .prepare(`SELECT COUNT(*) AS n FROM competition_entries WHERE competition_id = ?`)
        .bind(c.id)
        .first<{ n: number }>();
      if ((n?.n ?? 0) >= ENTRIES_MAX)
        return fail(
          request,
          409,
          'TOO_MANY_ENTRIES',
          `A competition holds at most ${ENTRIES_MAX} teams`
        );
      const taken = await db
        .prepare(`SELECT 1 FROM competition_entries WHERE competition_id = ? AND label = ?`)
        .bind(c.id, input.value.label)
        .first();
      if (taken) return labelTaken(request);
      const entryId = newEntryId();
      const now = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO competition_entries (id, competition_id, label, seed, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(entryId, c.id, input.value.label, input.value.seed, now, now)
        .run();
      const made = await entryOf(db, entryId, c.id);
      if (!made) return fail(request, 503, 'DB_ERROR', 'The team entry could not be saved');
      return reply(request, 201, { id: entryId, entry: projectEntry(made) });
    },
    'handleCreateEntry'
  );
}

export function handleUpdateEntry(
  request: Request,
  env: CompetitionsEnv,
  id: string,
  rawEntryId: string
) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseEntryUpdate(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const entryId = parseId(rawEntryId);
      const entry = entryId ? await entryOf(db, entryId, c.id) : null;
      if (!entry) return noEntry(request);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      const p = input.value;
      if (p.label !== undefined) {
        const taken = await db
          .prepare(
            `SELECT 1 FROM competition_entries WHERE competition_id = ? AND label = ? AND id <> ?`
          )
          .bind(c.id, p.label, entry.id)
          .first();
        if (taken) return labelTaken(request);
      }
      const sets: string[] = [];
      const values: (string | number)[] = [];
      const set = (column: string, value: string | number) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (p.label !== undefined) set('label', p.label);
      if (p.seed !== undefined) set('seed', p.seed);
      if (p.is_active !== undefined) set('is_active', p.is_active ? 1 : 0);
      set('updated_at', new Date().toISOString());
      await db
        .prepare(
          `UPDATE competition_entries SET ${sets.join(', ')} WHERE id = ? AND competition_id = ?`
        )
        .bind(...values, entry.id, c.id)
        .run();
      const saved = await entryOf(db, entry.id, c.id);
      return reply(request, 200, { entry: projectEntry(saved ?? entry) });
    },
    'handleUpdateEntry'
  );
}

// ─── Schedule (OSE-526) ───────────────────────────────────────────────────────

/**
 * POST …/schedule: the round robin for the teams in play, by seed. A round
 * that already holds a score is kept as it is; every other round is made
 * again. Round r is played on event_ids[r-1] when the list has one, else it has
 * no night yet. Courts and times are handed out in turn within each night.
 */
export function handleGenerateSchedule(request: Request, env: CompetitionsEnv, id: string) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseSchedule(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      for (const ev of new Set(input.value.event_ids))
        if (!(await nightAllowed(db, c, ev))) return badNight(request);
      const stageId = await stageOf(db, c.id);
      if (!stageId) return fail(request, 503, 'DB_ERROR', 'The competition has no stage');

      const teams = (await readEntries(db, c.id)).filter((e) => e.is_active === 1);
      if (teams.length < 2)
        return fail(request, 409, 'TOO_FEW_ENTRIES', 'A round robin needs at least two teams');
      const fixtures = await readFixtures(db, c.id);
      const locked = new Set(fixtures.filter((f) => f.state !== null).map((f) => f.round));

      const pairings = roundRobin(teams.map((t) => t.id)).filter((p) => !locked.has(p.round));
      const now = new Date().toISOString();
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `DELETE FROM fixtures WHERE competition_id = ?
               AND id NOT IN (SELECT fixture_id FROM fixture_results)
               AND round NOT IN (SELECT round FROM fixtures f JOIN fixture_results r ON r.fixture_id = f.id
                                  WHERE f.competition_id = ?)`
          )
          .bind(c.id, c.id),
      ];
      const indexInRound = new Map<number, number>();
      for (const p of pairings) {
        const i = indexInRound.get(p.round) ?? 0;
        indexInRound.set(p.round, i + 1);
        const where = slotFor(i, input.value);
        statements.push(
          db
            .prepare(
              `INSERT INTO fixtures
                 (id, competition_id, stage_id, event_id, round, slot_label, slot_time, entry_a, entry_b, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
            )
            .bind(
              newFixtureId(),
              c.id,
              stageId,
              input.value.event_ids[p.round - 1] ?? null,
              p.round,
              where.slot_label,
              where.slot_time,
              p.a,
              p.b,
              now,
              now
            )
        );
      }
      await db.batch(statements);
      return reply(request, 200, {
        rounds_kept: [...locked].sort((a, b) => a - b),
        ...(await detail(db, c)),
      });
    },
    'handleGenerateSchedule'
  );
}

// ─── Fixtures: manual override ────────────────────────────────────────────────

export function handleCreateFixture(request: Request, env: CompetitionsEnv, id: string) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseFixtureCreate(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      const v = input.value;
      if (!(await entriesBelong(db, c.id, [v.entry_a, v.entry_b]))) return noEntry(request);
      if (v.event_id && !(await nightAllowed(db, c, v.event_id))) return badNight(request);
      const stageId = await stageOf(db, c.id);
      if (!stageId) return fail(request, 503, 'DB_ERROR', 'The competition has no stage');
      const fixtureId = newFixtureId();
      const now = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO fixtures
             (id, competition_id, stage_id, event_id, round, slot_label, slot_time, entry_a, entry_b, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
        )
        .bind(
          fixtureId,
          c.id,
          stageId,
          v.event_id,
          v.round,
          v.slot_label,
          v.slot_time,
          v.entry_a,
          v.entry_b,
          now,
          now
        )
        .run();
      const made = await fixtureOf(db, fixtureId, c.id);
      if (!made) return fail(request, 503, 'DB_ERROR', 'The match could not be saved');
      return reply(request, 201, { id: fixtureId, fixture: projectFixture(made, null) });
    },
    'handleCreateFixture'
  );
}

export function handleUpdateFixture(
  request: Request,
  env: CompetitionsEnv,
  id: string,
  rawFixtureId: string
) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseFixtureUpdate(json.body);
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const fixtureId = parseId(rawFixtureId);
      const fixture = fixtureId ? await fixtureOf(db, fixtureId, c.id) : null;
      if (!fixture) return noFixture(request);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      const p = input.value;
      const result = await resultRow(db, fixture.id);
      // A scored match keeps its teams and round; take the score back first.
      if (
        result &&
        (p.entry_a !== undefined ||
          p.entry_b !== undefined ||
          p.round !== undefined ||
          p.status !== undefined)
      )
        return fail(
          request,
          409,
          'FIXTURE_HAS_RESULT',
          'This match has a score; take the score back first'
        );
      const a = p.entry_a ?? fixture.entry_a;
      const b = p.entry_b ?? fixture.entry_b;
      if (a === b) return fail(request, 400, 'SAME_ENTRY', 'A team cannot play itself');
      if (!(await entriesBelong(db, c.id, [a, b]))) return noEntry(request);
      if (p.event_id && !(await nightAllowed(db, c, p.event_id))) return badNight(request);

      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (p.round !== undefined) set('round', p.round);
      if (p.entry_a !== undefined) set('entry_a', p.entry_a);
      if (p.entry_b !== undefined) set('entry_b', p.entry_b);
      if (p.event_id !== undefined) set('event_id', p.event_id);
      if (p.slot_label !== undefined) set('slot_label', p.slot_label);
      if (p.slot_time !== undefined) set('slot_time', p.slot_time);
      if (p.status !== undefined) set('status', p.status);
      set('updated_at', new Date().toISOString());
      await db
        .prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE id = ? AND competition_id = ?`)
        .bind(...values, fixture.id, c.id)
        .run();
      const saved = await fixtureOf(db, fixture.id, c.id);
      return reply(request, 200, { fixture: projectFixture(saved ?? fixture, result) });
    },
    'handleUpdateFixture'
  );
}

// ─── Results (OSE-529) ────────────────────────────────────────────────────────

/**
 * The one way a score is written, for the host's route here and for the sheet
 * mirror and the referee screen later. Confirmed at once; a final score is never
 * overwritten. The fixture becomes `played` in the same batch.
 */
export async function writeResult(
  db: D1Database,
  competitionId: string,
  fixtureId: string,
  score: { score_a: number; score_b: number },
  enteredBy: 'host' | 'referee'
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO fixture_results (fixture_id, score_a, score_b, state, entered_by, updated_at)
         VALUES (?, ?, ?, 'confirmed', ?, ?)
         ON CONFLICT(fixture_id) DO UPDATE SET
           score_a = excluded.score_a, score_b = excluded.score_b,
           state = 'confirmed', entered_by = excluded.entered_by, updated_at = excluded.updated_at
         WHERE fixture_results.state <> 'final'`
      )
      .bind(fixtureId, score.score_a, score.score_b, enteredBy, now),
    db
      .prepare(
        `UPDATE fixtures SET status = 'played', updated_at = ? WHERE id = ? AND competition_id = ?`
      )
      .bind(now, fixtureId, competitionId),
  ]);
}

/**
 * PUT …/result: the host's score. It is confirmed at once and counts in the
 * table on the next read: a score is not a count of people, so nothing holds it
 * back. A final score (the competition is finished) cannot change.
 */
export function handlePutResult(
  request: Request,
  env: CompetitionsEnv,
  id: string,
  rawFixtureId: string
) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const json = await readJson(request);
      if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
      const input = parseResult(json.body, rulesetOf(c.ruleset));
      if (!input.ok) return fail(request, 400, input.code, input.error);
      const fixtureId = parseId(rawFixtureId);
      const fixture = fixtureId ? await fixtureOf(db, fixtureId, c.id) : null;
      if (!fixture) return noFixture(request);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      if (c.status === 'draft')
        return fail(
          request,
          409,
          'COMPETITION_DRAFT',
          'Start the competition before entering scores'
        );
      await writeResult(db, c.id, fixture.id, input.value, 'host');
      const saved = await fixtureOf(db, fixture.id, c.id);
      return reply(request, 200, {
        fixture: projectFixture(saved ?? fixture, await resultRow(db, fixture.id)),
      });
    },
    'handlePutResult'
  );
}

export function handleDeleteResult(
  request: Request,
  env: CompetitionsEnv,
  id: string,
  rawFixtureId: string
) {
  return loaded(
    request,
    env,
    id,
    async (db, c) => {
      const fixtureId = parseId(rawFixtureId);
      const fixture = fixtureId ? await fixtureOf(db, fixtureId, c.id) : null;
      if (!fixture) return noFixture(request);
      const shut = closedToHost(request, c);
      if (shut) return shut;
      const now = new Date().toISOString();
      await db.batch([
        db
          .prepare(`DELETE FROM fixture_results WHERE fixture_id = ? AND state <> 'final'`)
          .bind(fixture.id),
        db
          .prepare(
            `UPDATE fixtures SET status = 'scheduled', updated_at = ?
              WHERE id = ? AND competition_id = ? AND status = 'played'`
          )
          .bind(now, fixture.id, c.id),
      ]);
      const saved = await fixtureOf(db, fixture.id, c.id);
      return reply(request, 200, { fixture: projectFixture(saved ?? fixture, null) });
    },
    'handleDeleteResult'
  );
}
