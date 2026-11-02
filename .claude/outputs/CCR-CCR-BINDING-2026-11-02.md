---
ccr: 1
class: governance
requested_loops: 5
loops_run: 5
team: extended
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 0, critical: 3, high: 3, medium: 6, low: 2 }
---

# CCR worksheet: making CCR binding

Subject, frozen by SHA-256 before loop 1 and re-checked between every loop: `scripts/ci/ccr-worksheet-check.mjs`, `scripts/ci/ccr-worksheet-baseline.json`, `tests/integration/ccr-worksheet-check.test.js`, `.claude/outputs/PROPOSAL-ccr-binding-skill-text-2026-11-01.md`. All untracked, on branch `language-path-prefix`. Full run record: `.claude/outputs/RUN-RECORD-ccr-binding-2026-11-02.md`.

## Verdict

|                            |                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cumulative score           | **0%**. Under 95% on every counting method the team tried.                                                                                                                                                                                                                                                                                                      |
| Distinct defects           | 14 in the subject (3 Critical, 3 High, 6 Medium, 2 Low), from 84 raw findings across five loops. None Security Critical, none Regulatory.                                                                                                                                                                                                                       |
| Raw arithmetic             | Flat weights: 45 + 30 + 30 + 4 = 109, so 100 - 109 = -9, shown as 0. Group method (one charge per fixing change, max weight plus a quarter of the rest): 305.25 for the subject, 351.5 with repo posture, also 0.                                                                                                                                               |
| Confidence it is under 95% | 93-99% across the ten lenses. About 60-70% on any single severity.                                                                                                                                                                                                                                                                                              |
| Gate                       | **Stop.** The team has a solution, but its main steps are yours.                                                                                                                                                                                                                                                                                                |
| What "binding" means here  | A real block needs three things: a worksheet exists for the change, the check runs from the base branch so a PR cannot edit its judge, and approval comes from an identity the agent cannot use. Agents cannot deliver that. What agents can deliver is a **tripwire**: a skipped or malformed CCR becomes visible, and a determined author can still forge it. |

Read first: this Verdict, then Human gate, then Solutioning, then C1-C3 and H2 in the register.

## What was reviewed

The four subject files above, against the owner's rulings, `ccr/SKILL.md`, `ccr-protocol.md`, `ccr-template.md`, AGENTS.md, CLAUDE.md, the CI workflow, branch protection (read-only `gh` GETs), the hardening doc, the threat ledger, and the OCR-docs `ccr` skill.

Out of scope: the content of the 33 older worksheets; Linear (not readable here); anything that writes to GitHub.

The owner's rulings for this run, verbatim: "if 3 loops are specified, then all 3 loops are executed with cumulative score after 3 loops taking all into account. If under 95%, then the team needs to figure out solutioning to meet the 95% threshold. The point is not execute loop 1 and make actions, then loop 2." / "This is why it is critical, conservative, recursive loop to keep what ever is being assessed honest from each pov" / "Run loop as critical run, Run loop 2 as conservative, Run loop 3 as recursive, take all three results from a cumulative." / "if the results are under 95, create solutioning with the scrum team to meet the CCR 95%" / "Moving forward, make it a min of 5 loops" / "loop 3 in adversarial, loop 4 compliance, and loop 5 is recursive."

## Loop 1

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Critical layer: what is true versus assumed. The most dangerous assumption was that a CI check on the worksheet makes CCR binding. True: the gate runs inside the required T0 Gate (tests). Assumed and false: that it can see a skipped CCR, or tell a true worksheet from a self-consistent one. Its own findings alone exceed 100 points.

Score: 0%

## Loop 2

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Conservative layer: assume the worst. The least the gate guarantees is that ccr-named files under `.claude/outputs` are baselined or self-consistent. The worst realistic outcome is false assurance: a green read as "CCR happened". Its own findings alone exceed 100 points.

Score: 0%

## Loop 3

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Adversarial layer: every attack aimed at the gate succeeded on scratch copies. A one-line AGENTS.md edit with no worksheet is green. A fake worksheet with a "GO 97%" banner and invented run ids is green. One line in `vitest.config.ts` turns the gate off. A 30-byte checker diff passes all tests. The candidate fixes were attacked too; only a base-branch check plus an approval identity the agent cannot use survived.

Score: 0%

## Loop 4

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Compliance layer: rule by rule. Passes: governed files untouched, both owner options honoured, production hold untouched, size budgets, secrets, no repository control changed. Fails: born red, a named CI job, the human gate after every loop (rewritten in the proposal), an attributable record, and the repo's own ratchet rule.

Score: 0%

## Loop 5

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Recursive layer: was the assessment honest? Severity was inflated by counting one defect many times; 84 raw findings merge to 14. Several earlier claims were withdrawn or corrected (below). Repo posture was split out from subject defects. The direction held on every method.

Score: 0%

## Findings register

Basis: **P** proven by a command, **T** text comparison, **I** inferred from source. Raw ids are in the run record.

| #   | Sev      | Finding                                                                                                                                                                                                                            | Raw ids                                                       | Basis |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----- |
| C1  | Critical | Nothing ties a change to a worksheet, and discovery is by file name only. No worksheet, or one under another name, is green.                                                                                                       | L1-01, L1-11, L2-10, L2-15, L3-01                             | P     |
| C2  | Critical | Every input is self-declared: form is checked, truth is not. `lite`, `base`, counts of 0, a forged date and a fake banner all pass.                                                                                                | L1-02, L1-03, L2-01, L2-06, L2-16, L2-18, L3-02, L3-03, L3-04 | P     |
| C3  | Critical | The gate can be edited or switched off by the PR it judges: one vitest exclude, a small checker diff, `test.fails`.                                                                                                                | L1-06, L3-05, L3-06, L4-09                                    | P     |
| H1  | High     | No honest outcome: a stop blocks nothing, a clean 97/96/97 run is rejected, and "ok, validated" reads as approval.                                                                                                                 | L1-05, L1-17, L2-02, L2-03, L2-07, L2-29                      | P     |
| H2  | High     | The proposal writes the lead's readings as owner rulings: "human gate every loop" becomes "owner ratifies"; the 5-loop floor keys on a self-declared class, not the file touched; "a stop is only for what the team cannot close". | L3-07, L4-01                                                  | T     |
| H3  | High     | Test evidence is weak: mutants survive, `test.fails` and `skipIf` are not ratcheted, no CI job names the gate.                                                                                                                     | L1-15, L1-16, L2-20, L2-30, L4-07                             | P     |
| M1  | Medium   | Baseline: three names are untracked (a clean checkout is red), matching is by name only, and it is a second mechanism with no base-branch comparison.                                                                              | L1-07, L1-08, L1-14, L2-09, L2-23, L4-08                      | P     |
| M2  | Medium   | Text drift: SKILL.md, the template, the protocol and the OCR-docs fork disagree; the extended team is defined three ways.                                                                                                          | L1-09, L1-13, L1-18, L2-14, L4-12, L4-13                      | T     |
| M3  | Medium   | Score semantics: no defined cumulative, no evidence state per finding, no base items or 70% cap, a clamp that hides distance.                                                                                                      | L1-10, L1-19, L2-17, L2-27, L4-11, L4-14                      | I     |
| M4  | Medium   | Parser and reader disagree, and inputs can stall it: YAML alias expansion (about 4.5x per level), quadratic fence stripping, look-alike labels, `loops_run: 1e9`.                                                                  | L2-25, L3-08, L3-09, L3-15                                    | P     |
| M5  | Medium   | Rollout: no warn mode, the in-flight OSE-1766 epic and docs branches go red, a strict-off merge race, no rollback plan.                                                                                                            | L2-08, L2-12, L2-21, L2-22, L3-11                             | I     |
| M6  | Medium   | An honest per-lens score line reds a loop; the Team line rules contradict "list only the lenses that ran".                                                                                                                         | L2-19, L1-18                                                  | P     |
| L1  | Low      | No Linear story or CI/CD testing ticket; Done is unreachable.                                                                                                                                                                      | L1-12, L4-15                                                  | I     |
| L2  | Low      | Raw stack traces, a misleading message for UTF-16 files, worksheet names off-pattern.                                                                                                                                              | L2-31, L4-16                                                  | P     |

Repo posture, not charged to the subject: the policy-gate hook is not installed on this machine (L3-12, L4-10, verified by the lead); the agent runs as the sole admin and recent PRs merged with no review (L3-13, L4-04; one GitHub endpoint says 1 approval required, the declared config says none, and only a write test would settle it); the Done path is not tied to a worksheet (L3-14). Contested and not charged: SOC 2 obligations (L4-02, L4-06), Invariant 24 (L4-05 withdrawn).

Withdrawn or corrected during the run: L1-04 (protocol-legal), L2-02 and L2-04 as first stated, L2-13 (a script revert is not governed), L2-14 propagation (OCR-docs' skill is not propagated), L3-10 (a proposed attack; no such ignore rule exists), L4-05, L4-08's premise (the existing ratchet cannot hold this without new code), "main is red" (the newest main push is green, run 41401623413), the interim 31-40% (its merge rule could be gamed).

## What must be true before shipping

- The owner chooses an option below and rules on the owner questions.
- If the tripwire ships: SKILL.md, the template and the checker land together; the checker starts warn-only; every output line says "tripwire" or "form check", never "binding".
- The three untracked epic worksheets are committed or dropped from the baseline.
- A Linear story and CI/CD testing ticket; the PR from a fresh branch off `main` says `Part of OSE-###`.
- After the solution lands: a fresh five-loop run on the new commit, recorded in a new worksheet. This one is never edited.

## Verification after shipping

- The named CI job appears on a PR, runs the base branch's checker against the head, and goes red on a planted bad worksheet.
- A PR that edits the checker or the vitest config cannot turn the job green.
- If the owner steps are done: `gh api user` shows the agent's non-admin account; a planted `wrangler secret:bulk` command is refused by the hook; an agent-opened PR shows as blocked until the owner approves.

## Risks accepted

None. 95% is reachable only if the owner accepts, by name, two risks no checker can close: a self-written worksheet can be forged, and its content cannot be verified by code.

## Solutioning

Estimates from the team, inferred until a fresh run proves them:

| Path                                                     | Reaches                     |
| -------------------------------------------------------- | --------------------------- |
| Team work only                                           | about 40-55% on the subject |
| Team work plus the owner steps                           | about 70-80%                |
| Plus the owner's named acceptance of the two risks above | 95% possible                |

Options (Product Owner):

1. **Tripwire now** (recommended). Slim the checker to one question: does a change to governed files carry a worksheet tied to its PR and head commit? A named CI job runs the base branch's checker against the head. Warn-only first. Score recomputed from a findings register, not typed. About a day of team work plus about 30 minutes of owner review. Delivers visibility, not a block.
2. **Real block later** (after launch). Adds a non-admin agent identity, owner approval, and the job as a required check. Needs the owner's steps below.
3. **Rules only.** Delete the checker and keep the written protocol. Costs nothing and delivers nothing detectable.

Cut, do not fix: the per-loop arithmetic and layer regexes, the seven section regexes, the name-list baseline (use a date cutoff), the class and `owner_ratified` self-declarations, the fence and alias handling (use JSON).

Owner steps, in order, in your own terminal (DevOps, from the hardening doc; each has a verify and a back-out in the run record): (1) save a `verify-hardening` baseline; (2) install the policy-gate hook; (3) give the agent its own non-admin GitHub account and sign the admin token out of `gh`; (4) only then, turn on required review with code owners; (5) the tag ruleset and production gate.

Team stories, one per session (Scrum Master): (1) Linear epic, story and CI/CD ticket; (2) tie a change to its worksheet by content, not name; (3) score from a findings register with honest outcome states; (4) the named job, run from the base branch; (5) kill the mutants and harden the parser; (6) align SKILL.md, the template and the team definition; (7) ratchet the gate's tests; (8) wire the approval identity, owner only. Each lands as a PR. Then a fresh five-loop run.

Rule for the cumulative, for SKILL.md (Data Scientist): take the union of every loop's findings; drop withdrawn ones; charge each root cause once, at its highest weight plus a quarter of the rest, capped at twice the highest; mark each finding proven (a command ran and its output is recorded) or inferred; a fix counts only if proven; show the raw score beside the clamped one.

Deviations of this run (Scrum Master): no human gate between loops, which AGENTS.md requires for governance changes and which the owner has not explicitly waived; a first pass (`SUPERSEDED-ccr-binding-first-pass-2026-11-01.md`) and an interim Recursive pass ran outside the five loops and fed them; the record lived in a temp scratchpad until it was copied beside this worksheet; one test failure ("team is red") was seen once and is still unexplained; after loop 5, the checker was changed to accept the two loop orders the owner ruled, so that this worksheet could carry its real layers.

## Human gate

1. Which option do you want: a tripwire now and a real block later, a tripwire only, or rules only?
2. For governance changes, does "a human gate after every loop" stay, or does your run model replace it with a single owner sign-off at the end?
3. Will you do the owner steps (hook, then a non-admin agent account, then required review), and in that order?
4. Do you accept, by name, that a self-written worksheet can be forged and its content cannot be checked by code, which is what 95% would need?
5. Should the 5-loop minimum key on the files a change touches (AGENTS.md, CLAUDE.md, the protocol) or on the class the author declares, and does it cover every class?
6. Should the CCR rules be changed in OCR-docs first, or in OSE first?
7. May I open the Linear story and its CI/CD ticket and start a fresh branch off `main` for story 1?
