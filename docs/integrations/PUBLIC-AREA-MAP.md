# The public area map: a note for a reader outside OurSharedEvents

For the OurWKRP creator showcase (`showcase/lib/map.mjs`), the first reader. Story OSE-2039,
decision OSE ADR-033. Source: `workers/oursharedevents/src/handlers/map-areas.ts`.

## The request

```
GET https://stg.oursharedevents.com/api/v2/map/areas?cells=<cell>,<cell>…&around=1
```

| Parameter | Required | Value                                                                                                            |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `cells`   | yes      | 1 to 12 H3 **resolution-7** cell ids, comma-separated. Their order is the numbering. A repeat counts once.       |
| `around`  | no       | `1` fits the frame to each cell's six neighbours too and returns their outlines. `0` or absent: the cells alone. |

No credential, no cookie, no header. Read it at build time, from the build, never from a visitor's
browser (the route sends no CORS header for another site, on purpose).

Production is held closed, so read staging. Staging has no street archive loaded yet
(`docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`); until the owner loads it the answer is
`streets: null`, which the build must handle anyway.

## The answer (200)

```jsonc
{
  "ok": true,
  "status": 200,
  "frame": {
    "projection": "web-mercator",
    "w": 600,
    "h": 360, // always; use it as viewBox="0 0 600 360"
    "scale": 3771283.4, // SVG units per world unit
    "x0": 0.25641,
    "y0": 0.37301, // world coordinates of the top-left corner
  },
  "areas": [
    {
      "cell": "872664570ffffff",
      "n": 1,
      "points": "338.2,61.5 401.9,112.0 …", // six corners, for <polygon points>
      "centre": [300.0, 180.0],
    }, // where the number goes
  ],
  "around": [
    { "cell": "872664571ffffff", "points": "…" }, // [] without around=1
  ],
  "streets": {
    // or null
    "svg": "<g class=\"amap-s\" aria-hidden=\"true\" …>…</g>",
    "css": ".as-l{fill:var(--surface)}…",
    "credit": {
      "html": "<p class=\"amap-credit\" …>Street map data © <a href=\"https://www.openstreetmap.org/copyright/en\">OpenStreetMap</a> contributors, prepared by <a href=\"https://protomaps.com\">Protomaps</a>.</p>",
      "osm": "https://www.openstreetmap.org/copyright/en",
    },
  },
}
```

The frame is Web Mercator with the origin at the top left. A point is
`x = (worldX - x0) * scale`, `y = (worldY - y0) * scale`, where
`worldX = (lng + 180) / 360` and `worldY = 0.5 - ln((1 + sin φ) / (1 - sin φ)) / 4π`.
The showcase does not need this: every outline it draws is already in `points`.

## Filling the showcase map

`mapSvg` today computes its own projection. With this answer it needs none:

```js
const { frame, areas, around, streets } = answer;
const empty = around
  .map((c) => `<polygon class="hex-empty" points="${c.points}"></polygon>`)
  .join('');
const filled = areas
  .map(
    (a) =>
      `<polygon class="hex-area" points="${a.points}"></polygon>` +
      `<text class="hex-number" x="${a.centre[0]}" y="${a.centre[1]}" text-anchor="middle" dominant-baseline="central">${a.n}</text>`
  )
  .join('');
return (
  `<svg class="hex-map" viewBox="0 0 ${frame.w} ${frame.h}" role="img" aria-labelledby="${labelledby}">` +
  `<g class="hex-streets">${streets ? streets.svg : ''}</g>` +
  `<g class="hex-around">${empty}</g><g class="hex-areas">${filled}</g></svg>`
);
```

- Pass the cells in the order the list numbers them; `n` then matches the list.
- `around=1` gives the same neighbours `gridDisk(cell, 1)` gives today.
- The viewBox becomes 600 by 360 (it was 640 by 360). The map scales to its container either way.
- When `streets` is not null:
  - put `streets.css` in the page's stylesheet. It reads the `@ocr/ui` colour tokens `--surface`,
    `--info`, `--border`, `--border-strong`, `--text-muted` and `--bg`;
  - show `streets.credit.html` beside the map. OpenStreetMap's licence asks for it wherever the
    streets show. Without streets, show no credit;
  - make `hex-area` see-through enough that the streets read (the landing uses a fill opacity of
    0.15 to 0.5 over streets).
- When `streets` is null, draw as today: hexagons only. This is a normal answer, not a failure.
- `streets.svg` is markup the Worker built from tile data it escaped. It holds `<g>`, `<rect>`,
  `<path>` and `<text>` only: no link, no script, no address of another host.

## Refusals

All are JSON: `{ "ok": false, "status": 400, "code": "…", "error": "…" }`.

| Code                       | When                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `COORDINATES_NOT_ACCEPTED` | Any of `lat`, `lon`, `lng`, `latitude`, `longitude`, `coords`, `coordinates`, `position`, `geo` is present, in any letter case. |
| `CELLS_REQUIRED`           | No `cells`.                                                                                                                     |
| `CELL_INVALID`             | An entry is not an H3 cell (an empty entry included).                                                                           |
| `CELL_RESOLUTION`          | A cell is not resolution 7.                                                                                                     |
| `TOO_MANY_CELLS`           | More than 12 different cells.                                                                                                   |
| `AROUND_INVALID`           | `around` is not `0` or `1`.                                                                                                     |
| `RATE_LIMITED` (429)       | More than 60 requests in 10 seconds, or 360 in a minute, from one caller. `Retry-After` says how long to wait.                  |

A station with more than 12 areas: draw the first 12, or make more than one request. A build that
reads one map per station stays far under the limit; a build of hundreds of stations should space
its reads to under 6 a second.

## What it never does

It reads no database and nothing about events, scans or people. It takes cells and returns where
those cells are. It sets no cookie and logs nothing about the cells asked for.

## Staging and the edge

Read on 2026-11-14 from a cloud container with no browser: paths under `/api/v2/` reach the Worker
on stg with no header, so a build can read this route. The calendar addresses do not (OSE ADR-028).
The staging Bruno case for this route fails by name if the edge ever challenges it.
