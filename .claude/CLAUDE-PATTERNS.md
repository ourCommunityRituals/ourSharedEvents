# CLAUDE-PATTERNS.md — Decision Patterns & Confidence Framework

> Reusable decision patterns for Claude Code sessions working on ourSharedEvents.
> These patterns prevent repeated mistakes and encode institutional knowledge.

---

## CCR Framework — Context, Confidence, Response

Every decision Claude Code makes follows the CCR loop:

1. **Context** — What do I know? Read CLAUDE.md, STORIES.md, relevant code.
2. **Confidence** — How sure am I? Evaluate evidence quality against thresholds.
3. **Response** — What do I do? Act, document assumptions, or stop and flag.

The CCR framework prevents two failure modes:
- **Over-confidence**: Proceeding with incomplete evidence → broken code, wrong assumptions
- **Under-confidence**: Flagging everything → slow progress, decision paralysis

---

## CCR Confidence Threshold Scoring Rubric

### CRITICAL Threshold — Proceed Without Flagging

**Evidence is complete, all dependencies confirmed, no ambiguity.**

| Criterion | Required |
|-----------|----------|
| Source file(s) read and understood | Yes |
| All referenced dependencies exist and are verified | Yes |
| Acceptance criteria are unambiguous | Yes |
| No conflicting information across CLAUDE.md, STORIES.md, or code | Yes |
| Prior art or pattern exists in codebase | Yes |

**Action:** Execute immediately. No flag needed. Document what was done in commit message and PR.

### CONSERVATIVE Threshold — Proceed With Assumption Documentation

**Evidence is strong but one or more dependencies unconfirmed.**

| Criterion | Required |
|-----------|----------|
| Core source file(s) read and understood | Yes |
| Primary dependencies exist and are verified | Yes |
| One or more secondary dependencies unconfirmed | Allowed |
| Acceptance criteria are mostly clear with minor interpretation needed | Allowed |
| Reasonable inference from existing patterns | Yes |

**Action:** Proceed with implementation. Explicitly document all assumptions in:
- Code comments at the assumption point
- PR description under an "Assumptions" section
- Commit message noting what was inferred vs. confirmed

### RECURSIVE Threshold — Stop, Flag, Do Not Proceed

**Evidence is insufficient or contradictory. Human judgment required.**

| Criterion | Trigger |
|-----------|---------|
| Referenced file does not exist | Stop |
| Acceptance criteria conflict with existing code behavior | Stop |
| Multiple valid interpretations with different architectural outcomes | Stop |
| Dependency on infrastructure not yet provisioned (and cannot be mocked) | Stop |
| Change would affect shared state (DB schema, API contract) without clear spec | Stop |
| Information in CLAUDE.md contradicts STORIES.md or code | Stop |

**Action:** Do not proceed. Flag to human with:
1. What was attempted
2. What evidence was found
3. What is missing or contradictory
4. Suggested resolution options (if any)

---

## Pattern Library

### Pattern: File Not Found
- **Confidence:** RECURSIVE
- **Action:** Flag. Do not create placeholder content. Ask human where the file lives.

### Pattern: Schema Change
- **Confidence:** CONSERVATIVE minimum, CRITICAL preferred
- **Action:** Always create a new numbered migration. Never modify existing migrations.

### Pattern: API Contract Change
- **Confidence:** CRITICAL required
- **Action:** Only proceed if the change is explicitly specified in a story's BE Route Spec.

### Pattern: Legacy Reference
- **Confidence:** CONSERVATIVE
- **Action:** Mark as `[ARCHIVE - NOT CURRENT]` inline. Do not delete — preserve historical context.

### Pattern: Infrastructure Dependency
- **Confidence:** RECURSIVE if requires live infra, CONSERVATIVE if can be mocked/tested locally
- **Action:** Write code and tests. Flag infra gap. Do not block on provisioning.
