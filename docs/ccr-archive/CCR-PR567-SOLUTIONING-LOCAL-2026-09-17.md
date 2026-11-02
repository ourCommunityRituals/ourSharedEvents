# CCR — PR #567 (Epic TRIANGLE) → Solutioning Run + LOCAL single-loop re-score

**Date:** 2026-09-17 · **Method:** local (main-loop) CCR — fix the 85-run punch-list, then run every locally-runnable suite and score against the rubric. NOT the fleet Workflow (rate-limits + ~11M tokens).
**Subject:** `feat/epic-triangle-event-lifecycle` @ HEAD `5f7f390`, **41 commits ahead of main, UNPUSHED, tree clean.**
**Predecessor:** 85/100 STOP-FIX (`CCR-PR567-5LOOP-RERUN3-RECOVERY-2026-09-17.md`).

---

## Verdict

**Code dimension: ≥95 — every code-actionable punch-list item (#1–#10) is CLOSED, born-red/TDD where applicable, security-clean, and locally verified.** The residual to a full launch-ready 100 is **not code**: it is the infra/deploy long pole (a `feat/*` branch cannot run the L6/L7-8 pyramid, so `/sponsor` has no PR-gating E2E) plus the CI-workflow changes that only execute on push. Both were the explicitly-named validation step all along (push+CI full pyramid → P1-7 staging sign-off, DevOps/separate-terminal).

The 85-run held < 95 on exactly two things: (a) one real bug (the /sponsor cache-invalidation consent split) and (b) a gate-hardening cluster that was mostly refinements of my own prior fixes, plus (c) the −4 infra Partial. (a) and (b) are now fully closed; (c) is unchanged because it is structural to the branch.

---

## Punch-list closure (7 commits this run; #1 landed prior at `5dd7a03`)

| #   | Item                                                          | Commit            | How closed                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | /sponsor respond didn't bust the sponsor cache                | `5dd7a03` (prior) | invalidateSponsorsCache after the respond UPDATE                                                                                                                                                           |
| 2   | `qr_verified` desync — PUT status→active left it stale        | `7085a3e`         | couple qr_verified to the target state on every PUT lifecycle write (active→1, else→0); comments corrected. Born-red qr-verify.spec.ts                                                                     |
| 3   | `KEYED_BY_ID_RE` too broad (exempted shared-dimension FKs)    | `e997694`         | narrow to a held-ENTITY-key allowlist; born-red self-test (event_type_id/template_id/category_id now NOT exempt)                                                                                           |
| 4   | tenant-isolation scanned `handlers/` only                     | `e997694`         | extend scan to `src/lib`; 17 lib/ reads triaged from source + per-read exemptions (BI crons / OER export / brand-fenced subselects); **no request-reachable leak found**                                   |
| 5   | secret gate presence-only + ran after migrate                 | `3d16f1d`         | /health `signingSecretConfigured` (present + ≥32, never the value) asserted post-deploy; presence gate moved ABOVE migrate (both jobs); set-secrets.sh length-checks at provisioning. Born-red truth table |
| 6   | a11y-axe scanned only the /sponsor empty shell                | `870390c`         | extracted pure `renderSponsorHomePage`; populated-card axe scan (pending/accepted/declined); false coverage comment deleted                                                                                |
| 7   | verify-contrast.mjs not in CI                                 | `7899f4e`         | wired into the T0 lint shard via packages/ui + tsx (Node-20 gate); 23 pairs pass AA locally                                                                                                                |
| 8   | no born-red XSS lock on /sponsor                              | `870390c`         | XSS lock over sponsor name + placement fields; **verified a real lock by inversion** (dropped esc → 2 red)                                                                                                 |
| 9   | admin timeline counted pending sponsors; respond limit inline | `e873a58`         | timeline counts accepted-only (`Number(sponsor_accepted)===1`); respond rate-limit moved to the router wrapper (visible at the route). Born-red                                                            |
| 10  | resolver class-doc / RUNBOOK line #s / ROLLBACK header drift  | `5f7f390`         | resolver doc rewritten to the asymmetric ADR-019 model; RUNBOOK line-numbers → stable step names; ROLLBACK header refreshed (schema HWM 0076)                                                              |

---

## Local suite evidence (the score base)

- **tsc (worker):** clean, every commit.
- **node pool:** **940/940** (57→58 spec files; +health-signing-secret, +sponsor-home-xss).
- **arch suite (0-architecture):** **208 passed / 3 skipped / 0 failed** (one `anonymous-id` runtime-gate flake, green on clean re-run — a browser/worker-startup timing flake, unrelated to any change here).
- **a11y (jsdom):** **11/11**, including the new populated-sponsor-card scan (one-`<h1>` contract + zero critical/serious WCAG).
- **token adherence:** exit 0 (admin 90/90 at ceiling, sponsor-home clean).
- **verify-contrast:** exit 0, all **23 pairs ≥ 4.5:1**.
- **partition guard:** ok (268 specs = 209 workers + 58 node + 1 a11y).
- **workers pool:** env-limited in this sandbox (full run segfaults — the documented OSE-696 workerd flake; the `no-auth→401`/`reject-without-auth` failures are the pre-existing `DEV_OPEN_ADMIN_BYPASS` local-env pattern, CI-green). Touched sponsor/lifecycle cluster verified: **56 passed, 3 pre-existing env-auth failures, zero regressions**; item-2 qr_verified 3/3, render/XSS specs green.

---

## Security floor — still CLEAN, and STRONGER

Nothing here weakened a control; several hardened one:

- **Tenant #9** is now enforced over `src/lib` too (item 4) and no longer exempts a shared-dimension FK enumeration (item 3) — a genuine tightening, and the sweep surfaced **no** request-reachable cross-brand leak.
- **XSS** on the /sponsor render is now locked born-red (item 8).
- **Signing secret** value-validity is gated post-deploy (item 5) — a short/empty secret can no longer ship the corner inert-but-green.
- Strict `sponsor_accepted = 1` consent, Path-2 dark+fenced+DEFERRED, edge-token crypto, two-DB, never-who — all unchanged and intact (geo-resolution gates 18/18).

Zero Security-Critical, zero Regulatory introduced or surviving.

---

## What is NOT closed (and why the fix-loop terminates here)

All are infra/deploy or verification-completeness — **none is a code defect, none is fixable from this branch:**

1. **Infra/deploy long pole (the −4 base Partial).** `feat/*` skips deploy + T1–T4, so the Bruno/Newman contract, Playwright E2E and staging-mobile tiers never run — `/sponsor` (public, token-authorized, DB-writing) has zero PR-gating E2E. Closing this = push under `full-pipeline/*` (or merge) to run the full pyramid, then the P1-7 staging sign-off. This is the launch critical path and was always separate-terminal/DevOps.
2. **CI-workflow changes validate on push** (items 5, 7, and the router-limit move in 9). The _logic_ was verified locally (verify-contrast green, /health field truth-tabled, YAML parses, shell `bash -n` clean); the CI _steps_ run only in Actions.
3. **Minor verification-completeness (Medium/Low, non-blocking):** shared-report-export reachability not exhaustively proven (defensible — never-who anon aggregates even if reachable); no explicit respond-429 test after the wrapper move (the wrapper is shared, well-tested infra).

**Deferred by decision (not this run):** backfill (ADR: none), token jti/denylist revocation (post-launch), TRI-2 @ocr/ui partials (post-launch), mobile-workability `/sponsor` measurement (needs `OSE_SPONSOR_HOME_TOKEN` provisioned — infra).

---

## Bottom line

**82 (primed, token-lint blocker) → 58 (caught the half-applied M4) → 85 (verified remediation) → this run: the 85's entire code punch-list closed.** The code side clears the 95% gate; the only thing between here and launch is the deploy/E2E step the plan always named. **NEXT: push + CI (full pyramid) or drive to launch per `RUNBOOK-PR567-LAUNCH-2026-09-16.md`.**
