/**
 * A series an organizer declares (OSE ADR-028).
 *
 *   GET    /api/v2/admin/events/:id/series          the event's series + the brand's suggestions
 *   POST   /api/v2/admin/events/:id/series          declare a series anchored on this event
 *   PUT    /api/v2/admin/events/:id/series          attach this event to a confirmed series
 *   DELETE /api/v2/admin/events/:id/series          detach it
 *   POST   /api/v2/admin/events/:id/series/confirm  accept a detector suggestion
 *   POST   /api/v2/admin/events/:id/series/reject   turn one down
 *
 * THE ANCHOR IS AN EVENT. `event_series.venue_id` has always held an event id
 * (migration 0033), so a series needs no venue: an online programme declares
 * one on its first event. Promoting a trial is the same call: declare on one of
 * its tries and list the earlier ones in `event_ids`.
 *
 * THE BRAND WALL HAS TWO HALVES.
 *   1. The event in the path. Every route here is under /api/v2/admin/events/:id,
 *      so the router's guardAdminObjectScope has already proved that event is in
 *      the caller's brand scope.
 *   2. Everything the body names. `event_series` has no brand column: a series'
 *      brand is its anchor event's brand (owner ruling 2026-10-01, OSE-1421). So
 *      a series id and every event id in a body are read with the path event's
 *      brand as a bound predicate, and the attach UPDATE repeats it. This half is
 *      about the data, not the caller, so it holds for a key actor too.
 *   A miss on either half is 404, the same for "not yours" and "does not exist".
 *
 * NEVER WHO. This file reads and writes two tables, `events` and `event_series`,
 * and no people table. It writes one column of `events` (`series_id`) and
 * nothing else: not a date, not a count, not `updated_at`. Gate:
 * tests/event-series.spec.ts.
 */

import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';
import {
  parseAttach,
  parseConfirm,
  parseDeclare,
  parseReject,
  projectSeries,
  type Parsed,
  type SeriesRow,
} from '../lib/event-series';

export interface EventSeriesEnv {
  DB?: D1Database;
}

const SERIES_SELECT = `es.id, es.venue_id, es.series_name, es.cadence, es.day_of_week,
  es.hour_of_day, es.state, es.detected_at, es.confirmed_at, es.rejected_reason`;

interface EventRef {
  id: string;
  brand_id: string;
  series_id: string | null;
}

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

async function readBody<T>(
  request: Request,
  parse: (body: unknown) => Parsed<T>
): Promise<Parsed<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, code: 'INVALID_BODY', error: 'Send a JSON object' };
  }
  return parse(body);
}

async function eventRef(db: D1Database, id: string): Promise<EventRef | null> {
  return db
    .prepare(`SELECT id, brand_id, series_id FROM events WHERE id = ?`)
    .bind(id)
    .first<EventRef>();
}

/** A series, only when its anchor event belongs to `brandId`. */
async function seriesInBrand(
  db: D1Database,
  seriesId: string,
  brandId: string
): Promise<SeriesRow | null> {
  return db
    .prepare(
      `SELECT ${SERIES_SELECT}
         FROM event_series es
         JOIN events anchor ON anchor.id = es.venue_id
        WHERE es.id = ? AND anchor.brand_id = ?`
    )
    .bind(seriesId, brandId)
    .first<SeriesRow>();
}

/**
 * The events `ids` names, only those of `brandId`. A caller compares the count:
 * one missing means an id is unknown or another brand's, and the whole request
 * is refused without saying which.
 */
async function eventsInBrand(db: D1Database, ids: string[], brandId: string): Promise<EventRef[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const rows = await db
    .prepare(`SELECT id, brand_id, series_id FROM events WHERE id IN (${marks}) AND brand_id = ?`)
    .bind(...ids, brandId)
    .all<EventRef>();
  return rows.results ?? [];
}

/** Sets `series_id` and nothing else, on events of one brand that the guard allows. */
function attachStatement(
  db: D1Database,
  seriesId: string,
  ids: string[],
  brandId: string,
  onlyFrom: 'unattached' | 'any'
): D1PreparedStatement {
  const marks = ids.map(() => '?').join(', ');
  const free = onlyFrom === 'unattached' ? ' AND series_id IS NULL' : '';
  return db
    .prepare(`UPDATE events SET series_id = ? WHERE id IN (${marks}) AND brand_id = ?${free}`)
    .bind(seriesId, ...ids, brandId);
}

async function guarded(
  request: Request,
  handler: string,
  work: () => Promise<Response>
): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'DB_ERROR',
        handler,
        error: errorLabel(err),
        timestamp: new Date().toISOString(),
      })
    );
    return fail(request, 503, 'DB_ERROR', 'The series could not be saved');
  }
}

const noDb = (request: Request) =>
  fail(request, 503, 'DB_NOT_CONFIGURED', 'Database not available');
const noEvent = (request: Request, id: string) =>
  fail(request, 404, 'NOT_FOUND', `Event not found: ${id}`);
const noSeries = (request: Request) => fail(request, 404, 'SERIES_NOT_FOUND', 'Series not found');
const noAttachTarget = (request: Request) =>
  fail(request, 404, 'EVENT_NOT_FOUND', 'An event to attach was not found');
const taken = (request: Request) =>
  fail(request, 409, 'ALREADY_IN_SERIES', 'An event is already part of a series; detach it first');

/** GET: the event's own series, and the suggestions waiting in its brand. */
export async function handleGetEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleGetEventSeries', async () => {
    const event = await eventRef(db, eventId);
    if (!event) return noEvent(request, eventId);
    const own = event.series_id ? await seriesInBrand(db, event.series_id, event.brand_id) : null;
    const pending = await db
      .prepare(
        `SELECT ${SERIES_SELECT}
           FROM event_series es
           JOIN events anchor ON anchor.id = es.venue_id
          WHERE es.state = 'pending' AND anchor.brand_id = ?
          ORDER BY es.detected_at DESC, es.id
          LIMIT 100`
      )
      .bind(event.brand_id)
      .all<SeriesRow>();
    return reply(request, 200, {
      event_id: event.id,
      series: own ? projectSeries(own) : null,
      suggestions: (pending.results ?? []).map(projectSeries),
    });
  });
}

/**
 * POST: declare a series anchored on this event. It is `confirmed` at once: an
 * organizer said so, which is what confirming a suggestion means too. The
 * anchor joins it, with every event in `event_ids` (a trial's earlier tries).
 */
export async function handleDeclareEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const input = await readBody(request, parseDeclare);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleDeclareEventSeries', async () => {
    const anchor = await eventRef(db, eventId);
    if (!anchor) return noEvent(request, eventId);
    const others = input.value.event_ids.filter((id) => id !== anchor.id);
    const found = await eventsInBrand(db, others, anchor.brand_id);
    if (found.length !== others.length) return noAttachTarget(request);
    if (anchor.series_id || found.some((e) => e.series_id)) return taken(request);

    const id = `evtsrs_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const joining = [anchor.id, ...others];
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_series
             (id, venue_id, series_name, cadence, day_of_week, hour_of_day,
              state, detected_at, confirmed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'confirmed', NULL, ?, ?, ?)`
        )
        .bind(
          id,
          anchor.id,
          input.value.name,
          input.value.cadence,
          input.value.day_of_week,
          input.value.hour_of_day,
          now,
          now,
          now
        ),
      attachStatement(db, id, joining, anchor.brand_id, 'unattached'),
    ]);
    const made = await seriesInBrand(db, id, anchor.brand_id);
    if (!made) return fail(request, 503, 'DB_ERROR', 'The series could not be saved');
    return reply(request, 201, {
      event_id: anchor.id,
      series: projectSeries(made),
      attached: joining,
    });
  });
}

/** PUT: attach this one event to a confirmed series of its own brand. */
export async function handleAttachEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const input = await readBody(request, parseAttach);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleAttachEventSeries', async () => {
    const event = await eventRef(db, eventId);
    if (!event) return noEvent(request, eventId);
    const series = await seriesInBrand(db, input.value.series_id, event.brand_id);
    if (!series) return noSeries(request);
    if (series.state !== 'confirmed')
      return fail(request, 409, 'SERIES_NOT_CONFIRMED', 'Only a confirmed series takes events');
    await attachStatement(db, series.id, [event.id], event.brand_id, 'any').run();
    return reply(request, 200, { series: projectSeries(series), attached: [event.id] });
  });
}

/** DELETE: detach this event. The series, and every other event on it, stay. */
export async function handleDetachEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleDetachEventSeries', async () => {
    const event = await eventRef(db, eventId);
    if (!event) return noEvent(request, eventId);
    await db
      .prepare(`UPDATE events SET series_id = NULL WHERE id = ? AND brand_id = ?`)
      .bind(event.id, event.brand_id)
      .run();
    return reply(request, 200, { series: null, detached: event.series_id ? [event.id] : [] });
  });
}

/**
 * POST …/confirm: accept a suggestion the nightly detector made. Confirming
 * attaches nothing by itself (a suggestion is a prompt, never a promotion); the
 * organizer names the events that join in `event_ids`.
 */
export async function handleConfirmEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const input = await readBody(request, parseConfirm);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleConfirmEventSeries', async () => {
    const event = await eventRef(db, eventId);
    if (!event) return noEvent(request, eventId);
    const series = await seriesInBrand(db, input.value.series_id, event.brand_id);
    if (!series) return noSeries(request);
    if (series.state !== 'pending')
      return fail(request, 409, 'SERIES_NOT_PENDING', 'Only a pending suggestion can be confirmed');
    const joining = input.value.event_ids;
    const found = await eventsInBrand(db, joining, event.brand_id);
    if (found.length !== joining.length) return noAttachTarget(request);
    if (found.some((e) => e.series_id)) return taken(request);

    const now = new Date().toISOString();
    const statements = [
      db
        .prepare(
          `UPDATE event_series
              SET state = 'confirmed', confirmed_at = ?, updated_at = ?,
                  series_name = COALESCE(?, series_name)
            WHERE id = ? AND state = 'pending'`
        )
        .bind(now, now, input.value.name, series.id),
    ];
    if (joining.length > 0)
      statements.push(attachStatement(db, series.id, joining, event.brand_id, 'unattached'));
    await db.batch(statements);
    const saved = await seriesInBrand(db, series.id, event.brand_id);
    return reply(request, 200, { series: projectSeries(saved ?? series), attached: joining });
  });
}

/** POST …/reject: turn a suggestion down. The detector will not suggest it again. */
export async function handleRejectEventSeries(
  request: Request,
  env: EventSeriesEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const input = await readBody(request, parseReject);
  if (!input.ok) return fail(request, 400, input.code, input.error);
  return guarded(request, 'handleRejectEventSeries', async () => {
    const event = await eventRef(db, eventId);
    if (!event) return noEvent(request, eventId);
    const series = await seriesInBrand(db, input.value.series_id, event.brand_id);
    if (!series) return noSeries(request);
    if (series.state !== 'pending')
      return fail(request, 409, 'SERIES_NOT_PENDING', 'Only a pending suggestion can be rejected');
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE event_series SET state = 'rejected', rejected_reason = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'`
      )
      .bind(input.value.reason, now, series.id)
      .run();
    const saved = await seriesInBrand(db, series.id, event.brand_id);
    return reply(request, 200, { series: projectSeries(saved ?? series) });
  });
}
