# OCR_VISION — OurCommunityRituals LLC
## Org-level source of truth

> **If it is not written here, it does not exist at the org level.**
> All product repos derive from this document.
>
> Where this document describes invariants, the **source of truth lives in code** at `ourSharedEvents/tests/e2e/0-architecture/`. This document mirrors what the tests enforce.

---

## 1. North star

This platform is for the person at the bus stop on Western Avenue at 7am.

---

## 2. What OCR is

A simultaneous geographic experiment and a sustainable business.

- The business funds the experiment.
- The experiment proves the methodology.
- The methodology gives hyperlocal economies the tools to push back.

---

## 3. End state

Not a million dollars.

**Family comfortable. Health care not a worry. Passive income reached.**

After that threshold, the experiment becomes the point. The methodology gets published. The proof is in the archive.

Hyperlocal economies that own their own data, document their own vitality, and walk into city council hearings with three years of evidence. **Data that cannot be argued against because the community generated it voluntarily and owns it by design.**

---

## 4. Founding doctrine

OCR arrives with a framework and tools. Not predetermined answers.

The community provides the knowledge of what works locally.

OCR builds infrastructure around what is already alive.

---

## 5. Archive commitment

OurCommunityRituals LLC owns the platform and the infrastructure.

**The data your community generates while using our platform is yours.**

We give it to you by choice. Not because we have to. Because we choose to.

---

## 6. Architecture

Architecture is defined by **the Triangle** plus **four invariants** plus **the four governance files per repo**. Everything else is a derived pattern.

**Discipline: simplicity over completeness.** The code is the source of truth. This document mirrors what the code enforces. When code and document disagree, the code wins and this document gets fixed.

### 6.1 The Triangle

```
Sponsor → Event ← Customer
              │
        SharedReport
```

Three corners and a derived layer. Any entity can plug into any corner. The Triangle enforces **how** entities participate, not **what** they are. (See `ourSharedEvents/tests/e2e/0-architecture/README.md`.)

Open-ended examples of pluggable entities — drawn from code comments — include sports, school, church, museum, civic, tourism, bars, government, travel partners, faith organizations, university research nodes, healthcare clinics, and small business collectives. Matt's earlier examples (Bars, Schools, Hospitals, Recreational Centers, Business Meetings/Conventions, Sports, Art/Cultural, Political Rallies, Research Opportunities) fit this same shape — they are entity examples, not a fixed enum.

### 6.2 The ten invariants

Each invariant is (or will be) enforced by an executable test file in `ourSharedEvents/tests/e2e/0-architecture/`. A new product personality (OW, future verticals) must pass these to plug into the Triangle.

**Status legend**: ✅ in code · ⚙️ partial (CI gate or related tests exist; promote to 0-architecture suite) · 📋 proposed (write the spec)

| # | Invariant | Test file | Status | Enforces |
|---|-----------|-----------|--------|----------|
| 1 | **Anonymous ID** | `anonymous-id.invariant.spec.ts` | ✅ | Zero-PII scan system, two-database separation (DB / FORMS_DB), `ose_anon` cookie contract (HttpOnly, Secure, SameSite=Lax), no cross-linking |
| 2 | **Hyper-local Geo-Resolution** | `geo-resolution.invariant.spec.ts` | ✅ | `sponsor_areas` + `sponsor_event_types` tables, corridor-level resolution, zip+radius matching |
| 3 | **UEC Encoding** | `uec-codes.invariant.spec.ts` | ✅ | 7 color-semantic QR codes + 4 extensions; canonical hex values; URL path semantics |
| 4 | **NCR Data Accumulation** | `ncr-accumulation.invariant.spec.ts` | ✅ | `poster_deployments` lat/lng, `scan_aggregates` pipeline, permanent storage (no PII = no TTL) |
| 5 | **Tier Equity / Pricing Governance** | `tier-equity.invariant.spec.ts` | 📋 | Pricing tiers govern display priority within events only — never platform access. Same QR system, same form quality, same privacy protection, same real-time counts at every tier (Free / Mid / Enterprise). **Local stays in at all flag levels.** |
| 6 | **Inert Monetization Hooks** | `monetization-inert.invariant.spec.ts` | ⚙️ | `X-Monetization-Inert: true` header on every response. No billing logic executes. Billable units are read-only. Existing CI gate `checkMonetizationHooksInert` + contract test `story-f4-monetization-hooks_MOCK.test.js` already enforce; promote to 0-architecture suite |
| 7 | **Aggregate-Only Reporting** | `aggregate-only.invariant.spec.ts` | 📋 | SharedReport endpoints return aggregates only — never individual records. Closes the privacy story on the output side; the Anonymous ID invariant guards the data; this invariant guards the reports |
| 8 | **Bounded PII Retention** | `pii-retention.invariant.spec.ts` | ⚙️ | All opt-in PII has a finite TTL (`expires_at`, `retention_expires_at`). Daily lifecycle cron deletes expired registrations (90d), scrubs survey PII, deletes expired email signups (30d). No PII has unbounded retention. Cron + TTL columns + PRIVACY.md exist; promote unified test to 0-architecture suite |
| 9 | **Tenant Isolation** | `tenant-isolation.invariant.spec.ts` | ⚙️ | Dual-key pattern (`id` + `brandId`) on every multi-tenant table. No cross-tenant data leakage in queries. Brand-scoped URLs maintain isolation. Schema pattern exists; needs the cross-cutting test |
| 10 | **Deprecation Lock** | `deprecation-lock.invariant.spec.ts` | ⚙️ | Once a runtime is removed (GAS, Sheets, etc.), CI forbids its re-introduction. Generalizes the existing `scripts/guard-no-gas.js` and the no-GAS CI gate. Future deprecations (e.g., embedded HTML when Phase 3 Firebase lands) inherit this pattern |

**UEC color contract** (from the test file). The seven core codes:

| Code | Color name | Hex | Path |
|------|-----------|-----|------|
| ENTER | Green | `#1A6B2F` | `/enter` |
| LIVE | Coral | `#C04048` | `/live` |
| **SPONSOR** | **Blue** | **`#1A3A8A`** | `/sponsor` |
| ARCHIVE | Purple | `#5E1A9A` | `/archive` |
| HELP | Pink | `#B01468` | `/help` |
| FEEDBACK | Amber | `#8A5A00` | `/feedback` |
| UTILITY | Charcoal | `#2A2A3A` | `/utility` |

Four extensions: ALERT (Yellow `#B8960A`), STAFF (Red `#A00020`), CHECK-IN (Teal `#006B6B`), SHOP (Dark Teal `#1A4A48`).

Blue is "the most valuable pixel in the system" — the sponsor revenue surface. The color IS the instruction.

### 6.3 The four governance files per repo

Every repo in the OCR line maintains exactly four governance files. Architectural invariant.

| File | Role |
|------|------|
| `CLAUDE.md` | Session protocol and project brain. How an agent enters this repo. |
| `docs/OCR_VISION.md` | Product-specific vision, derived from this org-level document. |
| `README.md` | Public-facing description. Ten-second orientation. |
| `SKILL.md` | Reusable skills for AI-assisted work in this repo. |

**File naming convention.** Files outside the four above follow `OCR_<TYPE>_<subject>.md` in camelCase. Established types: `VISION`, `STATUS`, `LOG`, `ADR`, `DEPENDENCY`, `STANDARD`, `DECISION`, `PROMPT`, `CHECKLIST`, `RELEASE`, `GATE`, `REFERENCE`, `DASHBOARD`. Canonical `docs/` subfolders: `decisions/`, `standards/`, `corridors/`, `releases/`, `prompts/`, `ccr-gates/`, `references/`, `dashboard/`. Predictable names = inter-repo data interoperability.

### 6.4 The OSM + OA flywheel

OSM and OA are the **back** and **front** of one mechanism for spinning up new entity instances that plug into the Triangle.

| Side | Repo | Loads |
|------|------|-------|
| **Back** | **OSM — OurSharedMagnets** | APIs, Postman collections, Newman CI, ritual execution skill, institutional knowledge |
| **Front** | **OA — OurAirwaves** | Client workspace fork, onboarding runbook, per-client environment schema, deployment surface |

A new entity instance (a Hospital partner, a faith kitchen, a DJ profile) is hydrated by OSM loading the back and OA standing up the front. The instance inherits all four invariants by construction — no bespoke engineering.

OA serves at every scale: corridor, venue, partner, individual creator. Every DJ profile is effectively a single-person OA deployment.

**Provisioning identity + a premium solution-architecting service.** The flywheel does not just spin up default instances — it is a **solution-architecting tool**. OSM provisions the **anonymous** class (the OSE-class back: Postman API + FE **elements**); OA provisions the **named** class (the OW-class front). Pairing OSM's API + elements with **specs** stands up **custom front ends fast, for a premium** — OCR can build bespoke client sites for a fee on top of the core platform. Example (OA / named class): a DJ stands up a site in the infra, captures per-song QR scans during a set, and the SharedReport — promotion, shown interest, captured setlist traffic — is both the value proof and the upsell path from small venues to larger ones. Generalizes to any arts exploration: art walks, farmers markets, and beyond.

### 6.5 Platform symmetry — OSE and OW

OSE and OW are **parallel platforms with opposite identity invariants**, sharing architecture and brand but not databases.

| | OSE | OW |
|--|-----|-----|
| Identity | Anonymous ID — no PII (Invariant 1) | Named identity — voluntary attribution |
| Database | Separate | Separate |
| Funding | Sponsor model | Free, community-based |
| Posture | Operational platform for events | Cultural statement, music first, all arts capable |

"OSE + OW converge under the OCR moniker" means **shared architecture and brand**, not merged data. Cross-platform features (e.g., OW QR codes routing to anonymous OR named SharedReports) are per-record decisions, not database merges.

### 6.5.1 The three identity implementations

OSE-anonymous and OW-named are the two poles. The platform provides a third — **hybrid** — and the long-run goal is to offer **all three** implementations.

| Implementation | Identity model | Spokes |
|---|---|---|
| **Anonymous** | Zero-PII, aggregates-only (Invariant 1) | **OSE** (canonical); **OSM** provisions this class |
| **Non-anonymous / named** | Named identity, voluntary attribution (OW-class) | **OW**; **OA** provisions this class |
| **Hybrid** | Anonymous participation/voting/aggregates **+** named public personalities | **OW, OSG, OSR** (and OSE × OW) |

- **OSG and OSR inherit OSE's anonymous architecture** ("the setup to be OSE"). OW, OSG, and OSR are **hybrid-capable**.
- **Hybrid = anonymous aggregates + named personalities** — the named public faces of a vertical (DJs, Players, Curators, Artists, Presenters) ride on top of anonymous participation.
- **Hybrid is safe by construction, not by policy.** The named roster and the anonymous aggregates must be a **structurally impossible join** — the auth token is the choice boundary (the Fist-of-Five choice-token model). A named identity can never be recovered from an anonymous aggregate. This is what lets a single product carry both models without collapsing the anonymity guarantee (Invariant 1) into the named layer.

### 6.6 Data flow — OER as the BigQuery RAG

OER is the **BigQuery RAG layer**, set up at the org level. Every product database that holds qualifying data feeds it.

| Source | What flows in |
|--------|---------------|
| OSE | Anonymous event, sponsor, behavioral data |
| OW | Named curation data — voluntary attribution only |
| OA | Deployment-tier signals (no client PII) |
| OSM | API usage and ritual telemetry |

**Qualifying privacy gate.** A field qualifies only if it is anonymous-by-construction (OSE-class, Invariant 1) or named-with-explicit-voluntary-attribution (OW-class). Anything else stays in source.

**Query model.** Products do not query each other's databases directly. They emit qualifying data; OER ingests; OER answers cross-product questions.

### 6.7 Shared design system

The design system has one home: `@ocr/ui` in the hub monorepo (`ourCommunityRituals/ourCommunityRituals`, `packages/ui`), per ADR-008 (ratified 2026-09-29). It holds the tokens, the shared stylesheet served as `/ui.css`, and the HTML partials every surface uses.

- **Spokes consume it pinned.** Each spoke records the hub commit it builds against in `.ocr-hub-ref`. It must be a merged hub commit, and no spoke keeps a copy.
- **Spoke design debt only shrinks.** A blocking check (`check-spoke-styles`) records each spoke's existing own tokens, stylesheet and raw hex as a baseline, and fails any PR that grows them or raises the baseline. It is a ratchet, not a proof of zero: some colour forms (`rgb()`, CSS in script constants) are not yet measured.
- **Contrast is guaranteed for the token pairs.** Every text role clears AA on every ground in both themes and every brand, and the hub stylesheet holds a 13px text floor. Spoke-authored CSS is held to these only as far as the check above measures it.
- **Products differ by brand, not by system.** Each product's look is a registered `[data-brand]` theme (OSE's CARTO blue is the base; OW is amber). Brands repaint chrome only: status colours and UEC never re-theme.

---

## 7. Product registry

| Code | Product | Role | Data model |
|------|---------|------|------------|
| **OCR** | OurCommunityRituals LLC | Holding company. Org brain. Governance. | Governance |
| **OSE** | OurSharedEvents | The platform. Six surfaces. Sponsor model. Triangle canonical instantiation. | Anonymous ID |
| **OER** | OurEventRings | BigQuery RAG. Cross-product intelligence. | BigQuery / RAG |
| **OSM** | OurSharedMagnets | Back of the flywheel. API + skills + CI. | Developer-facing · provisions anonymous class |
| **OSP** | OurSharedPulse | Pre-platform consulting. Human-delivered. | No anonymous ID |
| **OSG** | OurSharedGames | Founding activation format. Anchor game nights. | Inherits OSE (anonymous) · hybrid-capable |
| **OSR** | OurSharedRecords | Music, story, archive. Oral history. | Archive · OSE-class anonymous · hybrid-capable |
| **OW** | OurWKRP | Community music curation. Named identity. Free. | Named identity · hybrid-capable |
| **OA** | OurAirwaves | Front of the flywheel. Deployment + white label. | Deployment · provisions named class |

### Per-product detail (only where it adds beyond the table)

**OSE — OurSharedEvents.** Cloudflare Worker + D1. Six display surfaces (Landing, Public Events, Admin Dashboard, Display, Poster, Shared Report). Domain: oursharedevents.com.

**OW — OurWKRP.** Same architecture as OSE, **separate database**, named identity. Free, community-based — a cultural statement, not a revenue product. Music is the starting medium; architecturally extends to all arts.

- **Fists of 5** — five-person teams competing through music. Spotify-plan workaround today; AppleMusicKit unlimited (Apple Developer license) is the target.
- **DJ layer** — DJs lead Fists of 5 teams. Every DJ has a personal profile, deployed through OA (front of the flywheel = single-person white-label).
- **QR referrals → SharedReports** — DJs display QR codes during sets. Codes can be anonymous (route to OSE-style reporting) or named (stay in OW). Per-code choice. Friday cadence, compounding.
- **Anchors and venue targets** — Primary: RIPH. White-label venue targets: Reckless Records, Smart Bar, Hyde Park Records.

---

## 8. Founding corridors — June 1 2026

| Corridor | Anchor | Role | Activation |
|----------|--------|------|------------|
| 📍 **Blue Island** | RIPH, Eagles Hall | AJ anchor. Municipal proof point. | Primary activation target |
| 📍 **Beverly** | Open OutCry | Archive anchor | April 9 archive start · September platform launch |
| 📍 **Brainerd** | — | Research comparator node | — |
| 📍 **Evergreen Park** | — | Cross-demographic corridor | Private and public |
| 📍 **Oak Lawn** | — | SW cross-demographic corridor | Private and public |
| 📍 **Mt Greenwood** | — | Adjacent ring — Beverly flywheel | — |

---

## 9. NCR methodology

**NCR — Node, Corridor, Ring** (also expanded as *Neighborhood, Community, Rituals* in OSE's platform philosophy doc).

- **Node** — the activation point. Geo-anchored at **H3 res9** (~0.1 km² — a specific venue/spot: RIPH, Eagles Hall).
- **Corridor** — the organic geographic thread connecting nodes. The `is_local` unit: **H3 res7** (~5 km²; a res7 cell contains ~49 res9 nodes, so a res7 match = "same corridor").
- **Ring** — the self-sustaining local economic loop (topological, not a cell).
- **Event** — what runs at a node (a bocce league night, a DJ set); rows are keyed to the node and stamped with its corridor cell.

**Containment (ratified 2026-08-24, OSE-999): Ring ⊃ Corridor ⊃ Node ⊃ Event.** A corridor (res7) contains many nodes (res9); a node hosts events. This is what the **code already enforces** — `sponsor_impressions.h3_res7` is stamped at write time (OSE-635), so every anonymous datum carries its corridor cell, and `is_local` is a res7 corridor-cell match. (NCR was informally spoken early as "Node ⊃ Corridor"; H3 geometry canonicalizes the reverse — the corridor is the region that contains nodes.)

**Resolution by signal (Accepted — implementation in flight, ADR-011).** res9 is for physical places only: a poster's placement, and live QR scans at the venue during the event. A shortlink click has no place of its own; it counts toward its event at the venue's res7. The corridor id that leaves for BigQuery/OER is the res7 cell string, and every export is res7 or coarser: a finer row is rejected, never trimmed. Named corridors (`blue_island`) are labels over sets of res7 cells. Device location is never an input.

A Ring closes when the corridor economy no longer depends on outside investment.

OSE's CLAUDE.md uses the same NCR letters for an event-lifecycle flywheel inside each Ring (Ads → Pre-Events → Events → Post-Events → SharedReports → loop). Both faces are valid: NCR-Geo describes WHERE, NCR-Lifecycle describes WHEN within each cycle. Both feed OER.

**Theory → math.** Because H3 reduces every location to a cell value, NCR-Geo is *computable*, not just conceptual. **Node saturation** and **corridor saturation** become measured thresholds: once enough anonymous usage (displays/scans, all res7-tagged) accrues across a node (res9) and its corridor (res7), the value at which a node or corridor is "saturated" is a number, not a claim. This is the OER payoff — and the covenant line holds: saturation measures the **corridor, never the person**.

Full doctrine: `LOCKED_NCR_Methodology_v1.3`.

---

## 10. Open decisions

- **Promote invariants 5–10 to the 0-architecture test suite** — write the proposed specs and migrate the partial CI-gate enforcement into the canonical location:
  - `tier-equity.invariant.spec.ts` (📋 new)
  - `monetization-inert.invariant.spec.ts` (⚙️ migrate from contract tests + CI gate)
  - `aggregate-only.invariant.spec.ts` (📋 new)
  - `pii-retention.invariant.spec.ts` (⚙️ unify cron + TTL tests)
  - `tenant-isolation.invariant.spec.ts` (⚙️ cross-cutting brandId test)
  - `deprecation-lock.invariant.spec.ts` (⚙️ generalize no-GAS guard pattern)
- **Qualifying privacy gate** — define field-level criteria for OW consent metadata, OA PII stripping, OSM telemetry boundaries.
- **OER ingestion threshold** — archive depth that triggers activation; per-source schemas, cadence, retention.
- **Sponsor schema vertical field** — per code review, the sponsor schema does not yet record which entity-type/vertical the sponsor belongs to. Decide whether to add (v1.2.0 contract bump + D1 migration) or rely on the entity-agnostic Triangle wrapper alone.
- **Apple Developer license (OW)** — application status, timeline, fallback if denied.
- **OW cross-arts expansion** — music is the starting medium. Roadmap and triggers for visual arts, performance, literature.
- **QR code routing rules (OW → SharedReports)** — when anonymous vs. named. Per-set, per-DJ, per-corridor?
- **OSE drift** — OSE CLAUDE.md says "5 MVP Surfaces" but should be 6 to match this document and OSE's own SURFACES.md. OSE's product VISION lives at `docs/features/VISION.md` rather than `docs/OCR_VISION.md` per the four-files invariant.

---

*Last updated: 2026-04-14 (v2 — code-matched rewrite. Architecture mirrors `ourSharedEvents/tests/e2e/0-architecture/`. Earlier inventions removed.)*
*Owner: Matt*
*Status: DRAFT — awaiting review. Source-of-truth version remains `OCR_VISION.md`.*
