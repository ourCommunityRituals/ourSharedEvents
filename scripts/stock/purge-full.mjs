// Builds the SQL that removes a manifest's rows for some nodes from the full
// staging site's DB. It never runs SQL: the workflow runs the string with
// `wrangler d1 execute ocr-db-staging-full --env staging-full --remote --file`.
//
// Only ids the manifest recorded are ever named. Child rows go by the parent id
// they hang off (event_id, sponsor id, poster id), so a row the build did not
// record (a scan, a placement, a code) still goes; the events and sponsor
// businesses themselves go only by recorded id. Every statement is
// `DELETE FROM <table> WHERE <column> IN (<non-empty list of quoted ids>)`.

// Ids must look like this before they are put inside a SQL string literal (and,
// for upload keys, on a wrangler command line). Letters, digits and _ : . / - only.
const SAFE_ID = /^[A-Za-z0-9_:./-]{1,200}$/;
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

// Keyed tables the purge leaves alone, each with its reason.
export const PURGE_EXEMPT = {
  export_manifest:
    'append-only audit record of every D1 → OCR boundary crossing (0043); no foreign key, so it never blocks a delete',
  sponsor_business_draft:
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

const DATE_IN_NAME = /(\d{4})-?(\d{2})-?(\d{2})/;
const dateOf = (name) => {
  const m = DATE_IN_NAME.exec(String(name));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * Manifests older than the newest passing one, oldest first. A run that died
 * between build and purge leaves its manifest behind; the next passing day lists
 * it here, so its ids are still purged. A name with no date is never listed.
 */
export function listStaleManifests(names, newestPassing) {
  const cutoff = dateOf(newestPassing);
  if (!cutoff) throw new Error('listStaleManifests: newestPassing has no date');
  return names
    .map((name) => ({ name, date: dateOf(name) }))
    .filter((m) => m.date !== null && m.date < cutoff)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((m) => m.name);
}
