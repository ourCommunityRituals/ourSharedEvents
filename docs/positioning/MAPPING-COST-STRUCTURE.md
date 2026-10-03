# Mapping cost structure

> **Rule (PO):** every map feature has a cost line before it ships.
>
> **Status of this file (2026-10-03):** this path was named as existing but was not
> found in any checkout or branch, so it was created during the street-map proof.
> It holds **only the lines measured in that proof**. The lines for today's maps
> (inline-SVG hexagons, the Google Static Maps venue image) are not written yet.

## Street map under the hexagons (proof only, not shipped)

Source: OpenStreetMap through the Protomaps basemap, one PMTiles file in the
project's own R2 bucket, served from the product's own origin. Proof code and
method: `proofs/street-map/README.md`.

### Measured on 2026-10-03

| Item                                 | Measured                                                         |
| ------------------------------------ | ---------------------------------------------------------------- |
| Region                               | west -91.0, south 40.9, east -86.2, north 43.3                   |
| Protomaps build                      | `20261003.pmtiles` (planet file 138.5 GB), basemap v4.15.2       |
| Regional file                        | **464,372,385 bytes (0.464 GB)**, zoom 0–15, 143,442 tiles       |
| Transfer to cut it                   | 487 MB, 124 requests, about 1 minute                             |
| Browser libraries (once per visitor) | 1.27 MB raw, 330 KB gzip (MapLibre GL JS, PMTiles reader, style) |
| Fonts and sprites stored             | 1.9 MB fonts (3 faces, Latin ranges) + 0.1 MB sprites            |
| Tile reads for one first map view    | 6–11 range reads, 91–634 KB (634 KB is downtown Milwaukee)       |

### Cost lines

| Line                    | Rate (Cloudflare list price)                     | This feature                                                                                          |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| R2 storage              | $0.015 per GB-month, first 10 GB free            | 0.464 GB = **$0.007 a month** at list price; **$0** while the account's R2 total stays under 10 GB    |
| R2 reads (Class B)      | $0.36 per million, first 10 million a month free | about 10 per first map view, so the free allowance covers roughly 1 million first views a month       |
| R2 egress               | free                                             | $0                                                                                                    |
| Worker requests         | per the account's Workers plan                   | each tile read is one Worker request: about 10 per first map view, more as the visitor pans and zooms |
| R2 writes (Class A)     | $4.50 per million, first 1 million a month free  | one multipart upload per refresh of the file; negligible                                              |
| Third-party map service | none                                             | $0, and no visitor request leaves the product's origin                                                |

### Not measured yet

- Reads per visit once a visitor pans and zooms (only the first view was measured).
- How much the 24-hour browser cache cuts repeat reads.
- Whether the tile reads can be cached at Cloudflare's edge. The proof answers
  byte ranges (HTTP 206), which the edge cache does not store from a Worker.
- Anything on staging or production: every number above is from a local run.

### Scaling the region

Storage grows with the area covered. The same build for the whole planet is
138.5 GB (about $1.93 a month in R2 at list price, after the free 10 GB).
