# Street map proof

**Proof only.** Shows the H3 res-7 hexagons over a self-hosted OpenStreetMap
street map for the Chicago region. It is its own local Worker; the product
Worker, its `wrangler.toml` and every product page are untouched. Do not deploy.

## Run it

```bash
npx wrangler dev --config ../../proofs/street-map/wrangler.toml --port 8799
```

(run from `workers/oursharedevents`, which has wrangler installed).
Then open `http://localhost:8799/`. Useful parameters: `?theme=dark|light`,
`?place=region|riph|sawyer|milwaukee|davenport|kankakee`, `?z=14`.

The data is not committed. To rebuild it:

1. `pmtiles extract https://build.protomaps.com/20261003.pmtiles data/chicago-region.pmtiles --bbox=-91.0,40.9,-86.2,43.3`
   (CLI: github.com/protomaps/go-pmtiles v1.31.2)
2. `wrangler r2 object put ose-map-tiles-proof-local/chicago-region.pmtiles --file data/chicago-region.pmtiles --local`
3. `npm install`, then copy `maplibre-gl.mjs`, `maplibre-gl-shared.mjs`,
   `maplibre-gl-worker.mjs`, `maplibre-gl.css`, `pmtiles.js`, `basemaps.js` into
   `public/vendor/`; fonts and sprites from github.com/protomaps/basemaps-assets
   into `public/fonts/` and `public/sprites/`.

## What is where

| File                  | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `src/tiles.ts`        | Byte-range reads of the PMTiles file from R2                             |
| `src/worker.ts`       | The page, its headers, and cell ids → GeoJSON (h3-js, as today)          |
| `src/demo-cells.json` | Demo res-7 cell ids and demo counts                                      |
| `public/proof.js`     | Browser only: MapLibre, the two styles, the hexagon layers               |
| `scripts/shoot.cjs`   | Screenshots plus load time, tile bytes, CSP violations, third-party hits |
| `screenshots/`        | Output, including `comparison-sheet.png`                                 |

## Content-Security-Policy

The proof page's policy:

```
default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; font-src 'self';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Against the product's public-page policy (`handlers/pages.ts`:
`default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; …`)
the street map needs **no new directive and no new source**:

- MapLibre 6 starts its web worker from a same-origin module file, so there is
  no `blob:` worker and no `'unsafe-eval'`. `worker-src` falls back to
  `script-src 'self'`.
- Tiles, fonts and sprites are fetched from the same origin (`connect-src 'self'`).
- `img-src data:` is needed for MapLibre's control icons; the product already has it.
  `blob:` was tested and is not needed.

One header requirement that is not CSP: the pages send
`Cross-Origin-Embedder-Policy: require-corp`, so the response for
`maplibre-gl-worker.mjs` must carry the same hardening headers or the browser
refuses the worker.

## Never who

- The hexagon layer is built from cell ids only (`cellToBoundary`,
  `cellToLatLng`). No event lat/lon and no viewer location is read; the page
  never calls the geolocation API and `Permissions-Policy` denies it.
- The camera presets in `proof.js` are public town and venue positions used to
  aim the proof. A release would aim the camera from the drawn cells instead.
- New exposure to design for: the byte ranges a browser asks for show **our
  own server** which part of the map that visitor is looking at. No third party
  sees it, but the release must not log tile ranges per request.
