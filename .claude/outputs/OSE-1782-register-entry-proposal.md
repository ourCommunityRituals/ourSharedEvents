# Proposed invariant-register entry: nothing publishes a count except through count-floor

Status: **proposed**, for the owner to place in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`
under `privacy_identity`, beside the existing aggregate-only entry. An agent does not edit the
register (AGENTS.md: the org list is OCR-docs).

Evidence: OSE-1782 (this change), OSE-1751 (instance 1, corridor baseline read path),
OW-158 (instance 2, public DJ stats under 5), the cumulative-across-shows design caught
2026-11-01 (instance 3). Epic OSE-1783.

```yaml
- id: <next free number>
  group: privacy_identity
  title: Every published count goes through the shared count-floor module
  statement: >
    A count is published only through the count-floor module (apply the floor,
    round down to a multiple of five, chain-floor related counts). No surface
    formats its own number. Two related published counts, or a running total and
    its previous value, must not differ by 1 to 4, because the difference names a
    group under the floor.
  why: >
    The same defect (two related counts published independently, so arithmetic
    between them recovers a hidden group) was found three times in four days in
    three places written at three times. It is a missing structural rule, not
    carelessness.
  enforced_by:
    - workers/oursharedevents/tests/count-floor-publication.derived.spec.ts # reads the public projection's field list and the src/ tree
    - workers/oursharedevents/tests/count-floor.spec.ts # the primitives, incl. rounding and the cumulative series
    - bruno/ose-api/2. Public Events API/OSE-1782 - public event - carries no count field.yml # staging
  evidence: [OSE-1782, OSE-1751, OW-158]
```

Scope of the gate today: it covers the public event projection and the location of the
primitives. It does not yet cover SharedReport read-path numbers (OSE-1751 fixes the corridor
baselines and should extend the gate to them) or the ourWKRP cumulative report (separate repo).
