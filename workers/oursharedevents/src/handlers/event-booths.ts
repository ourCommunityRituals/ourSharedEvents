/**
 * A booth is part of a fair (OSE-1998, OSE ADR-034 decision 1): the admin API.
 *
 *   GET    /api/v2/admin/events/:id/booths            the event's booths, active first
 *   POST   /api/v2/admin/events/:id/booths            add one booth
 *   POST   /api/v2/admin/events/:id/booths/bulk       add many, all or nothing
 *   PUT    /api/v2/admin/events/:id/booths/:boothId   change one booth
 *   DELETE /api/v2/admin/events/:id/booths/:boothId   take it out of use (soft)
 *
 * THE BRAND WALL HAS TWO HALVES, as for a declared series (handlers/event-series.ts).
 *   1. The event in the path. Every route here is under /api/v2/admin/events/:id,
 *      so the router's guardAdminObjectScope has already proved that event is in
 *      the caller's brand scope, and the admin write guard has checked every
 *      write's origin and body type.
 *   2. The booth in the path. `event_booths` has no brand column: a booth's brand
 *      is its event's. So a booth is read with the path event as a bound
 *      predicate (`WHERE id = ? AND event_id = ?`), and every UPDATE repeats it.
 *      A booth of another event, of another brand, or of no event at all answers
 *      the same 404 with the same body. This half holds for a key actor too.
 *
 * A BOOTH IS NEVER REMOVED. DELETE sets is_active = 0. A placement that points at
 * the booth keeps pointing at it, so its scans keep their booth; a booth with no
 * placement is kept the same way, so one rule covers both.
 *
 * NEVER WHO. This file reads `events` (to find the event) and reads and writes
 * `event_booths`, and reads `poster_deployments` only to say how many codes a
 * deactivated booth keeps. No people table, no FORMS_DB, no count of anyone.
 */

import { passportOnSql } from '../lib/event-settings';
import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';
import {
  BOOTH_COLUMNS,
  parseBoothBulk,
  parseBoothCreate,
  parseBoothId,
  parseBoothUpdate,
  projectBooth,
  type BoothInput,
  type BoothRow,
} from '../lib/event-booths';

export interface EventBoothsEnv {
  DB?: D1Database;
}

const BOOTH_SELECT = BOOTH_COLUMNS.join(', ');

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
const noEvent = (request: Request, id: string) =>
  fail(request, 404, 'NOT_FOUND', `Event not found: ${id}`);
/** One body for "not this event's", "not your brand's" and "does not exist". */
const noBooth = (request: Request) => fail(request, 404, 'BOOTH_NOT_FOUND', 'Booth not found');
const numberTaken = (request: Request) =>
  fail(
    request,
    409,
    'DUPLICATE_NUMBER',
    'Another booth of this event has that number (a booth out of use keeps its number)'
  );

const isUniqueClash = (err: unknown) => /UNIQUE constraint failed/i.test(String(err));

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
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
    if (isUniqueClash(err)) return numberTaken(request);
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return fail(request, 503, 'DB_ERROR', 'The booth could not be saved');
  }
}

async function eventExists(db: D1Database, id: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS hit FROM events WHERE id = ?`).bind(id).first());
}

/** A booth, only when it belongs to `eventId`. Brand follows from the event. */
async function boothOfEvent(
  db: D1Database,
  boothId: string,
  eventId: string
): Promise<BoothRow | null> {
  return db
    .prepare(`SELECT ${BOOTH_SELECT} FROM event_booths WHERE id = ? AND event_id = ?`)
    .bind(boothId, eventId)
    .first<BoothRow>();
}

/**
 * The id of an ACTIVE booth of `eventId`, or null. Poster deployments use this
 * to accept a `booth_id`: a booth of another event (so of any other brand) or a
 * booth out of use is the same miss.
 */
export async function activeBoothOfEvent(
  db: D1Database,
  boothId: string,
  eventId: string
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM event_booths WHERE id = ? AND event_id = ? AND is_active = 1`)
    .bind(boothId, eventId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Is `number` used by another booth of the event? NOCASE: "a12" is "A12". */
async function numberInUse(
  db: D1Database,
  eventId: string,
  number: string,
  exceptId: string | null
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM event_booths WHERE event_id = ? AND number = ? AND id IS NOT ? LIMIT 1`
    )
    .bind(eventId, number, exceptId)
    .first();
  return !!row;
}

function insertStatement(
  db: D1Database,
  id: string,
  eventId: string,
  input: BoothInput,
  now: string
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO event_booths
         (id, event_id, number, name, category, hall_x, hall_y, is_active, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .bind(
      id,
      eventId,
      input.number,
      input.name,
      input.category,
      input.hall_x,
      input.hall_y,
      input.sort,
      now,
      now
    );
}

const newBoothId = () => `booth_${crypto.randomUUID().replace(/-/g, '')}`;

/** GET: every booth of the event, in use first, then by sort, then by number. */
export async function handleListEventBooths(
  request: Request,
  env: EventBoothsEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleListEventBooths', async () => {
    if (!(await eventExists(db, eventId))) return noEvent(request, eventId);
    const rows = await db
      .prepare(
        `SELECT ${BOOTH_SELECT} FROM event_booths
          WHERE event_id = ?
          ORDER BY is_active DESC, sort ASC, number ASC, id ASC`
      )
      .bind(eventId)
      .all<BoothRow>();
    // Stamp passport (lib/passport.ts): the Stalls card shows the switch.
    const pass = await db
      .prepare(`SELECT ${passportOnSql()} AS on_ FROM events WHERE id = ?`)
      .bind(eventId)
      .first<{ on_: number | null }>();
    return reply(request, 200, {
      event_id: eventId,
      booths: (rows.results ?? []).map(projectBooth),
      passport: pass?.on_ === 1,
    });
  });
}

/** POST: add one booth to the event. */
export async function handleCreateEventBooth(
  request: Request,
  env: EventBoothsEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const json = await readJson(request);
  if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
  const input = parseBoothCreate(json.body);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleCreateEventBooth', async () => {
    if (!(await eventExists(db, eventId))) return noEvent(request, eventId);
    if (await numberInUse(db, eventId, input.value.number, null)) return numberTaken(request);
    const id = newBoothId();
    await insertStatement(db, id, eventId, input.value, new Date().toISOString()).run();
    const made = await boothOfEvent(db, id, eventId);
    if (!made) return fail(request, 503, 'DB_ERROR', 'The booth could not be saved');
    return reply(request, 201, { id, booth: projectBooth(made) });
  });
}

/**
 * POST …/bulk: add many booths at once, all or nothing. A list with any refused
 * row saves nothing and names every refused row (its index, number and reason).
 * One D1 batch is one transaction, so a clash found only at INSERT time rolls
 * the whole list back too.
 */
export async function handleBulkCreateEventBooths(
  request: Request,
  env: EventBoothsEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const json = await readJson(request);
  if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
  const input = parseBoothBulk(json.body);
  if (!input.ok)
    return reply(request, 400, {
      code: input.code,
      error: input.error,
      ...(input.failed ? { failed: input.failed, created: 0 } : {}),
    });
  return guarded(request, 'handleBulkCreateEventBooths', async () => {
    if (!(await eventExists(db, eventId))) return noEvent(request, eventId);
    const existing = await db
      .prepare(`SELECT number FROM event_booths WHERE event_id = ?`)
      .bind(eventId)
      .all<{ number: string }>();
    const taken = new Set((existing.results ?? []).map((r) => r.number.toLowerCase()));
    const failed = input.value
      .map((booth, index) => ({ booth, index }))
      .filter(({ booth }) => taken.has(booth.number.toLowerCase()))
      .map(({ booth, index }) => ({
        index,
        number: booth.number,
        code: 'DUPLICATE_NUMBER',
        error: 'A booth of this event already has this number',
      }));
    if (failed.length > 0)
      return reply(request, 409, {
        code: 'BOOTHS_REFUSED',
        error: `${failed.length} of ${input.value.length} booths were refused; nothing was saved`,
        failed,
        created: 0,
      });

    const now = new Date().toISOString();
    const ids = input.value.map(() => newBoothId());
    await db.batch(input.value.map((booth, i) => insertStatement(db, ids[i], eventId, booth, now)));
    // Read back by event, then keep this request's ids: 200 ids would pass D1's
    // limit of 100 bound values in one IN list.
    const rows = await db
      .prepare(
        `SELECT ${BOOTH_SELECT} FROM event_booths
          WHERE event_id = ?
          ORDER BY sort ASC, number ASC, id ASC`
      )
      .bind(eventId)
      .all<BoothRow>();
    const mine = new Set(ids);
    const made = (rows.results ?? []).filter((r) => mine.has(r.id)).map(projectBooth);
    return reply(request, 201, { event_id: eventId, created: made.length, booths: made });
  });
}

/** PUT …/:boothId: change what the body names, on a booth of this event only. */
export async function handleUpdateEventBooth(
  request: Request,
  env: EventBoothsEnv,
  eventId: string,
  rawBoothId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const boothId = parseBoothId(rawBoothId);
  const json = await readJson(request);
  if (!json.ok) return fail(request, 400, 'INVALID_BODY', 'Send a JSON object');
  const input = parseBoothUpdate(json.body);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleUpdateEventBooth', async () => {
    if (!(await eventExists(db, eventId))) return noEvent(request, eventId);
    const booth = boothId ? await boothOfEvent(db, boothId, eventId) : null;
    if (!booth) return noBooth(request);
    const patch = input.value;
    if (patch.number !== undefined && (await numberInUse(db, eventId, patch.number, booth.id)))
      return numberTaken(request);

    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.number !== undefined) set('number', patch.number);
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.category !== undefined) set('category', patch.category);
    if (patch.hall_x !== undefined) set('hall_x', patch.hall_x);
    if (patch.hall_y !== undefined) set('hall_y', patch.hall_y);
    if (patch.sort !== undefined) set('sort', patch.sort);
    if (patch.is_active !== undefined) set('is_active', patch.is_active ? 1 : 0);
    set('updated_at', new Date().toISOString());
    await db
      .prepare(`UPDATE event_booths SET ${sets.join(', ')} WHERE id = ? AND event_id = ?`)
      .bind(...values, booth.id, eventId)
      .run();
    const saved = await boothOfEvent(db, booth.id, eventId);
    return reply(request, 200, { booth: projectBooth(saved ?? booth) });
  });
}

/**
 * DELETE …/:boothId: take the booth out of use. Never a row delete: the booth
 * and every placement that points at it stay, so past scans keep their booth.
 */
export async function handleDeactivateEventBooth(
  request: Request,
  env: EventBoothsEnv,
  eventId: string,
  rawBoothId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const boothId = parseBoothId(rawBoothId);
  return guarded(request, 'handleDeactivateEventBooth', async () => {
    if (!(await eventExists(db, eventId))) return noEvent(request, eventId);
    const booth = boothId ? await boothOfEvent(db, boothId, eventId) : null;
    if (!booth) return noBooth(request);
    await db
      .prepare(
        `UPDATE event_booths SET is_active = 0, updated_at = ? WHERE id = ? AND event_id = ?`
      )
      .bind(new Date().toISOString(), booth.id, eventId)
      .run();
    const kept = await db
      .prepare(`SELECT COUNT(*) AS n FROM poster_deployments WHERE booth_id = ? AND event_id = ?`)
      .bind(booth.id, eventId)
      .first<{ n: number }>();
    const saved = await boothOfEvent(db, booth.id, eventId);
    return reply(request, 200, {
      booth: projectBooth(saved ?? booth),
      placements_kept: kept?.n ?? 0,
    });
  });
}
