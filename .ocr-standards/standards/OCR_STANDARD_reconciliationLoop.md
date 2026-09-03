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
   before any Done flip. On 2026-09-03 this caught two false "merged" verdicts.)
3. **Reconcile code ⇄ brain/docs** (`drift-auditor`): report gaps both directions.
4. **Write back to all three surfaces:**
   * Linear — flip merged-but-open → Done *with the citing evidence in a comment*; comment (don't
     silently flip) on stalled/unclear tickets recommending the correct state.
   * Brain/docs — file a story per code↔brain inconsistency ([[feedback-reconciliation-definition]]).
   * Memory — refresh stale pointers; log the run as a one-line note, not a new dated file.
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
