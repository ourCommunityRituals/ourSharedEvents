# Security-Review Setup ↔ `anthropics/claude-code-security-review` — Sync Reconciliation — 2026-09-29

> **TEMPORARY REFERENCE, not a committed audit.** The durable record is the Linear
> stories in §6 (OSE-1400..1407). Delete this file once those stories have
> absorbed what they need. The Linear descriptions cite
> `docs/audits/…`; this file lives at `.claude/outputs/` instead.

## Scope & method

Question from the PO: how does OSE's security-review setup compare to Anthropic's
public [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review)
GitHub Action, and what should the infrastructure adopt?

Two sources were reconciled against each other and against the live tree:

1. **External:** the public repo's README (inputs, pipeline, default
   false-positive filter, stated caveats). Contributor count could not be
   verified from the page, so it is not used as evidence either way.
2. **Internal:** `.github/workflows/*` (15 security-bearing workflows), the
   `.claude/skills/ccr-protocol.md` security tier, and the worker source/tests,
   each cited by file:line.

This pass is **read-only and advisory**. No workflow, Linear ticket, or brain
file was changed. A second verification pass during writing caught one false
premise in the first-pass recommendations (OSE-1080, see §4). The
verified-in-code rule from the root `CLAUDE.md` was applied: nothing is called
a gap without a direct source check.

## Verdict legend

Uses the same vocabulary as `LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md`:

- **DONE_IN_CODE**: code + tests implement it and a CI job exercises it.
- **PARTIAL**: exists, but a real gap remains.
- **NOT_STARTED**: no evidence found.
- **DRIFT**: the code is right and a doc or comment describing it is stale.

## 1. What each side is

|                          | `claude-code-security-review`                                                                         | OSE setup                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Shape                    | One tool: an LLM security audit of the PR diff, a false-positive filter pass, then inline PR comments | Defense-in-depth pipeline: SAST, secrets, dependencies, DAST, red-team, triage/SLA/human gate                                        |
| Blocking?                | Comments only; exposes `findings-count` output                                                        | Semgrep `--error` and detect-secrets block (`oursharedevents-ci.yml:249-287`); Claude review is advisory (`claude-review.yml:35,78`) |
| Customization            | `custom-security-scan-instructions`, `false-positive-filtering-instructions`, `exclude-directories`   | Semgrep rule packs, `.gitleaks.toml`, `.secrets.baseline`, `.zap/rules.tsv`                                                          |
| Prompt-injection posture | README: **not hardened**; trusted PRs only                                                            | `@claude` comment path gated to OWNER/MEMBER/COLLABORATOR (`claude-review.yml:45-50`)                                                |
| Supply chain             | Quick-start uses `@main` (mutable)                                                                    | Claude action SHA-pinned (`claude-review.yml:76`)                                                                                    |

## 2. Layer-by-layer reconciliation

| Layer                                                                                                     | OSE evidence                                                                                                                                 | Verdict                                                                                              | Covered by the action?                                 |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Pattern SAST                                                                                              | `codeql.yml` (PR/push/weekly); Semgrep `p/nodejs`, `p/owasp-top-ten`, `p/r2c-security-audit` (`oursharedevents-ci.yml:260-270`)              | **PARTIAL** (§8: Semgrep gates, but CodeQL output is never read; `upload: never`, 44 results unread) | No                                                     |
| Committed secrets                                                                                         | detect-secrets 1.5.0 vs baseline, fails on NEW only (`oursharedevents-ci.yml:284-287`); gitleaks nightly (`security-monitoring.yml:173-255`) | DONE_IN_CODE                                                                                         | Partially (LLM notices hardcoded secrets; no baseline) |
| Dependencies                                                                                              | `npm audit` (`oursharedevents-ci.yml:294`); `dependency-review.yml`; SBOM + license (`advanced-security-scan.yml`)                           | **PARTIAL** (§8: 40 open dev-dep alerts; the gate is blind to dev deps)                              | Barely ("typosquatting" category)                      |
| DAST                                                                                                      | ZAP baseline on public surfaces (`dast-zap-baseline.yml`), honest-green, WARN non-gating by design                                           | DONE_IN_CODE                                                                                         | No                                                     |
| Adversarial vs deployed env                                                                               | T5 red-team Playwright vs staging (`red-team-adversarial.yml:53-59`)                                                                         | DONE_IN_CODE                                                                                         | No                                                     |
| Finding lifecycle                                                                                         | `security-triage.yml`, `security-human-gate.yml`, `security-sla-enforcement.yml`, `security-monitoring.yml`                                  | DONE_IN_CODE                                                                                         | No                                                     |
| **LLM diff review for security**                                                                          | `claude-review.yml` runs a **generic** review: no security prompt, `claude-sonnet-4-6`, advisory                                             | **PARTIAL**                                                                                          | **Yes: this is its whole purpose**                     |
| **Invariant-aware security review** (never-who, brand scoping, sponsor consent, two-DB, HMAC link tokens) | Guarded by born-red tests, but no reviewer reads new diffs against these rules                                                               | **NOT_STARTED** (as a review layer)                                                                  | Only with custom instructions                          |

**Net:** OSE has more coverage on every layer except one. The action's value is
exactly OSE's one PARTIAL/NOT_STARTED layer: pattern SAST cannot reason about
product-specific invariants, and an LLM given those invariants can.

## 3. The false-positive-filter conflict (must-know before adoption)

The action's **default** false-positive filter excludes: **DoS, rate limiting,
memory/CPU exhaustion, generic input validation, and open redirect.**

OSE treats several of these as first-class:

- **Open redirect**: listed in the Build Quality Bar (Dr-of-Security pass), and
  `/s/` shortlinks are a redirect surface by design.
- **Rate limiting**: public reads are rate-limited by default
  (`lib/public-read-limit.ts`, OSE-1247), admin paths too (`router.ts:494-501`),
  and the agentic-swarm threat model depends on it.

Adopted with defaults, the action would **silently suppress OSE's highest-priority
finding classes**. A custom `false-positive-filtering-instructions` file is a
precondition of adoption, not a nice-to-have.

## 4. Drift found during this pass

| #   | Where                                                                                                                                                                                                                     | Claim                                                 | Reality                                                                                                                                                                                                                                                                                                                                         | Verdict                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Root `CLAUDE.md` §3 BE ("Known gap: brand scoping is list-level only … object-level scoping tracked in OSE-1080") and §4 ("Multi-brand isolation … object-level (get/update) scoping is a known gap tracked in OSE-1080") | Object-level admin brand scoping is open              | Implemented: one router-level, fail-closed guard (`src/router.ts:503-520` → `src/lib/admin-object-scope.ts`); scoped miss returns 404, not 403; covers future `/api/v2/admin/events/:id/*` sub-routes. Born-red test `tests/admin-object-scope.invariant.spec.ts` (armed 2026-08-28) runs in the workers pool (not in `vitest.node-specs.mjs`). | **DRIFT**: brain is stale; OSE-1080 is DONE_IN_CODE for admin paths, and Linear already agrees (Done 2026-08-29, PR #420). Only `CLAUDE.md` lags. Public reads stay unscoped **by design** (`admin-object-scope.ts:40-43`). The real residual is **OSE-1088** (query-param `eventId` on flags read paths). |
| D2  | `codeql.yml:3,22,86`                                                                                                                                                                                                      | "Runs on self-hosted (Bloodraven)"                    | `runs-on: ubuntu-latest` (`codeql.yml:40`); Bloodraven retired 2026-09-02 (OSE-1194)                                                                                                                                                                                                                                                            | **DRIFT** (comment only)                                                                                                                                                                                                                                                                                   |
| D3  | `claude-review.yml:69`                                                                                                                                                                                                    | "faster on Bloodraven"                                | `runs-on: ubuntu-latest` (`claude-review.yml:34`)                                                                                                                                                                                                                                                                                               | **DRIFT** (comment only)                                                                                                                                                                                                                                                                                   |
| D4  | This session's first-pass recommendation                                                                                                                                                                                  | Listed OSE-1080 as "Critical #1: close before launch" | See D1: already closed                                                                                                                                                                                                                                                                                                                          | **Corrected here.** The error came from trusting the brain over the code.                                                                                                                                                                                                                                  |

D1 touches a governance artifact (`CLAUDE.md`), which by CCR v3.0 needs 5+
loops, so it is recorded here and **not** edited in this pass.

## 5. Recommendations: Critical vs Future

**Critical** means before the Oct 24 launch (Harbor County Bocce; fundraiser
posters). **Future** means post-launch hardening.

### Critical (pre-launch)

| #   | Action                                                                                                                                                                                                                                                                                                                                                             | Why now                                                                                                                                                           | Cost                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| C1  | **Add a security-focused prompt to the existing `claude-review.yml`** naming OSE's invariants: never-who / count floors / res-7 ceiling, admin brand scoping (keep the OSE-1080 router guard in front of any new admin object route), sponsor consent (`sponsor_accepted=1`), two-DB isolation, HMAC link `kind` + expiry, open redirect, rate limits, CSP nonces. | Launch week has the highest churn. It's the only layer where an invariant regression in a new diff is read by anything before merge.                              | A few lines of YAML; same key, same action, no new dependency. |
| C2  | **Run the local `/security-review` on launch-critical PRs** as part of the Dr-of-Security CCR pass.                                                                                                                                                                                                                                                                | An AI diff pass with no infra change.                                                                                                                             | Zero infra.                                                    |
| C3  | **Reconcile brain drift D1** (OSE-1080 → DONE_IN_CODE in root `CLAUDE.md` §3/§4; Linear is already Done), via a CCR'd brain PR.                                                                                                                                                                                                                                    | Two brands going live on one platform: operators and future sessions must know the wall exists and **where** (router guard), so new admin routes don't bypass it. | Doc-only PR.                                                   |

### Future (post-launch)

| #   | Action                                                                                                                          | Notes                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Add `anthropics/claude-code-security-review` as a **separate job**                                                              | SHA-pinned (never `@main`); reuse the trusted-actor gate; `comment-pr: true`; advisory first.                                                             |
| F2  | Author `false-positive-filtering-instructions`                                                                                  | **Required** for F1 (see §3): re-admit open redirect, rate-limit, and DoS; suppress known-deliberate items (e.g. `style-src 'unsafe-inline'` → OSE-1391). |
| F3  | Author `custom-security-scan-instructions`                                                                                      | Same invariant list as C1, extracted into one file.                                                                                                       |
| F4  | Single source of rules: copy the action's `security-review.md` into `.claude/commands/` and point F3 and C1 at the same content | Prevents drift between CI, the local command, and CCR (infra-wide-by-default rule: consider hoisting to the hub).                                         |
| F5  | Calibrate, then promote to blocking via `findings-count`                                                                        | Same honest-green path ZAP took: measure the false-positive rate first.                                                                                   |
| F6  | Clean comment drift D2/D3                                                                                                       | Trivial; batch with any CI touch.                                                                                                                         |
| F7  | Leave CodeQL, Semgrep, detect-secrets, ZAP, and red-team unchanged                                                              | They cover layers the action does not.                                                                                                                    |

## 6. Linear stories (created 2026-09-29, project "Security Hardening [HIGH]")

Pre-existing coverage was checked first so nothing is duplicated. **OSE-988** (Stage 2) already carries
"S2.6: install claude-code-security-review", so the future stories are its children. **OSE-624**
(independent security review of material diffs) is the charter they serve.

| Rec   | Linear                                                        | Priority | Title                                                        | Relations                                           |
| ----- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------ | --------------------------------------------------- |
| C1    | [OSE-1400](https://linear.app/oursharedevents/issue/OSE-1400) | High     | Security charter prompt in `claude-review.yml`               | related OSE-1202, OSE-624, OSE-988                  |
| C2    | [OSE-1401](https://linear.app/oursharedevents/issue/OSE-1401) | High     | Run `/security-review` on launch-critical PRs through Oct 24 | related OSE-624, OSE-1175                           |
| C3    | [OSE-1402](https://linear.app/oursharedevents/issue/OSE-1402) | High     | Brain drift: CLAUDE.md OSE-1080 stale                        | related OSE-1080, OSE-1088                          |
| F2    | [OSE-1403](https://linear.app/oursharedevents/issue/OSE-1403) | Medium   | S2.6a: false-positive-filter instructions                    | child of OSE-988; related OSE-1125, OSE-261         |
| F3+F4 | [OSE-1404](https://linear.app/oursharedevents/issue/OSE-1404) | Medium   | S2.6b: custom scan instructions, single source               | child of OSE-988; related OSE-624                   |
| F1    | [OSE-1406](https://linear.app/oursharedevents/issue/OSE-1406) | Medium   | S2.6c: adopt the action as its own job                       | child of OSE-988; **blocked by OSE-1403, OSE-1404** |
| F5    | [OSE-1407](https://linear.app/oursharedevents/issue/OSE-1407) | Low      | S2.6d: calibrate, then block on `findings-count`             | child of OSE-988; **blocked by OSE-1406**           |
| F6    | [OSE-1405](https://linear.app/oursharedevents/issue/OSE-1405) | Low      | Stale Bloodraven comments                                    | related OSE-1194                                    |
| F7    | —                                                             | —        | No ticket: existing scanners unchanged                       | —                                                   |

Dependency chain: `OSE-1400 (prompt text) → OSE-1404 (single-source rules) + OSE-1403 (FP filter) → OSE-1406 (adopt) → OSE-1407 (block)`.

## 8. Addendum: Dependabot + CI/CD warning sweep (same day)

Triggered by GitHub's push banner ("40 vulnerabilities … 13 high, 27 moderate").
Sources: the Dependabot alerts API (`state=open`), plus annotations from **every job
in the latest `main` run of all 22 workflows** (95 annotations: 6 failure, 44
warning, 45 notice), plus logs of each red workflow. Scratch data is in the session
scratchpad, not the repo.

### 8.1 Dependabot: 40 open, no runtime exposure

- **All 40 are `scope: development`.** The Worker's runtime deps are only `h3-js`
  plus first-party `@ocr/*`, and nothing in `workers/oursharedevents/src` imports an
  alerted package. **Nothing alerted ships in the deployed Worker.**
- By lockfile: root 31 (12 high), worker 7 (1 high, `sharp`), `packages/flags` 1,
  `packages/data-provider` 1.
- High: `fast-uri` ×5, `nanoid` ×3, `axios`, `form-data`, `js-yaml` (direct),
  `@faker-js/faker`, `sharp`.
- **Still matters:** dev deps execute in CI with `CF_ACCESS_*`, `ADMIN_KEY`,
  `OCR_PROPAGATE_TOKEN` in env. This is a secret-exfiltration path.
- **Why it accumulates:** the gate is `npm audit --omit=dev --package-lock-only`, so
  dev alerts can never go red, and Dependabot's fix PRs hard-fail required checks
  (OSE-1396). → Snapshot posted to **OSE-790**; related to OSE-1396.

### 8.2 CI/CD: findings ranked

| #   | Finding                                                                                                                                                                                                                                                                                                                                   | Evidence                                               | Linear                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| W1  | **`ubuntu-latest` → Ubuntu 26 on Oct 19**, 5 days before launch; all workflows affected                                                                                                                                                                                                                                                   | 45 notices, 16 workflows (actions/runner-images#14748) | **OSE-1408** (Urgent, release-blocking, due 10-17) |
| W2  | **Overnight fat-finger fuzz has not run for 10+ nights**: startup error, `Cannot find package 'js-yaml'` loading `vitest.workers.config.mts`. Red every night 09-20→09-29, unwatched.                                                                                                                                                     | run 36575527384                                        | **OSE-1409** (High)                                |
| W3  | **CodeQL findings never read**: `upload: 'never'`, nothing parses the SARIF, green-with-findings never triggers triage. 44 results; 2 in live src: `data-subject.ts:76` ReDoS (admin-gated; regex runs before the length check) and `anonymous-id.ts:17` `Math.random` fallback (dead on Workers). The rest are `archive/`/tests/scripts. | SARIF of run 36601646461                               | **OSE-1410** (High); related OSE-1368              |
| W4  | **T3 Smoke (security) = 8/10 unconditional skips**: specs target the GAS-era `?page=admin`, which always skips as "CF Access protects admin". Plus "No test report files were found".                                                                                                                                                     | job 109526664748                                       | **OSE-1411** (Medium)                              |
| W5  | **Conformance Report red** (`OCR_PROPAGATE_TOKEN lacks write access` + "Conformance gaps detected")                                                                                                                                                                                                                                       | run 36601646536                                        | existing **OSE-1141** / OSE-1045                   |
| W6  | **CI Cost Collector red daily**: pushes to protected `main` (`GH006`)                                                                                                                                                                                                                                                                     | run 36561421077                                        | **OSE-1412** (Low)                                 |
| W7  | Node 20 action deprecation (~13), 10 broken doc links, 10 lint `console` warnings, empty artifact paths                                                                                                                                                                                                                                   | annotations                                            | **OSE-1412** (Low)                                 |

**Pattern across W2, W3, W4, W6:** a gate that is red or skipping for a long time
while nothing routes it to a human. `security-triage.yml` listens only to three
workflows, and green-with-findings (W3) or green-with-skips (W4) never trip it.
That is the common root cause.

**Decision note (not a finding):** `/q/` scans and form submits set a 1-year
`ose_anon` HttpOnly cookie (`lib/anonymous-id.ts`, `qr-scan.ts:193`). It is
deliberate (ADMIN-6) and well-tested for non-linkability (`anti-logging-proof`,
`forbidden-join-*` specs). Recorded because the brain's "no cookies" principle is
written about landing/public pages; confirm the scope covers `/q/` intentionally.

### 8.2b Found while implementing (same day)

| #   | Finding                                                                                                                                                                                                                                              | Evidence                                 | Handled in                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| W8  | **The Claude PR review has never run.** No `ANTHROPIC_API_KEY` means skip under a green check; no `prompt` means v1 does nothing on `pull_request`; `model`/`timeout_minutes` aren't v1 inputs. So §2's "generic review" was actually **no review**. | run 36621579937 log; pinned `action.yml` | PR #679 (part of OSE-1400); **owner must provision the key**                          |
| W9  | **`.github/codeql/codeql-config.yml` + 13 custom Cloudflare/D1 queries were never referenced** by any workflow; its `paths` named 3 dirs that no longer exist; even the config didn't include the custom pack                                        | grep of `.github/workflows`              | PR #678 (OSE-1410)                                                                    |
| W10 | **CodeQL is not a required status check** (required: S0, T0×5, Inv-22, gate reconciler), so the new CodeQL gate reports but cannot block                                                                                                             | branch protection API                    | **Owner: add `Analyze (javascript-typescript)` to required checks** after #678 merges |

Revised §2 row: **LLM diff review for security = NOT_STARTED** (not PARTIAL); the layer existed on paper only.

### 8.3 Critical vs Future (addendum)

- **Critical (pre-launch):** OSE-1408 (runner pin), OSE-1409 (fuzz not running), OSE-1410 (CodeQL unread + 2 src fixes)
- **Future:** OSE-1411, OSE-1412, OSE-790 drain via OSE-1396

## 9. Verdict

Neither is "better" in general. They are different layers. The public action is
a stronger **LLM diff reviewer** than OSE's current generic Claude review; OSE is
a far more complete **security program** than the action. The right move is to
adopt the action's layer with OSE's own invariants and filter policy, rather than
choosing one over the other.
