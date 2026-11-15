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
  question of how production would get a second copy.

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
the loaded object, deleting the token afterwards, and merging. An agent never
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
`wrangler.toml` carries `us-20261109.pmtiles`. The same three names are written
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

**Job 1, the bucket is private (reads only).** The owner creates the bucket
("Staging, in order", step 1), and the job does not take its settings on trust.
It reads them, with the lockfile's wrangler and the staging deploy credential CI
already uses:

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
   pmtiles extract https://build.protomaps.com/20261109.pmtiles us-20261109.pmtiles --region=docs/runbooks/street-map-us-region.geojson --dry-run
   ```

   It works out the tiles and prints the archive size without fetching them. The
   run stops here, with the size and the free disk in its summary, if the file
   does not fit the runner's larger disk. **In `measure` mode the run ends
   here**, having used no bucket credential and written nothing.

4. **The key is free.** The bucket is listed, and the run stops if it already
   holds the key (asked before the cut, and again just before the upload):

   ```bash
   rclone lsjson r2:ose-map-tiles --files-only --max-depth 1
   ```

5. **Cut the United States file:**

   ```bash
   pmtiles extract https://build.protomaps.com/20261109.pmtiles us-20261109.pmtiles --region=docs/runbooks/street-map-us-region.geojson
   ```

   The command reads the build at Protomaps by byte range and writes only the
   region's tiles, so the whole planet is never downloaded. The file is ours, so
   Protomaps lists no checksum for it: the next step takes its SHA-256.

6. **Check the file before it goes anywhere:**

   ```bash
   node workers/oursharedevents/scripts/check-street-map-archive.mjs us-20261109.pmtiles
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

   It writes `us-20261109.pmtiles.check.json` beside the file: the byte size,
   the SHA-256, the header, the directory layout and each draw. The workflow
   keeps that record as the run artifact `street-map-archive-check-record` (90
   days, and for a file that failed too) and prints the byte size and the
   SHA-256 in the job summary. The times in the record are from the runner's
   disk and say nothing about R2.

7. **Upload** under the dated key:

   ```bash
   rclone copyto us-20261109.pmtiles r2:ose-map-tiles/us-20261109.pmtiles --immutable --s3-chunk-size=256M --stats=1m --stats-one-line -v
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

## Staging, in order

1. **Owner: create the bucket, then merge.** In the Cloudflare dashboard, R2
   object storage: create `ose-map-tiles`, with no public r2.dev URL and no
   custom domain. Do it **before** the PR that names the bucket in
   `wrangler.toml` merges, and before that PR's branch is run on staging: a
   deploy that finds no bucket under a bound name makes one by itself, with
   settings nobody chose ("When the binding lands before the bucket"). The
   workflow itself is on `main` since #1244; GitHub offers a hand-dispatched
   workflow only once its file is there.

2. **Owner: measure.** Actions tab, "Street-map archive load (stg)", Run
   workflow, branch `main`, `confirm` = `STAGING`, `mode` = `measure`. The run's
   summary gives the archive size and the runner's free disk. Green means the
   file fits a GitHub-hosted runner. Red on "does not fit this runner" is an
   owner decision, not a fault: see "If the file does not fit".

3. **Owner: create the token and set the secret.** In the Cloudflare dashboard:
   an R2 API token, "Object Read & Write", scoped to `ose-map-tiles` only.
   In GitHub, repository settings: the Access Key ID as
   `R2_MAP_TILES_ACCESS_KEY_ID` and the Secret Access Key as
   `R2_MAP_TILES_SECRET_KEY`, on the `staging` environment (the load job names
   that environment, so no other job can read them) or as repository secrets (the
   job reads either). The key pair goes from one browser tab to the other. It
   never goes into chat, a ticket, a file in this repo or an agent's terminal.

4. **Owner: load.** The same dispatch with `mode` = `load`. Green means the
   bucket lists `us-20261109.pmtiles` at the checked size. Any red is explained
   in "What stops a run".

5. **Record what was loaded.** The run's summary has the build date, the byte
   size and the SHA-256. They go on the owner-step ticket, and the byte size goes
   into
   [`../positioning/MAPPING-COST-STRUCTURE.md`](../positioning/MAPPING-COST-STRUCTURE.md),
   which carries it as unmeasured until then. An agent can do both from the run.

6. **Owner: lock the object.** Only after the load is green. In the Cloudflare
   dashboard: R2 object storage, the bucket `ose-map-tiles`, the **Settings**
   tab, the **Bucket lock rules** card, **Add rule**. Name it after the build
   (`us-20261109`), give it the whole key as its prefix (`us-20261109.pmtiles`),
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

8. **Look at staging.** `MAP_TILES_ARCHIVE` on `main`, in both environment
   blocks of `wrangler.toml`, is the key that was loaded (the workflow refused to
   run otherwise). The Worker does not remember a read that found no object, so
   the next landing request draws streets: for areas in the United States, the
   landing shows streets under the hexagons and the OpenStreetMap credit, and a
   tapped hexagon shows its dots over streets. In the next staging run's
   `T2: Bruno Pages contract` log, the two street-map requests print their street
   assertions and no `NOT RUN` line.

9. **Make the staging cases binding.** One-line PR: `streetMapArchiveLoaded` to
   `"true"` in `bruno/ose-pages/environments/ose-staging.yml`. From then on a
   staging run that draws no streets is red, not a printed `NOT RUN`.

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

The size of the United States file was never measured; the `measure` run is the
measurement. GitHub documents 14 GB of storage for a standard runner, and the
run prints what the runner really has. If the run says the file does not fit,
the choices are the owner's:

- a **GitHub-hosted larger runner** (more disk; billed by the minute, and set up
  in the organisation's settings), with the job's `runs-on` changed in a PR.
  Self-hosted runners are not a choice (owner, 2026-10-11);
- a **smaller file**: fewer zoom levels or a smaller region, which changes what
  the map draws and needs its own decision;
- **streaming the cut to R2** without holding the whole file on disk, which
  `pmtiles extract` does not do today and would be new code.

## When the binding lands before the bucket

It did, on staging, on 2026-11-10. Cloudflare's documentation does not say what
`wrangler deploy` does when a binding names a bucket that does not exist; it
documents creating the bucket first. The wrangler this repo pins (4.158.0) has
resource provisioning on by default: the staging deploy listed `MAP_TILES` as a
binding to provision and created the bucket with the deploy token (run
42865404464). So a bucket named in a merged binding is made by CI, with default
settings, which is a provisioning step that belongs to the owner.

That bucket was `ose-map-tiles-staging`. It was never loaded. Since 2026-11-14
the binding names `ose-map-tiles`, which the owner creates first ("Staging, in
order", step 1), and the owner deletes `ose-map-tiles-staging`, empty, once
staging has deployed the new name. Production needs no bucket made for it: its
binding will name one that is already there.

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

- **By PR (the standing way):** remove the `[[env.staging.r2_buckets]]`
  `MAP_TILES` block, remove its open entry from `env-parity.mjs`, and set
  `streetMapArchiveLoaded` to `"false"`. After the deploy the Worker has no
  binding and draws hexagons only. This is one environment at a time: once
  production is bound it has a block of its own, and removing one block leaves
  the other environment drawing streets.
- **At once, with no deploy, for every environment:** the owner removes the
  object's lock rule and then deletes the object, in the dashboard. Each Worker
  that reads that key finds no archive and draws hexagons only on its next
  request. **Once production is bound this takes production's streets too**;
  there is no at-once way that reaches staging alone. The staging cases go red
  if step 9 is done, which is the signal that it is off.

Either way no page fails: with no binding, no archive, no tile for the area, a
damaged file, a file past the reader's limits (a directory or a tile longer
than `MAX_DIRECTORY_BYTES`, `MAX_TILE_BYTES` or `MAX_TILE_UNPACKED_BYTES` in
`lib/pmtiles.ts` allow) or a read slower than 1.5 s, the map is drawn without
streets.

## What is proven, and what is not until the file is on staging

**The workflow has not run.** It can only be dispatched once it is on `main`, so
on the day it merged nothing in it had been seen working on a runner: not the
downloads, not the dry run's last line, not the upload. Its decisions (the
names, the bucket's privacy, the size against the disk, the key being free, the
listed size) are tested on the faults that must stop it, in
`tests/unit/ci/street-map-archive-load.test.js`. The `measure` run is its first
real run, and it writes nothing.

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

Still unmeasured:

- the United States file itself: its size, how long the cut takes on a runner
  and how much memory it needs there, how its directories are laid out (how many
  leaf directories, how many entries in each), and the reader drawing from it.
  The `measure` run gives the size; the check measures the layout and the draws
  on the cut file, before the upload;
- the first map in a new Worker instance, reading from R2. The workstation's
  1.4 s sits just under the 1.5 s limit that turns a slow read into hexagons
  only; it went over the public internet, so it says nothing about R2, and this
  is the number to read on staging first;
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
