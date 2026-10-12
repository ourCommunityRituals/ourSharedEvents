# Proposal: governance-file wording after the 2026-10-12 hardening

Status: **proposal for the PO. No governance file is changed by this document.**
Source: CCR worksheet `CCR-AGENT-WORKSTATION-HARDENING-2026-10-12.md`, finding F12 (and the
fail-open wording the loop-4 review made out of date).

Governance artifacts need the CCR protocol's 5+ loop human gate (protocol §4). This file lists
the exact lines, why each is no longer true as written, and a replacement for the owner to
accept, edit or reject. Each item says whether it is true **today** and what makes it true.

## What is true on `main` today (read 2026-10-12)

| Fact                                                                                                                                                    | Evidence                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `main` requires 10 status checks and applies them to admins                                                                                             | `tools/ci/main-branch-protection.json`: `required_status_checks` (10), `enforce_admins: true` |
| `main` does **not** require a pull-request review, and so no code-owner review                                                                          | same file: `"required_pull_request_reviews": null`                                            |
| CODEOWNERS names a real account (`@bereasonable13`)                                                                                                     | #948; the drift workflow now fails if an owner does not resolve                               |
| The hook reads commands as a shell does and refuses when it cannot finish                                                                               | #950; `.claude/hooks/README.md`                                                               |
| The hook still allows when its input is unparseable or its script is missing, and it is not installed anywhere until the owner runs `apply-workstation` | `policy-gate.mjs` main(); runbook step 3                                                      |

So "CODEOWNERS-locked" and "CODEOWNERS enforces review" are **claims about a review that GitHub
is not asked to require**. A code-owner line only holds once `required_pull_request_reviews`
has `require_code_owner_reviews: true` (runbook step 6; the JSON is the source of truth and
`scripts/apply-branch-protection.mjs` applies it).

## Proposed changes

### 1. `AGENTS.md` line 17

> Before: `… (dormant, CODEOWNERS-locked). Gate: …`
>
> After: `… (dormant; listed in CODEOWNERS, which blocks a merge only once code-owner review is
required on main). Gate: …`

Why: the gate named (`runtime-llm-free.invariant.spec.ts`) is the lock that holds today. The
CODEOWNERS entry adds review only after step 6.

### 2. `AGENTS.md` line 64

> Before: `… blocks most of it where the owner has installed it (it matches command text and fails
open).`
>
> After: `… blocks most of it where the owner has installed it. It reads command text the way a
shell does and refuses a command it cannot finish analysing; it is still text analysis, so it
does not stop a program that makes its own network or file calls, and it allows when its own
input is unreadable. It is a speed bump with an audit trail, not a lock.`

Why: "fails open" was true of the first version and is only partly true now; the new sentence says
which half. Without the second half the line over-promises.

### 3. `CLAUDE.md` line 38 (repo root, "Guardrails on this machine")

> Before: `… blocks deploys, production changes, secret writes, force pushes, admin merges and
credential reads. The owner installs it (.claude/hooks/README.md). Agents cannot change their
own settings; auto mode refuses it.`
>
> After: `… blocks deploys, production changes, secret writes, force pushes, admin merges, tag
pushes and credential reads, where the owner has installed it (.claude/hooks/README.md;
check with scripts/hardening/verify-hardening.mjs). It is a speed bump with an audit trail.
The controls that hold are on GitHub: the tag ruleset, required reviews and a production
reviewer, which exist only after the owner applies them. Agents do not change their own
settings.`

Why: "Agents cannot change their own settings" is a property of the harness plus the hook's
`self-config` rule; stating it as a fact about "auto mode" is not something this repo can test.

### 4. `workers/oursharedevents/CLAUDE.md` line 50

> Before: `… reviewed before any wiring (COST-102, ADR-014, CODEOWNERS-locked).`
>
> After: `… reviewed before any wiring (COST-102, ADR-014; the CODEOWNERS entry requires review
once code-owner review is required on main).`

### 5. `workers/oursharedevents/tests/fixtures/threat-ledger.ts` line 365 and `docs/security/threat-ledger.yaml` line 184 (TL-015)

> Before: `test_ref: 'CI gate: workflow files pinned to SHA; CODEOWNERS enforces review'`
>
> After: `test_ref: 'CI gate: workflow files pinned to SHA; CODEOWNERS names the reviewer (a
merge is blocked only once code-owner review is required on main)'`

Why: the TL-015 row's `notes` already says GitHub's own behaviour (the base branch's workflow
runs on `pull_request`) is the defence; the `test_ref` is the part that over-claims.
**Ripple:** `CONFORMANCE.md` and `conformance.json` are generated from the ledger (`generate-
conformance-report.ts`, `tests/unit/conformance-generator.test.ts`), so the change needs a
regeneration in the same PR and the generator's own gate run. It is a text change to one
string and should not alter counts.

## Not proposed

- No change to the status of TL-014 / TL-015 (`accepted`). They are accepted risks and remain so;
  step 6 is what would let them be re-assessed.
- No claim that required reviews are on. They are not.

## How to accept

Tell me which items (1 to 5) to apply, or edit this file. I would apply them in one pull
request, regenerate the conformance outputs, run the architecture gates (`0-architecture`,
line-keyed INV9 exemptions) and the conformance generator test locally, and then put it through
the protocol's review loops before it is merged.
