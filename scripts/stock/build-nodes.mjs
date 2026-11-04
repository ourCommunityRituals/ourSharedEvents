/* eslint-disable security/detect-non-literal-fs-filename -- paths are a mkdtemp dir and a fixed repo path */
// One-off generator for stock/nodes.json. Run: node scripts/stock/build-nodes.mjs
// Downloads public boundary GeoJSON into a temp dir outside the repo, parses it only
// as JSON, converts each boundary to H3 res 7 cells, and writes stock/nodes.json.
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h3 from 'h3-js';

const RES = 7;
const CHICAGO_URL = 'https://data.cityofchicago.org/resource/igwz-8jzy.geojson';
const TIGER_BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query';
const TIGER_QUERY =
  "where=STATE%3D'17'%20AND%20BASENAME%20IN%20('Blue%20Island'%2C'Evergreen%20Park'%2C'Oak%20Lawn')" +
  '&outFields=NAME%2CBASENAME%2CGEOID&outSR=4326&f=geojson';
const TIGER_URL = `${TIGER_BASE}?${TIGER_QUERY}`;

// Order is the fixed node order. Each boundary is simplified independently, so shared borders
// can end up with small gaps and overlaps; a point in two polygons goes to the first node in
// this order (see nodeAt in validate-finds.mjs).
const NODES = [
  { id: 'blue-island', name: 'Blue Island', zips: ['60406'], kind: 'tiger', match: 'Blue Island' },
  { id: 'beverly', name: 'Beverly', zips: ['60643'], kind: 'chicago', match: 'BEVERLY' },
  {
    id: 'auburn-gresham',
    name: 'Auburn Gresham',
    zips: ['60620'],
    kind: 'chicago',
    match: 'AUBURN GRESHAM',
  },
  {
    id: 'evergreen-park',
    name: 'Evergreen Park',
    zips: ['60805'],
    kind: 'tiger',
    match: 'Evergreen Park',
  },
  { id: 'oak-lawn', name: 'Oak Lawn', zips: ['60453'], kind: 'tiger', match: 'Oak Lawn' },
  {
    id: 'mount-greenwood',
    name: 'Mount Greenwood',
    zips: ['60655'],
    kind: 'chicago',
    match: 'MOUNT GREENWOOD',
  },
];

async function download(url, dir, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const text = await res.text();
  const file = join(dir, name);
  await writeFile(file, text);
  return JSON.parse(await readFile(file, 'utf8')); // data only, never executed
}

const TOLERANCE = 0.0002; // degrees, Douglas-Peucker
const round = (n) => Math.round(n * 1e5) / 1e5;

const polygonsOf = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [
    ...douglasPeucker(pts.slice(0, idx + 1), tol).slice(0, -1),
    ...douglasPeucker(pts.slice(idx), tol),
  ];
}

// A closed ring simplified; null when it collapses below a triangle.
function simplifyRing(ring) {
  const open = ring.slice(0, -1);
  // split at the farthest point so a closed loop is simplified as two open runs
  let far = 0;
  let max = -1;
  open.forEach((p, i) => {
    const d = Math.hypot(p[0] - open[0][0], p[1] - open[0][1]);
    if (d > max) {
      max = d;
      far = i;
    }
  });
  const a = douglasPeucker(open.slice(0, far + 1), TOLERANCE);
  const c = douglasPeucker([...open.slice(far), open[0]], TOLERANCE);
  const pts = [...a.slice(0, -1), ...c.slice(0, -1)].map(([x, y]) => [round(x), round(y)]);
  if (pts.length < 3) return null;
  return [...pts, pts[0]];
}

function simplifyGeometry(geometry) {
  const polys = [];
  for (const rings of polygonsOf(geometry)) {
    const outer = simplifyRing(rings[0]);
    if (!outer) continue;
    polys.push([outer, ...rings.slice(1).map(simplifyRing).filter(Boolean)]);
  }
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'ose-stock-boundaries-'));
  const chicago = await download(CHICAGO_URL, dir, 'chicago-community-areas.geojson');
  const tiger = await download(TIGER_URL, dir, 'tiger-places.geojson');

  const geoms = {};
  for (const n of NODES) {
    const feats =
      n.kind === 'chicago'
        ? chicago.features.filter((f) => String(f.properties.community).toUpperCase() === n.match)
        : tiger.features.filter((f) => f.properties.BASENAME === n.match);
    if (feats.length !== 1) throw new Error(`${n.id}: expected 1 boundary, found ${feats.length}`);
    geoms[n.id] = feats[0].geometry;
  }

  const nodes = NODES.map((n) => {
    const polygon = simplifyGeometry(geoms[n.id]);
    const cells = new Set();
    for (const poly of polygonsOf(polygon)) {
      for (const c of h3.polygonToCellsExperimental(
        poly,
        RES,
        h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
        true
      ))
        cells.add(c);
    }
    return {
      id: n.id,
      name: n.name,
      zips: n.zips,
      cells: [...cells].sort(),
      polygon,
      source: n.kind === 'chicago' ? CHICAGO_URL : TIGER_URL,
    };
  });
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stock', 'nodes.json');
  await writeFile(out, JSON.stringify({ nodes }) + '\n');
  for (const n of nodes) console.log(n.id, n.cells.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
