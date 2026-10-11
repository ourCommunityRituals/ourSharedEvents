---
name: ccr
description: Run a CCR (Critical, Conservative, Recursive) review, the standard for assessments, code and PR reviews, production-readiness and test-gating decisions in OCR repos. Use when asked for a "CCR", a confidence check, or "is this ready to ship".
---

# CCR: Critical, Conservative, Recursive (v3 core)

Full protocol: `.claude/skills/ccr-protocol.md` (read the sections you need). Worksheet template: `.claude/skills/ccr-template.md`. Quick reference: `.claude/skills/ccr-protocol.knowledge.md`.

## 1. Classify (sets the loop count)

| Under review                                                                            | Loops                     |
| --------------------------------------------------------------------------------------- | ------------------------- |
| Typo, comment, formatting (all six Lite criteria hold)                                  | CCR Lite: 1               |
| Bug fix                                                                                 | 3                         |
| Security fix                                                                            | 3–4                       |
| Major upgrade                                                                           | 4–5                       |
| Architecture change; governance files (AGENTS.md, CLAUDE.md, STORIES.md, this protocol) | 5+                        |
| Compliance surface                                                                      | 5+, human gate every loop |

The owner may ask for more loops. Never fewer.

## 2. Each loop runs three layers in order

1. **Critical:** what is the most dangerous assumption? What is true versus assumed?
2. **Conservative:** assume the worst case. Does the floor still hold?
3. **Recursive:** score it and compare with the last loop. A drop is the protocol working; don't argue it back up.

Loop 1 surface pass, loop 2 pressure pass, loop 3 confirmation, then more as classified. Each loop's findings change what the next loop checks (reactive correction). **Loops are never run in parallel.** Inside one loop, role lenses may fan out to subagents (`.claude/agents/role-*`, `dr-of-security`) and be merged once.

## 3. Score

`Score = 100 − Σ (unresolved finding × weight)`. Weights are fixed: **Regulatory 25 · Critical 15 · High 10 · Medium 5 · Low 2**.

- **Security Critical gets no partial credit:** any unresolved one floors the system score at 0%.
- Keep two numbers apart: the **system score** (the thing under review) and the **assessment confidence** (how sure you are of the findings).
- **Evidence or it didn't happen:** "verified" needs a citation (`file:line`, a command and its output, a CI run). Say which findings are source-read inference and which were proven at runtime.
- **95% to pass.** 93% is 93%. Scoring 95%+ on loop 1 means you stopped looking.

## 4. Gate

- Below 95%, or confidence falling between loops: **stop.** Write the human gate: the exact question, the information that would close it, and the loop and layer where the gap appeared.
- A CCR score is a signal, never permission. Merging and deploying still need required checks and the PO.

## 5. The extended scrum team

When asked for the "extended scrum team", include all of: PO, Lead BE Architect, Lead FE Integration, Sr Design FE, Sr Automation QA, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist and **Dr of Security** (always). The extended **business** team is PO, Business Analyst, FinOps, Product Strategist, Risk & Compliance and Launch/Customer Ops.

The Dr of Security judges efficacy and gating reality, not a catalogue: a gate that cannot fail counts as absent. The role label steers attention; the rigour comes from the evidence.

## 6. Output

Write `.claude/outputs/CCR-<TOPIC>-<YYYY-MM-DD>.md` containing:

- the verdict table (system score, assessment confidence, gate result);
- what was reviewed, in scope and out of scope;
- each loop: team, Critical / Conservative / Recursive, findings, score;
- the findings register with weights and the score arithmetic;
- what must be true before shipping, the commit sequence, verification after shipping, and risks accepted;
- the human-gate questions.
