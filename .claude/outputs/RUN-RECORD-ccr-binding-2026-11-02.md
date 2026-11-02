# CCR run results so far (subject frozen; nothing changed between loops)

Owner rulings, in the owner's words: "loop 3 in adversarial, loop 4 compliance, and loop 5 is recursive", with loop 1 the Critical run and loop 2 the Conservative run. All loops run on the same subject, nothing changes between them, "take all three results from a cumulative", and under 95% "create solutioning with the scrum team". This run: 5 loops. The subject's checker and proposal still encode the older order (repeat after 3); that is known and is not a finding to re-raise.

## Loop 1, the Critical run (ten lenses)

Own score: 0% (3 Critical + 10 High alone exceed 100).

- L1-01 Critical. A skipped CCR is invisible: no worksheet is green (`0 checked`, exit 0); nothing ties a PR or a change to a worksheet.
- L1-02 Critical. class, requested_loops and team are self-declared: `lite`, `base`, an understated requested_loops all pass.
- L1-03 Critical. The 95% reads a number no loop produced: loops 60/70/80 with an empty Solutioning pass at system_score 96; loop content is never inspected; unresolved counts are not tied to the findings register.
- L1-04 High. The ceiling factor 0.375 lets gate: pass stand with one unresolved High (96.25).
- L1-05 High. gate: stop blocks nothing: 0% with 3 Security Critical exits 0. What "binding" stops is never stated to the owner.
- L1-06 High. The gate is editable by the PR it judges: required_pull_request_reviews null, CODEOWNERS `*` only.
- L1-07 High. A clean checkout is red: 3 baseline names are untracked (simulated, exit 1).
- L1-08 High. Grandfathering is name-only: a baselined file can be rewritten; a slot can be swapped; MAX_BASELINE is a constant, and the "drop the entry" advice reopens slots.
- L1-09 High. Today's SKILL.md and ccr-template.md produce a worksheet the gate rejects; the checker already enforces rules no governed text states.
- L1-10 High. The cumulative is undefined: union-once is not stated, only an upper bound is checked, and nothing re-assesses after solutioning.
- L1-11 High. Name evasion: CCR.md, 2026-03-31-ccr-loop1-x.md (tracked precedent), REVIEW-x.md, .claude/documents/ are unseen.
- L1-12 High. No Linear story or CI/CD testing ticket; Done is unreachable.
- L1-13 High. The extended team is defined three ways (SKILL.md 9, CLAUDE.md 10, memory note different).
- L1-14 Medium. The real tree validates 0 worksheets; the test asserts 30+ grandfathered, which fights the ratchet.
- L1-15 Medium. Surviving mutants: owner_ratified loosened to /\d{4}/, stop question anywhere in the body, ~~~ fences, isInteger to isFinite, 100 rejected, lowercase score label, lite layer order.
- L1-16 Medium. No named CI job; the gate is one case among about 2,900 in root-vitest.
- L1-17 Medium. Lead's rules the owner did not state: Lite keeps all three layers, owner_ratified, cumulative <= worst loop, loop 1 under 95 hard fail.
- L1-18 Medium. The proposal's example frontmatter fails the checker; "list only the lenses that ran" conflicts with requiring all nine; a partial worksheet on disk between loops reds npm test.
- L1-19 Medium. Security Critical is 15 in the protocol but a 0 floor here; the 70% base-item cap and the 40% dual veto are not modelled.
- L1-20 Medium. Loose matching: `## No solutioning needed` satisfies a section; `Score: 94% (of 40)` parses as 94.
- L1-21 Medium. Flake: run() drops r.error and r.signal; one 30 s timeout covers multi-spawn cases; one spawn took 6.9 s; green() needs empty stderr.
- L1-22 Low. Stale scrum knowledge file; unclosed fence not stripped; owner_ratified accepts any date.

## Loop 2, the Conservative run (ten lenses)

Own score: 0%. Least the gate guarantees: at a PR head, ccr-* / ccr_* files under .claude/outputs are baselined or self-consistent. It has never run in CI. Worst realistic outcome: landing lowers today's floor, because a green reads as "CCR happened".

Severity changes: L1-14 Medium to High (a fault on main stops staging and production deploys). L1-16 Medium to High (deleting or skipping the test turns nothing red). L1-17 Medium to High (loop 1 rule). L1-05 High to Critical on the owner-belief reading. L1-07 and L1-11 worse (see below).

- L2-01 Critical. Removes the human gate below 95%: governance, loops 0/0/0/0/0, system_score 100, "No open questions": exit 0. "A stop is only for what the team cannot close" is the lead's wording, not in the owner's rulings.
- L2-02 Critical. A clean subject cannot be recorded: honest 97/96/97 is rejected on the pass route and the stop route. Loop 1 becomes a quota; it pays to inflate.
- L2-03 High. The gate coerces a stop into a pass: one High at 96 with an owner question is red on stop, green on pass; the advice in the message has no code path.
- L2-04 High. Governance and compliance have no honest state before the owner ratifies: at 96, stop is red and pass needs a date not yet true. The rule can only be met by a false statement.
- L2-05 High. A human and the gate read different documents: loops inside <!-- --> with a visible "NO-GO, Score 12%" pass.
- L2-06 High. A recorded stop is mutable: four field edits turn three Security Critical stop into a pass; no history comparison.
- L2-07 High. "ok" and "validated" are printed for a 0% stop with 3 Security Critical; "33 checked" means 33 files had first lines read and none judged.
- L2-08 High. The in-flight OSE-1766 epic cannot continue; loops 2 and 3 reviewed different subjects; the only green path re-copies loops, inviting fabrication; no decider named.
- L2-09 High. Cross-session coupling: the baseline ties this PR to another epic's untracked files. Whichever session moves first breaks the other.
- L2-10 High. Cheapest exit from a format red is renaming the file; the gate pushes evasion over fixing.
- L2-11 High. Procedural deadlock: AGENTS.md needs a human gate every loop, this run has none; the ruling lives only in chat and a draft. Reviewers cannot tell compliant from bypassed.
- L2-12 High. A red checker on main blocks all deploys, including its own fix and any hotfix; recovery is serial; plan on 35+ minutes; no override below admin merge.
- L2-13 High. The backout may need a CCR; no emergency lane exists in AGENTS.md, SKILL.md or the protocol.
- L2-14 High. Three live definitions of a run: this repo's protocol, OCR-docs' ccr skill (propagated to spokes), and the checker. The gate binds only OSE.
- L2-15 High. Name-only trigger: ccr-hotfix-notes.md with no worksheet content reds everything.
- L2-16 High. team: base has no required members; governance can list only repo-scout; no class-to-team rule.
- L2-17 High. The loop-position penalty double-counts under a frozen subject; loops 4 and 5 have no multiplier; two readers get incomparable numbers.
- L2-18 High. Nothing ties scores to a route to 95: 60/40/20/0/0 with system_score 96 passes; "score drops between loops = stop" (protocol:155) is unmodelled.
- L2-19 High. An honest per-lens "- Score: dr-of-security 55%" line reds the loop; the rule rewards hiding detail.
- L2-20 High. Mutation evidence cited belongs to a different checker; the current one has no recorded fault-injection run except its author's and the QA lens's.
- L2-21 Medium. No off switch or warn mode; backout is a PR deleting a gate. Baseline recovery is lopsided.
- L2-22 Medium. Mid-run worksheet reds every session in a shared checkout; no draft state.
- L2-23 Medium. In-flight branch docs/fe-uniformity-migration-plan goes red on merge; only fix is invented frontmatter.
- L2-24 Medium. Version-blind re-judging: ccr: 99 and absent ccr pass; fixing rules reds history.
- L2-25 Medium. Quadratic stripFences: 300 KB takes 20 s, 400 KB over 60 s; spawnSync has no timeout.
- L2-26 Medium. Root-vitest has no retry wrapper; strict: false lets an agent rename race a worksheet.
- L2-27 Medium. Clamp hides distance to 95; no raw score stored; 5-loop and 3-loop scores are not comparable.
- L2-28 Medium. Proportionality: about 50 lens runs per 5-loop run, no cost guidance per class.
- L2-29 Medium. Messages steer toward gaming ("lower the score or correct the counts", "drop the entry", "record what it missed"); "binding" over-promises.
- L2-30 Medium. Eight new surviving mutants; `## 3. Loop 2` form untested; bold and bullet label forms unverified.
- L2-31 Low. Raw stack traces with no worksheet name; a basename copy silently does nothing; empty directory named CCR-dir.md is 0 checked; no rollout or rollback plan; UTF-16 file gets a misleading message.

## Interim Recursive pass (ten lenses; not a numbered loop)

Run in the third slot before the owner ruled the order. Kept as input. The Recursive run proper is loop 5.

Own verdict: the direction holds, the magnitude was inflated. Confidence: 95% (Dr), 85% (QA) that it is under 95%; about 60-70% on individual severities.

Merged by root cause (Data Scientist, cross-checked by Backend and QA): 53 raw ids become 11 distinct defects.

- F1 Critical. Nothing ties a change to a worksheet, and discovery is by name only (L1-01, L1-11, L2-10, L2-15, L2-05).
- F2 High. Content is never inspected and every input is self-declared (L1-02, L1-03, L2-01, L2-06, L2-16, L2-18). Backend rates this Critical; Dr keeps three Criticals.
- F3 High. The gate cannot express an honest outcome, and a stop blocks nothing (L1-05, L1-17, L2-02, L2-03, L2-04, L2-07).
- F4 Medium. Baseline and packaging (L1-07, L1-08, L1-14, L2-09, L2-23, L2-22).
- F5 Medium. Governed text drifts from the checker (L1-09, L1-13, L1-18, L2-14).
- F6 Medium. Test gaps and mutants (L1-15, L2-20, L2-30, narrowed L1-16).
- F7 Medium. Score semantics (L1-10, L1-19, L2-17, L2-27).
- F8 Medium. Blast radius and rollback (L2-12, L2-13, L2-21).
- F9 Medium. A per-lens score line reds the loop (L2-19).
- F10 Low. Flake, performance, messages (L1-21, L2-25, L2-29, L2-31).
- F11 Low. Process (L1-12, L2-08, L2-11, L2-28).
  Base deduction at full weights: 15 + 10 + 10 + 25 + 5 + 2 + 2 = 69, so 31%. Half-credit for source-only items gives about 40%.

Corrections to earlier loops: L1-04 withdrawn (protocol-legal arithmetic). L2-02 and L2-04 do not hold as stated: Lite escapes, and the date can be added when the owner ratifies. L2-01 needs a forged owner_ratified or a bug-fix class; the lead's summary dropped that condition. L2-12 "blocks its own fix" is false (the PR's T0 runs the fix's tree; a checker fault reds the PR first), and "35+ minutes" is an unmeasured estimate; "no override below admin merge" is wrong too (enforce_admins is true). L2-13 not reproduced: a revert of a script is not on the governed list. L2-14 partly wrong: OCR-docs' ccr skill is never propagated; it is an unreconciled fork, not a live coupling. L1-16 narrowed: describe.skip is caught by the ratchet; skipIf and deletion are not. L1-12 is inferred from the repo; Linear was not read. "Two reviewers' scratch fixtures collided" (one rm -rf in a shared scratchpad; no repo effect).

New in loop 3: required review cannot be met by a solo author (sole collaborator, agent runs as that admin). Main is already red: the last four pushes fail T4 Functional, unrelated to this subject. The run's own record is only in a temp scratchpad, the first pass's owner questions were never closed, no finding carried proven or inferred, and about 5 of 55 "proven" claims have been re-run by a second lens. The "team is red" failure is still unexplained. The proposal's "past 3 the order repeats" and the narrowing of "min of 5" to governance are the lead's readings, not the owner's words.

## Loop 3, the Adversarial run (ten lenses)

Own verdict: the gate falls to every attack aimed at it. Tags: [P] proven by a command on a scratch copy, [I] inferred.

- L3-01 Critical [P]. One-line AGENTS.md edit with no worksheet: green. 1 step, 0 review bytes. pr-risk says high; nothing reads it.
- L3-02 Critical [P]. A generated 5-loop extended governance worksheet, 1,413 bytes, scores 0, system_score 100, forged owner_ratified: green. Lite route 414 bytes.
- L3-03 Critical [P]. A fake worksheet with a "GO 97%" banner and invented run ids passes; nothing helps a reader. What exposes it: the cited commit and run do not exist; no tie to a PR.
- L3-04 Critical [P]. An honest 0% (3 Security Critical in the register) reads 96% by declaring counts 0. Merging to one root cause, partial credit and severity relabelling also reach 95 [I]. The root-cause merge method used in the interim pass can itself be gamed.
- L3-05 Critical [P]. One-line exclude in vitest.config.ts, or narrowing the workflow command, turns the gate off; nothing notices. No workflow names the checker.
- L3-06 Critical [P]. Small checker diffs with all 106 tests green: subfolder skip, omit security_critical, Math.min count cap, a draft name skip, an env off switch, `if (d.ccr === 2) return p;` (30 bytes). test.fails hides a removed rule and the ratchet does not count it.
- L3-07 Critical [S, verified by the lead]. Two rewritten owner rules: "human gate every loop" became "owner ratifies" (not ruled), and the 5-loop floor keyed on file touched became self-declared class.
- L3-08 High [P]. A ~720-byte alias-expansion frontmatter stalls the checker 110 s (JSON.stringify in a message); each level is about 10x. Contradicts the first pass's "YAML is safe", which only tested loading.
- L3-09 High [P]. Invisible and look-alike labels (zero-width, Cyrillic) hide a real Score; 4+ backtick and ~~~~ fences, blockquote fences and fence mismatches make the page and the checker read different documents.
- L3-10 High [P]. .gitignore `.claude/outputs/CCR-*` keeps worksheets out of the PR.
- L3-11 High [I]. strict: false race: a valid worksheet plus an agent rename reds main. Two PRs each green.
- L3-12 High [P, verified by the lead]. policy-gate is not installed on this machine: no hooks in user, project or spine settings, no ~/.claude/hooks. CLAUDE.md describes it as a guardrail; it fails open when absent. A script holding a protection-delete call passes the hook anyway.
- L3-13 High [P]. Path to main with no one seeing it: last 8 PRs authored and merged by the sole admin with no review; plain `gh pr merge` is not on the hook's list.
- L3-14 High [I]. Done path is unchanged: close-guard is not a required check; a manual move to Done cites any run; nothing ties an OSE id to a worksheet.
- L3-15 Low [P]. loops_run: 1e9 runs out of memory (exit 134, no message). A heading ending in "?" satisfies the stop question.

Fix directions tested: diff rule beaten (forge, rename R100, adjacent files such as workers/oursharedevents/CLAUDE.md and docs/brain/CONSTRAINTS.md, two-PR laundering). Head hash pins beaten. Base-branch pins partial. Required review not implementable solo; Actions cannot approve. Survivor [I]: checks run from the base ref, plus owner approval through an identity or key the agent cannot use. No CI check detects forgery. Resistant scoring: a machine-readable register the checker recomputes, merge only on the same file or fixing change, charge max weight plus 0.25 of the rest, lowering a severity needs a second lens.

Open conflict: `branches/main/protection` shows no reviews key; `.../required_pull_request_reviews` says 1 approval, no code owners; recent merged PRs show an empty reviewDecision.

## Loop 4, the Compliance run (ten lenses)

Rule-by-rule against written rules. Tags: [P] proven by command, [T] text comparison, [I] inferred.

Passes: governed files not edited [P]; both owner options honoured (checker plus CI gate, draft-only) [P]; production hold untouched [P]; AGENTS.md, CLAUDE.md and skill size budgets [P], and the proposal fits [I]; secrets [P]; no repository control changed [P]; class loop counts; Regulatory cap 60; weights; extended team of nine; file placement.

Failures by rule:

- L4-01 Critical [T]. "human gate after every loop" (AGENTS.md Reviews, hardening doc:150): the proposal replaces it with "owner ratifies". Not ruled by the owner. Same as L3-07.
- L4-02 Critical [P]. Attributable, traceable record (SOC 2 CC8.1 as read by the lens, OSE-1444): no actor, SHA or PR in a worksheet. Audit-grade: no; it is self-attestation.
- L4-03 High [P]. "every GitHub control above is advisory" until step 5 (hardening:68-70), but the checker header says "binding".
- L4-04 High [P]. Threat ledger TL-014/015 and CI_DEPLOY_HARDENING 4.1 rely on required review; pre-existing, none in force. PRs 1062, 1064 carry Copilot comments only.
- L4-05 High [I]. Invariant #24 extended: trail machine-generated, never written by hand; worksheets are hand-written statements.
- L4-06 High [P]. Retained, tamper-evident (OSE-1444 S5): a record and its baseline entry can be deleted, exit 0.
- L4-07 High [P]. Born red not met: mutants survive. Coverage principle: no workflow names the checker.
- L4-08 High [P]. Owner's ratchet rule: "use the repo's existing mechanism (ci-integrity-ratchets.mjs)"; the subject adds a second baseline, no --base-config comparison, no reasons. The rule's source is a memory note.
- L4-09 High [P]. "a named CI job goes red if it regresses" (AGENTS.md Merged).
- L4-10 High [P]. CLAUDE.md states policy-gate.mjs "blocks" as fact; not installed here. Hook README's control "required reviews against an agent identity that is not an admin" unmet.
- L4-11 High [I]. Protocol 2.5 "Verified requires evidence": no verification state per finding. Protocol 2.4: 95+ advances; the checker rejects a stop at 95+.
- L4-12 High [I]. CCR is org doctrine whose home is OCR-docs; the subject changes it in OSE only. "Enforce org rules infra-wide" is a memory note.
- L4-13 Medium [I]. ADR reconciliation rule 3 and PR checklist: a new CI rule needs an ADR; no ADR, no drift entry; the OCR-docs knowledge file still says every loop is a full pass.
- L4-14 Medium [I]. Base items and the 70% cap unmodelled; Lite's six criteria unchecked; Lite escalation missing; conforming abbreviated Lite output rejected; confidence field absent; protocol modification needs version history.
- L4-15 Medium [I]. Story format, pick work from Linear, CI/CD ticket, full pyramid: no story yet (Linear not read). Two-layer rule needs an explicit N/A.
- L4-16 Low [P]. Worksheet name pattern broken by the three epic files.

Owner-ruled departures (not failures): one lens per loop, no fixes between loops, the loop order. Disputed: "stop only for what the team cannot close" is the lead's wording.

Corrections: L3-10 is a proposed attack; no such ignore rule exists today. L1-07 clean-checkout red stands. Required reviews: most likely not enforced [I] (declared config null, nightly drift green, recent PRs show no decision); only a write test would prove it.

## Loop 5, the Recursive run (ten lenses)

Cumulative of all loops: under 95% on every method. Confidence 93-99% across lenses.

- Data Scientist method (union, drop withdrawn items, merge only when one fixing change closes both, group charge max + 0.25 x rest, cap 2 x max): raw 84, dropped 5, 22 groups (18 subject, 4 posture). Deduction 351.5 = 305.25 subject + 46.25 posture. Score 0%, 0% with posture excluded. Max-weight-only sensitivity: 200, still 0%.
- Dr of Security: 3 Critical, 3 High, 6 Medium, 2 Low = 14 distinct, flat 109, 0%. None Security Critical.
- The interim 31-40% is retired: it merged across different fixes, which L3-04 showed can be gamed.

Three true Criticals (Dr):

- C1 Nothing ties a change to a worksheet (L1-01, L1-11, L2-10, L3-01).
- C2 Inputs are self-declared; form is validated, truth is not (L1-02, L1-03, L2-01, L3-02, L3-03, L3-04).
- C3 The gate is editable by the PR it judges (L1-06, L3-05, L3-06); repo-wide, pre-existing.
  Then High: F3 no honest outcome (L1-05, L2-02, L2-03; L2-02 stands for a clean 97/96/97 bug-fix, proven); the rewritten owner rules (L3-07 = L4-01), disclosed in a draft and needing the owner; no named CI job.

Corrections in loop 5: L3-08 stands, about 4.5x per level (not 10x), only slows the author's own CI, Medium. L3-09 partly holds; all subsumed by L3-02, Low. L4-05 withdrawn. L4-02 and L4-06 not established obligations (SOC 2 scope undecided; git keeps deletions). L4-13 Low (ADR rule says reconcile when relevant; no new ADR required). L4-12 Medium (OSE already keeps its own protocol). "Infra-wide" is a memory note, not a checked-in rule. L4-08 premise false: ci-integrity-ratchets.mjs measures four fixed things; holding this baseline needs new code. L1-07 Medium (the PR's own T0 reds first). Main's T4 is green on the newest push (run 41401623413, #1064); the earlier reports of a red main are stale. "team is red" stays unexplained and dropped out of loop 4. Second-lens evidence: about 21 findings have a re-runnable proof, about 6 confirmed twice, the rest on one report or source reading; two L3-06 mutants re-run and confirmed; [P] in loop 4 sometimes means a reading, not a run.

Split (DevOps, Backend): subject defects the team can fix: F2/F3, unnamed gate, mutants, baseline, DoS, label bugs, text drift. Owner posture: hook not installed, solo admin merges, no effective review, no ticket yet. Owner-only: gate-every-loop vs ratify, install the hook, review controls and a forge-resistant identity, OCR-docs home.

Binding, honestly (PO): a real block needs three things: a worksheet exists, the check runs from the base ref, approval comes from an identity the agent cannot use. Agents cannot deliver that. What agents can deliver is a tripwire: a skipped or malformed CCR is visible, and a determined author can still forge it. Survivor correction (Dr): invert it: give the agent a non-admin identity and the owner approves; forgery still reaches the approver; a head-added job could mint the same check name [I].

Run's own compliance (Scrum Master): subject frozen, no fixes between loops, five loops, ten lenses each. Deviations: no human gate between loops (AGENTS.md; owner has not explicitly waived); first pass and interim pass sit outside the five loops; loops 3-4 gave no own score; record was in a temp scratchpad.

## Solutioning (ten lenses, after loop 5)

Owner steps, in order, run by the owner in their own terminal (DevOps, from docs/security/AGENT-WORKSTATION-HARDENING.md and .claude/hooks/README.md). No agent runs these.

1. Baseline: `node scripts/hardening/verify-hardening.mjs`, save the output. About 5 min.
2. Hook: `node scripts/hardening/apply-workstation.mjs`, read the plan, then `--apply`, type APPLY, start a new session. Verify: ask Claude to run `npx wrangler secret:bulk does-not-exist.json`; it must be refused with `[wrangler-secret]`, and today's `~/.claude/audit/policy-*.jsonl` exists. Back out: restore `settings.json.bak-<stamp>` and delete `~/.claude/hooks/policy-gate.mjs`. About 15 min.
3. Agent identity without admin (hardening step 5): a second GitHub account with Write, a fine-grained token (Contents, PRs, Issues read/write; no Administration, Workflows, Environments or Secrets); `gh auth login` with it, `gh auth logout` for the admin token; sign the owner out on this machine and approve from another device. Verify: `gh api user` shows the agent account; verify-hardening G6 and W8 pass. Back out: `gh auth login` as admin. About 45 min.
4. Reviews (hardening step 6), only after step 3 or every merge deadlocks: `required_pull_request_reviews` one approval with code-owner review in `tools/ci/main-branch-protection.json`, then `node scripts/apply-branch-protection.mjs --apply`. Verify: the reviews endpoint shows 1 approval and code owners on; an agent PR shows as blocked. Back out: set the key to `null` and re-apply. About 20 min.
5. Tag ruleset and production gate (hardening step 4), production-deploy safety, not a CCR finding: `apply-github.mjs --apply` after a dry run. About 15 min.

Design pieces the team proposed:

- Backend: a findings register as the only scored input (id, loop, lens, severity, status, evidence proven or inferred, group, closed_by, severity_changed_by needing a second lens); the checker recomputes the score; outcome states PASSED, PASSED_ACCEPTED_RISKS, SOLUTIONING_OPEN, BLOCKED_OWNER, DRAFT.
- SDET/SRE: a named `CCR gate` job on `pull_request` (pull_request_target is banned here), `contents: read`, no secrets, 5-minute timeout; check out base and head; run the base checker with `--root head/`. Owner makes it a required check. Warn-only first via `::warning::`; enforce on the owner's date. Size cap, linear fence scan, spawn timeout, loops_run cap.
- QA: pin one case per surviving mutant, a scoped mutation step, ratchet test.fails, skipIf and exclude entries against the base, one real frozen worksheet as a fixture, an in-process `check(root)` to cut the file from 42 s to about 3 s.
- Design: success line "FORMAT OK: N worksheet files have valid form. NOT CHECKED: that any review happened, scores, or who ran it."; zero files "NO WORKSHEET FOUND. This does not mean a CCR was skipped or done."; a six-line worksheet header a person checks in a minute: PR, reviewed SHA (40 characters), register counts, one dated line per loop, not verified, owner decision.
- FE Integration: text first and checker second in one PR; warn-only; a `ccr: 2` marker for new worksheets; baseline as path plus blob SHA; OSE-1766 keeps its three files as legacy and writes loop 4 onward in the new form; OCR-docs follows by PR.
- Dr of Security: split identities first (under an hour); base-branch checks may need an org ruleset requiring a workflow pinned to main (plan support unverified); not solvable by CI: whether content is true, whether loops ran, the human gate, identity separation.
