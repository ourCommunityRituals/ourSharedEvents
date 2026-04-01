# Skill: CCR Protocol — Critical, Conservative, Recursive

## When to Use
User says: "CCR", "run a CCR", "code review", "assessment", "production readiness", "review this", "test gating", "confidence check", "is this ready to ship"

## Overview

CCR is a self-validating engineering review framework. AI-assisted output does not earn artifact status — merged PR, shipped fix, documented decision — until it survives recursive confidence testing at or above 95%.

---

## The Three Layers (Every Loop Runs All Three)

### Layer 1 — Critical
Strip assumption. Find what is actually true versus what is remembered or assumed.
> *What is the most dangerous assumption in this analysis — and has it been verified, or only assumed?*

### Layer 2 — Conservative
Validate the floor, not the ceiling. Assume worst-case and confirm the decision still holds.
> *What is the worst-case outcome if Loop 1's findings are incomplete — and does the proposed fix still hold?*

### Layer 3 — Recursive
Confirm conclusion stability across loops. Test for confidence decay.
> *Has my confidence score held, improved, or degraded across all loops — and is that movement honest?*

---

## The 3-Loop Minimum

```
Loop 1 → Surface Pass   (cast wide, find obvious gaps)
Loop 2 → Pressure Pass  (find what Loop 1 missed, verify assumptions)
Loop 3 → Confirmation   (confirm stability, no artificial inflation)
```

Loops are **sequential** — output of Loop N is pressure input of Loop N+1. Never parallel.

### Loop Gates
- Score **< 95%** → Stop. Surface finding to human. Do not advance.
- Score **≥ 95%** → Advance to next loop.
- Loop 3 score **< Loop 2 score** → Confidence decay. Do not advance.
- Score stable at ≥ 95% across two consecutive loops → Ships.

### Loop Count by Scenario
| Scenario | Loops |
|---|---|
| Standard bug fix, isolated | 3 |
| Security vulnerability | 3-4 |
| Major version upgrade | 4-5 |
| Architecture change, multi-service | 5+ |
| Regulatory surface (HIPAA/COPPA) | 5+, human gate every loop |

---

## Confidence Score

```
Score = 100 - Σ(unresolved finding × severity weight)
```

| Score | State | Action |
|---|---|---|
| < 70% | Significant unknowns | Stop. Surface immediately. |
| 70-84% | Scope partially mapped | Stop. Surface specific gaps. |
| 85-94% | Mitigations partial | Stop. Complete mitigations. |
| 95-97% | Full scope, mitigations in place | Advance. Ships with documented assumptions. |
| 98-100% | All verified, no open assumptions | Advance. Ships clean. |

### Tier 1 — Base Items (Every CCR Run)

If any base item fails, score cannot exceed 70%.

| Base Item | Deduction if Unresolved |
|---|---|
| Environmental assumptions verified — not just stated | 15 pts |
| Full surface mapped — no unknown surfaces remain | 15 pts |
| Partial fix risk assessed — not creating false closure | 10 pts |
| Chunk scope correctly defined for this loop | 10 pts |
| Human gate not bypassed — no assumed resolutions | 15 pts |

### Tier 2 — Variable Items (Application-Specific)

| Severity | Deduction | Definition |
|---|---|---|
| Regulatory Required | 25 pts | Federal legal obligation. No partial credit. |
| Critical | 15 pts | Load-bearing. Analysis fails if wrong. |
| High | 10 pts | Significant downstream risk. |
| Medium | 5 pts | Real gap. Manageable if named/bounded. |
| Low | 2 pts | Improvement. Not a blocker. |

### Variable Item Sets by Application Type

**Security Review:**
| Item | Severity |
|---|---|
| Preflight handler verified | Critical |
| All surfaces scanned, not just reported one | Critical |
| Auth surface included in scope | High |
| No partial fix creating false closure | High |
| CSP headers assessed | Medium |

**Framework Upgrade:**
| Item | Severity |
|---|---|
| Runtime compatibility confirmed all environments | Critical |
| Full import migration surface mapped | Critical |
| Security library rewrite scoped | High |
| ORM/persistence breaking changes assessed | High |
| Commit sequence bisectable | Medium |

**Standard Bug Fix:**
| Item | Severity |
|---|---|
| Reproduction confirmed — not assumed | Critical |
| Regression test exists or created | High |
| No related surfaces carrying same pattern | Medium |
| Commit isolated — not bundled | Medium |

### Partial Credit
| State | Credit |
|---|---|
| Verified | Full — 0 deduction |
| Partially verified — gap named, bounded | Half deduction |
| Unverified — unknown or assumed | Full deduction |

---

## Heuristic Modifiers

Applied in order: base → loop position → surface breadth → environment → correlation → systemic promotion.

```
Score = 100 - Σ(
  base_deduction
  × loop_position_weight
  × surface_breadth_scalar
  × environment_modifier
  + correlation_adjustment
)
```

### H1 — Loop Position Penalty
```
Loop 1 → × 1.0
Loop 2 → × 1.25
Loop 3 → × 1.5
```

### H2 — Correlation Multiplier
```
2 correlated findings → (sum) × 1.5
3 correlated findings → (sum) × 2.0
```

### H3 — Surface Breadth Scalar
```
Deduction × log₂(N + 1)   where N = surfaces affected
```

### H4 — Systemic Pattern Auto-Promotion
Finding in 3+ locations → severity promotes one tier (Low→Med, Med→High, High→Critical, Critical→Critical + correlation).

### H5 — Environment Risk Modifier
```
Staging/dev              → × 0.75
Standard production      → × 1.0
Production + PII         → × 1.25
Regulated (HIPAA/PCI/COPPA) → × 1.5
```

---

## Chunking and Batching (Token Efficiency)

| Loop | Default Chunk Scope |
|---|---|
| 1 | Specific file, function, or component under review |
| 2 | Expanded surface revealed by Loop 1 findings |
| 3 | Proposed fix and verification criteria only |

Scope expansion requires explicit instruction — no silent creep.

---

## Output Format

```markdown
## [Fix/Change Name] — CCR Verified

**Loop Summary**
| Loop | Confidence | Key Finding |
|------|-----------|-------------|
| 1    | XX%       | [Finding]   |
| 2    | XX%       | [Finding]   |
| 3    | XX%       | [Finding]   |

**Scoring Worksheet — Loop [N]**
| Item | Tier | Severity | State | Deduction |
|------|------|----------|-------|-----------|
| Environmental assumptions verified | Base | — | V/P/U | X |
| Full surface mapped | Base | — | V/P/U | X |
| Partial fix risk assessed | Base | — | V/P/U | X |
| Chunk scope correctly defined | Base | — | V/P/U | X |
| Human gate not bypassed | Base | — | V/P/U | X |
| [Variable items] | Variable | Sev | V/P/U | X |
| **Total deduction** | | | | **-XX** |
| **Score** | | | | **XX%** |

**Scope (Confirmed)**
- [File/component]: [Change required]

**Pre-conditions**
- [ ] [Requirement before merge]

**Commit Sequence**
1. [Commit — scope and purpose]

**Verification**
- [ ] [Post-merge check]

**Review Gates**
- [Commit X]: Requires [reviewer qualification]
```

---

## Anti-Patterns

| Anti-Pattern | Why It Breaks CCR |
|---|---|
| Assigning 95%+ in Loop 1 | Surface pass — high score means stopped looking too early |
| Combining commits | Merged scope not bisectable |
| Treating compilation as correctness | Compiles ≠ correct at runtime |
| Carrying Loop 1 scope into Loop 3 unchanged | Loop 2 didn't expand honestly |
| Rounding up to 95% | 93% is 93%. Gate is not a negotiation. |
| Running loops in parallel | Breaks recursive design |
| Expanding scope without named instruction | Violates default chunk rule |

---

## Cross-Discipline Application

### Engineering Phase (Unit → Contract → Integration)
Gate: 95%+ = "Confident to hand to QA"

**Unit:** Happy path (Critical), edge boundaries (Critical), failure paths (High), no impl-detail assertions (High), test isolation (High).
**Contract:** API contract vs consumer (Critical), backward-compatible schema (Critical), breaking changes flagged (Critical), error shapes covered (High).
**Integration:** Verified with dependencies (Critical), no mocked-in-integration (Critical), e2e data flow (High), env parity (High), rollback tested (Medium).

### QA Phase (Manual → Automation → Regression)
Gate: 95%+ = "Confident to ship to production"

**Manual:** User-perspective behavior (Critical), Engineering residual risk verified (Critical), edge cases beyond test suite (High), negative testing (High).
**Automation:** Regression suite passes (Critical), new automation for changed behavior (Critical), covers user contract not impl (High), no flaky tests masking failures (High).
**Regression:** No previously passing tests failing (Critical), adjacent surfaces intact (Critical), performance baseline held (High), a11y baseline held (High).

### Handoff: Engineering scores residual risk → QA starts there.

---

## Regulatory Extensions

> **Note:** The sections below summarize the HIPAA, COPPA, and Compound regulatory extensions. For full scoring worksheets, temporal modifiers, variable item sets, and worked examples, reference the complete CCR Protocol v2.0 source document provided by the protocol owner. The summaries below are sufficient for non-regulated surfaces. Regulated assessments require the full extension worksheets.

## HIPAA Extension (Appendix A)

**Applies when:** Systems store, process, or transmit PHI.

**Adds:**
- Regulatory Required tier (25 pts, no partial credit)
- Hard ceiling: any open Required item caps score at 60%
- HIPAA environment modifiers (1.0x–2.0x based on PHI type)
- Temporal modifiers (1.0x–2.0x based on legal deadlines)
- HIPAA base items (PHI data flow, BAAs, audit logging, minimum necessary, breach notification)

---

## COPPA Extension (Appendix B)

**Applies when:** Systems collect data from users under 13 or could reasonably do so.

**Adds:**
- Same Regulatory Required tier and hard ceiling as HIPAA
- COPPA environment modifiers (1.0x–2.5x)
- COPPA base items (age gate at API layer, verifiable parental consent, privacy notice)
- Age gate must be enforced at API layer, not just UI

---

## Compound Assessment — HIPAA + COPPA (Appendix C)

**Dual-Veto Architecture:**
```
Both frameworks have open Required items → cap at 40%
One framework has open Required items    → cap at 60%
All Required items closed in both        → standard scoring at 2.5× environment modifier
```

Two independent federal enforcement bodies. Compliance with one does not satisfy the other.

---

## Steps to Execute a CCR

1. **Identify scope** — What is being reviewed? (bug fix, security, upgrade, architecture, regulatory)
2. **Select variable item set** — Match application type or define custom items
3. **Determine environment** — Staging, production, PII, regulated? Set modifier.
4. **Check regulatory applicability** — HIPAA? COPPA? Both? Activate extensions.
5. **Run Loop 1 (Surface Pass)**
   - Read the chunk (file, function, component)
   - Apply all three layers: Critical → Conservative → Recursive
   - Score using base items + variable items + heuristics
   - Gate check: ≥ 95%? Advance. < 95%? Stop and surface.
6. **Run Loop 2 (Pressure Pass)**
   - Expand chunk based on Loop 1 findings
   - Apply all three layers against expanded surface
   - Score with loop position penalty (× 1.25 for new findings)
   - Gate check: score held or improved? Advance. Dropped? Stop.
7. **Run Loop 3 (Confirmation Pass)**
   - Scope to proposed fix and verification only
   - Apply all three layers — looking for rationalization, not new problems
   - Score with loop position penalty (× 1.5 for new findings)
   - Gate check: stable at ≥ 95% across Loops 2-3? Ships. Decayed? Return to Loop 2.
8. **Produce output** — Scoring worksheet, scope, pre-conditions, commit sequence, verification, review gates
9. **Human gate** — Present to user for final decision if any Partial items remain
