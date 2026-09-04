# OCR_VISION — ourSharedEvents (OSE)

> Product-level vision, derived from the org-level source of truth
> [`OCR-docs/docs/OCR_VISION.md`](https://github.com/ourCommunityRituals/OCR-docs/blob/main/docs/OCR_VISION.md)
> (vendored copy: `.ocr-standards/docs/OCR_VISION.md`). If it is not written there, it does not exist
> at the org level. This file is one of the four governance files every OCR repo carries
> (`CLAUDE.md`, `docs/OCR_VISION.md`, `README.md`, `SKILL.md`).

---

## What OSE is in the product line

OSE is **the platform** — the canonical instantiation of the Triangle
(`Sponsor → Event ← Customer`, `SharedReport` derived) and the **anonymous base layer** every
spoke inherits (OSG, OSR, OSP funnel through OSE; OSM provisions the anonymous class).

- **identity_mode: anonymous** — zero PII at the scan level, two physically separate D1 databases
  (`DB` anonymous, `FORMS_DB` opt-in PII with bounded retention). Brain invariant #1.
- **Sponsor model** — share-of-voice rotation, never a purchasable position (brain #25); the local
  sponsor covenant (#5) keeps locals in at every tier.
- **Six surfaces** — landing `/`, public `/events`, admin `/admin`, display `/display`,
  poster `/poster`, shared report `/sharedReport` (see `docs/features/SURFACES.md`).
- **Domain** — `oursharedevents.com` (staging `stg.oursharedevents.com`).

OW (ourWKRP) is the parallel **named** platform: same architecture and brand, separate database,
opposite identity invariant. The two never share data; cross-platform features are per-record
decisions (org VISION §6.5).

## Where the detail lives

| Topic                                           | Home                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Platform philosophy (3 principles, NCR horizon) | `docs/features/VISION.md`                                           |
| Session protocol, role POVs, constraints        | `CLAUDE.md`                                                         |
| Invariants this repo enforces                   | `tests/e2e/0-architecture/README.md` (mirror of the brain registry) |
| Route table                                     | header comment of `workers/oursharedevents/src/router.ts`           |
| Schema                                          | `workers/oursharedevents/migrations/` + `migrations-forms/`         |
| Org registry, corridors, NCR doctrine           | `OCR-docs/docs/OCR_VISION.md` §7–§9                                 |

## Open decisions owned by OSE

Tracked in Linear (team OurSharedEvents). Org-level open decisions live in the org VISION §10.

---

_Created 2026-09-03 (reconciliation pass — closes the "OSE VISION lives at docs/features/VISION.md
rather than docs/OCR_VISION.md" drift noted in the org VISION). Owner: Matt._
