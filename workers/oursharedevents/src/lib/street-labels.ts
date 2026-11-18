// ─── Street names and landmarks on the street map ──────────────────────────────
//
// The owner, 2026-11-18: "improve the major street names and POI for
// reference". The street layer (lib/street-map.ts) already names towns. This
// module adds two more kinds of name, read from the same tiles:
//
//   - the name of a highway or a major road (a highway by its number, "I-55",
//     when the tile has one), set along the longest straight run of that road
//     in the frame, turned to run with it and never upside down;
//   - a landmark from the tiles' `pois` layer, of a few kinds a stranger can
//     steer by (a park, a station, a hospital, a school, a library…), as a
//     small round mark and its name.
//
// Two tiers (owner, 2026-11-18: more names as you zoom in). Tier 1 is drawn at
// every zoom. Tier 2 is drawn hidden (`as-t2`) and shown by the map's zoom
// (lib/map-pan-style.ts) once the map is at twice its size or more. Map text
// keeps its size on screen as the map grows (the zoom script sets it), so at
// twice the size a name covers half as much of the map: tier 2 is placed
// against every box at half its size.
//
// Names never sit on another name or on a hexagon's number (`taken`). They are
// drawn over the hexagons, not under them (the street layer's `amap-sl`
// group), so a see-through hexagon does not tint them. They take no tap: the
// group is `pointer-events="none"`, so a tap on a name reaches the hexagon.
//
// NEVER WHO. Everything here is read from the archive's tiles for a frame the
// drawn cells chose (lib/street-map.ts). No event and no visitor is read. A
// name is text, escaped; a tile's kind only picks one of the fixed classes.

import { escapeHtml } from './html-escape.js';

/** A box: left, top, right, bottom, in map units. */
export type Box = [number, number, number, number];

export const overlaps = (a: Box, b: Box): boolean =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** A box at `s` of its size, about a point. */
export function shrink(b: Box, s: number, cx: number, cy: number): Box {
  return [cx + (b[0] - cx) * s, cy + (b[1] - cy) * s, cx + (b[2] - cx) * s, cy + (b[3] - cy) * s];
}

/**
 * The room a street name is given, in map units: the largest size it is set in
 * (lib/map-label-style.ts, 28 on a narrow screen, so 13 px or more on a 320 px phone), as LABEL_PX is for towns.
 */
export const STREET_NAME_PX = 28;
/** The same for a landmark's name (28 on a narrow screen too). */
export const LANDMARK_PX = 28;
/** Map units a letter is given across, as a share of its size. */
const LETTER = 0.55;

/** Street names drawn at every zoom, and more once the map is at twice its size. */
export const MAX_STREET_NAMES = 6;
export const MAX_STREET_NAMES_ZOOMED = 16;
/** Landmarks drawn at every zoom, and more once the map is at twice its size. */
export const MAX_LANDMARKS = 4;
export const MAX_LANDMARKS_ZOOMED = 8;
/** Where along a run a name is tried, as a share of its length, in order. */
const ALONG = [0.5, 0.35, 0.65, 0.2, 0.8, 0.08, 0.92] as const;
/** A landmark's name is cut to this many letters, as a hexagon's is. */
export const LANDMARK_MAX_CHARS = 18;
/** A second name for the same road, zoomed in, only this far from the first. */
const SAME_NAME_GAP = 200;

/**
 * The landmark kinds drawn, most useful first. Protomaps `pois` kinds; any
 * other kind is not drawn. A Map, not an object: the kind comes from the tile.
 */
export const LANDMARK_KINDS = new Map<string, number>(
  [
    'train_station',
    'station',
    // Public transport and where to leave the car (owner, 2026-11-18, for
    // attendees aged 55 to 75: "all public transportation"). Every stop kind
    // Protomaps names; a parking lot with no name shows the sign "P".
    'subway_station',
    'light_rail_station',
    'tram_stop',
    'ferry_terminal',
    'bus_station',
    'parking',
    'bus_stop',
    'aerodrome',
    'hospital',
    'university',
    'college',
    'stadium',
    'park',
    'national_park',
    'nature_reserve',
    'zoo',
    'museum',
    'library',
    'townhall',
    'school',
    'cemetery',
    'golf_course',
    'beach',
    'marina',
  ].map((k, i) => [k, i])
);

/** What an unnamed parking lot shows: the sign drivers know in every language. */
export const PARKING_SIGN = 'P';

/** One straight run of a named road, in map units. */
export interface RoadRun {
  text: string;
  /** 0 a highway, 1 a major road. */
  rank: 0 | 1;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Landmark {
  text: string;
  x: number;
  y: number;
  /** LANDMARK_KINDS order, then the tile's min_zoom: lower is drawn first. */
  order: number;
  minZoom: number;
}

/** A highway's number as people say it: "I 55;US 34" is "I-55". */
export function roadText(props: Record<string, unknown>, highway: boolean): string {
  const name = props['name:en'] ?? props.name;
  // A route number only when it looks like one ("I 55", "US 34", "IL 83");
  // anything else in `ref` is not shown.
  const ref = typeof props.ref === 'string' ? props.ref.split(';')[0]!.trim() : '';
  if (highway && /^[A-Z]{1,3}[- ]?\d{1,4}[A-Z]?$/.test(ref))
    return ref.replace(/^([A-Z]{1,3})[- ]?/, '$1-');
  return typeof name === 'string' ? name.trim() : '';
}

/** The longest straight step of a line, or null for a line of one point. */
export function longestRun(
  pts: readonly (readonly [number, number])[]
): [number, number, number, number] | null {
  let best: [number, number, number, number] | null = null;
  let bestLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]!;
    const [x2, y2] = pts[i]!;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > bestLen) {
      bestLen = len;
      best = [x1, y1, x2, y2];
    }
  }
  return best;
}

/** A landmark from a `pois` feature, or null when it is not one this map draws. */
export function landmarkOf(props: Record<string, unknown>, x: number, y: number): Landmark | null {
  const order = LANDMARK_KINDS.get(String(props.kind));
  const named = props['name:en'] ?? props.name;
  const name =
    typeof named === 'string' && named.trim()
      ? named
      : props.kind === 'parking'
        ? PARKING_SIGN
        : '';
  if (order === undefined || !name.trim()) return null;
  const mz = Number(props.min_zoom);
  const t = name.trim();
  const text =
    t.length > LANDMARK_MAX_CHARS ? `${t.slice(0, LANDMARK_MAX_CHARS - 1).trimEnd()}…` : t;
  return { text, x, y, order, minZoom: Number.isFinite(mz) ? mz : 99 };
}

interface Placed {
  markup: string;
  box: Box;
  cx: number;
  cy: number;
}

/** The box a name of `chars` letters takes, set at `px`, turned by `deg`, about its middle. */
function turnedBox(cx: number, cy: number, chars: number, px: number, deg: number): Box {
  const w = chars * px * LETTER;
  const h = px;
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const hw = (w * c + h * s) / 2;
  const hh = (w * s + h * c) / 2;
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

const inside = (b: Box, w: number, h: number) => b[0] >= 0 && b[1] >= 0 && b[2] <= w && b[3] <= h;

/**
 * The phone is the primary screen (owner, 2026-11-18). A phone shows the
 * middle of a wide map: the middle 360 units across where the map is cut to a
 * square (attendee-map.ts, `tall`; map-narrow-style.ts). Names that lie wholly
 * in it are placed first, so the budget of names is spent where a phone sees
 * them; the rest of the frame is named after, for wider screens.
 */
export const PHONE_BAND = 360;
const inBand = (b: Box, w: number) => b[0] >= (w - PHONE_BAND) / 2 && b[2] <= (w + PHONE_BAND) / 2;

/**
 * Choose and draw street names and landmarks. Pure: same input, same markup.
 * `taken` are the boxes already used (hexagon numbers, town names), each with
 * the point it shrinks about.
 */
export function placeLabels(
  w: number,
  h: number,
  runs: readonly RoadRun[],
  landmarks: readonly Landmark[],
  taken: readonly { box: Box; cx: number; cy: number }[]
): string {
  const fx = (v: number) => v.toFixed(0);
  // The best run of each name: highways first, then the longest.
  const sorted = [...runs]
    .map((r) => ({ ...r, len: Math.hypot(r.x2 - r.x1, r.y2 - r.y1) }))
    .sort((a, b) => a.rank - b.rank || b.len - a.len || a.text.localeCompare(b.text));
  const lms = [...landmarks].sort(
    (a, b) => a.minZoom - b.minZoom || a.order - b.order || a.text.localeCompare(b.text)
  );

  const tier1: Placed[] = [];
  const tier2: Placed[] = [];
  const clear = (box: Box, s: number, cx: number, cy: number, also: readonly Placed[]) => {
    const pad = (b: Box, bx: number, by: number) => shrink(b, s, bx, by);
    const mine = pad(box, cx, cy);
    return (
      !taken.some((t) => overlaps(pad(t.box, t.cx, t.cy), mine)) &&
      !also.some((p) => overlaps(pad(p.box, p.cx, p.cy), mine))
    );
  };

  const streetAt = (
    r: (typeof sorted)[number],
    s: number,
    others: readonly Placed[],
    band: boolean
  ) => {
    const chars = r.text.length;
    if (r.len < chars * STREET_NAME_PX * LETTER * s) return null;
    let deg = (Math.atan2(r.y2 - r.y1, r.x2 - r.x1) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    // The middle of the run first, then further along it either way, as long
    // as the whole name still lies on the run: a hexagon's number often sits
    // on the middle of a long road.
    const half = (chars * STREET_NAME_PX * LETTER * s) / 2 / r.len;
    for (const t of ALONG) {
      if (t < half || t > 1 - half) continue;
      const cx = r.x1 + (r.x2 - r.x1) * t;
      const cy = r.y1 + (r.y2 - r.y1) * t;
      const box = turnedBox(cx, cy, chars, STREET_NAME_PX, deg);
      const seen = shrink(box, s, cx, cy);
      if (inside(seen, w, h) && (!band || inBand(seen, w)) && clear(box, s, cx, cy, others)) {
        return { cx, cy, box, deg };
      }
    }
    return null;
  };
  const streetMarkup = (p: { cx: number; cy: number; deg: number }, text: string, t2: boolean) =>
    `<text class="as-n${t2 ? ' as-t2' : ''}" transform="translate(${fx(p.cx)} ${fx(p.cy)}) rotate(${p.deg.toFixed(0)})" text-anchor="middle" dominant-baseline="central">${escapeHtml(text)}</text>`;

  // A mark and its name: after the mark, or before it where that is clear.
  const landmarkAt = (l: Landmark, s: number, others: readonly Placed[], band: boolean) => {
    const wide = 10 + l.text.length * LANDMARK_PX * LETTER;
    for (const after of [true, false]) {
      const box: Box = after
        ? [l.x - 7, l.y - LANDMARK_PX / 2, l.x + wide, l.y + LANDMARK_PX / 2]
        : [l.x - wide, l.y - LANDMARK_PX / 2, l.x + 7, l.y + LANDMARK_PX / 2];
      const seen = shrink(box, s, l.x, l.y);
      if (inside(seen, w, h) && (!band || inBand(seen, w)) && clear(box, s, l.x, l.y, others)) {
        return { box, after };
      }
    }
    return null;
  };
  const landmarkMarkup = (l: Landmark, after: boolean, t2: boolean) =>
    `<g class="as-q${t2 ? ' as-t2' : ''}"><circle class="as-pm" cx="${fx(l.x)}" cy="${fx(l.y)}" r="5"/>` +
    `<text class="as-p" x="${fx(after ? l.x + 10 : l.x - 10)}" y="${fx(l.y)}"${after ? '' : ' text-anchor="end"'} dominant-baseline="central">${escapeHtml(l.text)}</text></g>`;
  // Tier 1: highways, then landmarks, then major streets taking turns
  // between the two ways a grid runs, so a map is not named in one direction
  // only (the longest roads of a wide frame all run across it).
  const named = new Map<string, Placed>();
  let streets1 = 0;
  const nameStreets = (list: readonly (typeof sorted)[number][], band: boolean) => {
    for (const r of list) {
      if (streets1 >= MAX_STREET_NAMES) break;
      if (named.has(r.text)) continue;
      const p = streetAt(r, 1, tier1, band);
      if (!p) continue;
      const placed = { markup: streetMarkup(p, r.text, false), box: p.box, cx: p.cx, cy: p.cy };
      tier1.push(placed);
      named.set(r.text, placed);
      streets1++;
    }
  };
  const across = (r: RoadRun) => Math.abs(r.x2 - r.x1) >= Math.abs(r.y2 - r.y1);
  const rows = sorted.filter((r) => r.rank === 1 && across(r));
  const cols = sorted.filter((r) => r.rank === 1 && !across(r));
  const turns: (typeof sorted)[number][] = [];
  for (let i = 0; i < Math.max(rows.length, cols.length); i++) {
    if (rows[i]) turns.push(rows[i]!);
    if (cols[i]) turns.push(cols[i]!);
  }
  // Each kind in the phone's band first, then anywhere on the frame.
  const highways = sorted.filter((r) => r.rank === 0);
  const seen = new Set<string>();
  let lm1 = 0;
  const nameLandmarks = (band: boolean) => {
    for (const l of lms) {
      if (lm1 >= MAX_LANDMARKS) break;
      if (seen.has(l.text)) continue;
      const at = landmarkAt(l, 1, tier1, band);
      if (!at) continue;
      tier1.push({ markup: landmarkMarkup(l, at.after, false), box: at.box, cx: l.x, cy: l.y });
      seen.add(l.text);
      lm1++;
    }
  };
  for (const band of [true, false]) nameStreets(highways, band);
  for (const band of [true, false]) nameLandmarks(band);
  for (const band of [true, false]) nameStreets(turns, band);
  let streets2 = 0;
  for (const [band, r] of [true, false].flatMap((b) => sorted.map((x) => [b, x] as const))) {
    if (streets2 >= MAX_STREET_NAMES_ZOOMED) break;
    const first = named.get(r.text);
    const mid = [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2] as const;
    if (first && Math.hypot(first.cx - mid[0], first.cy - mid[1]) < SAME_NAME_GAP) continue;
    if (tier2.some((p) => p.markup.includes(`>${escapeHtml(r.text)}<`))) continue;
    const p = streetAt(r, 0.5, [...tier1, ...tier2], band);
    if (!p) continue;
    tier2.push({ markup: streetMarkup(p, r.text, true), box: p.box, cx: p.cx, cy: p.cy });
    if (!first) named.set(r.text, tier2[tier2.length - 1]!);
    streets2++;
  }

  let lm2 = 0;
  for (const [band, l] of [true, false].flatMap((b) => lms.map((x) => [b, x] as const))) {
    if (lm2 >= MAX_LANDMARKS_ZOOMED) break;
    if (seen.has(l.text)) continue;
    const at = landmarkAt(l, 0.5, [...tier1, ...tier2], band);
    if (!at) continue;
    tier2.push({ markup: landmarkMarkup(l, at.after, true), box: at.box, cx: l.x, cy: l.y });
    seen.add(l.text);
    lm2++;
  }
  return [...tier1, ...tier2].map((p) => p.markup).join('');
}
