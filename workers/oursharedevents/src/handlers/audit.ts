/**
 * OSE-212 / SEC-6 — Admin audit log read handler
 *
 * GET /api/v2/admin/audit-log
 *   ?limit=<1–100, default 50>
 *   ?cursor=<ISO timestamp — page backward past this point>
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
 * Every filter is validated (400) before any SQL runs; a D1 error is a 503 with
 * the request id and no SQL text.
 */

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
  return actor.startsWith('key:') || actor.startsWith('system:');
}

/**
 * Brand memberships of several human actors in ONE query (no N+1). An actor with
 * no membership row falls back to the interim env map, exactly as
 * resolveAdminBrandScopeAsync does; anything unresolvable maps to [].
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
          WHERE email IN (${humans.map(() => '?').join(', ')})`
      )
        .bind(...humans)
        .all<{ email: string; brand_id: string }>();
      for (const r of rows.results ?? []) {
        const list = out.get(r.email) ?? [];
        list.push(r.brand_id);
        out.set(r.email, list);
      }
    } catch {
      // Table absent → env-map fallback below.
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

  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && !CURSOR_SHAPE.test(cursor)) {
    return errorResponse(
      'INVALID_CURSOR',
      'cursor must be an ISO-8601 UTC timestamp',
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

  const conditions: string[] = [];
  const bindings: (string | number | null)[] = [];

  if (view.kind === 'brand') {
    let brandIds = view.brandIds;
    // An actor filter must not confirm an identity the reader may not see, not
    // even through hasMore/nextCursor. A human actor is visible only on rows of
    // brands they belong to, so narrow the query to those brands BEFORE it runs;
    // none in common → the canonical empty page.
    if (view.maskIps && filters.actor && !isServiceActor(filters.actor)) {
      const theirs = (await membershipsOf([filters.actor], env)).get(filters.actor) ?? [];
      brandIds = view.brandIds.filter((b) => theirs.includes(b));
      if (brandIds.length === 0) {
        return Response.json({
          ok: true,
          scope: 'brand',
          entries: [],
          pagination: { limit, hasMore: false, nextCursor: null },
        });
      }
    }
    if (brandIds === 'all') {
      conditions.push('brand_id IS NOT NULL');
    } else {
      conditions.push(`brand_id IN (${brandIds.map(() => '?').join(', ')})`);
      bindings.push(...brandIds);
    }
  }
  if (cursor) {
    conditions.push('created_at < ?');
    bindings.push(cursor);
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
    ORDER  BY created_at DESC
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
  const nextCursor = hasMore ? page[page.length - 1].created_at : null;

  if (view.kind === 'platform') {
    return Response.json({
      ok: true,
      entries: page.map((row) => ({ ...row, details: parseDetails(row.details) })),
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
      ip: view.maskIps ? maskIp(row.ip) : row.ip,
      details: parseDetails(row.details),
    };
  });

  return Response.json({
    ok: true,
    scope: 'brand',
    entries,
    pagination: { limit, hasMore, nextCursor },
  });
}
