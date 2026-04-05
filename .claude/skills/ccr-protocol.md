# CCR Protocol — Critical, Conservative, Recursive

## When to Use

User says: "CCR", "run a CCR", "code review", "assessment", "production readiness", "review this", "test gating", "confidence check", "is this ready to ship"

---

# Executive Summary

## What CCR Is

CCR is a review protocol that makes confidence measurable. Before any AI-assisted output ships — a merged PR, a shipped fix, a documented decision — it must survive three layers of scrutiny (Critical, Conservative, Recursive) across multiple loops, scoring ≥ 95% on a weighted checklist. Below that threshold, the process stops, findings are fixed, and the score is recalculated. Above it, the artifact ships with a scored, auditable worksheet.

**The core contract in one sentence:** You earn the right to ship by surviving your own scrutiny — recursively, conservatively, critically.

## Why It Exists

Every engineer has shipped something that broke because a surface wasn't mapped, a contract wasn't verified, or an environment assumption was wrong. Every team has had the argument: "I think it's ready" versus "I don't think it's ready." CCR replaces that argument with a number and a worksheet. It doesn't eliminate judgment — it structures it so it's scored, documented, and auditable.

## How It Works — The 5-Minute Version

**Step 1 — Classify.** What are you reviewing? A bug fix gets 3 loops. A security fix gets 3-4. A typo gets CCR Lite (1 loop). Governance docs get 5+.

**Step 2 — Run loops.** Each loop passes through three layers:

| Layer            | The Question It Asks                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| **Critical**     | What is the most dangerous assumption here — verified, or just assumed? |
| **Conservative** | What is the worst-case if I'm wrong — does the fix still hold?          |
| **Recursive**    | Has my confidence held, improved, or degraded across loops — honestly?  |

**Step 3 — Score.** Start at 100. Deduct points for every unresolved finding based on severity:

| Severity            | Deduction | When to Use                                                 |
| ------------------- | --------- | ----------------------------------------------------------- |
| Regulatory Required | 25 pts    | Federal legal obligation (HIPAA, COPPA). No partial credit. |
| Security Critical   | 15 pts    | Exploitable vulnerability. No partial credit.               |
| Critical            | 15 pts    | Load-bearing — analysis fails if this is wrong              |
| High                | 10 pts    | Significant downstream risk                                 |
| Medium              | 5 pts     | Real gap, manageable if named                               |
| Low                 | 2 pts     | Improvement, not a blocker                                  |

**Step 4 — Gate check.** Score ≥ 95%? Advance to next loop. Score < 95%? Stop. Fix the findings. Re-score. Score drops between loops? Stop — confidence is decaying.

**Step 5 — Fix between loops.** This is the key difference from other review frameworks: when you find a problem, you fix it before the next loop — not after the review. Findings drive fixes, not just reports.

**Step 6 — Ship.** When the score is stable at ≥ 95% across two consecutive loops, the artifact ships with its scoring worksheet attached.

## Where It Applies

CCR is not a software-only tool. It applies to any handoff where the cost of being wrong exceeds the cost of running the loops.

| Role              | Loop Sequence                               | What 95% Means                                       |
| ----------------- | ------------------------------------------- | ---------------------------------------------------- |
| **Product Owner** | Vision → Roadmap → Story                    | "I am confident this story is ready for Engineering" |
| **Engineering**   | Unit → Contract → Integration               | "I am confident this is correct to hand to QA"       |
| **QA**            | Manual → Automation → Regression            | "I am confident this is correct to ship"             |
| **Security**      | Threat Model → Attack Surface → Penetration | "I am confident the threat model holds"              |
| **DevOps / SRE**  | Infrastructure → Pipeline → Observability   | "I am confident the deploy path is verified"         |

Each role defines their own variable items. The scoring formula, threshold, and gate rules are the same for everyone.

## What Engineers Will Ask First

**"Isn't 95% arbitrary?"**
It traces to Fisher's 1925 statistical convention (p < 0.05) — a century of validation across every scientific discipline. CCR adopts it as a calibration point, not a probability. It's high enough to filter noise, low enough to remain achievable. The path to 99% exists but is gated by infrastructure economics — when LLMs run locally and token cost is near-zero, 99% becomes pursuable. Not before.
→ _Deep dive: Section 5_

**"Who decides what severity to assign?"**
You do, using the variable item sets for your review type (Security, Framework Upgrade, Bug Fix, or custom). The severity weights (25/15/10/5/2) are fixed — you don't change those. You own the items. You don't own the weights. Conservative classification is always safer: when in doubt, pick the higher severity.
→ _Deep dive: Section 2.5_

**"What counts as 'Verified'?"**
Citable evidence only. A test result, a code path (file:line), a config value, a log entry, a screenshot. "I looked at it and it seems fine" is Partial (half deduction), not Verified (zero deduction). Evidence is what makes the worksheet auditable.
→ _Deep dive: Section 2.5, Partial Credit Rules_

**"Do I need to run this on every change?"**
No. CCR Lite exists for low-risk, isolated, reversible changes (typo fixes, comment updates, formatting). One loop, base items only, 15 minutes. If any of six eligibility criteria fail, it escalates to standard CCR.
→ _Deep dive: Section 7.1_

**"How long does this take?"**
CCR Lite: 15 minutes. Standard bug fix: ~1 hour. Security review: ~2 hours. The time budget is front-loaded verification that prevents expensive back-end rework. A finding that slips to production costs an incident. A finding caught in Loop 1 costs 20 minutes.
→ _Deep dive: Section 7.3_

**"What if my score is stuck below 95%?"**
After 3 consecutive loops within 2% of each other and below threshold: restructure the change, not more loops. Split it smaller. Bring in a peer reviewer. Looping on a stable-but-insufficient score is wasted effort.
→ _Deep dive: Section 7.2_

**"This feels rigid."**
The protocol is rigid in exactly the right places (formula, threshold, gates, heuristics — the invariant core) and flexible in exactly the right places (loop sequence, item sets, loop count, chunk scope — the variable surface). TCP/IP is rigid — the protocol never changes. The applications built on it are infinitely flexible. Same architecture.
→ _Deep dive: Section 9.3_

## Best Practices

1. **Fix findings between loops** — do not just document them. Reactive correction is mandatory. (Section 3)
2. **Start conservative** — if you're unsure between two severity levels, pick the higher one. You can always downgrade with evidence.
3. **Cite evidence for every "Verified"** — the worksheet is only as trustworthy as its evidence.
4. **Don't assign 95%+ in Loop 1** — Loop 1 is a surface pass. If you scored high, you stopped looking too early.
5. **Don't round up** — 93% is 93%. The gate is not a negotiation.
6. **Batch related findings** — multiple related issues across files go in one CCR run, not separate threads.
7. **Scope each loop** — Loop 1 reads the specific file. Loop 2 expands to related surfaces. Loop 3 reads only the fix and its verification criteria. Don't re-process the whole repo every loop.
8. **Use the decision tree** — match your review type to the right variable item set before starting. (Section 2.5)
9. **Peer review near-threshold scores** — if your final score is 95-97%, have a second reviewer verify the worksheet.
10. **Track scores over time** — consistent patterns reveal systemic gaps that individual CCR runs won't catch. (Section 11.4)

## Risks to Watch For

| Risk                       | What It Looks Like                                                  | Mitigation                                                                     |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Form without substance** | Loops run as checkbox exercise, 95% assigned without pressure       | Model honest scrutiny. The loops only work if you're willing to stop.          |
| **Score inflation**        | "Partial" assigned to findings that are actually "Unverified"       | Peer review of worksheets. Evidence requirement for "Verified."                |
| **Overhead avoidance**     | Team skips CCR on "small" changes that turn out to be not small     | Use CCR Lite for genuinely small changes. If criteria fail, escalate.          |
| **Late discovery cost**    | Finding surfaces in production instead of Loop 1                    | The loop position penalty makes late discovery mathematically expensive.       |
| **Governance drift**       | Someone modifies CLAUDE.md or this protocol without elevated review | Governance artifacts require 5+ loops. Protocol requires CCR to modify itself. |

---

## Document Map

Everything above is the 2-page summary. Everything below is the supporting deep dive, organized by section:

| Section                   | What It Covers                                                    | Start Here If You Need                            |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Quick Reference Card      | Cheat sheet for daily use                                         | A one-glance reminder during a CCR run            |
| 1. Foundation             | Three layers, origin, transparency notes                          | Understanding the philosophical basis             |
| 2. Execution              | Loops, gates, scoring formula, heuristics, worked example         | The full math and mechanics                       |
| 3. Reactive Correction    | Fix-between-loops mandate, penalty math, bidirectional correction | Understanding why "report and move on" fails      |
| 4. Governance Protection  | Document hierarchy, self-protection, when docs should change      | Modifying CLAUDE.md, STORIES.md, or this protocol |
| 5. Threshold Decision     | Why 95%, why not 99%, advancement framework                       | Defending the threshold to stakeholders           |
| 6. Operational Standards  | Chunking, output format, anti-patterns                            | Running CCR efficiently and avoiding pitfalls     |
| 7. Practical Application  | CCR Lite, escalation, time-boxing, peer review                    | Day-to-day operational questions                  |
| 8. Cross-Discipline       | All Scrum roles, IT ops, professions, universal standard          | Applying CCR outside Engineering                  |
| 9. Presenting to a Team   | Merits, risks, rigidity answer, how to walk into the room         | Rolling CCR out to a new team                     |
| 10. Regulatory Extensions | HIPAA, COPPA, Compound — full worksheets and formulas             | Regulated surfaces (PHI, child data)              |
| 11. Reference             | Worked examples, onboarding, calibration, glossary, doc info      | Getting started, training new team members        |

---

## Quick Reference Card

```
EVERY CCR RUN:

1. Classify    → Standard (3 loops) | Security (3-4) | CCR Lite (1 loop, low-risk only)
2. Pick items  → Base items (always) + Variable items (match your review type)
3. Loop 1      → Surface pass. Find obvious gaps. Score. Fix findings. Gate ≥ 95%.
4. Loop 2      → Pressure pass. Find what Loop 1 missed. Score. Fix findings. Gate ≥ 95%.
5. Loop 3      → Confirmation. Verify stability. Score must hold or improve. Ships.
6. Output      → Scoring worksheet + scope + commit sequence + verification checklist.

SCORING:
  Score = 100 - Σ(finding × severity weight × heuristic modifiers)
  Weights: Regulatory Required 25 | Critical 15 | High 10 | Medium 5 | Low 2
  Gate: ≥ 95% advance. < 95% stop and fix. Score drops between loops = stop.

THREE LAYERS (every loop runs all three):
  Critical:     What is the most dangerous assumption — verified or assumed?
  Conservative: What is the worst-case if I am wrong — does the fix still hold?
  Recursive:    Has my score held, improved, or degraded — honestly?

KEY RULES:
  • Fix findings between loops — do not just report them
  • "Verified" requires citable evidence — not "I looked at it"
  • 93% is 93% — the gate is not a negotiation
  • Loops run sequentially — never in parallel
  • Governance docs (CLAUDE.md, protocol, STORIES.md) require 5+ loops
```

---

## 1. Foundation

### 1.1 Overview

The CCR Protocol is a self-validating review framework. Its core contract:

> **AI-assisted output does not earn artifact status — merged PR, shipped fix, documented decision — until it survives recursive confidence testing at or above 95%. Below that threshold, the loop pauses, findings are corrected, and the process surfaces to a human. Above it, the artifact ships.**

CCR is not a checklist. It is a pressure-testing discipline applied in layers, recursively, until the conclusion is durable — not just correct on first read.

### 1.2 Origin

CCR stands for **Critical, Conservative, Recursive.** The framework originated as a personal cognitive model for high-stakes decision analysis and was formalized into an engineering review protocol for AI-assisted development workflows. The discipline behind it cannot be copied by copying the structure. The loops only work if the reviewer is genuinely willing to stop.

### 1.3 The Three Layers

Every loop runs all three layers in sequence. The output of one layer becomes the pressure input of the next.

#### Layer 1 — Critical

**Purpose:** Strip assumption. Find what is actually true versus what is remembered or assumed to be true.

> _What is the most dangerous assumption in this analysis — and has it been verified, or only assumed?_

A finding is not critical because it is large. It is critical because it is load-bearing — the rest of the analysis depends on it being true.

#### Layer 2 — Conservative

**Purpose:** Validate the floor, not the ceiling. Assume the worst-case path is possible and confirm the decision still holds.

> _What is the worst-case outcome if Loop 1's findings are incomplete — and does the proposed fix still hold under that scenario?_

The Conservative layer does not look for reasons to proceed. It looks for reasons the proposed action fails under pressure.

Key Conservative behaviors:

- Flag partial fixes as potentially worse than no fix — they produce false documented closure
- Require floor validation before ceiling analysis
- Treat "it works in my environment" as an unverified assumption until proven otherwise

#### Layer 3 — Recursive

**Purpose:** Confirm the conclusion is stable across all loops. Test for confidence decay, not just correctness.

> _Has my confidence score held, improved, or degraded across all loops — and is that movement honest?_

Confidence that only survives one pass is not confidence. It is optimism. The Recursive layer detects artificial inflation — conclusions that feel solid because they have not been pressured, not because they actually are.

### 1.4 Transparency Notes

The following properties of the protocol are stated here for honesty and auditability:

**On the 95% threshold:** The threshold is inspired by Sir Ronald Fisher's 1925 convention (p < 0.05, ~2 standard deviations) which has governed statistical significance for a century. However, Fisher's 95% is a probability statement on continuous distributions. CCR's 95% is a weighted completeness metric on a discrete checklist. The analogy is inspirational, not derivational. The threshold is defensible as a calibration point — high enough to filter noise, low enough to remain achievable — without claiming statistical derivation. See Section 5 for the full threshold decision and advancement framework.

**On severity weights:** The weights (25/15/10/5/2) are calibration constants validated through application, not mathematically derived values. This is standard practice — CVSS, FMEA, and ISO 31000 all use calibrated weights. The absolute score is less meaningful than the relative score between loops. Weight values are part of the invariant core and are not team-adjustable — changing them breaks cross-team score comparability.

**On repeatability:** Two reviewers running CCR on the same artifact may produce different scores because finding identification, severity classification, and state assignment are judgment calls. CCR structures that judgment (scored, worksheeted, auditable) but cannot eliminate it. See Section 11.3 for calibration exercises that establish baseline inter-rater reliability.

**On the scoring model:** Starting at 100 assumes "complete until proven otherwise." Unknown unknowns — things the reviewer never considered — are not captured. The base item "Full surface mapped" partially addresses this, but the score reflects verified risk, not total risk. A 95% score means "5% of identified risk remains, bounded and named" — not "5% chance of failure."

---

## 2. Execution

### 2.1 The 3-Loop Design

CCR runs a minimum of three loops for any standard review. Each loop is a complete pass through all three layers. The loops are sequential — the output of each loop is the pressure input of the next.

```
Loop 1 → Surface Pass
Loop 2 → Pressure Pass
Loop 3 → Confirmation Pass
```

#### Loop 1 — Surface Pass

**Goal:** Find what is obviously wrong. Cast wide. Do not try to find everything.

| Layer        | Question                                                |
| ------------ | ------------------------------------------------------- |
| Critical     | What is the most dangerous assumption in this analysis? |
| Conservative | What is the worst-case outcome if I am wrong here?      |
| Recursive    | Did this pass change my confidence score up or down?    |

**Gate:** Score. **Fix all actionable findings** (see Section 3). Then:

- Score **< 95%** → Stop. Surface finding to human. Do not proceed to Loop 2.
- Score **≥ 95%** → Advance to Loop 2.

**What Loop 1 finds:** Obvious gaps, unverified environmental assumptions, scope boundaries.
**What Loop 1 misses by design:** Systemic patterns, edge cases, drift risks. That is Loop 2's job.

#### Loop 2 — Pressure Pass

**Goal:** Find what Loop 1 did not find. Target gaps, edges, and things that looked solved but were not verified.

| Layer        | Question                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Critical     | What did I assume was solved that I never actually verified?                 |
| Conservative | Does the floor still hold under the findings from Loop 1?                    |
| Recursive    | Is my confidence score from Loop 1 still defensible, or did Loop 2 erode it? |

**Gate:** Score. **Fix all actionable findings.** Then:

- Score **drops below 95%** → Stop. Loop 1's confidence was false. Surface to human.
- Score **holds or improves** → Advance to Loop 3.

**Critical rule:** If Loop 2 reveals the problem is systemic rather than isolated, do not attempt a partial fix. Scope the full surface before advancing.

**What Loop 2 finds:** Systemic patterns missed by Loop 1, environmental dependencies, scope expansion, repeated anti-patterns across the codebase.

#### Loop 3 — Confirmation Pass

**Goal:** Confirm the conclusion is stable. This loop is not looking for new problems. It is confirming the solution survives scrutiny without artificial inflation.

| Layer        | Question                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| Critical     | Is there anything I am still rationalizing rather than verifying?               |
| Conservative | Would I be comfortable defending this output if it shipped and something broke? |
| Recursive    | Has the score held across all three loops without artificial inflation?         |

**Gate:** Score. Then:

- Score **< 95%** → Do not ship. Return to Loop 2 with new findings.
- Score **≥ 95%** and **stable or improved from Loop 2** → Output earns artifact status. Ships.

**Confidence Decay Rule:** If your score in Loop 3 is lower than your score in Loop 2, the process does not advance. A degrading score means new risk was uncovered that was not present in prior loops. This is not a failure of the protocol — it is the protocol working correctly.

### 2.2 Loop Count Reference

Three loops is the minimum for standard reviews. Some scenarios require more.

| Scenario                                         | Loops Required                  |
| ------------------------------------------------ | ------------------------------- |
| Low-risk change (CCR Lite — see Section 7.1)     | 1                               |
| Standard bug fix, isolated scope                 | 3                               |
| Security vulnerability remediation               | 3-4                             |
| Major version upgrade (framework, runtime)       | 4-5                             |
| Architecture change touching multiple services   | 5+                              |
| Regulatory or compliance surface                 | 5+, human gate after every loop |
| Governance artifact modification (see Section 4) | 5+, human gate after every loop |

**The rule:** Run loops until the score is stable across two consecutive loops at or above 95%. Stability, not just threshold, is the signal.

### 2.3 The Human Gate

The human gate is not a failure state. It is a design feature.

When a loop produces a score below 95%, the protocol does not retry automatically. It surfaces the specific finding and waits for a human to close it before the next loop begins.

**What the human gate surfaces:**

- The specific question that produced the confidence drop
- The information needed to answer it
- The loop number and layer where the gap was found

**What the human gate does not do:**

- Guess at the answer
- Proceed with an assumed resolution
- Treat silence as confirmation

### 2.4 The Confidence Score — Scoring Model

The confidence score is the protocol's quality gate. It is a weighted deduction from a baseline of 100. Every unresolved finding deducts points based on severity. The score after all deductions is the confidence score for that loop.

```
Score = 100 - Σ(unresolved finding × severity weight)
```

With heuristic modifiers applied (see Section 2.6):

```
Score = 100 - Σ(
  base_deduction
  × loop_position_weight
  × surface_breadth_scalar
  × environment_modifier
  + correlation_adjustment
)
```

#### Scoring Reference

| Score   | State                                      | Action                                                      |
| ------- | ------------------------------------------ | ----------------------------------------------------------- |
| < 70%   | Significant unknowns remain                | Stop. Surface immediately. Gather inputs before re-running. |
| 70-84%  | Scope partially mapped, gaps named         | Stop. Surface specific gaps. Do not advance.                |
| 85-94%  | Most risks identified, mitigations partial | Stop. Mitigations must be complete before advancing.        |
| 95-97%  | Full scope confirmed, mitigations in place | Advance. Output may ship with documented assumptions.       |
| 98-100% | All risks verified, no open assumptions    | Advance. Output ships clean.                                |

### 2.5 Scoring Items

#### Tier 1 — Base Items (Universal, Every CCR Run)

These five items apply to every CCR run regardless of what is being reviewed. They are non-negotiable. If any base item fails, the score cannot exceed 70% regardless of how well everything else performs.

| Base Item                                              | Deduction if Unresolved |
| ------------------------------------------------------ | ----------------------- |
| Environmental assumptions verified — not just stated   | 15 points               |
| Full surface mapped — no unknown surfaces remain       | 15 points               |
| Partial fix risk assessed — not creating false closure | 10 points               |
| Chunk scope correctly defined for this loop            | 10 points               |
| Human gate not bypassed — no assumed resolutions       | 15 points               |

**Maximum base deduction: 65 points.** All five failing produces a score of 35%.

#### Tier 2 — Variable Items (Application-Specific)

These items are scoped to what is being reviewed. The set changes per application. The severity weights are fixed across all applications — they are invariant core, not team-adjustable.

| Severity            | Deduction per Finding | Definition                                                  |
| ------------------- | --------------------- | ----------------------------------------------------------- |
| Regulatory Required | 25 points             | Federal legal obligation. No partial credit.                |
| Security Critical   | 15 points             | Security finding with exploit potential. No partial credit. |
| Critical            | 15 points             | Load-bearing. The analysis fails if this is wrong.          |
| High                | 10 points             | Significant impact. Creates downstream risk if unresolved.  |
| Medium              | 5 points              | Real gap. Manageable if named and bounded.                  |
| Low                 | 2 points              | Improvement. Not a blocker.                                 |

**Security Critical note:** Like Regulatory Required, Security Critical findings receive no partial credit. A security vulnerability is either verified closed or the artifact does not ship. "Partially mitigated" is not a shipping state for security findings.

#### Variable Item Sets by Application Type

**Decision tree — which set to use:**

```
What are you reviewing?
├── Security fix or vulnerability? ──→ Security Review set
├── Framework/runtime upgrade?     ──→ Framework Upgrade set
├── Isolated bug fix?              ──→ Standard Bug Fix set
├── Architecture change?           ──→ Define custom set (start from closest match)
├── Regulatory surface?            ──→ Base set + regulatory extension (Section 10)
└── None of the above?             ──→ Define custom set using severity weights above
```

**Security Review:**

| Item                                             | Severity          |
| ------------------------------------------------ | ----------------- |
| Preflight handler verified                       | Security Critical |
| All surfaces scanned, not just the reported one  | Critical          |
| Auth surface included in scope                   | High              |
| No partial fix creating documented false closure | High              |
| CSP headers assessed                             | Medium            |

**Framework Upgrade:**

| Item                                                | Severity |
| --------------------------------------------------- | -------- |
| Runtime compatibility confirmed in all environments | Critical |
| Full import migration surface mapped                | Critical |
| Security library rewrite scoped                     | High     |
| ORM/persistence breaking changes assessed           | High     |
| Commit sequence bisectable                          | Medium   |

**Standard Bug Fix:**

| Item                                                | Severity |
| --------------------------------------------------- | -------- |
| Reproduction confirmed — not assumed                | Critical |
| Regression test exists or created                   | High     |
| No related surfaces carrying same pattern           | Medium   |
| Commit is isolated — not bundled with other changes | Medium   |

#### Partial Credit Rules

Every finding carries one of three verification states:

| State              | Credit Applied            | Evidence Required                                                                        |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| Verified           | Full credit — 0 deduction | Citable evidence: test result, code path, config value, log entry, screenshot            |
| Partially verified | Half deduction            | Gap named, bounded, and documented with reason why full verification is not yet possible |
| Unverified         | Full deduction            | Unknown, assumed, or "I looked at it and it seems fine"                                  |

**"Verified" requires evidence.** A reviewer stating "I checked this" without citing what they checked is Partial, not Verified. Evidence is what makes the worksheet auditable. Without it, the score is a feeling with math around it.

**No partial credit exceptions:** Regulatory Required and Security Critical findings do not receive partial credit. They are either Verified (0 deduction) or Unverified (full deduction). Partial implementation of a Required specification or a security fix is treated as Unverified until complete.

### 2.6 Heuristic Modifiers

The base deduction model is flat — every finding of the same severity costs the same regardless of context. Heuristics add intelligence. They are multipliers applied after the base deduction, making the score context-aware.

Applied in order: assign base → apply loop position → apply surface breadth → apply environment modifier → check correlation → check systemic pattern promotion.

#### Heuristic 1 — Loop Position Penalty

A finding discovered for the first time in Loop 3 is more damaging than the same finding in Loop 1.

```
Loop 1 discovery → deduction × 1.0  (baseline)
Loop 2 discovery → deduction × 1.25 (should have been found in Loop 1)
Loop 3 discovery → deduction × 1.5  (Loop 2 failed its job)
```

A Critical finding (15 points) discovered first in Loop 3 deducts `15 × 1.5 = 22.5 points`.

#### Heuristic 2 — Correlation Multiplier

When two findings are causally related — one enables or amplifies the other — their combined deduction compounds rather than adds.

```
Two correlated findings   → (deduction_A + deduction_B) × 1.5
Three correlated findings → (deduction_A + deduction_B + deduction_C) × 2.0
```

Independent findings add. Correlated findings compound.

#### Heuristic 3 — Surface Breadth Scalar

A finding affecting one file is not the same as a finding affecting ten. Breadth scales logarithmically — the most mathematically grounded heuristic in the set (information theory basis).

```
Deduction × log₂(N + 1)   where N = number of surfaces affected
```

| Surfaces Affected | Scalar | 15pt Critical Becomes |
| ----------------- | ------ | --------------------- |
| 1                 | 1.00   | 15.0 pts              |
| 2                 | 1.58   | 23.7 pts              |
| 4                 | 2.32   | 34.8 pts              |
| 8                 | 3.17   | 47.5 pts              |
| 16                | 4.09   | 61.4 pts              |

#### Heuristic 4 — Systemic Pattern Auto-Promotion

When the same finding appears in 3 or more locations it is no longer an isolated bug — it is an architectural pattern. Severity automatically promotes one tier.

```
Finding in 1-2 locations → assigned severity (no change)
Finding in 3+ locations  → severity promotes one tier

Low      → Medium
Medium   → High
High     → Critical
Critical → Critical + Correlation Multiplier applied
```

#### Heuristic 5 — Environment Risk Modifier

The same finding carries different real-world weight depending on where it lives.

```
Staging / development only              → deduction × 0.75
Standard production surface             → deduction × 1.0  (baseline)
Production + user PII in scope          → deduction × 1.25
Regulated surface (HIPAA, PCI, COPPA)   → deduction × 1.5
```

#### Heuristic Constants — Transparency

| Heuristic               | Constants               | Basis                                                     |
| ----------------------- | ----------------------- | --------------------------------------------------------- |
| H1 — Loop Position      | 1.0 / 1.25 / 1.5        | Calibrated. Inspired by Boehm's defect cost curve.        |
| H2 — Correlation        | 1.5x / 2.0x             | Calibrated. Risk compounding convention.                  |
| H3 — Surface Breadth    | log₂(N+1)               | **Derived.** Information theory. Mathematically grounded. |
| H4 — Systemic Promotion | 3+ threshold            | Calibrated. Rule-of-three convention across disciplines.  |
| H5 — Environment        | 0.75 / 1.0 / 1.25 / 1.5 | Calibrated. Risk assessment convention.                   |

#### Worked Scoring Example — Full Heuristics Applied

**CORS Security Review — Production Surface:**

_Loop 1:_

| Finding                   | Base | Loop × | Breadth N=2 × | Env × | Subtotal |
| ------------------------- | ---- | ------ | ------------- | ----- | -------- |
| Full surface unmapped     | 15   | 1.0    | 1.58          | 1.0   | 23.7     |
| OPTIONS preflight unknown | 15   | 1.0    | 1.58          | 1.0   | 23.7     |

Correlation check: causally linked → `(23.7 + 23.7) × 1.5 = 71.1 pts`
**Loop 1 Score: 100 - 71.1 = 28.9%.** Hard stop. Surface immediately.

**Reactive correction applied:** Grep full codebase for CORS handlers. OPTIONS branch identified. Second handler (qr.ts) discovered.

_Loop 2 — after corrections applied:_

| Finding             | Base | State      | Partial × | Loop × | Breadth × | Env × | Subtotal |
| ------------------- | ---- | ---------- | --------- | ------ | --------- | ----- | -------- |
| Full surface mapped | 15   | Partial    | 0.5       | 1.25   | 1.58      | 1.0   | 14.8     |
| Preflight verified  | 15   | Verified   | 0         | —      | —         | —     | 0        |
| qr.ts unscanned     | 15   | Unverified | 1.0       | 1.25   | 1.0       | 1.0   | 18.75    |

**Loop 2 Score: 100 - 14.8 - 18.75 = 66.4%.** Below 95%. Surface to human. Full surface grep confirms scope.

**Reactive correction applied:** qr.ts scanned, shared CORS config constant created, both handlers patched.

_Loop 3 — after corrections applied:_

All items verified. Zero deductions.
**Loop 3 Score: 100%.** Cleared. Ships.

**Without CCR:** Patch main handler only. Preflight still returns wildcard. Second handler untouched. False closure documented.
**With CCR:** Shared `cors.config.ts`, both handlers patched in main and preflight, four tests gating merge.

---

## 3. Reactive Correction Rule

### 3.1 The Principle

> **When a CCR loop identifies an actionable finding, the finding must be corrected before the next loop begins. Findings drive fixes, not just reports.**

This is a structural requirement of the protocol, not a recommendation. The protocol's value proposition is that it catches problems early. Catching a problem and not fixing it is the definition of false documented closure — the anti-pattern the Conservative layer exists to prevent.

### 3.2 What "Actionable" Means

A finding is actionable when the reviewer can take a concrete step to resolve it within the current assessment scope. Not all findings are actionable — some require external input (human gate), infrastructure changes, or scope expansion beyond the current review.

| Finding Type                                        | Actionable? | Required Response                            |
| --------------------------------------------------- | ----------- | -------------------------------------------- |
| Code gap identified, fix known                      | **Yes**     | Fix before next loop                         |
| Missing test identified                             | **Yes**     | Write test before next loop                  |
| Environmental assumption unverified, can be checked | **Yes**     | Verify before next loop                      |
| Requires information from another team member       | **No**      | Human gate — surface and wait                |
| Requires infrastructure not yet provisioned         | **No**      | Document as pre-condition, carry as Partial  |
| Scope expansion beyond current review               | **No**      | Document new scope, may trigger separate CCR |

### 3.3 The Penalty for Non-Correction

A finding identified in Loop N that is actionable but uncorrected in Loop N+1 receives the loop position penalty as if discovered new in Loop N+1. The reviewer already knew about it. Choosing not to fix it is not a discovery — it is negligence the math penalizes.

```
Finding identified in Loop 1, not fixed:
  Loop 2 scores it at × 1.25 (not × 1.0)
  Loop 3 scores it at × 1.5  (not × 1.0)

Finding identified in Loop 2, not fixed:
  Loop 3 scores it at × 1.5  (not × 1.25)
```

This makes non-correction mathematically expensive. A Critical finding (15 pts) known since Loop 1 but unfixed in Loop 3 costs `15 × 1.5 = 22.5 pts` — 50% more than if it had been found fresh in Loop 1 and fixed immediately.

### 3.4 Bidirectional Correction

Reactive correction is not just "fix the code." It includes updating the variable item set when a loop reveals items the original set didn't include.

```
Loop discovers a surface not in the variable item set
  → Add the item to the variable set
  → Re-score the current loop with the expanded set
  → The expanded set carries forward to all subsequent loops
```

The variable item set is a living artifact during a CCR run. It grows as the loops reveal scope. It never shrinks — items are not removed mid-assessment.

### 3.5 Correction Documentation

Every correction made between loops is documented in the scoring worksheet under the loop that triggered it. The next loop's worksheet references what was corrected.

```markdown
**Corrections Applied Between Loop [N] and Loop [N+1]:**

- [Finding]: [What was corrected] — [Evidence of correction]
- [Finding]: [What was corrected] — [Evidence of correction]
- [Variable item set change]: Added [item] at [severity] — triggered by [finding]
```

---

## 4. Governance Artifact Protection

### 4.1 The Principle

> **Governance artifacts are load-bearing for all downstream work. A bad change to a governance document propagates to every session, every story, every implementation. These documents require elevated CCR rigor before modification.**

Governance artifacts are not code — they are the control plane for decision-making. They carry more systemic risk than any single code change because they define the rules all code changes follow.

### 4.2 Document Hierarchy

```
Tier 1 — Protocol Documents (highest protection)
  • CCR Protocol itself (.claude/skills/ccr-protocol.md)
  • Any adopted standard or methodology document

Tier 2 — Project Governance Documents
  • CLAUDE.md (persistent brain — project context)
  • STORIES.md (work queue — story registry)
  • Architecture decision records

Tier 3 — Specification Documents
  • API contracts
  • Schema definitions
  • Migration guides
  • Detailed story specs

Tier 4 — Standard Code (baseline protection)
  • Application code
  • Tests
  • Configuration
```

### 4.3 Protection Requirements by Tier

| Tier                   | Min Loops | Human Gate | Environment Modifier      | Additional Requirements                                                 |
| ---------------------- | --------- | ---------- | ------------------------- | ----------------------------------------------------------------------- |
| Tier 1 — Protocol      | 5+        | Every loop | × 1.5                     | Requires CCR to modify CCR. Peer review of scoring worksheet mandatory. |
| Tier 2 — Governance    | 5+        | Every loop | × 1.25                    | Changes must be justified by CCR findings or explicit user instruction. |
| Tier 3 — Specification | 3+        | Loops 1, 3 | × 1.0                     | Changes must maintain backward compatibility or version explicitly.     |
| Tier 4 — Standard      | 3         | As needed  | Determined by environment | Standard CCR rules apply.                                               |

### 4.4 Self-Protection — Modifying the Protocol

The CCR Protocol requires CCR to modify itself. This is not circular — it is a governance control that prevents casual or unreviewed changes to the standard all other reviews depend on.

**To modify this protocol:**

1. The proposed change must be justified by CCR findings (a gap identified during a CCR run) or explicit direction from the protocol owner
2. The modification is assessed using CCR at Tier 1 protection (5+ loops, human gate every loop, × 1.5 environment modifier)
3. The scoring worksheet is peer-reviewed — the modifier cannot be the sole reviewer of changes to the protocol they are modifying
4. Version history is updated with the change description

**What this prevents:**

- Casual threshold adjustments ("let's just use 90% for this sprint")
- Weight changes that break cross-team comparability
- Structural changes without impact assessment
- Erosion of the invariant core through incremental modifications

### 4.5 When Governance Documents Should Change

Governance documents are not frozen. They should change when:

- CCR loops consistently reveal a gap in the document (systemic finding across multiple CCR runs)
- The project's architecture or phase changes (Phase 1 → Phase 2 transition)
- The protocol owner explicitly directs a change
- A regulatory requirement mandates a change

Governance documents should NOT change when:

- A single CCR run produces a finding that is more easily fixed in code than in the document
- A reviewer finds the document inconvenient for a specific task
- A change would make the current task easier but weaken the standard for all future tasks

---

## 5. Threshold Decision and Advancement Framework

### 5.1 Why 95%

The 95% threshold is a calibration point validated by a century of use across scientific disciplines. It is not arbitrary, but it is also not derived from the CCR scoring model itself — it is adopted as the balance point between rigor and delivery velocity.

| Reason                  | What It Means for CCR                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| **Reasonably high bar** | 1-in-20 residual risk tolerance. Filters noise, makes signal trustworthy.                     |
| **Reasonably low bar**  | Achievable under real engineering conditions without destroying velocity.                     |
| **Ubiquitous**          | Scores are comparable across teams, disciplines, and organizations running the same standard. |
| **Practical**           | Validated across disciplines — medicine, engineering, finance — for a century.                |

The 5% residual is not ignored. It is documented, named, and bounded in the scoring worksheet as Partial items that carry forward explicitly to the next phase.

### 5.2 Why NOT 99% — The Cost Architecture

Moving from 95% to 99% is not a 4% increase in rigor. It is a multiplicative increase in loop count, token processing, and human gate cycles. The cost compounds — it does not scale linearly with the threshold.

At current infrastructure conditions — cloud-hosted LLMs with external per-token billing — the additional cost of the loops required to reach 99% stability exceeds the risk reduction those loops produce. The remaining risk is better handled by named Partial items than by additional loops at current token cost.

This is not compromise. It is optimization:

```
Token cost model  ×  Chunking efficiency  ×  Engineering velocity
──────────────────────────────────────────────────────────
= Correct threshold for the current infrastructure tier
```

The regulated surface problem is solved architecturally by the HIPAA and COPPA extensions — they elevate protection on those surfaces without raising the cost across the entire protocol.

### 5.3 The Advancement Framework — Path to 99%

95% is the correct threshold for the current infrastructure environment. It is not a permanent ceiling. It is an infrastructure-gated decision. The path to 99% is pre-conditioned — three gates must all be open simultaneously before the pursuit is justified.

```
CURRENT STATE
─────────────────────────────────────────────────────────
Infrastructure:  Cloud-hosted LLMs
Token cost:      External, per-token billing
Chunking:        Standard efficiency
Threshold:       95%
Status:          ACTIVE — correct for this infrastructure tier

        ↓ Pre-condition 1: Token cost internalized
        ↓ Pre-condition 2: Chunking and batching at high degree
        ↓ Pre-condition 3: Engineering efficiency validated

FUTURE STATE
─────────────────────────────────────────────────────────
Infrastructure:  In-house or local LLMs
Token cost:      Infrastructure cost, not per-transaction
Chunking:        High degree applied
Threshold:       99% pursuable
Status:          PURSUE — only when all three pre-conditions met
```

### 5.4 The Three Pre-Conditions — Defined

**Pre-condition 1 — Token Cost Internalized**
LLMs running in-house or locally. Marginal token cost is controlled and not externally billed per token. The cost of an additional loop is an infrastructure cost, not a per-transaction cost. Cloud-hosted models with external billing do not satisfy this pre-condition regardless of volume discounts.

**Pre-condition 2 — Chunking and Batching at High Degree**
The protocol running at full efficiency. Context windows scoped correctly per loop. Related findings batched into single passes. Overhead per loop minimized before the threshold rises. Advancing the threshold without maximizing chunking efficiency first produces diminishing returns.

**Pre-condition 3 — Engineering Efficiency Validated**
The team running CCR fast enough that additional loops do not materially delay delivery velocity. Loop performance instrumented and measured. The team can absorb additional loops without delivery degradation.

**The pre-conditions are conjunctive, not disjunctive.** Two of three is not sufficient. All three must be met simultaneously. This is directly tied to cost and engineering efficiency — the pursuit of 99% is an economic decision, not an aspiration.

### 5.5 Why This Matters

Engineers watching the local LLM space — Ollama, llama.cpp, local model deployments — will recognize that the protocol has a growth path built into its own standard. The pursuit of 99% is not aspirational. It is pre-conditioned and achievable. The infrastructure has to get there first.

---

## 6. Operational Standards

### 6.1 Token Efficiency — Chunking and Batching

CCR is designed to run with AI assistance. Token cost is a real operational consideration. The key to keeping CCR sustainable is chunking and batching — structuring how context is fed into each loop so the entire codebase is not re-processed on every pass.

#### Chunking

Each loop operates on a defined, scoped chunk of context — not the full repo, not the full PR.

| Loop | Default Chunk Scope                                    |
| ---- | ------------------------------------------------------ |
| 1    | The specific file, function, or component under review |
| 2    | The expanded surface revealed by Loop 1 findings       |
| 3    | The proposed fix and its verification criteria only    |

This is not a shortcut. It is the correct design. Loop 1 does not need the full dependency tree — it needs the most dangerous assumption. Loop 3 does not need the original problem statement — it needs the solution and its mitigations.

#### Batching

Where multiple related findings exist — across files, handlers, or components — batch them into a single loop pass rather than running separate CCR threads per finding.

#### The Default Rule

The chunking standard above is always applied unless explicitly overridden. An override requires a direct instruction that names the expanded scope — for example:

> _"assess impact on feature"_
> _"run against the full auth surface"_
> _"include all downstream consumers"_

Absent an explicit instruction, the loop operates on the default chunk. Scope creep is not a judgment call — it requires a named instruction to trigger.

### 6.2 Output Format

When the loop process clears threshold, the output follows this standard structure:

```markdown
## [Fix/Change Name] — CCR Verified

**Loop Summary**
| Loop | Confidence | Key Finding |
|------|-----------|-------------|
| 1 | XX% | [What Loop 1 found] |
| 2 | XX% | [What Loop 2 found] |
| 3 | XX% | [What Loop 3 confirmed] |

**Corrections Applied Between Loops**

- Loop 1→2: [Finding corrected] — [Evidence]
- Loop 2→3: [Finding corrected] — [Evidence]

**Scoring Worksheet — Loop [N]**
| Item | Tier | Severity | State | Evidence | Deduction |
|------|------|----------|-------|----------|-----------|
| Environmental assumptions verified | Base | — | V/P/U | [cite] | 0/half/full |
| Full surface mapped | Base | — | V/P/U | [cite] | 0/half/full |
| Partial fix risk assessed | Base | — | V/P/U | [cite] | 0/half/full |
| Chunk scope correctly defined | Base | — | V/P/U | [cite] | 0/half/full |
| Human gate not bypassed | Base | — | V/P/U | [cite] | 0/half/full |
| [Variable item 1] | Variable | Sev | V/P/U | [cite] | 0/half/full |
| [Variable item 2] | Variable | Sev | V/P/U | [cite] | 0/half/full |
| **Total deduction** | | | | | **-XX** |
| **Score** | | | | | **100 - XX = XX%** |

**Scope (Confirmed)**

- [File/component 1]: [Change required]
- [File/component 2]: [Change required]

**Pre-conditions**

- [ ] [Requirement 1 before merge]
- [ ] [Requirement 2 before merge]

**Commit Sequence**

1. [First commit — scope and purpose]
2. [Second commit — scope and purpose]

**Verification**

- [ ] [Post-merge check 1]
- [ ] [Post-merge check 2]

**Review Gates**

- [Commit X]: Requires [specific reviewer qualification]
```

**Artifact retention:** Scoring worksheets are stored alongside the artifact they assess — in PR descriptions, commit messages, or dedicated review files. Worksheets for Tier 1 and Tier 2 governance artifacts are retained indefinitely. Standard code review worksheets follow the project's document retention policy.

### 6.3 Anti-Patterns

These behaviors indicate the protocol is being executed in form but not in substance.

| Anti-Pattern                                        | Why It Breaks CCR                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Assigning 95%+ in Loop 1                            | Loop 1 is a surface pass. A high score means the reviewer stopped looking too early.                    |
| Reporting findings without fixing them              | Reactive correction is mandatory. Reporting without fixing is false documented closure.                 |
| Combining commits to save time                      | Merged scope cannot be bisected. A regression becomes invisible.                                        |
| Treating compilation as correctness                 | Code that compiles can fail at runtime. The compiler is not the test suite.                             |
| Carrying Loop 1 scope into Loop 3 without expansion | If Loop 2 did not expand scope, Loop 2 was not run honestly.                                            |
| Rounding up to 95%                                  | If the score is 93%, it is 93%. The gate is not a negotiation.                                          |
| Running loops in parallel                           | The output of Loop N is the pressure input of Loop N+1. Parallel execution breaks the recursive design. |
| Expanding scope without a named instruction         | Scope creep requires an explicit override. Silent expansion violates the default chunk rule.            |
| Claiming "Verified" without citable evidence        | "I looked at it" is Partial, not Verified. Evidence is what makes the worksheet auditable.              |
| Modifying governance docs without elevated CCR      | Governance artifacts require Tier 1/2 protection. Standard CCR is insufficient.                         |

---

## 7. Practical Application

### 7.1 CCR Lite — Fast Path for Low-Risk Changes

Not every change warrants three full loops. CCR Lite is a single-loop assessment for changes that are low-risk, isolated, and easily reversible.

**Eligibility criteria — ALL must be true:**

| Criterion                  | Question                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Isolated                   | Does this change touch only one file or one narrowly-scoped surface?                |
| Reversible                 | Can this be reverted with a single commit and zero data impact?                     |
| Non-functional or cosmetic | Is this a typo fix, comment update, formatting change, or documentation correction? |
| No security surface        | Does this change touch zero auth, encryption, PII, or access control code?          |
| No governance artifact     | Is this a Tier 4 document (standard code), not Tier 1-3?                            |
| No external contract       | Does this change zero API contracts, schemas, or public interfaces?                 |

**If any criterion is false → Standard CCR (3+ loops).**

**CCR Lite process:**

1. Run one loop through all three layers (Critical, Conservative, Recursive)
2. Score using base items only (no variable items required for CCR Lite)
3. Gate: ≥ 95% → Ships with `CCR Lite` label on worksheet
4. Gate: < 95% → Escalate to standard CCR. The change was not as low-risk as classified.

**CCR Lite output (abbreviated):**

```markdown
## [Change Name] — CCR Lite

**Classification:** Low-risk | Eligibility: [all criteria confirmed]
**Score:** XX%
**Key finding:** [Finding or "None — clean pass"]
**Ships:** Yes / No → Escalate to standard CCR
```

### 7.2 Escalation Paths

#### When the score is stuck below 95%

If the score remains below 95% after completing the standard loop count for the scenario type, escalate — do not loop indefinitely.

```
Standard (3 loops): Score stuck after Loop 3
  → Escalation 1: Expand chunk scope and run Loop 4
  → Escalation 2: Bring in second reviewer for peer scoring
  → Escalation 3: Restructure the change — it may be too large for a single CCR

Security (3-4 loops): Score stuck after Loop 4
  → Escalation 1: Peer review of scoring worksheet
  → Escalation 2: Split the change into smaller, independently assessable units
  → Escalation 3: Human gate to protocol owner or security lead

Architecture (5+ loops): Score stuck after Loop 6
  → The change is likely too large. Split into phases.
  → Each phase gets its own CCR run.
```

**The rule:** If three consecutive loops produce scores within 2% of each other and below 95%, the change needs restructuring, not more loops. Looping on a stable-but-insufficient score is wasted effort.

#### When the human gate fires and nobody responds

| Severity of finding                      | Response SLA             |
| ---------------------------------------- | ------------------------ |
| Regulatory Required or Security Critical | 4 hours (business hours) |
| Critical                                 | 1 business day           |
| High                                     | 2 business days          |
| Medium or Low                            | End of sprint            |

If the SLA expires without response, the artifact does not advance. The CCR run is paused, not abandoned. It resumes when the gate is closed.

### 7.3 Time-Boxing

Loops without time bounds risk analysis paralysis. These are suggested maximums — not hard limits, but signals that the loop should be concluding.

| Scenario                       | Time per Loop | Total CCR Budget |
| ------------------------------ | ------------- | ---------------- |
| CCR Lite (1 loop)              | 15 minutes    | 15 minutes       |
| Standard bug fix (3 loops)     | 20 minutes    | 1 hour           |
| Security review (3-4 loops)    | 30 minutes    | 2 hours          |
| Framework upgrade (4-5 loops)  | 30 minutes    | 2.5 hours        |
| Architecture change (5+ loops) | 45 minutes    | 4+ hours         |
| Governance artifact (5+ loops) | 45 minutes    | 4+ hours         |

**If a loop exceeds its time budget:** The reviewer should score what they have, document the time constraint as a finding, and gate-check. The time constraint itself may reduce confidence — that is the protocol working correctly. A rushed loop should score lower than a thorough one.

### 7.4 Peer Review of Scoring Worksheets

Scoring worksheets are judgment artifacts. For high-stakes assessments, a second reviewer should independently verify the worksheet.

**When peer review is required:**

- All Tier 1 (Protocol) modifications
- Any assessment with Regulatory Required or Security Critical findings
- Any assessment where the final score is between 95% and 97% (near-threshold)
- When requested by the protocol owner or team lead

**What the peer reviewer checks:**

- Are severity classifications defensible?
- Is each "Verified" item backed by cited evidence?
- Are any "Partial" items actually "Unverified" with a generous classification?
- Do the heuristic modifiers apply correctly?
- Is the math correct?

---

## 8. Cross-Discipline Application

### 8.1 The Governing Principle

> **Every loop exists to increase your verified confidence that the change does what it claims, does not break what it should not break, and is defensible under the worst-case conditions of its target environment.**

That statement is discipline-agnostic. The loops change their questions. The math stays the same.

### 8.2 The Three-Phase Delivery Pipeline

```
Phase 0 — PO / BA Confidence
  Story Clarity → Business Rules → Acceptance Criteria
  Gate: 95%+ — "I am confident this is correct to hand to Engineering"
  Output: Scored story artifact with residual ambiguity documented

              ↓  STORY READY GATE  ↓
        Engineering receives scored requirement
        Known ambiguities are pre-loaded starting context

Phase 1 — Engineering Confidence
  Unit → Contract → Integration loops
  Gate: 95%+ — "I am confident this is correct to hand to QA"
  Output: Scored engineering artifact with residual risk documented

              ↓  HANDOFF GATE  ↓
        QA receives scored artifact
        Known residual risk is pre-loaded starting scope

Phase 2 — QA Confidence
  Manual → Automation → Regression loops
  Gate: 95%+ — "I am confident this is correct to ship to production"
  Output: Scored QA artifact with ship decision documented

              ↓  SHIP GATE  ↓
            Production
```

The handoff gate is not a soft boundary. Engineering's residual risk — the items that scored Partial in their final loop — becomes QA's explicit starting scope. QA does not re-run Engineering's loops. QA applies different eyes, different tooling to the same change, with Engineering's known gaps as pre-loaded context.

### 8.3 Engineering Variable Item Set

**Unit Test Layer:**

| Item                                                        | Severity |
| ----------------------------------------------------------- | -------- |
| Happy path covered and passing                              | Critical |
| Edge case boundaries tested — not just nominal inputs       | Critical |
| Failure paths explicitly tested — not just success          | High     |
| No test asserting implementation detail instead of behavior | High     |
| Test is isolated — no shared state bleeding between tests   | High     |
| Coverage gap documented if intentional                      | Medium   |

**Contract Test Layer:**

| Item                                                         | Severity |
| ------------------------------------------------------------ | -------- |
| API contract verified against consumer expectations          | Critical |
| Schema changes backward-compatible or versioned              | Critical |
| Breaking contract changes flagged to downstream consumers    | Critical |
| Consumer-driven contract tests passing                       | High     |
| Contract test covers error response shapes, not just success | High     |

**Integration Test Layer:**

| Item                                                                      | Severity |
| ------------------------------------------------------------------------- | -------- |
| Change verified in context of dependent services                          | Critical |
| No mocked dependencies in integration layer that are real in production   | Critical |
| Data flow verified end-to-end through the changed surface                 | High     |
| Environment parity confirmed — integration environment matches production | High     |
| Rollback path tested — change can be reverted without data corruption     | Medium   |

**Engineering Handoff Template:**

```markdown
## [Change Name] — Engineering CCR Complete

**Engineering Confidence Score:** XX%
**Gate status:** [ ] Cleared ≥95% [ ] Below threshold — do not hand off

**Loop Summary**
| Loop | Layer | Score | Key Finding |
|------|-------|-------|-------------|
| 1 | Unit | XX% | [Finding] |
| 2 | Contract | XX% | [Finding] |
| 3 | Integration | XX% | [Finding] |

**Corrections Applied**

- [What was fixed between loops]

**Residual Risk (Partial items — QA starting scope)**
| Item | State | Why Partial | QA Action Required |
|------|-------|------------|-------------------|
| [Item] | Partial | [Reason] | [What QA should verify] |
```

### 8.4 QA Variable Item Set

**Manual Exploration Layer:**

| Item                                                                          | Severity |
| ----------------------------------------------------------------------------- | -------- |
| Change behaves as specified from user perspective — not just code perspective | Critical |
| Engineering's documented residual risk items verified or escalated            | Critical |
| Edge cases not in Engineering's test suite explored                           | High     |
| Negative testing — what breaks when the change is used wrong                  | High     |
| Cross-browser / cross-device behavior verified if applicable                  | High     |
| Visual and interaction regression checked on affected surfaces                | Medium   |

**Automation Layer:**

| Item                                                                           | Severity |
| ------------------------------------------------------------------------------ | -------- |
| Automated regression suite passes on changed surface                           | Critical |
| New automation added for the changed behavior — not just existing suite re-run | Critical |
| Automation covers the user-facing contract, not the implementation             | High     |
| No flaky tests masking a real failure                                          | High     |
| Test data represents production data shape — not synthetic ideals              | Medium   |

**Regression Layer:**

| Item                                                                  | Severity |
| --------------------------------------------------------------------- | -------- |
| No previously passing tests now failing                               | Critical |
| Adjacent surfaces not broken by the change                            | Critical |
| Performance baseline not degraded beyond threshold                    | High     |
| Accessibility baseline maintained                                     | High     |
| No new console errors introduced                                      | Medium   |
| Monitoring and alerting verified — change is observable in production | Medium   |

### 8.5 Applied Across the Full Scrum Team

| Role                 | Loop Sequence                               | Critical Asks                                     | Conservative Asks                                     | Recursive Asks                                              |
| -------------------- | ------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| **Product Owner**    | Vision → Roadmap → Story                    | Is this the right problem?                        | What is worst-case if this is wrong?                  | Does this hold after stakeholder pressure?                  |
| **Business Analyst** | Discovery → Rules → Criteria                | What assumption am I treating as verified?        | Does the floor hold if the requirement is incomplete? | Is acceptance criteria stable across multiple readers?      |
| **Scrum Master**     | Team Health → Process → Impediment          | What is blocking delivery nobody is naming?       | What happens to the sprint if this is unresolved?     | Is team confidence holding or degrading sprint over sprint? |
| **Engineering**      | Unit → Contract → Integration               | Is this correct by construction?                  | Does integration hold under worst-case data?          | Has confidence held across all three layers?                |
| **QA**               | Manual → Automation → Regression            | Is this correct by behavior?                      | Does the system break under negative testing?         | Is the regression surface stable?                           |
| **Security**         | Threat Model → Attack Surface → Penetration | What is the most dangerous unverified assumption? | What is the blast radius if this is exploited?        | Has the threat model held under adversarial pressure?       |
| **DevOps / SRE**     | Infrastructure → Pipeline → Observability   | Is the deployment path verified end to end?       | What fails first under load?                          | Are SLOs and alerting confirmed stable?                     |

### 8.6 Applied Across IT Operations

**Incident Management:**

| Loop | Layer      | Question                                                         |
| ---- | ---------- | ---------------------------------------------------------------- |
| 1    | Triage     | What is actually broken vs. what we assume is broken?            |
| 2    | Root Cause | Does the identified cause explain all symptoms?                  |
| 3    | Resolution | Does the fix hold under the conditions that caused the incident? |

**Change Management:**

| Loop | Layer                 | Question                                   |
| ---- | --------------------- | ------------------------------------------ |
| 1    | Impact Assessment     | What surfaces does this change touch?      |
| 2    | Risk Analysis         | What breaks if the change fails?           |
| 3    | Rollback Verification | Is the rollback path tested and confirmed? |

**Capacity Planning:**

| Loop | Layer                | Question                                                        |
| ---- | -------------------- | --------------------------------------------------------------- |
| 1    | Current State        | What does the data actually show vs. what we assume?            |
| 2    | Growth Model         | Does the model hold under worst-case demand scenarios?          |
| 3    | Threshold Validation | Are alerting thresholds verified against real failure patterns? |

### 8.7 Applied Across Additional Professions

**Compliance Officer:**

| Loop | Layer                    | Question                                                     |
| ---- | ------------------------ | ------------------------------------------------------------ |
| 1    | Regulatory Inventory     | What regulations actually apply to this system?              |
| 2    | Gap Analysis             | Where does current state fail against each regulation?       |
| 3    | Remediation Verification | Does the remediation close the gap at the enforcement layer? |

**Financial Analyst:**

| Loop | Layer                  | Question                                                      |
| ---- | ---------------------- | ------------------------------------------------------------- |
| 1    | Assumption Audit       | What assumptions are load-bearing in this model?              |
| 2    | Stress Test            | Does the model hold under worst-case scenarios?               |
| 3    | Sensitivity Validation | Which variables most change the output and are they verified? |

**Data Engineer / Analyst:**

| Loop | Layer               | Question                                                    |
| ---- | ------------------- | ----------------------------------------------------------- |
| 1    | Source Verification | Is the data what we think it is?                            |
| 2    | Pipeline Integrity  | Does transformation logic hold across edge case inputs?     |
| 3    | Output Validation   | Does the output match expected shape under production data? |

### 8.8 Universal Loop Position Penalty

The loop position penalty applies across every discipline. A bad requirement found at the PO/BA level costs almost nothing. The same finding compounds at every downstream handoff.

```
Found at PO/BA review         → deduction × 1.0   (cheapest point)
Found in Engineering          → deduction × 1.25  (costs a sprint)
Found in QA                   → deduction × 1.5   (costs two phases)
Found in production           → deduction × 2.0+  (costs an incident)
Found post-regulatory-audit   → deduction × 3.0   (costs a violation)
```

### 8.9 The CCR Universal Standard

> **The CCR Standard is a universal confidence-building framework applicable to any discipline where the cost of proceeding on unverified assumptions exceeds the cost of running the loops. It defines a minimum verified confidence threshold of 95% — derived through weighted deduction, five heuristic modifiers, and a recursive loop structure — before any artifact advances to the next phase of delivery. The invariant core of the standard never changes. The variable item set is defined per discipline. The handoff artifact is the same structure regardless of origin.**

**What makes it a standard — not just a methodology:**

- **Property 1 — The Invariant Core.** The formula, the 95% threshold, the human gate, the confidence decay rule, and the five heuristics never change. A 79% in Engineering and a 79% in Compliance mean the same thing: 21 points of weighted unresolved risk remain load-bearing.
- **Property 2 — The Variable Surface.** The loop sequence and variable item set are domain-specific plug-ins. Any discipline defines its own and plugs into the invariant core.
- **Property 3 — The Handoff Architecture.** The scoring worksheet and handoff template are the same structure regardless of what phase produced them. The receiving party always knows exactly what confidence was earned and what remains open.

When every discipline runs CCR against their own work and hands off scored artifacts to the next discipline, handoff conversations stop being about opinion. They become about score. "I think this is ready" gets replaced by "here is the score and here is what is still Partial." The receiving party does not have to trust the sender's judgment — they can read the worksheet and decide.

---

## 9. Presenting CCR to an Engineering Team

### 9.1 The Merits

**It solves a problem engineers already feel.** Every engineer has shipped something that broke because a surface was not mapped, a contract was not verified, or an environment assumption was wrong. CCR names the existing problem and gives it a mathematical gate.

**The heuristics are intellectually defensible.** Logarithmic surface breadth scaling, correlation compounding, systemic pattern auto-promotion — these reflect how risk actually behaves. Engineers think in systems. They will engage with the math because it is structurally honest.

**The variable surface disarms the rigidity objection.** The invariant core is fixed — that is what makes it a standard. The variable item sets are entirely team-owned. Fixed gate. Flexible surface.

**It refines AI use into documented expectation.** Every team using AI-assisted development currently operates on implicit trust. CCR makes that mechanism explicit, scored, and documented.

**The handoff architecture eliminates the most common team conflict.** "I think it's ready" versus "I don't think it's ready" is the argument every sprint. CCR replaces that argument with a score and a worksheet.

### 9.2 The Risks — What Will Get Picked Apart

**Risk 1 — Scoring inputs are still judgment calls.** Engineers will identify this immediately and they will be right. The mitigation: CCR does not eliminate judgment — it structures it. A Partial judgment with a written reason is auditable. A gut feeling is not.

**Risk 2 — The 95% threshold needs a defense.** Lead with the statistical lineage — Fisher 1925, two standard deviations, a century of validation. Then add the cost architecture argument. The threshold is not arbitrary and it is not permanent. It is infrastructure-gated.

**Risk 3 — Overhead perception.** Engineers moving fast will calculate friction cost before risk reduction benefit. Lead with the loop position penalty — every finding that slips to QA or production costs more than the loops cost to run. CCR is front-loaded verification that prevents expensive back-end rework.

**Risk 4 — Form without substance.** The most dangerous risk. An engineering team that runs loops as a checkbox exercise gets no benefit and develops justified cynicism. The loops only work if the reviewer is genuinely willing to stop. That cannot be enforced with a document. It can only be modeled.

**Risk 5 — No tooling yet.** Engineers will ask where this lives in the pipeline — Linear, GitHub PR templates, CI/CD. The honest answer: v3.0 is the standard. Tooling is the next phase. Frame it that way.

### 9.3 The Rigidity Answer

The protocol is rigid in exactly the right places and flexible in exactly the right places.

**Rigid:** The formula. The 95% threshold. The human gate. The confidence decay rule. The five heuristics. These do not change per team. That rigidity is what makes scores comparable and handoffs trustworthy.

**Flexible:** The loop sequence. The variable item sets. The loop count per scenario. The chunk scope. Every one of these is team-owned.

The analogy: TCP/IP is rigid — the protocol never changes. The applications built on it are infinitely flexible. CCR's invariant core is the protocol. The variable surface is the application layer.

### 9.4 How to Walk Into the Room

Do not say "here is our new process." Say:

> _"I built a framework for making our confidence in AI-assisted output measurable and documented. I want you to pick it apart. Here is what I think it gets right and here is where I think it needs hardening. The scoring rubric is the weakest point — let's fix that together."_

That framing positions you as the author, not the enforcer. It gives engineers the intellectual invitation to engage rather than resist. It makes hardening the scoring rubric a team exercise — which means they own it. The engineers who engage most critically will become its strongest advocates once they have shaped it.

---

## 10. Regulatory Extensions

### 10.1 HIPAA Extension

**Applies when:** Any CCR review touching systems that store, process, or transmit Protected Health Information (PHI).

#### Severity Extension — Regulatory Required Tier

| Severity                | Deduction     | Definition                                                  |
| ----------------------- | ------------- | ----------------------------------------------------------- |
| **Regulatory Required** | **25 points** | **Federal legal obligation. No partial credit.**            |
| Security Critical       | 15 points     | Security finding with exploit potential. No partial credit. |
| Critical                | 15 points     | Load-bearing. Analysis fails if wrong.                      |
| High                    | 10 points     | Significant downstream risk.                                |
| Medium                  | 5 points      | Real gap. Manageable if bounded.                            |
| Low                     | 2 points      | Improvement. Not a blocker.                                 |

#### The Hard Ceiling Rule

```
If any Regulatory Required item is Unverified or Partial
  → maximum achievable score is capped at 60%
  → threshold cannot be reached regardless of all other scores
  → no artifact ships
  → no exceptions
```

This is not a heuristic modifier. It is a hard ceiling. No amount of well-executed surrounding work compensates for an open Required specification.

#### HIPAA Environment Modifier

```
De-identified data surface              → deduction × 1.0   (standard)
Limited data set (some PHI removed)     → deduction × 1.25
PHI in transit                          → deduction × 1.5
PHI at rest                             → deduction × 1.5
PHI + payment data combined             → deduction × 1.75  (HIPAA + PCI overlap)
Mental health / substance abuse PHI     → deduction × 2.0   (42 CFR Part 2 overlay)
```

#### HIPAA Base Items (Added to Tier 1)

| HIPAA Base Item                                                         | Severity            | Deduction if Unresolved |
| ----------------------------------------------------------------------- | ------------------- | ----------------------- |
| PHI data flow mapped — ingress, storage, egress, disposal               | Regulatory Required | 25 pts                  |
| Business Associate Agreements verified for all third-party PHI handlers | Regulatory Required | 25 pts                  |
| Audit logging confirmed on all PHI access points                        | Regulatory Required | 25 pts                  |
| Minimum Necessary standard verified — PHI access scoped to role         | Critical            | 15 pts                  |
| Breach notification path documented and tested                          | Critical            | 15 pts                  |

#### Temporal Modifier

| Deadline Category        | Modifier |
| ------------------------ | -------- |
| No regulatory deadline   | × 1.0    |
| 30-60 day legal deadline | × 1.5    |
| Immediate legal exposure | × 2.0    |

Key HIPAA deadlines: Breach notification to individuals (60 days), breach notification to HHS (60 days), PHI access upon patient request (30 days), audit log retention (6 years minimum).

#### HIPAA Variable Item Set

| Item                                                      | Severity            |
| --------------------------------------------------------- | ------------------- |
| PHI encrypted at rest (AES-256 or equivalent)             | Regulatory Required |
| PHI encrypted in transit (TLS 1.2 minimum)                | Regulatory Required |
| Access controls implemented — role-based, least privilege | Regulatory Required |
| Audit logs capturing who accessed what PHI and when       | Regulatory Required |
| BAA in place for all third-party PHI processors           | Regulatory Required |
| Unique user identification — no shared credentials        | Regulatory Required |
| Automatic logoff on PHI-accessing systems                 | Regulatory Required |
| Emergency access procedure documented and tested          | Regulatory Required |
| PHI disposal process verified — electronic and physical   | High                |
| Workforce training documented for PHI handlers            | High                |
| Contingency plan tested — backup, recovery, continuity    | High                |
| PHI de-identification method verified if used             | High                |
| Penetration test conducted within required window         | Medium              |
| Policy and procedure documentation current                | Medium              |

#### HIPAA Formula

```
Score = MIN(
  regulatory_required_cap,
  100 - Σ(
    base_deduction
    × loop_position_weight
    × surface_breadth_scalar
    × hipaa_environment_modifier
    × temporal_modifier
    + correlation_adjustment
  )
)

Where:
  regulatory_required_cap = 60  if any Required item is Unverified or Partial
                          = 100 if all Required items are Verified
```

#### HIPAA Scoring Worksheet

```markdown
## [Fix/Change Name] — CCR Verified (HIPAA Extension Active)

**Regulatory Required Status**
| Required Item | State | Cap Active? |
|---------------|-------|-------------|
| PHI data flow mapped | Verified / Unverified | Yes / No |
| BAAs verified | Verified / Unverified | Yes / No |
| Audit logging confirmed | Verified / Unverified | Yes / No |
| [Variable Required item] | Verified / Unverified | Yes / No |

Hard ceiling: [ ] Active (max score 60%) [ ] Cleared (full scoring applies)

**Loop Summary**
| Loop | Raw Score | Cap Applied | Final Score | Key Finding |
|------|-----------|-------------|-------------|-------------|
| 1 | XX% | Yes / No | XX% | [Finding] |
| 2 | XX% | Yes / No | XX% | [Finding] |
| 3 | XX% | Yes / No | XX% | [Finding] |

**HIPAA Scoring Worksheet — Loop [N]**
| Item | Tier | Severity | State | Base | Loop× | Breadth× | Env× | Temporal× | Subtotal |
|------|------|----------|-------|------|-------|----------|------|-----------|----------|
| [Item] | HIPAA Base | Reg. Required | V/U | 25 | | | | | |
| [Item] | Variable | Severity | V/P/U | X | | | | | |
| **Total deduction** | | | | | | | | | **-XX** |
| **Raw score** | | | | | | | | | **XX%** |
| **Cap applied** | | | | | | | | | **Yes/No** |
| **Final score** | | | | | | | | | **XX%** |

**PHI Surface Classification**

- Surface type: [De-identified / Limited / In transit / At rest / PCI overlap / 42 CFR Part 2]
- Environment modifier applied: [×]

**BAA Verification**

- [ ] Cloud provider: [name] — BAA confirmed
- [ ] Analytics: [name] — BAA confirmed
- [ ] Logging platform: [name] — BAA confirmed
- [ ] Email / notification service: [name] — BAA confirmed

**Breach Notification Status**

- [ ] No active breach exposure
- [ ] Breach exposure identified — notification path activated
```

#### Plain Language Summary — HIPAA

Standard CCR asks: _how much unresolved risk is still load-bearing?_

HIPAA CCR asks the same question and adds: _does any of that risk carry a federal legal obligation that no engineering score can override?_

If yes — the gate does not open. Not at 95%. Not at 99%. The Required item closes first or nothing ships. That is what makes HIPAA different from every other environment modifier in the protocol. It is not a multiplier. It is a veto.

---

### 10.2 COPPA Extension

**Applies when:** Any CCR review touching systems that collect, store, process, or transmit personal information from users under 13 — or systems where such collection is reasonably possible without a verified prevention mechanism.

#### Core Legal Trigger

COPPA applies when a digital service is:

- **Directed to children under 13**, or
- Operating with **actual knowledge** it is collecting personal information from children under 13

"Actual knowledge" is not a defense. If your platform collects data and children could reasonably use it, COPPA applies unless verified mechanisms exist to prevent or consent-gate their participation. The FTC enforces COPPA. Civil penalties run up to **$51,744 per violation per day.**

**Key difference from HIPAA:** HIPAA is about _what data you hold and how you protect it._ COPPA is about _who the data belongs to and whether you had the right to collect it at all._ That is a fundamentally different legal question and it changes where in the CCR loop the risk surfaces. HIPAA violations typically emerge in Loop 2 — surface mapping reveals unprotected PHI. COPPA violations are frequently Loop 1 failures — the collection mechanism itself was never verified against the age threshold before anything else was built.

#### The Hard Ceiling Rule

Identical to HIPAA — any open Regulatory Required item caps score at 60%. No exceptions.

#### COPPA Environment Modifier

```
No users under 13 verifiably possible       → deduction × 1.0  (standard)
Mixed audience, age gate unverified          → deduction × 1.5
Platform directed to children under 13       → deduction × 1.75
Directed to children + sensitive categories  → deduction × 2.0
COPPA + HIPAA overlap (pediatric health)     → deduction × 2.5
```

#### COPPA Base Items (Added to Tier 1)

| COPPA Base Item                                                           | Severity            | Deduction if Unresolved |
| ------------------------------------------------------------------------- | ------------------- | ----------------------- |
| Age determination mechanism verified — enforced at API layer, not just UI | Regulatory Required | 25 pts                  |
| Verifiable parental consent flow implemented and tested                   | Regulatory Required | 25 pts                  |
| Privacy notice present, plain language, COPPA-compliant                   | Regulatory Required | 25 pts                  |
| PII collection scoped to minimum necessary — no excess collection         | Critical            | 15 pts                  |
| Parental review, correction, and deletion path functional                 | Critical            | 15 pts                  |
| Data retention policy defined and enforced for child data                 | Critical            | 15 pts                  |

#### Temporal Modifier

```
Finding with no regulatory deadline          → deduction × 1.0
Finding with 30-day parental rights window   → deduction × 1.5
Finding with active FTC investigation risk   → deduction × 2.0
```

#### COPPA Variable Item Set

| Item                                                         | Severity            |
| ------------------------------------------------------------ | ------------------- |
| Age gate enforced at API layer — not just UI                 | Regulatory Required |
| Verifiable parental consent — not a checkbox                 | Regulatory Required |
| Privacy notice accessible before any collection              | Regulatory Required |
| No behavioral advertising to under-13 users                  | Regulatory Required |
| No third-party data sharing without parental consent         | Regulatory Required |
| Parental deletion request cascades to all downstream systems | Regulatory Required |
| Child PII not used to build advertising profiles             | Regulatory Required |
| Session data for under-13 users not persisted beyond session | High                |
| Analytics tools audited for child PII collection             | High                |
| Child data segregated from adult data at storage layer       | High                |
| Support staff trained on parental rights requests            | High                |
| Third-party SDKs audited for child data collection           | High                |
| Child data excluded from AI training pipelines               | Medium              |
| Retention enforcement automated — not manual                 | Medium              |
| Parental consent records retained as compliance evidence     | Medium              |

#### COPPA Scoring Worksheet

```markdown
## [Fix/Change Name] — CCR Verified (COPPA Extension Active)

**Regulatory Required Status**
| Required Item | State | Cap Active? |
|---------------|-------|-------------|
| Age gate enforced at API layer | Verified / Unverified | Yes / No |
| Verifiable parental consent implemented | Verified / Unverified | Yes / No |
| Privacy notice present and compliant | Verified / Unverified | Yes / No |
| [Variable Required item] | Verified / Unverified | Yes / No |

Hard ceiling: [ ] Active (max score 60%) [ ] Cleared (full scoring applies)

**Audience Classification**

- [ ] No under-13 users possible — verified
- [ ] Mixed audience — age gate in place
- [ ] Platform directed to children under 13
- [ ] Sensitive categories collected
- [ ] HIPAA overlap active — see Compound Assessment

**Age Gate Verification**

- [ ] UI layer gate confirmed
- [ ] API layer enforcement confirmed
- [ ] Backend collection blocked for unverified users
- [ ] Parental consent flow end-to-end tested

**Third-Party SDK Audit**

- [ ] [SDK name] — child data collection: confirmed / not confirmed / excluded
- [ ] Analytics — child PII: excluded / not excluded
- [ ] Ad network — behavioral targeting for under-13: disabled / not disabled

**Parental Rights Path**

- [ ] Access request path functional
- [ ] Correction path functional
- [ ] Deletion path functional — cascades to all downstream systems
- [ ] Response time SLA documented: [X days]
```

#### Plain Language Summary — COPPA

HIPAA asks whether you are protecting data you were allowed to collect.

COPPA asks whether you were allowed to collect it at all.

That sequencing matters. A system can be HIPAA-compliant in every protection mechanism and still be a COPPA violation if the consent gateway was decorative. The data should never have entered the system. No amount of encryption, access control, or audit logging fixes a collection that was never authorized. This is why the age gate is a Regulatory Required base item with no partial credit. Either the gate works at the API layer or the review stops.

---

### 10.3 Compound Assessment — HIPAA + COPPA

**Applies when:** Both HIPAA and COPPA apply simultaneously — most commonly pediatric health platforms (children's EHR, pediatric telehealth, school health apps).

#### The Dual-Veto Architecture

HIPAA is enforced by HHS. COPPA is enforced by the FTC. They are independent enforcement bodies. They do not coordinate. They do not offset each other.

```
Both frameworks have open Required items → cap at 40%
One framework has open Required items    → cap at 60%
All Required items closed in both        → standard scoring at 2.5× environment modifier
```

The 40% dual-veto cap reflects that two independent federal enforcement paths are active with independent liability, deadlines, and remediation requirements.

#### Compound Variable Items (Added on top of both individual sets)

| Item                                                                                                 | Severity            |
| ---------------------------------------------------------------------------------------------------- | ------------------- |
| PHI of minors segregated from adult PHI at storage layer                                             | Regulatory Required |
| Parental consent covers BOTH data collection (COPPA) AND treatment authorization (HIPAA)             | Regulatory Required |
| Minor's right to access PHI vs. parental right to access child data — conflict resolution documented | Critical            |
| Age-based access controls — minor's own records access policy defined                                | Critical            |
| Third parties holding both child PII and PHI have both BAA and COPPA data sharing agreement          | Regulatory Required |
| Mature health content access-gated for minors                                                        | High                |
| Breach notification path covers both HHS (HIPAA) and FTC (COPPA) simultaneously                      | Critical            |

#### Compound Temporal Stack

When both frameworks are active, the most restrictive deadline governs.

| Scenario                         | HIPAA Deadline | COPPA Deadline | Governing | Modifier |
| -------------------------------- | -------------- | -------------- | --------- | -------- |
| Breach involving child PHI       | 60 days        | 30 days        | 30 days   | × 2.0    |
| Access request for minor's PHI   | 30 days        | 30 days        | 30 days   | × 1.5    |
| Deletion request for minor's PHI | N/A            | 30 days        | 30 days   | × 1.5    |
| Audit log retention              | 6 years        | N/A            | 6 years   | × 1.0    |

#### Compound Formula

```
Score = MIN(
  dual_veto_cap,
  100 - Σ(
    base_deduction
    × loop_position_weight
    × surface_breadth_scalar
    × compound_environment_modifier  (2.5×)
    × governing_temporal_modifier
    + correlation_adjustment
  )
)

Where:
  dual_veto_cap = 40  if any Required item open in BOTH frameworks
               = 60  if any Required item open in EITHER framework
               = 100 if all Required items verified in BOTH frameworks
```

#### Plain Language Summary — Compound Assessment

Pediatric health is the hardest surface in regulated software. It is not harder because the technology is harder. It is harder because two federal laws with two independent enforcement bodies are both watching the same system — and compliance with one does not imply or substitute for compliance with the other.

The CCR compound assessment forces the reviewer to close both legal vetoes independently before the gate opens. There is no shortcut through the dual cap. There is no partial credit against a Required item. There is no heuristic that offsets an open federal obligation.

Both close. Then the score runs. Then the gate decides. That is the correct order of operations for the most regulated surface the protocol will encounter.

---

## 11. Reference

### 11.1 Worked Example — Framework Upgrade (Spring Boot 2.7 → 3.2)

| Loop | Confidence | Finding                                                                                                                     |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | 62%        | Production runtime on Java 11. Upgrade is two parts, not one. Stopped.                                                      |
| 2    | 79%        | 247 javax.\* references. WebSecurityConfigurerAdapter rewrite required. Hibernate 6 breaking changes in JPA layer. Stopped. |
| 3    | 96%        | Commit sequence locked. Production Java 17 pre-condition confirmed. Security rewrite reviewer requirement added. Shipped.   |

**Without CCR:** pom.xml bumped. Deployed to Java 11 production runtime. Outage.
**With CCR:** Four-commit sequence, pre-conditions verified, dedicated PR per concern, bisectable history.

### 11.2 Onboarding — Getting Started with CCR

**For new team members:**

1. **Read the Quick Reference Card** (top of this document) — it's the daily-use summary
2. **Run your first CCR Lite** on a low-risk change — experience the three layers on a simple scope
3. **Complete a calibration exercise** (Section 10.3) — score an artifact independently, compare with the team
4. **Shadow a full 3-loop CCR** — observe how reactive correction works between loops
5. **Run your first standard CCR** with peer review of your scoring worksheet
6. **Iterate** — your scoring calibration will improve with each CCR you run

**Common first-timer questions:**

| Question                                 | Answer                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How do I know what severity to assign?" | Start with the variable item set for your application type. If unsure between two levels, pick the higher one. Conservative classification is always safer. |
| "What counts as evidence for Verified?"  | Test result, code path (file:line), config value, log entry, screenshot. If you can point to it, it's evidence. If you can't, it's Partial.                 |
| "My score is 93% — can I round up?"      | No. 93% is 93%. Fix a finding or accept the gate.                                                                                                           |
| "Do I need to run CCR on everything?"    | No. See CCR Lite eligibility (Section 7.1). Typo fixes, comment changes, and formatting don't need 3 loops.                                                 |

### 11.3 Calibration Exercises

Calibration establishes baseline inter-rater reliability across the team. Two reviewers should produce similar — not identical — scores on the same artifact.

**Exercise format:**

1. Select a recent merged PR with known scope
2. Two or more team members independently run a 3-loop CCR against it
3. Compare scoring worksheets:
   - Did reviewers identify the same findings?
   - Are severity classifications within one tier of each other?
   - Are final scores within 5% of each other?
4. Discuss divergences — they reveal where the team's understanding of the protocol differs
5. Document calibration results and repeat quarterly

**Acceptable calibration range:** Two reviewers scoring within ±5% on the same artifact indicates good calibration. Greater than ±10% divergence indicates the team needs alignment on evidence standards or severity classification.

### 11.4 Score Trending

Track CCR scores across sprints to identify systemic patterns:

- **Team consistently scoring 85% in Loop 1:** Loop 1 surface passes are too shallow. Train on assumption-stripping.
- **Scores improving Loop-over-Loop but never reaching 95%:** Changes are too large for single CCR runs. Split into smaller units.
- **Scores consistently at 95%+ in Loop 1:** Possible anti-pattern — are reviewers stopping too early or inflating?
- **Frequent human gate fires on same item type:** Systemic training gap or documentation gap.

### 11.5 Meta-CCR Schedule

The protocol itself is reassessed on a defined schedule:

| Trigger                 | Action                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Quarterly               | Review protocol version against team feedback. Any proposed changes go through Tier 1 CCR.                              |
| After 10 CCR runs       | Compile score trending data. Assess whether calibration constants need adjustment.                                      |
| Infrastructure change   | If token cost model changes (cloud → local LLM), reassess threshold advancement pre-conditions.                         |
| Regulatory change       | If new regulations apply (e.g., GDPR extension, state privacy laws), assess whether new regulatory extension is needed. |
| Protocol owner decision | Ad hoc reassessment at owner's discretion.                                                                              |

### 11.6 Glossary

| Term                     | Definition                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Artifact**             | Any output that earns the right to ship — merged PR, shipped fix, documented decision. Requires CCR ≥ 95%.                                              |
| **Base Item**            | One of five universal scoring items that apply to every CCR run. If any fails, max score is 70%.                                                        |
| **Calibration Constant** | A scoring weight validated through use, not mathematically derived. All severity weights and most heuristic constants are calibrations.                 |
| **CCR Lite**             | A single-loop fast path for low-risk, isolated, reversible changes. See Section 7.1.                                                                    |
| **Chunk**                | The scoped context a single loop operates on. Defined per loop, expands only with named instruction.                                                    |
| **Confidence Decay**     | When a score drops between consecutive loops. Indicates new risk was uncovered. Process does not advance.                                               |
| **Dual-Veto**            | Compound regulatory architecture where two independent frameworks (HIPAA + COPPA) each hold independent veto power.                                     |
| **Evidence**             | Citable proof that a finding has been verified — test result, code path, config value, log entry. Required for "Verified" state.                        |
| **Governance Artifact**  | A Tier 1 or Tier 2 document that is load-bearing for all downstream work. Requires elevated CCR protection.                                             |
| **Hard Ceiling**         | A score cap (60% for single regulatory veto, 40% for dual veto) that no heuristic can override.                                                         |
| **Human Gate**           | The point where the protocol stops and waits for human input. Not a failure — a design feature.                                                         |
| **Invariant Core**       | The parts of CCR that never change: formula, threshold, gates, heuristics, severity weights.                                                            |
| **Loop**                 | A complete pass through all three layers (Critical, Conservative, Recursive). Minimum 3 for standard reviews.                                           |
| **Partial Credit**       | Half deduction for findings that are named, bounded, and documented but not fully resolved. Not available for Regulatory Required or Security Critical. |
| **Reactive Correction**  | The mandate to fix actionable findings between loops, not just report them. Includes updating the variable item set.                                    |
| **Regulatory Required**  | Severity tier (25 pts) for federal legal obligations. No partial credit. Open items cap score at 60%.                                                   |
| **Security Critical**    | Severity tier (15 pts) for security findings with exploit potential. No partial credit.                                                                 |
| **Variable Item Set**    | Application-specific scoring items that change per review type. Teams own the items. They do not own the weights.                                       |
| **Variable Surface**     | The parts of CCR that are team-owned: loop sequence, item sets, loop count, chunk scope.                                                                |

### 11.7 Document Info

| Field                    | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Protocol**             | CCR — Critical, Conservative, Recursive                                                           |
| **Version**              | 3.0                                                                                               |
| **Status**               | Active                                                                                            |
| **Applies to**           | Any role, team, or organization that produces work another role, team, or organization depends on |
| **Minimum loops**        | 3 (standard) / 1 (CCR Lite)                                                                       |
| **Confidence threshold** | 95%                                                                                               |
| **Owner**                | Matthew Zdano                                                                                     |

**Version History**

| Version | Change                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | Base protocol — three layers, three loops, confidence scoring, five heuristics, chunking and batching, output format, anti-patterns                                                                                                                                                                                                                                                                                                    |
| 2.0     | Universal Standard — cross-discipline framework, full Scrum team and IT Operations application, threshold decision with statistical lineage and advancement framework, HIPAA extension, COPPA extension, compound regulatory assessment                                                                                                                                                                                                |
| 3.0     | Reassessment release — reactive correction rule, governance artifact protection, self-protection mechanism, evidence-based verification standard, Security Critical tier, transparency notes (Fisher citation, weight calibration, repeatability), CCR Lite fast path, escalation paths, time-boxing, peer review of worksheets, calibration exercises, score trending, meta-CCR schedule, glossary, worked examples, onboarding guide |

---

## Steps to Execute a CCR

```
1. CLASSIFY
   What are you reviewing? → Select loop count and variable item set
   Is it CCR Lite eligible? → If all 6 criteria met, run 1 loop
   Is it a governance artifact? → Tier 1/2 protection applies (5+ loops)

2. SCOPE
   Define the chunk for Loop 1 (specific file, function, or component)
   Identify environment (staging / production / PII / regulated)
   Check regulatory applicability (HIPAA? COPPA? Both?)

3. LOOP 1 — SURFACE PASS
   Critical:     What is the most dangerous assumption?
   Conservative: What is worst-case if I am wrong?
   Recursive:    Score using base + variable items + heuristics
   Gate check:   ≥ 95%? → Advance     < 95%? → Fix findings, then gate again

4. LOOP 2 — PRESSURE PASS
   Expand chunk based on Loop 1 findings
   Critical:     What did I assume was solved that I never verified?
   Conservative: Does the floor still hold?
   Recursive:    Score with loop position penalty (× 1.25 for new findings)
   Gate check:   Score held or improved? → Advance     Dropped? → Fix and surface

5. LOOP 3 — CONFIRMATION PASS
   Scope to proposed fix and verification criteria only
   Critical:     Am I rationalizing or verifying?
   Conservative: Would I defend this if it shipped and broke?
   Recursive:    Score with loop position penalty (× 1.5 for new findings)
   Gate check:   Stable at ≥ 95% across Loops 2-3? → Ships     Decayed? → Return to Loop 2

6. OUTPUT
   Produce scoring worksheet with evidence citations
   Document corrections applied between loops
   Define commit sequence, pre-conditions, verification checklist

7. HUMAN GATE (if any Partial items remain)
   Present findings to user for final decision
   Document gate response
```
