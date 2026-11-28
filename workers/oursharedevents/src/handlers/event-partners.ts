/**
 * Partner links between groups on one event (owner, 2026-11-28; migration 0128,
 * lib/event-partners.ts).
 *
 *   GET  /api/v2/admin/events/:id/partners                   the event's links (organizer)
 *   POST /api/v2/admin/events/:id/partners                   invite a brand (organizer)
 *   POST /api/v2/admin/events/:id/partners/:pid/withdraw     end a link (organizer)
 *   GET  /api/v2/admin/partner-links                         links offered to my brands
 *   POST /api/v2/admin/partner-links/:pid/respond            accept or decline (partner)
 *   GET  /api/v2/admin/partner-links/:pid/counts             the event's floored total (partner)
 *
 * SCOPE. The three event routes sit under /admin/events/:id/**, so the router's
 * guardAdminObjectScope has already proved the event is the caller's; each
 * statement binds the path event too. The partner-links routes are scoped here:
 * a link is reachable only when its partner_brand_id is one of the caller's
 * brands (resolveAdminBrandScopeAsync, server-derived), and a link the
 * organizer has not offered, or has withdrawn, is the same 404 as one that does
 * not exist. A key actor with ADMIN_SCOPE_ALL reads every link, as elsewhere.
 *
 * WHAT A PARTNER READS. The event's title and date (to decide), and while the
 * link is on, the event's scan total, floored like every published count. No
 * per-stop count, no row, no person.
 */

import { corsHeaders } from '../lib/cors';
import { errorLabel } from '../lib/error-label';
import { isJsonContentType } from '../lib/content-type';
import { extractAdminActor, type AdminEnv } from '../auth/admin';
import { resolveAdminBrandScopeAsync, type AdminBrandScopeEnv } from '../lib/admin-brand-scope';
import { partnerOnSql, validatePartnerInvite } from '../lib/event-partners';
import { boothCounts, type BoothRef, type PlacementRef } from '../lib/booth-counts';
import { readEventScanCells } from '../lib/scan-cells';

export type EventPartnersEnv = AdminEnv & AdminBrandScopeEnv & { DB?: D1Database };

const BODY_MAX = 4096;

function reply(request: Request, status: number, body: Record<string, unknown>): Response {
  const rid = crypto.randomUUID?.() ?? `req-${Date.now()}`;
  return Response.json(
    { ok: status < 400, status, ...body },
    {
      status,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}
const fail = (request: Request, status: number, code: string, error: string) =>
  reply(request, status, { code, error });
const noDb = (request: Request) =>
  fail(request, 503, 'DB_NOT_CONFIGURED', 'Database not available');
/** One body for "not offered", "not your brand's" and "does not exist". */
const noLink = (request: Request) => fail(request, 404, 'NOT_FOUND', 'Partner link not found');

async function readBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  if (!isJsonContentType(request.headers.get('content-type')))
    return {
      ok: false,
      res: fail(request, 400, 'BAD_CONTENT_TYPE', 'Content-Type must be application/json'),
    };
  try {
    const text = await request.text();
    if (text.length > BODY_MAX)
      return { ok: false, res: fail(request, 400, 'PAYLOAD_TOO_LARGE', 'Body too large') };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      res: fail(request, 400, 'INVALID_BODY', 'Request body must be valid JSON'),
    };
  }
}

async function guarded(request: Request, handler: string, work: () => Promise<Response>) {
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
    return fail(request, 503, 'DB_ERROR', 'The partner link could not be read or saved');
  }
}

const LINK_COLUMNS = `p.id, p.event_id, p.partner_brand_id, p.partner_name, p.kind, p.is_public_body,
       p.organizer_accepted, p.partner_accepted, ${partnerOnSql()} AS is_on`;

interface LinkRow {
  id: string;
  event_id: string;
  partner_brand_id: string;
  partner_name: string;
  kind: string;
  is_public_body: number;
  organizer_accepted: number;
  partner_accepted: number | null;
  is_on: number;
}

function linkOut(r: LinkRow) {
  return {
    id: r.id,
    event_id: r.event_id,
    partner_brand_id: r.partner_brand_id,
    partner_name: r.partner_name,
    kind: r.kind,
    is_public_body: r.is_public_body === 1,
    organizer_accepted: r.organizer_accepted === 1,
    partner_accepted: r.partner_accepted === null ? null : r.partner_accepted === 1,
    on: r.is_on === 1,
  };
}

// ── organizer side (the event is already brand-scoped by the router) ─────────

export async function handleListEventPartners(
  request: Request,
  env: EventPartnersEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleListEventPartners', async () => {
    const rs = await db
      .prepare(
        `SELECT ${LINK_COLUMNS} FROM event_partners p WHERE p.event_id = ? ORDER BY p.created_at, p.id`
      )
      .bind(eventId)
      .all<LinkRow>();
    return reply(request, 200, { event_id: eventId, partners: (rs.results ?? []).map(linkOut) });
  });
}

export async function handleInviteEventPartner(
  request: Request,
  env: EventPartnersEnv,
  eventId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const read = await readBody(request);
  if (!read.ok) return read.res;
  return guarded(request, 'handleInviteEventPartner', async () => {
    const ev = await db
      .prepare(`SELECT brand_id FROM events WHERE id = ?`)
      .bind(eventId)
      .first<{ brand_id: string }>();
    if (!ev) return fail(request, 404, 'NOT_FOUND', `Event not found: ${eventId}`);
    const check = validatePartnerInvite(read.body, ev.brand_id);
    if (!check.ok) return fail(request, 400, 'INVALID_FIELD', check.error);
    const v = check.value;
    const id = `epl_${crypto.randomUUID().replace(/-/g, '')}`;
    // A second invite to the same brand re-offers the link (the organizer's side
    // goes back to 1). The partner's answer stands only for the offer it was
    // given: when the link had been withdrawn, or the name, kind or public-body
    // mark changes, the answer goes back to NULL and the partner must answer
    // again before the page names them (consent is to one offer, not to any
    // later one). In SQLite every right-hand side reads the row before the
    // update, so the CASE compares the old offer with the new one.
    await db
      .prepare(
        `INSERT INTO event_partners (id, event_id, partner_brand_id, partner_name, kind, is_public_body, organizer_accepted)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (event_id, partner_brand_id) DO UPDATE SET
           partner_accepted = CASE
             WHEN event_partners.organizer_accepted = 1
              AND event_partners.partner_name = excluded.partner_name
              AND event_partners.kind = excluded.kind
              AND event_partners.is_public_body = excluded.is_public_body
             THEN event_partners.partner_accepted
             ELSE NULL
           END,
           partner_name = excluded.partner_name, kind = excluded.kind,
           is_public_body = excluded.is_public_body, organizer_accepted = 1,
           updated_at = datetime('now')`
      )
      .bind(id, eventId, v.partner_brand_id, v.partner_name, v.kind, v.is_public_body ? 1 : 0)
      .run();
    const row = await db
      .prepare(
        `SELECT ${LINK_COLUMNS} FROM event_partners p WHERE p.event_id = ? AND p.partner_brand_id = ?`
      )
      .bind(eventId, v.partner_brand_id)
      .first<LinkRow>();
    return reply(request, 201, { partner: row ? linkOut(row) : null });
  });
}

export async function handleWithdrawEventPartner(
  request: Request,
  env: EventPartnersEnv,
  eventId: string,
  linkId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleWithdrawEventPartner', async () => {
    const res = await db
      .prepare(
        `UPDATE event_partners SET organizer_accepted = 0, updated_at = datetime('now')
          WHERE id = ? AND event_id = ?`
      )
      .bind(linkId, eventId)
      .run();
    if ((res.meta?.changes ?? 0) === 0) return noLink(request);
    return reply(request, 200, { id: linkId, organizer_accepted: false, on: false });
  });
}

// ── partner side (scoped here, by the link's partner brand) ──────────────────

/** The caller's brands as a bound predicate on `p.partner_brand_id`, or null to deny. */
async function partnerScope(
  request: Request,
  env: EventPartnersEnv
): Promise<{ sql: string; binds: string[] } | null> {
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'deny') return null;
  if (scope.mode === 'all') return { sql: '1 = 1', binds: [] };
  if (scope.brandIds.length === 0) return null;
  return {
    sql: `p.partner_brand_id IN (${scope.brandIds.map(() => '?').join(', ')})`,
    binds: scope.brandIds,
  };
}

/** A link offered to one of the caller's brands (organizer side still 1), else null. */
async function offeredLink(
  db: D1Database,
  linkId: string,
  scope: { sql: string; binds: string[] }
): Promise<LinkRow | null> {
  return db
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM event_partners p
        WHERE p.id = ? AND p.organizer_accepted = 1 AND ${scope.sql}`
    )
    .bind(linkId, ...scope.binds)
    .first<LinkRow>();
}

export async function handleListPartnerLinks(
  request: Request,
  env: EventPartnersEnv
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handleListPartnerLinks', async () => {
    const scope = await partnerScope(request, env);
    if (!scope) return reply(request, 200, { links: [] });
    const rs = await db
      .prepare(
        `SELECT ${LINK_COLUMNS}, e.title AS event_title, e.start_date AS event_start_date
           FROM event_partners p JOIN events e ON e.id = p.event_id
          WHERE p.organizer_accepted = 1 AND ${scope.sql}
          ORDER BY e.start_date, p.id
          LIMIT 200`
      )
      .bind(...scope.binds)
      .all<LinkRow & { event_title: string; event_start_date: string | null }>();
    return reply(request, 200, {
      links: (rs.results ?? []).map((r) => ({
        ...linkOut(r),
        event_title: r.event_title,
        event_start_date: r.event_start_date,
      })),
    });
  });
}

export async function handleRespondPartnerLink(
  request: Request,
  env: EventPartnersEnv,
  linkId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  const read = await readBody(request);
  if (!read.ok) return read.res;
  const body = read.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || typeof body.accept !== 'boolean')
    return fail(request, 400, 'MISSING_FIELD', 'accept must be true or false');
  const accept = body.accept;
  return guarded(request, 'handleRespondPartnerLink', async () => {
    const scope = await partnerScope(request, env);
    if (!scope) return noLink(request);
    const link = await offeredLink(db, linkId, scope);
    if (!link) return noLink(request);
    await db
      .prepare(
        `UPDATE event_partners SET partner_accepted = ?, updated_at = datetime('now')
          WHERE id = ? AND organizer_accepted = 1`
      )
      .bind(accept ? 1 : 0, link.id)
      .run();
    return reply(request, 200, {
      id: link.id,
      event_id: link.event_id,
      partner_accepted: accept,
      on: accept,
    });
  });
}

export async function handlePartnerLinkCounts(
  request: Request,
  env: EventPartnersEnv,
  linkId: string
): Promise<Response> {
  const db = env.DB;
  if (!db) return noDb(request);
  return guarded(request, 'handlePartnerLinkCounts', async () => {
    const scope = await partnerScope(request, env);
    if (!scope) return noLink(request);
    const link = await offeredLink(db, linkId, scope);
    // Only while both sides accept: an unanswered or declined link reads nothing.
    if (!link || link.is_on !== 1) return noLink(request);
    const booths = await db
      .prepare(
        `SELECT id, number, name, category, is_active FROM event_booths
          WHERE event_id = ? ORDER BY is_active DESC, sort ASC, number ASC, id ASC`
      )
      .bind(link.event_id)
      .all<{
        id: string;
        number: string;
        name: string;
        category: string | null;
        is_active: number;
      }>();
    const refs: BoothRef[] = (booths.results ?? []).map((b) => ({
      id: String(b.id),
      number: String(b.number),
      name: String(b.name),
      category: b.category === null || b.category === undefined ? null : String(b.category),
      is_active: Number(b.is_active) === 1,
    }));
    const placements = await db
      .prepare(`SELECT id, booth_id FROM poster_deployments WHERE event_id = ?`)
      .bind(link.event_id)
      .all<{ id: string; booth_id: string | null }>();
    const cells = await readEventScanCells(db, link.event_id);
    const places: PlacementRef[] = (placements.results ?? []).map((p) => ({
      id: String(p.id),
      booth_id: p.booth_id === null || p.booth_id === undefined ? null : String(p.booth_id),
    }));
    // The fair total only: the same floored figure the organizer's stall counts read.
    const { total } = boothCounts(refs, places, cells);
    return reply(request, 200, { id: link.id, event_id: link.event_id, scans: total });
  });
}
