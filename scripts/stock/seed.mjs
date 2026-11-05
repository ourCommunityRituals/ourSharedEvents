// The fixed seed of the full staging site (stock/seed/seed.json, written once
// by make-seed.mjs). Owner, 2026-11-05: no nightly search; every load re-bases
// the seed's dates to the load day, so each place's count in the 90-day window
// never changes.
//
// Each event keeps its offset in days from the seed day and its Chicago local
// start time. A load places it at load day + offset, at that wall-clock time in
// America/Chicago (DST-safe), and keeps its duration when the seed has one.
import * as h3 from 'h3-js';

const RES = 7;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const SEED_FILE = 'stock/seed/seed.json';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Minutes America/Chicago is ahead of UTC at an instant (-360 in CST, -300 in CDT). */
export function chicagoOffsetMinutes(instant) {
  const p = Object.fromEntries(
    PARTS.formatToParts(instant)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, Number(x.value)])
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** YYYY-MM-DD plus whole days. */
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The instant a Chicago wall-clock time names. On the autumn night a time occurs
 * twice, the first (daylight) one; in the spring gap a time that does not exist
 * is read in standard time, so it lands an hour later on the clock.
 */
export function chicagoInstant(ymd, hhmm) {
  if (!DAY_RE.test(ymd)) throw new Error(`bad day: ${ymd}`);
  const t = TIME_RE.exec(hhmm);
  if (!t) throw new Error(`bad local time: ${hhmm}`);
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Number(t[1]), Number(t[2]));
  for (const offset of [-300, -360]) {
    const instant = new Date(wall - offset * 60_000);
    if (chicagoOffsetMinutes(instant) === offset) return instant;
  }
  return new Date(wall + 360 * 60_000);
}

/** An instant written with its Chicago offset, e.g. 2026-11-07T19:30:00-06:00. */
export function chicagoIso(instant) {
  const offset = chicagoOffsetMinutes(instant);
  const local = new Date(instant.getTime() + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local}${sign}${hh}:${mm}`;
}

const isStr = (v) => typeof v === 'string' && v !== '';

/** Throws unless the seed has the shape make-seed writes. */
export function assertSeed(seed) {
  if (!seed || !DAY_RE.test(String(seed.seededOn))) throw new Error('seed: no seededOn day');
  if (!Array.isArray(seed.events) || !Array.isArray(seed.businesses)) {
    throw new Error('seed: events and businesses must be lists');
  }
  seed.events.forEach((e, i) => {
    const ok =
      e &&
      Number.isInteger(e.offsetDays) &&
      e.offsetDays >= 0 &&
      TIME_RE.test(String(e.localStart)) &&
      (e.durationMinutes === null ||
        (Number.isInteger(e.durationMinutes) && e.durationMinutes >= 0)) &&
      Number.isFinite(e.lat) &&
      Number.isFinite(e.lng) &&
      (e.sector === 'private' || e.sector === 'public') &&
      ['venue', 'address', 'node', 'event_type_id', 'title', 'source_url'].every((k) =>
        isStr(e[k])
      ) &&
      typeof e.summary === 'string';
    if (!ok) throw new Error(`seed: event ${i} is malformed`);
  });
  seed.businesses.forEach((b, i) => {
    const ok =
      b &&
      isStr(b.name) &&
      isStr(b.address) &&
      isStr(b.node) &&
      typeof b.anchor === 'boolean' &&
      Number.isFinite(b.lat) &&
      Number.isFinite(b.lng);
    if (!ok) throw new Error(`seed: business ${i} is malformed`);
  });
}

/** One seed event as the row the build consumes, placed on loadDay + its offset. */
export function rebaseEvent(event, loadDay) {
  const start = chicagoInstant(addDays(loadDay, event.offsetDays), event.localStart);
  const ends =
    event.durationMinutes === null
      ? null
      : chicagoIso(new Date(start.getTime() + event.durationMinutes * 60_000));
  return {
    venue: event.venue,
    address: event.address,
    sector: event.sector,
    event_type_id: event.event_type_id,
    starts_at: chicagoIso(start),
    ends_at: ends,
    title: event.title,
    summary: event.summary,
    source_url: event.source_url,
    node: event.node,
    cell: h3.latLngToCell(event.lat, event.lng, RES),
    lat: event.lat,
    lng: event.lng,
  };
}

/** The seed re-based to a load day: { accepted, businesses } in the build's shape. */
export function rebaseSeed(seed, loadDay) {
  assertSeed(seed);
  if (!DAY_RE.test(String(loadDay))) throw new Error('loadDay must be YYYY-MM-DD');
  return {
    accepted: seed.events.map((e) => rebaseEvent(e, loadDay)),
    businesses: seed.businesses.map((b) => ({
      name: b.name,
      address: b.address,
      node: b.node,
      anchor: b.anchor,
      lat: b.lat,
      lng: b.lng,
    })),
  };
}

/**
 * Events per node in the seed: the only source of how many stock events each
 * place gets. Every id in `nodeIds` is present, 0 when the seed has none there.
 */
export function expectedByNode(seed, nodeIds = []) {
  const out = Object.fromEntries(nodeIds.map((id) => [id, 0]));
  for (const e of seed.events) out[e.node] = (out[e.node] || 0) + 1;
  return out;
}
