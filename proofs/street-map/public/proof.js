// Proof page script. Browser only; everything it loads is same-origin.
import * as maplibregl from '/vendor/maplibre-gl.mjs';

const { pmtiles, basemaps } = globalThis;
const ARCHIVE = `${location.origin}/tiles/chicago-region.pmtiles`;
const BOUNDS = [-91.0, 40.9, -86.2, 43.3];

// Camera presets for judging the base map. These are public town and venue
// positions used to aim the camera in this proof; they are not event data and
// the hexagon layer never sees them.
const PLACES = {
  region: { name: 'Whole region', center: [-88.6, 42.1], zoom: 6.6 },
  riph: { name: 'Rock Island Public House', center: [-87.6808, 41.651], zoom: 15 },
  sawyer: { name: 'Harbor Country Cabins, Sawyer', center: [-86.6233, 41.8743], zoom: 15 },
  milwaukee: { name: 'Downtown Milwaukee', center: [-87.9085, 43.0402], zoom: 15 },
  davenport: { name: 'Davenport', center: [-90.5752, 41.5217], zoom: 15 },
  kankakee: { name: 'Kankakee', center: [-87.8627, 41.1201], zoom: 15 },
};

// Dark: the Protomaps dark flavor is neutral grey with olive land cover.
// Re-tint every colour onto the product's navy ramp by its brightness, then pin
// land to the page colour (#141F30).
function navy(v) {
  const c = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(v * 0.74 + 6)}${c(v * 0.88 + 12)}${c(v * 1.08 + 26)}`;
}
function brightness(color) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const rgb = hex
    ? hex.slice(1).map((h) => parseInt(h, 16))
    : (color.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number);
  return rgb.length === 3 ? 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2] : null;
}
function retint(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => {
      const b = typeof v === 'string' ? brightness(v) : null;
      return [k, b === null ? v : navy(b)];
    })
  );
}
function darkFlavor() {
  const base = basemaps.namedFlavor('dark');
  const f = { ...retint(base), pois: base.pois, landcover: retint(base.landcover) };
  return {
    ...f,
    background: '#141f30',
    earth: '#141f30',
    water: '#0c1524',
    park_a: '#16303a',
    park_b: '#16303a',
    buildings: '#1a2740',
    other: '#2a3854',
    minor_service: '#2a3854',
    minor_a: '#30405f',
    minor_b: '#30405f',
    link: '#3b4d72',
    major: '#3b4d72',
    highway: '#4b6190',
    bridges_minor: '#30405f',
    bridges_major: '#3b4d72',
    bridges_highway: '#4b6190',
    city_label: '#c3cde0',
    subplace_label: '#93a1ba',
    roads_label_major: '#a9b4c6',
    roads_label_minor: '#8493ad',
    state_label: '#6d7c97',
    city_label_halo: '#141f30',
    subplace_label_halo: '#141f30',
    roads_label_major_halo: '#141f30',
    roads_label_minor_halo: '#141f30',
  };
}

function styleFor(theme) {
  const flavor = theme === 'light' ? lightFlavor() : darkFlavor();
  return {
    version: 8,
    glyphs: `${location.origin}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${location.origin}/sprites/${theme === 'light' ? 'light' : 'dark'}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${ARCHIVE}`,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: basemaps.layers('protomaps', flavor, { lang: 'en' }),
  };
}

// Light: the Protomaps white flavor, with roads, water and labels darkened
// enough to read on white.
function lightFlavor() {
  return {
    ...basemaps.namedFlavor('white'),
    water: '#d3dae4',
    buildings: '#eceef2',
    other: '#e1e4ea',
    minor_service: '#e1e4ea',
    minor_a: '#d9dde4',
    minor_b: '#d9dde4',
    link: '#c6ccd6',
    major: '#c6ccd6',
    highway: '#b0b8c6',
    bridges_minor: '#d9dde4',
    bridges_major: '#c6ccd6',
    bridges_highway: '#b0b8c6',
    railway: '#c9ced6',
    city_label: '#16202e',
    subplace_label: '#4b5563',
    roads_label_major: '#4b5563',
    roads_label_minor: '#5f6875',
    state_label: '#8a93a1',
  };
}

// The hexagons: the same drawing rule as lib/corridor-map.ts. A cell under the
// floor is a dashed outline with no number.
function addHexes(map, theme) {
  const accent = theme === 'light' ? '#2f4fd6' : '#7c9cff';
  const data = JSON.parse(document.getElementById('hex-data').textContent);
  const layers = map.getStyle().layers;
  // Tint goes under the roads; outlines and numbers go under the place names.
  const underRoads = layers.find((l) => l.id.startsWith('roads_'))?.id;
  const underLabels = layers.find((l) => l.type === 'symbol')?.id;
  map.addSource('hexes', { type: 'geojson', data: data.cells });
  map.addSource('hex-counts', { type: 'geojson', data: data.counts });
  map.addLayer(
    {
      id: 'hex-fill',
      type: 'fill',
      source: 'hexes',
      filter: ['==', ['get', 'shown'], true],
      // Strong when the whole region is in view, a light wash at street level.
      paint: {
        'fill-color': accent,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['*', ['get', 'opacity'], 0.7],
          13,
          ['*', ['get', 'opacity'], 0.14],
        ],
      },
    },
    underRoads
  );
  map.addLayer(
    {
      id: 'hex-line',
      type: 'line',
      source: 'hexes',
      filter: ['==', ['get', 'shown'], true],
      paint: { 'line-color': accent, 'line-width': 2 },
    },
    underLabels
  );
  map.addLayer(
    {
      id: 'hex-suppressed',
      type: 'line',
      source: 'hexes',
      filter: ['==', ['get', 'shown'], false],
      paint: {
        'line-color': theme === 'light' ? '#6b7280' : '#a9b4c6',
        'line-width': 1.5,
        'line-dasharray': [3, 2],
      },
    },
    underLabels
  );
  map.addLayer({
    id: 'hex-count',
    type: 'symbol',
    source: 'hex-counts',
    // Below zoom 8.5 a res-7 cell is a few pixels wide: no room for a number.
    minzoom: 8.5,
    maxzoom: 13,
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-font': ['Noto Sans Medium'],
      'text-size': 18,
    },
    paint: {
      'text-color': theme === 'light' ? '#16202e' : '#ffffff',
      'text-halo-color': theme === 'light' ? '#ffffff' : '#141f30',
      'text-halo-width': 2,
    },
  });
}

const params = new URLSearchParams(location.search);
const status = document.getElementById('status');
let theme =
  params.get('theme') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
let place = PLACES[params.get('place')] ? params.get('place') : 'region';

// Screenshot aids: ?z= overrides the zoom, ?frame=WxH sizes the map box.
const zoomOverride = Number(params.get('z')) || null;
const frame = /^([0-9]{2,4})x([0-9]{2,4})$/.exec(params.get('frame') ?? '');
if (frame) {
  const box = document.getElementById('map');
  box.style.width = `${frame[1]}px`;
  box.style.height = `${frame[2]}px`;
  box.style.minHeight = '0';
}

maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

const map = new maplibregl.Map({
  container: 'map',
  style: styleFor(theme),
  center: PLACES[place].center,
  zoom: zoomOverride ?? PLACES[place].zoom,
  minZoom: 5.5,
  maxZoom: 17,
  maxBounds: [
    [BOUNDS[0] - 1, BOUNDS[1] - 1],
    [BOUNDS[2] + 1, BOUNDS[3] + 1],
  ],
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  preserveDrawingBuffer: params.has('shot'),
});
// In a thumbnail-sized frame the credit collapses to its (i) button and the
// zoom buttons are left out; the credit is still on the map.
const small = frame && Number(frame[1]) < 400;
map.addControl(new maplibregl.AttributionControl({ compact: Boolean(small) }));
if (!small) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.on('style.load', () => addHexes(map, theme));
map.on('error', (e) => {
  status.textContent = `Map error: ${e.error?.message ?? 'unknown'}`;
});
map.on('idle', () => {
  document.documentElement.dataset.mapIdle = 'true';
});

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme');
  btn.textContent = theme === 'light' ? 'Dark map' : 'Light map';
  btn.setAttribute('aria-pressed', String(theme === 'light'));
}
applyTheme();
document.getElementById('theme').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  applyTheme();
  map.setStyle(styleFor(theme));
});

const nav = document.getElementById('places');
for (const [key, p] of Object.entries(PLACES)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = p.name;
  b.dataset.testid = `place-${key}`;
  if (key === place) b.setAttribute('aria-current', 'true');
  b.addEventListener('click', () => {
    nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
    b.setAttribute('aria-current', 'true');
    map.jumpTo({ center: p.center, zoom: p.zoom });
  });
  nav.append(b);
}
