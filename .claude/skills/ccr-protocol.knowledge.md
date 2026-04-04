# CCR Protocol — Knowledge Base

# Critical · Conservative · Recursive

## A Production Readiness Review Methodology

> **Owner:** Matthew Zdano
> **Version:** 1.0
> **Status:** Active
> **Applies to:** All production-grade engineering reviews, AI-assisted or otherwise

---

> _Earn the right to ship by surviving your own scrutiny — recursively, conservatively, critically._

---

## 1. Foundation

### 1.1 Overview

The CCR Protocol is a self-validating engineering review framework. Its core contract:

> **AI-assisted output does not earn the right to become an artifact — a merged PR, a shipped fix, a documented decision — until it survives recursive confidence testing at or above 95%.**

Below that threshold, the loop pauses and surfaces to a human. Above it, the process advances. There is no shortcut through the loops.

CCR is not a checklist. It is a pressure-testing discipline applied in layers, recursively, until the conclusion is durable — not just correct on first read.

### 1.2 Origin

CCR stands for **Critical, Conservative, Recursive**.

The framework originated as a personal cognitive model for high-stakes decision analysis and was formalized into an engineering review protocol for AI-assisted development workflows. The discipline behind it cannot be copied by copying the structure. The loops only work if the reviewer is genuinely willing to stop.

### 1.3 The Three Layers

Every loop runs all three layers in sequence. The output of one layer becomes the pressure input of the next.

#### Layer 1 — Critical

**Purpose:** Strip assumption. Find what is actually true versus what is remembered or assumed to be true.

**The question this layer always asks:**

> _What is the most dangerous assumption in this analysis — and has it been verified, or only assumed?_

The Critical layer catches the gap between pattern recognition (what you expect based on prior experience) and current reality (what the data, code, or environment actually shows right now).

A finding is not critical because it is large. It is critical because it is load-bearing — the rest of the analysis depends on it being true.

#### Layer 2 — Conservative

**Purpose:** Validate the floor, not the ceiling. Assume the worst-case path is possible and confirm the decision still holds.

**The question this layer always asks:**

> _What is the worst-case outcome if Loop 1's findings are incomplete — and does the proposed fix still hold under that scenario?_

The Conservative layer does not look for reasons to proceed. It looks for reasons the proposed action fails under pressure. A fix that only works under ideal conditions is not a fix — it is a deferred failure.

Key Conservative behaviors:

- Flag partial fixes as potentially worse than no fix — they produce false documented closure
- Require floor validation before ceiling analysis
- Treat "it works in my environment" as an unverified assumption until proven otherwise

#### Layer 3 — Recursive

**Purpose:** Confirm the conclusion is stable across all loops. Test for confidence decay, not just correctness.

**The question this layer always asks:**

> _Has my confidence score held, improved, or degraded across all loops — and is that movement honest?_

Confidence that only survives one pass is not confidence. It is optimism. The Recursive layer detects artificial inflation — conclusions that feel solid because they have not been pressured, not because they actually are.

The Recursive layer assigns and tracks the confidence score across every loop. If the score drops between Loop 2 and Loop 3, the process does not advance. A degrading score is a signal, not a formality.

---

## 2. Execution

### 2.1 The 3-Loop Design

CCR runs in a minimum of three loops for any production-grade review. Each loop is a complete pass through all three layers.

```
Loop 1 → Surface Pass
Loop 2 → Pressure Pass
Loop 3 → Confirmation Pass
```

The loops are not parallel. They are sequential. The output of each loop is the pressure input of the next.

#### Loop 1 — Surface Pass

**Goal:** Find what is obviously wrong. Cast wide. Do not try to find everything.

| Layer        | Question                                                |
| ------------ | ------------------------------------------------------- |
| Critical     | What is the most dangerous assumption in this analysis? |
| Conservative | What is the worst-case outcome if I am wrong here?      |
| Recursive    | Did this pass change my confidence score up or down?    |

**Gate:** Assign confidence score.

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

**Gate:** Assign updated confidence score.

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

**Gate:** Assign final confidence score.

- Score **< 95%** → Do not ship. Return to Loop 2 with new findings.
- Score **≥ 95%** → Output earns artifact status. It is written. It ships.

**What Loop 3 produces:** A defensible, auditable, bisectable artifact with named mitigations for every identified risk.

### 2.2 The Confidence Score

The confidence score is the protocol's quality gate. It is not a feeling — it is a structured assessment of how many unknowns remain versus how many have been verified.

#### Scoring Reference

| Score   | State                                      | Action                                                      |
| ------- | ------------------------------------------ | ----------------------------------------------------------- |
| < 70%   | Significant unknowns remain                | Stop. Surface immediately. Gather inputs before re-running. |
| 70–84%  | Scope partially mapped, gaps named         | Stop. Surface specific gaps. Do not advance.                |
| 85–94%  | Most risks identified, mitigations partial | Stop. Mitigations must be complete before advancing.        |
| 95–97%  | Full scope confirmed, mitigations in place | Advance. Output may ship with documented assumptions.       |
| 98–100% | All risks verified, no open assumptions    | Advance. Output ships clean.                                |

#### Confidence Decay Rule

If your score in Loop 3 is lower than your score in Loop 2, the process does not advance. A score that degrades across loops means new risk was uncovered that was not present in prior loops. This is not a failure of the protocol — it is the protocol working correctly.

### 2.3 The Human Gate

The human gate is not a failure state. It is a design feature.

When a loop produces a score below 95%, the protocol does not retry automatically. It surfaces the specific finding — the named unknown, the environmental gap, the unverified assumption — and waits for a human to close it before the next loop begins.

**What the human gate surfaces:**

- The specific question that produced the confidence drop
- The information needed to answer it
- The loop number and layer where the gap was found

**What the human gate does not do:**

- Guess at the answer
- Proceed with an assumed resolution
- Treat silence as confirmation

### 2.4 Loop Count Reference

Three loops is the **minimum** for any production-grade review. Some scenarios require additional loops.

| Scenario                                       | Loops Required                  |
| ---------------------------------------------- | ------------------------------- |
| Standard bug fix, isolated scope               | 3                               |
| Security vulnerability remediation             | 3 minimum, often 4              |
| Major version upgrade (framework, runtime)     | 4–5                             |
| Architecture change touching multiple services | 5+                              |
| Regulatory or compliance surface               | 5+, human gate after every loop |

**The rule:** Run loops until the score is stable across two consecutive loops at or above 95%. Stability, not just threshold, is the signal.

---

## 3. Operational Standards

### 3.1 Token Efficiency — Chunking and Batching

The CCR Protocol is designed to be run with AI assistance. Token cost is a real operational consideration.

#### Chunking

Each loop operates on a defined, scoped chunk of context — not the full repo, not the full PR, not the full system.

| Loop | Default Chunk Scope                                    |
| ---- | ------------------------------------------------------ |
| 1    | The specific file, function, or component under review |
| 2    | The expanded surface revealed by Loop 1 findings       |
| 3    | The proposed fix and its verification criteria only    |

#### Batching

Where multiple related findings exist — across files, handlers, or components — batch them into a single loop pass rather than running separate CCR threads per finding.

#### The Default Rule

The chunking standard above is the protocol default and is always applied unless explicitly overridden. An override requires a direct instruction that names the expanded scope. Absent an explicit instruction, the loop operates on the default chunk. Scope creep is not a judgment call left to the reviewer — it requires a named instruction to trigger.

#### Why This Matters at Scale

- **Cost-controlled** — each loop only processes what it needs
- **Faster** — smaller context windows produce faster completions
- **More accurate** — focused context reduces hallucination risk from irrelevant noise

### 3.2 Output Format

When the loop process clears threshold, the output follows this standard structure:

```markdown
## [Fix/Change Name] — CCR Verified

**Loop Summary**
| Loop | Confidence | Key Finding |
|------|-----------|-------------|
| 1 | XX% | [What Loop 1 found] |
| 2 | XX% | [What Loop 2 found] |
| 3 | XX% | [What Loop 3 confirmed] |

**Scope (Confirmed)**

- [File/component 1]: [Change required]
- [File/component 2]: [Change required]

**Pre-conditions**

- [ ] [Requirement 1 before merge]
- [ ] [Requirement 2 before merge]

**Commit Sequence**

1. [First commit — scope and purpose]
2. [Second commit — scope and purpose]
3. [Third commit — scope and purpose]

**Verification**

- [ ] [Post-merge check 1]
- [ ] [Post-merge check 2]

**Review Gates**

- [Commit X]: Requires [specific reviewer qualification]
```

### 3.3 Anti-Patterns

These behaviors indicate the protocol is being executed in form but not in substance.

| Anti-Pattern                                        | Why It Breaks CCR                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Assigning 95%+ in Loop 1                            | Loop 1 is a surface pass. A high score means the reviewer stopped looking too early.                                       |
| Combining commits to save time                      | Merged scope cannot be bisected. A regression becomes invisible.                                                           |
| Treating compilation as correctness                 | Code that compiles can fail at runtime. The compiler is not the test suite.                                                |
| Carrying Loop 1 scope into Loop 3 without expansion | If Loop 2 did not expand scope, Loop 2 was not run honestly.                                                               |
| Rounding up to 95%                                  | If the score is 93%, it is 93%. The gate is not a negotiation.                                                             |
| Running loops in parallel                           | The output of Loop N is the pressure input of Loop N+1. Parallel execution breaks the recursive design.                    |
| Expanding scope without a named instruction         | Scope creep requires an explicit override. Silent expansion violates the default chunk rule.                               |
| Being supportive instead of critical                | AI defaults to validation/confirmation bias. CCR requires engineering rigor — full-spectrum results, negative to positive. |

---

## 4. Critical Operational Notes

### Prompt Framing

The quality of CCR output is directly tied to prompt framing. AI models default to supportive, validating responses. CCR prompts must explicitly:

- Frame for engineering improvement and code quality, NOT supportiveness
- Ask for realistic results spanning the full spectrum (negative to positive)
- Request failure modes and worst-case analysis
- Override the AI's default guardrails that soften negative findings

### Prompts Are Data

The prompt that produced a CCR result is part of the engineering artifact chain:

- **Prompt** → how the question was framed
- **Confidence** → how well the prompt drove a high-confidence outcome
- **Result** → the decision, code, or artifact produced
- High-confidence first-pass results signal good prompt craft AND trustworthy output
- Iteration paths reveal where specs or context were insufficient
