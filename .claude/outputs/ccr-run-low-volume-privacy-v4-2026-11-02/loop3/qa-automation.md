# Loop 3 (Adversarial), Sr Automation QA (`qa-automation`)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

Subject v4 frozen (sha256 dd9b8522...). Code: `ose-clock-gate` worktree at e7c8297b, where `src/` equals main 39a63d67. Paths are under `workers/oursharedevents/` unless they start with `.github/`, `scripts/` or `tests/`. `ci.yml` is `.github/workflows/oursharedevents-ci.yml`.

No score, no gate decision.

Basis key: **proven** (a command result), **source-read**, **arithmetic**, **inferred**.

**New proven facts this loop** (GitHub metadata, names only, read-only `gh api`):

- The GitHub environment `staging` has **no protection rules and no branch policy** (`protection_rules: []`, `deployment_branch_policy: null`). The environments are `copilot`, `main-automation`, `production` (1 required reviewer), `staging`. No `staging-pr` environment exists.
- `CLOUDFLARE_API_TOKEN_OSE` exists **only at repo level**. The `staging` and `production` environment secret lists are both empty. The production job (`ci.yml:2573`) and the T4 job therefore use the same token.

## 1. Attack cards

### R1-07 (S2 staging control passes on the fail-open). Verdict: works after the subject ships, on staging only

- **Actor:** a CI step on a same-repo PR, or an honest developer with a bug. Either needs only write access and one push.
- **Goal:** ship a marker that does not dedup, or does not exist, with the S2 staging step green.
- **Steps:**
  1. Delete the write at `src/handlers/qr-scan.ts:185`, or leave the pepper unset. The planned `check-dedup-marker-staging.sh` (subject C.8, "Tests" step list) sends **one** scan with a fresh per-run cookie. It never sends a repeat.
  2. Positive control (step 3 of the subject's list) waits for the trace poster's `scan_placement_events` count to rise by 1. The scan is counted whether or not a marker exists, so the control rises either way (source-read: the count insert at `qr-scan.ts:188-211` does not depend on the marker).
  3. Step 4 asserts only absence: no key in K1 minus K0 holds the cookie or `pd_trace_eagles_616`. An empty difference satisfies it. Nothing requires one new `scan:dedup:` key to appear.
  4. A lagging KV list, a dropped `put` and a missing binding all give an empty difference.
- **Strongest variant:** the marker key becomes `scan:dedup:` + sha256(scanKey) with no deployment and no hour. It names neither the cookie nor the poster, so staging stays green. That is a stable cross-hour browser name, and AC1's m2 and m4 forbid exactly it. Only the mock layer sees it.
- **Success condition:** a repeat scan is counted on staging. No criterion goes red on staging. **If none goes red, say so: none goes red on staging.** The mock layer goes red for a dropped `put` (the AC1 spy) and for a broken `get` (the existing 3-scans-1-row test at `tests/qr-scan.spec.ts:222-233`).
- **Grep proof (proven):** `scan:dedup` occurs in no test, Bruno or script file. It occurs only in `src/handlers/qr-scan.ts`, `src/lib/scan-buffer.ts` and `docs/features/QR-AND-SHORTLINKS.md`. No existing assertion anywhere says "same cookie twice, one row" on staging.
- **Would have caught it:**
  1. Send the same cookie twice. Assert D1 rose by exactly 1 and K1 minus K0 holds exactly 1 new `scan:dedup:` key. Zero keys means "control did not move".
  2. Print the new key's `expiration` and assert it is at most `now + 3600` (listing fields: see section 6).

### R2-01 (no cross-run lock on shared staging). Verdict: works on main today, worse after the subject ships

- **Actor:** a CI step on a same-repo PR (a `full-pipeline/*` branch), or two honest developers.
- **Goal:** false Done evidence (green on a build T4 did not test), or a false red that blocks the production tag.
- **Steps:**
  1. `deploy-staging` runs for any same-repo PR whose head ref starts with `full-pipeline/` (`ci.yml:1177-1191`). Its `environment: staging` has no reviewer and no branch policy (proven). Anyone with push access can start it.
  2. Concurrency groups are `ose-<event>-<PR number or ref>` (`ci.yml:156-157`), so different PRs and the main push share no group. `cancel-in-progress` is PR-only. The rollback drill is a third deployer (`staging-rollback-drill.yml`, merge-verified).
  3. Deploy freshness is asserted **once**, at T4 start (`ci.yml:1996-2001`; `scripts/assert-deploy-freshness.mjs:13-40` compares `/health`'s sha once).
  4. Three T4 legs (platform, forms, surfaces) run in parallel against the one Worker, D1 and KV (`ci.yml:1896-1900`).
  5. False green: the attacker watches the public log of main SHA B's T4. B's S4 or S2 step is about to run. The attacker pushes `full-pipeline/x` with a good build. Staging switches to A's build after B's freshness check, so B's later steps test A's Worker. A regressed B is green, and Done is claimed.
  6. False red: A's run writes `scan:dedup:` keys and trace rows. B's S2 set difference is over the global prefix, so it can pick up A's keys. A branch that is still old-shape contains `pd_trace_eagles_616`. That makes B red, and the red blocks the production tag (`deploy-production` needs `functional-staging`, merge-verified).
- **Cost:** one push per attempt, with no reviewer. The window is the 30-minute job ceiling (`ci.yml:1868`).
- **Success condition:** main's T4 is green on a build it did not test, or red on a build that is fine. **No criterion goes red:** the freshness preflight has already passed.
- **Memory versus code:** the owner decision "full-pipeline behind a `staging-pr` reviewer" (2026-10-12) is not in force. `ci.yml:1188` names `environment: staging`, and `staging` has no rules (proven).
- **Would have caught it:** one lock (a `concurrency` group shared by deploy-staging, T4 and the drill, with `cancel-in-progress: false`). Freshness re-checked at the end of T4. S2 diffs only keys whose name matches its own run's per-run hash. A required reviewer on `staging`.

### R1-09 (born-red argument omits `full-pipeline/*`). Verdict: works after the subject ships

- **Actor:** an honest developer, or a saboteur.
- **Goal:** merge a step whose compare or parse logic is wrong, so it is first run on main.
- **Steps:**
  1. The subject says a staging step "cannot be born red against a branch" (C.0). That is false: a `full-pipeline/*` PR does deploy and run T4 (`ci.yml:1177-1191`, `:1882`).
  2. Alternatively the whole logic is rehearsed offline with a stubbed `wrangler`. Only S14 gets such a root test (AC1 to AC3).
  3. So the six steps each have exactly one real run, on a main SHA. Each later main push re-runs it (the concurrency block cancels only PRs, `ci.yml:157`).
  4. A bad step is red on every later SHA. That blocks Done and the production tag, a CI rollback included (`needs: functional-staging`, merge-verified).
- **Success condition:** a red required aggregator with no owner. The subject has no step-quarantine or revert path for a wrong step. Nothing goes red earlier. **If none goes red earlier, say so: none goes red before the step runs on main.**
- **Strongest variant:** R1-46's absolute future-hour seed turns the aggregator red permanently on a calendar date.
- **Would have caught it:** a root test per script with a stubbed `wrangler` and `curl` (the S14 pattern), plus one recorded `full-pipeline/*` run per step. Seed hours derived at run time.

### R1-02 (one-grain rule stated as true before OSE-1784). Verdict: works after S15 ships if OSE-1784 slips

- **Actor:** a sponsor holding a report token.
- **Goal:** show the new `/privacy` sentence false.
- **Steps:**
  1. Seed poster A with 7 people and B with 3 in one hour.
  2. The report's poster attribution drops B (source-read, `shared-report-builder.ts:726-775`). `distinct_scanners` comes from the flooring of `saBuckets` at `:345-347` (source-read; DS's arithmetic of 10 beside A's 7 is not re-run). The two figures together give B = 3.
  3. S15 ships: `privacy.ts` says "We show a scan count only when at least 5 scans were counted at one poster in one hour; below that it reads 'fewer than 5'".
- **Success condition:** a sub-5 group (B = 3) recovered beside a sentence that says it is withheld. The leak is OSE-1784's. This card proves only the false words. **No criterion goes red:** S15 AC1/AC2 (`tests/integration/public-claims.test.js`) match phrases. The staging step curls `/privacy` for the same phrases.
- **Would have caught it:** a cross-surface test over the report: for a seeded event with one poster above 5 and one below, `distinct_scanners` minus the sum of published posters must not be a number below 5. It is red until OSE-1784. S15's sentence is blocked on it, or S15 cites it as a known false.

### R1-06 (S15 tests two files and eight phrases; the cookie text stays false). Verdict: works after S15 ships

- **Actor:** a privacy researcher.
- **Goal:** a dated record that the notice contradicts the traffic.
- **Steps:**
  1. Scan `/q/<token>`. The redirect sets `ose_anon` for one year (`qr-scan.ts:260-261`; the cookie gate `tests/e2e/0-architecture/cookie-setters.invariant.spec.ts:49` allows `qr-scan.ts` two `setAnonCookie` calls).
  2. Read the event page after S15. The unchanged sentence "Nothing about your device, location, or identity was collected to display this page" stays in `src/lib/never-who.ts:44-45` (events body) and `:55-56` (event body). S15 says "The other sentences stay" (C.4).
  3. `admin-settings.ts:167` and the landing text ("sets no cookies") are outside S15's scope.
- **Success condition:** the page denies collection beside a one-year cookie. **No criterion goes red:** AC1's denylist (`single click`, `indistinguishable`, `impossible to identify`, `no risk`, `verified presence`, `never linked`, `not linked`, `profile of you`) does not include the cookie claim. The staging step asserts the new sentences and the absence of "single click".
- **Would have caught it:** a derived test using the existing cookie-setter gate's list of routes that call `setAnonCookie`. For each destination page, the rendered text must carry a cookie disclosure, and no sentence may say nothing was collected. Run it in `en` and `es`.

### R1-10 (row order joins the two scan tables). Verdict: works on main, and S6 as written cannot go red

- **Actor:** an outsider with a D1 export.
- **Goal:** recover trails by rank join.
- **Steps:**
  1. The two inserts go in one batch (`src/lib/scan-buffer.ts:101-137`). Under the unique index on the return table (0101), repeats are dropped and the rank is otherwise aligned.
  2. S6 AC1 measures how well `rowid` order predicts return order. In the workers pool, N sequential direct scans give both tables ascending rowids in the same order. The predictor reports "linked" on **main with no fault** (source-read: `buildScanStatements`, no explicit rowid).
  3. AC2 injects a shared counter column and requires "linked". Main already says "linked", so the injected fault flips nothing: the born-red claim is unfalsifiable.
  4. S6's staging step "records the result in the job log" with no pass or fail condition (C.6).
- **Success condition:** the join works, and S6 neither fails nor can fail. **If none goes red, say so: none goes red.**
- **Would have caught it:** a two-sided predictor test. A fault that decorrelates order (write the WHO row in reverse) must make the predictor say "not linked", and the measured baseline must be **asserted**, not recorded. If the baseline is linked, S6 is red on main by design, which is the finding.

### R1-16 (the 03:00 run stores the open hour). Verdict: works on main, and S4's tests stay green

- **Actor:** an organizer at a busy evening event, or an injector under RA-1.
- **Steps:**
  1. The materializer's INSERT has no upper bound on `scan_bucket` (`src/lib/shared-report.ts:877-905`, merge-verified). The cron runs in every environment (`wrangler.toml:105,231,384`).
  2. A poster-hour is stored at 5 at 03:00:05, then reaches 7. S4's seal covers the read, and the stored cell stays stale until the next night's rebuild.
  3. The poster attribution reads raw rows and the corridor reads stored cells, so one response publishes 7 and 5 (difference 2).
- **Success condition:** a sub-5 difference of a sealed cell. S4's AC2 harness seeds sealed hours only, as the existing harness does (`tests/scan-counts-neighbour-floor.spec.ts:45-47`, `hour(2)`, `hour(26)`). Its staging step seeds `scan_cell_aggregates` rows directly with no materializer run. **No criterion goes red.**
- **Would have caught it:** one workers-pool spec with a fake clock. Run the materializer at H+00:00:05 with 5 scans, add 2 more, advance to H+1h+16m, and read attribution and corridor. They must agree.

### R1-23 (T4 token reaches production KV). Verdict: works after the subject ships (S2 asks for KV read); the production half works today

- **Actor:** a CI step on a same-repo PR (needs only push access).
- **Steps:**
  1. Any same-repo PR workflow run gets repo secrets. `full-pipeline/*` gets them with no reviewer (proven).
  2. `CLOUDFLARE_API_TOKEN_OSE` is repo-level only. The environment lists are empty (proven). The production job uses the same name. There is one account (`wrangler.toml:40`), and the production KV namespace id is in the repo (`wrangler.toml:340`).
  3. The planned wrapper (`staging-d1-read.mjs`) is client-side. A step in the same job can call `npx wrangler d1 execute` or `kv key list --namespace-id e44974e8...` directly with the token. Nothing in the job stops it.
  4. The repo has a runtime probe for the **GitHub** token (`scripts/ci/assert-token-read-only.sh`) and nothing equivalent for the Cloudflare token.
- **Success condition:** whatever the token's scope allows. Its real scope is unknown (section 6). Nothing in the subject asserts the token is read-only. **No criterion goes red.**
- **Re-rate:** loop 2's Medium fallback ("if the production environment overrides the secret") is false for the override half. Stays High.
- **Would have caught it:** a CI probe (inverse of the GitHub one): attempt an expected-refused write against a scratch D1 and a production KV list with the CI token. A resource-scoped, staging-only token.

### Left to other lenses

R1-01, R1-03, R1-04, R1-05, R1-08, R2-02 (Security, Data Scientist, Design, Product Owner). I note only that R1-08's pin cannot catch a short or "_OLD" pepper: `tests/integration/infra-consistency.test.js:290-292` requires production's substring `grep -q "$SECRET"` shape, which `ANON_ID_HASH_PEPPER_OLD` satisfies.

## 2. Attacks on the subject's own controls (fault, what stays green, what would catch it)

**S2 (staging step, AC1 to AC5)**

- _Fault A (R1-07):_ drop the write at `qr-scan.ts:185`. Green: the staging step (K1 minus K0 empty). Red: AC1 spy. Catch: repeat-scan test, one new key required.
- _Fault B:_ remove `expirationTtl`, or set it to a year. The mock KV stub ignores options (`tests/qr-scan.spec.ts:44-50`). Green: AC1 (key only) and the staging step. Catch: spy on the third argument equal to `{ expirationTtl: 3600 }`.
- _Fault C:_ an unpeppered or short pepper in the pool (R2-12: `vitest.workers.config.mts:367` sets only `ANON_ID_HASH_PEPPER`). AC1's independent equality needs a 32+ character pepper added to the pool. If the author reuses `pepperedKeyHash` to compute the expected value, a bug inside the helper is mirrored. Catch: compute the expected HMAC with `crypto.subtle` directly in the spec.
- _Fault D (AC5):_ the refusal sits in the staging loop at `ci.yml:1256` with `grep -q "$SECRET"` kept for the other names, so `RATE_LIMIT_KEY_PEPPER_OLD` still passes (substring, source-read). Green: the updated pin. Catch: pin the `-qw` form for every name in both loops.

**S3**

- _Fault A (AC1):_ add the leak under another console method or key (`console.warn`, `poster`, `bucket`, `first_visit`). `tests/qr-scan.spec.ts` has no console capture today (only an error spy at `:276`). `log-redaction.invariant.spec.ts:76-140` bans `anonId`, `anonymous_id`, cookie, token names and `request.url`, not `deployment_id`, `scan_bucket` or `is_new_anon`. Green: AC1's regex over one captured console. Catch: spy on all four console methods and assert each parsed line's key set equals `['type']`, not a denylist regex.
- _Fault B (AC2):_ rename `code` to `shortcode` and `timestamp` to `at` in `SHORTLINK_CLICK_LOG_ERROR` (`shortlinks.ts:348-356`). Green by name. Catch: exact key-set equality.
- _Fault C (AC4, staging):_ drop migration 0105. The staging step taps a link and the new Worker rewrites its own stamp, so it stays green. Mock AC4 is red only if the test asserts its statement count. The 0100 spec has that guard (`scan-split-hour-precision.spec.ts:159`), and S3's AC4 does not say it is required. Catch: assert the filter finds exactly 1 statement, and seed a never-tapped row with seconds, then read it after deploy.

**S4**

- _Fault A (AC2, staging, R1-15):_ a bound wrong by hours (open hour included, `<=`, G = 0) at one reader. The seed is a far-future hour (staging: absolute future hour; mock: "future"). Any bound error smaller than the distance to the seed stays green. AC2's per-reader fault is only "remove the bound". Catch: an injected clock with rows in (a) the open hour, (b) an hour that ended 14 minutes ago, (c) one that ended 16 minutes ago, per reader. (a) and (b) hidden, (c) visible.
- _Fault B (AC3 allowlist):_ the match is on `FROM scan_placement_events` text. Current grep (proven) finds 0 `JOIN` readers today, so a new reader can use `JOIN`, a comma join, a CTE, or a name built in a template. Green: AC3. Catch: also scan for the bare table name outside `scan-buffer.ts` inserts.
- _Fault C (AC4, AC5):_ the copy sits in a node that is never rendered for an open-hour scenario. A jsdom string check passes. FE proved on main that `oseEventView` shows "Scans fewer than 5" and "share the link" for 75+ minutes. Catch: render the open-hour state on all surfaces and assert visible text.
- _Fault D (AC6):_ refuse queue messages older than a day. The seed is a message two hours old. Green. Catch: the seed at several ages up to 7 days.

**S6** (see R1-10): AC1 records, AC2 unfalsifiable. The staging step cannot fail except on its own control.

**S7**

- _Fault A (AC1, R2-11):_ a later forms INSERT that omits `created_at` writes seconds from the live default. Green: AC1 and #1060's gate (forms entries have no `writerMustBindHourStamp`). Catch: set it on the forms entries, and a post-submit table-wide `created_at` check on every forms path.
- _Fault B (AC3):_ `expires_at` = hour + TTL + 30 days. The test says "never earlier", so over-retention is green. Catch: equality with `hourStart + TTL + 1h`.
- _Fault C (AC4):_ leave `ORDER BY created_at DESC` without `id DESC` (`forms.ts:761,849,853,857`). Miniflare's tie order is deterministic, so the test cannot go red. Catch: seed ties with ids in reverse insertion order and expect `id DESC`.
- _Fault D (staging):_ the step reads `LIMIT 1` of `form_registrations` only. Survey, email and check-in tables are not read, so an exact stamp left on any of them is green. Catch: table-wide count of values not ending `:00:00`, per touched table.

**S14**

- _Fault A (AC2):_ GitHub passes a missing secret as an **empty string** (`env: X: ${{ secrets.X }}`), not an unset variable. A guard written `=== undefined` passes the test that deletes the variable, and not the real case. Catch: a case with `CLOUDFLARE_API_TOKEN=''` (new finding L3-QA-2, Low).
- _Fault B (AC1/AC3):_ build the command as one shell string. A SELECT such as `SELECT '$(...)'` has no `;` and starts with `SELECT`, so the allowlist accepts it, and the stubbed spawn accepts anything. Catch: the stub asserts the statement is one argv element and spawn is called with no shell.
- _Fault C (R2-25):_ a FORMS_DB SELECT prints keyed ids to job logs. Green. Catch: output column allowlist.

**S15**

- _Fault A (AC1):_ reflow so "single click" splits across two lines. The source already breaks `counted as a` and `single click` across lines `never-who.ts:53-54`. Green: the raw substring match. Catch: match normalised rendered text (R2-22).
- _Fault B (AC2):_ put "can still tell whether anyone else scanned" in an HTML comment or a hidden node. Green: AC2 matches source text. The staging step on rendered `/privacy` would catch the hidden node, not a comment-only sentence on the event page.
- _Fault C (AC1 scope):_ the phrases outside `never-who.ts`, `privacy.ts` and `docs/` public-claim blocks, such as `web/` pages, other templates and the goldens, are not scanned. Catch: derive the scan set from every rendered public route, as the cookie gate derives its setters.
- _Fault D (AC4):_ "Fails if the PR adds an es key" has no test. Catch: a catalog test.

**S16**

- _Fault A (AC3):_ remove `<!-- owner-has-not-ruled -->` and set `Accepted` in one PR. Green. `.github/CODEOWNERS` locks ADR-014, ADR-020, workflows and four scripts (proven by reading). ADR-025 is not in it. Catch: CODEOWNERS entry for ADR-025.
- _Fault B (AC1/AC2):_ the RA-1 sentence inside a code fence, a quoted "rejected" block, or a negation. The test is a substring check. Catch: assert it sits in the Decision section.

**C.0 (nothing auto-closes, R2-17)**

- The guard's own test passes `Part of OSE-1` plus `Closes OSE-2` as OK (`scripts/check-pr-linear-close.mjs:163`). `WORD_THEN_ID` (`:65`) needs whitespace between word and id, so `Closes: OSE-1768` and URL forms are not matched (Linear's parsing of those is inferred, not read). Catch: a slice-PR rule that fails on any `OSE-\d+` within a few tokens of a closing word, with colon and URL test cases.
- _Companion:_ the six new steps are named `T4 S<n>: ...`. The named-checks test only recognises names matching `/^T4[0-9a-z-]*:/i` (`tests/unit/t4-named-checks.test.js:31`). **Proven** by a node run: `"T4 S2: dedup marker names no visitor or place"` gives false, `"T4S2: x"` true. The subject's names are not seen, so no named check is published for them. Adding the subject's "post list" lines also turns that test's count check red (`:47-49`). The aggregator only fails on the leg result (`ci.yml:2529-2545`), so a step skipped by a mistyped `if:` is green. This is L3-QA-1.

**H "Denial: A"**

- _Fault:_ one poison message dead-letters up to 100 real scans. `handleScanBatch` writes the whole batch in one `DB.batch` and retries all of it (`scan-buffer.ts:168-198`; `wrangler.toml:216-221`: batch 100, 3 retries, no `retry_delay`). The S4 AC6 test uses one clean sealed-hour message. Green. Catch: a batch with one poison message and 99 good ones stores 99; a dead-letter depth alert.

## 3. Cluster tests

- **C1 (scan order as a join key):** members R1-01, R1-10. QA view: nothing gates it. S6 records, S2's staging step checks names only. Combining gives more than either alone: R1-10's rank join gives (poster, hour) to a browser, and R1-01's KV listing gives the second (if `expiration` is listed, section 6). With one known (poster, hour) the join yields a browser with a second. Neither the S2 nor the S6 staging step goes red on this.
- **C2 (withheld vocabulary):** QA view: the staging steps assert numbers (`stats.scans.count = 6`), not the words. No single vocabulary test exists. Combining R1-03 and R2-02 gives the attacker no extra information (the admin copy and the sponsor's map are different readers). It widens the verification gap only.
- **C3 (scans are not people):** members R1-07, R1-08, R2-03. This is the one cluster where combining does give more. R1-07 removes the only detector. Worked: staging has `RATE_LIMIT_KEY_PEPPER` set but short (R1-08), then an operator rotates the pepper at the :55 mark (R2-03). Three people publish as 6. The S2 step sends one scan and checks for absence, so it stays green through all of it.
- **C5 (privacy notice):** the one `public-claims` test is a denylist, so it passes on all four members. A regulator reads a dated notice that says "no personal data" (`privacy.ts:58`), "counts say how many, never who" beside a one-year cookie (R1-06) and an unfloored `distinct_scanners` (R1-02). The stack is worse than each alone, a legal reading, inferred.
- **C6 (staging evidence):** confirmed. Worked example in R2-01 above. The combined attacker holds a choice of false green or false red. With no reviewer on `staging` (proven) the cost is one push. Multiplier 1.5 stands. I propose no tier change to C6.

## 4. New findings

| id      | Sev        | Slice                   | Claim                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                    | Basis                                    | Root cause                                                           | Not already a row because                                                                                               |
| ------- | ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| L3-QA-1 | Medium (5) | S2, S3, S4, S6, S7, S15 | The six new T4 steps use names `T4 S<n>: ...`. The named-checks drift test discovers gates by `/^T4[0-9a-z-]*:/i` with an `id`, so none is seen. Adding `post` lines for them turns its count check red. The aggregator fails only on the leg result, so a skipped step reads as success. | `tests/unit/t4-named-checks.test.js:31,36,47-49`; node regex run (false for `T4 S2:`, true for `T4S2:`); `ci.yml:2529-2545` | proven (regex), source-read (aggregator) | Done-bar discovery is by a name pattern, and skipped counts as green | R2-27 is schedule skip, R1-30 is bash slices missing the Done letter. Neither is name discovery or skipped-equals-green |
| L3-QA-2 | Low (2)    | S14                     | AC2 tests an unset token. A missing GitHub secret reaches the step as an empty string, so an `=== undefined` guard passes the test and fails in CI.                                                                                                                                       | subject C.2 AC2; GitHub Actions `env: ${{ secrets.X }}` behaviour (documented behaviour, not read this run)                 | inferred                                 | test models the wrong absence                                        | R1-27 and R2-25 are different roots                                                                                     |

I make no other new rows. R1-07, R1-10, R1-15, R1-27, R2-11, R2-13, R2-14 and R2-15 already carry the "cannot fail its own regression" pattern. My Section 2 items extend them with named mutants and do not open new roots.

## 5. Re-rates

- **R1-23:** stays High. The Medium fallback in loop 2's 2.4 (production overrides the secret) is false: both environment secret lists are empty (proven). The scope of the token remains the open half.
- **R2-01:** stays High; evidence added: `staging` environment has no protection rules (proven). The "staging-pr reviewer" decision is not in force.
- **R1-09:** stays High; add the corrected fact that `full-pipeline/*` runs for any same-repo push with no reviewer, so the cure is open to anyone with push access.
- **R1-07, R1-10:** hold at High. R1-10's born-red claim is unfalsifiable as written (AC2), which supports High.
- **R1-46:** hold at Medium.
- No loop-1 or loop-2 row is lowered.

## 6. Not checked

- No test run (a run writes reports). Every born-red claim and every mutant above is source-read, not seen failing. No fault was injected into any file.
- The Cloudflare token's real scope (KV list, D1 write, deploy). Not readable from the repo or from GitHub metadata. A read-only probe would be needed from the owner's terminal.
- **Whether a KV listing returns expiry:** not settled. My recollection of the Cloudflare KV list-keys API is that each key carries `expiration` (absolute Unix seconds) when one is set. That is inferred, not read here. It can be settled by the owner running `npx wrangler kv key list --binding RATE_LIMIT_KV --env staging --remote --prefix scan:dedup:` once and looking for an `expiration` field.
- Workers Logs content and retention for `/q/<token>`: not settled. `[observability] enabled = true` is top-level only (`wrangler.toml:95-96`). Whether it applies inside `[env.*]` is a Wrangler inheritance rule I did not verify.
- Dead-letter queue retention, the Queues default `retry_delay`, production migration level (77 versus 104): not readable without credentials. I did not attempt a Cloudflare API call.
- Linear's parsing of close words in `Closes: OSE-n` and URL forms.
- `scripts/vitest-retry.mjs` retry behaviour on the worker shards (whether a failing spec is re-run until it passes): not read.
- No Bruno collection exists for any retained slice, and the subject plans none. The six staging steps are bash and print no `test()` names. They are neither Bruno nor Playwright, the two layers AGENTS names. I record this against R1-30 and add no new row.
- I did not read the unrelated repository settings (branch rules, repository variables).

## 7. Commands run (all read-only; none refused)

- **Read tool:** the loop-3 brief, `.claude/skills/qa-playwright.knowledge.md`, the loop-2 register, loop-2 `qa-automation.md`, subject v4 (lines 1-379 and 495-619), `src/lib/scan-buffer.ts`.
- **Bash, scratchpad listing:** `ls -la`, `wc -l` over `ccr-run/`.
- **Bash, in `ose-clock-gate`:**
  - `git log --oneline -3`, `git status --short`, `git diff --stat 39a63d67 HEAD`, `git diff 39a63d67 HEAD -- .github/workflows/oursharedevents-ci.yml`.
  - `sed -n` over:
    - `src/handlers/qr-scan.ts`, `src/lib/rate-limit.ts`, `src/lib/scan-cells.ts`, `src/lib/shared-report-builder.ts`, `src/lib/never-who.ts`, `src/lib/shortlinks.ts`, `src/index.ts`, `src/router.ts`, `wrangler.toml`;
    - `tests/qr-scan.spec.ts`, `tests/scan-counts-neighbour-floor.spec.ts`, `tests/scan-split-hour-precision.spec.ts`, `tests/shortlinks.spec.ts`, `tests/unit/t4-named-checks.test.js`, `tests/integration/infra-consistency.test.js`, `tests/e2e/0-architecture/log-redaction.invariant.spec.ts`;
    - `vitest.workers.config.mts`, `scripts/ci/trace-scan-staging.sh`, `scripts/assert-deploy-freshness.mjs`, `scripts/check-pr-linear-close.mjs`, `scripts/ci/assert-token-read-only.sh`, `.github/CODEOWNERS`, `vitest.config.ts`;
    - `.github/workflows/oursharedevents-ci.yml` (ranges 140-160, 1177-1196, 1250-1270, 1866-1900, 1990-2060, 2448-2545, 935-990).
  - `grep -rn` and `grep -rln` for `scan:dedup`, `trace_eagles_616`, `timestamp-precision`, `single click`, the banned phrases, `JOIN scan_*`, `readEventScanCells`, `continue-on-error`, `observability`, `bruno`, `bru run`, `CLOUDFLARE_API_TOKEN` and `last_clicked_at`.
  - `ls` over `scripts/ci`, `bruno`, `migrations`, `migrations-forms`, `docs/adr`, `tests/integration`.
- **Bash, node:** `node -e` testing one regular expression against five strings. It reads and writes no file.
- **Bash, `gh api` (GET only, names and flags only):** repository environments (names, protection rules, branch policy), repository secret names filtered to six names, and the `staging` and `production` environment secret names. No secret value is readable through these calls, and none was printed.
