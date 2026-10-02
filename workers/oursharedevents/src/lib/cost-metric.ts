/**
 * Aggregate-only, per-operation-TYPE cost metric (COST-301 / OSE-780).
 *
 * WHY THIS EXISTS
 * ---------------
 * The free-forever promise is structurally sustainable only while served-user
 * runtime stays cheap (deterministic Workers compute, ~0 LLM tokens). To keep
 * that honest we need to *see* runtime cost as it scales — before the 100×
 * D1/BigQuery egress watch-item bites (COST-303). This module emits one
 * structured cost line per request, keyed on operation TYPE only.
 *
 * NEVER-WHO GUARANTEE (load-bearing — do not weaken)
 * --------------------------------------------------
 * The emitted payload is a SEALED literal built field-by-field below. It can
 * only ever contain:
 *   - `op`            a keyword-masked route label (NEVER a raw path segment)
 *   - `wallMs`        wall-clock ms for the request
 *   - `d1RowsRead`    summed D1 rows_read
 *   - `d1RowsWritten` summed D1 rows_written
 *   - `d1Queries`     count of D1 statement executions
 *   - `status`        HTTP status code
 * There is no field, and no code path, that can place a user identifier, IP,
 * email, anon-id, token, actor, or raw path segment into the metric. The
 * operation label masks every non-keyword segment to `:x`, so an event slug
 * (which could identify a church) can never surface. This is enforced by the
 * structural invariant `tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts`
 * and the unit boundary test `workers/oursharedevents/tests/cost-metric.spec.ts`.
 *
 * CONTRACT
 * --------
 * The full emitted/forbidden schema, sampling policy, and 100× watch-item are
 * documented in `docs/monitoring/COST-METRIC-CONTRACT.md` (COST-303), bound to
 * this code by `tests/contract/cost-metric-contract.contract.test.js`.
 *
 * HONEST LIMITS (no silent caps — see the contract doc)
 * -----------------------------------------------------
 * - `wallMs` is wall-clock, a proxy for CPU-ms. True CPU-ms comes from
 *   Cloudflare's own billing analytics; we cannot read it in-request.
 * - `d1RowsRead/Written` are captured only from `.run()`/`.all()` results,
 *   which expose `.meta`. D1's `.first()` returns the row directly with no
 *   `.meta`, so rows from `.first()`-only queries are NOT counted (the query
 *   itself is still counted in `d1Queries`).
 * - `d1Queries` counts D1 statement executions only; external `fetch()`
 *   subrequests are not counted here (surfaced via CF analytics instead).
 */

/** The exhaustive set of static path segments the router recognizes. Any
 *  segment NOT in this set is masked to `:x` in the operation label. Missing a
 *  segment only costs label readability (it falls back to `:x`) — it can never
 *  leak, because the default is to mask. Keep in rough sync with router.ts. */
const STATIC_SEGMENTS: ReadonlySet<string> = new Set([
  // API structural
  'api',
  'v2',
  'status',
  'health',
  // events
  'events',
  'backfill-h3-cells',
  'portfolio-rollup',
  'dashboards',
  'operations',
  'corridor',
  'shared-reports',
  'batch',
  'verify-qr',
  'unverify-qr',
  'backup',
  'uploads',
  // admin
  'admin',
  'audit-log',
  'data-subject',
  'erase',
  'geocode',
  'subscribers',
  'security',
  'rate-limit-stats',
  'poster-deployments',
  'backfill-h3',
  // flags
  'flags',
  'apply-tier',
  'current-tier',
  'resolve',
  'tiers',
  // sponsors
  'sponsors',
  'promote',
  'draft',
  'event-types',
  'areas',
  // sponsor-home corner (Epic TRIANGLE, CCR-PR567 L2c)
  'sponsor',
  'home-link',
  'placements',
  'respond',
  // maps / uec
  'maps',
  'venue-image',
  'uec',
  // short prefixes
  'q',
  's',
  'forms',
  'demo',
  // well-known / ui
  '.well-known',
  'openid-configuration',
  'jwks.json',
  'ui-preview',
  'ui.css',
  // page aliases (all render a page surface)
  'about',
  'agenda',
  'analytics',
  'briefing',
  'calendar',
  'create',
  'dashboard',
  'display',
  'flyers',
  'home',
  'info',
  'insights',
  'kiosk',
  'landing',
  'lineup',
  'manage',
  'newsletter',
  'overview',
  'poster',
  'posters',
  'privacy',
  'privacy-policy',
  'public',
  'report',
  'reports',
  'schedule',
  'screen',
  'sharedReport',
  'signage',
  'signup',
  'stats',
  'subscribe',
  'summary',
  'tabletop',
  'tent',
  'tv',
  'welcome',
]);

/**
 * Derive a low-cardinality, identifier-free operation label from the method
 * and pathname. Every path segment that is not a recognized static keyword is
 * replaced with `:x`. Root path is `/`.
 *
 * Examples:
 *   GET  /api/v2/events                     -> "GET /api/v2/events"
 *   GET  /api/v2/admin/events/abc123        -> "GET /api/v2/admin/events/:x"
 *   POST /api/v2/admin/events/xyz/verify-qr -> "POST /api/v2/admin/events/:x/verify-qr"
 *   GET  /events/my-church-picnic-2026      -> "GET /events/:x"   (slug masked)
 *   GET  /q/SOME_QR_TOKEN                    -> "GET /q/:x"        (token masked)
 */
export function normalizeOperation(method: string, pathname: string): string {
  const safeMethod = /^[A-Z]+$/.test(method) ? method : 'OTHER';
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return `${safeMethod} /`;
  const masked = segments.map((seg) => (STATIC_SEGMENTS.has(seg) ? seg : ':x'));
  return `${safeMethod} /${masked.join('/')}`;
}

/** Per-request accumulator of observable D1 cost. Plain counters only. */
export interface CostAccumulator {
  d1RowsRead: number;
  d1RowsWritten: number;
  d1Queries: number;
}

export function createCostAccumulator(): CostAccumulator {
  return { d1RowsRead: 0, d1RowsWritten: 0, d1Queries: 0 };
}

function recordMeta(acc: CostAccumulator, meta: unknown): void {
  if (!meta || typeof meta !== 'object') return;
  const m = meta as { rows_read?: unknown; rows_written?: unknown };
  if (typeof m.rows_read === 'number') acc.d1RowsRead += m.rows_read;
  if (typeof m.rows_written === 'number') acc.d1RowsWritten += m.rows_written;
}

// Maps a wrapped (proxied) prepared statement back to the real one, so that
// statements handed to `db.batch([...])` are unwrapped before reaching the
// native binding (which reads internal slots the proxy would shadow).
const realStatement = new WeakMap<object, D1PreparedStatement>();

function wrapStatement(stmt: D1PreparedStatement, acc: CostAccumulator): D1PreparedStatement {
  const proxy = new Proxy(stmt, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (prop === 'bind') {
        return (...args: unknown[]) =>
          wrapStatement(
            (orig as (...a: unknown[]) => D1PreparedStatement).apply(target, args),
            acc
          );
      }
      if (prop === 'run' || prop === 'all') {
        return async (...args: unknown[]) => {
          const res = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          acc.d1Queries += 1;
          recordMeta(acc, (res as { meta?: unknown } | null)?.meta);
          return res;
        };
      }
      if (prop === 'first' || prop === 'raw') {
        // `.first()`/`.raw()` do not expose `.meta`; count the query only.
        return async (...args: unknown[]) => {
          const res = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          acc.d1Queries += 1;
          return res;
        };
      }
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  });
  realStatement.set(proxy, stmt);
  return proxy as D1PreparedStatement;
}

function wrapD1(db: D1Database, acc: CostAccumulator): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (prop === 'prepare') {
        return (query: string) =>
          wrapStatement((orig as (q: string) => D1PreparedStatement).call(target, query), acc);
      }
      if (prop === 'batch') {
        return async (statements: unknown[]) => {
          const unwrapped = Array.isArray(statements)
            ? statements.map((s) => realStatement.get(s as object) ?? s)
            : statements;
          const res = await (orig as (s: unknown) => Promise<unknown>).call(target, unwrapped);
          if (Array.isArray(res)) {
            acc.d1Queries += res.length;
            for (const r of res) recordMeta(acc, (r as { meta?: unknown } | null)?.meta);
          }
          return res;
        };
      }
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  }) as D1Database;
}

/**
 * Return an env whose D1 bindings (`DB`, `FORMS_DB`) are transparently
 * instrumented to accumulate cost into `acc`. Handlers see an identical D1 API.
 *
 * Fail-safe: instrumentation must never break a request. If wrapping throws for
 * any reason, the ORIGINAL env is returned unchanged (cost simply isn't
 * counted for that request — surfaced honestly, never silently degraded into a
 * broken query path).
 */
export function instrumentEnvForCost<E>(env: E, acc: CostAccumulator): E {
  try {
    const rec = env as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const db = rec['DB'];
    const formsDb = rec['FORMS_DB'];
    if (db && typeof (db as D1Database).prepare === 'function') {
      patch['DB'] = wrapD1(db as D1Database, acc);
    }
    if (formsDb && typeof (formsDb as D1Database).prepare === 'function') {
      patch['FORMS_DB'] = wrapD1(formsDb as D1Database, acc);
    }
    if (Object.keys(patch).length === 0) return env;
    return { ...(env as object), ...patch } as E;
  } catch {
    return env;
  }
}

/** The sealed cost-metric payload. Numbers + a masked op label only. */
export interface OperationCostMetric {
  type: 'OPERATION_COST';
  op: string;
  wallMs: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  d1Queries: number;
  status: number;
}

/** The inputs an emitter is allowed to supply. No request/user object here. */
export interface OperationCostInput {
  op: string;
  wallMs: number;
  acc: CostAccumulator;
  status: number;
}

/**
 * Emit exactly one aggregate-only cost line to Workers Logs.
 *
 * The payload is constructed as an explicit literal with a fixed key set — this
 * is the structural never-who guarantee. Even if a caller's `acc` or `op`
 * somehow carried extra properties, only the allowlisted fields below are read.
 * Never throws (observability must not break a response).
 */
export function emitOperationCost(input: OperationCostInput): void {
  try {
    const payload: OperationCostMetric = {
      type: 'OPERATION_COST',
      op: String(input.op),
      wallMs: Math.max(0, Math.round(input.wallMs)),
      d1RowsRead: input.acc.d1RowsRead,
      d1RowsWritten: input.acc.d1RowsWritten,
      d1Queries: input.acc.d1Queries,
      status: input.status,
    };
    console.log(JSON.stringify(payload));
  } catch {
    /* observability must never break a response */
  }
}
