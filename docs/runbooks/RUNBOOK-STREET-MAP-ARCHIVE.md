# Runbook: the street-map archive (loaded by a workflow)

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
- 2026-11-14: **nothing is run, built or checked on the owner's computer**, and
  staging changes only through CI (`CLAUDE.md`, "Environment: staging, not the
  owner's computer"). So the cut, the check and the upload run in a workflow, on
  a GitHub-hosted runner. Until that day this runbook was a list of commands for
  the owner's terminal; it has none now.
- 2026-11-14: **one bucket, read by both environments.** Staging and production
  bind the same bucket, `ose-map-tiles`, and each reads the key in its own
  `MAP_TILES_ARCHIVE`. The file is cut, checked and loaded once; production gets
  no bucket and no load of its own, and draws from the object staging drew
  from. A loaded object is **locked in Cloudflare against change and delete**,
  and is removed only when no environment reads it. This replaces a bucket per
  environment (`ose-map-tiles-staging`, `ose-map-tiles-production`) and the open
  question of how production would get a second copy. The decision record is
  [OSE ADR-035](../adr/ADR-035-street-map-one-bucket.md).
- 2026-11-15: **corrections first, then the load.** A five-loop review of the
  street map (`.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md`) scored
  it 0% and stopped for the owner, who chose to correct before loading. Nothing
  in "Staging, in order" is dispatched until "Before the load" below is done.

**Where the data comes from and what its licence asks** is in
[`NOTICE.md`](../../NOTICE.md), with the cut written out as a statement of
method. A refresh changes the build there too.

**The workflow does the work:**
[`.github/workflows/street-map-archive-load.yml`](../../.github/workflows/street-map-archive-load.yml)
("Street-map archive load (stg)" in the Actions tab). It is dispatched by hand,
from `main` only, with staging's credentials only.

**Accepting this path was the owner's decision, made by merging the PR that
carried the workflow** (#1244, 2026-11-14). Wherever a change to this text is
not on `main`, it is a proposal. Nothing runs until the owner dispatches the
workflow.

**What stays the owner's**, all of it in a browser: creating the bucket,
creating the R2 token, setting it as a secret, dispatching the workflow, locking
the loaded object, deleting the token afterwards, and merging. (The bucket in
use, `ose-map-tiles`, was not created by the owner: it exists because a staging
deploy made it on 2026-11-15. See "When the binding lands before the bucket".
Checking it, and keeping or remaking it, is the owner's.) An agent never
creates a bucket, never holds or reads the token, never sets a secret, a
variable or a lock rule, never dispatches the load, and never touches production
(`AGENTS.md`, Human approval).

**One bucket, one load.** The steps below load the bucket, and staging reads it
first. Production reads the same object once it is bound ("Production, later").

## Names

| What                | Staging               | Production (later, its own PR) |
| ------------------- | --------------------- | ------------------------------ |
| Bucket              | `ose-map-tiles`       | the same bucket                |
| Object key          | `us-YYYYMMDD.pmtiles` | the same key, the same object  |
| Binding             | `MAP_TILES`           | `MAP_TILES`                    |
| Setting for the key | `MAP_TILES_ARCHIVE`   | `MAP_TILES_ARCHIVE`            |

`YYYYMMDD` is the date of the Protomaps build the file was cut from.
`wrangler.toml` carries `us-20261115.pmtiles`: build `20261115`, named on
2026-11-16 after build `20261109` aged out at Protomaps with nothing loaded
("The build's window", below). The same three names are written
in three places, and they change together, in one PR:

| Name   | `wrangler.toml`                                | The workflow's `env` | This runbook's commands |
| ------ | ---------------------------------------------- | -------------------- | ----------------------- |
| Build  | the date inside `MAP_TILES_ARCHIVE`            | `PROTOMAPS_BUILD`    | the extract's address   |
| Key    | `MAP_TILES_ARCHIVE`, both environment blocks   | `ARCHIVE_KEY`        | every command           |
| Bucket | `bucket_name` of the staging `MAP_TILES` block | `BUCKET`             | every bucket command    |

The bucket is written in a fourth place: `STREET_MAP_BUCKET` in
`scripts/ci/street-map-archive-load.mjs`. The workflow's first step refuses any
other bucket, whatever `wrangler.toml` and the workflow agree on between them.

`tests/unit/ci/env-parity.test.js` fails when `wrangler.toml` and this runbook
name different files; `tests/unit/ci/street-map-archive-load.test.js` fails when
the workflow names another build, key or bucket, when this runbook shows a
command the workflow does not run, or when the workflow cuts, checks, reads or
writes with a command this runbook does not show. The workflow's first step
compares its three names with `wrangler.toml` on the commit it runs, and stops
if they differ. The key must match
`^[a-z0-9][a-z0-9._-]{0,80}\.pmtiles$` or the Worker refuses it.

**The build's window.** Protomaps offers a daily build for about a week. Build
`20261109` was still offered on 2026-11-15 at 19:38 UTC (`measure` run
43753563640), and answered 404 on 2026-11-16 at 00:13 UTC (run 43779110535),
between six and seven days after its date. By that one observation build
`20261115` is offered through **2026-11-21 (UTC)** and is gone on 2026-11-22.
The `measure` run, the owner's zoom decision ("Before the load", item 3) and
the `load` all have to land inside that window. The `measure` run did, on
2026-11-16 (run 43792020396); the zoom decision and the `load` are still to
come. If they do not land in time, the run stops
at "The build is still offered at Protomaps" and the build is moved again, in
one PR, as it was on 2026-11-16, and measured again.

**Open, for the owner: which kind of build.** Protomaps keeps one kind of build
longer: the last build of each tileset version ("What the docs say", "Builds go
away"). The newest of those is `20260811` (version 4.15.1, 137.3 GB). By
Protomaps' rule it has no window. Its data is three months older than the
daily builds', and the reader, the drawer and the check have only been tried
on version 4.15.2. This runbook names the newest daily build until the owner
says otherwise.

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
nothing is logged as an error. A frame that reaches past a box's edge draws
hexagons only as well: the Worker draws a street layer when the file has every
tile of the frame, and none when one is missing (street-map CCR 2026-11-15,
R15; until then it drew the streets of the tiles the file had, one side of the
map only). The frame is wider than the areas in it, so this can take the
streets from an area that is itself inside a box, near its edge.

## What the docs say (re-read before you rely on a number)

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
- **rclone.** Version 1.59 or later, `provider = Cloudflare`, `acl = private`;
  with a token scoped to objects add `no_check_bucket = true`; the part size is
  `--s3-chunk-size`. Read again 2026-11-14.
  <https://developers.cloudflare.com/r2/examples/rclone/>
  rclone reads the same settings from `RCLONE_CONFIG_<REMOTE>_<SETTING>`
  variables, which is how the workflow gives it the key without writing a file
  (<https://rclone.org/docs/#environment-variables>, not re-read on 2026-11-14).
- **A GitHub-hosted runner.** GitHub lists a standard Linux runner for a public
  repository as 4 processors, 16 GB of memory and **14 GB** of storage, and says
  nothing more about free disk or a second disk (read 2026-11-14).
  <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
  So the free space is read on the runner itself, not taken from a page: the
  workflow prints what each disk has and uses the one with more.
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
  From the CLI's source (`main.go`, `pmtiles/extract.go`, `pmtiles/bitmap.go`,
  not on the docs page): `--dry-run` works out the tiles and
  prints the size of the archive without downloading them; tiles are copied as
  they are, so gzip tiles stay gzip, and the new directories are written gzip;
  every parent tile of a kept tile is kept whole, so the low zooms still show the
  land around the region. A region that crosses longitude 180 gets no special
  handling, which is why the Aleutians are two boxes.
  Read again at tag `v1.31.2` on 2026-11-14: the last line a run prints is
  `Extract transferred <size> (overfetch 0.05) for an archive size of <size>`.
  The second size is the tile data alone, without the new directories, and it is
  rounded for reading (`21 GB`, or one decimal below 10). The workflow reads that
  line, takes the largest size that rounds to it, and adds the larger of 1 GB and
  5% before it compares with the free disk.
- **Builds go away.** Seen on 2026-11-09 by the session that read the real
  file (not on a docs page): `https://build.protomaps.com/20261003.pmtiles`, the
  build our proof used, answers 404; build `20261109` is 139.4 GB; the builds
  still offered are listed, with checksums, at
  <https://build-metadata.protomaps.dev/builds.json>. On 2026-11-14 that list
  still held `20261109`, and the daily builds from `20261108` to `20261114`. So
  the copy we load is the copy we keep: there is no going back to Protomaps for
  an old build, and the same file cannot be cut a second time once its build is
  gone. **The object in the bucket is that copy**; nobody holds another.
  Read again on 2026-11-16 at 00:17 UTC, after build `20261109` had gone: the
  list held 61 builds. Six were the daily builds `20261110` to `20261115`, all
  tileset version 4.15.2 (`20261115` is 139,532,869,447 bytes). The other 55
  went back to `20230918`, each the only build listed for its version; the
  newest of them is `20260811`, version 4.15.1. Each of the 61 answered a
  one-byte range request with 206, and `20261108` and `20261109` answered 404.
  That fits what the Protomaps downloads page says its bucket keeps (read the
  same day): all builds for the past week, and the latest build for each patch
  version. The page gives no number of days beyond "the past week", says the
  addresses may change, and asks users to copy a tileset to their own storage
  and not to link to it. So a daily build is gone in about a week unless it is
  the last of its version, and nobody outside Protomaps knows which daily
  build that will be. <https://docs.protomaps.com/basemaps/downloads>
- **Bucket locks.** Read 2026-11-14 (the page is dated 2026-10-28); not tried
  on our account. A lock rule stops objects being overwritten or deleted, for
  a number of days, until a date, or indefinitely until the rule is removed. A
  rule covers objects by prefix, and a rule with no prefix covers the whole
  bucket. Locks "do not prevent new object creation". Once a rule is saved,
  changes to the objects it covers are blocked from then on, and that includes
  completing an upload that started earlier. A blocked request through the S3
  API fails with HTTP 409 `ObjectLockedByBucketPolicy`. In the dashboard: R2
  object storage, the bucket, the **Settings** tab, the **Bucket lock rules**
  card, **Add rule** (name, prefix, retention period), **Save changes**; to
  remove one, the `...` beside the rule, then **Delete**. The page does not say
  in words that a prefix equal to a whole key covers that key alone: it covers
  every key that starts with those characters, and no other key of ours does.
  It does not name the permission a token needs to change a rule, and the
  linked permissions page was not read.
  <https://developers.cloudflare.com/r2/buckets/bucket-locks/>
- **Cost.** Storage $0.015 per GB-month, first 10 GB free per account. Each
  uploaded part is one Class A operation ($4.50 per million, first million free):
  at 256 MB parts a file is four parts per GB, so the upload itself costs
  nothing. <https://developers.cloudflare.com/r2/platform/pricing/>

## What the workflow runs

Two jobs. Every command below is in the workflow file, with the names taken from
its `env`; this section shows no command for a person to type.

**Job 1, the bucket is private (reads only).** Nobody chose the bucket's
settings: a staging deploy made it ("When the binding lands before the bucket"),
so the job does not take them on trust. It reads them, with the lockfile's
wrangler and the staging deploy credential CI already uses:

```bash
npx wrangler r2 bucket dev-url get ose-map-tiles
```

```bash
npx wrangler r2 bucket domain list ose-map-tiles
```

The first must answer "Public access via the r2.dev URL is disabled.", the
second "There are no custom domains connected to this bucket." Any other answer,
an error included, stops the run before anything is cut: the Workers are the
bucket's only readers. This job runs on its own runner and downloads no tool, so
the deploy credential is never on a machine with `pmtiles` or `rclone`.

**Job 2, cut, check and load.** In order:

1. **The names agree.** The build, key and bucket in the workflow's `env` are
   compared with `wrangler.toml` on the commit the run is on.
2. **The tools, by SHA-256.** go-pmtiles **v1.31.2** (the version the proof and
   this runbook were written against) and rclone **v1.76.0** are downloaded from
   their GitHub releases. Each file is refused unless its SHA-256 is the one
   pinned in the workflow, before it is unpacked or run:

   | File                                    | SHA-256                                                            |
   | --------------------------------------- | ------------------------------------------------------------------ |
   | `go-pmtiles_1.31.2_Linux_x86_64.tar.gz` | `3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f` |
   | `rclone-v1.76.0-linux-amd64.zip`        | `b00f00b3266c3764413afe599d3ec316f6f43b3e0ea8a0bc1d186d2133e46df7` |

   Both digests are the ones GitHub lists beside the release file, read
   2026-11-14. The same listing gives
   `a658baa4d7e55020aef6ca17bd9ff9faa1582671266b36f58c52db0ac8e785a1` for
   `go-pmtiles_1.31.2_Windows_x86_64.zip`, which is what the owner read there on
   2026-11-11.

3. **Measure first.** The build must still be offered, and then:

   ```bash
   pmtiles extract https://build.protomaps.com/20261115.pmtiles us-20261115.pmtiles --region=docs/runbooks/street-map-us-region.geojson --dry-run
   ```

   It works out the tiles and prints the archive size without fetching them. The
   run stops here, with the size and the free disk in its summary, if the file
   does not fit the runner's larger disk.

   In `measure` mode only, the step then makes the same dry run once more, at
   the deepest zoom the Worker reads (`MAX_ZOOM` in `lib/street-map.ts`; the
   workflow carries it as `WORKER_TOP_ZOOM`, and a test holds the two together):

   ```bash
   pmtiles extract https://build.protomaps.com/20261115.pmtiles us-20261115.pmtiles --region=docs/runbooks/street-map-us-region.geojson --maxzoom=14 --dry-run
   ```

   The summary then gives both sizes side by side. It is a figure for the
   owner's zoom decision ("Before the load", item 3) and nothing else: the fit
   is judged on the first dry run, a `load` neither makes the second nor waits
   on it, and the cut in step 5 keeps every zoom until a PR changes it. **In
   `measure` mode the run ends here**, having used no bucket credential and
   written nothing.

4. **The key is free.** The bucket is listed, and the run stops if it already
   holds the key (asked before the cut, and again just before the upload):

   ```bash
   rclone lsjson r2:ose-map-tiles --files-only --max-depth 1
   ```

5. **Cut the United States file:**

   ```bash
   pmtiles extract https://build.protomaps.com/20261115.pmtiles us-20261115.pmtiles --region=docs/runbooks/street-map-us-region.geojson
   ```

   The command reads the build at Protomaps by byte range and writes only the
   region's tiles, so the whole planet is never downloaded. The file is ours, so
   Protomaps lists no checksum for it: the next step takes its SHA-256.

6. **Check the file before it goes anywhere:**

   ```bash
   node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261115.pmtiles
   ```

   It reads the file with the Worker's own reader and drawing code
   (`lib/pmtiles.ts`, `lib/street-map.ts`), over the runner's disk instead of R2,
   and uploads nothing. The run goes on only if the command exits 0 **and** its
   last line is `PASS`. It checks that:
   - the file is PMTiles v3, vector tiles, gzip, down to the zoom the zoomed
     area reads. The reader unpacks **gzip** only; another compression would
     draw hexagons only;
   - the file is whole: every section ends inside it and the last ends at its
     last byte, so a cut that stopped early fails;
   - every leaf directory can be read, the entries counted match the header, no
     tile points past the tile data, and the largest leaf fits the entries the
     reader keeps (`MAX_LEAF_ENTRIES`);
   - the file is inside the reader's limits (`lib/pmtiles.ts`): no directory
     over 2 MiB, stored or unpacked (`MAX_DIRECTORY_BYTES`), and no tile over
     2 MiB stored (`MAX_TILE_BYTES`). The record carries the largest leaf
     directory, stored and unpacked, and the largest tile stored. What a tile
     unpacks to (`MAX_TILE_UNPACKED_BYTES`, 4 MiB) is checked only for the
     tiles the draws below read;
   - the landing page's own function draws roads for one area in each part of
     the region (Chicago, Seattle, San Diego, Miami, Bangor, Anchorage,
     Honolulu, San Juan) and for the 7-area and 19-area frames, and draws
     nothing for London and Mexico City, which the region leaves out;
   - the file's name is the key `wrangler.toml` reads, on the commit of the run.

   It writes `us-20261115.pmtiles.check.json` beside the file: the byte size,
   the SHA-256, the header, the directory layout and each draw. The workflow
   keeps that record as the run artifact `street-map-archive-check-record` (90
   days, and for a file that failed too) and prints the byte size and the
   SHA-256 in the job summary. The times in the record are from the runner's
   disk and say nothing about R2.

7. **Upload** under the dated key:

   ```bash
   rclone copyto us-20261115.pmtiles r2:ose-map-tiles/us-20261115.pmtiles --immutable --s3-chunk-size=256M --stats=1m --stats-one-line -v
   ```

   The key pair reaches rclone as environment variables of this step and the two
   listing steps, and of no other step: `pmtiles`, the check and the installs
   never see it. `--immutable` makes rclone refuse to change an object that is
   already there.

8. **Confirm.** The bucket is listed again, and the run is green only if it
   lists the key at the exact byte size in the check record: a smaller object is
   an upload that stopped. The proof that the bytes are right is the Worker
   drawing from them ("Staging, in order", step 8).

**An object is never overwritten.** The run asks the bucket twice and uploads
with `--immutable`, and one run at a time holds the workflow's lock. That is a
check before the write, not a lock inside R2: an upload made by hand in the same
minute is not covered, and there should be none. The lock inside R2 is the
owner's bucket lock rule, set once a load is green ("Staging, in order", step
6); from then on Cloudflare refuses a change to that object from any credential.

## Before the load (owner, 2026-11-15: corrections first)

The owner chose this order after the review of 2026-11-15. The `load` dispatch
(step 4 of "Staging, in order") waits for the first two. `measure` (step 2)
writes nothing and can run at any time.

1. **The staging cases are made aware of the flag.** Two staging cases demand
   the "no street map" note today, whatever `streetMapArchiveLoaded` says:
   `tests/e2e/3-flows/map-place-panel.spec.ts` and the Bruno folder
   "16. Landing Map Zoom" under `bruno/ose-pages/`. The Worker draws streets on its next request once the
   object is in the bucket, so the load itself would turn both red on correct
   behaviour, for every branch and every push to `main` (review finding R21).
   One pull request makes both read the flag, and makes the street cases ask for
   roads, not for any path (finding R17). **It merges before the load.**
   (The Worker also reads a switch, `STREET_MAP`, and draws nothing from a
   loaded object while an environment carries `"off"`. Staging carries `"on"`
   since 2026-11-15, set before any load, so this holds for the load itself.)
2. **The bucket and the key are settled.** All of it is the owner's, in Cloudflare
   and GitHub (OSE ADR-035, "Open, for the owner"):
   - **The bucket.** `ose-map-tiles` exists because a deploy created it, with
     default settings nobody chose. Check that it has no public r2.dev address
     and no custom domain, and that its jurisdiction is one the owner accepts. A
     jurisdiction cannot be changed later: if it is wrong, delete the bucket
     while it is empty and make it by hand.
   - **The write key.** Decide where `R2_MAP_TILES_ACCESS_KEY_ID` and
     `R2_MAP_TILES_SECRET_KEY` live so that only `main` can reach them. The
     `staging` environment has no branch policy (read 2026-11-15) and cannot get
     one while every branch must deploy to staging, so a job on any branch can
     read a secret set there. An environment of its own, limited to `main`, needs
     a small change to the workflow's `environment:` line in a pull request.
   - **Empty, just before the load.** A branch deployed to staging holds the
     `MAP_TILES` binding and could have written the key. The workflow refuses to
     load when the key is already there; the owner looks at the bucket's object
     list as well.
3. **Measure, and decide the zoom.** `measure` gives the file's size. The cut
   keeps every zoom of the build, and the Worker reads zoom 14 at most; whether
   to cut with a top zoom is decided before the first load, because a locked
   object is not changed (finding R6). **Measured 2026-11-15 (run
   43753563640), on build `20261109`: 20 GB by dry run, with every zoom kept,
   and it fitted the runner** ("Staging, in order", step 2). That build is
   gone. How much of its 20 GB lay above zoom 14 was never measured: that run
   made one dry run, without a top zoom, so its size alone did not say what a
   top zoom would save. A `measure` run now makes a second dry run at zoom 14
   and prints both sizes ("What the workflow runs", step 3). Its first
   dispatch, run 43779110535 on 2026-11-16, stopped before the dry runs
   because build `20261109` was gone. **Measured 2026-11-16 (run 43792020396),
   on build `20261115`, the build named now: 20 GB by dry run with every zoom
   kept, and 9.7 GB with a top zoom of 14, about 10.3 GB less. The larger
   size fitted the runner.** Both are dry-run figures: the tile data alone,
   rounded, without the new directories, and not the size of a loaded file.
   By those figures about half of the file is tiles above zoom 14, which the
   Worker never reads. **The zoom decision is the owner's, and it is open.**
   A top zoom is not a setting: the cut keeps every zoom until a PR changes
   it in the workflow and in this runbook together ("What the workflow
   runs", step 5), and that PR merges before the load. The decision, that PR
   if the owner wants a top zoom, and the load have to land inside the
   build's window, which ends **2026-11-21 (UTC)** ("Names", "The build's
   window").
4. **The licence.** [`NOTICE.md`](../../NOTICE.md) lists the duties and what is
   NOT CLEAR. Staging is public, so the first load is the first public street:
   the owner answers its question 2 (before the load, or before production)
   first. Staging carries `STREET_MAP = "on"` (owner 2026-11-15, set before any
   load), so the load is the first public street and the question is answered
   before the load. Setting the switch back to `"off"` first (see "Back to
   hexagons only") is the way to load without showing a street.
5. **The drawer and its checks are corrected** (findings R7, R17, R18). This
   needs no archive and runs beside the steps above. It must be done before the
   flag is set to `"true"` (step 9 of "Staging, in order"), not before the load.

## Staging, in order

1. **Owner: look at the bucket.** `ose-map-tiles` is there, and a deploy made
   it, not a person: the staging deploy of `bf1c696d` created it on 2026-11-15
   at 01:07 UTC (run 43659704554), because it found no bucket of that name
   ("When the binding lands before the bucket"). In the Cloudflare dashboard,
   R2 object storage: check that `ose-map-tiles` has no public r2.dev URL and
   no custom domain, and delete `ose-map-tiles-staging`, which is empty and no
   longer bound. Step 2 reads the same two settings from a runner and stops if
   either is on.
   - **Read 2026-11-15 (run 43744396310, job "The bucket is private (reads
     only)", green):** "Public access via the r2.dev URL is disabled." and
     "There are no custom domains connected to this bucket." The account lists
     the bucket as created 2026-11-15 01:07 UTC, location WNAM, jurisdiction
     `default`, standard storage, with no object. `ose-map-tiles-staging`
     (created 2026-11-10) was still listed that day. Whether `default` is the
     jurisdiction the owner accepts is the owner's to say, before the load.
     Run 43753563640 read the two privacy settings again the same day, with
     the same two answers.
   - **The rule for any later bucket is unchanged:** the owner creates it
     **before** the PR that names it in `wrangler.toml` merges, and before that
     PR's branch is run on staging. A deploy that finds no bucket under a bound
     name makes one by itself, with settings nobody chose.
   - The workflow itself is on `main` since #1244; GitHub offers a
     hand-dispatched workflow only once its file is there.

2. **Owner: measure.** Actions tab, "Street-map archive load (stg)", Run
   workflow, branch `main`, `confirm` = `STAGING`, `mode` = `measure`. The run's
   summary gives the archive size and the runner's free disk. Green means the
   file fits a GitHub-hosted runner. Red on "does not fit this runner" is an
   owner decision, not a fault: see "If the file does not fit".
   - **The first measure run, 43744396310 on 2026-11-15, was red before it
     measured anything.** It stopped at "Download rclone and refuse it unless
     its SHA-256 is the pinned one": the file's digest was `OK`, and then
     `./rclone version` refused to start. The workflow kept the pinned version
     in a variable named `RCLONE_VERSION`, and rclone reads every
     `RCLONE_<FLAG>` in its environment as that flag, so it read
     `--version=1.76.0`. The same variable reached every rclone step, so a
     `load` would have stopped at the same place, before any write. The two
     pins are now `TOOL_RCLONE_VERSION` and `TOOL_RCLONE_SHA256`, and
     `tests/unit/ci/street-map-archive-load.test.js` refuses a name that begins
     `RCLONE_` unless it is one of the remote's own settings in a bucket step.
   - **The second, 43753563640 on 2026-11-15 (from `main` at `de0fc8f2`), was
     green, and is the measurement.** It was the first real run of the
     corrected step (`rclone v1.76.0` started) and of every step after it. The
     dry run took 222 requests and 25 seconds and printed:

     ```text
     Region tiles 46129703, result tile entries 18362310
     Extract transferred 21 GB (overfetch 0.05) for an archive size of 20 GB
     ```

     The run's summary: an archive of **20 GB** for build `20261109`; "the cut
     needs 21.6 GB and the runner has 90.5 GB free", "The cut fits." Both
     places the workflow looks at (`$RUNNER_TEMP` and `/mnt`) had the same
     90,462,855,168 bytes free: one disk on this runner image, not two. Job 1
     read the bucket's two privacy settings again, with the answers in step 1.
     All eight `LOAD:` steps were skipped: no bucket credential was used and
     nothing was written.

   - **The third, 43779110535 on 2026-11-16 at 00:13 UTC (from `main` at
     `071165c4`), was red before it measured anything.** It was the first
     dispatch after the second dry run was added (PR #1302). It stopped at
     "The build is still offered at Protomaps":
     `https://build.protomaps.com/20261109.pmtiles` answered 404, between six
     and seven days after the build's date. The measure step was skipped, so
     the dry run at the Worker's top zoom has still never run. One PR then
     moved the build, the key, `wrangler.toml` and this runbook to build
     `20261115` ("What stops a run"). The 20 GB above is build `20261109`'s;
     the next run measured the build named now.

   - **The fourth, 43792020396 on 2026-11-16 at 02:24 UTC (from `main` at
     `ff96de6f`, the merge of the PR that moved the names, #1310), was green,
     and is the measurement of build `20261115`.** It was also the first run
     ever of the second dry run. Build `20261115` was still offered. With
     every zoom kept, the dry run took 221 requests and 32 seconds and
     printed:

     ```text
     Region tiles 46129703, result tile entries 18364711
     Extract transferred 21 GB (overfetch 0.05) for an archive size of 20 GB
     ```

     The run's summary: an archive of **20 GB** for build `20261115`; "the cut
     needs 21.6 GB and the runner has 90.5 GB free", "The cut fits." Both
     places the workflow looks at had the same 90,467,635,200 bytes free. With
     `--maxzoom=14` the second dry run took 150 requests and 11 seconds and
     printed:

     ```text
     Region tiles 11542161, result tile entries 5299625
     Extract transferred 10 GB (overfetch 0.05) for an archive size of 9.7 GB
     ```

     The summary's second part: "with a top zoom of 14, the most the Worker
     reads, the dry run reports **9.7 GB**", "with every zoom of the build, as
     a load cuts today, it reports **20 GB**", "that is about 10.3 GB less
     (both figures are the tile data alone, rounded)". Job 1 read the bucket's
     two privacy settings again, with the answers in step 1. All eight `LOAD:`
     steps were skipped: no bucket credential was used and nothing was
     written. The fit was judged on the larger size, and the run changed
     nothing about what a load cuts. **Whether the cut gets a top zoom is the
     owner's decision, before the first load** ("Before the load", item 3),
     and build `20261115` is offered through 2026-11-21 (UTC).

   - **What "20 GB" is.** A dry-run figure, for build `20261109` and again for
     build `20261115`: the tile data
     alone, rounded to a
     whole number, so at most 20.55 GB, without the new directories, and with
     every zoom of the build kept. **"9.7 GB"** is the same kind of figure for
     build `20261115` with no tile above zoom 14: rounded to one decimal, so
     at most 9.75 GB. "About 10.3 GB less" is one rounded figure taken from
     the other, so it is not exact either. No file has been cut at either
     size. The byte size of the loaded file comes from
     the load run (step 5). A `measure` run does not show the cut itself or
     how long it takes, the check with the Worker's reader, or any rclone call
     that reaches the bucket: those are `LOAD:` steps and have never run.

3. **Owner: create the token and set the secret.** In the Cloudflare dashboard:
   an R2 API token, "Object Read & Write", scoped to `ose-map-tiles` only.
   In GitHub, repository settings: the Access Key ID as
   `R2_MAP_TILES_ACCESS_KEY_ID` and the Secret Access Key as
   `R2_MAP_TILES_SECRET_KEY`, on the `staging` environment (the load job names
   that environment, so no other job can read them) or as repository secrets (the
   job reads either). The key pair goes from one browser tab to the other. It
   never goes into chat, a ticket, a file in this repo or an agent's terminal.

4. **Owner: load.** The same dispatch with `mode` = `load`. Green means the
   bucket lists `us-20261115.pmtiles` at the checked size. Any red is explained
   in "What stops a run". **This is the first public street.** The switch is
   already on for staging (step 8, done 2026-11-15 before any load). A Worker
   instance that asked and found no object remembers that for one minute and
   does not ask again until the minute is up (`MISS_MEMORY_MS` in
   `lib/pmtiles.ts`). So streets show within a minute of the object landing,
   one instance at a time, with no deploy: for up to a minute the same page can
   come back with streets from one instance and without from another.

5. **Record what was loaded.** The run's summary has the build date, the byte
   size and the SHA-256. They go on the owner-step ticket, and the byte size goes
   into
   [`../positioning/MAPPING-COST-STRUCTURE.md`](../positioning/MAPPING-COST-STRUCTURE.md),
   which carries it as unmeasured until then. An agent can do both from the run.

6. **Owner: lock the object.** Only after the load is green. In the Cloudflare
   dashboard: R2 object storage, the bucket `ose-map-tiles`, the **Settings**
   tab, the **Bucket lock rules** card, **Add rule**. Name it after the build
   (`us-20261115`), give it the whole key as its prefix (`us-20261115.pmtiles`),
   choose to keep objects locked indefinitely, and **Save changes**. From then
   on Cloudflare refuses to overwrite or delete that object, for the load token
   and for every other credential, until the rule is removed. New keys can
   still be loaded, so a refresh needs no change to this rule.
   - One rule for each loaded key. **Never a rule with no prefix**: it would
     cover every later upload too, and an upload that stopped short could then
     not be removed.
   - Not before the load is green, for the same reason: "What stops a run" has
     the owner remove an object that landed short, and a rule that is already
     there would refuse that.
   - This is what lets one bucket serve both environments: a mistake or a
     stolen token on the staging side can add a key, and cannot change or
     remove the object production reads.

7. **Owner: delete the token** in the Cloudflare dashboard, and the two secrets
   in GitHub. The Worker reads through its binding, not the token. A refresh
   makes a new one.

8. **Turn the switch on, and look at staging.** The Worker reads a switch,
   `STREET_MAP`, a plain value in each vars block of `wrangler.toml`
   (`lib/street-map.ts`; review finding R20). Exactly `"on"` draws streets, on
   the landing and for `/api/v2/map/areas` alike. `"off"`, a missing line or
   any other value is hexagons only, and the bucket is not asked.
   **Done out of order (owner 2026-11-15): staging carries `"on"`, set before
   any load.** The bucket held no object that day, so the Worker asks, finds
   none and draws hexagons only, and the load (step 4) is the step that puts
   the first street on a public page. With the switch at `"off"` the load and
   the first street would be two steps; that is still the order for production.
   - **One PR, two lines:** `STREET_MAP = "on"` in `[env.staging.vars]`, and
     `streetMapSwitch` to `"on"` in
     `bruno/ose-pages/environments/ose-staging.yml`. The second is the copy the
     staging cases print; `tests/unit/ci/env-parity.test.js` fails when the two
     differ. That test also writes the owner's choice down, in its case "as it
     stands", so the same PR changes the word there. An agent can open this PR.
     Merging it is the owner's.
   - **Its staging run draws streets only when the object is already there.**
     Every branch is run on staging before it is called ready. The PR that set
     staging to `"on"` ran with an empty bucket, so its run drew hexagons only.
   - **What the switch is not.** It is not the test flag: `streetMapArchiveLoaded`
     (step 9) says what the staging cases must see, and it may not be `"true"`
     while the switch is off. It is not a lock and not a control on who writes
     the bucket (steps 3, 6 and 7 are). It reaches a Worker only with a deploy.
     And it is one environment at a time: production has its own line, `"off"`,
     which may be `"on"` only once staging is.
   - **Staging runs the branch deployed last.** A branch cut before this PR
     merged still says `"off"`, and takes the streets off staging for as long as
     it is the one deployed. Its cases agree with it and pass.

   `MAP_TILES_ARCHIVE` on `main`, in both environment blocks of `wrangler.toml`,
   is the key that was loaded (the workflow refused to run otherwise). A
   Worker instance remembers a read that found no object for one minute and no
   longer (step 4), so with the switch on streets draw within a minute of the
   load: for areas in the United States, the landing shows streets under the
   hexagons and the OpenStreetMap credit, and a tapped hexagon shows its dots
   over streets.

   **What the Worker says it did.** Every try that reads the bucket writes one
   `STREET_LAYER` line to Workers Logs (`lib/street-map.ts`,
   `emitStreetLayer`): `outcome`, `surface` (`landing` or `map-areas`),
   the zoom read (`z`), the tile count (`tiles`), the R2 reads (`r2Reads`)
   and the time in milliseconds (`ms`). It names no area, no tile and no
   request. The outcomes:

   | `outcome`    | What happened                                                       |
   | ------------ | ------------------------------------------------------------------- |
   | `drew`       | a street layer is on the page                                       |
   | `no-archive` | the bucket has no object under `MAP_TILES_ARCHIVE`                  |
   | `no-tile`    | the archive has no tile for a part of the frame (outside the cut)   |
   | `thin`       | the tiles were read and held no street map (no road to steer by)    |
   | `timeout`    | slower than the 1.5 s limit; the page drew hexagons only            |
   | `error`      | a read failed, or the bytes were refused (damaged, or over a limit) |

   Before the load the only line is `no-archive`, at most once a minute for
   each Worker instance. After it, the first lines to read are `timeout`
   against `drew`, and `ms` on the `drew` lines with `r2Reads` of 3 or
   more (a first map in a new instance): that is the cold read the last
   section of this runbook could not time from a workstation. The switch off, a frame too wide
   for streets, and an archive found missing less than a minute ago read
   nothing and write no line.

   In every staging run's `T2: Bruno Pages contract` log, the landing case and
   the area-map case each print one test whose name starts `Street-map switch:`
   and says which way the switch is. With it off, that test fails if a street
   layer is drawn. With it on, in the next staging run's
   `T2: Bruno Pages contract` log, the four cases that read
   `streetMapArchiveLoaded` (the two landing cases, the area-map case in folder
   15 and the zoomed list case in folder 16) print their street assertions and no
   `NOT RUN` line. The three road tests among them (the two landing cases and
   the area-map case) pass only with 50 or more path commands of highway plus
   major road (`ROAD_FLOOR`), so a layer of water with a stub of road is red by
   name. In T4k, the first test of `tests/e2e/3-flows/map-place-panel.spec.ts`
   records which page was drawn, the "no street map" note or the dot map over
   streets, as a test annotation.

9. **Make the staging cases binding.** One-line PR: `streetMapArchiveLoaded` to
   `"true"` in `bruno/ose-pages/environments/ose-staging.yml`. It comes after
   step 8: the flag may not be `"true"` while `STREET_MAP` is `"off"` on staging
   (`tests/unit/ci/env-parity.test.js`). From then on a
   staging run that draws no streets is red, not a printed `NOT RUN`. **As things
   stand that PR is red on the four T4k axe tests.**
   `tests/e2e/3-flows/map-place-panel.spec.ts` (`sortUndecided`, and the lines
   after its call) sets apart the text drawn on the map itself, town names and
   dot numbers, whose contrast axe cannot decide over streets. While the flag is
   `"false"` that is a warning in the run ("T4k street map text contrast NOT
   DECIDED"); once it is `"true"` it is a failure. So that contrast is judged
   another way first, and the spec changed to match, before this PR. Seen on a
   local Worker over a synthetic archive (PR #1272), not on staging.

## What stops a run

| The run says                                      | It means                                                            | What then                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Type STAGING / Dispatch this workflow from main   | the dispatch was not confirmed, or came from a branch               | dispatch again, from `main`                                                                    |
| the workflow loads X, the Worker reads Y          | the workflow, `wrangler.toml` and this runbook name different files | a PR that makes the three agree                                                                |
| the r2.dev public URL is not reported off         | the bucket is public, or the read failed                            | owner: turn public access off in the dashboard, then dispatch again                            |
| `sha256sum` reports FAILED                        | a release file is not the pinned one                                | nothing was unpacked or run; find out why before changing a digest                             |
| Build … is not offered at Protomaps any more      | the build aged out (about a week)                                   | a PR that moves the build, the key, `wrangler.toml` and this runbook to a listed build         |
| it does not fit this runner                       | the file is larger than the runner's free disk                      | "If the file does not fit"                                                                     |
| … are not both set                                | `load` was dispatched before step 3                                 | owner: step 3                                                                                  |
| the bucket already holds "…"                      | the key was loaded before; nothing is overwritten                   | nothing, if that load was green; otherwise owner removes the object, then dispatch again       |
| The check did not end in PASS                     | the cut is not a file the Worker can draw from                      | nothing was uploaded; read the record artifact, then dispatch again (a cut that stopped early) |
| the bucket lists "…" at N bytes; the record says… | the upload stopped early, or another file is under the name         | owner removes the object, then dispatch again                                                  |
| the bucket does not list "…"                      | rclone ended without an object under the key                        | dispatch again; an unfinished multipart upload is aborted by R2 after 7 days                   |

The workflow never deletes anything. Removing an object is the owner's, in the
dashboard.

## If the file does not fit

Build `20261109` fitted: on 2026-11-15 the `measure` run 43753563640 reported
20 GB by dry run against 90.5 GB free ("Staging, in order", step 2). The build
named now, `20261115`, fitted too: on 2026-11-16 the `measure` run 43792020396
reported 20 GB by dry run with every zoom kept, against 90.5 GB free (and
9.7 GB with a top zoom of 14; the fit is judged on the larger size). GitHub documents
14 GB of storage for a standard runner and promises no more, so every run
reads what the runner really has, and the answer can change with the runner
image or the build. If a run says the file does not fit, the choices are the
owner's:

- a **GitHub-hosted larger runner** (more disk; billed by the minute, and set up
  in the organisation's settings), with the job's `runs-on` changed in a PR.
  Self-hosted runners are not a choice (owner, 2026-10-11);
- a **smaller file**: fewer zoom levels or a smaller region, which changes what
  the map draws and needs its own decision;
- **streaming the cut to R2** without holding the whole file on disk, which
  `pmtiles extract` does not do today and would be new code.

## When the binding lands before the bucket

It did, on staging, twice: on 2026-11-10 and on 2026-11-15. Cloudflare's
documentation does not say what `wrangler deploy` does when a binding names a
bucket that does not exist; it documents creating the bucket first. The wrangler
this repo pins (4.158.0) has resource provisioning on by default: the staging
deploy listed `MAP_TILES` as a binding to provision and created the bucket with
the deploy token (run 42865404464). So a bucket named in a merged binding is
made by CI, with default settings, which is a provisioning step that belongs to
the owner.

That first bucket was `ose-map-tiles-staging`. It was never loaded, and the
owner deletes it, empty, now that staging has deployed the new name.

The second is `ose-map-tiles`, the bucket in use. The plan of 2026-11-14 was
that the owner creates it before the PR that names it merges. The PR (#1257)
merged on 2026-11-15 at 00:44 UTC, and the staging deploy of that commit
(`bf1c696d`, run 43659704554, `T1 Deploy → Staging`) printed at 01:07 UTC:

```text
The following bindings need to be provisioned:
env.MAP_TILES         R2 Bucket
Provisioning MAP_TILES (R2 Bucket)...
Resource name found in config: ose-map-tiles
Creating new R2 Bucket "ose-map-tiles"...
MAP_TILES provisioned
```

Wrangler 4.158.0 asks Cloudflare for the bucket a binding names and lists it
for provisioning only when the answer is "not found"
(`R2Handler.isConnectedToExistingResource` in its `wrangler-dist/cli.js`, read
2026-11-15). So at that minute the account staging deploys to had no bucket of
that name in the default jurisdiction. The owner had said, before the deploy
ran, that the bucket was created; whether one was made under another account,
name or jurisdiction is not known here, and no agent read Cloudflare. What is
known is that the bucket staging binds was made by the deploy, with default
settings. Its two privacy settings were first read by the `measure` runs of
2026-11-15, which found both off ("Staging, in order", steps 1 and 2).

**Nothing in CI refuses a deploy whose binding names a bucket that is not
there.** The rule "the owner creates it first" holds only when a person does it
before the merge, and it has now failed twice. Production needs no bucket made
for it: its binding will name one that is already there.

With the bucket present and the archive missing, the Worker finds no object and
the map stays hexagons only. The two staging cases then print `NOT RUN`, or fail
once step 9 is done.

## Production, later

**Production reads the bucket staging reads** (owner, 2026-11-14). There is no
production bucket, no production load and no second copy: the object production
draws from is the object staging drew from. The two ways of making a second
copy that were open until that day (copy the staging object and compare its
SHA-256, or cut the build again) are not needed.

Production has no `MAP_TILES` binding yet, and `scripts/ci/env-parity.mjs` lists
that as an open difference (`--strict`, the check before production is
announced, fails on it). One PR ends it, after step 9:

- it adds `[[env.production.r2_buckets]]` with `binding = "MAP_TILES"` and
  `bucket_name = "ose-map-tiles"`;
- it removes the open entry from `env-parity.mjs`, and `r2_buckets/MAP_TILES`
  from `DARK_ON_PRODUCTION` in `scripts/prod-preflight.mjs`.

What holds it:

- `tests/unit/ci/env-parity.test.js` refuses a production binding while
  `streetMapArchiveLoaded` is not `"true"`, refuses one that names any other
  bucket, and refuses any other binding in `wrangler.toml` that names this
  bucket;
- `scripts/prod-preflight.mjs` lists `MAP_TILES` as the one binding production
  shares with staging (`SHARED_WITH_STAGING`) and fails if production's bucket
  is not staging's. Every other production binding still fails when it names
  anything of staging's. A line in that list is an owner decision.

What sharing means, said plainly:

- **The load writes the bucket production reads.** The workflow has no
  production input and no production credential
  (`tests/unit/ci/street-map-archive-load.test.js` holds it to that), and it
  runs with staging's credentials. It only adds a new dated key. It never
  changes or removes an object, and the lock (step 6) makes Cloudflare refuse
  both. A new key does nothing in either environment until `MAP_TILES_ARCHIVE`
  names it and that environment is deployed.
- **An object removed is removed for both** ("Refreshing the archive", "Back to
  hexagons only").
- **Production moves to a new key at its own deploy, not at the load.** Both
  blocks of `wrangler.toml` carry the same key (the parity check fails
  otherwise), so after a refresh production still reads the old object until it
  is deployed from a commit that names the new one.
- **Once production is bound, do not deploy it from a commit where
  `streetMapArchiveLoaded` is `"false"`.** Such a commit names a key that is not
  loaded yet; production would find no object and draw hexagons only, with no
  error. Nothing checks this today.

Binding the bucket is not a launch: production stays closed and no
`PRODUCTION_LIVE` is set.

## Refreshing the archive

A refresh is a new build under its **own dated key**. Never overwrite an object
in place: a running Worker keeps an archive's directories in memory, by key, and
would read the new file with the old directories. The lock on a loaded object
refuses an overwrite in any case.

The workflow runs from `main` and loads the key `wrangler.toml` names there, so
the order is:

1. One PR changes the build and the key in the workflow's `env`,
   `MAP_TILES_ARCHIVE` in both environment blocks, and the commands in this
   runbook, and sets `streetMapArchiveLoaded` to `"false"`. Once it is deployed
   the Worker finds no object under the new name and staging draws hexagons only,
   with the street-map cases printing `NOT RUN`.
2. Owner: `measure`, then the token and `load`, then the lock rule for the new
   key, as in "Staging, in order".
3. Look at staging, then set `streetMapArchiveLoaded` back to `"true"`.
4. **The old object stays while any environment reads it.** Production reads
   the old key until it is deployed from a commit that names the new one. So
   the owner removes the old object (its lock rule first, then the object) only
   after staging has drawn the new one and, once production is bound, after
   production has been deployed with the new key and has drawn it.

Staging is without streets between steps 1 and 2. Loading the new key before the
name changes would avoid that, and would mean running the workflow from a branch
with the bucket credential, which the stock load refuses for the same reason
(CCR 2026-11-07 R-06). Changing the region is the same steps with a new region
file.

## Back to hexagons only

Three ways, from the lightest.

- **By the switch (the standing way):** a PR sets `STREET_MAP = "off"` in that
  environment's vars block of `wrangler.toml`. For staging the same PR sets
  `streetMapSwitch` to `"off"` in
  `bruno/ose-pages/environments/ose-staging.yml`, and `streetMapArchiveLoaded`
  to `"false"` if step 9 is done (`tests/unit/ci/env-parity.test.js` refuses
  the flag at `"true"` with the switch off), and changes the word in that
  test's case "as it stands". After the deploy the Worker draws
  hexagons only and does not ask the bucket. The binding, the bucket, the
  object and its lock stay as they are, so streets come back with the same line
  set to `"on"`. One environment at a time. On staging the PR's own branch run
  deploys it, so the streets are off there before the merge.
- **By PR, taking the binding out:** remove the `[[env.staging.r2_buckets]]`
  `MAP_TILES` block, remove its open entry from `env-parity.mjs`, and set
  `streetMapArchiveLoaded` to `"false"`. After the deploy the Worker has no
  binding and draws hexagons only. This is one environment at a time: once
  production is bound it has a block of its own, and removing one block leaves
  the other environment drawing streets. It is wanted only when the bucket
  itself is to be unbound; the switch is the shorter way.
- **At once, with no deploy, for every environment:** the owner removes the
  object's lock rule and then deletes the object, in the dashboard. Each Worker
  that reads that key finds no archive and draws hexagons only on its next
  request. An instance that had the archive open goes on asking on every view,
  and writes a `no-archive` line each time, until it is replaced; a new
  instance asks once a minute (step 4). **Once production is bound this takes
  production's streets too**;
  there is no at-once way that reaches staging alone. The staging cases go red
  if step 9 is done, which is the signal that it is off.

**What the switch does and does not do.** It turns the street layer off for one
environment, in one line, and leaves everything else in place. It does not:

- act without a deploy. It is a value in `wrangler.toml`, so it reaches a
  Worker through a PR and the deploy queue. The dashboard way above is still
  the only at-once way;
- stand in for the test flag. `streetMapArchiveLoaded` says what the staging
  cases must see; the switch says what the Worker draws. `streetMapSwitch` is
  only the copy of the switch that the cases print;
- empty, lock or protect the bucket, or change who can write it;
- take back an answer a reader already holds. `/api/v2/map/areas` sends a
  street layer as cacheable for an hour (`max-age=3600`, with
  `stale-while-revalidate=86400`), so a build or a browser that kept one may
  show it until it expires. An answer without streets is kept for 60 seconds.

Whichever way, no page fails: with the switch off, no binding, no archive, a
tile of the frame missing, a damaged file, a file past the reader's limits (a
directory or a tile longer than `MAX_DIRECTORY_BYTES`, `MAX_TILE_BYTES` or
`MAX_TILE_UNPACKED_BYTES` in `lib/pmtiles.ts` allow, or a directory that says
it holds more entries than its bytes can), a tile or a frame that holds more
than the decoder will read (`TILE_LIMITS` in `lib/mvt.ts`, `FRAME_LIMITS` in
`lib/street-map.ts`) or a read slower than 1.5 s, the map is drawn without
streets. The decoder's limits stand on source arithmetic and one weighed tile,
not on a count of real tiles: a place whose tiles pass one shows as an `error`
probe in the archive check, before the load.

## What is proven, and what is not until the file is on staging

**The workflow has run in `measure` mode only.** It can only be dispatched once
it is on `main`. Its first run (43744396310, 2026-11-15) stopped at the rclone
download; its second (43753563640, the same day) was green through the dry run
and the fit ("Staging, in order", step 2); its third (43779110535, 2026-11-16)
stopped at the build check, because build `20261109` was gone; its fourth
(43792020396, the same day, after the names moved to build `20261115`) was
green through both dry runs and the fit. So the
downloads, the disk read, the dry run's last line and the fit have been seen
working on a runner twice, once on each build, and the
second dry run, at the Worker's top zoom, once, on the build named now. No
`LOAD:` step has run anywhere: not the bucket listing, the cut, the check or
the upload. The workflow's decisions (the names, the bucket's privacy, the size
against the disk, the key being free, the listed size) are tested on the faults
that must stop it, in `tests/unit/ci/street-map-archive-load.test.js`.

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

Checked on 2026-11-11, with no United States file cut yet: the check was
run on a generated archive on disk (it passed whole, and failed when one byte
short, when named for another build, and when not PMTiles), and its twelve draws
were aimed at build `20261109` at Protomaps over HTTPS as a stand-in. The ten
inside the region drew roads there (zoom 14, or 13 at Anchorage's latitude, and
zoom 12 for the 7-area and 19-area frames), so those places are ones a correct
cut draws. London and Mexico City drew roads from the whole build, as they must;
in the United States file they must draw nothing. None of this is a measure of
the United States file or of R2.

Since 2026-11-15 (PR #1270) the check makes eighteen draws, not twelve: the ten
inside the region and the two outside it, as above, and six more over cities on
the water (Manhattan, Seattle and San Francisco, each at 7 and at 19 areas). A
draw inside the region now counts as `streets` only with 100 points of highway
plus major road and 3% of every point drawn; roads that fall short are
`thin-roads`, which fails the draw. The two numbers come from a workstation run
over build `20261109` at Protomaps (the comment in
`workers/oursharedevents/scripts/street-map-archive/check.ts`). No run of the
eighteen against a United States file exists: the load workflow has four
`measure` runs and no `load` run (read 2026-11-16), and the check is a `LOAD:`
step.

Still unmeasured:

- the United States file itself: its byte size (the dry runs gave 20 GB of
  tile data, rounded, with every zoom kept, for build `20261109` on
  2026-11-15 and for build `20261115`, the one named now, on 2026-11-16, and
  9.7 GB for build `20261115` with a top zoom of 14; "Staging, in order",
  step 2; no file has been cut at either size), how long the cut takes on a
  runner and how much
  memory it needs there, how its directories are laid out (how many leaf
  directories, how many entries in each), and the reader drawing from it. The
  load run gives the byte size; the check measures the layout and the draws on
  the cut file, before the upload;
- the first map in a new Worker instance, reading from R2. The workstation's
  1.4 s sits just under the 1.5 s limit that turns a slow read into hexagons
  only; it went over the public internet, so it says nothing about R2, and this
  is the number to read on staging first. The Worker now writes it: `ms` on
  the `STREET_LAYER` lines, and a `timeout` line each time the limit is
  passed (step 8);
- R2 range reads at offsets past 4 GiB through the Worker binding;
- memory in the Worker with many areas read (the reader keeps at most 300,000
  directory entries, about 25 MB by an estimate made in Node), and whether four
  leaf directories are enough for the areas one isolate serves.

Not tried, and nothing in this repo can try it:

- two Workers bound to one R2 bucket on this account. A binding is a bucket
  name and both Workers are in the one account; Cloudflare's pages show nothing
  that limits a bucket to one Worker, and none says in words that two may share
  one. The first proof is production drawing streets after its binding PR;
- the bucket lock rule: that a rule whose prefix is the whole key refuses an
  overwrite and a delete of that object, and lets the next dated key load.
