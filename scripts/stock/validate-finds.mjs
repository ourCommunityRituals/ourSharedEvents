// Validates the morning search's finds before anything is built from them.
// Pure but for the injected geocoder: no network here.
// `today` must be a America/Chicago calendar date (YYYY-MM-DD); use chicagoDate(new Date()).
// The 90-day window is judged on each event's Chicago calendar date, never the string prefix.
import * as h3 from 'h3-js';

const RES = 7;
const WINDOW_DAYS = 90;
const TITLE_MAX = 120;
const SUMMARY_MAX = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// explicit offset required: `Z` or +hh:mm / -hh:mm
const START_RE =
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed-width groups only, no backtracking risk
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CHICAGO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The America/Chicago calendar date (YYYY-MM-DD) of an instant. */
export function chicagoDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error('chicagoDate: invalid date');
  return CHICAGO.format(d);
}

// The instant of a well-formed starts_at, or null when it is not a real calendar time.
function startInstant(s) {
  const m = START_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const roundTrips =
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi &&
    Number(m[6] ?? 0) < 60;
  if (!roundTrips) return null;
  const instant = new Date(s);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

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
  if (!startInstant(r.starts_at)) return true;
  return false;
}

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Ray casting; ring 0 is the outer boundary, the rest are holes.
function inPolygon(lng, lat, rings) {
  return inRing(lng, lat, rings[0]) && !rings.slice(1).some((r) => inRing(lng, lat, r));
}

// The first node, in file order, whose boundary polygon holds the point; else undefined.
export function nodeAt(nodes, lat, lng) {
  return nodes.find((n) => {
    const polys = n.polygon.type === 'Polygon' ? [n.polygon.coordinates] : n.polygon.coordinates;
    return polys.some((p) => inPolygon(lng, lat, p));
  })?.id;
}

export async function validateFinds({ finds, eventTypeIds, nodes, today, geocode }) {
  if (!DAY_RE.test(today)) throw new Error('today must be YYYY-MM-DD');

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
    const offset = dayNumber(chicagoDate(startInstant(row.starts_at))) - first;
    if (offset < 0 || offset > WINDOW_DAYS) {
      refuse(row, 'outside-window');
      continue;
    }
    if (!eventTypeIds.has(row.event_type_id)) {
      refuse(row, 'unknown-type');
      continue;
    }

    const key = `${row.venue.toLowerCase().replace(/\s+/g, ' ').trim()}|${row.starts_at}`;
    if (seen.has(key)) {
      refuse(row, 'duplicate');
      continue;
    }

    const point = await geocode(row.address);
    if (!point) {
      refuse(row, 'geocode-failed');
      continue;
    }
    // membership is by boundary polygon, never by cell
    const node = nodeAt(nodes, point.lat, point.lng);
    if (!node) {
      refuse(row, 'not-in-node');
      continue;
    }

    const cell = h3.latLngToCell(point.lat, point.lng, RES);

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
