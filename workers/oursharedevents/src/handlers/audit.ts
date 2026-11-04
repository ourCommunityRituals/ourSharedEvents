/**
 * OSE-212 / SEC-6 — Admin audit log read handler
 *
 * GET /api/v2/admin/audit-log
 *   ?limit=<1–100, default 50>
 *   ?cursor=<nextCursor from the previous page: `<created_at>~<id>`; a bare ISO
 *            timestamp also works>
 *   ?action=<exact action filter, e.g. CREATE_EVENT>
 *   ?actor=<exact actor filter, e.g. admin@example.com>
 *   ?outcome=success|denied
 *   ?resource_type=<event|sponsor|flag|…>
 *   ?scope=brand  (AUD-3 Phase B, OSE-1447)
 *
 * Two views:
 *   - platform (no `scope`): every row, full IPs. The router admits only the
 *     platform scope (requirePlatformScope) before calling this.
 *   - brand (`scope=brand`): only rows whose brand_id is a brand the caller owns
 *     (role brand_owner, until R-0 / OSE-1446 decides the capability matrix).
 *     Rows with a NULL brand_id (platform actions, unresolvable targets) never
 *     appear. IPs are masked to /24 or /48 for every caller except a `key:`
 *     actor in scope mode 'all'. An actor who is not a member of the row's brand
 *     (for example another tenant's admin probing this brand's event) is shown
 *     as null, so one brand never learns another brand's operator identities.
 *
 * Every filter is validated (400) before any SQL runs; a D1 error on the audit
 * query is a 503 with the request id and no SQL text. Authorization lookups
 * (who the caller is a member of, who an actor on the page is) fail CLOSED: if
 * the membership table cannot be read, the caller gets the same 404 as a
 * non-member and an actor shows as null. That is the shared resolver's contract
 * (resolveAdminBrandScopeAsync / resolveAdminRoles), and an outage must never
 * widen what a brand reader sees.
 */

import { isAutomationActor } from '../auth/admin';
import type { AuditLogEnv } from '../lib/audit-log';
import {
  resolveAdminBrandScope,
  resolveAdminBrandScopeAsync,
  resolveAdminRoles,
  type AdminBrandScopeEnv,
} from '../lib/admin-brand-scope';
import { errorResponse } from '../lib/form-validation';
import { maskIp } from '../lib/ip-mask';

export type AuditHandlerEnv = AuditLogEnv & AdminBrandScopeEnv;

interface AuditRow {
  id: string;
  created_at: string;
  action: string;
  actor: string | null;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string;
  outcome: string;
  ip: string | null;
  details: string | null;
  brand_id: string | null;
}

/** Which rows a read may return, and how much of each it may show. */
export type AuditView =
  | { kind: 'platform' }
  | { kind: 'brand'; brandIds: 'all'; maskIps: false }
  | { kind: 'brand'; brandIds: string[]; maskIps: true };

/** `?scope=` allowlist. */
export const AUDIT_SCOPES = ['brand'] as const;

/**
 * Who an action belongs to, by KIND (Logs screen). Derived from the actor before
 * any masking, so it never says which person: another tenant's operator, shown as
 * null, is still just "person". An action with no verified actor is "unknown".
 */
export const AUDIT_SOURCES = ['person', 'sponsor', 'system', 'key', 'unknown'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export function auditSourceOf(actor: string | null): AuditSource {
  if (!actor) return 'unknown';
  if (actor.startsWith('system:')) return 'system';
  if (isAutomationActor(actor)) return 'key'; // OSE-1800: svc: is automation too
  if (actor.startsWith('sponsor:')) return 'sponsor';
  return 'person';
}

/** SQL for `?source=` over the actor column. Constant text; nothing is interpolated. */
const SOURCE_SQL: Record<AuditSource, string> = {
  unknown: 'actor IS NULL',
  system: "actor LIKE 'system:%'",
  key: "(actor LIKE 'key:%' OR actor LIKE 'svc:%')",
  sponsor: "actor LIKE 'sponsor:%'",
  person:
    "(actor IS NOT NULL AND actor NOT LIKE 'system:%' AND actor NOT LIKE 'key:%' AND actor NOT LIKE 'svc:%' AND actor NOT LIKE 'sponsor:%')",
};

const BRAND_FILTER_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;
const SINCE_DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_FILTER_LEN = 128;
const FILTER_SHAPES: Record<'action' | 'actor' | 'resource_type', RegExp> = {
  action: /^[A-Z0-9_]+$/,
  actor: /^[A-Za-z0-9._%+@:-]+$/,
  resource_type: /^[a-z0-9_-]+$/,
};
/**
 * created_at is written as strftime('%Y-%m-%dT%H:%M:%fZ'): always three
 * fractional digits. The cursor is compared lexically, so it must have exactly
 * that shape (".0Z" would sort after ".000Z" and repeat the boundary row).
 */
const CURSOR_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A page cursor: `<created_at>` or `<created_at>~<id>`. Rows can share a
 * created_at to the millisecond, so pages are ordered by (created_at, id) and the
 * cursor carries both; a bare timestamp still works. The timestamp must be a real
 * instant in the stored form: the right shape, and it must parse and round-trip
 * to itself (so 2026-02-30 or hour 99 fail).
 */
const CURSOR_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

function parseCursor(raw: string): { at: string; id: string | null } | null {
  const sep = raw.indexOf('~');
  const at = sep === -1 ? raw : raw.slice(0, sep);
  const id = sep === -1 ? null : raw.slice(sep + 1);
  if (!CURSOR_SHAPE.test(at)) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== at) return null;
  if (id !== null && !CURSOR_ID_SHAPE.test(id)) return null;
  return { at, id };
}

/**
 * `?since=` is a day (YYYY-MM-DD, the start of that UTC day) or a full instant in
 * the stored form. Either way it must be a real instant: it parses and round-trips.
 */
function parseSince(raw: string): string | null {
  const at = SINCE_DAY_SHAPE.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  if (!CURSOR_SHAPE.test(at)) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t) || new Date(t).toISOString() !== at) return null;
  return at;
}

/**
 * Resolve the brand view for a caller, or null when they may not read any brand's
 * audit trail. Scope mode 'all' (a `key:` actor with ADMIN_SCOPE_ALL) reads every
 * brand-attributed row with full IPs. An email actor reads only the brands they
 * hold `brand_owner` in, and only brands that are also in their resolved scope.
 */
export async function resolveBrandAuditView(
  actor: string | null,
  env: AdminBrandScopeEnv
): Promise<AuditView | null> {
  const scope = await resolveAdminBrandScopeAsync(actor, env);
  if (scope.mode === 'all') return { kind: 'brand', brandIds: 'all', maskIps: false };
  if (scope.mode !== 'scoped') return null;

  const owned = new Set(
    (await resolveAdminRoles(actor, env))
      .filter((r) => r.role === 'brand_owner')
      .map((r) => r.brandId)
  );
  const brandIds = scope.brandIds.filter((b) => owned.has(b));
  return brandIds.length > 0 ? { kind: 'brand', brandIds, maskIps: true } : null;
}

function parseDetails(details: string | null): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

/** Automation and system actors carry no person's identity and are always shown. */
function isServiceActor(actor: string): boolean {
  return isAutomationActor(actor) || actor.startsWith('system:');
}

/**
 * Brand memberships of several human actors in ONE query (no N+1). An actor with
 * no membership row falls back to the interim env map, exactly as
 * resolveAdminBrandScopeAsync does; anything unresolvable maps to []. If the
 * query itself fails, every actor maps to [] (fail closed), never to the env map.
 */
async function membershipsOf(
  actors: string[],
  env: AdminBrandScopeEnv
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const humans = Array.from(new Set(actors.filter((a) => !isServiceActor(a))));
  if (humans.length === 0) return out;
  if (env.DB) {
    try {
      const rows = await env.DB.prepare(
        `SELECT email, brand_id FROM admin_brand_memberships
          WHERE email IN (SELECT value FROM json_each(?))`
      )
        .bind(JSON.stringify(humans))
        .all<{ email: string; brand_id: string }>();
      for (const r of rows.results ?? []) {
        const list = out.get(r.email) ?? [];
        list.push(r.brand_id);
        out.set(r.email, list);
      }
    } catch {
      // Fail closed: a failed lookup is not "no rows". Nobody resolves to a
      // brand, so no human actor is shown and an actor filter matches nothing.
      // The env-map fallback below is only for a lookup that succeeded empty.
      for (const a of humans) out.set(a, []);
      return out;
    }
  }
  for (const a of humans) {
    if (out.has(a)) continue;
    const scope = resolveAdminBrandScope(a, env);
    out.set(a, scope.mode === 'scoped' ? scope.brandIds : []);
  }
  return out;
}

export async function handleListAuditLog(
  request: Request,
  env: AuditHandlerEnv,
  view: AuditView = { kind: 'platform' },
  requestId: string = crypto.randomUUID?.() ?? `req-${Date.now()}`
): Promise<Response> {
  const url = new URL(request.url);

  const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);

  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor === null ? null : parseCursor(rawCursor);
  if (rawCursor !== null && cursor === null) {
    return errorResponse(
      'INVALID_CURSOR',
      'cursor must be YYYY-MM-DDTHH:MM:SS.sssZ, optionally followed by ~<id> (as returned in nextCursor)',
      400,
      request
    );
  }

  const filters: Partial<Record<keyof typeof FILTER_SHAPES, string>> = {};
  for (const key of Object.keys(FILTER_SHAPES) as Array<keyof typeof FILTER_SHAPES>) {
    const value = url.searchParams.get(key);
    if (value === null || value === '') continue;
    if (value.length > MAX_FILTER_LEN || !FILTER_SHAPES[key].test(value)) {
      return errorResponse('INVALID_FILTER', `invalid ${key} filter`, 400, request);
    }
    filters[key] = value;
  }
  const filterOutcome = url.searchParams.get('outcome');
  if (filterOutcome !== null && filterOutcome !== 'success' && filterOutcome !== 'denied') {
    return errorResponse('INVALID_FILTER', 'outcome must be success or denied', 400, request);
  }
  const rawSource = url.searchParams.get('source');
  if (
    rawSource !== null &&
    rawSource !== '' &&
    !(AUDIT_SOURCES as readonly string[]).includes(rawSource)
  ) {
    return errorResponse(
      'INVALID_FILTER',
      `source must be one of: ${AUDIT_SOURCES.join(', ')}`,
      400,
      request
    );
  }
  const filterSource = rawSource ? (rawSource as AuditSource) : null;
  const rawSince = url.searchParams.get('since');
  const filterSince = rawSince ? parseSince(rawSince) : null;
  if (rawSince && filterSince === null) {
    return errorResponse(
      'INVALID_FILTER',
      'since must be a day (YYYY-MM-DD) or YYYY-MM-DDTHH:MM:SS.sssZ',
      400,
      request
    );
  }
  const rawBrand = url.searchParams.get('brand');
  if (rawBrand && !BRAND_FILTER_SHAPE.test(rawBrand)) {
    return errorResponse('INVALID_FILTER', 'invalid brand filter', 400, request);
  }
  const filterBrand = rawBrand || null;

  const conditions: string[] = [];
  const bindings: (string | number | null)[] = [];

  if (view.kind === 'brand') {
    let brandIds = view.brandIds;
    // The caller's own brands, echoed so the screen can offer a brand filter.
    const listed: string[] | null = view.brandIds === 'all' ? null : view.brandIds;
    // A brand filter can only NARROW the caller's own brands. Asking for a brand
    // you do not hold is the empty page, exactly like a brand with no rows, so
    // the answer never confirms that the brand exists.
    if (filterBrand) {
      brandIds = brandIds === 'all' ? [filterBrand] : brandIds.filter((b) => b === filterBrand);
      if (brandIds.length === 0) {
        return Response.json({
          ok: true,
          scope: 'brand',
          brands: listed,
          entries: [],
          pagination: { limit, hasMore: false, nextCursor: null },
        });
      }
    }
    // An actor filter must not confirm an identity the reader may not see, not
    // even through hasMore/nextCursor. A human actor is visible only on rows of
    // brands they belong to, so narrow the query to those brands BEFORE it runs;
    // none in common → the canonical empty page.
    if (view.maskIps && filters.actor && !isServiceActor(filters.actor)) {
      const theirs = (await membershipsOf([filters.actor], env)).get(filters.actor) ?? [];
      brandIds = (brandIds as string[]).filter((b) => theirs.includes(b));
      if (brandIds.length === 0) {
        return Response.json({
          ok: true,
          scope: 'brand',
          brands: listed,
          entries: [],
          pagination: { limit, hasMore: false, nextCursor: null },
        });
      }
    }
    if (brandIds === 'all') {
      conditions.push('brand_id IS NOT NULL');
    } else {
      // One bound parameter however many brands the reader owns: D1 caps a
      // statement at 100 bound parameters, and the cursor and filters need room.
      conditions.push('brand_id IN (SELECT value FROM json_each(?))');
      bindings.push(JSON.stringify(brandIds));
    }
  } else if (filterBrand) {
    conditions.push('brand_id = ?');
    bindings.push(filterBrand);
  }
  if (filterSince) {
    conditions.push('created_at >= ?');
    bindings.push(filterSince);
  }
  if (filterSource) {
    conditions.push(SOURCE_SQL[filterSource]);
  }
  if (cursor && cursor.id !== null) {
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    bindings.push(cursor.at, cursor.at, cursor.id);
  } else if (cursor) {
    conditions.push('created_at < ?');
    bindings.push(cursor.at);
  }
  if (filters.action) {
    conditions.push('action = ?');
    bindings.push(filters.action);
  }
  if (filters.actor) {
    conditions.push('actor = ?');
    bindings.push(filters.actor);
  }
  if (filterOutcome) {
    conditions.push('outcome = ?');
    bindings.push(filterOutcome);
  }
  if (filters.resource_type) {
    conditions.push('resource_type = ?');
    bindings.push(filters.resource_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  bindings.push(limit + 1); // +1 to detect next page

  const sql = `
    SELECT id, created_at, action, actor, resource_type, resource_id,
           request_id, outcome, ip, details, brand_id
    FROM   admin_audit_log
    ${where}
    ORDER  BY created_at DESC, id DESC
    LIMIT  ?`;

  let rows: AuditRow[];
  try {
    const result = await env.DB.prepare(sql)
      .bind(...bindings)
      .all<AuditRow>();
    rows = result.results ?? [];
  } catch {
    console.error(JSON.stringify({ type: 'AUDIT_LOG_READ_FAILURE', request_id: requestId }));
    return errorResponse(
      'DB_UNAVAILABLE',
      `audit log unavailable (request ${requestId})`,
      503,
      request
    );
  }

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore ? `${last.created_at}~${last.id}` : null;

  if (view.kind === 'platform') {
    return Response.json({
      ok: true,
      entries: page.map((row) => ({
        ...row,
        source: auditSourceOf(row.actor),
        details: parseDetails(row.details),
      })),
      pagination: { limit, hasMore, nextCursor },
    });
  }

  const members = view.maskIps
    ? await membershipsOf(
        page.map((r) => r.actor).filter((a): a is string => typeof a === 'string'),
        env
      )
    : new Map<string, string[]>();
  const entries = page.map((row) => {
    let actor = row.actor;
    if (view.maskIps && actor && !isServiceActor(actor)) {
      const brands = members.get(actor) ?? [];
      actor = row.brand_id && brands.includes(row.brand_id) ? actor : null;
    }
    return {
      ...row,
      actor,
      // Derived from the real actor, so masking the name never changes the kind.
      source: auditSourceOf(row.actor),
      ip: view.maskIps ? maskIp(row.ip) : row.ip,
      details: parseDetails(row.details),
    };
  });

  return Response.json({
    ok: true,
    scope: 'brand',
    // The caller's own brands (null: every brand). Lets the screen offer a brand
    // filter without another endpoint; it can only ever list what they hold.
    brands: view.brandIds === 'all' ? null : view.brandIds,
    entries,
    pagination: { limit, hasMore, nextCursor },
  });
}
