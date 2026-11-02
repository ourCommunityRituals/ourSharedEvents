# Loop 3 (Adversarial), DevOps Mgr lens, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

I give no score and no gate decision. Basis tags: **proven** (a command result), **source-read**, **arithmetic**, **inferred** (never stated as fact). Code was read in the `ose-clock-gate` worktree (HEAD e7c8297b, `src/` equals main 39a63d67). Paths are under `workers/oursharedevents/` unless they start with `.github/`, `docs/`, `scripts/`, `tests/` or `tools/`. `ci.yml` is `.github/workflows/oursharedevents-ci.yml`.

## 0. What I settled about the token and the environments

| Question                                             | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Basis                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| One Cloudflare account?                              | Yes. `account_id` is hard-coded at `wrangler.toml:40`. Staging and production D1, KV, R2 and the edge-limiter namespaces all sit in it (`:163,171,184,319,327,340`). The production KV id is public in the repo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | source-read                                                               |
| Same secret name in staging and production deploys?  | Yes. Staging deploy uses `secrets.CLOUDFLARE_API_TOKEN_OSE` (`ci.yml:1248,1273,1373`); production deploy uses it too (`:2656,2705,2774`). `deploy-staging` has `environment: staging` (`:1192`), `deploy-production` has `environment: production` (`:2573`). T4 `functional-staging-sub` declares none (`:1866-1890`; register fact f).                                                                                                                                                                                                                                                                                                                                                                                  | source-read                                                               |
| Is the secret repository-level or environment-level? | The owner's own instructions set it at repository level: `gh secret set CLOUDFLARE_API_TOKEN_OSE --repo ourCommunityRituals/ourSharedEvents` (`.claude/outputs/TOKEN-PICKUP-2026-10-19.md:36`). `docs/security/PR_SECRET_EXPOSURE_GUARD.md:63-69` (verified 2026-09-26) says all sensitive secrets, this one included, are repo-level, and that the `staging`, `production` and `copilot` environments had zero protection rules. The fix ("Environment protection") is described as "chosen direction", not as done. `grep staging-pr` over `ci.yml` finds nothing, so the reviewer environment named in the 2026-10-12 hardening decision is not wired. Whether the owner ran `gh secret set --env` is not in the repo. | source-read; live state **inferred, unsettled**                           |
| Token scope                                          | The documented least-privilege token (`CF_API_TOKENS_POLICY.md:48-53`, `.github-secrets-required.json`) lists Workers Scripts Edit, Workers Routes Edit and Account Settings Read, with KV Edit "if using KV". It has no D1 and no R2. CI runs `wrangler d1 migrations apply --remote` (`ci.yml:1276,2708`), so the live token is wider than that document. The owner's plan of 2026-10-12 (`TOKEN-OVERHAUL-TONIGHT-2026-10-12.md:39`) is an account-scoped token with Workers Scripts, D1, KV and R2 **Edit**, 90-day expiry. `TOKEN-OVERHAUL-QUEUE-2026-10-12.md:21` calls it "Deploy plus D1 read/write on staging and production".                                                                                    | source-read; the live token is inferred from the plan and from green runs |
| Does the subject's KV-scope ask matter?              | Subject C.2 (S14 "Owner actions") says S2's KV list may need a scope added. By the owner's plan the token already holds KV **Edit** account-wide, which covers production's KV namespace. Cloudflare API tokens cannot be limited to one KV namespace (inferred platform fact).                                                                                                                                                                                                                                                                                                                                                                                                                                           | source-read plus inferred                                                 |
| Is the prior CCR aware?                              | Yes. `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md` rows E10/F7 rate "same-repo PR heads reach the token in T2 and T4 (no `environment:`)" at Medium. The 2026-10-19 hand-off asks the owner to "accept the PR-head reach in writing" (`TOKEN-PICKUP:48`). I found no recorded acceptance.                                                                                                                                                                                                                                                                                                                                                                                                                                   | source-read                                                               |
| Is there a review gate on main?                      | `tools/ci/main-branch-protection.json` has `"required_pull_request_reviews": null` and ten required status checks. CODEOWNERS (`.github/CODEOWNERS`) locks `/.github/workflows/` to one owner, but `*` is the same owner. In the desired-state file, CODEOWNERS review is not enforced. Live protection was not read (the nightly drift workflow reads it).                                                                                                                                                                                                                                                                                                                                                               | source-read; live inferred                                                |
| `prod-preflight.mjs` in any workflow?                | No. `grep -rln prod-preflight .github/workflows` printed nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | proven                                                                    |
| Production migration level                           | Last read 77 on 2026-10-01 (`docs/runbooks/PRODUCTION-MIGRATION-PLAN.md:14-18`, `docs/brain/ROLE-STATE.md`, the Reconciled 2026-10-01 bullet). Nothing in CI compares the levels (AGENTS.md "Not yet enforced"). The production Worker is deployed (read live 2026-10-03); the commit it runs is "unknown" (same ROLE-STATE). Not settled.                                                                                                                                                                                                                                                                                                                                                                                | source-read                                                               |

How the owner can settle the unsettled parts without a secret, all read-only. I did not run any of these.

- `gh secret list --repo <repo> --json name,updatedAt`, then `gh secret list --env production` and `--env staging`: names only.
- `gh api repos/<owner>/<repo>/environments/production` for reviewers and branch rules.
- The Cloudflare dashboard token page, or `GET /accounts/<id>/tokens/verify` (the call named in `classify-wrangler-failure.sh:38`), plus the token's policy list.
- KV expiry: `wrangler kv key list --binding RATE_LIMIT_KV --env staging --remote --prefix scan:dedup:` and look for an `expiration` field. Cloudflare's list-keys API documents one for keys with a TTL (inferred, not verified).
- DLQ retention: `wrangler queues info ose-scans-dlq`. Workers Logs under the environment blocks: look at the dashboard for `oursharedevents-prod`.

## 1. Attack cards

### R1-08 short or missing `RATE_LIMIT_KEY_PEPPER`

**Actor.** Platform operator or insider with `wrangler` on a workstation; or the CI step that runs `set-secrets.sh`; or operator error. Any attendee then benefits.

**Goal.** A published "5" from one honest person, with no log line any alert reads.

**Steps.**

1. Put a short value. `echo x | npx wrangler secret put RATE_LIMIT_KEY_PEPPER --env production` skips the only length check, which lives inside `scripts/set-secrets.sh:98-118` (min 32, and only on its own prompt loop). The hook `.claude/hooks/policy-gate.mjs:1215-1217` blocks `secret put`, but only for an agent shell where the owner installed it, by command text, and it fails open (AGENTS.md; ROLE-STATE). A human terminal is not covered. A `secret put` creates a new Worker version (`ROLLBACK.md:202`, sourced from Cloudflare docs read 2026-10-07; not run here). That is a production change outside CI.
2. No gate sees it. Both deploy gates match names only: `ci.yml:1255-1257` (staging, four names, `grep -q`) and `ci.yml:2664-2666` (production, five names, `grep -q`, substring). `RATE_LIMIT_KEY_PEPPER_OLD` also satisfies them. Both gates run only at deploy time, so a short put between deploys is seen by nothing.
3. Runtime accepts it silently. `src/lib/rate-limit.ts:120-133` falls back to unpeppered SHA-256 below 32 characters and logs `RATE_LIMIT_PEPPER_MISSING` once per isolate (`:93,123-131`). Nothing reads that line (register R1-08, R2-19).
4. Under the subject: S2 AC3 (subject C.8) writes no dedup marker when the pepper is missing or under 32, and counts the scan. S2 AC2 does the same when `ANON_ID_HASH_PEPPER` is unset.
5. One visitor reloads one poster. Counted requests per address are bounded at 60 per 10 s at the edge (`wrangler.toml:85,195,351`, `src/lib/edge-rate-limit.ts:45-47`) and 360 per minute in KV (`src/lib/public-read-limit.ts:53`). Five reloads in about a second are counted. Each is a separate `scan_placement_events` row, and the poster-hour publishes 5 (arithmetic).

**Cost and timing.** One command, then a second of reloads. The attacker needs only the operator's mistake.

**Success.** A published count of 5 made by one cookie. The floor holds in letter and fails in meaning ("K scans = K people", `scan-cells.ts:11-14`). Under-5 is not broken by an outsider.

**What goes red.** Nothing. No AC, staging step or born-red test covers it. The mock env sets no `RATE_LIMIT_KEY_PEPPER` at all (register fact h), and AC2/AC3 assert the fail-open as wanted. If none goes red, say so: none goes red.

**What on main is different.** On main the dedup marker does not use the pepper (`src/handlers/qr-scan.ts:179`, `scanDedupKey(scanKey ?? anonId, ...)`). A short `RATE_LIMIT_KEY_PEPPER` today only degrades rate-limit keys to SHA-256 (IP-reversible). So the false-5 half of this attack does not work on main. It is created by S2 AC3.

**Verdict.** Works after the subject ships (S2 AC2/AC3). On main only the key-hashing degradation works. The subject names no AC that blocks it. The attacker's gain over what OSE-1780 already owns (a cookie-less request mints a new id each time) is about zero. The harm is to an honest figure and to the count-floor's meaning. Severity stays High; I do not propose a change.

### R1-23 token scope, secret level, one account, environment blocks

Two attackers.

**Attacker A: a CI step on a same-repo PR.**

- Goal: production code execution, production D1 and KV, production secrets through code. The "production changes only through CI" rule is bypassed from inside CI.
- Steps:
  1. Open a same-repo branch `full-pipeline/x`. The `if:` at `ci.yml:1186-1191` runs `deploy-staging` for it, and the T2 to T4 legs follow (`needs: deploy-staging`).
  2. The PR author controls the workflow file in the run. GitHub runs the PR head's workflow, with secrets, on a same-repo `pull_request`, and CODEOWNERS bites only at merge (`PR_SECRET_EXPOSURE_GUARD.md:25-40`). The `full-pipeline/` prefix is deliberately excluded from the guard (`APPROVED_DEPLOY_PREFIX`, same doc "Scope boundary").
  3. Add `npx wrangler deploy --env production`, or `wrangler d1 execute ocr-db-production --remote` using the id at `wrangler.toml:319`, or `wrangler kv key list --namespace-id e44974e8…`, to a step that carries `CLOUDFLARE_API_TOKEN` (any of `ci.yml:1273-1373`; T4 steps at `:2014-2232`).
  4. Without editing the workflow, any `scripts/ci/*.mjs`, including S14's `staging-d1-read.mjs`, already runs with the token. S14's SELECT-only filter is client-side, in the same checkout the attacker controls.
- Needs: push to a branch in the repo (the owner, or an agent that commits as the owner; the guard doc says Claude Code commits as the human and its PRs auto-run CI). Needs the token to be repo-level, or not overridden by the `staging` environment, and to hold prod deploy, D1 and KV rights. Deploy-production uses the same secret name at `ci.yml:2774`. The owner's plan gives it those rights. All three conditions are source-read, not live-proven.
- Blast radius is wider than KV. Workers Scripts Edit on production means replacing code on a Worker that carries every production secret (FORMS_ENCRYPTION_KEY, peppers). The bypassed gates are `assert-on-main` (`ci.yml:2589`), the ticket gate (`:2596`), the ADR-012 R2 secret check (`:2679-2685`) and the Access routing gate (`:2795`).
- Success: a production change with no tag, no ticket and no on-main check. Under the subject, S2's KV listing reaches R1-01's KV half on production.
- What goes red: nothing in the subject. The staging chain may well be green. The guard `check-pr-secret-exposure` treats `full-pipeline/` as approved. If none goes red, say so: none goes red.

**Attacker B: the insider at a workstation.** The owner's laptop is `wrangler login` (`scripts/set-secrets.sh:12-14`, `ROLLBACK.md:291`), a user-level OAuth session whose breadth I cannot read (inferred: broad). With it:

- `wrangler kv key list --namespace-id e44974e8…` lists production markers, names and, if the platform returns it, expiry.
- `wrangler d1 execute ocr-db-production --remote` reads both scan tables, and FORMS_DB through its own id.
- `wrangler secret put` changes a pepper.
- `wrangler deploy --env production` ships code.

The only barriers are a runbook sentence ("Do not apply migrations to production from a laptop", `ROLLBACK.md:183`) and the agent-only hook. The detection side is not in the repo (Cloudflare audit logs; I did not check `security-monitoring.yml`).

**The loop-2 return-to-Medium test.** Loop 2 said: "if production overrides with a distinct token and the KV widening stays unless resource-scoped, return to Medium; if both are false". My answer: both conditions are contradicted by the owner's own documents, but only as source-read. A repo-level secret (TOKEN-PICKUP:36) means no production override. A KV Edit token (TOKEN-OVERHAUL-TONIGHT:39) means no KV widening is needed. The live state is unproven.

**Verdict.** Works on main for attacker A, conditional on the repo-level and no-override facts, and the same on staging in any case. Not blocked by the subject. After the subject ships, S14 and S2 add more steps that carry the token. Proposed re-rate: **Critical (15) if the owner's readout shows the token repo-level (or the `staging` environment unprotected) and prod-capable; High otherwise.** Reason: the actor does not need a tag or a ticket to change production, and the bypassed gates are the ones AGENTS.md leans on.

### R1-09 rollback route through T4

**Actor.** A saboteur, or two honest developers; in a real incident the operator.

**Goal.** Close the CI route out of a production incident, or force break-glass.

**Steps.**

1. `ROLLBACK.md:142-147` (§4) runs `gh workflow run ... -f deploy_production=PRODUCTION`. `deploy-production` has `needs` on `deploy-staging`, smoke, contract and `functional-staging` (`ci.yml:2560-2569`), so the whole chain reruns first. `ROLLBACK.md:160` budgets 35 minutes or more.
2. Make T4 red. The levers:
   - Six new bash steps with no retry: `set -euo pipefail` and an unprotected poll (register R1-33).
   - The shared-staging race with no cross-run lock (R2-01). The concurrency block cancels only same-ref PR runs (`ci.yml:150-158`). A concurrent `full-pipeline/*` run redeploys staging and the dispatch's T4 reads a different build.
   - S2's set difference over the global `scan:dedup:` prefix (register R2-01).
   - The static future-hour seed (R1-46).
3. `ROLLBACK.md:162` says to rerun failed jobs and, if production is down and it still blocks, go to §6. §6 is a founder-only `wrangler rollback` from a laptop (`:215-221`). It skips tests, the ADR-012 R2 check and the Access check (`:198-203`), and the runbook says "Not yet practised" (`:6`).
4. Fix-forward after the window (`ROLLBACK.md:41-45`) goes through the same chain.

**New defect on this route (L3-DEVOPS-1, section 4).** The §4 and §5 commands omit `-f ticket=`. `ci.yml:2596-2604` and `scripts/ci/require-ticket.mjs:40-48` fail the job without one. So the CI rollback route fails at the production job's second step, after the 35-minute wait, if the runbook is followed verbatim.

**Success.** The attacker or the flake turns the sanctioned route into break-glass. T4 goes red, which is the attack itself, so there is no gate that stays green.

**Verdict.** Works on main already, and worse after the subject ships (more steps, none retried). Not blocked by any AC. Severity stays High.

### R1-16 the cron in the production block

**Actor.** A hostile organizer at a busy evening event (no access needed); an injector under RA-1; an insider with `wrangler`.

**Facts, source-read.**

- Production has the cron: `wrangler.toml:383-384` `crons = ["0 3 * * *"]`. Staging the same (`:230-231`). `scripts/ci/env-parity.mjs:201-205` requires staging equals production, and it is wired in CI (`ci.yml:770`).
- The scheduled handler runs nine jobs together (`src/index.ts:150-160`), one of them `runSharedReportPipeline`.
- The materializer INSERT has no upper bound on `scan_bucket` (register fact e; `src/lib/shared-report.ts:877-905`).
- On 2026-11-02, 03:00 UTC is 22:00 EST, 21:00 CST or 20:00 PST, the evening of an event (arithmetic: US daylight time ended 2026-11-01, so this is standard time).

**Steps.**

1. The schedule is a literal in the repo, so anyone who has seen the config knows when the snapshot runs (inferred reach: needs a published or leaked schedule).
2. Inject or gather 5 or more scans at one poster in the first seconds after 03:00:00 UTC (the delay before the snapshot is unsettled).
3. More scans follow that hour.
4. Read the report after the seal, and again after the next night's rebuild. A stored cell of 5 sits beside a live attribution of 7, and the rebuild moves a published cell.

**The insider lever.** `wrangler deploy --env production` from a workstation with a changed cron is not stopped by env-parity, which runs in a PR. It does not worsen R1-16: a more frequent rebuild shrinks the window in which stored differs from live. The danger is the opposite, a missed run. `SHARED_REPORT_MATERIALIZE_ERROR` is read by nothing (register R2-19), so a failed 03:00 job leaves a partial stored hour for a further 24 hours. A parity-pinned equal change to both blocks passes the staging chain and CODEOWNERS adds nothing (one owner).

**What goes red.** S4's staging step seeds stored cells with no materializer run (subject C.10 Tests). Nothing goes red. If none goes red, say so: none goes red.

**Verdict.** Works on main as source-read, with reach inferred and low (it needs several scans inside the seconds after 03:00:00, which an organizer can engineer only by injecting). It is not blocked by the subject, since S4's bound is read-time and the stored cell is partial before it. Severity stays High; I propose Medium if the owner rules that injection is out of the epic's scope, because the reach then depends on a crowd arriving in the first seconds.

### R1-18, R1-25, R1-26 (context)

- **Migration level 77 versus 104, and the freeze.**
  - **State.** Production is last read at 77. The plan covers main 77 to 104 (27 files) and forms 14 to 18 (4 files) (`PRODUCTION-MIGRATION-PLAN.md:1-12`). Its freeze is 2026-10-17 (`:23`). 0104 landed 2026-10-12, so 0105 and forms 0019 are the first files after the freeze (register fact d). `prod-preflight` is in no workflow (proven above).
  - **Mechanism.** The first tag applies everything pending before the Worker deploys (`ci.yml:2703-2715`). The "Report: roll-back-able" step is information only (`|| true`, `:2691-2701`) and matches DROP and RENAME only (register R2-16). S3's and S7's lossy UPDATEs are flagged by nothing.
  - **Rollback.** `ROLLBACK.md:27` already says the first production deploy is not roll-back-able (0098 drops `subscribers`, 0102 rebuilds, 0103 renames).
  - **Attacker view.** No external attacker. A CI-step attacker (card R1-23) can run `wrangler d1 migrations apply --remote` against production, using the production database id from `wrangler.toml:319`, before any tag.
- **Staging ahead of production.** Subject C.9 says production stays at 104 until the owner asks. Today it is at 77 (last read). In sync is not true, and CI cannot say so.

## 2. Attacks on the subject's own controls (injected fault that leaves the criterion green)

1. **S2 AC5 (staging gate refuses a missing `ANON_ID_HASH_PEPPER`, `grep -qw`).**
   - Fault: `echo x | wrangler secret put ANON_ID_HASH_PEPPER --env staging`. The name is present, the gate is green, and the pin at `tests/integration/infra-consistency.test.js:279-296` checks text only.
   - The Worker also accepts any length: `src/lib/scan-node-key.ts` contains no minimum-length check (only `length: 256` for the HMAC key, `:84`), so a one-character pepper gives valid, guessable keyed ids (source-read).
   - Subject C.8 and C.1 E6 promise the same 32-character minimum only through `set-secrets.sh`.
2. **S2 AC3 (short `RATE_LIMIT_KEY_PEPPER`, no marker, scan counted).** The AC asserts the unsafe behaviour. The fault "five counted scans from one cookie in a poster-hour" stays green: AC3's own test asserts "counted, no marker". The mock env sets no `RATE_LIMIT_KEY_PEPPER` (register fact h), so AC3 must seed it itself.
3. **S14 AC1 to AC3 (SELECT-only reader).**
   - The unit test stubs the spawn. A PR step that calls `npx wrangler d1 execute` directly, or `wrangler d1 execute ... --env production`, leaves every AC green. The wrapper is the only thing a filter can guard, and the attacker edits the files around it.
   - Subject line 121 says "production stays read-only for tests (OSE ADR-021)". Nothing enforces that: the token is the same one.
4. **C.0 "Env parity: no retained slice changes a binding, so env-parity output is unchanged".** env-parity's cron check compares staging with production (`:201-205`), so an equal change to both passes. For S4's seal this is the R1-16 lever: no check says "the cron is not S4's clock".
5. **S2 staging step (the K1 minus K0 set difference and D1 positive control).** Still green on a broken marker write (register R1-07). Add the DevOps angle: it also needs a KV list scope. A failed KV list is "red, never a skip" (C.8), so a missing scope reddens T4 and blocks the production tag for every later SHA.
6. **S3 and F-15 (owner reads one Workers Logs line).** No failing check. Whether `[observability]` at `wrangler.toml:95-96` is inherited into the environment blocks is open (see section 6).

## 3. Cluster tests

**C1 (scan order as a join key), with R1-23.** Combining gives more than either alone.

- Worked example: hour H, poster P, five browsers b1 to b5 scan in this order. D1 `scan_placement_events` rowids r1..r5 carry only (P, H). `scan_node_returns` carries the keyed ids in the same order. The rank join gives (snk_i, P, H) without a pepper: R1-10 alone.
- The marker keys on main are `scan:dedup:<snk1_i>:<P>:<H>` with a TTL of 3600 from the scan (`qr-scan.ts:185`). A KV list that returns expiry (inferred) yields scan-second order: R1-01 alone.
- Together: (browser, poster, hour, second) for all five.
- With the CI token and no pepper, a same-repo PR holds D1 and KV together (R1-23). That is the third member the loop-2 note anticipated: it moves C1 to "three" (multiplier 2.0, scorer's call).
- A marker in S2's hashed form no longer shows the id, but a holder of `RATE_LIMIT_KEY_PEPPER` and the D1 snk1 list reverses it (register R1-01).

**C3 (scans are not people), R1-08 with R2-03.**

- R2-03 alone: one reset each time the pepper rotates. R1-08 alone: marker off while the secret stays short.
- Example: the owner re-runs `set-secrets.sh` to add a name (see L3-DEVOPS-2). It re-prompts all five secrets, including `RATE_LIMIT_KEY_PEPPER` (`set-secrets.sh:100-121`), which resets markers. If one paste is short through the direct route, markers stay off. A person's repeats in that stretch are K counts, not one.
- Adds: a standing off-state beside the one-off reset.

**C6 (staging evidence), R1-09 with R2-01.**

- Worked example: production fails; the operator dispatches §4 (35 minutes plus); a `full-pipeline/fix` PR run redeploys staging in that window (no cross-run lock); T4 reads the other build and goes red; the operator reruns once, per `ROLLBACK.md:162`; red again; break-glass.
- Adds more than either alone: the pair converts a delay into the unrehearsed route.
- L3-DEVOPS-1 (the missing ticket) sits ahead of both and can fail the same route with no sabotage.

C2 and C5: no DevOps-lens contribution that the other lenses do not own.

## 4. New findings

| id          | Sev                                 | Slice                           | Claim                                                                                                                                                                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                            | Basis                                 | Root cause                                                                                                           | Why not already a row                                                                                                                                                                                                                                              |
| ----------- | ----------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L3-DEVOPS-1 | Medium (5); propose High with R1-09 | S2/E7, rollback (`ROLLBACK.md`) | The CI rollback and fix commands in `ROLLBACK.md` fail at the production job's ticket gate because they carry no ticket input.                                                                                                     | `ROLLBACK.md:146` and `:180`: `gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_production=PRODUCTION`; `ci.yml:138-139` (input exists), `:2596-2604` (gate), `scripts/require-ticket.mjs:40-48` (exit 1 on none). `grep -rn "f ticket="` over `docs scripts` printed nothing (proven). The runbook says "Not yet practised" (`ROLLBACK.md:6`).         | source-read plus proven grep; not run | The ticket gate (CCR B5, 2026-10-12) was added after the runbook text of 2026-10-07 and the runbook was not updated. | R1-09 is about T4 cost and red; R1-26 about pins. This is a recovery-path command that cannot succeed as written.                                                                                                                                                  |
| L3-DEVOPS-2 | High (10)                           | S2/F-10/E6, set-secrets         | The gates' remedy ("Provision it: bash scripts/set-secrets.sh <env>"), and the subject's own owner steps, route through a script that overwrites every secret it lists. On production that includes the AES key for stored emails. | `scripts/set-secrets.sh:71-77` (five names), `:100-121` (prompts for and `secret put`s all, no existence check, no single-name mode); `ci.yml:1257,2666` (message); `scripts/ci/classify-wrangler-failure.sh:13-15,47` (admits the script "overwrites existing keys", warns only for auth or network failures); subject C.1 E6 adds a sixth name to the same array. | source-read                           | The script has no way to add one name safely.                                                                        | R1-18 is "owner prerequisite unverified"; R2-03 is rotation timing. Neither names overwrite-all. Reach: owner error, with irreversible loss for encrypted contact columns on production once registrations exist (the plan says production forms are empty today). |
| L3-DEVOPS-3 | Low (2)                             | docs                            | `ROLLBACK.md` section 8 says no workflow runs `wrangler rollback`; `staging-rollback-drill.yml` does, on staging.                                                                                                                  | `ROLLBACK.md:279` versus `.github/workflows/staging-rollback-drill.yml:152,155`                                                                                                                                                                                                                                                                                     | source-read                           | Doc drift.                                                                                                           | New; low impact.                                                                                                                                                                                                                                                   |

Out of scope, recorded once and not rated: the presence bit at a chosen location, cookie-less padding and the `/s` tap probe (OSE-1780); who-side count publication (OSE-1783/OSE-1784); forged cookies and signing (OSE-1496). R1-08's cookie-less padding half is OSE-1780's family and I leave it there.

## 5. Re-rates, with reasons

- **R1-23: High, propose Critical if the readout confirms.** Condition: the token is repo-level (or the `staging` environment is unprotected) and holds production deploy, D1 and KV rights. Reason: a same-repo PR author can change production and read production D1 and KV without a tag, ticket or on-main check. The owner's own CCR of 2026-10-19 rated the same reach Medium and left acceptance open. If the readout shows distinct per-environment tokens and a reviewer on `staging`, return to High (not Medium: the KV Edit scope still covers the production namespace if account-scoped).
- **R1-08: High, no change.** Reason to keep: attacker gain is about zero; the harm is to honest figures, and the control gap (name-only gates, no alert) is real. Note it is created by S2 AC2/AC3, not present on main.
- **R1-09: High, no change.** L3-DEVOPS-1 adds to it; together I would call the route High.
- **R1-16: High, no change; Medium if injection is ruled out of scope.** Reason: reach needs 5 or more scans inside seconds of 03:00:00.
- **R1-18, R1-25, R1-26: Medium, no change.**

## 6. Not checked, and why

- Live GitHub state (secret level, environment reviewers, tag protection, live branch protection): the policy hook refuses agent reads of `actions/secrets` and `/environments`, and the brief says no secrets; I gave the owner commands instead.
- The live token's policies and the `wrangler login` session's breadth: no network call to Cloudflare was made, by the brief.
- Cloudflare platform facts: whether a KV list returns expiry, Workers Logs contents and retention for `/q`, whether `[observability]` is inherited in the environment blocks (wrangler docs; not verified; check the dashboard), DLQ retention, `wrangler secret put` creating a version (taken from `ROLLBACK.md:202`), per-file migration atomicity, D1 rowid assignment.
- Which commit production runs and its real migration level (read live last on 2026-10-03 and 2026-10-01).
- `security-monitoring.yml` and any alert on Cloudflare audit logs for a workstation `wrangler` change.
- Any fresh `gh run list` (the "4 of last 8 main push runs failed" figure is the SM lens's proven row; I did not re-run it).
- The remaining lenses' Highs (R1-01 to R1-07, R1-10, R2-01, R2-02): R2-01 is only used in cluster C6; the rest are for other lenses.

## 7. Commands run (all read-only; none refused)

- `Read` of: the brief, `.claude/skills/devops.knowledge.md`, the frozen subject (all of it, two pages), `MERGED-loop1.md`, `MERGED-loop2.md`, and in the worktree `workers/oursharedevents/wrangler.toml`, `scripts/set-secrets.sh`, `docs/security/CF_API_TOKENS_POLICY.md`, `docs/runbooks/RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md`, `docs/security/CI_DEPLOY_HARDENING.md`, `docs/security/CI_SECRET_NAMING.md`, `docs/runbooks/ROLLBACK.md`, `ci.yml` lines 1176-1385 and 2540-2800, `src/lib/rate-limit.ts` 1-240, `src/handlers/qr-scan.ts` 140-275, `src/lib/scan-buffer.ts` 55-85, `scripts/ci/classify-wrangler-failure.sh`.
- `Glob`/`Grep` (the Grep tool) for `CLOUDFLARE_API_TOKEN_OSE` counts across the worktree, `environment:|CLOUDFLARE_API_TOKEN_OSE|PEPPER|wrangler secret|secret list` in `ci.yml`, and `environment|reviewer|CLOUDFLARE_API_TOKEN|scope|KV` in `docs/security/SECRETS_POLICY.md`.
- `Bash` (read-only), each in `ose-clock-gate`:
  - `git log --oneline -1`; `wc -l`; `ls docs/runbooks docs/security`.
  - `grep -rln "prod-preflight" .github/workflows` (empty); `sed -n` of `docs/runbooks/PRODUCTION-MIGRATION-PLAN.md` 1-30; `sed -n` of `ci.yml` 1862-1890; `grep` in `staging-rollback-drill.yml`.
  - `sed -n` of `src/lib/public-read-limit.ts` 45-60, `src/lib/edge-rate-limit.ts` 40-50; `grep` in `scripts/prod-preflight.mjs`, `.claude/hooks/policy-gate.mjs`; `ls tools/ci`; `head` of `.github-secrets-required.json`.
  - `sed -n` of `src/lib/scan-node-key.ts` 25-60, `grep` for `warnScanPepperMissing`; `sed -n` of `src/lib/public-read-limit.ts` (count limiter); `grep` for `length|MIN` in `scan-node-key.ts`; `grep` of `tests/integration/infra-consistency.test.js` for pepper pins; `ls .github/workflows`.
  - `grep -n "staging-pr|pull_request_target|^on:|^permissions"` over `ci.yml`; `sed -n` of `docs/security/PR_SECRET_EXPOSURE_GUARD.md` 1-200; `cat .github/CODEOWNERS`; `sed -n` of `tools/ci/main-branch-protection.json` 1-60; `head -c` of `scripts/check-pr-secret-exposure.allowlist.json`; `git log` over the guard doc and the protection file.
  - `grep` and `sed -n` over `.claude/outputs/TOKEN-PICKUP-2026-10-19.md`, `TOKEN-OVERHAUL-TONIGHT-2026-10-12.md`, `TOKEN-OVERHAUL-QUEUE-2026-10-12.md`, `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md`, `HARDENING-STORIES-DRAFT-2026-10-12.md` (token facts, names only; no value was printed).
  - `grep -rln crons` over tests, scripts; `grep` in `scripts/ci/env-parity.mjs`; `sed -n` of `src/index.ts` 140-170; `grep` for `env-parity|prod-preflight` in `ci.yml`.
  - `sed -n` of `scripts/ci/require-ticket.mjs` 1-80; `grep` for `ticket` in `ci.yml` and the runbooks; `grep -rn "deploy_production=PRODUCTION"` and `grep -rn "f ticket="` over `docs scripts`; `sed -n` of `docs/brain/ROLE-STATE.md` 60-76.
- No network call, no test run, no write, no branch, commit or stash. No credential value was read or printed.

Lead's note (not the agent's text): the live-state questions this lens left inferred (secret level, environment protection) were settled by the QA Automation and SDET/SRE lenses in the same loop by read-only `gh api` and `gh secret list` (names and flags only): the token is a repository-level secret, both environment secret lists are empty, `staging` has no protection rules, and no `staging-pr` environment exists. The merge should read those as proven and this lens's section 0 as consistent with them.
