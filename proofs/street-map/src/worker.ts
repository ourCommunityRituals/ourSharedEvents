// PROOF ONLY — H3 res-7 hexagons over a self-hosted OpenStreetMap street map.
//
// Three things are served, all from this origin:
//   GET /                              the proof page (strict CSP, no inline script)
//   GET /tiles/chicago-region.pmtiles  byte ranges of the street-map file in R2
//   GET /vendor/* /fonts/* /sprites/*  MapLibre, fonts, sprites (static assets)
//
// The hexagons come from cell ids alone (cellToBoundary), the same rule as
// lib/attendee-map.ts: no event lat/lon and no viewer location is read.
// h3-js is the one library imported here, and the product Worker already loads
// it; MapLibre and the PMTiles reader run in the browser only.

import { cellToBoundary, cellToLatLng, getResolution, isValidCell } from 'h3-js';
import demoCells from './demo-cells.json';
import { handleTileRange, type TilesEnv } from './tiles';

interface Env extends TilesEnv {
  ASSETS: Fetcher;
}

const CORRIDOR_RES = 7;
/** Same floor as CORRIDOR_MAP_MIN_COUNT: cells under it draw outlined, uncounted. */
const MIN_COUNT = 5;

// Mirrors lib/security-headers.ts HARDENING_HEADERS. The map's web worker is a
// same-origin module script; under COEP it must carry these headers too.
const HARDENING: Record<string, string> = {
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Every directive is 'self' or tighter. See README.md for the diff against the
// product's public-page policy.
const PROOF_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

interface DemoCell {
  cell: string;
  count: number;
  label?: string;
}

/** Cell ids → GeoJSON. Suppressed cells carry no count and get no label. */
function hexGeoJson(cells: readonly DemoCell[]): unknown {
  const valid = cells.filter((c) => isValidCell(c.cell) && getResolution(c.cell) === CORRIDOR_RES);
  const max = Math.max(...valid.map((c) => c.count), 1);
  const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });
  return {
    cells: fc(
      valid.map((c) => {
        const shown = c.count >= MIN_COUNT;
        return {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [cellToBoundary(c.cell, true)] }, // [lng, lat]
          properties: shown
            ? { shown: true, opacity: 0.25 + 0.65 * (c.count / max) }
            : { shown: false },
        };
      })
    ),
    // One label per cell, at the cell's own centre (cellToLatLng: from the id).
    counts: fc(
      valid
        .filter((c) => c.count >= MIN_COUNT)
        .map((c) => {
          const [lat, lng] = cellToLatLng(c.cell);
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { count: c.count },
          };
        })
    ),
  };
}

function page(): Response {
  // JSON inside a non-executing data block; `<` is escaped so it cannot close it.
  const data = JSON.stringify(hexGeoJson(demoCells as DemoCell[])).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Street map proof — OurSharedEvents</title>
<link rel="stylesheet" href="/vendor/maplibre-gl.css">
<link rel="stylesheet" href="/proof.css">
</head>
<body>
<header class="bar">
  <h1>Street map proof</h1>
  <p class="note">Not a product page. Demo counts. Hexagons are a few square kilometres, never a street address.</p>
  <nav aria-label="Jump to a place" class="places" id="places"></nav>
  <button type="button" id="theme" class="btn" data-testid="theme-toggle" aria-pressed="false">Light map</button>
</header>
<main>
  <div id="map" data-testid="street-map" role="region" aria-label="Street map with event areas drawn as hexagons"></div>
  <p id="status" role="status" class="note"></p>
  <noscript><p class="note">The street map needs JavaScript. The release version must show the plain hexagon map here instead.</p></noscript>
</main>
<script type="application/json" id="hex-data">${data}</script>
<script src="/vendor/pmtiles.js"></script>
<script src="/vendor/basemaps.js"></script>
<script type="module" src="/proof.js"></script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PROOF_CSP,
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      ...HARDENING,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/') return page();

    const tile = /^\/tiles\/([a-z0-9-]+\.pmtiles)$/.exec(pathname);
    if (tile) return handleTileRange(request, env, tile[1]!);

    const asset = await env.ASSETS.fetch(request);
    const res = new Response(asset.body, asset);
    for (const [k, v] of Object.entries(HARDENING)) res.headers.set(k, v);
    return res;
  },
};
