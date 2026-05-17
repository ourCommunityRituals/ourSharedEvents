# ADR-012: Consume canonical UEC at build time via a manually-synced TypeScript module

**Status:** Accepted
**Date:** 2026-05-17
**Deciders:** mzdan + Co-Architect

## Context

OSE-318 landed the canonical UEC v1.1 artifact in the brain repo at
`OCR-docs/ocr-docs-brain/uec-codes.yaml` (PR #49). OSE-319 enriched
Invariant #3 (`uec_encoding`) to rich form referencing that artifact
plus the future enforcement chain (OSE-322 static gate, OSE-323 drift
check, OSE-324 schema CI gate). With the brain side stabilized, the
OSE substrate now needs to consume the canonical UEC values rather
than carrying its own inline hex constants.

The architectural commitment under Invariant #3 is unambiguous:
"Brain holds the canonical artifact; substrate consumes at build time."
What was open before this ADR was **how** the substrate consumes it —
the brain artifact is a YAML file in a sibling repo; the OSE substrate
is a Cloudflare Worker bundle that prefers zero-runtime-YAML and a
single tree-shakeable module surface.

The forcing functions:

- **Zero-runtime-YAML for the Worker bundle.** Parsing YAML at request
  time adds cold-start latency and pulls a parser into the bundle. The
  data is small (11 codes, ~3 KB JSON-equivalent); embedding it as
  typed TypeScript constants is strictly cheaper than parsing at
  startup.
- **Tree-shakeable + statically-typed.** The TypeScript module form
  gives every consumer compile-time guarantees (typo a code id and
  TS yells; refer to a removed field and TS yells).
- **OSE-323 drift-check shape.** The next story explicitly assumes OSE
  has a separate "consumed copy" of the canonical artifact that CI can
  compare against the brain. A pattern where OSE auto-generates from
  the brain at build time would obviate the drift check — but it would
  also couple the OSE build to having OCR-docs cloned alongside, which
  is brittle for solo-dev workflows and conflicts with how OSE-322 and
  OSE-325 are scoped.
- **Per-PR governance.** Manual sync (rather than auto-generation) means
  every change to the UEC values requires a deliberate cross-repo PR
  flow: edit brain → merge → manually mirror in OSE → drift check
  catches misses. This is desirable architecturally because UEC changes
  are load-bearing and rare; a few-minutes-per-change cost is a feature.

## Decision

We consume the canonical UEC artifact via a **manually-synced
TypeScript module** at `workers/oursharedevents/src/lib/uec/uec-codes.ts`.
The brain YAML is the single source of truth; the TS module is OSE's
local mirror, kept byte-equivalent at the data level by a combination
of code review (per-PR) and CI drift check (OSE-323, to land).

The mirrored module is wrapped by a public lookup surface at
`workers/oursharedevents/src/lib/uec/index.ts` — `getCode()`,
`allCodes()`, `allCodeIds()`, `allCodeLabels()`, `allValidIdentifiers()`.
Per the brand-promise + governance intent of Invariant #3, this is the
**only sanctioned read path** for UEC values inside OSE; hex literals
for UEC colors must not appear anywhere else in `src/` (enforced by
OSE-322 static gate when it lands).

The first concrete consumer of the new surface is the new
`GET /api/v2/qr/generate` endpoint shipped in OSE-320 — a public,
no-auth utility that emits canonical UEC metadata + a QR data URI for
the requested code's `url_path`.

## Alternatives Considered

### Alternative A: Runtime fetch of the brain artifact

The OSE Worker fetches `uec-codes.yaml` from GitHub (or a mirror) on
cold-start, parses it, and caches the result.

**Rejected because:** introduces a cold-start network dependency on a
sibling repo that the OSE Worker has no business knowing about; adds a
YAML parser to the bundle; opens a class of failures (rate limits,
network blips) that the UEC surface has no business handling. The data
is small enough that embedding it is strictly better. Reserved as the
eventual end-state once multiple substrates (OSM, OW, OA) need to
consume the same UEC artifact — at that point a shared fetch +
distribution mechanism becomes worth the cost. Out of scope for now.

### Alternative B: Git submodule of OCR-docs in OSE

OSE includes OCR-docs as a git submodule and reads `uec-codes.yaml`
directly from the submodule at build time.

**Rejected because:** git submodules add real cognitive cost for solo
development (every clone needs `--recursive`; every brain update
requires a submodule bump commit in OSE; CI must handle submodule
checkout). The OCR-docs repo is far larger than just the UEC artifact;
pulling it as a submodule into OSE for one small file is the wrong
granularity. If OSE eventually needs to read multiple brain artifacts,
a submodule may be revisited.

### Alternative C: Build-time auto-generation from the brain YAML

A pre-build script reads `../OCR-docs/ocr-docs-brain/uec-codes.yaml`
and emits `src/lib/uec/uec-codes.generated.ts`. The OSE Worker imports
the generated file. Drift becomes impossible because the file is
regenerated every build.

**Rejected because:** couples the OSE build to the on-disk presence of
OCR-docs at a known relative path. This works for the founder's local
setup today but breaks the moment CI runs without the sibling repo
checked out, or a contributor clones only OSE. The drift problem this
solves is not severe — OSE-323 CI drift check catches it at PR time
with a clear error message. The brittleness of cross-repo path
assumptions exceeds the value of auto-generation.

### Alternative D: Vendored YAML + runtime parser

Copy the YAML file into OSE and parse it at module load with a small
YAML library.

**Rejected because:** keeps the YAML parsing cost (small but nonzero)
and adds a bundle dep with zero data-shape benefit over the chosen TS
module form. TypeScript constants give the same data with compile-time
type safety and zero parsing.

## Consequences

### Positive

- **Zero-runtime-YAML in the Worker bundle.** All UEC data is statically
  embedded as typed constants; tree-shaking removes any unreferenced
  metadata at build time.
- **Compile-time type safety.** Misspelling an id, accessing a removed
  field, or passing a non-canonical value to the lookup helpers all
  fail at `tsc` time rather than runtime.
- **Single read path.** `getCode()` is the only sanctioned way to read
  UEC values in OSE. Future OSE-322 static gate enforces this
  mechanically — hex literals for UEC colors anywhere outside
  `src/lib/uec/` will fail CI.
- **Clean drift-detection surface.** OSE-323 CI can compare
  `src/lib/uec/uec-codes.ts` against
  `OCR-docs/ocr-docs-brain/uec-codes.yaml` and fail PRs on divergence
  with a clear error message.
- **Per-PR governance for UEC changes.** Edits flow brain → OSE
  manually, which matches the architectural weight of these decisions
  (UEC values are load-bearing and rare; deliberate cross-repo flow is
  a feature).
- **No cold-start network dependency.** OSE Worker boot is unaffected.

### Negative

- **Drift risk if OSE-323 doesn't ship.** Until the CI drift check
  lands, the only thing preventing OSE's mirror from drifting away
  from brain canonical is per-PR review discipline. OSE-323 is the
  hard mitigation; until then, the per-story vitest spec
  `tests/uec-module.spec.ts` includes a "canonical hex values match
  brain artifact" block as a regression layer.
- **Manual sync cost on every brain change.** A brain edit (rare but
  load-bearing) requires a follow-up PR in OSE to keep the consumed
  copy aligned. The brand-voice migration sub-arc + the founder's
  doctrine of treating UEC changes as load-bearing make this an
  acceptable cost.
- **Substrate-by-substrate replication.** When OSM, OW, OA need UEC,
  each will need its own consumed copy + drift check. That replication
  cost becomes the trigger to revisit Alternative A (runtime fetch).

### Neutral

- The TS module is roughly 250 lines of typed constants — small but
  not negligible. It will rarely change. Code review on any change is
  appropriate given the architectural weight.
- The `getCode()` helper supports lookup by both `id` (e.g., `"ENTER"`)
  and `label` (e.g., `"Green"`), case-insensitive and whitespace-
  tolerant. This is a deliberate convenience for the new endpoint's
  external-API ergonomics — chosen because the OSE-320 AC's example
  uses `"green"` (label form) but external callers may equally pass
  `"ENTER"` (id form). Future consumers should prefer ids; labels work
  as a fallback.

## Implementation Notes

- **Brain canonical:** `OCR-docs/ocr-docs-brain/uec-codes.yaml`
  (OSE-318 / PR #49, merged 2026-05-17)
- **Brain schema:** `OCR-docs/ocr-docs-brain/uec-codes.schema.json`
  (OSE-318 / PR #49)
- **Brain invariant:** `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
  entry #3 `uec_encoding` (rich form, OSE-319 / PR #50, merged
  2026-05-17)
- **OSE consumed copy:** `workers/oursharedevents/src/lib/uec/uec-codes.ts`
- **OSE lookup surface:** `workers/oursharedevents/src/lib/uec/index.ts`
- **OSE endpoint:** `workers/oursharedevents/src/handlers/qr-generate.ts`
  routed at `GET /api/v2/qr/generate` in
  `workers/oursharedevents/src/router.ts`
- **Tests:**
  - Unit: `workers/oursharedevents/tests/uec-module.spec.ts`
  - API contract (vitest): `workers/oursharedevents/tests/qr-generate-endpoint.spec.ts`
  - API contract (Postman): `postman/collections/ose-api.json` group
    "10. UEC QR Generation"
  - FE: `tests/playwright/qr-generate-endpoint.spec.ts`
- **Linear:** OSE-320 (this story); blocks OSE-321 (refactor existing
  call sites), OSE-323 (drift check), OSE-326 (contract test suite)

## References

- [ADR-001](ADR-001-anonymous-identity-architecture.md) — establishes
  the brain ↔ substrate pattern that this ADR specializes for UEC
- [ADR-002](ADR-002-static-invariant-gates.md) — establishes the
  static-gate enforcement pattern that OSE-322 will apply to UEC
- [ADR-011](ADR-011-shared-report-wkrp-consumer-boundary.md) — prior
  art for "OSE consumes a contract owned by another repo"; SharedReport
  is the WKRP consumer-boundary case, UEC is the brain consumer-
  boundary case; same shape, different artifact
- [OCR_STANDARD_perStoryTestPyramid](../../.ocr-standards/standards/OCR_STANDARD_perStoryTestPyramid.md) —
  governs the 3-layer test pyramid (vitest + Postman + Playwright)
  applied in this story
- Brain invariant #3 (rich form) — full enforcement chain documented
  in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`

## Revisit Criteria

- **When the second OCR substrate consumes UEC** (OSM is the most
  likely candidate per `architectural-invariants.yaml` invariant #3
  `applies_to: [ose, osm]`). At that point, runtime fetch
  (Alternative A) or a shared package may become worth the cost.
- **If the UEC artifact grows beyond ~50 codes** — the manual-sync
  cost stays small per-change, but the total bundled data approaches
  meaningful Worker bundle size. Likely far future.
- **If the drift check (OSE-323) is consistently catching drift in
  practice** — that's the signal that manual sync isn't holding up
  and auto-generation (Alternative C) should be reconsidered, even
  with its brittleness cost.
- **If a regulatory or accessibility requirement forces UEC values to
  be runtime-overridable** (e.g., a venue with declared low-vision
  accessibility needs needs a high-contrast variant) — the build-time
  embedding becomes a blocker and runtime resolution becomes
  necessary.
