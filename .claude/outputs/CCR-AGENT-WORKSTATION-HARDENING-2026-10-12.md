# CCR: agent workstation and GitHub deploy-path hardening (2026-10-12)

Protocol: `.claude/skills/ccr-protocol.md` v3.0, extended scrum team. Subject: PRs #948 (merged
before this CCR finished) and #950 (follow-up, open). Author of the change and of this worksheet:
the same agent session; the reviews below were done by separate, briefed-only subagents.

## Verdict

|                           |                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate result**           | **STOP: does not clear 95%. Human gate open.**                                                                                                                                                                                                                    |
| **System score**          | **45%** after the loop-4 corrections. It was 0% (Security Critical floor) at the end of loops 2, 3 and 4 before correction.                                                                                                                                       |
| **Assessment confidence** | about 60%. Every independent round found something the author's own tests had not; the last found a fail-open and a regression. The final corrections were checked against the reviewers' own corpora and the suite, not re-reviewed by a fifth independent pass. |
| **Trend**                 | L1 ~75% (estimate) → L2 0% → L3 0% → L4 0% → corrected 45%. Confidence did not stabilise, which is the protocol's cue to stop and surface, not to loop again.                                                                                                     |
| **Not in this score**     | whether the live harness honours the hook (born-red check is an owner step), and the GitHub-side controls, which are owner steps.                                                                                                                                 |

A CCR score is a signal, never permission. Merging #950 and the owner steps still go through
required checks and the PO.

## Classification and scope

- **Class:** security change that touches a guard and a review lock, and edits ADRs: 4 loops, no
  Lite. Governance artifacts (AGENTS.md, CLAUDE.md, CONFORMANCE.md) were **not** edited, by
  protocol §4; claims in them are listed as a human-gate item.
- **Environment modifier:** 1.0. Workstation and CI tooling; no production runtime or PII path
  changes. The thing it protects is production.
- **Variable set:** Security Review, extended with: gate efficacy, fail-closed behaviour, guard
  self-protection, documentation truth.
- **In scope:** `.claude/hooks/policy-gate.mjs` and suite, `scripts/hardening/*`, CODEOWNERS,
  drift workflow, `apply-branch-protection.mjs`, runbook, ADR notes.
- **Out of scope:** the Worker runtime, claude.ai connector scopes, Chrome profile contents,
  Cloudflare token scopes, the live Claude Code harness.

## Team lenses

| Role                              | Contribution                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dr of Security                    | Three independent adversarial passes (loops 2, 3, 4); about 1,400 hook probes in total; found the CI-red wiring test, the TEMP guard bypass, the regression, and the fail-open.                                                                                                                                                           |
| Sr SDET/SRE + Sr Automation QA    | 105 invented mutants against the first rules (45 survived, now killed or covered); false-positive hunt; found the Linux path case, the reporter dependence, the untested GitHub plane.                                                                                                                                                    |
| DevOps Mgr + Lead BE              | Traced tag, dispatch and environment paths; found that the first ruleset would break tag releases, that moving secrets would break CI, that the drift check was blind to reviews, and the doc claims that were false.                                                                                                                     |
| Sr Data Scientist                 | The grade is a count of failed controls, not a measurement. Treat the reviewer corpus as an adversary's wish list, not ground truth (a third of its "must block" lines are default-deny preferences such as `npm run lint`). After install, the hook's audit log is the only real measure: block and allow rates, false-positive reports. |
| PO                                | Decisions needed are in the human gate.                                                                                                                                                                                                                                                                                                   |
| Lead FE Integration, Sr Design FE | Not applicable: no UI, no Worker, no token or template change.                                                                                                                                                                                                                                                                            |

## Loops

### Loop 1: surface pass

- **Critical:** the hook's 72 tests were not run by any workflow, so the guard could be weakened
  with every required check green. (High.)
- **Conservative:** assume the first rules are porous. They were.
- **Recursive:** ~75% (estimated: one High, base items partial). Correction: a vitest wrapper in
  the `root-vitest` job, red against a mutant hook, green against the real one.

### Loop 2: pressure pass (three independent reviewers)

- Security Critical: the new wrapper was **red in CI** (Node 22 prints TAP; it matched the spec
  reporter), so the claim "the gate's tests run in CI" was untrue; the owner-terminal guard was
  defeated by setting `TEMP`; production deploy, self-approval, ruleset deletion and GraphQL
  ref creation exited 0 at the hook.
- Critical: tag pushes by quoting, glob, variable, alias, `--mirror`; MCP tools ungated; a one-line
  kill switch for the installed hook.
- High/Medium: egress forms, token reads, self-config, forgeable W1/W6, redaction gaps, floor
  padding; DevOps: A and B break the documented tag release path, step 6 breaks CI, the drift
  check cannot see reviews, stale handles and false claims in docs.
- **Score:** 0% (Security Critical floor). Corrections: explicit reporter, no environment
  exemption, rule additions, tokenizer-free parsing, ruleset with an admin-role bypass, custom
  deploy refs, review rules in the drift check, owners-resolve check, runbook rewritten.

### Loop 3: confirmation pass (fresh reviewer)

- **Security Critical, a regression:** the rewrite that matched the command word per segment was
  weaker than the original hook for `bash -c`, `env`, `sudo`, `timeout`, `cmd /c`, `eval`, `iex`,
  `&`, parentheses, `if … then` and heredoc tails.
- Critical: the S1-style credential reads still worked (`cd ~/.claude && cat config.json`,
  `./`, `//`, globs, `tar`, `find -exec`); tag paths through `--follow`, `push.followTags`,
  `--file .git/config`, `GIT_CONFIG_*`; `gh` statuses/approve/merge/PATCH.
- **Score:** 0%. A drop is the protocol working. Correction: a real tokenizer, units, unwrap,
  `cd` tracking, canonical paths, 399-case suite including the reviewer's corpus.

### Loop 4: final confirmation (fresh reviewer)

- Verdict "not ready", 5% confidence. **Security Critical:** the hook failed open on timeout,
  crash, size and depth (a UNC path made it wait 21 s on SMB); shells fed by pipe or here-string
  were unread; unquoted backslash, brace and `$'…'` forms were not interpreted.
- Critical/High: glob refspecs, exported `GIT_CONFIG_*`, glued `gh` flags, GraphQL verb and
  mutation names, `mv` sources, program-position paths, unlisted-TLD egress, unknown wrappers,
  PowerShell script blocks and backticks, interpreter shell-outs, connector MCP tools.
- **Score:** 0%. Corrections applied and verified: fail-closed analysis (size, depth, units, 3 s,
  exception), no network I/O for UNC, pipe/here-string/heredoc-in-eval, escapes/braces/IFS,
  program-word paths, `mv`/`find -delete`/`perl -i`, `gh` flag normalisation, `git-env`,
  `pipe-to-shell`, `gh-foreign-repo`, MCP code-execution tools, the `applyTo` capability, verifier
  overrides, ratchet that ignores comments.

## Evidence for the corrected state

| Claim                                                 | Evidence                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The suite passes and gates CI                         | 487 cases; `tests/integration/policy-gate-wired.test.js` runs it in `root-vitest` with an explicit reporter; red against a mutant hook                                |
| Rules cannot be weakened quietly                      | `policy-gate.cases.lock.json` (43 rules, 487 tests); the wrapper fails if a rule has fewer cases than locked; comments do not count                                   |
| The loop-4 report's named structural items are closed | `l4/r4.txt`: 80 of 80 behave as labelled (scratchpad corpus; 74 must-block and 6 must-allow cases are now in the suite)                                               |
| Fail-closed                                           | tests: 1.6 M-character command, 12 nested `eval`, 3,000 `env` wrappers, a UNC path in under 3 s, non-string input; the report's DoS probes finish in about 100 ms     |
| Mutation                                              | 9 + 18 + 18 planted faults across three rounds, each turned a test red (round 3 anchors that no longer exist are noted below)                                         |
| Related gates                                         | 21 files, 568 tests across `pr-risk`, runbook, ai-seam, `tests/unit/ci`, infra-consistency, the hardening scripts; ESLint and Prettier clean                          |
| Linux                                                 | the one Linux-only failure (a `\\?\` path resolved against the working directory) is fixed and was reproduced by simulation; the new head has not yet run on Linux CI |

## Findings register and arithmetic

`Score = 100 − Σ(base × state × loop position)`; states: Verified 0, Partial ×0.5, Unverified ×1.
Security Critical has no partial credit and none is open if #950's CI is green.

| ID    | Finding                                                                                                                                                                                                                                                                       | Sev                  | Found | State at close                                             | Deduction            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----- | ---------------------------------------------------------- | -------------------- |
| F1–F7 | Wiring, CI-red wrapper, TEMP guard, rule bypasses, regression, fail-open, stdin shells and escapes                                                                                                                                                                            | SC / Critical / High | L1–L4 | **Verified closed** (evidence above)                       | 0                    |
| F8    | Text analysis is not complete: 312 of the reviewer's 1,122 labelled lines are on the wrong side (310 "should block" pass, 2 false positives). About half are default-deny preferences for `npx`, `npm`, `gh`; the rest are exotic .NET/COM, `git bundle`/`archive`, env forms | High                 | L4    | Partial: bounded and documented, not closeable by patterns | 10 × 0.5 × 1.5 = 7.5 |
| F9    | GitHub-side controls not applied: `main` has no required reviews, no tag ruleset, `production` has no reviewer, deploy secrets are repository-level, agents run as the admin account                                                                                          | High                 | L2    | Open: owner steps, not code                                | 10 × 1.0 = 10        |
| F10   | Outbound connector tools (Gmail, Drive, Notion, Shopify, LegalZoom) and WebFetch are not gated by the hook                                                                                                                                                                    | Medium               | L2    | Open: per-session scoping                                  | 5 × 1.25 = 6.25      |
| F11   | Verifier can be pointed at fake state by file, PATH or env writes (banners and exit 3 added; W1 compares to `origin/main`; W6 needs a block record)                                                                                                                           | Medium               | L2–L4 | Partial                                                    | 5 × 0.5 × 1.5 = 3.75 |
| F12   | Governance files (AGENTS.md, CLAUDE.md, CONFORMANCE.md, threat-ledger.ts) say CODEOWNERS "locks"/"enforces"; true only after required code-owner review                                                                                                                       | Medium               | L2    | Open: human gate (protocol §4)                             | 5 × 1.0 = 5          |
| F13   | Environmental assumption: the live harness honours exit 2, the `mcp__.*` matcher and the 10 s timeout                                                                                                                                                                         | Base                 | L1    | Partial: owner's born-red check                            | 15 × 0.5 = 7.5       |
| F14   | #948 merged before loop 4: `main` carries the regressed first version until #950 merges                                                                                                                                                                                       | Medium               | L4    | Open                                                       | 5 × 1.5 = 7.5        |
| B2    | Full surface mapped: MCP and connectors beyond the named tools, WebFetch                                                                                                                                                                                                      | Base                 | L2    | Partial                                                    | 15 × 0.5 = 7.5       |
|       |                                                                                                                                                                                                                                                                               |                      |       | **Total**                                                  | **55**               |

**Score = 100 − 55 = 45%.** If #950's CI is red on a Security Critical, the score is 0%.

## What must be true before this ships

1. #950 merged (`main` should not stay on the hook the loop-3 review showed is weaker than the
   original), with its CI green on Linux.
2. Owner installs the hook (`apply-workstation`), starts a new session, runs the `wrangler
secret:bulk` refusal check, and `verify-hardening` W1–W6 pass: this is the only evidence for F13.
3. Owner steps 4–6 in `docs/security/AGENT-WORKSTATION-HARDENING.md` (tag ruleset, production
   reviewer, a non-admin agent identity, then required reviews). Until step 5, every GitHub
   control is advisory because the agent is the admin account.
4. A decision on F8 and F12 (human-gate questions below).

**Commit sequence:** #948 (merged) → #950 (tokenizer, fail-closed, ratchet, structural fixes, this
worksheet) → owner steps (no commits) → a governance-files PR after review loops.

**Verification after shipping:** `verify-hardening` on the owner's machine; after 14 days, the
audit log (`~/.claude/audit`) read for block rate, rule distribution and false positives; a fresh
independent review of whatever F8 decision is taken.

## Risks accepted (pending the gate)

- The hook is a speed bump with an audit trail, not a lock: it does not stop a program that makes
  its own network or file calls (`node deploy.js`), a command assembled at run time, or edits to
  its own repo copy through Edit/Write (review and `pr-risk` are the control).
- `gh pr merge` (non-admin, non-auto) stays allowed: merging one's own PR after checks is normal
  work; only GitHub-side reviews stop it.
- `Bash(npm:*)` stays allowed.

## Human-gate questions

1. **Strategy for F8.** Four rounds each produced hundreds of new variants. Do you want to
   (a) stop adding patterns and treat the hook as a speed bump plus audit, putting effort into the
   GitHub-side controls; or (b) move the shell to a default-deny posture (an allowlist of known
   commands, or a container/WSL session with no credentials)? The reviewer's own labelling
   favours (b). Recommendation: (a) now, scope (b) as a separate story.
2. **Second GitHub identity.** Will you create the agent account and token (step 5)? Nothing on the
   GitHub side is effective without it.
3. **F12.** Which of AGENTS.md, CLAUDE.md, CONFORMANCE.md and threat-ledger.ts do you want edited,
   and are you available for the 5+ loops protocol §4 requires?
4. **Merge #950 now?** It is a larger rewrite of one file than most reviewers will read in one
   sitting; the suite is the specification. Do you want a human read of the rule list first?
5. **Outbound connector tools (F10).** Block Gmail send/forward and Drive share in the hook, or
   scope them per session (step 9)?

## Limits of this worksheet

- Mutation round 3 had two anchors that no longer exist after the tokenizer rewrite
  ("wrappers not unwrapped", "encoded command allowed"). **Update, same day, after merge:** both
  were re-planted against the merged hook, plus "eval / iex not unwrapped"; all three turn the
  suite red (15, 2 and 4 failing cases). No survivor is open from the three rounds.
- The reviewer corpus is adversarial and partly opinionated; 312 unexpected is not a defect count.
- No required check on `main` reviews the hook's rule list; the lock file makes weakening a visible
  diff line, not a blocked merge.
