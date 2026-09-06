# OCR_STANDARD_reconciliationLoop

**Status:** ACTIVE · **Owner:** platform · **Last updated:** 2026-09-03

> The **reconciliation loop** is the triggerable process that drives drift between the three
> truth-surfaces — **Linear** (intent), **Code** (reality), **Brain + Memory** (doctrine) — to
> zero, across the monorepo and every spoke. It is the *how* behind
> [[OCR_STANDARD_knowledgeHomes]] and complements [[OCR_STANDARD_orgBrainSync]]: org-brain-sync
> *pushes standards down*; this loop *catches drift back up*.
>
> **This standard is the durable process.** Individual reconcile *runs* are logged as Linear
> updates / memory notes — never as new dated brain files. If you find a `*-reconcile-YYYY-MM-DD`
> snapshot, it is a spent run record, not the process.

---

## 0. The loop — named, referenceable rungs (owner-canonical, 2026-09-03)

```
Shared Brain → Invariant → Code → CI/CD → Test Pyramid → Results → Reporting → ↺ Shared Brain
                                                                                (brain reads & reacts)
```

The reconciliation loop **is** this ordered cycle — the path a change/signal travels, closing back
to the Shared Brain so the brain can *read the Reporting and react* (agentic reconciliation). Each
rung is named so it is individually referenceable:

1. **Shared Brain** — OCR-Docs doctrine; the source of intent every downstream rung must conform to.
2. **Invariant** — doctrine in its machine-readable, enforceable form (`architectural-invariants.yaml`,
   co-located *in* the brain — **not** a downstream artifact). The rung marks the doctrine→enforceable-rule
   facet, not a separate generation step or repo; don't look for a transform between rungs 1 and 2.
3. **Code** — the implementation across the corner repos (BE route handlers · D1 schema/migrations · FE surfaces), flowing OSE anon-base → OW named → spokes.
4. **CI/CD** — the gates that deploy + guard the seam (S0…T4, static gates, hosted runners).
5. **Test Pyramid** — unit → integration → API → E2E; the layers that corroborate the claim.
6. **Results** — reds/greens + staging outcomes; reality's verdict.
7. **Reporting** — the synthesized readout of Results (SharedReport-grade, SCRUM-POV close-outs, drift tables).
8. **↺ Shared Brain** — Reporting loops back for the brain to **read and react**: findings become new invariants, stories, and doctrine updates — closing the loop.

This is the same object as the truth-triangle in §2, seen as a cycle: the **triangle** names the three
*surfaces* kept in sync; the **loop** names the ordered *path* a signal travels and returns.

## 1. Why this exists

A ticket can sit "In Review" for weeks while its code is already merged (or was never written).
Docs can claim a feature the code dropped. Memory can point at a file that moved. Each is **drift**,
and drift is invisible until someone trips over it — the failure mode this loop exists to make
*fast to detect* (MTTD ↓, per [[kaizen-reconciliation-health-doctrine]]).

Motivating incident (2026-09-03): an owner Linear check found a QR-verify ticket sitting for days
"waiting to be checked in" — code effectively done, board never updated. A standing loop catches
that class automatically instead of relying on a manual glance.

## 2. The triangle

```
                        LINEAR  (intent / tracking)
                          ▲
             board-reconciler │  (Linear ⇄ code: merged-but-open, stalled)
                          ▼
        CODE  ◄───────────────────────────►  BRAIN + MEMORY
   OCR (root) · OCR-Docs      drift-auditor      OCR-Docs (shared brain)
   OSE (anonymous base)      (code ⇄ brain/docs)  + session memory (pointers)
   OW (named layer) ·
   OSG/OSM/OSR/OSP/OA (spokes)
```

Each **edge** has an owning executor:

| Edge | Question it answers | Executor |
|---|---|---|
| Linear ⇄ Code | Is every "In Review/In Progress" ticket backed by merged code? Is every merge reflected on the board? | `board-reconciler` agent |
| Code ⇄ Brain/Docs | Does the code match CLAUDE.md / STORIES.md / brain invariants — in both directions? | `drift-auditor` agent |
| Brain/Memory ⇄ (all) | Do memory pointers + brain docs still name files/flags/tickets that exist? | manual sweep during the run |

The three repos in the code corner are not peers: **OCR-Docs is the shared brain**, **OSE is the
anonymous base layer**, **OW is the named layer that completes the choice offering** (see
[[the-choice-network]]); the spokes inherit OSE. Reconcile them **brain → base → named → spokes**
so a brain change is settled before its consumers are checked.

## 3. Trigger

**On demand** (owner says "run the reconcile" / a release cut / a suspicion of drift). Not a cron —
this loop makes *write* recommendations to Linear and the brain, which stay human-gated. A future
scheduled *read-only* drift report is allowed; status/brain writes are not automated.

## 4. The loop (per repo, until drift = 0)

1. **Enumerate** the board's open work for the team (In Review + In Progress).
2. **Reconcile Linear ⇄ code** (`board-reconciler`): for each ticket, find the merge evidence on
   `origin/main` (commit SHA / PR #), or its absence. Classify (§5). **Verify-first — every verdict
   cites a git fact, never a guess.** (Agents get this wrong; confirm SHAs are ancestors of `main`
   before any Done flip. On 2026-09-03 this caught two false "merged" verdicts.) **Citation schema:**
   any Done-flip comment MUST carry a parseable block — `sha: <7+hex> · ancestor_verified: true · pr: #NNN`
   — so a wrong flip is *mechanically* detectable. **The enforcing mechanism is
   `ocr-docs-brain/scripts/verify_reconcile_comment.py`** (OCR-128): it parses the block for schema
   *integrity* (each labeled field present, SHA is 7–40 hex) and **re-runs `git merge-base --is-ancestor`
   itself — it never trusts the comment's own `ancestor_verified: true`**, because the failure mode is a
   flip that *claims* a check it never ran (the 2026-09-03 run's two false "merged" verdicts). It exits
   non-zero on any gap, so board-reconciler MUST run it against the target repo before proposing a Done
   flip — e.g. `python3 ocr-docs-brain/scripts/verify_reconcile_comment.py --comment-file flip.md --repo
   ../ourSharedEvents --base origin/main`. A flip whose comment does not pass this checker is itself a
   drift finding. (Self-tested in `tests/test_verify_reconcile_comment.py`, run by `run_script_tests.py`
   in `brain-validate.yml`.)
3. **Reconcile code ⇄ brain/docs** (`drift-auditor`): report gaps both directions.
4. **Write back to all three surfaces:**
   * Linear — flip merged-but-open → Done *with the citing evidence in a comment*; comment (don't
     silently flip) on stalled/unclear tickets recommending the correct state.
   * Brain/docs — file a story per code↔brain inconsistency ([[feedback-reconciliation-definition]]).
   * Memory — refresh stale pointers; log the run as a one-line note appended to `[[memory-reconcile-loop]]`
     (or a Linear project status update), never a new dated file.
5. **Repeat** for the next repo in brain → base → named → spokes order.

## 5. Drift classes to catch

| Class | Signal | Resolution |
|---|---|---|
| **Merged-but-open** | ticket In Review; PR/commit on `main` | → Done, cite SHA/PR |
| **Stalled** | In Review/In Progress for days; no recent commit, or an idle open PR ("waiting to be checked in") | comment + recommend Todo/In Progress, or push it |
| **Phantom-review** | In Review but *no git artifact at all* | status is wrong → back to Todo/Unstarted |
| **Stranded** | fix commits live only on dead/unmerged branches | re-apply to `main` + fresh PR |
| **Done-by-adjacent** | scope satisfied under a *different* ticket's PR | close as done-by-adjacent, link the PR |
| **Code-ahead-of-docs / docs-ahead-of-code** | drift-auditor gap | file a story; fix code-first if intent≠code |
| **Spoke-ahead-of-brain** | a base/spoke change works but the shared truth isn't in the brain yet | **promote to the brain FIRST**, then re-propagate (a spoke-local fix re-enters as drift through the other spokes) |
| **Stranded commit** | a merged PR captured only part of its branch (early squash) — later commits stuck on the dead branch | re-apply the dropped commits to `main` via a fresh PR (this standard's own §0/§8 hit this on 2026-09-03) |
| **Stale pointer** | memory/brain names a moved/deleted file/flag/ticket | correct or delete the pointer |

## 6. Done criteria + health

A run is done when every open ticket is backed by a git fact (or correctly re-stated) and no
code↔brain gap is unfiled. Health is a **derivative, not a level** ([[kaizen-reconciliation-health-doctrine]]):
recurrence → 0, MTTD ↓, coverage of surfaces ↗. A green board is not the goal; an *honest* board is.

## 7. Boundaries

* **Agent never controls authorization** ([[feedback-agent-never-controls-authorization]]): the loop
  reads git and proposes/records board + doc changes; it never mints tokens, deploys, or merges.
* **One ticket → one PR** for any code fix that falls out of a reconcile
  ([[feedback-one-ticket-commit-pr-merge]]).
* Status flips are cheap to reverse and always carry their evidence, so a wrong flip is falsifiable.
* **Bounded read surface.** Loop agents read *named* surfaces (git log, ticket status fields, named doc
  paths) — they do **not** glob-read `docs/` wholesale or enumerate untracked files, which is where a
  planted brain doc / ticket comment could inject behavior or expose a stray credential.

## 8. Brain lightness (a loop discipline)

The loop feeds findings back to the **Shared Brain** (rung 8) on every run — so without discipline the
brain bloats exactly as fast as it heals. Keeping it light **is part of the loop**, not a separate chore;
run it at each ↺.

**Two storage costs:**
- **×N propagation** — every file under `docs/standards/`, `skills/`, `templates/` is copied into
  *each* spoke's `.ocr-standards/` by `propagate-standards.yml`, so brain size × (spokes + 1). A verbose
  standard is verbose eight times over. Size every propagated byte for that blast radius.
- **Accidental accumulation** — run-logs, session dumps, drafts, generated reports, and (worst) leaked
  secrets pile up untracked and creep in.

**Rules — apply on every ↺ back to the brain:**
1. **Durable rules + pointers only.** Snapshots / run-logs / status dumps / dated reconcile records live
   in Linear (history), never the brain. Log a loop run as a one-line note, not a new file.
2. **One fact, one home.** Don't restate a rule across invariant ↔ standard ↔ ADR — `[[link]]` instead.
3. **Thin propagated surface.** Keep `docs/standards/` + `skills/` terse; push heavy rationale to a
   brain-only doc *outside* the propagated dirs, referenced by link. Propagate the contract, not the essay.
4. **Generated ≠ stored; secrets never stored.** `.gitignore` is *defense-in-depth* for common generated
   (`*conformance-report.json`, `*.log`) and credential shapes (`*.token`, `*.key`, `*.pem`, `.env*`,
   `doppler.yaml`, `secrets.json`, command-paste scratch `\!*`) — but name-based ignores are porous (a
   `.txt` holding a pasted `gh secret set …` slipped past on 2026-09-03). The **authoritative gate is a
   content secret-scanner** (detect-secrets / gitleaks) in brain CI — a scanner, not a filename guess,
   is what actually keeps credentials out of a docs hub that propagates ×N.
5. **Retire, don't delete** invariants (provenance via `retired` status); **GC** scratch + drafts.

Health tie-in: brain **KB-per-repo** and **untracked-scratch count** are reconcile signals like any
other ([[kaizen-reconciliation-health-doctrine]]) — trending them down is part of a healthy loop.
