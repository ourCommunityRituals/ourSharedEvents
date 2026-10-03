# Architecture Decision Records

This directory holds the formal Architecture Decision Records (ADRs) for OurSharedEvents. Each ADR captures **one** consequential architectural choice — the context, the alternatives that were considered, the decision, and the consequences — in a single Markdown file that lives next to the code.

ADRs are **descriptive, not prescriptive**. They record decisions that have already been made (or are imminently about to be made), so future contributors can understand _why_ the system is the way it is without having to re-derive the reasoning. They are **the only place** where the long-form "why" lives — the [Brain invariants](../../../OCR-docs/ocr-docs-brain/architectural-invariants.yaml), CI gates, and doctrine memory files capture the _what_ and the _enforcement_, but not the trade-off reasoning behind them.

## Documentation reconciliation status (2026-09-22)

Architecture and backlog docs are being reconciled to the live codebase. The backlog/admin state is not the source of truth for implementation status; direct code + test evidence is.

The live audit in `../audits/LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md` found a meaningful set of already-implemented tickets in the reviewed slice, including OSE-1348, OSE-1346, OSE-1344, OSE-1280, OSE-1216, OSE-1176, OSE-1125, OSE-1101, OSE-1074, and OSE-1061/1066/1067. Those items should not be treated as still-open backlog work unless a regression or missing contract is demonstrated in code.

This ADR index reflects decisions that are accepted and implemented in the codebase; it is intentionally not a backlog tracker for stale Linear/admin state.

## ADR reconciliation process

This repo uses a code-first reconciliation rule: the implementation and tests are the source of truth, and ADRs are the explanation of the decision. If they differ, the ADR must be updated in the same change set.

See [ADR-RECONCILIATION-PROCESS.md](ADR-RECONCILIATION-PROCESS.md) for the full process, required PR checklist, and the drift-register format used to keep architecture docs aligned with the code.

## Status

| #                                                                | Title                                                       | Status   | Date       |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ---------- |
| [ADR-001](ADR-001-anonymous-identity-architecture.md)            | Anonymous-identity architecture (DB ↔ FORMS_DB separation)  | Accepted | 2026-05-14 |
| [ADR-002](ADR-002-static-invariant-gates.md)                     | Static-invariant gates as the load-bearing CI pattern       | Accepted | 2026-05-14 |
| [ADR-006](ADR-006-audit-access-bearer-pattern.md)                | Audit access architecture — dedicated bearer pattern        | Accepted | 2026-05-16 |
| [ADR-009](ADR-009-ncr-v2-geographic-hierarchy.md)                | NCR v2 geographic hierarchy                                 | Accepted | 2026-04    |
| [ADR-010](ADR-010-templates-breadth-tiers-depth.md)              | Templates breadth × tiers depth                             | Accepted | 2026-04    |
| [ADR-011](ADR-011-shared-report-wkrp-consumer-boundary.md)       | SharedReport read API as the WKRP consumer boundary         | Accepted | 2026-05-15 |
| [ADR-012](ADR-012-uec-build-time-consumption.md)                 | UEC build-time consumption via manually-synced TS module    | Accepted | 2026-05-17 |
| [ADR-013](ADR-013-local-sponsor-covenant-display-priority.md)    | Local Sponsor Covenant via display-priority sort            | Accepted | 2026-05-18 |
| [ADR-014](ADR-014-ai-sanitization-sanctioned-seam.md)            | `ai-sanitization.ts` as the single sanctioned AI seam       | Accepted | 2026-08-15 |
| [ADR-015](ADR-015-invariant2-tier-sort-named-slot-retirement.md) | Invariant-2 tier-sort named-slot retirement                 | Accepted | 2026-08    |
| [ADR-016](ADR-016-api-v2-response-contract.md)                   | API v2 response contract                                    | Accepted | 2026-08    |
| [ADR-017](ADR-017-sharedreport-depth-enforcement.md)             | Enforce SharedReport depth server-side, at one point        | Accepted | 2026-08-16 |
| [ADR-018](ADR-018-declined-regulatory-regimes.md)                | Declined regulatory regimes (HIPAA/COPPA/SOPPA refuse)      | Accepted | 2026-09-10 |
| [ADR-020](ADR-020-copilot-ci-human-approval-gate.md)             | Keep the human approval gate on Copilot-authored CI         | Accepted | 2026-09-26 |
| [ADR-021](ADR-021-production-read-only-test-data.md)             | Keep production read-only for every test suite              | Proposed | 2026-10-01 |
| [ADR-022](ADR-022-event-is-the-base-brand-is-optional.md)        | Event is the base unit; brand is an optional tracking layer | Proposed | 2026-10-03 |

ADR series in progress (planned, in numerical order — none of these block any current work):

- ADR-003 — Cursor pagination over offset (locked by PR #155 invariant gate)
- ~~ADR-004 — Self-hosted runner pool readiness probe + watchdog architecture (Brain invariant 12)~~ — withdrawn 2026-09-02 (OSE-1194): the self-hosted pool was retired and invariant 12 is `retired` in the brain; the number stays reserved, never reused
- ADR-005 — Co-Architect decomposition pattern: Option-C deferral and the halt-criterion discipline

## When to write an ADR

Write a new ADR when the change you are making has **at least two** of:

1. A real architectural alternative was rejected. (If there was only one way to do it, it's a tactical choice, not a decision.)
2. A consequence will be felt for ≥ 6 months. (If you'd refactor it next sprint without a second thought, skip the ADR.)
3. The "why" is non-obvious from the code. (If a future contributor could understand the choice in 30 seconds by reading the relevant file, skip the ADR.)
4. The decision touches more than one surface (handler, schema, CI, doctrine, brain contract, or compliance posture).
5. The decision creates or modifies a CI-enforced invariant.

If the change satisfies 0 or 1 of those, **don't write an ADR.** A PR description is sufficient. ADRs are scarce by design — a backlog of 200 trivial ADRs is worse than a focused set of 20 consequential ones.

## When NOT to write an ADR

- Bug fixes. (Even big ones; the bug is the context, not a decision.)
- Refactors that don't change observable behavior or contracts.
- Library upgrades that don't change the integration surface.
- Stories whose AC is dictated by reality (e.g., "FK type must match referenced column type" — that's not a choice).
- Anything where the Linear ticket + PR description already captures the reasoning adequately.

## Numbering

ADRs are numbered sequentially with leading zeros: `ADR-001`, `ADR-002`, `ADR-015`. Numbers are **assigned at the time the ADR is written**, never reserved. If two ADRs are drafted in parallel, the one that lands on `main` first gets the lower number.

Once an ADR is on `main`, **its number never changes**, even if it's later superseded or deprecated. The number is the permanent reference identity.

## Lifecycle

ADRs progress through these statuses:

| Status         | Meaning                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Proposed**   | Drafted but not yet implemented. Most ADRs skip this state because we record decisions as they ship.                                                   |
| **Accepted**   | The decision is in effect. The corresponding code, gates, and brain contracts are live.                                                                |
| **Deprecated** | The decision is no longer the recommended approach but is still in effect (e.g., legacy code hasn't been migrated yet). New code should not follow it. |
| **Superseded** | A later ADR has replaced this one. Mark the new ADR's number in the `Status` line: `Superseded by ADR-NNN`.                                            |

ADRs are **immutable once Accepted** except for the `Status` line. If the decision needs to change, write a NEW ADR that supersedes the old one. This preserves the historical record.

## Template

Use [`template.md`](template.md) as the starting point for new ADRs. The MADR (Markdown Any Decision Record) format is used throughout:

```markdown
# ADR-NNN: [Decision title in imperative voice]

**Status:** Accepted | Proposed | Deprecated | Superseded by ADR-MMM
**Date:** YYYY-MM-DD
**Deciders:** [Names or roles]

## Context

[What forces are at play? What problem are we solving?]

## Decision

[What is the chosen approach? State it crisply.]

## Alternatives Considered

[Each alternative with brief description + why it was rejected]

## Consequences

### Positive

[What becomes easier / safer / cheaper]

### Negative

[What becomes harder / more expensive / requires ongoing discipline]

### Neutral

[Trade-offs that are neither wins nor losses but worth knowing]

## References

[Links to relevant code, brain invariants, CI gates, prior ADRs, doctrine files]
```

## Relationship to other architectural artifacts

| Artifact                   | Lives at                                                   | Role                                                                                                                              |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **ADRs** (this directory)  | `docs/adr/ADR-NNN-*.md`                                    | Long-form **why** for consequential decisions                                                                                     |
| **Brain invariants**       | `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`    | Machine-readable **what** — 12 codified contracts each repo must honor                                                            |
| **Static invariant gates** | `tests/*.invariant.spec.ts` + `tests/architecture.spec.ts` | CI-enforced **proof** that the contract holds in the code                                                                         |
| **Doctrine memory**        | `~/.claude/.../memory/feedback_*.md`                       | Decision **principles** that govern many ADRs (flywheel doctrine, priority hierarchy, security-first gating, anonymity principle) |
| **PR descriptions**        | GitHub PR bodies                                           | Tactical context per change — NOT the place for long-term architectural reasoning                                                 |
| **Linear story comments**  | Linear ticket threads                                      | Live debate during scope definition. Conclusions migrate to ADR if consequential.                                                 |

Together these form the architectural surface of the platform. ADRs are the human-readable spine; the brain invariants + CI gates are the enforcement layer; doctrine is the principles layer; PR descriptions and Linear comments are the changing log.

## Process for adding a new ADR

1. Identify the decision while it's fresh (during the PR that implements it, ideally; latest, on next-PR retro).
2. Run the "should I write an ADR?" criteria above. If ≥ 2 apply, proceed.
3. Copy `template.md` to `ADR-NNN-kebab-case-title.md`. The number is `1 + max(existing ADR numbers)`.
4. Fill out all sections. Keep Context concise. Spend the most words on Alternatives Considered + Consequences.
5. Cross-link from the relevant code, brain invariant, or doctrine file back to the ADR.
6. Update the Status table at the top of this README.
7. Land the ADR in a focused docs PR (not bundled with feature work — ADRs deserve their own review attention).

ADRs that follow this process become the historical record future Co-Architects (human or agent) consult before changing direction. The discipline pays off when someone proposes a change that would silently violate a decision recorded years earlier — the ADR makes the violation visible.
