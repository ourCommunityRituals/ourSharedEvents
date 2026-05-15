# OCR Standard — Brain enforcement code lives next to Brain content

**Status:** Live · **Owner:** OCR governance · **Effective:** 2026-05-15

## Rule

Any script, test, or check whose purpose is to **enforce the shape of**
`OCR-docs/ocr-docs-brain/*.yaml` (the parseable contracts that govern
the fleet) MUST live inside `OCR-docs/ocr-docs-brain/scripts/` or
`OCR-docs/ocr-docs-brain/tests/`. It MUST NOT live in:

- The workspace root (`ourCommunityRituals/packages/`,
  `ourCommunityRituals/tools/`, anywhere outside OCR-docs).
- Any individual application repo's `.github/scripts/`, `scripts/`, or
  source tree.
- A separate "ci-scripts" repo, package, or marketplace action.

## Why

The Brain is the single source of truth for OCR governance. Its content
(`product-registry.yaml`, `flags-contract.yaml`, `event-taxonomy.yaml`,
`architectural-invariants.yaml`, `tier-gates.yaml`, etc.) declares the
shape of the world. The code that enforces that shape — checking
consumer repos against it, opening drift tickets, parsing the YAMLs for
structural validity — is *part of the Brain*. If it lives elsewhere,
every contract change becomes a cross-repo coordination problem: edit
the YAML in OCR-docs, edit the enforcement in some other repo, hope the
two PRs land in the right order.

Co-locating content and enforcement means one PR, one review, one diff.

The workspace root (`ourCommunityRituals`) exists for **shared
toolchain**: pnpm-workspace config, runner provisioning, build-tool
configs, monorepo plumbing. It is not the home of governance code.

## What counts as "Brain enforcement code"

- **Yes** — any script that parses a Brain YAML for shape, presence of
  required fields, schema validity, or cross-references between
  contracts.
- **Yes** — any script that compares an external artifact (an app
  repo's source, a deployed environment, a CI job's output) against a
  Brain YAML and reports drift.
- **Yes** — any test in `tests/level*_*.py` that asserts the Brain's
  own integrity.
- **Yes** — any tool that opens tickets, posts comments, or fails CI
  *because* of Brain drift.
- **No** — a consumer reading a single field from a Brain YAML at
  runtime (e.g., the propagator reading `product-registry.yaml` to know
  which repos to PR). That's a *consumer*, not an enforcer.
- **No** — application code that imports a generated constant derived
  from a Brain YAML (e.g., `@ocr/flags` reads `flags-contract.yaml`
  at build time to generate TypeScript types).

The boundary: enforcement code answers *"is this shape correct?"*
Consumer code answers *"give me the value at this path."*

## Examples

| File | Belongs in | Why |
|---|---|---|
| `check_brain_contract.py` | `OCR-docs/ocr-docs-brain/scripts/` | Validates consumer repo against Brain shape. |
| `open_drift_ticket.py` | `OCR-docs/ocr-docs-brain/scripts/` | Operates on a Brain conformance report. |
| `level1_lint.py` | `OCR-docs/ocr-docs-brain/tests/` | Asserts Brain YAML internal validity. |
| `audit_brain_enforcement_location.py` | `OCR-docs/ocr-docs-brain/scripts/` | Enforces *this* standard. |
| `tools/runner/janitor.ps1` | `ourCommunityRituals/tools/runner/` | Self-hosted runner maintenance — toolchain, not governance. |
| `packages/flags/scripts/generate-from-yaml.mjs` | `ourCommunityRituals/packages/flags/` | Consumer reading the contract to emit code. Build tool, not enforcement. |
| App repo's `tests/anonymity-invariant.spec.ts` | The app repo | Application-level invariant test, not Brain enforcement. |

## How this rule is enforced

1. **Nightly audit** — `OCR-docs/.github/workflows/brain-location-audit.yml`
   runs `ocr-docs-brain/scripts/audit_brain_enforcement_location.py`
   against the workspace root and every app repo listed in
   `product-registry.yaml`. Any filename matching the forbidden pattern
   set (`check_*_contract*.py`, `*brain_contract*.py`,
   `*drift_ticket*.py`, etc.) outside its allowed home triggers a
   Linear ticket.
2. **Architectural invariant 13** — encoded in
   `ocr-docs-brain/architectural-invariants.yaml` so any tool that
   reads invariants for compliance reporting sees this rule.
3. **Propagated standard** — this document propagates to every app
   repo's `docs/standards/` via the OCR-docs standards propagator, so
   every developer sees the rule wherever they're working.

## Exceptions

If you genuinely need to add an enforcement script outside OCR-docs
(extreme case: a check that can only run inside a particular app
repo's container at deploy time and physically cannot import from a
sibling repo), document the exception inline in the script's docstring
AND in `architectural-invariants.yaml` invariant 13's `exceptions:`
list. The nightly audit reads that list and won't ticket files it
recognizes as exempted.

## History

- **2026-05-15** — Standard authored after a brain-enforcement script
  (`check_brain_contract.py`) was centralized into the workspace root
  in April 2026 and produced noisy false-failures on stub-repo
  propagator PRs throughout April–May. The fix (relocate into
  OCR-docs) revealed that nothing prevented the same mistake from
  recurring. This standard plus invariant 13 plus the audit workflow
  closes that gap.
