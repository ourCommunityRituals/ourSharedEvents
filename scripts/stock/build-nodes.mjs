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

// order is the tie-break order when two boundaries both hold a cell's center
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

const polygonsOf = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (lng, lat, rings) =>
  inRing(lng, lat, rings[0]) && !rings.slice(1).some((r) => inRing(lng, lat, r));
const inGeometry = (lng, lat, geometry) => polygonsOf(geometry).some((p) => inPolygon(lng, lat, p));

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

  const owner = new Map();
  for (const n of NODES) {
    const cells = new Set();
    for (const poly of polygonsOf(geoms[n.id]))
      for (const c of h3.polygonToCells(poly, RES, true)) cells.add(c);
    for (const c of cells) {
      const [lat, lng] = h3.cellToLatLng(c);
      const prev = owner.get(c);
      if (!prev) owner.set(c, n.id);
      else if (!inGeometry(lng, lat, geoms[prev]) && inGeometry(lng, lat, geoms[n.id]))
        owner.set(c, n.id);
    }
  }

  const nodes = NODES.map((n) => ({
    id: n.id,
    name: n.name,
    zips: n.zips,
    cells: [...owner]
      .filter(([, id]) => id === n.id)
      .map(([c]) => c)
      .sort(),
    source: n.kind === 'chicago' ? CHICAGO_URL : TIGER_URL,
  }));
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stock', 'nodes.json');
  await writeFile(out, JSON.stringify({ nodes }, null, 2) + '\n');
  for (const n of nodes) console.log(n.id, n.cells.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
