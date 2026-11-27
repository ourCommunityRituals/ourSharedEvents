/**
 * OSE-1080 — OBJECT-LEVEL admin brand scoping (INVARIANT #9 tenant_isolation).
 *
 * THE GAP THIS CLOSES. `admin-brand-scope.ts` derives *which brands* a caller may
 * see, and until now that derivation was consumed only on LIST paths
 * (handleAdminListEvents, handleAdminListSponsors, handlePortfolioRollup). Every
 * admin path that addresses ONE object BY ID went straight to the SQL with no
 * brand predicate:
 *
 *   PUT /api/v2/admin/events/:id           → `UPDATE events ... WHERE id = ?`
 *   GET /api/v2/admin/events/:id/stats     → `... WHERE event_id = ?`
 *   POST /api/v2/admin/events/:id/backup   → …and a dozen siblings
 *
 * So a brand-A operator who knew (or enumerated) a brand-B event id could READ
 * and MUTATE it cross-tenant. Same class of hole OSE-710 closed for per-ID
 * sponsor endpoints; this is the events/poster-deployments half.
 *
 * WHY ONE ROUTER-LEVEL GUARD, NOT A CHECK IN EVERY HANDLER. The affected surface
 * is ~13 routes across 8 handler modules whose env types and signatures differ
 * (handleRemoveEventFlag takes no Request at all; feature-flags.ts is barred from
 * touching `env.DB` by the architecture gate in tests/architecture.spec.ts). One
 * guard at the single dispatch point — the router — enforces the wall uniformly,
 * cannot drift per handler, and automatically covers any FUTURE
 * `/api/v2/admin/events/:id/...` sub-route rather than waiting for its author to
 * remember the check. The scope math itself stays in admin-brand-scope.ts, which
 * remains the single derivation point.
 *
 * FAIL-CLOSED. 'deny' reaches nothing; 'scoped' must PROVE the target object's
 * brand_id is inside the caller's set, via a bound SQL predicate (never a
 * client-side filter, never a caller-supplied `?brand_id=`); a missing DB, a
 * missing row, or a query error all resolve to unreachable. Only 'all' — the
 * key-actor/CI opt-in — bypasses the object lookup, so automation behaviour is
 * unchanged.
 *
 * SCOPED MISS RETURNS 404, NOT 403 — the convention already set by OSE-710 and
 * asserted in tests/red-team/api-authz.spec.ts: a 403 would confirm the id
 * exists, handing an attacker an enumeration oracle. Out-of-scope is
 * indistinguishable from "does not exist".
 *
 * INSIDE THE PUBLIC BRAND THE CREATOR IS THE BOUNDARY (OSE-1561, OSE ADR-022
 * decision 2a). `root` is one brand shared by every organizer without a brand of
 * their own, so there the same guard also proves the row's `created_by` is the
 * caller: one more bound condition beside the brand predicate, which can only
 * narrow it (lib/admin-owner-scope.ts). It covers the three targets below and,
 * for a caller held to their own rows, a sponsor, a sponsor request and a second
 * id in a campaign path. Form data under an event is the creator's alone, the
 * `root` brand owner included. Not-yours is the same 404 as does-not-exist.
 *
 * PUBLIC READS ARE OUT OF SCOPE BY DESIGN. `GET /api/v2/events/:id`, the public
 * event/poster/display/shared-report surfaces and DataProvider.getEvent stay
 * unscoped — they are deliberately public. Only `/api/v2/admin/**` object paths
 * pass through here.
 */

import {
  extractAdminActor,
  isDevOpenAdmin,
  logNullAdminActorDenied,
  type AdminEnv,
} from '../auth/admin';
import {
  PLATFORM_BRAND_ID,
  resolveAdminBrandScopeAsync,
  type AdminBrandScopeEnv,
} from './admin-brand-scope';
import { ownerAndSql, resolveOwnerRule } from './admin-owner-scope';
import { corsHeaders } from './cors';

export type AdminObjectScopeEnv = AdminEnv &
  AdminBrandScopeEnv & {
    DB?: D1Database;
  };

/** The object an admin object-level path addresses. */
export type AdminObjectTarget =
  | { kind: 'event'; id: string }
  | { kind: 'poster-deployment'; id: string }
  | { kind: 'campaign'; id: string }
  | { kind: 'competition'; id: string };

/**
 * Segments that sit where an id would but address a COLLECTION, not an object.
 * They must never be looked up as ids (that would 404 a working route). Keep in
 * sync with the exact-match routes registered above the /:id matchers in
 * router.ts.
 */
const EVENT_COLLECTION_SEGMENTS: ReadonlySet<string> = new Set([
  'backfill-h3-cells',
  'portfolio-rollup',
]);

const POSTER_DEPLOYMENT_COLLECTION_SEGMENTS: ReadonlySet<string> = new Set(['backfill-h3']);

const ADMIN_EVENT_OBJECT_PATH = /^\/api\/v2\/admin\/events\/([^/]+)(?:\/.*)?$/;
const ADMIN_POSTER_DEPLOYMENT_OBJECT_PATH = /^\/api\/v2\/admin\/poster-deployments\/([^/]+)$/;
// A campaign and everything beneath it (S14: /placements/:placementId). The
// collection itself (/api/v2/admin/campaigns) has no id and scopes its own SQL.
const ADMIN_CAMPAIGN_OBJECT_PATH = /^\/api\/v2\/admin\/campaigns\/([^/]+)(?:\/.*)?$/;
// A competition and everything beneath it (entries, schedule, fixtures,
// results, the score screen; leagues phase 1). It carries its own brand_id and
// created_by (migration 0125), as a campaign does.
const ADMIN_COMPETITION_OBJECT_PATH = /^\/api\/v2\/admin\/competitions\/([^/]+)(?:\/.*)?$/;

/**
 * Which object (if any) an admin request path addresses. Pure and total — no
 * request, no DB — so the path-matching half of the wall is unit-testable
 * without a runtime.
 *
 * Matches `/api/v2/admin/events/:id` AND every sub-resource beneath it
 * (`/stats`, `/verify-qr`, `/backup`, `/uploads`, `/poster-deployments`,
 * `/flags/:key`, `/forms/*`, `/shared-report/mint-link`, …) — the whole subtree
 * belongs to one event, so one match covers it and any sub-route added later.
 * Returns null for collection routes (the admin events LIST enforces its own
 * scope in SQL) and for every non-admin path.
 */
export function matchAdminObjectTarget(pathname: string): AdminObjectTarget | null {
  const eventMatch = pathname.match(ADMIN_EVENT_OBJECT_PATH);
  if (eventMatch) {
    const id = eventMatch[1];
    return EVENT_COLLECTION_SEGMENTS.has(id) ? null : { kind: 'event', id };
  }

  const deploymentMatch = pathname.match(ADMIN_POSTER_DEPLOYMENT_OBJECT_PATH);
  if (deploymentMatch) {
    const id = deploymentMatch[1];
    return POSTER_DEPLOYMENT_COLLECTION_SEGMENTS.has(id) ? null : { kind: 'poster-deployment', id };
  }

  const campaignMatch = pathname.match(ADMIN_CAMPAIGN_OBJECT_PATH);
  if (campaignMatch) return { kind: 'campaign', id: campaignMatch[1] };

  const competitionMatch = pathname.match(ADMIN_COMPETITION_OBJECT_PATH);
  if (competitionMatch) return { kind: 'competition', id: competitionMatch[1] };

  return null;
}

/**
 * OSE-1561 — is this path form data under an event (the five forms reads and the
 * export)? In the public brand that is the creator's alone. Pure.
 */
export function isFormsDataPath(pathname: string): boolean {
  return /^\/api\/v2\/admin\/events\/[^/]+\/forms(?:\/|$)/.test(pathname);
}

/**
 * OSE-1561 — objects a path addresses that the brand wall leaves to the handler
 * (a sponsor, a sponsor request) or to a second id (a campaign's event or
 * placement). The handlers still prove the brand. This list exists so a caller
 * held to their own rows in the public brand is also proved to be the creator,
 * here, before any handler runs. Pure.
 *
 * A placement belongs to the event it is on: the organizer who created the event
 * answers its requests and files it under their campaigns.
 */
export type AdminOwnerTarget =
  | { kind: 'sponsor'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'placement'; id: string; label: 'Request' | 'Placement' };

const SPONSOR_COLLECTION_SEGMENTS: ReadonlySet<string> = new Set(['promote']);
const ADMIN_SPONSOR_OBJECT_PATH = /^\/api\/v2\/admin\/sponsors\/([^/]+)(?:\/.*)?$/;
const ADMIN_SPONSOR_REQUEST_PATH = /^\/api\/v2\/admin\/sponsor-requests\/([^/]+)(?:\/.*)?$/;
const ADMIN_CAMPAIGN_EVENT_PATH = /^\/api\/v2\/admin\/campaigns\/[^/]+\/events\/([^/]+)$/;
const ADMIN_CAMPAIGN_PLACEMENT_PATH = /^\/api\/v2\/admin\/campaigns\/[^/]+\/placements\/([^/]+)$/;

export function matchAdminOwnerTargets(pathname: string): AdminOwnerTarget[] {
  const sponsor = pathname.match(ADMIN_SPONSOR_OBJECT_PATH);
  if (sponsor) {
    return SPONSOR_COLLECTION_SEGMENTS.has(sponsor[1]) ? [] : [{ kind: 'sponsor', id: sponsor[1] }];
  }
  const request = pathname.match(ADMIN_SPONSOR_REQUEST_PATH);
  if (request) return [{ kind: 'placement', id: request[1], label: 'Request' }];
  const campaignEvent = pathname.match(ADMIN_CAMPAIGN_EVENT_PATH);
  if (campaignEvent) return [{ kind: 'event', id: campaignEvent[1] }];
  const campaignPlacement = pathname.match(ADMIN_CAMPAIGN_PLACEMENT_PATH);
  if (campaignPlacement) {
    return [{ kind: 'placement', id: campaignPlacement[1], label: 'Placement' }];
  }
  return [];
}

type ScopedTarget = AdminObjectTarget | AdminOwnerTarget;

export interface AdminObjectScopeOptions {
  /** The path is form data under the event: the creator's alone in the public brand. */
  formsData?: boolean;
  /**
   * Check the target only for a caller held to their own rows in the public
   * brand, and answer true for every other scoped caller (a caller with no scope
   * is still refused). For the targets the handlers already scope by brand, so
   * those callers' answers stay the handlers' own.
   */
  ownRowsCallersOnly?: boolean;
}

/**
 * Is the target object inside the caller's server-derived brand scope, and,
 * inside the public brand, theirs by the owner rule (OSE-1561)?
 *
 * Poster deployments carry no brand_id column (migration 0003), so their tenancy
 * is resolved through the owning event — a bound JOIN, one hop, same predicate.
 * A placement resolves through its event the same way. A campaign and a sponsor
 * carry their own brand_id and created_by (migrations 0039, 0065, 0112).
 *
 * Handlers also use it for an id named in a request BODY, which the router guard
 * cannot see.
 */
export async function isAdminObjectInScope(
  request: Request,
  env: AdminObjectScopeEnv,
  target: ScopedTarget,
  opts: AdminObjectScopeOptions = {}
): Promise<boolean> {
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);

  // Automation/CI opt-in (key actor + ADMIN_SCOPE_ALL) — unscoped by design, and
  // the ONLY path that skips the object lookup.
  if (scope.mode === 'all') return true;
  // Unscopable operator → reaches nothing. Never the whole table, never one row.
  if (scope.mode === 'deny') return false;

  // OSE-1561: where the caller stands in the public brand. It adds a condition
  // beside the brand predicate below; it never replaces or widens it.
  const rule = await resolveOwnerRule(request, env, scope);
  if (opts.ownRowsCallersOnly && rule.standing !== 'own-rows') return true;

  // Fail-closed: with no DB we cannot PROVE tenancy, so we do not assume it.
  if (!env.DB) return false;

  const placeholders = scope.brandIds.map(() => '?').join(', ');
  // A placement and a poster deployment have no creator of their own: they are
  // their event's, so the condition reads the joined event (`e`).
  const own =
    target.kind === 'event'
      ? ownerAndSql(rule, 'brand_id', 'created_by', { formsData: opts.formsData })
      : target.kind === 'campaign' || target.kind === 'sponsor' || target.kind === 'competition'
        ? ownerAndSql(rule, 'brand_id', 'created_by')
        : ownerAndSql(rule, 'e.brand_id', 'e.created_by');
  const sql =
    target.kind === 'event'
      ? `SELECT 1 AS reachable FROM events WHERE id = ? AND brand_id IN (${placeholders})${own.sql} LIMIT 1`
      : target.kind === 'campaign'
        ? `SELECT 1 AS reachable FROM campaigns WHERE id = ? AND brand_id IN (${placeholders})${own.sql} LIMIT 1`
        : target.kind === 'competition'
          ? `SELECT 1 AS reachable FROM competitions WHERE id = ? AND brand_id IN (${placeholders})${own.sql} LIMIT 1`
          : target.kind === 'sponsor'
            ? `SELECT 1 AS reachable FROM sponsor_business WHERE id = ? AND brand_id IN (${placeholders})${own.sql} LIMIT 1`
            : target.kind === 'placement'
              ? `SELECT 1 AS reachable FROM sponsor_placement sp
           JOIN events e ON e.id = sp.event_id
          WHERE sp.id = ? AND e.brand_id IN (${placeholders})${own.sql} LIMIT 1`
              : `SELECT 1 AS reachable FROM poster_deployments pd
           JOIN events e ON e.id = pd.event_id
          WHERE pd.id = ? AND e.brand_id IN (${placeholders})${own.sql} LIMIT 1`;

  try {
    const row = await env.DB.prepare(sql)
      .bind(target.id, ...scope.brandIds, ...own.binds)
      .first<{ reachable: number }>();
    return !!row;
  } catch {
    // A broken/absent table is not a licence to proceed.
    return false;
  }
}

/** The canonical scoped-miss body — identical to a genuine "does not exist". */
function notFound(request: Request, target: ScopedTarget): Response {
  const label =
    target.kind === 'event'
      ? 'Event'
      : target.kind === 'campaign'
        ? 'Campaign'
        : target.kind === 'competition'
          ? 'Competition'
          : target.kind === 'sponsor'
            ? 'Sponsor'
            : target.kind === 'placement'
              ? target.label
              : 'Poster deployment';
  const rid = crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
  return Response.json(
    {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      error: `${label} not found: ${target.id}`,
      requestId: rid,
      timestamp: new Date().toISOString(),
    },
    {
      status: 404,
      headers: { ...corsHeaders(request), 'Cache-Control': 'no-store', 'X-Request-Id': rid },
    }
  );
}

/**
 * Router guard: 404 when this admin request addresses an object outside the
 * caller's brand scope, `null` when it may proceed.
 *
 * ORDERING CONTRACT — why an unauthenticated caller gets no opinion here.
 * `extractAdminActor` returns null for a caller carrying no admin identity it can
 * trust (it decodes; the signature is checked by the router pre-flight and
 * requireAdmin), and such a caller can never pass `requireAdmin` either (Methods 2/3
 * each require a secret, and Method 1 without an email falls through to them).
 * So returning null for a null actor cedes the response to the route's own
 * `requireAdmin` — preserving the 401 + audit-denied contract that
 * tests/red-team/api-authz.spec.ts pins — rather than answering 404 and telling
 * an anonymous prober that auth is not what stopped them. Every caller the
 * system CAN identify is scoped here, fail-closed.
 *
 * (The one identity-less path that does reach a handler is the DEV_OPEN_ADMIN
 * local-dev bypass in requireAdmin, which is already refused on production and
 * staging and is proven local-only by tests/dev-open-admin-guard.spec.ts.)
 *
 * OSE-1801: the actor is resolved once per request (`extractAdminActor` is
 * memoised), so the null this guard cedes on is the same null requireAdmin and
 * every handler see later; a token cannot be scoped here and then read as null
 * further down. Handlers that run after requireAdmin deny a null actor unless
 * the bypass is really on.
 */
export async function guardAdminObjectScope(
  request: Request,
  env: AdminObjectScopeEnv,
  pathname: string
): Promise<Response | null> {
  const target = matchAdminObjectTarget(pathname);
  const ownerTargets = matchAdminOwnerTargets(pathname);
  if (!target && ownerTargets.length === 0) return null;

  if (extractAdminActor(request, env) === null) return null;

  if (
    target &&
    !(await isAdminObjectInScope(request, env, target, { formsData: isFormsDataPath(pathname) }))
  ) {
    return notFound(request, target);
  }
  // OSE-1561: a caller held to their own rows in the public brand is proved to be
  // the creator of every other object the path names. A caller with no scope is
  // refused, as everywhere. Every other caller passes straight through, so their
  // answers are still the handlers' own brand checks.
  for (const t of ownerTargets) {
    if (!(await isAdminObjectInScope(request, env, t, { ownRowsCallersOnly: true }))) {
      return notFound(request, t);
    }
  }
  return null;
}

/**
 * AUD-3 (OSE-1447) — PLATFORM-SCOPE guard for platform-owned admin routes.
 *
 * Some admin routes act on data that belongs to no brand (decrypted subscriber
 * emails, rate-limit telemetry, the cross-brand audit log, confidential briefing
 * pages) or on every tenant at once (data-subject erase, H3 backfills). They are
 * reachable in scope mode 'all' (a `key:` actor with the ADMIN_SCOPE_ALL opt-in,
 * absent in production) or by a member of the reserved PLATFORM_BRAND_ID, which is
 * how the founder reaches them in production. Platform-brand membership grants
 * nothing inside other tenants, so there is still no human super-admin (Feature G /
 * OSE-832, Invariant #9).
 *
 * Call AFTER requireAdmin, so an anonymous caller still gets 401 from auth. Every
 * other caller gets a 404 byte-identical to the router's unknown-route fallback,
 * so a brand admin cannot tell a platform route from one that does not exist.
 */
export async function requirePlatformScope(
  request: Request,
  env: AdminObjectScopeEnv
): Promise<Response | null> {
  if (await isPlatformActor(request, env)) return null;
  return Response.json({ ok: false, status: 404, error: 'Not found' }, { status: 404 });
}

/**
 * Is the caller a platform admin: scope mode 'all' (a `key:` actor with the
 * ADMIN_SCOPE_ALL opt-in) or a member of PLATFORM_BRAND_ID? The one definition
 * requirePlatformScope and the who × plan rule (lib/report-plan.ts) both use.
 */
export async function isPlatformActor(
  request: Request,
  env: AdminObjectScopeEnv
): Promise<boolean> {
  const scope = await resolveAdminBrandScopeAsync(extractAdminActor(request, env), env);
  if (scope.mode === 'all') return true;
  return scope.mode === 'scoped' && scope.brandIds.includes(PLATFORM_BRAND_ID);
}

/**
 * R-5 (OSE-850) — KEY-ACTOR guard for global, cross-brand mutations.
 *
 * `PUT /api/v2/admin/flags/:key` and `POST /api/v2/admin/flags/apply-tier` change
 * every brand at once, so there is no brand to scope them by. They belong to an
 * actor class, not a capability: only `key:` automation actors (X-OCR-Internal or
 * the Bearer key, where an environment turns them on; production has neither,
 * wrangler.toml [env.production.vars]) may call them. Every email
 * actor, `brand_owner` and the platform brand included, gets 403. This does not
 * read ADMIN_SCOPE_ALL, so it works where that variable is unset (production).
 *
 * Call AFTER requireAdmin (anonymous → 401 first) and before the handler, so the
 * refusal is the same 403 body for a flag key that exists and one that does not.
 * A null actor passes only when the DEV_OPEN_ADMIN local-dev bypass is really on
 * (re-tested, not inferred from the null; OSE-1801). That bypass is refused on
 * staging and production.
 */
export function requireKeyActor(request: Request, env: AdminObjectScopeEnv): Response | null {
  const actor = extractAdminActor(request, env);
  if (actor === null ? isDevOpenAdmin(env) : actor.startsWith('key:')) return null;
  if (actor === null) logNullAdminActorDenied('key-actor-only', env);
  return Response.json(
    { ok: false, status: 403, code: 'KEY_ACTOR_ONLY', error: 'Forbidden' },
    { status: 403 }
  );
}
