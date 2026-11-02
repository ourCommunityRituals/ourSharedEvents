# Loop 3 (Adversarial): dr-of-security, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

- Subject sha256 re-checked: `dd9b8522…b7f4` matches.
- Code was read in `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` at e7c8297b (`src/` equals 39a63d67).
- Paths are under `workers/oursharedevents/` unless they start with `.github/`, `docs/`, `scripts/` or `.claude/`. `ci.yml` is `.github/workflows/oursharedevents-ci.yml`.
- Basis key: proven (a command result), arithmetic, source-read, inferred.
- No score and no gate decision.
- The attack cards stay at the level of capability and evidence. On purpose, I give no step-by-step recipe for pulling credentials or decrypting PII.

## 0. Platform facts this lens could settle (and what stays open)

| Fact                                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Basis                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| One Cloudflare account for staging and production            | `wrangler.toml:40` is the only `account_id` line. The production `RATE_LIMIT_KV` (`:339-340`) and production D1 (`:319, :327`) sit in that account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | proven (grep)                                                                                            |
| `CLOUDFLARE_API_TOKEN_OSE` is a repository-level secret      | The workflow header lists it under "Required GitHub Secrets" (`ci.yml:91`). The deploy-staging comment calls the token "a repo secret" (`ci.yml:1169-1170`). ADR-020 (`docs/adr/ADR-020-copilot-ci-human-approval-gate.md:~63-68`) and `docs/security/PR_SECRET_EXPOSURE_GUARD.md:60-69` both record, as verified on 2026-09-26: "All sensitive secrets are repo-level", and the staging and production environments have "zero protection rules / zero required reviewers". `.claude/outputs/TOKEN-PICKUP-2026-10-19.md:36` stores the rotated value with `gh secret set … --repo` (no `--env`). `.claude/outputs/HARDENING-STORIES-DRAFT-2026-10-12.md:285-292` says moving the token into an environment would empty it for T2 to T4, and schedules environment moves "after launch". | source-read (docs dated 2026-09-26 to 10-19)                                                             |
| Does a production-environment secret of the same name exist? | No repo document records one. Every document points the other way, to a single repo-level value. Today's GitHub state was **not** read (I made no `gh secret list` call).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | inferred, probably absent                                                                                |
| Token scope                                                  | `.claude/outputs/TOKEN-OVERHAUL-QUEUE-2026-10-12.md:21`: "Deploy plus D1 read/write on staging **and** production." `TOKEN-OVERHAUL-TONIGHT-2026-10-12.md:39` recommended the replacement as account-scoped with Workers Scripts Edit, D1 Edit, **Workers KV Storage Edit** and R2 Edit, used by deploy-staging, deploy-production and T2 to T4. No document shows what the 2026-10-19 rotation actually granted.                                                                                                                                                                                                                                                                                                                                                                        | source-read (owner planning docs). Real scope inferred.                                                  |
| Does a KV listing return expiry?                             | The installed `@cloudflare/workers-types` declares `KVNamespaceListKey { name; expiration?: number; metadata? }` (`ourSharedEvents/workers/oursharedevents/node_modules/@cloudflare/workers-types/experimental/index.d.ts:2245-2249`). The repo's own code already lists KV keys (`src/lib/rate-limit.ts:158`). The REST and wrangler listing output was not observed.                                                                                                                                                                                                                                                                                                                                                                                                                   | proven at the type level. Runtime inferred.                                                              |
| Who receives the token                                       | T4 `functional-staging-sub` declares no `environment:` (`ci.yml:1866-1884`) and uses the token at `:2014-2232`. `staging-rollback-drill.yml:91,130` uses the **same** secret, although its header (`:17`) says "the staging Cloudflare credential only".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | source-read                                                                                              |
| Any same-repo PR, not only `full-pipeline/*`                 | `pull_request` runs on every PR to main (`ci.yml:101-104`). ADR-020 states that a trusted-user PR "can reference any repo-level secret, not just the ones currently wired". CODEOWNERS on `/.github/workflows/` gates the merge, not the PR run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | source-read. GitHub secret-passing behaviour inferred from GitHub's documentation as the ADR records it. |

Still open: Workers Logs content for `/q`; dead-letter retention and the queue `timestamp`; production migration level (77 versus 104); the snapshot delay after 03:00.

## 1. Attack cards

### R1-01 (primary): at-rest who-and-where outside the scan tables

**Card 1a. Actor: outsider with a D1 and KV export, no pepper.**

- Goal: (keyed browser, poster, second).
- What the attacker uses:
  1. The marker is written at scan time with `expirationTtl: 3600` (`src/handlers/qr-scan.ts:185`), so its expiry carries the scan second. S2 changes the key name only (AC1) and leaves this TTL alone (subject C.8).
  2. The listing exposes `expiration` (section 0).
  3. Both scan tables are written in one batch, in the same order (`src/lib/scan-buffer.ts:101-137`).
- Result: inside one event-hour, the order of the KV expiries, the rowids of `scan_placement_events` and the rowids of `scan_node_returns` all follow scan time. Lining them up gives `snk1_` (cross-event, `src/lib/scan-node-key.ts:20-22`), poster and second.
- Cost: one export, no secret.
- What the subject shows: S2 AC1 to AC5 green, S2 staging green, S6 records "linked" or nothing.
- **Nothing goes red.**
- Verdict: **works on main, and still works after the subject ships.** S2 removes the readable triple from the name, not the clock from the expiry. Basis: source-read, with the listing inferred at runtime.

**Card 1b. Actor: pepper holder (the owner, or anyone who can make the Worker reveal `RATE_LIMIT_KEY_PEPPER`; see L3-SEC-1).**

- After S2 the marker name is an HMAC over `snk1 : deployment : hour`.
- The candidate inputs for one hour are small and known from D1: the `snk1` values in `scan_node_returns` for that event-hour, times that event's deployments.
- Recomputing that set gives back the exact pair that S2's threat review says is unreadable (C.8: "cannot read the triple without `RATE_LIMIT_KEY_PEPPER`").
- **Nothing goes red.**
- Verdict: **works after the subject ships.** It is the same root as loop 2's note on R1-01. Basis: arithmetic.

**Card 1c. Actor: FORMS_DB-plus-key insider.**

- `form_registrations` stores `source_placement_id`, `registration_bucket`, the per-event keyed id and `consent_given_at` as an ISO instant (`src/handlers/forms.ts:302-316`).
- At low volume, (placement, hour) plus the consent second matches one `/q` scan from card 1a. That attaches the decryptable registrant to the cross-event `snk1` trail, for up to 365 days.
- After S7, the consent value is coarsened to the hour, but (placement, hour) still singles a registrant out when a poster-hour has 1 to 4 scans.
- **Nothing goes red.** S7 AC2 checks three columns.
- Verdict: **works on main. Weakened, not blocked, after S2, S3 and S7.**
- Severity: stays High. I support loop 2's H4 auto-promotion note (three or more stores).

### R1-07 (primary): S2 staging control passes on the fail-open

- Actor: a CI step on a same-repo PR, or an honest regression.
- Goal: ship a marker that is never written, past every layer.
- Steps (fault injection only):
  1. Make the `put` at `qr-scan.ts:185` unreachable, or leave `RATE_LIMIT_KV` unbound.
  2. The S2 staging step's positive control is a D1 count (C.8 step 3). It rises whether or not a marker exists.
  3. Step 4 asserts only absence: no key in K1 minus K0 names the poster. An empty difference satisfies it.
- What S2 shows: the mock spy catches "`put` never called" only on AC1's path. AC2 and AC3 assert "`put` not called" as the **wanted** result. Staging is green.
- Success: repeat scans by one cookie are counted. The floor holds in letter only.
- Verdict: **works after the subject ships.** The closure is in R1-07's closed-when (assert exactly one new hashed key). Severity: High, no change.

### R1-08 (primary): visitor on the short-pepper path

- Actor: operator error (a direct `wrangler secret put` of a value under 32 characters for `RATE_LIMIT_KEY_PEPPER`), then any visitor.
- How the short value gets in:
  1. The length is checked only in `scripts/set-secrets.sh:95-104`.
  2. Both deploy gates match names (`ci.yml:1255-1262`, `:2662-2667`, `grep -q`).
- What the visitor does: scans one poster 5 times in an hour with one cookie.
  - Today, on main, the marker uses no rate-limit pepper (`qr-scan.ts:179`, `scan-buffer.ts:72-74`), so dedup works.
  - After S2, AC3 writes no marker below 32 characters, so every scan counts.
  - The limits allow it: 60 per 10 s at the edge, 360 per minute at the route (`src/lib/public-read-limit.ts:53, 96`).
- Detection: one `RATE_LIMIT_PEPPER_MISSING` line per isolate (`src/lib/rate-limit.ts:122-130`). Nothing reads it.
- Success: one person publishes "5" at a poster-hour. The floor holds in letter and breaks in meaning.
- What the subject shows: AC3 green (it asserts this behaviour), AC5 green (name only), staging green (card R1-07). **Nothing goes red.**
- Verdict: **works after the subject ships. Created by S2.**
- Related (L3-SEC-2): `scanNodeKey` takes any non-empty `ANON_ID_HASH_PEPPER` (`src/lib/scan-node-key.ts:98`). It has no floor like `RATE_LIMIT_PEPPER_MIN_LENGTH` (`rate-limit.ts:77`), and S2 AC5 refuses only a missing name.

### R1-10 (primary): row order links the two scan tables

- Actor: holder of a D1 export (the outsider), or the T4 token holder (inferred, section 0).
- Mechanism: `buildScanStatements` emits the placement INSERT then the returns INSERT, per message, in batch order (`scan-buffer.ts:101-137`). The comment at `:96-100` ("do not gain a shared durable correlation key") is false in substance.
- With one known (poster, hour) for a target, rank alignment leaves at most 4 candidates. A second known point narrows it to about 1, and that is the trail.
- What S6 shows: AC2's injected counter makes the predictor say "linked", but the baseline already says "linked", so the AC cannot tell them apart. The staging read has no pass or fail.
- **Nothing goes red.**
- Verdict: **works on main and after the subject ships.** No slice fixes it. Severity: High, no change.

### R1-23 (primary): T4 token beyond reads

- Actor: a CI step on a same-repo PR (any collaborator or agent with push rights; Copilot PRs are held by ADR-020, other agents are not).
- What the actor holds:
  1. The repo-level `CLOUDFLARE_API_TOKEN_OSE` (section 0). It is the same value the production deploy uses, unless an environment secret overrides it. No document records an override.
  2. One account (`wrangler.toml:40`).
  3. A documented scope of deploy plus D1 read and write on both environments, and recommended KV Edit (section 0).
- What follows: S14's wrapper is a client-side filter. A step can call `wrangler` directly, so AC1 to AC3 stay green while the boundary is absent. With the documented scope, the step reaches production D1, so R1-10's join on production data needs no export. If the KV scope exists, it also reaches the production marker listing (card 1a).
- Success: insider-equivalent access to production. Today production has no clients (the environment modifier applies).
- **No criterion goes red.**
- Verdict: **works on main. The subject leaves it, and S2 asks to widen it.**
- Severity: keep High. Loop 2 offered a return to Medium if both facts were false. They are not false on the documents, though today's live state is inferred.
- C1 multiplier: the third-member condition (the token reaches production stores) is met on the documents for the D1 half. KV is documented as recommended but not proven.
- Broader exposure (repo-level secrets reachable from PR heads: F7 in `.claude/outputs/CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md:88,119,194`, held until OSE-1699 after launch): recorded once, outside this epic, not rated.

### R2-01 (primary): no cross-run lock on shared staging

- Actor: two honest developers, or one same-repo PR author.
- What runs at once:
  1. A `full-pipeline/*` PR deploys to the shared staging Worker and D1 (`ci.yml:1177-1191`).
  2. Concurrency keys on event plus PR number or ref (`ci.yml:150-158`), so a PR run and a main push run do not exclude each other.
  3. The drill has its own group (`staging-rollback-drill.yml:40-41`) and the same token.
  4. Freshness is checked once, at T4 start (`ci.yml:2001`).
- A PR deploy that lands mid-T4 changes the build after the check.
- S2's K1 minus K0 is a set difference over the global `scan:dedup:` prefix. Another run's scans can add the very key the step should flag (a false red), or the step passes against the PR build (a false green).
- Success: false Done evidence on main, or a false red that blocks the production tag.
- **No criterion goes red** for the race itself.
- Verdict: **works on main, and the subject's new steps widen it.** Severity: High, no change.

### R1-04 (secondary)

- The label is at `src/handlers/pages.ts:1762`: "held, so a group under 5 cannot be worked out".
- S15 AC1 scans only `never-who.ts`, `privacy.ts` and `public-claim` blocks, and none of its banned phrases matches this text.
- **AC1 stays green with the false label present.** The exact leak belongs to OSE-1783 (out of scope).

### R1-16 (secondary)

- The cron runs at `0 3 * * *` in all three blocks (`wrangler.toml:105, 231, 384`).
- The materializer does DELETE then INSERT with no upper bound on the hour (`src/lib/shared-report.ts:877-905`).
- Poster attribution reads raw rows live (`src/lib/shared-report-builder.ts:722-743`). The corridor map reads stored cells (`:837-845`).
- Organic reach needs 5 or more scans at one poster between 03:00:00 UTC and the snapshot. If the snapshot runs within seconds, that is rare. With injection it reduces to the RA-1 exact count, which is already accepted.
- S4's seed writes stored cells directly, so its step cannot see this.
- Verdict: **works on main and after the subject ships.** High stands only if the snapshot delay is minutes (open fact 6). Otherwise I propose Medium.

### R2-02 (secondary)

- At an event with `h3_res7` set:
  - 0 scans gives no cell rows, so the map is `source: 'fallback'`, "Neighborhood Preview" (`src/lib/shared-report-builder.ts:880-889`; `src/templates/shared-report.html:1247`).
  - 1 to 4 scans, after the nightly run, give a 0 row, so the map is `'suppressed'`, "Map hidden" (`shared-report-builder.ts:875-879`; `shared-report.html:1256`).
- A report-token holder learns "anyone scanned" the next day.
- S4 bounds hours, not this branch. S15's "below that it reads 'fewer than 5'" is false here.
- **Nothing goes red.** Verdict: **works on main and after the subject ships.**

Left to other lenses: R1-02, R1-03, R1-05, R1-06 (DES, PO, FE); R1-09 (OPS, SM). R2-01 is covered above.

## 2. Attacks on the subject's own controls (injected fault, AC stays green)

1. **S2 staging step** (R1-07). Fault: remove the `put`, or unbind KV. The D1 control rises and K1 minus K0 holds no poster key. **Green.**
2. **S2 AC3 plus AC5** (R1-08). Fault: a 31-character `RATE_LIMIT_KEY_PEPPER`. AC3 asserts no marker and a counted scan (green). AC5 checks the name with `grep -qw` (green). Staging is green. A second fault, a 1-character `ANON_ID_HASH_PEPPER`, also passes AC5 (L3-SEC-2).
3. **S14 AC1 to AC3** (R1-23). Fault: a T4 step calls `wrangler d1 execute` directly. The wrapper is untouched, so its unit test stays **green**. The AC tests the wrapper, not the boundary the threat review claims.
4. **S6 AC2** (R1-10). Fault: none needed. The baseline is already linked, so the injected column changes nothing and the AC cannot discriminate.
5. **S2 threat review** (L3-SEC-1). Fault: the KV lister can also obtain the pepper (section 0 scope). No AC models custody, so it stays green.

## 3. Cluster tests

- **C1 (scan order as a join key): yes, the combination gives more.** R1-10 alone gives (snk1, poster, hour). Adding R1-01's KV expiry adds the second. Adding the FORMS_DB consent instant then gives a name. Worked example: a poster-hour with 3 scans, 1 registration from that placement, and a consent stamp 40 s after the second expiry-ranked scan. Scan 2's `snk1` is the registrant, and so is every other scan that `snk1` made. R1-23 supplies production reach. On the documents, the multiplier should be 2.0 (three members). Basis: arithmetic, source-read; runtime listing inferred.
- **C2 (withheld vocabulary): yes.** R2-02's map state plus R1-13's "fewer than 5" wording tells 0 from 1 to 4 at event level, while S15 tells the public they look alike. In my lens it adds no further identification.
- **C3 (scans are not people): yes.** R1-08 creates a silent extra count. R1-07 makes the staging step blind to it. R2-03 resets markers on rotation. Example: a short pepper plus one cookie gives 5 counted scans, and every layer is green.
- **C5 (privacy notice):** outside my lens, apart from L3-SEC-1. The notice and S2 both overstate the insider boundary.
- **C6 (staging evidence): yes.** R1-09's cure (born red on `full-pipeline/*`) needs PR deploys to shared staging, which R2-01 races. Together they leave a PR-head actor holding a production-capable token (R1-23) on every born-red run.

## 4. New findings

| ID       | Severity                                | Slice              | Claim                                                                                                                                                                                                                                                                                                             | Evidence                                                                                           | Basis                                                                  | Root cause                                                                                                 | Why it is not already a row                                                                                                            |
| -------- | --------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| L3-SEC-1 | Medium (High if the scope is confirmed) | S2 (threat review) | S2 says a KV holder "cannot read the triple without `RATE_LIMIT_KEY_PEPPER`". In this account, whoever holds the deploy credential that lists KV can also get the Worker's secrets, because Worker secrets are reachable by whoever can deploy that script. So the pepper is not a separate custody from KV read. | `wrangler.toml:40`; `ci.yml:91, 1169-1170`; scope documents (section 0); subject C.8 threat review | source-read; the Workers Scripts Edit scope is inferred from documents | S2's threat model assumes custody can be separated where one account and one credential cannot separate it | R1-23 rates S14's read-only claim. R1-01 notes the pepper holder. Neither says the KV lister and the pepper holder are the same actor. |
| L3-SEC-2 | Low                                     | S2 (AC5)           | `ANON_ID_HASH_PEPPER` has no runtime length floor, and AC5 refuses only a missing name. A short pepper keys every `snk1`, which then becomes guessable offline by a D1 holder who knows one cookie (their own).                                                                                                   | `src/lib/scan-node-key.ts:98`; `src/lib/rate-limit.ts:77`; `ci.yml:1255-1267`                      | source-read                                                            | Length is enforced only at provisioning, and only for one of the two peppers                               | R1-08 covers `RATE_LIMIT_KEY_PEPPER`; R1-41 covers match parity; neither covers this length.                                           |
| L3-SEC-3 | Low                                     | S2, S14 (C.0)      | `staging-rollback-drill.yml:17` calls its credential "staging only", but it uses the same `CLOUDFLARE_API_TOKEN_OSE` as `deploy-production`. The claim is false, so a reader of the drill underestimates its reach.                                                                                               | `staging-rollback-drill.yml:17, 91, 130`; `ci.yml:2656`                                            | source-read                                                            | Documentation drift about credential reach                                                                 | Not in R1 or R2.                                                                                                                       |

Out of scope, recorded once: repo-level secrets reachable from same-repo PR heads (F7 / OSE-1699, owner-deferred to after launch). It includes the PII-decryption reach that comes with it.

## 5. Re-rates

- R1-23: keep **High**. The documents meet loop 2's raise condition; live state is inferred.
- C1: multiplier **2.0** if the scorer accepts the documents, otherwise 1.5.
- R1-16: **High** only if the snapshot delay is minutes; otherwise **Medium** (organic reach is rare, and injection reduces to RA-1).
- No other changes.

## 6. Not checked

- **Live GitHub secret levels, environment secrets and protection rules.** No `gh secret list` or `gh api` call; settings are owner-only, and I relied on the documents.
- **The token's live scope.** I did not use the credential, and must not.
- **KV listing output at runtime, Workers Logs, queue retention, snapshot delay, production migration level.** These are platform facts I cannot reach from the repo.
- **R1-02, R1-03, R1-05, R1-06, R1-09.** Other lenses' Highs.
- **No tests run.** The brief forbids runs that write.

## 7. Commands run (all read-only; none refused)

- `sha256sum` of the subject. `ls` of `loop3/`. `git log --oneline -1` and `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` in `ose-clock-gate`.
- Read tool: the brief, the subject (lines 1-365, 538-612), `MERGED-loop1.md`, `MERGED-loop2.md`.
- Grep tool over the subject (headings, F-10, F-9, F-15, scope).
- `grep -n` for the token, `environment:` and job names in `ci.yml`. `sed -n` over `ci.yml:80-100, 100-160, 1166-1200, 1240-1300, 1866-1900, 1990-2050, 2549-2580, 2645-2720`.
- `grep -rn CLOUDFLARE_API_TOKEN_OSE` over md, yml, toml, sh, mjs and js. `sed -n` over the four `.claude/outputs` token documents. `grep -n` in `CCR-TOKEN-PROJECT-DIRECTION-2026-10-19.md`. `sed -n 55,75p` of ADR-020. `grep -n` in `PR_SECRET_EXPOSURE_GUARD.md`. `grep -ln` over workflows.
- `sed -n` over `qr-scan.ts:160-235`, `scan-buffer.ts:33-80, 96-140`, `rate-limit.ts:115-178`, `scan-node-key.ts:1-110`, `forms.ts:294-318`, `shared-report-builder.ts:720-745, 834-900`, `shared-report.ts:862-905`, `pages.ts:1755-1763`, `scripts/ci/trace-scan-staging.sh:30-50`, `scripts/set-secrets.sh:90-106`.
- `grep -n` in `wrangler.toml` (account, KV, observability, crons), `public-read-limit.ts`, `staging-rollback-drill.yml`, `shared-report.html`.
- `ls` and `grep` of `@cloudflare/workers-types` for `KVNamespaceListKey` in the main checkout's `node_modules`.
- No network call, no `gh` call, no test run, no write.
