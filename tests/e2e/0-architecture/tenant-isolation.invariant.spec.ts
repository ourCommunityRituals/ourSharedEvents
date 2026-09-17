/**
 * INVARIANT 9: Tenant Isolation
 *
 * Every multi-tenant table must carry brand_id TEXT NOT NULL. Every public
 * query that returns a list of records must scope that list to a single brand.
 * No cross-tenant data leakage through list endpoints.
 *
 * Brain Invariant #9 (tenant_isolation):
 *   - status: partial → live once this spec is in the T0 shard (2026-07-26)
 *   - brain canonical: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
 *
 * Dual-key isolation pattern:
 *   Each tenant entity is identified by both a content ID (UUID) and a brand_id
 *   (lowercase slug). The events table is the primary multi-tenant table. The
 *   NCR tables (node_hierarchy, corridors) also carry brand_id. This pattern
 *   ensures that even if an ID were guessed, the record cannot be used in a
 *   cross-brand context (the brand_id is visible in every projected row).
 *
 * Pyramid coverage for this invariant:
 *   L0 STATIC (this file)   — schema shape: brand_id on multi-tenant tables;
 *                             public list queries use WHERE brand_id = ?;
 *                             INSERT enforces brand_id column
 *   T4 (planned)            — runtime cross-brand isolation spec against
 *                             staging: two brand slugs, verify brand A cannot
 *                             read brand B events from the public list endpoint
 *
 * Design note — single-event GET by ID (handleGetEvent):
 *   The GET /api/v2/events/:id endpoint fetches by WHERE id = ? (UUID) only.
 *   The UUID is unguessable, so cross-brand leakage requires knowing another
 *   brand's event UUIDs. This is an accepted risk at the current OSE phase
 *   (single-brand deployments, no adversarial multi-tenancy). The T4 runtime
 *   spec should verify that the response includes brand_id in the payload so
 *   consumers can detect and reject off-brand responses.
 *
 * Pattern reference: aggregate-only.invariant.spec.ts (same readFileSync
 * L0 structural approach using Playwright with Node fs access).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'migrations');
const EVENTS_HANDLER = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'handlers',
  'events.ts'
);
const ROUTER = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'router.ts');
const HANDLERS_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'handlers');

/**
 * Multi-tenant tables. A SELECT against one of these from a handler must bind
 * brand_id, whatever the handler is called.
 */
const TENANT_TABLES = [
  'events',
  // 'sponsors' was DROPped in migration 0067 — replaced by the split
  // sponsor_business (the brand) + sponsor_placement (brand↔event link).
  'sponsor_business',
  'sponsor_placement',
  'corridors',
  'node_hierarchy',
];

/**
 * Triaged exemptions. Every entry is a query that reads a multi-tenant table
 * without a literal `brand_id = ?`, and a reason it is nonetheless correct.
 * The gate fails on anything NOT in this list, so a new unscoped query is a
 * failure rather than a silent addition — the same shape as the testid-drift
 * baseline.
 *
 * Adding an entry is a decision. Write the reason for the next reader, not for
 * the linter.
 */
const BRAND_SCOPE_EXEMPT: Record<string, string> = {
  'events.ts:335':
    'Admin list. Scoped by `brand_id IN (?, ?)` built dynamically from ' +
    'resolveAdminBrandScopeAsync, so the literal `brand_id = ?` never appears. ' +
    '(Line shifted 255→256 by the OSE-1319 what-url-types import; 256→301 by ' +
    'the 2026-09-16 lifecycle filters — ?status= / ?mine= parsing and the ' +
    'created_by predicate sit above the SELECT; 301→335 by OSE-1344, whose ' +
    'resolveEventType helper + import land above it. Scope enforcement unchanged; ' +
    'behaviourally gated by tests/admin-events-scope.invariant.spec.ts.)',
  'portfolio-rollup.ts:148':
    'Scoped by a dynamic `brandFilter` array assembled above the query; the ' +
    'WHERE clause is interpolated, so the bind is invisible to a static scan.',
  'bigquery.ts:83':
    'OER emission cron. Cross-brand BY DESIGN — OER ingests every brand and ' +
    'answers across them (VISION: products emit, OER ingests). Not reachable ' +
    'from any request path.',
  'bigquery.ts:268':
    'OER emission cron, second read: the 24h recent-events backup joined to the ' +
    'event-type registry for required tags. Cross-brand BY DESIGN, same rationale ' +
    'as bigquery.ts:83; not reachable from any request path. Previously passed the ' +
    'gate via its LEFT JOIN ON-clause (`etr.id = e.event_type_id`), which the ' +
    'CCR-PR567 M3 keyedById tightening no longer accepts as a scope.',
  'sponsors.ts:671':
    'Correlated sub-select keyed by `id = sponsor_placement.event_id` — a ' +
    'join, not an enumeration. Keyed by a column rather than a bind, so the ' +
    'id-key exemption does not match it.',
  // ── sponsor_placement reads (added to TENANT_TABLES 2026-09-16, PR #567). ──
  // Each is a held-key or correlated read, not a cross-brand bulk enumeration.
  'event-stats.ts:74':
    'COUNT of active placements for ONE event, keyed by `event_id = ?` (a ' +
    'caller-held event UUID). A per-event aggregate, not a cross-brand read — ' +
    'same held-key rationale as the single-event GET design note above.',
  'portfolio-rollup.ts:165':
    'COUNT over `event_id IN (?, …)` where the id list is the brand-scoped ' +
    'event set assembled above (the same dynamic brandFilter that exempts ' +
    'portfolio-rollup.ts:148). Not a cross-brand read.',
  'shared-report-read.ts:431':
    'Single-row existence check keyed by `sponsor_business_id = ? AND ' +
    'event_id = ?` (both caller-held ids) — verifies a sponsor belongs to an ' +
    'event before minting a token; not enumeration.',
  'sponsors.ts:508':
    'Admin-flow cache invalidation: SELECT DISTINCT event_id for one sponsor, ' +
    'keyed by `sponsor_business_id = ?` (the held business id from a ' +
    'brand-scoped admin mutation). Not a public read, not cross-brand.',
  'sponsors.ts:1253':
    'Correlated EXISTS subselect keyed by `sp.sponsor_business_id = sb.id`, ' +
    'where the outer `sponsor_business sb` is keyed by `sb.id = ?` (held ' +
    'sponsor id). Scoped to one business; not enumeration.',
};

test.describe('Invariant 9: Tenant Isolation — structural code-shape lock', () => {
  test('OSE-INV9 | security | schema | migration 0001 defines brand_id TEXT NOT NULL on events', () => {
    const migration = join(MIGRATIONS_DIR, '0001_create_events.sql');
    expect(existsSync(migration), '0001_create_events.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    expect(
      sql,
      '0001_create_events.sql must define brand_id TEXT NOT NULL — ' +
        'the events table is the primary multi-tenant surface'
    ).toMatch(/brand_id\s+TEXT\s+NOT\s+NULL/i);
  });

  test('OSE-INV9 | security | schema | migration 0007 creates composite index on (brand_id, status)', () => {
    const migration = join(MIGRATIONS_DIR, '0007_create_indexes.sql');
    expect(existsSync(migration), '0007_create_indexes.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // Composite index on (brand_id, status) is the performance gate for the
    // WHERE brand_id = ? AND status = 'active' query pattern.
    expect(
      sql,
      '0007 must create a composite index on (brand_id, status) — ' +
        'without this index, tenant-scoped public list queries do full table scans'
    ).toMatch(/ON\s+events\s*\(\s*brand_id\s*,\s*status\s*\)/i);
  });

  test('OSE-INV9 | security | schema | migration 0010 carries brand_id on NCR node_hierarchy', () => {
    const migration = join(MIGRATIONS_DIR, '0010_create_ncr_v2_hierarchy.sql');
    expect(existsSync(migration), '0010_create_ncr_v2_hierarchy.sql must exist').toBe(true);
    const sql = readFileSync(migration, 'utf8');
    // NCR tables must be tenant-isolated so reports are brand-scoped.
    const lines = sql.split('\n');
    let inNodeHierarchy = false;
    let foundBrandId = false;
    for (const line of lines) {
      if (/CREATE TABLE.*node_hierarchy/i.test(line)) inNodeHierarchy = true;
      if (inNodeHierarchy && /^\s*\)/i.test(line)) inNodeHierarchy = false;
      if (inNodeHierarchy && /brand_id\s+TEXT\s+NOT\s+NULL/i.test(line)) {
        foundBrandId = true;
        break;
      }
    }
    expect(
      foundBrandId,
      'node_hierarchy table in 0010 must define brand_id TEXT NOT NULL — ' +
        'NCR tables are multi-tenant and must carry tenant scope'
    ).toBe(true);
  });

  test('OSE-INV9 | security | schema | migration 0010 carries brand_id on NCR corridors', () => {
    const migration = join(MIGRATIONS_DIR, '0010_create_ncr_v2_hierarchy.sql');
    const sql = readFileSync(migration, 'utf8');
    const lines = sql.split('\n');
    let inCorridors = false;
    let foundBrandId = false;
    for (const line of lines) {
      if (/CREATE TABLE.*\bcorridors\b/i.test(line)) inCorridors = true;
      if (inCorridors && /^\s*\)/i.test(line)) inCorridors = false;
      if (inCorridors && /brand_id\s+TEXT\s+NOT\s+NULL/i.test(line)) {
        foundBrandId = true;
        break;
      }
    }
    expect(
      foundBrandId,
      'corridors table in 0010 must define brand_id TEXT NOT NULL — ' +
        'corridor data is brand-scoped to prevent cross-tenant report leakage'
    ).toBe(true);
  });

  test('OSE-INV9 | security | query | public list (handleListEvents) uses WHERE brand_id = ? filter', () => {
    expect(existsSync(EVENTS_HANDLER), 'handlers/events.ts must exist').toBe(true);
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // The canonical public list query scopes by both brand AND status.
    expect(
      src,
      'handleListEvents must use WHERE brand_id = ? — ' +
        'the public list is the highest-traffic surface; without this filter every tenant sees every brand'
    ).toMatch(/WHERE\s+brand_id\s*=\s*\?\s+AND\s+status\s*=\s*'active'/i);
  });

  // ── OSE-1242 / CCR H2 ──────────────────────────────────────────────────────
  //
  // The assertion above names ONE function in ONE file. That is how
  // `GET /api/v2/events/map` shipped as a public list query over `events` with
  // no brand_id: it lives in handlers/events-map.ts, so the gate could not see
  // it. The invariant says "public list queries", not "handleListEvents".
  //
  // This scans every handler instead. It is the property, not the subject, so a
  // handler added next month is covered the day it is written rather than the
  // day someone remembers to add it here.
  // The one exemption the FROM/JOIN scan below honours: a tenant-table read is
  // exempt from the brand_id requirement only when it binds a specific id
  // (`id = ?`) — a single-row fetch by an id the caller already holds. A JOIN
  // ON-clause correlated id-equality (`t.id = other.col`) is NOT a scope and
  // must not exempt (CCR-PR567 M3). Self-tested below so the rule can't rot.
  const KEYED_BY_ID_RE = /\b(\w+_id|id)\s*=\s*\?\d*/i;

  test('OSE-INV9 | meta | keyedById accepts a bound id-key but rejects a JOIN ON-clause correlated id', () => {
    // A read bound to a held id (`id = ?`) or FK (`event_id = ?`) reads ONE row
    // / one event, not a brand's rows in bulk — non-enumeration, accepted (the
    // object-scoping gap is OSE-1080). A JOIN ON-clause (`t.id = other.col`) is
    // column-to-column row relation, not a tenant scope, and must NOT exempt.
    expect(KEYED_BY_ID_RE.test('WHERE e.id = ?'), 'single-row fetch by bound id is exempt').toBe(
      true
    );
    expect(KEYED_BY_ID_RE.test('WHERE e.id = ?1'), 'numbered bind is exempt').toBe(true);
    expect(
      KEYED_BY_ID_RE.test('WHERE sp.event_id = ?'),
      'a bound FK scope (event_id = ?) reads one event, not a brand in bulk'
    ).toBe(true);
    expect(
      KEYED_BY_ID_RE.test('JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id'),
      'a JOIN ON-clause is a row relation, not a tenant scope — must NOT exempt'
    ).toBe(false);
    expect(
      KEYED_BY_ID_RE.test('WHERE is_active = ?'),
      'a non-id predicate is not a scope key'
    ).toBe(false);
  });

  test('OSE-INV9 | security | query | EVERY handler SELECT on a tenant table binds brand_id', () => {
    const handlers = readdirSync(HANDLERS_DIR).filter((f) => f.endsWith('.ts'));
    expect(handlers.length, 'handlers directory must not be empty').toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of handlers) {
      const src = readFileSync(join(HANDLERS_DIR, file), 'utf8');

      for (const table of TENANT_TABLES) {
        // Match `FROM <table>` AND `JOIN <table>` (PR #567). A tenant table read
        // through a JOIN is as much a read as through FROM — sponsor_placement /
        // sponsor_business are routinely JOINed onto events across the sponsor
        // handlers, and the FROM-only scan was blind to them. keyedById (below)
        // accepts a bound id-key (`id = ?` / `event_id = ?`) but NOT a
        // column-to-column ON-clause, so a JOIN read that scopes ONLY through
        // its ON-clause and drops its brand/held-id clause genuinely goes red.
        // (CCR-PR567 M3: the earlier "now goes red" claim was FALSE — the
        // ON-clause `t.id = other.col` satisfied the old regex; the OER backup at
        // bigquery.ts:268 that leaned on it is now an explicit exemption.)
        const re = new RegExp('(?:FROM|JOIN)\\s+' + table + '\\b', 'gi');
        for (const m of src.matchAll(re)) {
          // Read a bounded window after the FROM, the way a reviewer does.
          // Matching to a delimiter does not work here: these statements are
          // built from backtick literals, single-quoted strings AND string
          // concatenation, so a non-greedy scan to the next backtick runs past
          // the statement and swallows unrelated code. A window is approximate
          // but it is approximate in a way that is easy to reason about.
          const window = src.slice(m.index!, m.index! + 400);

          // Skip comments. `DELETE FROM events` inside a prose block explaining
          // a cascade is not a query, and a doc comment listing pipeline
          // phases is not a query either — both were false positives on the
          // first run of this gate.
          const lineStart = src.lastIndexOf('\n', m.index!) + 1;
          const linePrefix = src.slice(lineStart, m.index!);
          if (/^\s*(\*|\/\/|\/\*)/.test(linePrefix)) continue;

          // Keyed by a unique id is not enumeration — the risk this invariant
          // addresses is reading a tenant's rows in bulk, not reading one row
          // whose id the caller already holds. Accept ONLY a bound `id = ?`; a
          // correlated-column id-equality is a JOIN ON-clause relating rows,
          // not a tenant scope (CCR-PR567 M3). See KEYED_BY_ID_RE + its self-test.
          const keyedById = KEYED_BY_ID_RE.test(window);
          const bindsBrand = /\bbrand_id\s*=\s*\?\d*/i.test(window);

          if (!bindsBrand && !keyedById) {
            const line = src.slice(0, m.index).split('\n').length;
            const key = `${file}:${line}`;
            if (BRAND_SCOPE_EXEMPT[key]) continue;
            violations.push(`${key} — FROM ${table} with no brand_id and no id key`);
          }
        }
      }
    }

    expect(
      violations,
      'Every handler SELECT that can enumerate a multi-tenant table must bind ' +
        'brand_id. A corridor is a geography and white-label instances share ' +
        'geographies by design, so an unscoped public query hands every ' +
        "brand's rows to every other brand.\n" +
        violations.join('\n')
    ).toEqual([]);
  });

  test('OSE-INV9 | security | insert | CREATE event includes brand_id in column list', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // Every new event row must have a brand_id — the NOT NULL constraint in
    // the migration is the database-level gate; this test asserts that the
    // INSERT statement in code includes brand_id explicitly.
    expect(
      src,
      'INSERT INTO events must name brand_id in the column list — ' +
        'if brand_id were omitted, the insert would fail the NOT NULL constraint at runtime only'
    ).toMatch(/INSERT\s+INTO\s+events\s*\([^)]*brand_id/i);
  });

  test('OSE-INV9 | security | brand_id | brand_id is validated (lowercase alphanumeric) before INSERT', () => {
    const src = readFileSync(EVENTS_HANDLER, 'utf8');
    // Input validation is the entry-point gate — malformed brand IDs (XSS
    // payloads, path traversal attempts) are rejected before they reach D1.
    expect(
      src,
      'events.ts must validate brand_id format — ' +
        'accepting arbitrary brand IDs would allow injection via the tenant key'
    ).toMatch(/brand_id.*must be.*alphanumeric|alphanumeric.*brand_id/i);
  });

  // ── Admin HTTP-Layer Isolation ──────────────────────────────────────────────
  // The data-layer isolation tests above assert brand_id scoping in queries.
  // These tests assert the HTTP-layer complement: every admin route in router.ts
  // must call requireAdmin before executing any handler logic. A route added to
  // the /admin or /api/v2/admin namespace without the guard silently bypasses
  // authentication — exposing event management, PII audit logs, and sponsor data
  // to unauthenticated callers. Closing both layers (data + HTTP) is what makes
  // the tenant isolation contract complete.

  test('OSE-INV9 | security | auth | router.ts imports requireAdmin from auth module', () => {
    expect(existsSync(ROUTER), 'workers/oursharedevents/src/router.ts must exist').toBe(true);
    const src = readFileSync(ROUTER, 'utf8');
    expect(
      src,
      'router.ts must import requireAdmin — the absence of this import means no admin route has an auth guard'
    ).toMatch(/import\s*\{[^}]*requireAdmin[^}]*\}\s*from/);
  });

  test('OSE-INV9 | security | auth | every admin route calls requireAdmin within 20 lines of the route definition', () => {
    const src = readFileSync(ROUTER, 'utf8');
    const lines = src.split('\n');

    // Admin route definitions: lines that define a pathname check for /admin or /api/v2/admin.
    // Covers both exact matches (pathname === '/admin') and regex patterns
    // (const adminXMatch = pathname.match(/^\/api\/v2\/admin/)).
    const adminRoutePattern =
      /pathname\s*(?:===|\.match\s*\()\s*(?:'|"|\/).*\/admin|const\s+admin\w+Match\s*=\s*pathname\.match/;

    const adminRouteLines: number[] = [];
    const requireAdminLines: number[] = [];

    // The OSE-576 admin rate-limit pre-flight references admin paths inside a
    // boolean predicate — `pathname.startsWith('/api/v2/admin') || pathname === '/admin' || ...`.
    // It is a PRE-AUTH guard (rate-limit before paying the auth cost), NOT a
    // route handler, so it is intentionally exempt from the requireAdmin-proximity
    // check. Real admin routes match the pathname with === or .match(), never
    // with .startsWith — so keying the exemption on .startsWith cannot mask a
    // real unguarded route.
    const preAuthRateLimitPredicate = /\.startsWith\(\s*['"]\/api\/v2\/admin/;
    lines.forEach((line, i) => {
      if (preAuthRateLimitPredicate.test(line)) return;
      if (adminRoutePattern.test(line)) adminRouteLines.push(i);
      if (/requireAdmin\s*\(/.test(line)) requireAdminLines.push(i);
    });

    expect(
      adminRouteLines.length,
      'expected at least 10 admin route definitions in router.ts — if this fails the pattern matcher needs updating'
    ).toBeGreaterThan(9);

    // For each admin route definition, assert requireAdmin appears within 20 lines.
    // 20 lines is enough for any single-method handler block; multi-method blocks
    // (like adminEventMatch) have requireAdmin inside each method branch, always
    // within 20 lines of the outer pathname.match check.
    for (const routeLine of adminRouteLines) {
      const hasAuth = requireAdminLines.some((n) => n > routeLine && n <= routeLine + 20);
      expect(
        hasAuth,
        `admin route at line ${routeLine + 1} (${lines[routeLine].trim()}) does not call requireAdmin within the next 20 lines — ` +
          'every /admin and /api/v2/admin route MUST call requireAdmin before any handler logic'
      ).toBe(true);
    }
  });
});
