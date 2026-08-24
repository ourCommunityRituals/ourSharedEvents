# Knowledge Homes & Reconciliation — OCR System Standard

> Every truth has one home. Reconciliation keeps the homes agreeing, and promotes shared truths into the brain so every spoke inherits them.

---

## Why this exists

Knowledge in this org drifts for one reason: the same fact gets written in more than one place, and the copies fall out of sync. A ticket says Done while the code is unbuilt; a doc teaches a retired model; a session note repeats a PR log that Linear already owns. The fix is not more writing — it is **one home per kind of truth**, and a discipline (reconciliation) that drives the homes back into agreement and pushes anything *shared* up to the brain.

This standard defines the homes. `OCR_STANDARD_orgBrainSync.md` defines the *mechanism* that moves truth between them (propagate down, audit, pull up). Read them together.

---

## The four homes

| Home | Owns | Does NOT own |
|---|---|---|
| **Product repo** (`{spoke}/` — code, `docs/`, `CLAUDE.md`, tests) | The product's own current state and deep detail. Code is the source of truth; when code and docs disagree, code wins. | Cross-spoke doctrine (that's the brain). Historical narrative (that's Linear). |
| **Linear** | The **historical record** — ticket state transitions, PR numbers, dated session logs, "what happened when," per-story acceptance evidence. | The current shape of the code (verify that in the repo, not the ticket status). |
| **OCR-docs brain** (this repo) | The **shared, cross-spoke understanding** — architectural invariants (`ocr-docs-brain/architectural-invariants.yaml`), standards (`docs/standards/`), org vision/doctrine (`docs/OCR_VISION.md`). Governance and coordination only, **no application code**. | Anything true of only one product (that stays in the spoke). Anything not in VISION.md at org level — flag as drift, don't assert it. |
| **Session / agent memory** | A **thin, private, live cache** — the current north star, where things stand now, non-obvious gotchas, and *pointers* into the three homes above. | A system of record. It must not duplicate Linear's changelog or the brain's doctrine; it points at them. |

### The routing test

Before writing a fact down, ask **"who needs this truth?"**

- **One product only** → the spoke repo (code/doc) + its Linear tickets.
- **The whole org / future spokes** → the **OCR-docs brain**, from where `propagate-standards.yml` carries it to every spoke's `.ocr-standards/`.
- **"What happened / when"** → Linear.
- **"What am I doing right now"** → session memory (as pointers, not copies).

A truth with more than one audience still has exactly one home — the most-shared one — and every other place *points* at it.

---

## Reconciliation

**Reconciliation = drive the inconsistencies between the homes to zero.**

The surfaces that must agree: **code ↔ brain ↔ docs ↔ Linear ↔ deployed**. When any two disagree, that is an inconsistency, and reconciliation resolves it:

1. **Verify first.** Establish ground truth from the authoritative home (usually the code or the deployed system) before trusting any status, doc, or memory. A checked AC box is a claim, not a fact.
2. **File a story for every inconsistency noted** — in Linear, against the existing owner (never a duplicate; fold new detail into the owning ticket as a comment).
3. **Fix the drift at its home**, not at the copy. A doc that teaches a retired model is corrected in the doc; a stale ticket is re-stated; a spoke that fixed a shared rule locally must **promote it to the brain**.
4. **Promote shared truths to the brain — the third leg.** Reconciliation is *not complete* when only Linear and the local repo/memory are synced. If the reconciled truth is one every spoke should hold — a new or changed invariant, a standard, a doctrine — it must be written **into OCR-docs**, where the propagation mechanism flows it to all spokes. A shared truth fixed in only one spoke re-enters as drift through the others.

### Anti-patterns

- ❌ **Copying Linear's changelog into docs or memory** — PR numbers and dated logs belong in Linear; duplicating them guarantees a stale second copy.
- ❌ **Fixing a shared rule in one spoke and stopping** — without promotion to the brain, the other spokes still teach the old rule.
- ❌ **Duplicating VISION.md / invariant facts into a spoke doc** — reference the canonical home; don't re-state it.
- ❌ **Trusting a Done status over the code** — verify against the repo/deployment first.
- ❌ **A session note that is a system of record** — memory is a pointer cache; if it holds the only copy of a durable truth, that truth has no real home yet.

---

## How this composes with the rest of the system

- **`OCR_STANDARD_orgBrainSync.md`** — the transport. This standard says *what lives where*; orgBrainSync says *how it moves* (propagate down → audit → pull up). Promotion "to the brain" lands in `docs/standards/`, `docs/OCR_VISION.md`, or `ocr-docs-brain/`, all of which propagate.
- **`OCR_STANDARD_agentOperatingModel.md`** — reconciliation is an agent behaviour; verify-first and no-duplication are its operating rules.
- **CCR protocol** (`skills/ccr-protocol.knowledge.md`) — a reconciliation that changes a governance artifact (invariant, standard, VISION) is a governance change → CCR gates it before it earns artifact status.
- **Invariant #20 (Standards Propagation Completeness)** — the machine check that a shared truth actually reached every home.

---

*Last updated: 2026-08-24*
*Owner: Matt*
*Status: PROPOSED — awaiting review.*
