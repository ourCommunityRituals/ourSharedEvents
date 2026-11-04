// Validates the morning search's finds before anything is built from them.
// Pure but for the injected geocoder: no network here.
import * as h3 from 'h3-js';

const RES = 7;
const WINDOW_DAYS = 90;
const TITLE_MAX = 120;
const SUMMARY_MAX = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const START_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/;

const isStr = (v) => typeof v === 'string';
const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

function badShape(r) {
  if (!r || typeof r !== 'object') return true;
  for (const k of [
    'venue',
    'address',
    'event_type_id',
    'starts_at',
    'title',
    'summary',
    'source_url',
  ]) {
    if (!isStr(r[k])) return true;
  }
  if (r.sector !== 'private' && r.sector !== 'public') return true;
  if (r.ends_at !== null && !isStr(r.ends_at)) return true;
  if (!START_RE.test(r.starts_at)) return true;
  return false;
}

export async function validateFinds({ finds, eventTypeIds, nodes, today, geocode }) {
  if (!DAY_RE.test(today)) throw new Error('today must be YYYY-MM-DD');
  const cellToNode = new Map();
  for (const n of nodes) for (const c of n.cells) cellToNode.set(c, n.id);

  const first = dayNumber(today);
  const accepted = [];
  const refused = [];
  const seen = new Set();
  const refuse = (row, reason) => refused.push({ row, reason });

  for (const row of finds) {
    if (badShape(row)) {
      refuse(row, 'bad-shape');
      continue;
    }
    if (row.source_url.trim() === '') {
      refuse(row, 'no-source');
      continue;
    }
    const offset = dayNumber(row.starts_at.match(START_RE)[1]) - first;
    if (offset < 0 || offset > WINDOW_DAYS) {
      refuse(row, 'outside-window');
      continue;
    }
    if (!eventTypeIds.has(row.event_type_id)) {
      refuse(row, 'unknown-type');
      continue;
    }

    const point = await geocode(row.address);
    if (!point) {
      refuse(row, 'geocode-failed');
      continue;
    }
    const cell = h3.latLngToCell(point.lat, point.lng, RES);
    const node = cellToNode.get(cell);
    if (!node) {
      refuse(row, 'not-in-node');
      continue;
    }

    const key = `${row.venue.toLowerCase().replace(/\s+/g, ' ').trim()}|${row.starts_at}`;
    if (seen.has(key)) {
      refuse(row, 'duplicate');
      continue;
    }
    seen.add(key);

    accepted.push({
      ...row,
      title: row.title.slice(0, TITLE_MAX),
      summary: row.summary.slice(0, SUMMARY_MAX),
      node,
      cell,
      lat: point.lat,
      lng: point.lng,
    });
  }

  accepted.sort((a, b) => (a.sector === b.sector ? 0 : a.sector === 'private' ? -1 : 1));
  const acceptedPerNode = {};
  for (const a of accepted) acceptedPerNode[a.node] = (acceptedPerNode[a.node] || 0) + 1;
  return { accepted, refused, acceptedPerNode };
}
