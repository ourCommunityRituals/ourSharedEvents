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
// CCR-PR567 re-run item 4 — lib/ reads tenant tables too (reporting corridor,
// DataProvider seam, sponsor resolver, draft-expiry cron); scan it as well.
const LIB_DIR = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'lib');

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
  // 0082 (VISION §6.2b): per-brand corridor latch. Every read must bind brand_id.
  'corridor_readiness_latch',
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
// Keys are dir-qualified (`handlers/<file>:line` / `lib/<file>:line`) because two
// basenames collide across the scanned dirs (feature-flags.ts,
// shared-report-export.ts), so a bare basename would be ambiguous (CCR-PR567
// re-run item 4).
const BRAND_SCOPE_EXEMPT: Record<string, string> = {
  'lib/corridor-latch.ts:68':
    'Nightly corridor latch (runCorridorLatch, index.ts scheduled — no request, ' +
    'no caller brand). `INSERT OR IGNORE … SELECT brand_id, h3_res7 FROM events … ' +
    'GROUP BY brand_id, h3_res7 HAVING COUNT(*) >= 5`: grouped BY brand, and each ' +
    'latch row is written under its own brand_id, so no brand’s count ever mixes ' +
    'with another’s. Same shape as the other brand-agnostic cron readers. The ' +
    'request-path read (readLatchedCorridors) binds brand_id. (Line shifted ' +
    '43→55 by the OSE-1508 settled-events rule, then 55→68 by the landing area ' +
    'latch: its header comment, the LIST_MAX import and LANDING_AREA_LATCH_KEY ' +
    'land above the SELECT.)',
  'lib/corridor-latch.ts:94':
    'Nightly landing area latch (latchLandingAreas, called by the same ' +
    'runCorridorLatch — no request, no caller brand). `INSERT OR IGNORE … SELECT ' +
    'brand_id, ?, ? FROM events … GROUP BY brand_id HAVING COUNT(*) >= 10`: one ' +
    'count per brand, written as one row under that brand’s own brand_id, so no ' +
    'brand’s events count toward another’s landing page. Nothing is returned to ' +
    'a caller. The request-path read (readLatches) binds brand_id.',
  'handlers/events.ts:399':
    'Admin list. Scoped by `brand_id IN (?, ?)` built dynamically from ' +
    'resolveAdminBrandScopeAsync, so the literal `brand_id = ?` never appears. ' +
    '(Line shifted 255→256 by the OSE-1319 what-url-types import; 256→301 by ' +
    'the 2026-09-16 lifecycle filters — ?status= / ?mine= parsing and the ' +
    'created_by predicate sit above the SELECT; 301→335 by OSE-1344, whose ' +
    'resolveEventType helper + import land above it; 335→336 by OSE-1313, whose ' +
    'event-datetime import (isValidIanaTimezone/zonedDateTimeToUtcIso) lands above ' +
    'it; 336→370 by the "Soonest first" slice — the admin-events-upcoming import ' +
    'and the ?sort= / cursor parsing sit above the SELECT; 370→371 by OSE-869, whose ' +
    'one-line event-settings import lands above it; 371→373 by the publish grace ' +
    'window, whose publish-grace import and EventsEnv field land above it; ' +
    '373→383 by OSE-1560, whose map-default / event-settings imports land above it, ' +
    'then →394 by OSE-1522, whose sponsor-titles import and the `sponsor_titles` block in the ' +
    'public list handler land above it; 394→399 by OSE-1644, whose ' +
    'logCoreValuesRefused import widens the core-values import above it. Scope ' +
    'enforcement unchanged; ' +
    'behaviourally gated by tests/admin-events-scope.invariant.spec.ts.)',
  'handlers/portfolio-rollup.ts:185':
    'Scoped by a dynamic `brandFilter` array assembled above the query; the ' +
    'WHERE clause is interpolated, so the bind is invisible to a static scan. ' +
    '(Line shifted 148→185 by the 2026-10-01 architecture review, whose ' +
    'IN_LIST_CHUNK + perEventCounts helper lands above the handler.)',
  'handlers/bigquery.ts:83':
    'OER emission cron. Cross-brand BY DESIGN — OER ingests every brand and ' +
    'answers across them (VISION: products emit, OER ingests). Not reachable ' +
    'from any request path.',
  'handlers/bigquery.ts:311':
    'OER emission cron, second read: the 24h recent-events backup joined to the ' +
    'event-type registry for required tags. Cross-brand BY DESIGN, same rationale ' +
    'as bigquery.ts:83; not reachable from any request path. (Re-keyed 268→280 by OSE-616: the h3_res7 column + corridor guard sit above it; 280→296 by the backup-scope fix, whose BACKUP_LISTED_EVENTS_SQL + publish-grace import land above it; 296→311 by the listed check in the on-demand route, which lands above it.) Previously passed the ' +
    'gate via its LEFT JOIN ON-clause (`etr.id = e.event_type_id`), which the ' +
    'CCR-PR567 M3 keyedById tightening no longer accepts as a scope.',
  'handlers/sponsors.ts:671':
    'Correlated sub-select keyed by `id = sponsor_placement.event_id` — a ' +
    'join, not an enumeration. Keyed by a column rather than a bind, so the ' +
    'id-key exemption does not match it.',
  // ── sponsor_placement reads (added to TENANT_TABLES 2026-09-16, PR #567). ──
  // Each is a held-key or correlated read, not a cross-brand bulk enumeration.
  'handlers/event-stats.ts:74':
    'COUNT of active placements for ONE event, keyed by `event_id = ?` (a ' +
    'caller-held event UUID). A per-event aggregate, not a cross-brand read — ' +
    'same held-key rationale as the single-event GET design note above.',
  'handlers/portfolio-rollup.ts:203':
    'COUNT over `event_id IN (?, …)` where the id list is the brand-scoped ' +
    'event set assembled above (the same dynamic brandFilter that exempts ' +
    'portfolio-rollup.ts:185). Not a cross-brand read. (Line shifted 165→203 ' +
    'by the 2026-10-01 architecture review: the same held-id IN list, now ' +
    'chunked under the D1 100-bound-parameter cap via perEventCounts.)',
  'handlers/shared-report-read.ts:431':
    'Single-row existence check keyed by `sponsor_business_id = ? AND ' +
    'event_id = ?` (both caller-held ids) — verifies a sponsor belongs to an ' +
    'event before minting a token; not enumeration.',
  'handlers/sponsors.ts:508':
    'Admin-flow cache invalidation: SELECT DISTINCT event_id for one sponsor, ' +
    'keyed by `sponsor_business_id = ?` (the held business id from a ' +
    'brand-scoped admin mutation). Not a public read, not cross-brand.',
  // Line-sensitive: shifted 1253→1259 when create began returning placement_id
  // (the response block grew). Bump on any edit above this read in sponsors.ts.
  'handlers/sponsors.ts:1259':
    'Correlated EXISTS subselect keyed by `sp.sponsor_business_id = sb.id`, ' +
    'where the outer `sponsor_business sb` is keyed by `sb.id = ?` (held ' +
    'sponsor id). Scoped to one business; not enumeration.',
  // OSE-1438: the card's on-show rule moved out of handlers/sponsor-card.ts
  // (formerly exempt at :64, same reasoning) into one shared SQL fragment, so the
  // card page and the resolver's card_url read the same rule.
  'lib/sponsor-card.ts:128':
    'SPONSOR_ON_SHOW_SQL, a boolean fragment, never a query on its own. Its ' +
    '`sponsor_placement sp_show` sub-select is correlated by ' +
    "`sp_show.sponsor_business_id = sb.id` to the caller's outer " +
    '`sponsor_business sb`, and both callers fence that row: the card page by ' +
    '`sb.id = ?` (held sponsor id), the resolver by `sp.event_id = ?` (Path 1) or ' +
    '`sb.brand_id = ?` (Path 2). Asks "is this one sponsor on show"; not ' +
    'enumeration. Line-sensitive: bump on any edit above it in that file.',
  'lib/sponsor-card.ts:132':
    'Same fragment: the nested `events e_show` check is keyed by ' +
    '`e_show.id = sp_show.event_id AND e_show.brand_id = sb.brand_id`, so it only ' +
    "reads the one event each placement points at, inside the sponsor's own brand.",
  // ── src/lib reads (scan extended to lib/ 2026-09-17, CCR-PR567 re-run item 4). ──
  // The reporting corridor, the sponsor resolver and the draft-expiry cron read
  // tenant tables from lib/. Each is a scheduled BI/aggregation job (cross-brand
  // BY DESIGN — a corridor is a shared geography, and OER ingests every brand),
  // a never-who geographic aggregate, or a correlated/transitively-scoped
  // subselect — never a request-reachable per-brand row enumeration.
  'lib/draft-expiry.ts:102':
    'Stale-draft archival cron (runDraftExpiry). SELECTs drafts across ALL ' +
    'brands by age — correct for a scheduled sweep. Not request-reachable; the ' +
    'paired UPDATE is keyed by `id = ?`. Cross-brand BY DESIGN, OER-cron class.',
  'lib/draft-expiry.ts:114':
    'Same cron, the future-dated COUNT(*) that is skipped from expiry. Cross-' +
    'brand by design, not request-reachable.',
  'lib/draft-expiry.ts:150':
    'Same cron, AUD-3 Phase B: `INSERT INTO admin_audit_log ... SELECT ... FROM ' +
    'events e WHERE e.id IN (?, …)` over exactly the ids this run just archived ' +
    '(UPDATE … RETURNING id), to write one brand-attributed audit row per event. ' +
    'Held ids, not enumeration; not request-reachable.',
  'lib/shared-report.ts:233':
    'materializeAnonIdReturns cron — `SELECT id, … FROM events WHERE status=active ' +
    'AND substr(COALESCE(end_date, start_date),1,10) BETWEEN ? AND ?` (calendar-day ' +
    'window incl. start-only events, then the real ' +
    'end instant via phaseTimesFor — OSE-616; re-keyed 157→167). Cross-brand ' +
    'geographic baseline input; the output is never-who anon-return aggregates. ' +
    'Not request-reachable.',
  'lib/shared-report.ts:362':
    'refreshCorridorBaselines cron — aggregates by `COALESCE(LOWER(h3_res7), ' +
    'corridor_id)` across brands. A corridor is a shared geography by design; ' +
    'never-who (COUNT DISTINCT anon hash). Not request-reachable.',
  'lib/shared-report.ts:553':
    'detectEventSeriesClusters cron — brand/venue/day/hour event-count baseline, ' +
    'GROUPED BY brand_id (OSE-1421: a series never groups events across brands), ' +
    'count-floored (HAVING event_count >= ?). Never-who; not request-reachable.',
  // OSE-1421: the two series-lookup subselects that were exempt here (:583, :607) now
  // bind `AND brand_id = ?` themselves, so they no longer need an exemption.
  'lib/shared-report.ts:748':
    // 666→673 by OSE-1460 (country cleanup statement added above; the
    // country-code twin query at :687 was removed with top_country).
    'aggregateScanBuckets cron — scan_node_returns grouped by event/geo, inner ' +
    '`SELECT id FROM events WHERE start_date >= ?` is a cross-brand time window. ' +
    'Never-who scan aggregate; not request-reachable.',
  // OSE-1459: aggregateScanCells (scans at the poster's own res9 cell). Same
  // cron class as aggregateScanBuckets (:740). Keys re-keyed after main's OSE-1459
  // and OSE-1460 (#737) merged together; the backfill moved 895/896/899 -> 943/944/947.
  'lib/shared-report.ts:854':
    'aggregateScanCells cron — COUNT of scans at posters with no cell yet (skipped, ' +
    'counted on a later run), for `event_id IN (SELECT id FROM events WHERE start_date ' +
    '>= ?)` (a cross-brand time window). Place-side count only, never-who; not ' +
    'request-reachable.',
  'lib/shared-report.ts:880':
    'Same cron — DELETE of the window before the atomic re-insert, so a corrected ' +
    'poster location never double-counts. Same time window, same rationale.',
  'lib/shared-report.ts:903':
    'Same cron — the single INSERT ... SELECT that rebuilds the window: ' +
    'scan_placement_events joined to poster_deployments, grouped by the poster res9 ' +
    'cell. Place-side scan COUNT only, never-who. Same time window, same rationale.',
  'lib/shared-report.ts:951':
    'backfillH3Cells cron — `UPDATE scan_aggregates SET h3 = (SELECT h3 FROM ' +
    'events WHERE id = scan_aggregates.event_id)`, a correlated per-row geo ' +
    'backfill (id = column, not a bind). Not enumeration, not request-reachable.',
  'lib/shared-report.ts:952':
    'Same backfill statement, the h3_res7 correlated subquery. Same rationale.',
  'lib/shared-report.ts:955':
    'Same backfill statement, the EXISTS guard correlated by ' +
    '`id = scan_aggregates.event_id`. Same rationale.',
  // 322→339 and 729→790 by OSE-616 + OSE-1459 (corridorKeyOf helper above; the key is
  // now COALESCE(LOWER(h3_res7), corridor_id) to match the baseline writer).
  'lib/shared-report-builder.ts:341':
    'Corridor-neighbour COUNT keyed by `COALESCE(LOWER(h3_res7), corridor_id) = ?` ' +
    '(a geography) with `venue_id = ?` held ids. Cross-brand geographic aggregate ' +
    'by design; never-who (COUNT DISTINCT anon_id_hash).',
  // OSE-1421: the series-instance read (was :800) now binds `brand_id = ?` itself.
  // Line-sensitive: 263→296 and 513→554 for OSE-616 (emitRow guard + corridor
  // coverage + ran fields above these queries; corridor_id now COALESCE(h3_res7, …)).
  // 296→303 and 554→611 by the PR #726 follow-ups (import list + withheld
  // legacy-keyed baseline rows + duplicate canonical key check +
  // whole-timestamp-group baseline read). 303→368 and 611→708 by OSE-1460 (the
  // returns phase now aggregates to k-floored corridor counts before export).
  // 392→388 and 735→752 when the merge with main moved the query and the
  // baseline export gained its count floor (OSE-1460 follow-up). 388→418 and
  // 752→797 when the returns snapshot query became paged (review follow-up);
  // 418→419 and 797→805 for the paging-limit test seam.
  // 454→473 and 849→870 for the weekly snapshot claim (PR 741 review);
  // 473→490 and 870→894 when the claim became a compare-and-set;
  // 490→493 and 894→897 for the fail-closed skew check.
  'lib/shared-report-export.ts:493':
    'BigQuery/OER export (runSharedReportBigQueryExport, index.ts scheduled) — ' +
    'anon_id_returns joined to event geo metadata over a 90-day window across ALL ' +
    'brands, then aggregated to k-floored corridor counts (OSE-1460): no anon hash ' +
    'or venue leaves. OER ingests every brand by design; not request-reachable.',
  'lib/shared-report-export.ts:897':
    'Same OER export, the event_series emission twin. Cross-brand by design.',
  // Line-sensitive: shifted 223→228 when the class-doc was rewritten to the
  // asymmetric ADR-019 model (CCR-PR567 re-run item 10). Bump on any edit to
  // sponsor-resolver.ts above this query. 228→252 for OSE-1316/1317 (the
  // publicWebsiteUrl helper + sidebar_logo_url above it; the subselect now sits
  // inside COALESCE(..., sb.tier) so a pool sponsor with no placement keeps its tier).
  // 267→272 by the ADR-019 amendment comment (PR #700, sponsor-initiated
  // placements) in the resolver header. Query unchanged.
  // 272→277 by OSE-1438 (the CardableRow type above the resolver, and the
  // has_card column in this SELECT list). Query scope unchanged.
  'lib/sponsor-resolver.ts:277':
    'Path-2 (dark-at-launch, SPONSOR_GEO_MATCH_ENABLED off) tier subselect ' +
    '`SELECT sp2.tier FROM sponsor_placement sp2 WHERE sp2.sponsor_business_id = ' +
    'sb.id` — correlated to the outer `sponsor_business sb`, which IS brand-fenced ' +
    '(`sb.brand_id = ?`). Reads one business latest tier; not enumeration. ' +
    '(Line shifted 252→267 by 0083, which added display_name / address_line to ' +
    'the Path-1 SELECT and SponsorRow above it. Scope unchanged.)',
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
  // exempt from the brand_id requirement only when it is keyed by a HELD ENTITY
  // id — the PK `id`, or a foreign key to another tenant entity's unguessable
  // UUID PK (`event_id`, `sponsor_business_id`, …). Binding one reads a single
  // held entity's rows — a fetch by an id the caller already holds — not a
  // brand's rows in bulk.
  //
  // What is NOT a scope, and must NOT exempt:
  //   - a JOIN ON-clause correlated id (`t.id = other.col`) — a row relation,
  //     not a bind (CCR-PR567 M3);
  //   - a SHARED-DIMENSION FK (`event_type_id`, `template_id`, `category_id`) —
  //     binding it enumerates that dimension across EVERY brand (CCR-PR567 re-run
  //     item 3). The earlier `\w+_id` wildcard exempted these, silently green-
  //     lighting a cross-brand read.
  // So the allowlist is explicit entity keys, not a `\w+_id` wildcard. A `\b`
  // anchors the start so `some_event_id` / a trailing `_id` cannot partial-match;
  // the safe default for an unknown key is "falls through to brand_id". Self-
  // tested below so the rule can't rot.
  const HELD_ID_KEY_COLUMNS = [
    'id', // PK of any tenant table — one row
    'event_id', // held event UUID — one event's rows
    'sponsor_business_id', // held sponsor-business UUID — one sponsor's rows
    'sponsor_placement_id', // held placement UUID
    'placement_id', // alt placement key
    'sponsor_id', // legacy/alt sponsor key
  ];
  const KEYED_BY_ID_RE = new RegExp(
    '\\b(?:' + HELD_ID_KEY_COLUMNS.join('|') + ')\\s*=\\s*\\?\\d*',
    'i'
  );

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
    // CCR-PR567 re-run item 3 — the old `\w+_id` wildcard exempted ANY column
    // ending in _id, including a SHARED-DIMENSION foreign key. But binding a
    // shared dimension enumerates across brands: `WHERE event_type_id = ?`
    // returns every brand's events of that type. Only a held ENTITY id (the PK
    // `id`, or a FK to another tenant entity's unguessable UUID PK) reads one
    // held entity's rows. Narrow to an explicit held-key allowlist so a
    // dimension FK falls through to the brand_id requirement.
    expect(
      KEYED_BY_ID_RE.test('WHERE event_type_id = ?'),
      'a shared-dimension FK (event_type_id) enumerates across brands — NOT a held-id scope'
    ).toBe(false);
    expect(
      KEYED_BY_ID_RE.test('WHERE template_id = ?'),
      'a shared-dimension FK (template_id) enumerates across brands — NOT a held-id scope'
    ).toBe(false);
    expect(
      KEYED_BY_ID_RE.test('WHERE category_id = ?'),
      'a shared-dimension FK (category_id) enumerates across brands — NOT a held-id scope'
    ).toBe(false);
    expect(
      KEYED_BY_ID_RE.test('WHERE sponsor_business_id = ?'),
      'a held sponsor-business UUID reads ONE sponsor, not a brand in bulk — exempt'
    ).toBe(true);
  });

  test('OSE-INV9 | security | query | EVERY handler + lib SELECT on a tenant table binds brand_id', () => {
    // CCR-PR567 re-run item 4 — scan src/lib too, not just src/handlers. The
    // reporting corridor (shared-report*.ts), the DataProvider seam, the sponsor
    // resolver and the draft-expiry cron all read tenant tables from lib/, and a
    // handlers-only scan was structurally blind to them. Keys are dir-qualified.
    const SCAN_DIRS: Array<{ label: string; dir: string }> = [
      { label: 'handlers', dir: HANDLERS_DIR },
      { label: 'lib', dir: LIB_DIR },
    ];

    const violations: string[] = [];

    for (const { label, dir } of SCAN_DIRS) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
      expect(files.length, `${label} directory must not be empty`).toBeGreaterThan(0);

      for (const file of files) {
        const src = readFileSync(join(dir, file), 'utf8');

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
          // bigquery.ts:311 that leaned on it is now an explicit exemption.)
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
              const key = `${label}/${file}:${line}`;
              if (BRAND_SCOPE_EXEMPT[key]) continue;
              violations.push(`${key} — ${table} read with no brand_id and no held-id key`);
            }
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
