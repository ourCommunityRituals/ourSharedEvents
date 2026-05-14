# ADR-002: Static-invariant gates as the load-bearing CI pattern

**Status:** Accepted
**Date:** 2026-05-14
**Deciders:** mzdan + Co-Architect

## Context

OurSharedEvents enforces a set of cross-cutting architectural rules that
cannot be expressed as runtime tests because they are properties of the
code itself, not of any single execution path:

- Handlers in `src/handlers/forms.ts` MUST NEVER reference `env.DB`, and
  handlers in non-forms files MUST NEVER reference `env.FORMS_DB`. This
  is the static gate that makes the two-database identity separation
  (ADR-001) physically unbypassable.
- All paginated list endpoints MUST return a `{ items, nextCursor }`
  shape — never an array, never `{ data, next_page }`. Without this,
  pagination drift across handlers silently breaks downstream consumers.
- No persisted column MAY hold raw PII (raw IP, raw email, raw phone) —
  every such column must be peppered-hashed or AES-GCM-encrypted with a
  registered retention TTL. A net-new raw column is one bad PR away from
  a data-protection incident.
- All foreign-key columns MUST be `TEXT` (matching the `id` primary-key
  type), never `INTEGER`. A type mismatch produces silent zero-row joins
  at runtime — the worst kind of bug, because tests pass and behaviour
  rots.
- Form-submission validators MUST cap free-text fields at the contract
  body size, fail closed on missing required fields, and route to the
  correct regulatory pool. A validator regression here violates both
  the contract and the pool-routing invariant.

Each of these rules is a global property of the codebase, not of any
single endpoint. A regular Vitest behavioural test can't catch them —
behavioural tests assert what one execution path does, not what every
file in the repo can never do.

The trigger for codifying this pattern explicitly: across OSE-205,
OSE-207, OSE-227, OSE-236 and several earlier-pulse stories, the
Co-Architect and reviewers kept independently reaching for "let's add
a static gate" as the fix. The pattern was already de-facto load-bearing
in CI; this ADR makes it the explicit, named, foundational pattern.

## Decision

We treat **static-invariant gates** — Vitest specs that read source
files as text (via `TEST_SOURCE_FILES_JSON`) and assert structural
properties — as the **primary mechanism** for enforcing cross-cutting
architectural rules in OurSharedEvents.

Each invariant lives in its own `tests/<name>.spec.ts` (or
`tests/<name>-invariant.spec.ts`) file, runs in the standard T0 Gate
shard, and fails the PR if violated. The gate is by name and by
contract part of the test pyramid — not a lint plugin, not a custom
script, not a doc.

The five canonical static-invariant gates today:

| Gate                             | File                                       | What it enforces                                                                             |
| -------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Architecture (two-DB separation) | `tests/architecture.spec.ts`               | Forms handlers MUST NOT touch `env.DB`; non-forms handlers MUST NOT touch `env.FORMS_DB`     |
| Pagination shape                 | `tests/pagination-shape-invariant.spec.ts` | All list endpoints return `{ items, nextCursor }`                                            |
| PII columns                      | `tests/pii-invariant.spec.ts`              | No raw IP/email/phone columns; all PII is hashed or AES-GCM with TTL                         |
| FK type                          | `tests/fk-type-invariant.spec.ts`          | All FK columns are `TEXT`, matching id PK type                                               |
| Form validation                  | `tests/form-validation-invariant.spec.ts`  | Validators cap field sizes, fail-closed on required fields, route to correct regulatory pool |

A new architectural rule is added by writing the **gate first** — the
gate must fail against pre-fix code, and pass after the fix lands.
Documentation alone is not sufficient evidence per the
"sweep evidence hierarchy" doctrine (memory:
`feedback_sweep_evidence_hierarchy.md`): CI-wired test execution > code
in src > runbook content.

## Alternatives Considered

### Alternative A: Custom ESLint rules

We could express each invariant as a custom ESLint rule.

**Rejected because:** ESLint rules require a publish/install dance for
the shared rule package, are AST-level (which is the wrong granularity
for "this file MUST NOT contain this string" checks), and live outside
the test pyramid that gates merges. The lint pass also runs on a
different shard than tests, so a regression in the lint shard could
mask test-shard wins. Static gates inside Vitest piggy-back on the
existing T0 Gate (tests) shard with no new tooling.

### Alternative B: Pre-commit hooks (Husky / lint-staged)

We could push these checks into git pre-commit hooks.

**Rejected because:** pre-commit hooks are bypassable (`--no-verify`),
client-side (each developer must install them), and don't run in CI.
Static gates expressed as Vitest specs run identically on every PR,
every push, every merge — there is no client-side state to drift.

### Alternative C: Runtime assertions

We could add startup-time runtime assertions inside the Worker.

**Rejected because:** runtime assertions ship the violation to production
and only catch it on a code path that actually exercises the bad shape.
A handler that reads `env.FORMS_DB` from a non-forms file would only
crash on the first request that hit that path; the cross-link bug would
be live until then. Static gates fail at PR time — before the code can
land.

### Alternative D: External linting service (e.g., Semgrep)

We could outsource these checks to a SaaS linter.

**Rejected because:** the rules are OSE-specific and need to evolve
alongside the codebase. A SaaS rule definition that lives in a separate
repo or dashboard adds a synchronization burden and a vendor dependency
for a problem we can solve in 50–100 lines of Vitest per rule.

## Consequences

### Positive

- The five most load-bearing architectural properties of OSE are
  **mechanically enforced** on every PR. A bad PR cannot land.
- Each gate is a single file in the test directory — easy to find, easy
  to read, easy to extend, no plugin machinery.
- Adding a sixth, seventh, or Nth gate is a small contribution: write
  the spec, add it to the T0 Gate (tests) shard implicitly (Vitest
  globbing), done.
- The gates double as living documentation: a new developer can read
  `tests/architecture.spec.ts` and understand what the static rule is,
  what counts as a violation, and how to fix it.
- The pattern composes with brain invariants: each gate corresponds to
  one entry in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`,
  making the contract auditable from a single index.

### Negative

- Each new architectural rule now has a non-trivial spec-writing cost
  before it can be enforced. There's a temptation to skip the gate and
  rely on review — that temptation must be resisted (per doctrine).
- Static gates read source files as text, which can produce false
  positives on legitimate cases (e.g., a comment referencing
  `env.FORMS_DB` in a non-forms file). The gates accept this cost by
  requiring exact-string matches scoped to specific source ranges.
- A regenerated `TEST_SOURCE_FILES_JSON` is a small generated artifact
  that must be re-built when new handler files are added. This is a
  one-line change in `vitest.config.mts` per addition.

### Neutral

- The pattern is OSE-specific today but inherently portable to every
  OCR sibling app (per the user's "every app runs the same pyramid"
  feedback memory). ADR-005 may codify the pattern as a shared
  `@ocr/static-gates` package; until then each app duplicates ~50 lines
  of harness code.

## Implementation Notes

- **Code:** `workers/oursharedevents/tests/architecture.spec.ts`,
  `tests/pagination-shape-invariant.spec.ts`,
  `tests/pii-invariant.spec.ts`,
  `tests/fk-type-invariant.spec.ts`,
  `tests/form-validation-invariant.spec.ts`
- **Harness:** `workers/oursharedevents/vitest.config.mts` exposes
  `TEST_SOURCE_FILES_JSON` as an env var so the gates can read source
  files without depending on Node's `fs` module under the workers pool.
- **Brain invariants:** `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
  entries 1 (anonymous_id / two-DB), 2 (pagination shape), 4 (PII
  columns), 5 (FK type), 7 (form-validation contract).
- **PRs:** OSE-205 (architecture), OSE-206 (pagination), OSE-207 (PII),
  OSE-227 (FK type), OSE-236 (form-validation) — each landed the gate
  alongside the fix it codified.

## References

- ADR-001 (anonymous-identity architecture) — relies on the architecture
  static gate as its enforcement mechanism
- Memory: `feedback_security_first_gate.md` — security gates BEFORE lint
  on every surface
- Memory: `feedback_sweep_evidence_hierarchy.md` — CI-wired test
  execution > code in src > runbook content
- Memory: `feedback_flywheel_completion.md` — every SDLC phase orients
  to the loop; static gates close the design→code phase

## Revisit Criteria

- If gate count exceeds ~15, consider splitting into a dedicated
  static-gate Vitest shard (T0g) for parallelism.
- If two or more OCR sibling apps end up duplicating the same static
  gate (e.g., FK type), promote it to a shared `@ocr/static-gates`
  package and write ADR-005 to capture that decomposition.
- If a static gate proves too flaky (false positives drive devs to
  weaken it), revisit its scope — but never delete a gate without
  replacing it with a stricter mechanism. The doctrine is no rule
  weakening without a stronger substitute.
