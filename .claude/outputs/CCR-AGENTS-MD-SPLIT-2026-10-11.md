# CCR: AGENTS.md split (PR #939)

**Date:** 2026-10-11 · **Protocol:** CCR v3, governance class (5+ loops, human gate every loop) · **Level:** Product (OSE), with knock-on effects on the hub checked
**Under review:** branch `chore/claude-operating-contract`, which replaces the 89 KB root `CLAUDE.md` with `AGENTS.md` + a slim `CLAUDE.md` + `docs/brain/`, adds the CCR skill, the extended-team agents and a size gate.
**Why it matters:** every agent reads these files on every turn. Lose a rule and an agent can break an invariant; keep the bloat and every turn re-reads 89 KB.
**Out of scope:** the hub repo (drift-auditor follow-up), other product repos, propagated `.ocr-standards/`.
**Approver:** Matthew Zdano (PO).

## Verdict

| Measure               | Result                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| System score          | **84%**: no Critical or High findings left open; four Medium/Low items need the owner or a check I can't run (below)                        |
| Assessment confidence | **91%**, rising: 70 → 82 → 88 → 90 → 91                                                                                                     |
| Gate                  | **Not cleared. Waiting on the human gate** (governance class: the owner signs off each loop; the questions are batched in the last section) |

## Loop 1: Surface pass · extended business team

- **Critical:** the riskiest assumption is that a hand rewrite keeps every rule. The rewrite was done by the same author who designed it.
- **Conservative:** the worst case is an agent breaking an invariant because a rule vanished. The floor holds partly: the invariants that matter most are enforced by CI gates, not only described.
- **Business view:**
  - _PO:_ the user asked for the improved approach early if it's clearly better.
  - _FinOps:_ the per-turn instruction load falls from 89 KB to 14 KB (−84%).
  - _Risk:_ changing governance files in launch week shifts agent behaviour, so an independent check is needed.
- Score not yet meaningful. **Confidence 70%.**

## Loop 2: Pressure pass · independent reviewer + extended scrum team

An independent read-only reviewer compared old and new line by line. It found no Critical items, **5 High** and 17 Medium/Low:

- **High:**
  - an overstated location invariant (it contradicted poster deployments);
  - the CI/CD ticket rule dropped;
  - the `web/shared/` warning dropped;
  - a broken architecture command;
  - "move to Done" wrongly made human-only.
- **Medium/Low:** the brand-scoping gap, `@ocr/ui` notes, the per-loop human gate, stale `§5` pointers, wording.

**Dr of Security:** none of the findings weakened a safety rule. The overstated invariant was the dangerous one, because an agent could have "fixed" correct code.

**Confidence 82% (↑).** The loop found real gaps, which is the protocol working.

## Loop 3: Reactive correction and verification · Sr QA, SDET/SRE, Dr of Security

Every High and Medium finding was fixed in commit `0ae5db34`:

- §4 now moves **verbatim** (`docs/brain/CONSTRAINTS.md`), so hand edits can no longer drop a constraint.
- Location is now worded as public-read-only.
- The Linear step stays with the agent, backed by evidence comments.
- Restored: the ticket rule, the production-after-launch rule, the T1–T4 job names and the per-level pyramid detail.
- The CCR governance row gets a human gate every loop.
- Live pointers are updated; STORIES.md carries a historical banner.

Evidence:

- The verbatim moves are byte-identical once the header is stripped, per the reviewer's check.
- `agent-instructions-budget`: 17/17, with ten planted faults red.
- `worker-claude-md.invariant`: four planted faults red; 283/283 architecture gates pass.
- Root suite: 108 files / 2,732 tests green.
- CI lint: 0 errors.

**Confidence 88% (↑).**

## Loop 4: Quantification · Sr Data Scientist, FinOps, DevOps Mgr

- **Per-turn load:** 89 KB → AGENTS.md 10.1 KB + CLAUDE.md 4.0 KB. Every session in this repo re-reads ~75 KB less per turn.
- **Growth:** CLAUDE.md went from 19 KB to 89 KB in about six weeks. The gate caps it at 6 KB, with AGENTS.md at 12 KB.
- **Copilot** goes from no guidance to the same contract.
- **Rebase cost:** `split-claude-md.mjs` re-cuts `main`'s monolith and stops (exit 3) only when a hand-ported section changes. Main's §5/§7/§8/preamble fingerprints were unchanged on the 2026-10-11 re-cut.
- **DevOps:** the only non-doc changes are one CI comment line and `.gitignore` (agents tracked). Neither alters behaviour.

**Confidence 90% (↑).**

## Loop 5: Confirmation · all roles

- **Rationalizing or verifying?** Three things are still asserted, not proven:
  1. that `claude-code-action` honours the `@AGENTS.md` import in the CI reviewer;
  2. that the new model/effort routing table matches what the owner wants;
  3. the exact Linear end state ("move the story on": Done vs In Review).
- **Would I defend it if it shipped and broke?** Yes for content: every rule from §4 is verbatim, and every other change is cited. Partly for behaviour: items 1–3 above.
- **Decay check:** 70 → 82 → 88 → 90 → 91, rising. Below 95, so the gate is not cleared.

## Findings register (open)

| ID  | Severity   | Finding                                                                                                                                                                          | Closes when                                                                     |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| G1  | Medium (5) | The model/effort table and "never route security, auth, PII or count-floor work below Opus" in CLAUDE.md are new guidance from the 2026-10-11 usage CCR, not yet owner-confirmed | Owner confirms or edits                                                         |
| G2  | Medium (5) | Linear end state after T1–T4 green: the old §5 says move to Done; memory "Linear Tracks Code" says In Review for PO acceptance. AGENTS.md says "move the story on"               | Owner picks one                                                                 |
| G3  | Low (2)    | Not verified that the CI Claude reviewer (`claude-code-action`) resolves `@AGENTS.md` imports                                                                                    | Its review comment on this PR cites AGENTS.md content, or the import is inlined |
| G4  | Low (2)    | Hub `drift-auditor` reads CLAUDE.md + STORIES.md, not AGENTS.md                                                                                                                  | Hub PR (follow-up)                                                              |
| G5  | Low (2)    | Propagated `.ocr-standards/DAC-BACKUP-PROTOCOL.md` still cites "CLAUDE.md §N"                                                                                                    | OCR-docs follow-up                                                              |

`Score = 100 − 5 − 5 − 2 − 2 − 2 = 84%`. Closing G1–G3 gives 94%. G4 and G5 are outside this repo, so the target is to accept them as named risks, which gives ≥ 95%.

## Before merging

- [ ] Owner answers G1 and G2 (one line each, edited into AGENTS.md / CLAUDE.md).
- [ ] G3: the Claude review on #939 shows the reviewer read AGENTS.md (or inline the import for CI).
- [ ] CI green on the PR; rebase on `main` first (split script, exit 0).
- [ ] Owner decides: before the Oct 20 freeze, or after Oct 24.

## Risks accepted (proposed)

- **G4/G5:** cross-repo pointers stay stale until their own PRs. Agents in this repo read AGENTS.md directly.
- **Agents' `tools:` lists aren't enforced at call time** (hub README, 2026-09-01). Read-only is by instruction, and CLAUDE.md says so.

## Human gate (one pass for all five loops)

1. Loops 1–5 above: do you accept the findings and fixes as recorded?
2. **G1:** keep the routing table as written?
3. **G2:** after T1–T4 green, should the agent move the story to **Done**, or to **In Review** for your acceptance?
4. **Timing:** merge before Oct 20, or after Oct 24?
