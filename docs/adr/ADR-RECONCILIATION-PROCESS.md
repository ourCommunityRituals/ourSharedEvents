# ADR Reconciliation Process

**Purpose:** keep architecture decisions aligned with the live codebase and prevent stale ADRs from becoming the default interpretation of the system.

## Operating principle

- The code and tests are the source of truth for what the system currently does.
- ADRs are the source of truth for the decision rationale behind the code.
- If an ADR and the code diverge, the ADR is stale until it is reconciled.
- Stale admin/Linear state is not authoritative; it is drift to be reconciled, not a reason to reopen a story.

## Rules

### 1. ADRs are decisions, not operational truth

An ADR explains why the system is built a certain way, what trade-offs were considered, and which alternatives were rejected.

It does not claim to be the current state of every ticket, workflow, or narrative document. The system-of-record is the current implementation plus its tests and CI gates.

### 2. Reconcile before implementation starts

Before a story or refactor begins, the agent or developer must:

1. Read the relevant ADR(s)
2. Verify the implementation in the code and tests
3. Confirm whether the ADR still matches reality
4. If not, update the ADR in the same change set before continuing

### 3. Reconcile in the same PR as the code

Any change that affects architecture, behavior, contracts, invariants, or CI policy must include ADR reconciliation when relevant.

If the code change is a bug fix or a narrow implementation only, it may not require a new ADR, but it still requires a brief check: "Does this change invalidate an existing ADR or require a status update?"

### 4. Drift is explicit, not silent

A stale ADR must not remain silently wrong.

The update should either:

- bring the ADR in line with the current code, or
- mark the ADR as `Superseded`, `Deprecated`, or `Drifted` with a brief explanation and evidence reference

### 5. The repo prefers evidence over memory

When the ADR, code, and backlog/admin state disagree, the repo follows this order:

1. code + tests + CI evidence
2. active ADR rationale
3. backlog/admin state (historical and potentially stale)

This order keeps the repo aligned with reality instead of with stale board state.

## Required PR checklist

Each PR touching product behavior, architecture, or policy should include this checklist:

- [ ] Did this PR change an architectural decision, behavior contract, invariant, or CI rule?
- [ ] If yes, did I read the relevant ADR and verify the code still matches it?
- [ ] If the code and ADR diverged, did I update the ADR in this same PR?
- [ ] Did I record the evidence that proves the implementation status?
- [ ] If the change is intentionally broader or different from the ADR, did I mark the ADR as superseded or deprecated?
- [ ] Did I avoid using stale admin/Linear state as the source of truth?

## Drift register format

Use this format when reconciling or documenting drift:

```markdown
### ADR drift register

| ADR     | Status                          | Last verified | Code evidence          | Drift note                 | Owner   |
| ------- | ------------------------------- | ------------- | ---------------------- | -------------------------- | ------- |
| ADR-017 | Accepted / Drifted / Superseded | YYYY-MM-DD    | `src/...`, `tests/...` | Short note on what differs | @handle |
```

This is a lightweight record, not a substitute for ADR updates. The ADR itself stays the canonical rationale document; the drift register is only a reconciliation aid.

## Alignment workflow

Use this workflow during story starts, sprint review, or large reconciliations:

1. Read the relevant ADR(s)
2. Read the code path and tests behind the decision
3. Confirm alignment
4. If drift exists, patch the ADR and record the evidence
5. Continue only after the system narrative and the implementation align

## Recommended repo-wide rule

When a person or agent is uncertain, the default answer is:

> The code and tests are the operational truth. The ADR is the reasoned history. If they conflict, the ADR is wrong until it is reconciled.

This rule is the defense against stale architecture memory and stale backlog state.
