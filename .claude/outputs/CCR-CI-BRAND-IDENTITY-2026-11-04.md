# CCR — staging CI identity that is a brand admin (PR #1088) — 2026-11-04

**Owner's request (verbatim):** "Run the CCR"
**Parsed:** 5 loops (Critical, Conservative, Adversarial, Compliance, Recursive) per the owner's run model; extended scrum team with Dr of Security in every loop; subject frozen; nothing changed between loops; one cumulative score after the last loop. Class inferred: security change to admin identity. The class table sets security at 3 loops, but this adds a new admin identity class, so it was run at 5 ("the owner may ask for more loops; never fewer").

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System score**          | **0%** (clamped). Merged raw: 100 − 186.1 = **−86.1**. A Security Critical candidate (N1) is open, and the rule gives it no partial credit. Without N1, the raw score is still −48.6.                                                                                                                                                                |
| **Assessment confidence** | **90%**. The lenses converged across loops, and two red teams that did not see each other's work found N1 independently. Confidence is held down by three things: N1's trigger is inferred and has not run; the live Cloudflare state (Access policy, token claims, `preview_urls`) was not readable; and every test claim is local, with no CI run. |
| **Gate**                  | **FAIL, human gate.** Below 95%, with an unresolved Security Critical candidate.                                                                                                                                                                                                                                                                     |
| **Frozen subject**        | PR #1088, commit `78cac67b` against base `cbbb81c7` (25 files, +914/−23), `git diff` sha256 prefix c36f18e2. Re-checked unchanged before loops 2, 3, 4 and 5.                                                                                                                                                                                        |

**Headline.** The identity holds up as designed:

- A `svc:` actor cannot be obtained without a team-signed token, the pinned audience, staging, and a listed name.
- It is never platform and never `all`.
- Key-only routes refuse it.
- It is inert on production and inert today. Staging `CF_ACCESS_AUD = ""` and `CI_SERVICE_ACTORS` is unset.

The run turned up two classes of problem:

1. **A pre-existing fail-open (N1)** that breaks the PR's own claim "never another brand". It affects human brand admins on production code paths too.
2. **Proving and operating gaps.** No CI has run on this commit, the mutation gate is red, the staging layer is green while it skips, and there is no runbook or credential lifecycle. The PR also routes the new secret around the repo's Doppler rule, and the security records, ADR and an invariant were not updated.

## In scope / out of scope

- **In scope:** the diff (auth actor class, brand scope, write guard, audit source, events "only mine", staging var, production gate test, env-parity, the Bruno folder-6 requests, the `ci-brand` seed, T2 wiring, artifact scan, local vetting, REPORT-DEPTH). Also how all of this composes with existing admin routes.
- **Out of scope, recorded but not scored:**
  - **Pre-existing unscoped flag reads.** `GET /admin/flags?scope=event` and `/flags/resolve` are unscoped (`router.ts:1630-1656`).
  - **CODEOWNERS / review lock can't fail.** It is unenforceable with a single code owner and no required reviews (owner repository control).
  - **Security Human Gate passes on no reports.** It passes when no security checks have reported (not verified as required).
  - **N1 itself** is pre-existing and outside the diff. It is scored because it breaks a claim the PR makes, and a scored claim that is false is the subject's problem.

## Loops

| Loop | Lens         | Team                                                                         | New root causes                                                                                                                                                                                                                                                                                                                  | Running raw         | Confidence                                         |
| ---- | ------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------- |
| 1    | Critical     | Dr of Security, Lead BE Architect, DevOps Mgr                                | 16 (no Security Critical; 4 High)                                                                                                                                                                                                                                                                                                | ≈ 32%               | 80% (the lenses disagreed on the Stryker test set) |
| 2    | Conservative | Dr of Security, Sr SDET/SRE, Sr Automation QA                                | N1 (Security Critical candidate), PII reach, prod deploy gate, T2 activation, vacuous assertions; S1 corrected (the spec **is** in Stryker); S7 and S9 re-graded down                                                                                                                                                            | < 0% (N1 floors it) | 85%                                                |
| 3    | Adversarial  | Dr of Security (red team), independent red team (not given earlier findings) | N1 confirmed independently and widened to a third site (sponsor create, a D1 window with no slow body); single-factor svc; `common_name` not bound to type; prefix actor kinds; `preview_urls`                                                                                                                                   | lower               | 88%                                                |
| 4    | Compliance   | Product Owner, Scrum Master, Dr of Security                                  | stale security records (OSE-889 et al.), no ADR, Doppler bypass, invariant misses the secret, no CI/CD ticket, untracked owner steps                                                                                                                                                                                             | lower               | 90%                                                |
| 5    | Recursive    | Lead (synthesis, re-verification)                                            | none new. The register was merged by root cause, scored, and the key Loop 4 claims re-verified in source (Doppler rule `docs/doppler/CF-ACCESS-SECRETS-SOURCE-OF-TRUTH.md:19-24`; `ci-approval-gate-safety.invariant.spec.ts:52-59`; `AUTH_TOPOLOGY_STAGING.md:56-64`; `events.ts:551,586-605`; `sponsors-draft.ts:250,308-309`) | −86.1               | 90%                                                |

The score fell at every loop. That is the protocol working as designed; it was not argued back up.

## Findings register (merged by root cause)

Weights: Critical 15 · High 10 · Medium 5 · Low 2.

Modifiers:

- **H1 loop position:** ×1.0 for loop 1, ×1.25 for loop 2, ×1.5 for loop 3 and later.
- **H3 breadth:** log₂(N+1), applied only to code-site breadth.
- **H5 environment:** ×1.0 for code that ships to production; ×0.75 for staging-only config and process.
- **H2 correlation:** ×1.5 on the staging-activation cluster.

| id        | Sev                               | Loop          | P/I                       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                           | Deduction                   |
| --------- | --------------------------------- | ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **N1**    | **SECURITY CRITICAL (candidate)** | 2 (widened 3) | code **P**, trigger **I** | **A null actor after `requireAdmin` fails open at three create sites.** `extractAdminActor` re-checks `exp` on every call and is not memoized per request. If the clock passes `exp` after `requireAdmin` passed (for example across a body read or a D1 await), the actor is null and the brand check is skipped: (1) event create maps null → `{mode:'all'}`, so the brand comes from the body or falls back to `root`; (2) sponsor create with an `event_id` skips the scope check; (3) draft promote treats null as "in scope". Pre-existing. It affects svc on staging and human brand admins on production code paths, and it breaks the PR's claim "never another brand". No threat-ledger entry. | `admin.ts:301-303,329-353`; `events.ts:551,586-605`; `sponsors.ts:453,561,575`; `sponsors-draft.ts:250,308-309`; CONFORMANCE.md #9 | 15×1.25×2.0×1.0 = **37.50** |
| H1        | High                              | 1             | P                         | Mutation gate red on this commit (93.94 < 95). Survivors in the new code: `isAutomationActor`→`true` (admin.ts:62) and `if (svc)`→`if (true)` (:338). `mutation` is not a required check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | run 41886838892                                                                                                                    | 10.00                       |
| H2        | High                              | 1             | P                         | No CI pyramid on this commit. The base is #1086's branch and the CI triggers only on PRs to main, so #1088 could merge there with zero required checks. Born-red claims have no CI evidence; the author's runs were local, in-session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `oursharedevents-ci.yml:100-106`; `gh pr view 1088`                                                                                | 10.00                       |
| H3        | High                              | 1             | I                         | `CI_SERVICE_ACTORS` has no stated home. A dashboard-set var is removed by the next `wrangler deploy --env staging`, which turns the identity off silently. The repo treats the Client ID as a Doppler-managed secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `wrangler.toml:264-269`; ci.yml:1374; CI_SECRET_NAMING.md:70                                                                       | 10×1.0×0.75 = 7.50          |
| H4        | High                              | 1             | I                         | No runbook: setup order, leak response or rotation. Revocation takes three owner steps, and already-minted JWTs stay valid until `exp`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | no `docs/runbooks` change                                                                                                          | 7.50                        |
| H5        | High                              | 2             | P                         | **T2 goes red on activation day.** Unless all four prerequisites are in place, T2 fails and blocks T3, T4 and the Done bar. The seed step runs even while the identity is inert, which adds a failure point to every T2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | workflow seed step; Bruno seq 9-13                                                                                                 | 10×1.25×0.75 = 9.38         |
| M1        | Medium                            | 1             | P                         | **The staging layer counts as absent.** The skip leaves a green "SKIPPED" result and can stay that way forever. Seq 13 asserts only 403, which the Access edge or the write guard also satisfies. Seq 12's 404 is not tied to another brand.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Bruno folder 6                                                                                                                     | 5×1.0×0.75 = 3.75           |
| —         | correlation                       | —             | —                         | H3, H5 and M1 are one activation failure mode: 20.63 × 1.5 = 30.94                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                    | +10.31                      |
| M2        | Medium                            | 1             | P                         | Pinning the staging audience is a wider change. It turns on aud/iss checks for every staging Access JWT and the existing CI token, and both tokens must belong to the same Access app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `wrangler.toml:279`                                                                                                                | 3.75                        |
| M3        | Medium                            | 1 (+3)        | I                         | Actor kind is decided by string prefixes scattered across `admin-brand-scope.ts:89,137,172` and `audit.ts`. The next actor kind will drift, and an IdP email starting with `svc:` or `key:` would be misclassified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                                                                                                    | 5.00                        |
| M4        | Medium                            | 2 (+3)        | I                         | **svc is a single-factor full brand admin.** Writes, uploads, link minting and the decrypted PII routes (`/forms/contacts`, `/forms/export`, registrations) all go beyond its stated purpose of testing the caps. Before this PR, an emailless token granted nothing at the worker.                                                                                                                                                                                                                                                                                                                                                                                                                      | `forms.ts:683-719,834-857`; `admin.ts:436` vs `:445-453`                                                                           | 5×1.25×0.75 = 4.69          |
| M5        | Medium                            | 2             | I                         | A refused svc token leaves no log reason (unlisted, aud or iss); the response is a bare 401.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `requireAdmin` cfTrustable branch                                                                                                  | 4.69                        |
| M6        | Medium                            | 4             | P                         | **Security records are now false.** The OSE-889 "never grants access on the JWT alone" text is wrong in `AUTH_TOPOLOGY_STAGING.md:56-71`, the `admin.ts` header and actor docstring, `audit-log.ts:19`, the AGENTS.md "Admin auth" line, `CONSTRAINTS.md:8`, `SECURITY_BASELINE-ROOT.md` §2.3, and the `admin-servicetoken-fallthrough.spec.ts:80` test name.                                                                                                                                                                                                                                                                                                                                            |                                                                                                                                    | 5×1.5×2.0 = 15.00           |
| M7        | Medium                            | 4             | P                         | No ADR for the new admin credential class. ADR-006's revisit trigger is met. OCR-docs ADR-012 D4 already proposes a `common_name`→`key:` mapping, and nothing on record separates the two.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ADR-006; OCR_GATE_ADR012 :386                                                                                                      | 7.50                        |
| M8        | Medium                            | 4             | P                         | A structural invariant enumerates secret names and misses the new one, so a later PR-reachable allowlisting would pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ci-approval-gate-safety.invariant.spec.ts:52-59`                                                                                  | 7.50                        |
| M9        | Medium                            | 4             | P                         | **The PR routes the new secret around the Doppler rule** ("`gh secret set` for these keys is forbidden"). It has no Doppler entry, no canary, no manifest or rotation-table row, and the T2 job has no `environment:`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docs/doppler/CF-ACCESS-SECRETS-SOURCE-OF-TRUTH.md:19-24`                                                                          | 5×1.5×0.75 = 5.63           |
| M10       | Medium                            | 4             | P                         | No CI/CD testing ticket is attached to OSE-1800 (DoD), and the owner steps are not tracked as a checklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | AGENTS.md DoD                                                                                                                      | 5.63                        |
| Lows      | Low ×15                           | 1–4           | mixed                     | Each Low below; the per-item deductions follow the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |                                                                                                                                    | 30.76                       |
| **Total** |                                   |               |                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |                                                                                                                                    | **186.09**                  |

The 15 Lows:

- S7: a JWT actor outranks key headers (fails closed).
- S10: audit source/Logs SQL for svc is unpinned.
- S11: svc creates events with `data_class='production'`.
- S12/L3-3: `common_name` is not bound to the token type (an mTLS CN would also match).
- S13: the svc brand guard accepts any non-platform slug, so `root` would expose real staging PII (compounds M4).
- S14/A6: missing tests (router-level forged signature, svc+key precedence, expired svc token).
- S16: local `wrangler dev` runs `WORKER_ENV=staging` and is inert only by absence.
- L2-4: svc use is visible only under source `key`, and reads are unaudited.
- L2-5: a wrongful flag-PUT success would leave the override on.
- N4: `WORKER_ENV` is tested only against `'production'` (a deny-list flip would pass).
- L3-5: `workers_dev`/`preview_urls` are not pinned false.
- L3-6: `nbf` is never checked.
- C7: no TL annotation, so the conformance report can't see the coverage.
- C8: "Production can never carry either setting" overclaims (the R2 forbidden-secret deploy gate was not extended).
- C10: owner actions live only in the PR body.

## What must be true before shipping

Solutioning with the scrum team, per the owner's run model ("under 95%, create solutioning with the scrum team").

1. **N1 is settled and fixed first, in its own PR**, because it is production code for human admins. It needs a Linear ticket under OSE-1444 (Urgent or High) and a TL entry.
   - **Settling test, born red.** Workers pool: a signed brand-A JWT with `exp = now+30`, and a body stream (or a D1 `first()`) that moves fake time past `exp`. Expect 403/400, never a 201 in brand B.
   - **Fix.** Resolve the actor once per request (`requireAdmin` returns it, or a `WeakMap` keyed by the Request) and pass it to handlers. A null actor denies everywhere unless an explicit DEV_OPEN_ADMIN actor was set.
2. **PR #1088 reaches main through the gate.** Merge #1086 first, then bring #1088 onto main (merge, never rebase or force-push). All 10 required contexts must be green on #1088 itself.
3. **Mutation survivors are killed:**
   - an email actor with no Origin or Sec-Fetch-Site is still refused by the write guard;
   - a valid, unlisted, emailless JWT plus X-OCR-Internal resolves to `key:ocr-internal`.
4. **Tests are strengthened:**
   - assert `code: KEY_ACTOR_ONLY` plus JSON on the key-only refusals (router and Bruno);
   - tie seq 12 to a seeded other-brand event with a body check;
   - run `WORKER_ENV` through `test.each`;
   - add a router-level forged-signature test, a precedence test and an expired-token test.
5. **Records are updated in the same change:**
   - the OSE-889 texts, the admin.ts header and docstrings, `audit-log.ts`, CONSTRAINTS and the security baseline;
   - the AGENTS.md "Admin auth" line, which goes to the owner because AGENTS.md changes need the 5-loop CCR with a human gate;
   - an ADR-006 amendment or a new ADR on admin actor classes;
   - a TL entry;
   - the forbidden-keys invariant extended to the new names;
   - the R2 production forbidden-secret gate extended to `CI_SERVICE_ACTORS` and `CI_SERVICE_ACTOR_BRAND`;
   - the "can never" wording softened.
6. **Credential lifecycle:**
   - a runbook covering setup order, leak response and rotation;
   - the two secrets registered in Doppler (owner), plus the canary, the `.github-secrets-required.json` manifest and the rotation table;
   - `CI_SERVICE_ACTORS` stored as a staging Worker secret (`wrangler secret put`, owner) so deploys keep it;
   - a structured log line naming the reason whenever an svc token is refused.
7. **Activation is honest.** The seed step runs only when the secrets exist. After activation, a skip on `main` fails (for example via a repo variable that declares it active). OSE-1800 reaches Done only once a T2 log prints the five real request names.
8. **Breadth is narrowed or accepted.** This is an owner decision (see below). At minimum, the svc brand must start with `ci-`.
9. **The CCR is re-run on the final diff.**

## Commit sequence (proposed)

1. A separate PR for N1: settling test, then the fix (resolve the actor once, deny on null), then the TL entry. It goes through its own CCR, with Dr of Security and Opus.
2. Merge #1086 (normal gate), then T1–T4 on main, then an evidence comment on OSE-1562.
3. #1088: merge main in. Then, in one push: mutation-killing tests and test strengthening; the typed actor-kind helper; the refusal log; the `ci-` brand rule; the records, ADR, TL entry, forbidden-keys invariant and R2 gate; the runbook; a seed step gated on the secrets; and the activation tripwire.
4. Re-run the CCR on #1088, then merge into main and set OSE-1800 to In Progress.
5. Owner activation, in order:
   1. pin the staging audience (OSE-1377);
   2. verify the existing human and CI paths;
   3. create the second token and add it to the staging Access app policy;
   4. add the secrets via Doppler;
   5. set `CI_SERVICE_ACTORS` as a staging secret;
   6. on the next main run, T2 prints the five real names, then move OSE-1800 to Done.

## Verification after shipping

- The T2 log shows "CI brand admin" requests 9–13 by name, not SKIPPED.
- The staging audit log shows `svc:<cn>` rows only for ci-brand.
- The canary covers the new token.
- `env-parity` passes.
- The N1 settling test is in CI and red-on-fault.

## Risks accepted

None so far; acceptance is the owner's call. The candidates are N1 (only if the owner chooses to accept it, with a written record like RA-1) and M4 breadth (if the owner accepts a full brand admin on a synthetic brand).

## Human gate — questions for the owner

1. **N1.** Fix it first in a separate PR (recommended), run the settling test first and decide from its result, or accept the risk in writing? It is pre-existing and affects human brand admins on production code paths. Production is held closed but answers on `oursharedevents.com`.
2. **svc breadth.**
   - **(a)** Keep it a full brand admin of a synthetic `ci-` brand.
   - **(b)** Narrow it to a read-only allowlist plus the one flag PUT it needs, refusing PII routes (recommended for least privilege).
   - **(c)** Add a worker secret as a second factor.
3. **Secrets path.** Confirm the two new secrets go through Doppler (and the canary) rather than `gh secret set`, and that `CI_SERVICE_ACTORS` lives as a staging Worker secret.
4. **Mutation gate.** Kill the survivors in this PR (planned), and decide whether `mutation` becomes a required check (an owner repository control).
5. **AGENTS.md "Admin auth" line.** The owner decides whether to amend it (5-loop CCR with a human gate after each loop) or to keep AGENTS.md generic and put the detail in the new ADR.

_Information that would close the open uncertainty:_

- the N1 settling test result;
- one real staging service-token JWT payload (key names only);
- the remote `preview_urls` state;
- whether the staging Access app allows mTLS.

## Loop-by-loop source registers

Scratchpad registers `ccr-1088-loop1.md`, `ccr-1088-loop2.md` and `ccr-1088-loop3.md` hold the full per-lens evidence and the commands each lens ran. Every lens was read-only and none was refused.
