# Runbook: the street-map archive (owner steps)

The landing map draws its streets from one file: an OpenStreetMap archive
(Protomaps build, PMTiles) in an R2 bucket bound to the Worker as `MAP_TILES`
(`lib/street-map.ts`; decision 4 in
[`../positioning/MAPPING-COST-STRUCTURE.md`](../positioning/MAPPING-COST-STRUCTURE.md)).
Owner decisions:

- 2026-11-09: the archive lives on our own Cloudflare account, and **staging gets
  it before production**.
- 2026-11-10: the archive is the **United States subset** of a Protomaps build
  (the 50 states, DC, Puerto Rico and the US Virgin Islands), cut out with
  `pmtiles extract`. This replaces the whole planet chosen on 2026-11-09.
  Areas outside the subset draw hexagons only.

**Every step here is the owner's.** An agent never creates a bucket, never cuts,
loads or downloads the archive, never holds the R2 token, and never touches
production (`AGENTS.md`, Human approval). The check in step 3 only reads a file
on disk: it needs no login and no token, and it uploads nothing.

**One path for both environments.** Staging is loaded first, by the steps below.
Production is loaded later with the same file, checked by the same command, and
is the same file only if its SHA-256 is the one in the staging record (step 3).

## Names

| What                | Staging                 | Production (later, its own PR) |
| ------------------- | ----------------------- | ------------------------------ |
| Bucket              | `ose-map-tiles-staging` | `ose-map-tiles-production`     |
| Object key          | `us-YYYYMMDD.pmtiles`   | the same key, the same file    |
| Binding             | `MAP_TILES`             | `MAP_TILES`                    |
| Setting for the key | `MAP_TILES_ARCHIVE`     | `MAP_TILES_ARCHIVE`            |

`YYYYMMDD` is the date of the Protomaps build the file was cut from.
`wrangler.toml` carries `us-20261109.pmtiles`. If you cut another build, change
that value (both environment blocks) and the commands in steps 2, 3 and 5 in one
PR: `tests/unit/ci/env-parity.test.js` fails when they name different files. The
key must match `^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$` or the Worker refuses it.

## The region

The area kept is [`street-map-us-region.geojson`](street-map-us-region.geojson),
next to this runbook: one GeoJSON feature of five boxes (degrees).

| Box                                   | West   | South | East   | North |
| ------------------------------------- | ------ | ----- | ------ | ----- |
| The 48 contiguous states and DC       | -125.1 | 24.3  | -66.8  | 49.5  |
| Alaska, west of 180°                  | -180.0 | 51.0  | -129.9 | 71.6  |
| Alaska, the Aleutians east of 180°    | 172.0  | 51.0  | 180.0  | 53.5  |
| Hawaii                                | -160.4 | 18.8  | -154.6 | 22.4  |
| Puerto Rico and the US Virgin Islands | -67.4  | 17.6  | -64.5  | 18.6  |

They are boxes, not borders, so a strip of Canada and Mexico along the borders
is inside. Not inside: Guam, the Northern Mariana Islands, American Samoa, and
outliers such as Mona Island and the Hawaiian islands north-west of Niihau.

**Outside the region the map draws hexagons only.** The file holds no detailed
tile there, and the Worker draws no street layer for a frame it has no tile for
(decision 4 in the cost structure, "A layer needs tiles"). No page fails and
nothing is logged as an error. An area that straddles a box's edge draws the
streets of the tiles the file has.

## What the docs say (read 2026-11-09 and 2026-11-10; re-read before you rely on a number)

- **Wrangler cannot load this file.** `wrangler r2 object put` takes files up to
  315 MB. For larger files Cloudflare points to rclone or another S3-compatible
  tool. <https://developers.cloudflare.com/r2/objects/upload-objects/>
- **R2 takes it as a multipart upload.** One object can be 5 TiB; a single-part
  upload stops at 5 GiB; a multipart upload has at most 10,000 parts of 5 MiB to
  5 GiB each. An unfinished multipart upload is aborted after 7 days by default.
  <https://developers.cloudflare.com/r2/platform/limits/>
- **The S3 token.** R2 dashboard, Account Details, API Tokens, Manage. The
  permission "Object Read & Write" can be scoped to chosen buckets. The secret is
  shown once. Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
  <https://developers.cloudflare.com/r2/api/tokens/>
- **rclone.** Version 1.59 or later, `provider = Cloudflare`; with a token
  scoped to objects add `no_check_bucket = true`; the part size is
  `--s3-chunk-size`. <https://developers.cloudflare.com/r2/examples/rclone/>
- **Protomaps.** Daily builds are listed at <https://maps.protomaps.com/builds>.
  The past week's builds are kept, plus the latest of each patch version, so a
  build date older than a week may be gone. The page gives the planet as about
  120 GB; build `20261003` measured 138.5 GB in our proof. We no longer load the
  whole file, only the part cut from it. Its upload
  example is `rclone copyto <file> <remote>:<bucket>/<key> --progress --s3-chunk-size=256M`.
  <https://docs.protomaps.com/basemaps/downloads>, <https://docs.protomaps.com/pmtiles/cloud-storage>
- **Cutting a region (`pmtiles extract`, the go-pmtiles CLI).** Read 2026-11-10.
  The command is `pmtiles extract <input> <output>`; the input may be a file or
  an `https` address, and must be a clustered archive. `--region` takes a local
  GeoJSON file: a Polygon, a MultiPolygon, a Feature or a FeatureCollection.
  `--download-threads` sets the parallel requests (4 by default).
  <https://docs.protomaps.com/pmtiles/cli>
  From the CLI's source (`main.go`, `pmtiles/extract.go`, `pmtiles/bitmap.go` on
  its `main` branch, not on the docs page): `--dry-run` works out the tiles and
  prints the size of the archive without downloading them; tiles are copied as
  they are, so gzip tiles stay gzip, and the new directories are written gzip;
  every parent tile of a kept tile is kept whole, so the low zooms still show the
  land around the region. A region that crosses longitude 180 gets no special
  handling, which is why the Aleutians are two boxes.
- **Builds go away.** Seen on 2026-11-09 by the session that read the real
  file (not on a docs page): `https://build.protomaps.com/20261003.pmtiles`, the
  build our proof used, answers 404; build `20261109` is 139.4 GB; the builds
  still offered are listed, with checksums, at
  <https://build-metadata.protomaps.dev/builds.json>. So the copy we load is the
  copy we keep: there is no going back to Protomaps for an old build, and the
  same file cannot be cut a second time once its build is gone.
- **Cost.** Storage $0.015 per GB-month, first 10 GB free per account. Each
  uploaded part is one Class A operation ($4.50 per million, first million free):
  at 256 MB parts a file is four parts per GB, so the upload itself costs
  nothing. <https://developers.cloudflare.com/r2/platform/pricing/>

## Staging, in order

1. **Check the bucket is private.** The bucket is already there, and you did not
   make it: the PR that added the binding merged before the bucket existed, and
   its staging deploy created `ose-map-tiles-staging`, empty (run 42865404464,
   `T1 Deploy → Staging`, 2026-11-10 17:41 UTC: the log reads "Creating new R2
   Bucket"). Nobody chose its settings, so read them (your terminal, your
   Cloudflare login):

   ```bash
   npx wrangler r2 bucket dev-url get ose-map-tiles-staging
   ```

   ```bash
   npx wrangler r2 bucket domain list ose-map-tiles-staging
   ```

   The first must report the `r2.dev` public URL as off, the second no custom
   domain. If either is on, turn it off before anything is loaded. The Worker is
   the bucket's only reader.

2. **Cut the United States file.** Install the `pmtiles` CLI from
   github.com/protomaps/go-pmtiles, release **v1.31.2** (the version the proof
   and this runbook were written against). Before you unpack it, compare the
   download's SHA-256 with the digest GitHub lists beside that release file; for
   `go-pmtiles_1.31.2_Windows_x86_64.zip` it read
   `a658baa4d7e55020aef6ca17bd9ff9faa1582671266b36f58c52db0ac8e785a1` on
   2026-11-11. Pick a build date at <https://maps.protomaps.com/builds>, and run
   from the root of this repo (git ignores `*.pmtiles`, so the file cannot be
   committed by accident):

   ```bash
   pmtiles extract https://build.protomaps.com/20261109.pmtiles us-20261109.pmtiles --region=docs/runbooks/street-map-us-region.geojson
   ```

   The command reads the build at Protomaps by byte range and writes only the
   region's tiles, so the whole planet is never downloaded. **The size of the
   file is not measured yet.** Run the same command with `--dry-run` added first:
   it prints the archive size without fetching the tiles, which is the free disk
   you need. The file is ours, so Protomaps lists no checksum for it: take its
   SHA-256 yourself (step 3 does), and **keep your own copy**, because the build
   will not stay on their side. `pmtiles show us-20261109.pmtiles` prints the
   header (zoom range, compression, tile entries); step 3 reads the same header
   and more, so it is a second opinion, not the record.

3. **Check the file before it goes anywhere.** From the root of this repo:

   ```bash
   node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261109.pmtiles
   ```

   It reads the file with the Worker's own reader and drawing code
   (`lib/pmtiles.ts`, `lib/street-map.ts`), over the disk instead of R2, and
   uploads nothing. It must end in `PASS`. It checks that:
   - the file is PMTiles v3, vector tiles, gzip, down to the zoom the zoomed
     area reads. The reader unpacks **gzip** only; another compression would
     draw hexagons only;
   - the file is whole: every section ends inside it and the last ends at its
     last byte, so a cut that stopped early fails;
   - every leaf directory can be read, the entries counted match the header, no
     tile points past the tile data, and the largest leaf fits the entries the
     reader keeps (`MAX_LEAF_ENTRIES`);
   - the landing page's own function draws roads for one area in each part of
     the region (Chicago, Seattle, San Diego, Miami, Bangor, Anchorage,
     Honolulu, San Juan) and for the 7-area and 19-area frames, and draws
     nothing for London and Mexico City, which the region leaves out;
   - the file's name is the key `wrangler.toml` reads, in this checkout.

   Add `--cells=<h3>,<h3>` with the areas staging draws today (the `area=`
   links on the staging landing page) to require streets for exactly those.

   It writes `us-20261109.pmtiles.check.json` beside the file: the byte size,
   the SHA-256, the header, the directory layout and each draw. **Keep that
   record with your copy of the file.** Put the build date, the byte size and
   the SHA-256 on the owner-step ticket; the byte size also goes into
   [`../positioning/MAPPING-COST-STRUCTURE.md`](../positioning/MAPPING-COST-STRUCTURE.md),
   which carries it as unmeasured until then. A file that does not pass is not
   uploaded: cut it again. The times in the record are from your disk and say
   nothing about R2.

4. **Create an R2 API token** in the dashboard: "Object Read & Write", scoped to
   `ose-map-tiles-staging` only. Put the key pair in your own rclone config. It
   never goes into chat, a ticket, a file in this repo or an agent's terminal.

5. **Upload** under the dated key:

   ```bash
   rclone copyto us-20261109.pmtiles r2:ose-map-tiles-staging/us-20261109.pmtiles --progress --s3-chunk-size=256M
   ```

   Check that the bucket lists the key at the exact byte size in the record
   from step 3: a smaller object is an upload that stopped. The proof that the
   bytes are right is step 8, the Worker drawing from them.

6. **Delete the token.** The Worker reads through its binding, not the token.

7. **Check the name the Worker reads.** `MAP_TILES_ARCHIVE` on `main`, in both
   environment blocks of `wrangler.toml`, must be the key you uploaded. The
   merge of that name and the upload can come in either order: until both are
   done the Worker finds no object under the name it reads and draws hexagons
   only, as it does today. After both, the next landing request should draw
   streets: a read that found no object is not remembered.

8. **Look at staging.** For areas in the United States, the landing shows
   streets under the hexagons and the OpenStreetMap credit, and a tapped hexagon
   shows its dots over streets. In the run's `T2: Bruno Pages contract` log, the
   two street-map requests print their street assertions and no `NOT RUN` line.

9. **Make the staging cases binding.** One-line PR: `streetMapArchiveLoaded` to
   `"true"` in `bruno/ose-pages/environments/ose-staging.yml`. From then on a
   staging run that draws no streets is red, not a printed `NOT RUN`.

## When the binding lands before the bucket

It did, on staging, on 2026-11-10. Cloudflare's documentation does not say what
`wrangler deploy` does when a binding names a bucket that does not exist; it
documents creating the bucket first. The wrangler this repo pins (4.158.0) has
resource provisioning on by default: the staging deploy listed `MAP_TILES` as a
binding to provision and created the bucket with the deploy token (run
42865404464). So a bucket named in a merged binding is made by CI, with default
settings, which is a provisioning step that belongs to the owner. For
production, create the bucket before the binding PR merges.

With the bucket present and the archive missing, the Worker finds no object and
the map stays hexagons only. The two staging cases then print `NOT RUN`, or fail
once step 9 is done.

## Production, later

Production has no `MAP_TILES` binding, and `scripts/ci/env-parity.mjs` lists that
as an open difference (`--strict`, the check before production is announced,
fails on it). After step 9: create `ose-map-tiles-production` and check it is
private (step 1, with that bucket's name). Take **your kept copy of the file
staging drew from**, run step 3 on it again, and compare the SHA-256 it prints
with the one in the staging record: the same hash is the same file, and anything
else is not loaded. Upload it **under the same key** with a token scoped to the
production bucket only (steps 4 to 6), then one PR adds
`[[env.production.r2_buckets]]` and removes the open entry from `env-parity.mjs`. `tests/unit/ci/env-parity.test.js`
refuses a production binding while `streetMapArchiveLoaded` is not `"true"`.
Loading a bucket is not a launch: production stays closed and no
`PRODUCTION_LIVE` is set.

## Refreshing the archive

Cut the new build with the same region file, upload it under its **own dated
key**, then change `MAP_TILES_ARCHIVE` in both environment blocks, and the
commands in steps 2, 3 and 5, in one PR. Run step 3 on the new file from that
PR's branch, since the check compares the file's name with the key
`wrangler.toml` reads. Never overwrite an object in place: a
running Worker keeps an archive's directories in memory, by key, and would read
the new file with the old directories. Delete the old object only after the new
one has drawn on staging. Changing the region is the same steps with a new
region file.

## Back to hexagons only

- **By PR (the standing way):** remove the `[[env.staging.r2_buckets]]`
  `MAP_TILES` block, remove its open entry from `env-parity.mjs`, and set
  `streetMapArchiveLoaded` to `"false"`. After the deploy the Worker has no
  binding and draws hexagons only.
- **At once, with no deploy:** rename or delete the object in the bucket. The
  Worker finds no archive and draws hexagons only on the next request. The
  staging cases go red if step 9 is done, which is the signal that it is off.

Either way no page fails: with no binding, no archive, no tile for the area, a
damaged file or a read slower than 1.5 s, the map is drawn without streets.

## What is proven, and what is not until the file is on staging

Proven in tests: the reader against a 0.464 GB regional file, and against a
synthetic file laid out as a planet build (two levels of leaf directories, tile
bytes more than 128 GiB in).

Measured once, on 2026-11-09, from a workstation and not from a Worker: the
product's `buildStreetLayer` (as on `main` before the entry budget) read build
`20261109` (139.4 GB) at Protomaps over HTTPS byte ranges and drew it. Ten
areas: zoom 11, 14 reads, 0.88 MB, 1,456 ms from cold. One area: zoom 14, 13
reads, 0.40 MB, 862 ms. So that build's directories, gzip and layer names are
ones the reader handles.

Measured again on 2026-11-10, the same way (a workstation, HTTPS byte ranges,
build `20261109`), after tiles that sit together in the file became one read:

| View                     | Reads, first map | Reads, next map | Bytes, first map    |
| ------------------------ | ---------------- | --------------- | ------------------- |
| One area (zoom 14)       | 3 (was 14)       | 1 (was 12)      | 0.41 MB (unchanged) |
| Seven areas (zoom 12)    | 3 (was 8)        | 1 (was 6)       | 0.77 MB (was 0.42)  |
| Nineteen areas (zoom 11) | 3 (was 8)        | 1 (was 6)       | 0.51 MB (unchanged) |

The 12 tiles of the zoomed area sit back to back in the file. At zoom 12 two gaps
of about 180 KB lie between the tiles and are read through, which is the extra
0.35 MB. The drawing is the same, character for character, in all three.

The time from cold did not change from the workstation: about 1.4 s before and
after. A first map is three round trips one after another (header, leaf
directory, tiles), each about 0.45 s over the internet, and reading the tiles
together removes requests, not round trips. With the network taken out, one
layer took about 15 ms of processing from cold and 9 ms after, in Node on the
workstation. The two leaf directories read held 61,239 entries each (115 KB and
129 KB gzipped, about 0.32 MB unpacked), so the 300,000-entry budget keeps four
of that size.

Every measure above was made on the whole build, at Protomaps. The United States
file holds the same tiles for its area, but `pmtiles extract` writes it new
directories, and the reader has not read that file yet.

Checked on 2026-11-11, with no United States file cut yet: the step 3 check was
run on a generated archive on disk (it passed whole, and failed when one byte
short, when named for another build, and when not PMTiles), and its twelve draws
were aimed at build `20261109` at Protomaps over HTTPS as a stand-in. The ten
inside the region drew roads there (zoom 14, or 13 at Anchorage's latitude, and
zoom 12 for the 7-area and 19-area frames), so those places are ones a correct
cut draws. London and Mexico City drew roads from the whole build, as they must;
in the United States file they must draw nothing. None of this is a measure of
the United States file or of R2.

Still unmeasured:

- the United States file itself: its size, how its directories are laid out
  (how many leaf directories, how many entries in each), and the reader drawing
  from it. Step 3 measures all three on the cut file, before the upload;
- the first map in a new Worker instance, reading from R2. The workstation's
  1.4 s sits just under the 1.5 s limit that turns a slow read into hexagons
  only; it went over the public internet, so it says nothing about R2, and this
  is the number to read on staging first;
- R2 range reads at offsets past 4 GiB through the Worker binding;
- memory in the Worker with many areas read (the reader keeps at most 300,000
  directory entries, about 25 MB by an estimate made in Node), and whether four
  leaf directories are enough for the areas one isolate serves.
