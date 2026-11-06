/* eslint-disable security/detect-non-literal-fs-filename -- every path is a fixed repo file under stock/ or the migrations folder */
// One-time: turn the search of 2026-11-05 (stock/seed/finds.json and
// businesses.json) into the fixed seed the full staging site loads from
// (stock/seed/seed.json). Owner, 2026-11-05: there is no nightly search; this
// ran once, and its output is committed.
//
//   node scripts/stock/make-seed.mjs
//
// Each address is geocoded once with the US Census one-line geocoder and cached
// in stock/seed/geocode-cache.json, so a re-run needs no network. Finds go
// through validateFinds (seed day 2026-11-05, the catalog from the migrations,
// stock/nodes.json, the cached geocoder); businesses get their node from the
// same polygons. Each event keeps its offset in days from the seed day and its
// Chicago local start time, so a load can re-base it (scripts/stock/seed.mjs).
//
// Owner, 2026-11-06: each place holds exactly its total in stock/totals.json
// (the permanent testing totals). A place with more finds is trimmed by
// trimToTotals, keeping the widest mix of event types; nothing is written when a
// place cannot reach its total, or when a deliberately empty node would hold
// anything: the run stops and reports.
import * as nodeFs from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateFinds, validateBusinesses, chicagoDate } from './validate-finds.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEED_DIR = join(ROOT, 'stock', 'seed');
const MIGRATIONS = join(ROOT, 'workers', 'oursharedevents', 'migrations');

export const SEEDED_ON = '2026-11-05';
// Owner, 2026-11-05: Mount Greenwood stays empty, so the under-10 experience can
// be shown by zip.
export const EMPTY_NODES = ['mount-greenwood'];
const CENSUS =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=';
const PACE_MS = 1100;

const CHICAGO_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** The active event type ids the migrations insert into event_type_registry. */
export function catalogIdsFromMigrations(sqlTexts) {
  const ids = new Set();
  for (const sql of sqlTexts) {
    if (!/INTO\s+event_type_registry\s*\(/i.test(sql)) continue;
    for (const m of sql.matchAll(/\(\s*'(etr-[a-z0-9-]+)'\s*,\s*'[A-Z]+-[A-Z0-9]+-\d{3}'/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

/** One accepted find as a seed event: its day offset, Chicago start time and duration. */
export function toSeedEvent(row, seededOn = SEEDED_ON) {
  const start = new Date(row.starts_at);
  const offsetDays = dayNumber(chicagoDate(start)) - dayNumber(seededOn);
  let durationMinutes = null;
  if (typeof row.ends_at === 'string' && row.ends_at !== '') {
    const end = Date.parse(row.ends_at);
    if (!Number.isNaN(end) && end >= start.getTime()) {
      durationMinutes = Math.round((end - start.getTime()) / 60_000);
    }
  }
  return {
    offsetDays,
    localStart: CHICAGO_TIME.format(start),
    durationMinutes,
    venue: row.venue,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    node: row.node,
    sector: row.sector,
    event_type_id: row.event_type_id,
    title: row.title,
    summary: row.summary,
    source_url: row.source_url,
  };
}

/**
 * The seed from the search's rows. Pure but for the injected geocoder.
 * Returns { seed, report }; report.ok is false when the seed must not be written.
 */
/**
 * Trim each node's events to its total, keeping the widest mix of event types:
 * while a node holds more than its total, drop the latest-dated event of its
 * most-repeated type (ties: the type whose latest event is later, then the
 * later title). Deterministic; never adds. Returns { kept, dropped }.
 */
export function trimToTotals(events, totals) {
  const kept = [...events];
  const dropped = [];
  const later = (a, b) =>
    a.offsetDays - b.offsetDays ||
    a.localStart.localeCompare(b.localStart) ||
    a.title.localeCompare(b.title);
  for (const node of Object.keys(totals)) {
    for (;;) {
      const mine = kept.filter((e) => e.node === node);
      if (mine.length <= totals[node]) break;
      const byType = new Map();
      for (const e of mine) {
        if (!byType.has(e.event_type_id)) byType.set(e.event_type_id, []);
        byType.get(e.event_type_id).push(e);
      }
      let pick = null;
      for (const list of byType.values()) {
        const last = list.reduce((x, y) => (later(x, y) >= 0 ? x : y));
        if (
          !pick ||
          list.length > pick.size ||
          (list.length === pick.size && later(last, pick.event) > 0)
        ) {
          pick = { size: list.length, event: last };
        }
      }
      kept.splice(kept.indexOf(pick.event), 1);
      dropped.push(pick.event);
    }
  }
  return { kept, dropped };
}

export async function makeSeed({
  finds,
  businesses,
  eventTypeIds,
  nodes,
  geocode,
  seededOn = SEEDED_ON,
  emptyNodes = EMPTY_NODES,
  // node id -> its exact number of events (stock/totals.json)
  totals,
}) {
  if (!totals || typeof totals !== 'object') throw new Error('makeSeed: totals are required');
  const zipNode = new Map();
  for (const n of nodes) for (const z of n.zips || []) zipNode.set(z, n.id);

  const ev = await validateFinds({ finds, eventTypeIds, nodes, today: seededOn, geocode });
  const refused = ev.refused.map(({ row, reason }) => ({ row, reason }));
  const disagreements = [];
  const noDuration = [];
  const events = [];
  for (const row of ev.accepted) {
    const searched = row.zip ? zipNode.get(row.zip) || null : null;
    if (searched !== row.node) {
      disagreements.push({ title: row.title, address: row.address, searched, polygon: row.node });
    }
    if (emptyNodes.includes(row.node)) {
      refused.push({ row, reason: 'in-empty-node' });
      continue;
    }
    const seedEvent = toSeedEvent(row, seededOn);
    if (row.ends_at && seedEvent.durationMinutes === null) {
      noDuration.push({ title: row.title, starts_at: row.starts_at, ends_at: row.ends_at });
    }
    events.push(seedEvent);
  }
  const { kept, dropped } = trimToTotals(events, totals);
  events.length = 0;
  events.push(...kept);
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  events.sort(
    (a, b) =>
      order.get(a.node) - order.get(b.node) ||
      a.offsetDays - b.offsetDays ||
      a.localStart.localeCompare(b.localStart) ||
      a.title.localeCompare(b.title)
  );

  const biz = await validateBusinesses({ businesses, nodes, geocode });
  const businessRefused = [...biz.refused];
  const seedBusinesses = [];
  for (const b of biz.accepted) {
    if (emptyNodes.includes(b.node)) {
      businessRefused.push({ row: b, reason: 'in-empty-node' });
      continue;
    }
    seedBusinesses.push({
      name: b.name,
      address: b.address,
      lat: b.lat,
      lng: b.lng,
      node: b.node,
      anchor: b.anchor,
    });
  }

  const perNode = Object.fromEntries(nodes.map((n) => [n.id, 0]));
  for (const e of events) perNode[e.node] += 1;
  const problems = [];
  for (const n of nodes) {
    if (emptyNodes.includes(n.id)) {
      if (perNode[n.id] !== 0) problems.push(`${n.id} must be empty, holds ${perNode[n.id]}`);
    } else if (perNode[n.id] !== totals[n.id]) {
      problems.push(`${n.id} has ${perNode[n.id]} events, not its total of ${totals[n.id]}`);
    }
    const anchors = seedBusinesses.filter((b) => b.node === n.id && b.anchor).length;
    if (!emptyNodes.includes(n.id) && anchors === 0) problems.push(`${n.id} has no anchor`);
  }

  return {
    seed: { seededOn, events, businesses: seedBusinesses },
    report: {
      ok: problems.length === 0,
      perNode,
      problems,
      refused,
      businessRefused,
      disagreements,
      noDuration,
      trimmed: dropped.map((e) => ({ node: e.node, title: e.title, offsetDays: e.offsetDays })),
    },
  };
}

/** A geocoder over a cache: a miss asks the Census geocoder once, paced. */
export function cachedCensusGeocoder({ cache, fetchFn, sleep, log = () => {} }) {
  let last = 0;
  return async (address) => {
    if (Object.hasOwn(cache, address)) return cache[address];
    const wait = last + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let point = null;
    try {
      const res = await fetchFn(`${CENSUS}${encodeURIComponent(address)}`);
      if (res.ok) {
        const body = await res.json();
        const match = body && body.result && (body.result.addressMatches || [])[0];
        const c = match && match.coordinates;
        if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
          point = { lat: Number(c.y.toFixed(6)), lng: Number(c.x.toFixed(6)) };
        }
      } else {
        log(`geocoder HTTP ${res.status} for ${address}`);
        return null; // not cached: a server error is not an answer
      }
    } catch (err) {
      log(`geocoder failed for ${address}: ${err.message}`);
      return null;
    }
    cache[address] = point;
    return point;
  };
}

const readJson = (p) => JSON.parse(nodeFs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => nodeFs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

async function main() {
  const cachePath = join(SEED_DIR, 'geocode-cache.json');
  const cache = nodeFs.existsSync(cachePath) ? readJson(cachePath) : {};
  const sqlTexts = nodeFs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => nodeFs.readFileSync(join(MIGRATIONS, f), 'utf8'));
  const geocode = cachedCensusGeocoder({
    cache,
    fetchFn: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  });
  const { seed, report } = await makeSeed({
    finds: readJson(join(SEED_DIR, 'finds.json')),
    businesses: readJson(join(SEED_DIR, 'businesses.json')),
    eventTypeIds: catalogIdsFromMigrations(sqlTexts),
    nodes: readJson(join(ROOT, 'stock', 'nodes.json')).nodes,
    geocode,
    totals: readJson(join(ROOT, 'stock', 'totals.json')).totals,
  });
  const sorted = Object.fromEntries(
    Object.keys(cache)
      .sort()
      .map((k) => [k, cache[k]])
  );
  writeJson(cachePath, sorted);

  const describe = ({ row, reason }) =>
    `  ${reason}: ${(row && (row.title || row.name)) || '?'} @ ${(row && row.address) || '?'}`;
  console.log('Events per node:', JSON.stringify(report.perNode));
  console.log(`Trimmed to stock/totals.json (${report.trimmed.length}):`);
  for (const t of report.trimmed) console.log(`  ${t.node} day ${t.offsetDays}: ${t.title}`);
  console.log(`Refused finds (${report.refused.length}):`);
  for (const r of report.refused) console.log(describe(r));
  console.log(`Refused businesses (${report.businessRefused.length}):`);
  for (const r of report.businessRefused) console.log(describe(r));
  console.log(`Polygon node differs from the searched zip (${report.disagreements.length}):`);
  for (const d of report.disagreements) {
    console.log(`  ${d.title} @ ${d.address}: zip ${d.searched}, polygon ${d.polygon}`);
  }
  for (const n of report.noDuration) {
    console.log(`  kept without a duration (unreadable end or end before start): ${n.title}`);
  }
  if (!report.ok) {
    console.log('STOP, seed.json not written:');
    for (const p of report.problems) console.log(`  ${p}`);
    return 1;
  }
  writeJson(join(SEED_DIR, 'seed.json'), seed);
  console.log(
    `Wrote stock/seed/seed.json: ${seed.events.length} events, ${seed.businesses.length} businesses.`
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`make-seed: ${err.message}`);
      process.exit(1);
    }
  );
}
