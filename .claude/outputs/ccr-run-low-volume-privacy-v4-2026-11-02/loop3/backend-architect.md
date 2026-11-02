# Loop 3 (Adversarial), Lead Backend Architect lens, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision. Paths are under `workers/oursharedevents/` unless prefixed. Code was read in `ose-clock-gate` (`src/` equals `origin/main` 39a63d67). Two typings lines came from the main checkout's `node_modules`, because the worktree has none.

Basis key: **proven** is a command result, including an in-memory SQLite model. **Arithmetic** is worked by hand. **Source-read** means I opened the file. **Inferred** is labelled and never stated as fact.

Highs left to other lenses: R1-02 and R1-04 (Data Scientist), R1-03 (FE and Design), R1-05 and R1-06 (Design and PO), R1-09 and R2-01 (SRE and DevOps), R1-23 (DevOps and Security), R2-02 (Data Scientist). For R2-02 I confirmed only that the map branch on row presence is as the lead read it (`src/lib/shared-report-builder.ts:836-862`, source-read).

## 1. Attack cards

### R1-10: row order joins the two scan tables

**Actor.** An outsider with a D1 export (or the operator). The organizer has write access but no read, so the organizer is the enabler and not the reader.

**Goal.** (poster, hour, browser key) for every counted scan, and a cross-event trail.

**Steps.**

1. Export `scan_placement_events` and `scan_node_returns`. Both are `id TEXT PRIMARY KEY` tables, so both have an implicit rowid (`migrations/0062_split_scan_path.sql:11-37`, source-read). The dump or a `SELECT rowid` yields insertion order. Dump order is inferred, but `rowid` is queryable (proven in the model).
2. Both rows of a scan are written in one `DB.batch`, placement then return, in message order (`src/lib/scan-buffer.ts:101-137` direct path; `:172-179` consumer path, source-read). A D1 batch is one transaction, so the two tables receive the same sequence. Queue reordering therefore changes nothing: both tables see the reordered sequence.
3. For each (event, hour), take both row sets in rowid order and pair rank i with rank i. The placement side carries the poster, the return side carries the `snk1_` key. This gives (poster, hour, key) per scan.
4. `INSERT OR IGNORE` plus the 0101 unique index drops a WHO row when one browser scans a second poster in the same event-hour (`migrations/0101:31-32`). That is the only break. It is detectable: placement count differs from WHO count. Where counts are equal, the alignment is exact.
5. Group by key across events: the trail. The key is the same at every event (`src/lib/scan-node-key.ts:19-21`). No second known point is needed when the counts match.

**What the attacker needs.** Export access only. Cost is one SQL join.

**Proven (in-memory `node:sqlite`, schema copied from 0062 plus the 0101 index).**

- Six scans over three posters: rank join gave `A-u1 B-u2 A-u3 C-u4 B-u5 A-u6`, every pair correct.
- After u1 also scanned B in the same hour: placements 7, WHO 6. The naive join then mispairs from the next row (it gave `B-u7` for a scan at C), and the count mismatch flags it.
- With one gap over n rows there are n consistent alignments.
- An ignored insert consumes no rowid.

**Correction to loop 2.** Loop 2 says "at most 4 candidates, a second point narrows it". That is the order-blind model. With order, it is exact whenever the per-event-hour counts match, which is the usual low-volume case. The "12 of 12 is an upper bound" line understates the typical case.

**What the subject's criteria show.** S6 AC1 and AC2 stay green. The spike records "linked" or "not linked" and fixes nothing. Its staging step reads the trace poster only, so it is rank 1 to rank 1 and links under any ordering. No criterion goes red.

**Success.** Never-who at rest (invariant 1) and doctrine rule 6 are broken for the D1 holder. The published floor holds. The attacker holds an exact withheld poster-hour (below 5) with the key that scanned it.

**Verdict.** Works on main, and works after the subject ships (S6 only measures). Severity stays High. I propose rewording the row to "exact, not candidates, where counts match".

### R1-16: the 03:00 materializer stores the open hour

**Actor.** A hostile organizer or sponsor with a mid-tier report token and no injection, or an injector.

**Goal.** An exact sub-5 slice of one poster-hour (1 to 4 scans) from two published figures.

**Mechanism (source-read).**

- `aggregateScanCells` has no upper bound on `scan_bucket` (`src/lib/shared-report.ts:895-905`). It stores `SUM(CASE WHEN ph.scans >= 5 THEN ph.scans ELSE 0 END)` per cell and keeps a 0 row for a sub-5 cell-hour (`:865-871`).
- It is the last step of `aggregateScanBuckets` (`:812`), which first does one awaited D1 write per bucket in a sequential loop (`:735-755` region). The snapshot time is therefore 03:00:00 plus cron jitter plus (bucket count x write latency). The platform facts are unmeasured, so the delay is inferred.
- The only trigger is the cron (`wrangler.toml:105, 231, 384`; `src/index.ts:153`). A grep shows no other caller (proven).
- One report response mixes stored and live data. The corridor map reads stored `scan_cell_aggregates` (`src/lib/shared-report-builder.ts:840-846`). `poster_attribution` reads raw rows per request (`:722-743`).

**Steps.**

1. Choose an evening US event so that 03:00 UTC falls inside it (23:00 EDT).
2. Let a = scans at one poster in hour 03 before the snapshot, and b = scans after it, with L = a + b.
3. Read the report after the hour seals (S4's own bound, 04:15 UTC). The stored cell is s = a if a is at least 5, else 0. The live poster figure is l = L if L is at least 5, else 0.
4. For a one-poster cell the difference is l − s = b exactly (arithmetic, model-checked).
   - a=5, b=2: stored 5, live 7, diff 2.
   - a=5, b=4: diff 4.
   - a=7, b=1: diff 1.
   - a=5, b=5: diff 5, which is publishable and no leak.
   - a=4, b=3: stored 0, live 7, no leak (the difference is L, at least 5).
5. A leak needs a at least 5 and b from 1 to 4. No second figure is needed beyond the same response. The next night's rebuild then moves the sealed cell from a to L, so two reads a day apart also give b.

**Reach.** It needs 5 or more real scans at one poster before the snapshot, in the 03:00 UTC hour only. That is plausible if the snapshot lags by a minute or more and the poster is busy. It is rare if the snapshot lags by seconds. The lag is inferred. A busy-poster rate is about 5 per minute. The organizer cannot move the snapshot, and inflating the bucket count to delay it is cost-bound and capped by the subrequest limit (inferred).

**Injector variant.** Adds nothing over RA-1 (F-2). An injector who adds 5 reads 5 + r exactly already.

**What the subject's criteria show.** S4 makes it worse, not better. S4's bound sits on the stored hour columns. Hour 03 is sealed at 04:15, so S4 publishes the stale cell as sealed, and the live figure from raw rows differs. S4 AC2 adds a row in a future hour and changes nothing, so it passes. The staging seed writes stored cells without a materializer run (`lowvol-sealed.sql`), so the stale-cell case is never produced. No criterion goes red.

**Success.** The under-5 floor (invariant 2, "no exceptions") is broken, for place-side data.

**Verdict.** Works on main and works after the subject ships. S4's text "a cell cannot change after its hour plus the grace" is false for stored cells (arithmetic plus source-read). It is blocked only if S4 also bounds the materializer's INSERT or builds corridor cells from the same sealed read. Severity stays High, but the reach statement should say "03:00 UTC hour only".

### R1-07: S2's staging control passes on the fail-open

**Actor.** A saboteur or an honest developer on a `full-pipeline/*` run, or a binding mistake.

**Goal.** Ship a marker that does nothing while every layer stays green.

**Steps.**

1. The marker write is `qr-scan.ts:178-187`. If `RATE_LIMIT_KV` is absent the `if` is skipped. If `put` is dropped, nothing is written. Both outcomes count every scan.
2. S2 staging step: K0 is the key set before. Then one scan with a per-run cookie. Then a D1 positive control (the placement count rises by 1, which happens either way). Then K1 − K0 must not contain the poster id or the cookie.
3. With a dropped `put`, K1 − K0 is empty, so the assertion holds and the step is green. The D1 control rises because the scan is counted anyway.
4. Mock layer: AC1 fails only if `put` is never called, but AC2 and AC3 assert "no marker" on purpose. A fault that always takes the no-marker branch is green on AC2 and AC3.
5. Nothing in the subject asserts "same cookie twice gives one row" on staging. I grepped the register's claim (QA grep) and found nothing in the subject text either.

**Success.** A repeated scan by one person is counted. The floor holds in letter only. No criterion goes red.

**Verdict.** Works after the subject ships. On main the marker works today. Severity stays High.

### R1-08: the S2 silent no-marker path

**Actor.** Operator error, then any visitor (or the hostile organizer, who needs no skill).

**Goal.** One person publishes "5".

**Steps.**

1. Today the marker needs no `RATE_LIMIT_KEY_PEPPER`: the key is `scanKey ?? anonId` (`qr-scan.ts:179`). The attack does not work on main.
2. S2 AC1 moves the key onto `pepperedKeyHash` under `RATE_LIMIT_KEY_PEPPER`. S2 AC3 then writes no marker if that pepper is missing or under 32 characters. The helper itself silently falls back to unpeppered SHA-256 below 32 (`src/lib/rate-limit.ts:122-132`, source-read).
3. Neither deploy gate checks that value.
   - Staging: `grep -q "$SECRET"` over `wrangler secret list` (`.github/workflows/oursharedevents-ci.yml:1255-1257`).
   - Production: the same loop (`:2664-2666`).
   - A name only. The substring match is satisfied by `RATE_LIMIT_KEY_PEPPER_OLD`. Length is enforced only in `scripts/set-secrets.sh`, which a direct `wrangler secret put` skips.
   - S2 AC5 tightens only the ANON name (`-qw`) and leaves this one at `-q`.
4. The code does not enforce a minimum on `ANON_ID_HASH_PEPPER` either (`scan-node-key.ts:101` checks `!pepper` only). A 1-character value works.
5. With the marker off, one cookie scanning a poster 5 times in an hour makes 5 placement rows and a published 5. The edge limit is 60 per 10 s (`src/lib/edge-rate-limit.ts:45-47`). The KV limit is 360 per minute (`src/lib/public-read-limit.ts:53`).
6. The 0101 unique index keeps the WHO table at 1 row. Placement then reads 5 against 1 person, an inconsistency anyone with D1 can see.
7. The only signal is `ANON_ID_HASH_PEPPER_MISSING`, once per isolate (`qr-scan.ts:44-54`), and only for the ANON pepper. A short or missing `RATE_LIMIT_KEY_PEPPER` has no log in the S2 design.

**Success.** The floor is met in letter, and "5 people" is false in meaning (`shared-report.ts:865-867` relies on dedup). No criterion goes red. S2 AC2 and AC3 assert this behaviour as wanted.

**Verdict.** Works after the subject ships (created by S2), blocked on main. Severity stays High. Clusters with R1-07.

### R1-01: the at-rest promise is false outside the scan tables

**Actor.** An outsider with a D1 export plus a KV listing (or the operator).

**Goal.** (browser, poster, hour, second) per counted scan.

**Platform facts settled from typings** (`@cloudflare/workers-types ^5.20260930.2`, main checkout `node_modules/.../index.d.ts`, source-read; runtime precision not proven).

- `KVNamespaceListKey` has `expiration?: number` (lines 2245-2249). A KV listing carries the expiry of each key.
- `Message` has `timestamp: Date` (lines 2455-2462), the enqueue time. The consumer never reads it (`scan-buffer.ts:172-179`).

**Steps on main.**

1. List `RATE_LIMIT_KV` with prefix `scan:dedup:`. Each key name is `scan:dedup:{snk1_...}:{pd_...}:{hour}` (`scan-buffer.ts:72-74`; `qr-scan.ts:179`). That is the browser, poster and hour in one readable string.
2. `expiration` is `put_time + 3600` (`qr-scan.ts:185`), so subtract 3600 to get the second of the scan.
3. Poll the list once a minute and archive it. The 1-hour TTL limits storage, not an attacker who snapshots. This builds the permanent WHO-plus-WHERE-plus-second store that doctrine rule 6 forbids.
4. Without the pepper (staging today): the key holds the raw cookie.

**After S2.**

- Named pairing is blocked from anyone without `RATE_LIMIT_KEY_PEPPER` (AC1 hashes the key).
- The expiry survives. Sort markers by expiry and pair them with placement rows in global rowid order within the hour (direct path: request order, so near-exact; queue path: some reorder, so approximate). Each placement row then gets a second-resolution timestamp. S2 AC1 to AC5 never touch the TTL or expiry (S2 text; R2-12 notes the mock stub ignores put options).
- A holder of D1 plus `RATE_LIMIT_KEY_PEPPER` but not `ANON_ID_HASH_PEPPER` reverses the marker in one pass. The input set is the snk1 values already in the WHO export times the posters. The subject's threat review states "cannot read the triple without RATE_LIMIT_KEY_PEPPER", which is true but weak: these are two secrets of the same operator.

**With write access as an organizer.** The organizer creates a poster deployment and scans it at a chosen second. That gives the colluding insider ground truth to calibrate rank-to-expiry alignment and measure lag. It adds no read capability.

**Verdict.**

- Works on main (the name pairing and the expiry).
- Works after the subject ships for the expiry, rank and timestamp leg.
- Blocked by S2 AC1 for the name pairing, except for a pepper holder.
- Severity stays High. I propose naming the expiry explicitly as an open leg.

## 2. Attacks on the subject's own controls

These are faults that leave the criterion green.

1. **S2 staging step and AC1 to AC5 (R1-07, R1-01).** Fault A: delete the `put` call. Fault B: keep `{ expirationTtl: 3600 }` on a correctly hashed key. Both leave every S2 criterion green. A is invisible because the assertion is a negative set difference. B is invisible because no criterion reads expiry. Another: set `RATE_LIMIT_KEY_PEPPER` to 10 characters. The gates pass on the name.
2. **S4 AC2 and the staging seed (R1-16).** Fault: leave the materializer INSERT unbounded, so it stores the open hour. AC1 (a fixed clock), AC2 (a future row, no value change), AC3 (a FROM-text allowlist) and the seeded staging cells are all green. The seed writes cells directly, so the materializer's output is never produced. Also, AC3 matches `FROM` text only. A reader written as `JOIN scan_placement_events` would not match. No such reader exists today (grep, proven), so this is a latent hole (R1-14).
3. **S6 AC1, AC2 and the staging step (R1-10).** Fault: reverse the order in which WHO inserts are pushed in `handleScanBatch` for n of at least 2 per batch, so the tables no longer align. The staging step reads one or two trace rows, so rank 1 to rank 1 links either way and the fault cannot be seen. AC2's injected shared column proves the predictor can say "linked", not that real ordering links. The spike also never exercises the 0101 drop case or the erasure case (see L3-BE-1).
4. **S3 AC1 (log regex).** Fault: `console.log(JSON.stringify({ type, d: deploymentId, h: bucket }))`. The AC searches for the key names `deployment_id`, `event_id`, `scan_bucket`, `is_new_anon` and the value prefixes `snk1_` and `anon_`. Deployment ids look like `pd_...` and event ids `evt_...`, which are not searched. The platform stamps each line, so the placement leak survives and the AC stays green.
5. **S2 AC5 (staging pepper gate).** `grep -qw ANON_ID_HASH_PEPPER` checks a name. An empty or 1-character value, or a `RATE_LIMIT_KEY_PEPPER_OLD` for the other name, passes. The fail-open still ships.

## 3. Cluster tests

**C1 (scan order as a join key): a combination gives more.** R1-10 alone gives (poster, hour, key). R1-01 alone, after S2, gives (opaque marker, second). Joined, every placement row gets a second.

Worked example:

- Poster pd_X, hour 20, has three scans. Their KV expiries minus 3600 are 20:13:41, 20:14:02 and 20:16:30.
- FORMS_DB has a registration at 20:14:07 with `source_placement_id = pd_X` (pre-S7 seconds: `forms.ts` binds a millisecond stamp).
- The scan 5 seconds earlier is the registrant. The candidate set drops from 3 to 1, and the cross-event key trail follows.
- After S7, the forms side keeps the hour only, so the seconds step is lost. The candidate set stays at 3, or 1 if a second point exists.

So C1 is worth more than either row only until S7 and only while KV is archived.

**C2 (withheld vocabulary).** R1-16 plus R2-02 gives more. A kept 0 row is the map's "suppressed" state (`shared-report.ts:866-871`). A stored 0 for a cell-hour at snapshot time (a<5) while live shows L at least 5 tells the reader that fewer than 5 had scanned by 03:00:Δ. That is a timing bit on top of the presence bit. Alone neither gives it.

**C3 (scans are not people): yes.**

- R1-07 hides R1-08, and R2-03 (a rotation resets the markers) makes the same failure arrive by routine. Example: a short `RATE_LIMIT_KEY_PEPPER` and an honest visitor who reloads 5 times publish "5" with no signal.
- One more mechanism is new (L3-BE-2): the get-then-put race.

**C5 (privacy notice).** Not my lens. From the backend side, the notice's "count is at least 5 people" claim is false under R1-08 and L3-BE-2.

**C6 (staging evidence).** Not my lens. From the backend side, S2's step needs KV list scope on the T4 token (R1-23), so staging evidence for S2 couples to the token problem. If the token lacks the scope, the step is red, which blocks the chain. If it has it, R1-23 widens.

## 4. New findings

| id      | Sev                      | Slice            | Claim                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                    | Basis                                                                                                                                  | Root cause                                                                              | Why it is new                                                                                                                                                                                                                                                        |
| ------- | ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3-BE-1 | Medium (5)               | S2/S6 area, main | Erasure and retention delete from `scan_node_returns` only, so the per-event-hour count gap marks that someone who was erased scanned in that hour, with n candidate alignments (n = the poster rows in that event-hour).                                                                                                             | `src/handlers/data-subject.ts:216-222` (DELETE on `scan_node_returns` only); `src/lib/scan-returns-retention.ts:109-121` (WHO only, by `scan_bucket`)                       | Proven in model: 4 placements vs 3 WHO after deleting one key; naive join then mispairs (`A-k_u4 C-none`)                              | Asymmetric deletion across the two tables                                               | R1-10 covers alignment and E9 covers prefixes. This is the erased subject's own hour left visible. It is not in R1 or R2.                                                                                                                                            |
| L3-BE-2 | Low (2)                  | S2               | The marker is `get` then `put`, not atomic. Parallel same-cookie requests can all read null and all be counted. KV propagation across locations can add misses.                                                                                                                                                                       | `qr-scan.ts:180-186`                                                                                                                                                        | Source-read. The outcome under KV's per-key write limit is inferred and untested.                                                      | Non-atomic check-and-set on an eventually consistent store                              | R1-07, R1-08 and R2-03 are about the marker being absent or rotated, not about a correctly configured marker losing a race. Cookie-less padding is already OSE-1780, so for attackers it adds nothing. It matters for honest double-fire and for the "people" label. |
| L3-BE-3 | Medium (5), staging only | S2/R2-18         | A hostile organizer can lose other brands' queued scans. The event-delete guard counts only written rows, so an organizer can scan their own poster, delete the event during the batch window, and the consumer batch fails on FK. The batch is not per event, so up to 100 messages from other brands retry 3 times and dead-letter. | `src/handlers/events.ts:1670-1700` (guard on written rows); `scan-buffer.ts:172-198` (one batch for all messages); `wrangler.toml:216-221` (batch 100, retries 3, no delay) | Source-read. D1 FK enforcement is taken from the code comment at `events.ts:1688`, not run. Needs timing inside the ~5 s batch window. | The guard is blind to in-flight queue messages, and the consumer batches across tenants | R2-18 names "a poison message" but gives no actor who can mint one. Production has no queue, so staging only. Also pushes (key, poster, hour) pairs into the DLQ (the F-9 residual).                                                                                 |

Out of scope, recorded once and not rated: the injected-scan presence bit and cookie-less padding (OSE-1780); who-side count publication (OSE-1783 and OSE-1784); cookie signing (OSE-1496). The organizer-induced DLQ pairing sits with L3-BE-3.

## 5. Re-rates with reasons

- **R1-10:** stays High. Reword to "exact where counts match" (proven in the model).
- **R1-16:** stays High. The reach statement should read "03:00 UTC hour only, needing 5 or more scans before the snapshot". The injector path adds nothing over RA-1 (F-2).
- **R1-08:** stays High. It does not work on main, so it is created by S2. That should be stated in the row.
- **R1-07 and R1-01:** stay High.
- Platform facts settled from typings: a KV listing carries `expiration`, and `Message.timestamp` exists. Both are typings only. Runtime precision, and whether `wrangler kv key list` prints `expiration`, can be settled by S2's own staging step (read-only on staging, owner credentials).

## 6. Not checked, and why

- Runtime behaviour of KV, D1 and Queues. No network was used.
- Real snapshot lag after 03:00 UTC. It depends on bucket volume and D1 latency. I could not measure it, so R1-16's reach is inferred.
- Dead-letter queue retention, Workers Logs for `/q`, the staging token's real scope and its GitHub secret level, and the production migration level (77 last read versus 104). The repo cannot settle these. R1-23 is left to DevOps and Security.
- Whether `wrangler d1 export` emits rows in rowid order. I assumed table-scan order (inferred). `SELECT rowid` makes the attack independent of it.
- The forms-side seconds in the C1 example: I read the subject's description of `forms.ts` stamps and did not reopen `forms.ts`.
- I did not run the repo's tests.

## 7. Commands run

None was refused. No file or repo state was changed. All commands were read-only, and the two `node -e` runs used an in-memory SQLite database and wrote nothing to disk.

- **Read tool:** the brief, the Backend Architect knowledge file, the frozen subject v4 (three reads, all sections), the loop-2 merged register, `src/lib/scan-buffer.ts`, `src/handlers/qr-scan.ts`, `src/lib/scan-node-key.ts`, `migrations/0062`, `0100`, `0101`, `src/lib/shared-report.ts:820-976`, and `src/lib/scan-cells.ts`.
- **Bash (sed, grep, wc, ls, node):**
  - `wc -l` over the scan files and migrations.
  - `sed -n` on `src/lib/shared-report-builder.ts` (715-760, 826-870), `src/lib/corridor-map.ts` (95-130), `src/index.ts` (140-165), `src/handlers/data-subject.ts` (205-250), `src/lib/scan-returns-retention.ts` (95-140), `src/lib/rate-limit.ts` (25-45, 70-80, 115-135), `src/lib/shared-report.ts` (690-815), `src/handlers/shared-report-materialize.ts` (44-110), `src/handlers/events.ts` (1660-1730), `src/lib/public-read-limit.ts` (45-60), `src/lib/edge-rate-limit.ts` (40-50), `.github/workflows/oursharedevents-ci.yml` (1250-1270, 2655-2668), and `scripts/set-secrets.sh` (60-80).
  - `grep` for `crons`, `SCAN_QUEUE`, `observability`, `retry_delay` and related lines in `wrangler.toml`.
  - `grep` for the materializer callers (`aggregateScanCells`, `runSharedReportPipeline`, and similar).
  - `grep` for `scan_cell_aggregates`, `scan_placement_events`, `JOIN scan_placement_events`, `rowid` and `ORDER BY ... scan_` in `src`.
  - `grep` for `RATE_LIMIT_KEY_PEPPER` in the CI workflow and secret scripts.
  - `grep` and `sed` on `@cloudflare/workers-types/index.d.ts` in the main checkout (`KVNamespaceListKey`, `Message`, `KVNamespacePutOptions`). The worktree has no `node_modules`.
  - `node --version` (v24.14.1).
  - `node --no-warnings -e` twice with `node:sqlite` in memory, for the rank-join, drop, erasure and rowid model and for the R1-16 arithmetic. The first run failed on a quoting error after printing the first three results. The second run completed.
