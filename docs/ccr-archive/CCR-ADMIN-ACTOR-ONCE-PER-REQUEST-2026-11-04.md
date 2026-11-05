# CCR: the admin actor is resolved once per request (PR #1090, OSE-1801), 2026-11-04

**Owner's request:** "Run the CCR"

**How it was run:**

- 5 loops, following the owner's run model: Critical, Conservative, Adversarial, Compliance, Recursive.
- Extended scrum team. The Dr of Security sat in every loop that used lenses.
- No fixes between loops, and one cumulative score after the last loop.
- Class: security fix. The table says 3–4 loops; it was run at 5 because the owner's model has 5.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System score**          | **0%**, clamped. The raw score is 100 − 176.9 = **−76.9**. The fix's own findings account for 131.4 points, so without the pre-existing items the raw score is still −31.4.                                                                                                                                                                                                                                                                  |
| **Security Critical**     | **None proven.** One candidate, RT-1, depends on a condition outside the repo (see the human gate). It predates this PR.                                                                                                                                                                                                                                                                                                                     |
| **Assessment confidence** | **90%.** It rose from 85% in loop 1 to 88%, then 90%, then 90%. Three things support it: two red teams converged, and one of them was not given earlier findings; the floor was probed at runtime with a 330-case sweep; CI is green on the subject. It stays below 95% for three reasons: the deny-on-null sites were never fault-injected; RT-1's precondition is external; no staging run exists for this SHA.                            |
| **Gate**                  | **FAIL, human gate.**                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Subject**               | Loops 1–2 reviewed `9f4327ff`. Between loops 2 and 3, main was merged (this added #1088's service actor; the only conflict was the `events.ts` import union). That gave `28b11ddc`, which loops 3–5 reviewed. Against base `4f8c0955` the diff is 11 files, +321/−23, `git diff` sha256 `e6f578276495cdcf`. The subject was re-checked unchanged before loop 5. CI on `28b11ddc`: 42 pass, 0 fail (ZAP `/demo/mid` scan error re-run green). |

**Headline:**

- **The fix holds.** A token that expires mid-request no longer gives a brand admin another brand. This was proven on main before the fix (201, 201, 412) and after it (403, 400, 404), and two red teams confirmed it.
- **Floor at 28b11ddc: conditional yes.** A brand admin never acts in another brand as staging and production are configured. It rests on three conditions:
  - `CF_ACCESS_TEAM_DOMAIN` is set wherever key methods are on;
  - `WORKER_ENV` is exact;
  - no identity provider issues an email that starts with `key:` or `svc:`.
- **The PR fails on proof, not on the fix:**
  - The second line of defence (deny a null actor) has no test that goes red alone.
  - The mutation gate passed while every memo mutant survived.
  - The repeat route misses the memo; this fails closed.
  - The staging layer and the CI/CD testing ticket are missing.
  - The records overclaim: TL-084 text, method label and invariant mapping, plus several comments.

## In scope and out of scope

**In scope:**

- `auth/admin.ts`: the memo, `isDevOpenAdmin`, and the `requireAdmin` pin.
- The deny-on-null sites in `events.ts`, `sponsors.ts`, `sponsors-draft.ts` and `requireKeyActor`.
- `guardAdminObjectScope`, which still cedes.
- The race spec, the two handler-direct specs, TL-084, and the tenant-isolation allowlist line bump.
- How all of this composes with #1088's `svc:` actor after the merge.

**Pre-existing, scored because each one breaks the floor this PR claims:**

- the actor is decoded while auth is verified;
- the actor's class is read from a string prefix;
- the `isDevOpenAdmin` denylist;
- no `nbf` check;
- stale line keys in the tenant allowlist;
- the 20-line gate's blind spots;
- the born-red harness's limits;
- missing open ledger entries.

These are labelled **pre** in the register.

**Out of scope, noted only:**

- Doc drift from #1088: `AUTH_TOPOLOGY_STAGING.md:60-64` still says a service token falls through to 401.
- `SECURITY_BASELINE.md:180-193` lists retired guards.
- `docs/security/threat-ledger.yaml` stops at TL-044.
- `LOGGING_STANDARD.md` names a `logger.ts` that does not exist.

## Loops

| Loop | Layer        | Team                                                                             | What it found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Score (cum.)       | Confidence |
| ---- | ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------- |
| 1    | Critical     | Dr of Security, Lead BE Architect, Sr Automation QA (+ Copilot review, verified) | The memo misses on `/repeat`, so a same-brand repeat after expiry gets 403. Deny-on-null sites are masked by the memo, with no standalone test. The mutation gate absorbs 7 memo survivors (**P**: run 41904335688, admin.ts 99.25→96.83, overall 96.13 ≥ 95). The `requireAdmin` pin is dead because `route()` fills the memo at entry (`router.ts:496`). No proof the fault was injected. The memo depends on env identity. Two derivations: decode versus verify. No structural gate. No staging layer.                                                                                                                     | 17%                | 85%        |
| 2    | Conservative | Dr of Security, Sr SDET/SRE                                                      | The floor is a **conditional yes** (P probe). Decode versus verify is **exploitable when misconfigured**: a deployed env with keys on and no team domain lets a key holder act under a forged email (**P**, pre). `DEV_OPEN_ADMIN` is banned nowhere, and `WORKER_ENV` is never checked exactly (pre). No happy-path Bruno request reaches the changed handlers. Mutation is not a required check and has no per-file ratchet. 5 of 35 tenant-allowlist keys are already stale. The deny paths are silent, and the event-create message is wrong. The local seed failure was not reproduced (CI ran clean), so it was dropped. | 0% (raw −19)       | 88%        |
| 3    | Adversarial  | Dr of Security red team; independent red team (no earlier findings)              | No cross-brand path and no auth bypass (**P**: 330-case sweep, RSA-signed JWTs). The independent team re-found the repeat miss and **proved** it (403 versus a 201 control). **RT-1:** the actor's class is a string prefix, and a signed email `key:x@oursharedevents.com` reads as a key actor: staging gets all brands plus platform, production passes the key-only flag writes (**P** code, **I** precondition, pre). No `nbf` check (P, pre). The 20-line gate misses 6 routes (P, pre). Composing svc with key is never wider than either alone.                                                                        | 0%                 | 90%        |
| 4    | Compliance   | Scrum Master, Dr of Security                                                     | No CI/CD testing ticket. No story spec or acceptance criteria. TL-084 has `target_invariant: null`, its `tested` status covers half the control, and its method label is outside the enum. The new rule has no ADR or baseline line. Stale comments. Four known gaps have no open ledger entry. One push was avoidable. The close-guard, born-red annotation, CONFORMANCE (regenerated by CI), manifest and CI/CD are all compliant.                                                                                                                                                                                           | 0%                 | 90%        |
| 5    | Recursive    | Lead (this worksheet)                                                            | Re-scored without inflating: two findings were downgraded on evidence, one was dropped, and nothing was rounded. The movement is honest. Loop 1's 17% fell because the later loops found proof gaps and the misconfigured-env exploit, not because the earlier lenses were rescored. Confidence rose because the claims moved from inferred to proven.                                                                                                                                                                                                                                                                         | **0% (raw −76.9)** | **90%**    |

## Findings register (merged by root cause)

**Weights:** Critical 15, High 10, Medium 5, Low 2.

**Modifiers:**

- **H1 loop position:** ×1.0 in loop 1, ×1.25 in loop 2, ×1.5 in loops 3 and later.
- **H2 correlation:** ×1.5.
- **H3 breadth:** log₂(N+1).
- **H4 promotion:** 3 or more sites raises the finding one tier.
- **H5 environment:** ×1.0 for code that ships to production, ×0.75 for process and records.

**Column key:** "P/I" means proven or inferred. "Src" is **PR** for this change and **pre** for pre-existing.

| id            | Sev                    | Loop | P/I        | Src | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                      | Deduction                     |
| ------------- | ---------------------- | ---- | ---------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| L1-02         | High→**Critical** (H4) | 1    | I          | PR  | **No deny-on-null site has a test that goes red alone.** The memo masks all three. The edited handler specs pass `DEV_OPEN_ADMIN:'true'`, so they prove only the allow path. TL-084 `tested` overclaims (C4-2).                                                                                                                                                                                                                                                | `events.ts:585-591`, `sponsors.ts:582-583`, `sponsors-draft.ts:310`; `events-publication.spec.ts:162`; `sponsor-eligibility-gate.spec.ts:233` | 15×log₂4 = **30.00**          |
| L1-01 + L2-S2 | High (H2)              | 1+2  | **P**      | PR  | **The mutation gate cannot fail on the memo.** Stryker runs only the node project; the race spec is in the workers pool. 7 new admin.ts survivors (269:7, 271:5, 274:7, 276:3, 331:7, 331:55); the aggregate 95 break has 6 mutants of headroom. `mutation` is not a required check, and there is no per-file ratchet.                                                                                                                                         | run 41904335688; `stryker.conf.mjs:64`; branch protection required contexts                                                                   | (10 + 5×1.25)×1.5 = **24.38** |
| RT-1          | High                   | 3    | P/I        | pre | **The actor's class is read from a string prefix, and the email's shape is never checked.** A signed token with email `key:x@<allowlisted domain>` gets: staging, scope all plus key-only plus platform; production, the key-only global flag writes. This becomes **Security Critical** if any IdP on the Access team can assert such an email; staging `CF_ACCESS_AUD=""` widens the issuers. No test covers it.                                             | `admin.ts:367`; `admin-brand-scope.ts:89,92,137`; `admin-object-scope.ts:261`; `audit.ts:81,178`; probe B1/B2                                 | 10×1.5 = **15.00**            |
| L1-09 + L2-S1 | Medium→High            | 1/2  | P          | PR  | **No staging layer.** No happy-path Bruno request hits event create, sponsor create with `event_id`, or promote (only OSE-1615's 400 refusal does). The PR's waiver is the author's, not the owner's. Fresh-token cross-brand 403 and `KEY_ACTOR_ONLY` can be reached on staging.                                                                                                                                                                              | grep of `bruno/`; AGENTS.md:73,83                                                                                                             | 10×1.25 = **12.50**           |
| C-3           | High                   | 4    | P          | PR  | **No CI/CD testing ticket is attached.**                                                                                                                                                                                                                                                                                                                                                                                                                       | AGENTS.md:84; STORY-FORMAT.md:60                                                                                                              | 10×1.5×0.75 = **11.25**       |
| L1-12 + L2-2  | Low→Medium             | 1/2  | P          | pre | **`isDevOpenAdmin` is a denylist.** It returns true for `undefined`, "preview", "Staging", "prod" and "production " (with a trailing space). `DEV_OPEN_ADMIN` is on no banned list, and staging's `WORKER_ENV` is never checked exactly. It now gates four more sites, though they all run after `requireAdmin`.                                                                                                                                               | `admin.ts:287-291`; probe E; `env-parity.mjs`                                                                                                 | 5×1.25 = **6.25**             |
| L2-S3         | Medium                 | 2    | P          | pre | **The tenant allowlist is keyed by line and has no orphan check.** 5 of 35 keys are already stale (`sponsors.ts:509`, `:672`, `:1263`; `event-stats.ts:74`; `shared-report-read.ts:431`), so a future unscoped query that lands on one of those lines is silently exempt.                                                                                                                                                                                      | `tenant-isolation.invariant.spec.ts:570-572`; key scan                                                                                        | 5×1.25 = **6.25**             |
| L2-S4         | Medium                 | 2    | I          | PR  | **The deny-on-null paths are silent.** There is no log or reason field, the audit rows look like ordinary refusals, and event create's message ("not a member of any brand") is wrong for this cause. Event create's response `rid` does not match the router's audit `reqId` (pre).                                                                                                                                                                           | `events.ts:585-600`; LOGGING_STANDARD §5.3; C4-8                                                                                              | 5×1.25 = **6.25**             |
| C-2           | Medium                 | 4    | P          | PR  | **OSE-1801 has no story spec or acceptance criteria in the repo**, and no LINEAR-MAP row.                                                                                                                                                                                                                                                                                                                                                                      | `docs/stories/`; `.claude/sync/LINEAR-MAP.md`                                                                                                 | 5×1.5×0.75 = **5.63**         |
| C4-1          | Medium                 | 4    | **P**      | PR  | **TL-084 has `target_invariant: null`**, so it renders under "not mapped" instead of #9 Tenant Isolation.                                                                                                                                                                                                                                                                                                                                                      | `threat-ledger.ts:1801`; generated report `:377`                                                                                              | 5×1.5×0.75 = **5.63**         |
| L1-03         | Medium                 | 1    | **P** (L3) | PR  | **`/events/:id/repeat` builds a new Request, so it misses the memo.** If the token expires during the source read or a slug retry, a same-brand repeat gets 403 `BRAND_FORBIDDEN`. This fails closed. The PR's claim "resolved once per request" is false here. Copilot threads 4472724329 and 4473059400.                                                                                                                                                     | `event-repeat.ts:76-81`; independent probe A (403 versus a 201 control)                                                                       | **5.00**                      |
| L1-04         | Medium                 | 1    | P          | PR  | **The `requireAdmin` pin is dead and described wrongly.** `route()` fills the memo at entry (`router.ts:496`); the pin's comment, TL-084 ("pinned when requireAdmin decides") and the PR body all say otherwise. The AUTH-002 rationale is moot.                                                                                                                                                                                                               | `router.ts:496`; `admin.ts:401-405`; Stryker 331 survivors                                                                                    | **5.00**                      |
| L1-05         | Medium                 | 1    | I          | PR  | **The race spec cannot show the fault was injected.** No assertion checks that the spy fired or that an un-memoised decode is null, and the JWKS-verified branch is never run with a moving clock.                                                                                                                                                                                                                                                             | `admin-actor-expiry-race.spec.ts:49-71`                                                                                                       | **5.00**                      |
| L1-07         | Medium                 | 1    | **P** (L2) | pre | **The actor is decoded, while auth is verified.** The memo makes the decode authoritative for the whole request. Proven exploit when misconfigured: deployed, keys on, no team domain, a forged victim email plus a key gives an allow with the victim's brand scope and audit name. Not live (the team domain is set at `wrangler.toml:275,420`). A revocation or expiry after entry stays allowed until the request ends; brand membership is still re-read. | probe (L2 Dr of Security, L3 independent C); `admin.ts:296-298,370-388`                                                                       | **5.00**                      |
| L1-08         | Medium                 | 1    | I          | PR  | **Deny-on-null is repeated in each handler.** No structural gate stops a future `actor === null ? allow`, and `requireAdmin` returns null for both "authenticated" and "bypass".                                                                                                                                                                                                                                                                               | C4-3; L3 independent "weakest point"                                                                                                          | **5.00**                      |
| RT-2          | Low                    | 3    | P          | pre | **No `nbf` or future-`iat` check** in either decoder.                                                                                                                                                                                                                                                                                                                                                                                                          | `admin.ts:211,303`                                                                                                                            | **3.00**                      |
| RT-3          | Low                    | 3    | P          | pre | **The OSE-INV9 "requireAdmin within 20 lines" regex misses 6 admin routes**: lines 1161, 1175, 1189, 1213, 1332 and 1836. All six call `requireAdmin`, and the OSE-1554 matrix covers them.                                                                                                                                                                                                                                                                    | gate20 probe                                                                                                                                  | **3.00**                      |
| RT-4          | Low                    | 3    | I          | PR  | **The `requireKeyActor` comment says X-OCR-Internal is "enabled in production".** It is absent there.                                                                                                                                                                                                                                                                                                                                                          | `admin-object-scope.ts:253`; `wrangler.toml:412`                                                                                              | **3.00**                      |
| L2-3          | Low                    | 2    | I          | pre | **The router pre-flight omits `expectedAud`.** `guardAdminObjectScope` scopes an identity whose audience is unchecked, before `requireAdmin` pins the audience. No exploitable oracle was found.                                                                                                                                                                                                                                                               | `router.ts:791-795`                                                                                                                           | **2.50**                      |
| C-6           | Low                    | 4    | P          | PR  | **The new rule ("a null actor denies unless isDevOpenAdmin") lives only in TL-084 and code comments.** There is no ADR or baseline line for it.                                                                                                                                                                                                                                                                                                                | `docs/adr`; SECURITY_BASELINE                                                                                                                 | **2.25**                      |
| C-7           | Low                    | 4    | P          | PR  | **One avoidable push.** The arch allowlist bump was not run locally first, which cancelled CI on e368dcca.                                                                                                                                                                                                                                                                                                                                                     | run list                                                                                                                                      | **2.25**                      |
| C4-6          | Low                    | 4    | P          | pre | **The born-red harness checks less than its header claims.** It does not check that a `test_ref` exists or fails, the method enum, or freshness.                                                                                                                                                                                                                                                                                                               | `born-red-harness.spec.ts:13,79-91,169`                                                                                                       | **2.25**                      |
| C4-7          | Low                    | 4    | I          | PR  | **Stale comments:** `extractAdminActor` "call AFTER requireAdmin" and its missing `svc:`; object-scope's "no verified admin identity"; TL-065's "cannot false-green under DEV_OPEN_ADMIN".                                                                                                                                                                                                                                                                     | `admin.ts:321-329`; `admin-object-scope.ts:173`; `threat-ledger.ts:1291`                                                                      | **2.25**                      |
| C4-9          | Low                    | 4    | P          | pre | **The repo records named gaps as open ledger entries, and four known gaps have none:** decoded versus verified actor, the `DEV_OPEN_ADMIN` denylist, the prefix-classed actor, and `nbf`.                                                                                                                                                                                                                                                                      | ledger scan                                                                                                                                   | **2.25**                      |
| L1-06         | Medium→Low             | 1    | P          | PR  | **The memo is keyed on env object identity.** Only `index.ts:54` copies env, and that happens before `route()`. A miss fails closed.                                                                                                                                                                                                                                                                                                                           | probes B and E1                                                                                                                               | **2.00**                      |
| L1-10         | Low                    | 1    | I          | PR  | **Composition with #1088 after the merge:** the import union is done, but no born-red case covers a `svc:` token under a moving clock.                                                                                                                                                                                                                                                                                                                         | merge `28b11ddc`                                                                                                                              | **2.00**                      |
| L1-11         | Low                    | 1    | P          | PR  | **The born-red record is inconsistent.** The spec says "settling test on main" while the ledger says `deliberate-fixture-break`, and `test_ref` names one test out of five.                                                                                                                                                                                                                                                                                    | `spec:18`; `ledger:1808`                                                                                                                      | **2.00**                      |

**Totals:**

| Group            | Points     |
| ---------------- | ---------- |
| **All findings** | **176.89** |
| PR-attributable  | 131.39     |
| Pre-existing     | 45.50      |

**Dropped on evidence:**

- **The combined-run seed failure:** CI shard 3/3 ran both specs clean, with no retry.
- **Request reuse in tests (B4):** the full suites were green locally apart from known CRLF noise.
- **Manifest test count:** it matches the triage script's own rule, and `--check` passes.
- **The truncated merge headline:** a display issue only.

**Re-graded:**

- **Repeat:** kept at Medium. One red team proposed Low, but it disproves the PR's stated invariant, and Conservative assumes the worst.
- **Env identity:** lowered to Low. The SRE lens and the Dr of Security agree it is availability only.

## What must be true before shipping

1. The repeat route keeps the authenticated actor through the create call and every slug retry, and a regression test covers expiry during the source read.
2. Each of the three handler deny sites has a direct test with a null actor and the bypass off (staging, production, unset). Each test is watched red with only its own line reverted.
3. A node-project test inside the Stryker set kills the memo mutants. The `admin.ts` mutation score is back to at least its main baseline (99.25).
4. The race spec asserts its precondition: an un-memoised decode is null after the spy.
5. TL-084 is corrected: invariant #9, the method label within the enum, the pin point, requireKeyActor as the fourth site, and a `status` that matches what is pinned. The stale comments are fixed.
6. The owner decides two things: the staging layer (an approved waiver, or Bruno for the fresh-token controls) and the CI/CD testing ticket.
7. RT-1's precondition is answered, or closed in code: reject any email that is not a strict addr-spec, or carry the actor as `{kind, id}`.

## Commit sequence (proposed)

1. **Repeat route keeps the actor.** Pass the pinned actor into `handleCreateEvent`, or copy the memo entry onto the derived Request. Add a race test for expiry inside the D1 read and across slug retries. Reply to and resolve Copilot threads 4472724329 and 4473059400. (L1-03)
2. **Deny-on-null tests per site**, each born red, plus the race spec's precondition assertion. (L1-02, L1-05)
3. **Memo unit test in the node project**, plus a decision on the dead pin: either remove it and document route entry as the pin point, or keep it with a direct-caller test. Fix the comments. (L1-01, L1-04, RT-4, C4-7)
4. **One structured, reasoned log line on a null-actor deny**, and a correct message for event create. (L2-S4)
5. **Records:** TL-084 corrections, open ledger entries for the four pre-existing gaps, and a baseline or ADR line for the rule. (C4-1, L1-11, C4-9, C-6)
6. **Structural invariant:** no permissive null-actor branch in `src/handlers` or `src/lib`, with named exemptions for `admin-object-scope.ts:200` and `admin-write-guard.ts:99,105`. List it in the T0 invariants step and watch it red. (L1-08)
7. **If the owner says so:** Bruno for fresh-token own-brand 201, cross-brand 403 and `KEY_ACTOR_ONLY`. (L1-09)
8. **Separate tickets under OSE-1444**, unless the owner wants them here:
   - RT-1 email shape check (recommended now: it is cheap and closes a candidate Security Critical);
   - derive the actor from `requireAdmin`'s decision (L1-07);
   - make `isDevOpenAdmin` an allowlist and ban `DEV_OPEN_ADMIN` at deploy (L1-12);
   - add an `nbf` check (RT-2);
   - allowlist orphan check and statement-hash keys (L2-S3);
   - 20-line gate derived from the router (RT-3);
   - harness `test_ref` existence check (C4-6);
   - pre-flight `expectedAud` (L2-3);
   - per-file mutation ratchet, and mutation as a required check (repository controls: owner).
9. **Re-run this CCR on the fix head.** Fix rounds breed findings.

## Verification after shipping

- **Merged** (Linear: In Progress): post an evidence comment on OSE-1801 and update `docs/brain/ROLE-STATE.md` for BE, security and QA.
- **Done:** T1–T4 green for the merge SHA. T2 and T3 do not exercise this behaviour unless step 7 lands, so say that on the ticket.
- **CONFORMANCE:** after the bot regenerates it, check that TL-084 lands under #9.

## Risks accepted (proposed; owner to confirm)

- **Identity is pinned for the whole request.** A token revoked or expired after the request starts stays valid until the request ends. Brand membership is still re-read from D1 on every call.
- **The expiry race itself is proven only at the mock layer.** Staging cannot make a token expire mid-request on demand.

## Human gate

1. **RT-1 (Dr of Security, loop 3, Adversarial):** can any identity provider on the Cloudflare Access team issue an email whose local part starts with `key:` or `svc:` inside an allowlisted domain? On staging this means any Access app, while `CF_ACCESS_AUD` is empty. Closing it needs either the IdP list and each provider's email validation, or a decision to close it in code now (recommended).
2. **Staging layer (Scrum Master, loop 4, Compliance):** do you approve the race as mock-only? Do you want Bruno requests for the fresh-token controls in this PR?
3. **CI/CD testing ticket and acceptance criteria (Scrum Master, loop 4):** should I file the testing ticket and add acceptance criteria to OSE-1801?
4. **Pre-existing gaps (all loops):** fix them in this PR, or file them as separate tickets under OSE-1444 (proposed)?
5. **Mutation (SDET/SRE, loop 2, Conservative):** per-file ratchet, and mutation as a required check? This is a repository control.
6. **Security Human Gate:** run 41908928637 (`pull_request_review`) is at `action_required` and needs your approval before merge.
