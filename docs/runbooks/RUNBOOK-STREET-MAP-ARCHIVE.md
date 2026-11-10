# Runbook: the street-map archive (owner steps)

The landing map draws its streets from one file: an OpenStreetMap archive
(Protomaps build, PMTiles) in an R2 bucket bound to the Worker as `MAP_TILES`
(`lib/street-map.ts`; decision 4 in
[`../positioning/MAPPING-COST-STRUCTURE.md`](../positioning/MAPPING-COST-STRUCTURE.md)).
Owner decisions, 2026-11-09: the archive is the **whole planet**, it lives on our
own Cloudflare account, and **staging gets it before production**.

**Every step here is the owner's.** An agent never creates a bucket, never loads
or downloads the archive, never holds the R2 token, and never touches production
(`AGENTS.md`, Human approval).

## Names

| What                | Staging                   | Production (later, its own PR) |
| ------------------- | ------------------------- | ------------------------------ |
| Bucket              | `ose-map-tiles-staging`   | `ose-map-tiles-production`     |
| Object key          | `planet-YYYYMMDD.pmtiles` | the same key, the same build   |
| Binding             | `MAP_TILES`               | `MAP_TILES`                    |
| Setting for the key | `MAP_TILES_ARCHIVE`       | `MAP_TILES_ARCHIVE`            |

`YYYYMMDD` is the Protomaps build date. `wrangler.toml` carries
`planet-20261109.pmtiles` as a placeholder; if you load another build, change
that value (both environment blocks) before the binding PR merges. The key must
match `^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$` or the Worker refuses it.

## What the docs say (read 2026-11-09; re-read before you rely on a number)

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
  120 GB; build `20261003` measured 138.5 GB in our proof. Its upload
  example is `rclone copyto <file> <remote>:<bucket>/<key> --progress --s3-chunk-size=256M`.
  <https://docs.protomaps.com/basemaps/downloads>, <https://docs.protomaps.com/pmtiles/cloud-storage>
- **Builds go away.** Seen on 2026-11-09 by the session that read the real
  file (not on a docs page): `https://build.protomaps.com/20261003.pmtiles`, the
  build our proof used, answers 404; build `20261109` is 139.4 GB; the builds
  still offered are listed, with checksums, at
  <https://build-metadata.protomaps.dev/builds.json>. So the copy we load is the
  copy we keep: there is no going back to Protomaps for an old build.
- **Cost.** Storage $0.015 per GB-month, first 10 GB free per account. Each
  uploaded part is one Class A operation ($4.50 per million, first million free):
  at 256 MB parts the planet is about 520 parts, so the upload itself costs
  nothing. <https://developers.cloudflare.com/r2/platform/pricing/>

## Staging, in order

1. **Create the bucket** (your terminal, your Cloudflare login):

   ```bash
   npx wrangler r2 bucket create ose-map-tiles-staging
   ```

   Leave it private: no `r2.dev` public URL and no custom domain. The Worker is
   its only reader.

2. **Get the build.** Pick a build date at <https://maps.protomaps.com/builds> and
   download the planet file to a disk with about 150 GB free. Check the download
   against the checksum Protomaps lists for that build, and **keep your own
   copy**: the build will not stay on their side. Record on the owner-step
   ticket the build name, its byte size, its checksum, and what
   `pmtiles show <file>` prints (CLI: github.com/protomaps/go-pmtiles): the zoom
   range, the compression of tiles and directories, and the tile entry count.
   The reader reads **gzip** only; a build with other compression draws hexagons
   only.

3. **Create an R2 API token** in the dashboard: "Object Read & Write", scoped to
   `ose-map-tiles-staging` only. Put the key pair in your own rclone config. It
   never goes into chat, a ticket, a file in this repo or an agent's terminal.

4. **Upload** under the dated key:

   ```bash
   rclone copyto 20261109.pmtiles r2:ose-map-tiles-staging/planet-20261109.pmtiles --progress --s3-chunk-size=256M
   ```

   Check that the bucket lists the key at the exact byte size of the file.

5. **Delete the token.** The Worker reads through its binding, not the token.

6. **Confirm the two names on the binding PR** (bucket and key), then merge it.
   CI deploys staging. Do not merge first: see "If the binding lands before the
   bucket".

7. **Look at staging.** The landing shows streets under the hexagons and the
   OpenStreetMap credit, and a tapped hexagon shows its dots over streets. In the
   run's `T2: Bruno Pages contract` log, the two street-map requests print their
   street assertions and no `NOT RUN` line.

8. **Make the staging cases binding.** One-line PR: `streetMapArchiveLoaded` to
   `"true"` in `bruno/ose-pages/environments/ose-staging.yml`. From then on a
   staging run that draws no streets is red, not a printed `NOT RUN`.

## If the binding lands before the bucket

Do not find out on `main`. Cloudflare's documentation does not say what
`wrangler deploy` does when a binding names a bucket that does not exist; it
documents creating the bucket first. The wrangler this repo pins (4.158.0) has
resource provisioning on by default, and its code tries to create a missing
named bucket with the deploy token. So the likely result is an empty bucket made
by CI, which is a provisioning step that belongs to the owner, or a failed
staging deploy if the token may not create buckets. Neither was run.

With the bucket present and the archive missing, the Worker finds no object and
the map stays hexagons only. The two staging cases then print `NOT RUN`, or fail
once step 8 is done.

## Production, later

Production has no `MAP_TILES` binding, and `scripts/ci/env-parity.mjs` lists that
as an open difference (`--strict`, the check before production is announced,
fails on it). After step 8: create `ose-map-tiles-production`, load the **same
build under the same key**, then one PR adds `[[env.production.r2_buckets]]` and
removes the open entry from `env-parity.mjs`. `tests/unit/ci/env-parity.test.js`
refuses a production binding while `streetMapArchiveLoaded` is not `"true"`.
Loading a bucket is not a launch: production stays closed and no
`PRODUCTION_LIVE` is set.

## Refreshing the archive

Upload the new build under its **own dated key**, then change `MAP_TILES_ARCHIVE`
in both environment blocks in one PR. Never overwrite an object in place: a
running Worker keeps an archive's directories in memory, by key, and would read
the new file with the old directories. Delete the old object only after the new
one has drawn on staging.

## Back to hexagons only

- **By PR (the standing way):** remove the `[[env.staging.r2_buckets]]`
  `MAP_TILES` block, remove its open entry from `env-parity.mjs`, and set
  `streetMapArchiveLoaded` to `"false"`. After the deploy the Worker has no
  binding and draws hexagons only.
- **At once, with no deploy:** rename or delete the object in the bucket. The
  Worker finds no archive and draws hexagons only on the next request. The
  staging cases go red if step 8 is done, which is the signal that it is off.

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

Still unmeasured:

- the first map in a new Worker instance, reading from R2. The workstation's
  1.4 s sits just under the 1.5 s limit that turns a slow read into hexagons
  only; it went over the public internet, so it says nothing about R2, and this
  is the number to read on staging first;
- R2 range reads at offsets past 4 GiB through the Worker binding;
- memory in the Worker with many areas read (the reader keeps at most 300,000
  directory entries, about 25 MB by an estimate made in Node), and whether four
  leaf directories are enough for the areas one isolate serves.
