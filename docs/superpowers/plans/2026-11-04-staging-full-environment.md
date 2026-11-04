# Staging empty + full sites (layer 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second, owner-only staging site (`stg-full.oursharedevents.com`) rebuilt every morning from real events in six places, plus a "Testing purposes only" notice on both staging sites.

**Architecture:** The Worker gets one change: an HTML notice injected at the `fetch` seam in `src/index.ts`, plus config for a `staging-full` env. Everything else is CI. One scheduled workflow first deploys `main` to `staging-full`. Then a Claude search writes `finds.json` and `businesses.json`, and plain, tested Node scripts validate them, build through the real admin API, check the result per node, and purge by manifest.

**Tech Stack:** Cloudflare Workers + D1, wrangler, vitest (root project + worker `workers`/`node` pools), Node 20 ESM scripts, `h3-js` ^4.5.0, GitHub Actions on `ubuntu-24.04`, `anthropics/claude-code-action`, Instagram API with Instagram Login.

**Spec:** `docs/superpowers/specs/2026-11-04-staging-full-environment-design.md`

## Global Constraints

- Notice copy, exact: `Testing purposes only.` On the full site add: `Events, venues and businesses here are drawn from public listings for testing; nothing here is an endorsement or an offer.`
- The notice shows only when `WORKER_ENV === "staging"`. Production, development and test never render it. Both staging sites run `WORKER_ENV = "staging"`; `STAGING_VARIANT` is `"empty"` or `"full"`.
- Colors only from tokens (`--status-warn` family); no raw hex. The notice is not a heading; one `<h1>` per page holds. Touch targets ≥ 44 px.
- Nodes, exact names: Blue Island, Beverly, Auburn Gresham, Evergreen Park, Oak Lawn, Mount Greenwood.
- Window: events starting from today through today + 90 days.
- Quantity: `stock/targets.json` = `{ "perNode": 12 }` is the **only** source of how many stock events each node gets. The build loads exactly `perNode` per node (private first, then soonest). The search stops a node at `perNode + 3`. Every check reads `perNode` and the day's manifest, never a literal. `perNode < 10` is refused. Counting is strict, by the node's own res-7 cells. Hand-made events are not in the manifest: assert exactly `perNode` stock events listed and a node total ≥ `perNode`.
- Sector order: `private` before `public`.
- Tiers: anchor → `premium`, regional (from `stock/regionals.json`) → `mid`, everything else → `local`.
- Stock scripts and the stock workflow may target only `--env staging-full` / `https://stg-full.oursharedevents.com`.
- Every job `runs-on: ubuntu-24.04` (`tests/integration/infra-consistency.test.js`).
- Search spend cap: repo variable `STOCK_SEARCH_MAX_USD`, default `5`.
- No model SDK or model URL under `workers/oursharedevents/src/`.
- Born red: every new test is watched failing on an injected fault before it is trusted; record the fault in the commit body.
- Install with `npm ci` at the root and in `workers/oursharedevents/`. After adding a worker spec, run `node scripts/triage-vitest-pool.mjs`, commit the manifest, then `--check`.

## Review Focus

1. **An HTML response that is streamed, compressed, or has no `<body>`** (the poster page, the display, error pages). The notice must not break it; with no `<body>` the response passes through unchanged. Tested in Task 1.
2. **A find whose address geocodes onto a node border, or outside every node.** It must be refused as `not-in-node` (or assigned to the node that owns its cell), never silently counted toward the agent's guess. Tested in Task 3.
3. **A run that dies between build and purge** (runner timeout, API 500 halfway through a node). The next morning must still purge the orphaned ids. Manifests are listed and every manifest older than the newest passing one is purged. Tested in Task 6.
4. **The same real event found twice** (a bar's site and the chamber calendar, with titles in different case or spacing). It must collapse to one row. Tested in Task 3.
5. **The Instagram token is expired or the account has no image posts.** Events are created without art and the run still passes, with a warning. It is never red for art alone. Tested in Task 5.

---

### Task 1: "Testing purposes only" notice

**Files:**

- Create: `workers/oursharedevents/src/lib/test-site-notice.ts`
- Modify: `workers/oursharedevents/src/index.ts:90-92` (wrap `patched` before return)
- Modify: `workers/oursharedevents/src/router.ts` env type if `STAGING_VARIANT` is not already reachable on `RouterEnv`
- Test: `workers/oursharedevents/tests/test-site-notice.spec.ts` (workers pool: needs `HTMLRewriter`)
- Test: `tests/ui/smoke/page-endpoints.smoke.spec.ts` (staging, T3): one added case

**Interfaces:**

- Produces: `export const TEST_SITE_NOTICE_TESTID = 'test-site-notice'`; `export function injectTestSiteNotice(res: Response, env: { WORKER_ENV?: string; STAGING_VARIANT?: string }): Response`

- [ ] **Step 1: Write the failing spec** `tests/test-site-notice.spec.ts` with these cases:
  - `staging + text/html` → body contains `data-testid="test-site-notice"`, `role="note"`, and `Testing purposes only.`; the count of `<h1` is unchanged from the input.
  - `STAGING_VARIANT: 'full'` → also contains `nothing here is an endorsement or an offer`.
  - `STAGING_VARIANT: 'empty'` → does not contain `endorsement`.
  - `WORKER_ENV: 'production'`, `'development'`, `'test'` → body byte-identical to the input.
  - `application/json` on staging → unchanged.
  - HTML with no `<body>` on staging → unchanged, and the status and headers are preserved.
  - Static check: `src/index.ts` source calls `injectTestSiteNotice(` (read through the bundled source the way other static specs do).
- [ ] **Step 2: Run it and watch it fail.** `cd workers/oursharedevents && npx vitest run --project workers tests/test-site-notice.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `injectTestSiteNotice`.** Return `res` unchanged unless `WORKER_ENV === 'staging'` and content-type starts with `text/html`. Otherwise use `HTMLRewriter` `on('body', { element(e) { e.prepend(html, { html: true }) } })`. The band is a `<div role="note" data-testid="test-site-notice">`. Its inline `<style>` uses only `var(--status-warn…)` and token text colors, with `min-height: 44px` and wrapping text at phone width. Wire it in `index.ts` as `return injectTestSiteNotice(patched, env)`.
- [ ] **Step 4: Run the spec; expect PASS.** Then run `npm run lint:testids` at the root and register `test-site-notice` wherever that lint requires it.
- [ ] **Step 5: Born red.** Remove the `index.ts` call and confirm the static case fails. Change the guard to `!== 'production'` and confirm the `test`/`development` cases fail. Restore both.
- [ ] **Step 6: Add the staging case** to `page-endpoints.smoke.spec.ts`: `/` on `stg.oursharedevents.com` has exactly one `[data-testid="test-site-notice"]` and exactly one `h1`.
- [ ] **Step 7: Pool manifest + full worker suite.** `node ../../scripts/triage-vitest-pool.mjs`, then `--check`, then `npm test` in `workers/oursharedevents`. Expect everything green. Look for existing specs that snapshot staging HTML; fix only if they break.
- [ ] **Step 8: Commit** `feat(worker): show a testing-only notice on staging pages`.

### Task 2: `staging-full` env config

**Files:**

- Modify: `workers/oursharedevents/wrangler.toml` (new `[env.staging-full]` block after `[env.staging]`; add `stg-empty` route to `[env.staging]`; add `STAGING_VARIANT = "empty"` to `[env.staging.vars]`)
- Modify: `workers/oursharedevents/src/lib/cors.ts:18` (`STAGING_ONLY_ORIGINS` adds `https://stg-full.oursharedevents.com` and `https://stg-empty.oursharedevents.com`)
- Modify: `workers/oursharedevents/src/lib/security-alert.ts:134` (label `staging-full` with the full base URL when `STAGING_VARIANT === 'full'`)
- Test: `tests/integration/staging-full-config.test.js` (root vitest)

**Interfaces:**

- Produces: wrangler env name `staging-full`; Worker `oursharedevents-stg-full`; D1 `ocr-db-staging-full` (binding `DB`) and `ocr-forms-db-staging-full` (binding `FORMS_DB`); R2 `ose-uploads-staging-full` (binding `UPLOADS_BUCKET`); `database_id`/KV `id` are the literal `"OWNER_TO_FILL"` until the owner pastes ids.

- [ ] **Step 1: Write the failing test** `staging-full-config.test.js`. It parses `wrangler.toml` with the same TOML reader `scripts/ci/env-parity.mjs` uses (import `parseToml` or the exported helper) and asserts:
  - `env.staging-full.name === 'oursharedevents-stg-full'`; its single route pattern is `stg-full.oursharedevents.com/*`.
  - `[env.staging-full.vars]` has `WORKER_ENV === 'staging'`, `STAGING_VARIANT === 'full'`, `ADMIN_SCOPE_ALL === 'true'`, `ALLOW_ADMIN_KEY_FALLBACK === 'true'`, and a `BIGQUERY_DATASET_ID` that differs from both staging's and production's.
  - `[env.staging.vars].STAGING_VARIANT === 'empty'`; `[env.staging]` routes include both `stg.` and `stg-empty.`.
  - No `env.staging-full.queues.*` section. `env.staging-full.triggers.crons` equals staging's.
  - Its D1 names are the two `-staging-full` names and never a staging or production name.
  - Its rate-limit `namespace_id`s are unique across all envs.
  - `compareEnvironments(toml)` from `scripts/ci/env-parity.mjs` returns no finding whose text contains `staging-full`, and its `ok` is the same as on `main`.
- [ ] **Step 2: Run it and watch it fail.** `npx vitest run tests/integration/staging-full-config.test.js`. Expected: FAIL, `env.staging-full` undefined.
- [ ] **Step 3: Add the config.** Copy `[env.staging]` without the queue blocks. Give it new rate-limit namespace ids (`15095`, `15096`, or the next unused) and a KV binding `RATE_LIMIT_KV`. Set `WIF_ISSUER = "https://stg-full.oursharedevents.com"` and `BIGQUERY_DATASET_ID = "oursharedevents_backup_stg_full"`. Add a comment listing the owner setup (spec, "Owner setup").
- [ ] **Step 4: Update `cors.ts` and `security-alert.ts`.** Extend their existing specs (`grep -l "STAGING_ONLY_ORIGINS\|security-alert" workers/oursharedevents/tests`) with one case each for the new host.
- [ ] **Step 5: Run root `npm test` and the worker suite; expect PASS.** Run `node scripts/ci/env-parity.mjs` and confirm the output is unchanged from `main`.
- [ ] **Step 6: Born red.** Set the full env's `WORKER_ENV` to `staging-full` and confirm Step 1 fails. Restore it.
- [ ] **Step 7: Commit** `feat(config): add the staging-full environment and stg-empty route`.

### Task 3: Nodes file and finds validator

**Files:**

- Create: `stock/nodes.json`, `stock/finds.schema.json`, `stock/businesses.schema.json`
- Create: `scripts/stock/build-nodes.mjs` (one-off generator, committed with its source URLs)
- Create: `scripts/stock/validate-finds.mjs`
- Modify: root `package.json` (devDependency `h3-js` `^4.5.0`, same range as the worker)
- Test: `tests/unit/stock/validate-finds.test.js`, `tests/unit/stock/nodes.test.js`

**Interfaces:**

- Produces: `nodes.json` shape `{ "nodes": [{ "id": "blue-island", "name": "Blue Island", "zips": ["60406"], "polygon": <GeoJSON Polygon or MultiPolygon, simplified>, "cells": ["872664…", …] /* res-7 cells that OVERLAP the polygon; a border cell may be in two nodes */, "source": "<boundary URL>" }] }`. The ids are `blue-island`, `beverly`, `auburn-gresham`, `evergreen-park`, `oak-lawn`, `mount-greenwood`.
- Produces: a find row `{ venue, address, sector: 'private'|'public', node, event_type_id, starts_at, ends_at|null, title, summary, source_url }`.
- Produces: `validateFinds({ finds, eventTypeIds: Set<string>, nodes, today: string /*YYYY-MM-DD*/, geocode: (address) => Promise<{lat:number,lng:number}|null> }) => Promise<{ accepted: Array<Find & {node:string, cell:string, lat:number, lng:number}>, refused: Array<{ row: Find, reason: 'outside-window'|'no-source'|'unknown-type'|'geocode-failed'|'not-in-node'|'duplicate'|'bad-shape' }>, acceptedPerNode: Record<string, number> }>`

- [ ] **Step 1: Write the failing tests.**
  - `nodes.test.js`: there are exactly six nodes with the ids above; every node has ≥ 1 zip and ≥ 1 cell; every cell is valid res 7 (`h3.getResolution(c) === 7`); every node has a `polygon`; every cell overlaps its node's polygon.
  - `validate-finds.test.js`, one case per refusal reason:
    - a start the day before `today` → `outside-window`;
    - today + 91 days → `outside-window`;
    - today + 90 days → accepted.
    - Empty `source_url` → `no-source`; an id not in `eventTypeIds` → `unknown-type`; geocode `null` → `geocode-failed`; coordinates inside no node polygon → `not-in-node`.
    - Coordinates inside the Oak Lawn polygon while the row claims `beverly` → accepted with `node: 'oak-lawn'`.
    - Two rows with the same venue (`"Cork & Kerry"` / `" cork &  kerry "`) and the same start → one accepted, one `duplicate`.
    - A 300-char title is cut to 120 and a 500-char summary to 200.
    - `acceptedPerNode` counts accepted rows per node.
    - Accepted rows come back with `private` before `public`.
- [ ] **Step 2: Run them and watch them fail.** `npx vitest run tests/unit/stock`. Expected: FAIL, files missing.
- [ ] **Step 3: Write `build-nodes.mjs` and generate `nodes.json`.** Boundaries: City of Chicago community areas (Beverly, Auburn Gresham, Mount Greenwood) and Census TIGER places (Blue Island, Evergreen Park, Oak Lawn). Keep each boundary (simplified) as `polygon`. `cells` = `h3.polygonToCellsExperimental(polygon, 7, POLYGON_TO_CELLS_FLAGS.containmentOverlapping)`. Put each node's source URL and zips in its entry: Blue Island `60406`; Beverly `60643`; Auburn Gresham `60620`; Evergreen Park `60805`; Oak Lawn `60453`; Mount Greenwood `60655`.
- [ ] **Step 4: Implement `validateFinds`.** Node membership is point-in-polygon against each node's `polygon` (exact, never by cell, since border cells overlap two nodes); `cell` is still `h3.latLngToCell(lat, lng, 7)` for the record. The duplicate key is `lower(collapse-spaces(venue)) + '|' + starts_at`.
- [ ] **Step 5: Run the tests; expect PASS. Born red:** change the window bound to `> 90` days as `>= 90` and watch the boundary case fail. Restore it.
- [ ] **Step 6: Commit** `feat(stock): node cells and the finds validator`.

### Task 4: Stock API client and build

**Files:**

- Create: `scripts/stock/client.mjs`, `scripts/stock/build-full.mjs`, `stock/regionals.json` (starts as `{ "regionals": [] }`), `stock/targets.json` (`{ "perNode": 12 }`)
- Test: `tests/unit/stock/build-full.test.js`

**Interfaces:**

- Consumes: Task 3 accepted rows; Task 5 `pickArt`.
- Produces: `createClient({ baseUrl, adminKey, accessClientId, accessClientSecret, fetch }) => { post(path, body), get(path), upload(eventId, bytes, contentType) }`. Every request sends `CF-Access-Client-Id`, `CF-Access-Client-Secret`, `Authorization: Bearer <adminKey>` and `Content-Type: application/json`. `baseUrl` must equal `https://stg-full.oursharedevents.com` or the client throws.
- Produces: `buildDay({ client, accepted, businesses, regionals, posts, artTags, targets, date }) => Promise<Manifest>`, where `Manifest = { date: string, items: Array<{ kind: 'event'|'poster'|'sponsor'|'placement'|'upload', id: string, node: string }>, qr: Array<{ eventId, node, qPath, sPath }>, acceptSql: string[] /* placement ids whose acceptance is set by SQL */, short: Record<string, number> /* node → how many it fell short of perNode */ }`.
- Produces: `sponsorTier(business, regionals) => 'premium'|'mid'|'local'`.

- [ ] **Step 1: Write the failing test** with a fake `fetch` that records calls and returns ids. Assertions:
  - given 15 accepted rows in one node (5 public, 10 private) and `targets = { perNode: 12 }`, exactly 12 events are created for that node: all 10 private, then the 2 soonest public; a node with 11 accepted creates 11 and is marked short in the manifest (`manifest.short = { node: 1 }`);
  - each selected row produces one `POST /api/v2/admin/events` with `brand_id: 'root'`, `status: 'active'`, `is_published: true`, its `event_type_id`, `lat`/`lon`, `where_address`, `start_date`, and the title;
  - one `POST /api/v2/admin/events/:id/poster-deployments` per event, plus one `POST …/short-links`;
  - an upload only when `pickArt` returns a post;
  - one `POST /api/v2/admin/sponsors` per business, with `sponsorTier` giving `premium` for `anchor: true`, `mid` for a name listed in `regionals`, `local` otherwise;
  - one placement per event, for its node's anchor;
  - every created id lands in `manifest.items` with its node;
  - `createClient` with `baseUrl: 'https://stg.oursharedevents.com'` throws.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Read each handler (`handlers/events.ts` create, the poster-deployments and short-links handlers, `handlers/sponsors.ts` create and the placement path) for the exact body fields. Where a placement cannot be set to `sponsor_accepted = 1` through the API, collect its id in `manifest.acceptSql` for Task 6. Space requests to stay under `PUBLIC_READ_EDGE_LIMITER`/admin limits, at most 5 per second.
- [ ] **Step 4: Run the test; expect PASS. Born red:** drop the base-URL guard and watch the throw case fail. Restore it.
- [ ] **Step 5: Commit** `feat(stock): build a day of stock data through the admin API`.

### Task 5: Instagram art

**Files:**

- Create: `scripts/stock/instagram.mjs`, `stock/art-tags.json` (starts as `{ "tags": {} }`; maps a hashtag or caption word, lowercase, to event type ids or category codes)
- Test: `tests/unit/stock/instagram.test.js`

**Interfaces:**

- Produces: `listPosts({ token, fetch }) => Promise<Array<{ id, caption, hashtags: string[], mediaUrl }>>`. It calls `GET https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,timestamp`, follows `paging.next`, and keeps `IMAGE` and `CAROUSEL_ALBUM`. A 400 or 401 returns `[]` and sets `listPosts.warning`.
- Produces: `pickArt(find, posts, artTags) => post|null`. The candidates are posts whose hashtags or caption words map to the find's type or category. The pick is `candidates[fnv1a(venue + '|' + starts_at) % candidates.length]`; no candidates gives `null`.
- Produces: `tokenWarning(issuedDate: string, today: string) => string|null`, which warns from day 50 of 60.

- [ ] **Step 1: Write the failing tests:**
  - pagination across two pages;
  - a `VIDEO` post is dropped;
  - a 401 gives `[]` plus a warning;
  - the same find gives the same pick on two calls, and so does a reordered `posts` array if the sort is by id;
  - no matching tag gives `null`;
  - `tokenWarning('2026-09-01','2026-10-21')` is non-null and `('2026-10-01','2026-10-21')` is null.
- [ ] **Step 2: Watch them fail.** **Step 3: Implement** (sort candidates by id before indexing). **Step 4: Watch them pass. Born red:** remove the sort and watch the reorder case fail.
- [ ] **Step 5: Commit** `feat(stock): pick owner art from Instagram`.

### Task 6: Per-node check, swap and purge

**Files:**

- Create: `scripts/stock/check-full.mjs`, `scripts/stock/purge-full.mjs`
- Test: `tests/unit/stock/check-full.test.js`, `tests/unit/stock/purge-full.test.js`

**Interfaces:**

- Consumes: Task 4 `Manifest`; Task 3 `nodes`.
- Produces: `checkNodes({ client, manifest, nodes, today }) => Promise<Record<nodeId, { pass: boolean, count: number, reasons: string[] }>>`. It:
  - counts the day's manifest events assigned to the node (assignment = validator point-in-polygon; **strict, neighbors never count**) that `GET /api/v2/events` lists in the 90-day window, each with its server `h3_res7` among the node's overlapping `cells` as a sanity check; needs exactly `perNode`;
  - requires ≥ 1 `premium` sponsor in the node;
  - requires `GET /?zip=<first zip>` to have the area before the doors;
  - requires every `qPath` to return 200 and every `sPath` 302;
  - requires every event page to contain the sponsor strip testid and every art URL to return 200.
- Produces: `buildPurgeSql(manifest, nodeIds: string[]) => string`. It deletes those nodes' ids from every table keyed by those ids, child tables first, and leaves any append-only audit table alone. `listStaleManifests(names: string[], newestPassing: string) => string[]`.

- [ ] **Step 1: Write the failing tests:**
  - with `targets = { perNode: 12 }`, a node with exactly 12 of today's manifest events listed in its own cells passes; with 11 it fails (`count: 11, expected: 12`); 11 own plus 5 in a neighbor node still fails; 12 stock plus 3 hand-made (not in the manifest) passes;
  - `checkNodes` given `targets = { perNode: 9 }` throws before any request (`perNode below the map gate of 10`);
  - no test file under `tests/unit/stock/` contains a numeric count literal for the live site; the expected values come from the `targets` fixture;
  - a node with no `premium` sponsor fails with the reason `no-anchor`;
  - an `sPath` answering 200 fails;
  - `buildPurgeSql` for `['oak-lawn']` names only Oak Lawn ids, and deletes child tables before `events`;
  - the SQL never contains `DROP` or a `DELETE` without `WHERE … IN (`;
  - `listStaleManifests(['2026-11-01','2026-11-02','2026-11-03'], '2026-11-03')` returns the first two (Review Focus 3).
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Implement.** Get the table list from `workers/oursharedevents/migrations/` by finding every `event_id`/`sponsor_business_id`/`placement_id` column. List it as a constant with a comment naming each migration. A test asserts the constant covers every such column in the migrations folder, so a new table fails it.
- [ ] **Step 4: Watch them pass. Born red:** remove one table from the constant and watch the migration-coverage case fail.
- [ ] **Step 5: Commit** `feat(stock): per-node check and manifest purge`.

### Task 7: Search prompt, target guard and the workflow

**Files:**

- Create: `stock/search-prompt.md`, `.github/workflows/stock-data-full.yml`, `scripts/stock/run-day.mjs` (orchestrates Tasks 3–6 for the build and check jobs)
- Test: `tests/unit/stock/target-guard.test.js`, `tests/integration/stock-workflow.test.js`

**Interfaces:**

- Consumes: everything above. `run-day.mjs` subcommands: `validate`, `build`, `check-swap`. Each reads and writes files under `stock-out/` as job artifacts.

- [ ] **Step 1: Write the failing tests.**
  - `target-guard.test.js` reads every file in `scripts/stock/` and `.github/workflows/stock-data-full.yml`. It fails on `--env staging` not followed by `-full`, on `--env production`, on `stg.oursharedevents.com`, and on `//oursharedevents.com`. It passes on `staging-full` and `stg-full.`.
  - `stock-workflow.test.js` loads the YAML and asserts:
    - triggers are `schedule: cron '0 11 * * *'` and `workflow_dispatch`;
    - the jobs, in this `needs` order, are `access-gate` → `deploy` → `search` → `validate` → `build` → `check-swap`;
    - every job is on `ubuntu-24.04`, and `permissions` is `contents: read`;
    - `concurrency.group` is `stock-data-full` with `cancel-in-progress: false`;
    - `search` has `timeout-minutes: 30`;
    - `access-gate` runs `curl` with no credentials and fails unless the status is 302/403 or the `Location` header is on `cloudflareaccess.com`;
    - no step references `secrets.CLOUDFLARE_API_TOKEN` except `deploy` and `check-swap`.
- [ ] **Step 2: Watch them fail.**
- [ ] **Step 3: Write `search-prompt.md`.** It goes node by node in the order above, private sector (bars, restaurants, churches, other businesses) then public (park districts, libraries, chambers, villages). It keeps only events from today through +90 days that fit a type in the catalog file the step provides (dump of `GET /api/v2/admin/event-types`). It stops a node at `perNode + 3` good finds (read from `stock/targets.json` and substituted into the prompt by the step), writes only facts plus a one-line summary in its own words and a source URL, and never copies description text. It also records the businesses on each node's commercial strips, marking anchors. Output must match `stock/finds.schema.json` and `stock/businesses.schema.json`.
- [ ] **Step 4: Write the workflow.**
  - `deploy` runs `npx wrangler deploy --env staging-full` and `wrangler d1 migrations apply` for both `-staging-full` databases.
  - `search` runs the pinned `anthropics/claude-code-action` (pin by commit SHA, as other workflows do) on Sonnet with tools limited to web search, web fetch and writing `stock-out/finds.json` / `stock-out/businesses.json`. It uses `--max-turns 80`, plus the CLI's budget flag set from `vars.STOCK_SEARCH_MAX_USD || 5` if the pinned version has one; check `claude --help` in the step and fail closed if no cap can be applied.
  - `check-swap` first applies `manifest.acceptSql` (an `UPDATE … SET sponsor_accepted = 1, organizer_accepted = 1 WHERE id IN (…)`), then runs `checkNodes`. For each **passing** node it purges that node's ids from every older manifest (`listStaleManifests`). For each **failing** node it purges today's ids for that node, so yesterday's stay. It purges per node with `wrangler d1 execute ocr-db-staging-full --env staging-full --remote --file`, writes the manifest with `wrangler r2 object put ose-uploads-staging-full/stock/manifest-<date>.json --env staging-full --remote`, and prints a per-node table to `$GITHUB_STEP_SUMMARY` (node, expected `perNode`, stock listed, total listed, pass/fail, reasons). The job fails if any node failed.
  - Secrets: `ANTHROPIC_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`, `STG_FULL_ADMIN_KEY`, `STG_FULL_ACCESS_CLIENT_ID`, `STG_FULL_ACCESS_CLIENT_SECRET`, `CLOUDFLARE_API_TOKEN`. Var: `INSTAGRAM_TOKEN_ISSUED`.
- [ ] **Step 5: Run root `npm test` (incl. `infra-consistency`, `workflow-token-hardening`), `npm run lint:ci`; expect PASS. Born red:** put `--env staging` in `run-day.mjs` and watch the guard fail; drop `access-gate` from `needs` and watch the workflow test fail.
- [ ] **Step 6: Commit** `feat(stock): morning workflow for the full staging site`.

### Task 8: PR, CCR and owner handoff

- [ ] **Step 1:** Run lint and both test suites locally, then push once.
- [ ] **Step 2:** Open the PR with `Part of OSE-###` (the story the owner names or creates). The body carries the owner setup checklist from the spec and the pyramid matrix. It must state that the workflow will fail at `access-gate` / `deploy` until the owner completes setup.
- [ ] **Step 3:** CCR with the extended team (Dr of Security included: the unscoped key on a host with real-world data, the Access gate, the purge SQL).
- [ ] **Step 4:** After merge and owner setup, run `workflow_dispatch` once. Record the run id and per-node table on the Linear story. Done means T1–T4 green for the merge SHA (unchanged) **and** one green `stock-data-full` run.
