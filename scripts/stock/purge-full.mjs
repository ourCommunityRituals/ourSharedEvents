// Builds the SQL that removes a manifest's rows for some nodes from the full
// staging site's DB. It never runs SQL: the workflow runs the string with
// `wrangler d1 execute ocr-db-staging --env staging --remote --file`.
//
// Only ids the manifest recorded are ever named. Child rows go by the parent id
// they hang off (event_id, sponsor id, poster id), so a row the build did not
// record (a scan, a placement, a code) still goes; the events and sponsor
// businesses themselves go only by recorded id. Every statement is
// `DELETE FROM <table> WHERE <column> IN (<non-empty list of quoted ids>)`.
//
// Every purge operation is idempotent by design. Re-purging a stale manifest
// whose rows or objects are already gone is the normal daily path (a manifest
// stays listed until every node it records has been purged), so a DELETE that
// matches no row, or an R2 delete of a key that is not there (run-day.mjs
// r2Delete), succeeds.

// Ids must look like this before they are put inside a SQL string literal (and,
// for upload keys, on a wrangler command line). Letters, digits and _ : . / - only.
// run-day.mjs holds the acceptance UPDATE to the same rule.
export const SAFE_ID = /^[A-Za-z0-9_:./-]{1,200}$/;
const SAFE_NAME = /^[a-z_]+$/;

// Which manifest items feed which id list. `placement` and `upload` items are
// never embedded in SQL: placements go by event_id and sponsor id, and uploads
// are R2 keys (purgeR2Keys).
const ID_LIST_OF_KIND = { event: 'event', sponsor: 'sponsor', poster: 'poster' };
const KNOWN_KINDS = new Set(['event', 'sponsor', 'poster', 'placement', 'upload']);

// Every table keyed by a manifest id, in delete order: children first, so a
// foreign key never points at a row that is already gone. The migration on each
// line is the one that gives the table its current key column.
// tests/unit/stock/purge-full.test.js reads workers/oursharedevents/migrations/ and
// fails on a keyed table that is in neither this list nor PURGE_EXEMPT.
export const PURGE_TABLES = [
  { table: 'scan_placement_events', column: 'event_id', ids: 'event' }, // 0062
  { table: 'scan_placement_events', column: 'poster_deployment_id', ids: 'poster' }, // 0062
  { table: 'scan_node_returns', column: 'event_id', ids: 'event' }, // 0062
  { table: 'scan_aggregates', column: 'event_id', ids: 'event' }, // 0006
  { table: 'scan_cell_aggregates', column: 'event_id', ids: 'event' }, // 0087
  { table: 'anon_id_returns', column: 'venue_id', ids: 'event' }, // 0031 (venue_id → events.id)
  { table: 'sponsor_displays', column: 'event_id', ids: 'event' }, // 0102
  { table: 'sponsor_displays', column: 'sponsor_id', ids: 'sponsor' }, // 0102 (→ sponsor_business.id)
  { table: 'sponsor_placement', column: 'event_id', ids: 'event' }, // 0067
  { table: 'sponsor_placement', column: 'sponsor_business_id', ids: 'sponsor' }, // 0067
  { table: 'sponsor_asset', column: 'sponsor_business_id', ids: 'sponsor' }, // 0081 (rebuilt from 0066)
  { table: 'sponsor_event_types', column: 'sponsor_id', ids: 'sponsor' }, // 0067 (→ sponsor_business.id)
  { table: 'sponsor_areas', column: 'sponsor_id', ids: 'sponsor' }, // 0067 (→ sponsor_business.id)
  { table: 'shortlinks', column: 'event_id', ids: 'event' }, // 0030
  { table: 'event_codes', column: 'event_id', ids: 'event' }, // 0096
  { table: 'share_opens_daily', column: 'event_id', ids: 'event' }, // 0096
  { table: 'report_access_log', column: 'event_id', ids: 'event' }, // 0043 (aggregate counter, upserted)
  { table: 'poster_deployments', column: 'event_id', ids: 'event' }, // 0003
  // 0033. A series the nightly detector proposed for a stock venue. events.series_id
  // points back here, but the build never sets it (only an admin links a series); if
  // an admin linked one, the foreign key stops the purge rather than orphan the event.
  { table: 'event_series', column: 'venue_id', ids: 'event' }, // 0033 (venue_id → events.id)
  { table: 'events', column: 'id', ids: 'event' }, // 0001
  { table: 'sponsor_business', column: 'id', ids: 'sponsor' }, // 0065
];

// Keyed columns the purge leaves alone, each with its reason. Keyed per column, so a
// new key column on an exempt table still fails the coverage gate.
export const PURGE_EXEMPT = {
  'export_manifest.event_id':
    'append-only audit record of every D1 → OCR boundary crossing (0043); no foreign key, so it never blocks a delete',
  'sponsor_business_draft.event_id':
    "made only by a sponsor's own invite flow, never by the stock build; event_id has no foreign key (0053), and its sponsor_asset_draft children are keyed by draft_token, not a manifest id",
};

function safeId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error('unsafe id in manifest');
  }
  return id;
}

// A SQL string literal. SAFE_ID already refuses quotes; the escape stays as a second guard.
const sqlString = (id) => `'${safeId(id).replace(/'/g, "''")}'`;

function itemsFor(manifest, nodeIds) {
  if (!manifest || !Array.isArray(manifest.items))
    throw new Error('manifest.items must be an array');
  if (!Array.isArray(nodeIds)) throw new Error('nodeIds must be an array');
  const wanted = new Set(nodeIds);
  const chosen = manifest.items.filter((i) => wanted.has(i.node));
  for (const item of chosen) {
    if (!KNOWN_KINDS.has(item.kind)) throw new Error(`unknown manifest item kind: ${item.kind}`);
    safeId(item.id);
  }
  // An id the manifest also records under a node that stays would take that node's row with it.
  const kept = new Set(
    manifest.items.filter((i) => !wanted.has(i.node)).map((i) => `${i.kind}|${i.id}`)
  );
  for (const item of chosen) {
    if (kept.has(`${item.kind}|${item.id}`)) {
      throw new Error(`${item.kind} id also recorded under a node not being purged`);
    }
  }
  return chosen;
}

const unique = (xs) => [...new Set(xs)];

/** SQL deleting the manifest's rows for `nodeIds`. Empty string when there is nothing to delete. */
export function buildPurgeSql(manifest, nodeIds) {
  const lists = { event: [], sponsor: [], poster: [] };
  for (const item of itemsFor(manifest, nodeIds)) {
    const list = ID_LIST_OF_KIND[item.kind];
    if (list) lists[list].push(item.id);
  }
  const statements = [];
  for (const { table, column, ids } of PURGE_TABLES) {
    if (!SAFE_NAME.test(table) || !SAFE_NAME.test(column))
      throw new Error('unsafe table or column');
    const values = unique(lists[ids]);
    if (values.length === 0) continue; // never `IN ()`
    statements.push(
      `DELETE FROM ${table} WHERE ${column} IN (${values.map(sqlString).join(', ')})`
    );
  }
  return statements.map((s) => `${s};\n`).join('');
}

/** The R2 keys of the art uploaded for `nodeIds`, for the workflow to delete. */
export function purgeR2Keys(manifest, nodeIds) {
  return unique(
    itemsFor(manifest, nodeIds)
      .filter((i) => i.kind === 'upload')
      .map((i) => i.id)
  );
}

// A manifest is named for its Chicago date, the GitHub run that built it and the
// run's attempt, so a same-day rerun, or a re-run of the same run (same run id,
// next attempt), gets its own name and orders after the one it replaces.
const MANIFEST_NAME = /^manifest-(\d{4}-\d{2}-\d{2})-(\d{1,20})-(\d{1,6})\.json$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID_RE = /^\d{1,20}$/;
const ATTEMPT_RE = /^[1-9]\d{0,5}$/;

const isCalendarDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * `manifest-YYYY-MM-DD-<runId>-<attempt>.json`. Throws on a bad date, a run id that
 * is not digits, or an attempt that is not a whole number from 1.
 */
export function manifestName(date, runId, attempt) {
  const run = String(runId);
  const att = String(attempt);
  if (typeof date !== 'string' || !DAY_RE.test(date) || !isCalendarDay(date)) {
    throw new Error('manifestName: date must be YYYY-MM-DD');
  }
  if (!RUN_ID_RE.test(run)) throw new Error('manifestName: runId must be digits');
  if (!ATTEMPT_RE.test(att)) throw new Error('manifestName: attempt must be a whole number from 1');
  return `manifest-${date}-${run}-${att}.json`;
}

/** { date, runId, attempt } for an exact manifest name, otherwise null. */
export function parseManifestName(name) {
  const m = typeof name === 'string' ? MANIFEST_NAME.exec(name) : null;
  if (!m || !isCalendarDay(m[1]) || !ATTEMPT_RE.test(m[3])) return null;
  return { date: m[1], runId: m[2], attempt: m[3] };
}

// Order by run start: run id, then attempt, each number as a BigInt (exact for any
// digit count). GitHub gives a later run a larger id. The date is not used: a
// re-run of an older run builds for the day it re-runs, yet it started earlier
// than any run after it (CCR 2026-11-07 L3-08: ordering by date let a re-run
// leave two loads listed).
function compareManifests(a, b) {
  for (const key of ['runId', 'attempt']) {
    const x = BigInt(a[key]);
    const y = BigInt(b[key]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Manifests ordered before the newest passing one, oldest first. A run that died
 * between build and purge leaves its manifest behind; the next passing run lists
 * it here, so its ids are still purged. A same-day rerun, or a re-run attempt of
 * the same run, makes the earlier manifest stale. A name that is not an exact manifest name is never listed.
 */
/** Manifests from a later run (or a later attempt) than this one, oldest first. */
export function listNewerManifests(names, name) {
  const own = parseManifestName(name);
  if (!own) throw new Error('listNewerManifests: name is not a manifest name');
  return names
    .map((n) => ({ name: n, parsed: parseManifestName(n) }))
    .filter((m) => m.parsed !== null && compareManifests(m.parsed, own) > 0)
    .sort((a, b) => compareManifests(a.parsed, b.parsed))
    .map((m) => m.name);
}

export function listStaleManifests(names, newestPassingName) {
  const newest = parseManifestName(newestPassingName);
  if (!newest) throw new Error('listStaleManifests: newestPassingName is not a manifest name');
  return names
    .map((name) => ({ name, parsed: parseManifestName(name) }))
    .filter((m) => m.parsed !== null && compareManifests(m.parsed, newest) < 0)
    .sort((a, b) => compareManifests(a.parsed, b.parsed))
    .map((m) => m.name);
}
