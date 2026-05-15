# ADR-011: SharedReport read API as the WKRP consumer boundary

**Status:** Accepted
**Date:** 2026-05-15
**Deciders:** mzdan + Co-Architect

## Context

OSE-272 ships the SharedReport — the data product OSE sells per BEACHHEAD-ICP. Sessions 3 and 4 land the materialization (D1 aggregates) and BigQuery export (per-pool analytics). **Session 5 ships the product surface** — the HTTP read API that bars, sponsors, and (in-fleet) ourWKRP consume.

OurWKRP is a SIBLING product in the OCR fleet. Per `~/.claude/.../memory/project_ourwkrp_vision.md`, WKRP is the **personal-network flag-planting platform** — DJs, curators, chefs, bands, and temporal events. Its users (creators) are **non-anonymous identities**: a DJ wants their gigs attributed to their performer profile so audiences can find them.

This creates a tension. OSE's foundational architecture (ADR-001) is **anonymous-attendance**: `anonymous_id` is HTTP-only, never resolved to identity, and the FORMS_DB ↔ DB split is enforced by static-invariant gates. Yet a DJ on WKRP needs SharedReport data — return rate, corridor density, headcount trend — about events they performed at.

How does WKRP get OSE's SharedReport data **without breaking OSE's anonymity invariant**?

Two architectural options were on the table:

1. **WKRP-as-D1-binding-consumer** — give WKRP a Cloudflare D1 binding to OSE's database. WKRP reads `anon_id_returns`, `corridor_density_baseline`, etc. directly. No HTTP layer.
2. **WKRP-as-API-consumer** — WKRP calls OSE's HTTP SharedReport API (`GET /api/v2/events/:id/shared-report` + a new batch endpoint). OSE controls the response shape and what's exposed.

The decision needed to be made **in Session 5** because Session 5 is where the API shape gets locked in. A batch endpoint added later as a retrofit would carry consumer drift; getting the shape right at the start lets WKRP integrate cleanly on day one.

## Decision

**WKRP integrates with OSE via the SharedReport HTTP read API, not via a direct D1 binding.** A new batch endpoint (`POST /api/v2/events/shared-reports/batch`) is added to Session 5 scope specifically to make this consumer pattern friction-free.

Concretely:

1. WKRP stores `performer_events(performer_id, event_id)` in **its own DB** — never in OSE.
2. WKRP's backend calls `POST /api/v2/events/shared-reports/batch { ids: [...] }` with the event IDs a creator performed at (max 50 per call per S5-Q3).
3. WKRP authenticates via a service-account bearer token (`WKRP_SERVICE_TOKEN`, Doppler-managed). Token rotation handled out-of-band.
4. OSE returns aggregate SharedReport objects only. No `anon_id_hash`. No performer identity (OSE doesn't know any).
5. WKRP joins identity locally in its own database, presenting the data on the performer's profile page.

The API contract becomes the **stable seam** between the two products. Schema evolution on either side is insulated; consumer onboarding for future fleet members (ourAirwaves, ourSharedMagnets whitelabel, OurEventRings analytics fabric) follows the same pattern.

## Alternatives Considered

### Alternative A: WKRP-as-D1-binding-consumer

Give WKRP a Cloudflare D1 binding to OSE's database and read `anon_id_returns` / `corridor_density_baseline` directly. No HTTP layer, no auth indirection, fewer moving parts.

**Rejected because:**

- **Schema coupling.** Any change to OSE's table shape (column rename, type change, table split) would silently break WKRP. The API contract is a stable seam; the schema is not.
- **Anonymity-by-construction risk.** A direct D1 binding gives WKRP raw access to every column in every row of every aggregate table. The HTTP API can withhold or transform; the binding cannot. If OSE ever stores a column that's safe-for-internal-cron-use but unsafe-for-external-consumer-use, the binding leaks it by default.
- **No batching semantics.** A D1 binding is per-row; the consumer would write its own join logic. The batch endpoint puts the bounded fan-out at the right layer — OSE owns the "I'll resolve N events for you" contract, including the 50-ID cap that prevents accidental DOS.
- **Future consumers can't replicate the pattern.** ourAirwaves, ourSharedMagnets, OurEventRings — each is a different runtime (different Workers, different Cloudflare accounts maybe). A D1 binding is OSE-account-internal; an HTTP API is universal.
- **Permission boundaries are weaker.** D1 binding access is binary — "you have it or you don't." The HTTP API can carry signed-link tokens (per-event scoping), service-tokens (per-product), or admin-bearer tokens with different visibility levels.

### Alternative B: WKRP-pulls-from-BigQuery

WKRP queries BigQuery directly using the per-pool datasets that Session 4 populates. No OSE HTTP layer needed; BigQuery is the analytics surface.

**Rejected because:**

- **Latency.** BQ queries take 1–5s; D1 reads through OSE's HTTP API take <100ms. A DJ profile page needs the product-grade latency.
- **Cost.** BigQuery charges per byte scanned. A profile-page query that filters to one performer's 30 events scans more than its return-rate would justify.
- **Freshness.** BQ has the latest _exported_ tick (1-tick lag); D1 has the latest _materialized_ tick. Cheaper to read the fresher source.
- **Wrong tier.** BigQuery is the **analytics** surface for dashboards, third-party data warehouse queries, and the OurEventRing fabric. The OSE read API is the **product** surface for the things bars/sponsors/creators see. Mixing the two would push BigQuery's analytical workload into the product hot path.

### Alternative C: Single-event GET only; let WKRP iterate

Ship only `GET /api/v2/events/:id/shared-report` (single-event) and let WKRP make N sequential calls for a creator's N gigs.

**Rejected because:**

- **N+1 calls.** A working DJ has 4–20 gigs/month; a touring band has 50+. Even at 100ms per call, 50 sequential GETs is 5s of waterfall — unacceptable on a profile page.
- **Cache fragmentation.** Per-event cache entries don't help when each consumer wants the same N events together.
- **Adds the batch later carries consumer drift.** First-mover consumers (WKRP) would build their own batching workaround before the batch endpoint shipped, then refactor when it landed. Better to ship the endpoint with the first consumer.

## Consequences

### Positive

- **OSE's anonymity invariant (ADR-001) is preserved by construction.** WKRP never sees an `anon_id_hash` because the API never returns one. The architectural moat extends across products without coupling.
- **Schema evolution insulated.** OSE can refactor `anon_id_returns`, add columns, change indexes — the HTTP response shape is the contract.
- **Future fleet consumers inherit the pattern.** ourAirwaves, OSM whitelabel, OurEventRings — each gets a service token and uses the batch endpoint. The integration shape is fleet-wide.
- **Per-event-cache + per-consumer batch.** Bars and sponsors hit the single-event endpoint with 1h `Cache-Control: private`; in-fleet consumers hit the batch endpoint with `no-store` (consumer manages its own cache). The two patterns coexist cleanly.
- **Bounded fan-out at OSE.** The 50-ID cap on the batch endpoint is OSE's defensive limit; it prevents a misbehaving consumer from triggering 10,000-event queries.
- **Identity-mode boundary respected.** OSE is `anon`; WKRP is `non-anon`. The HTTP API is the seam where the two identity models meet without one polluting the other.

### Negative

- **One more service token to manage.** `WKRP_SERVICE_TOKEN` must be provisioned in Doppler, rotated periodically, and revoked if compromised. Operational cost.
- **Network hop instead of local read.** Every WKRP profile page load triggers an HTTP call to OSE. Sub-100ms typical, but it's there.
- **OSE rate-limit must accommodate WKRP traffic.** As WKRP grows, OSE's batch endpoint sees more load. Mitigation: per-token quotas (Phase 2 concern, out of scope for Session 5).

### Neutral

- **WKRP becomes an OSE API client.** This is a normal product relationship in modern multi-tenant architectures; not a problem, just a fact to acknowledge in the WKRP operational runbook when it ships.
- **The batch endpoint costs ~4h of additional Session 5 implementation.** Small.

## Implementation Notes

- **Affected files (Session 5):**
  - `src/handlers/shared-report-read.ts` — single + batch handlers
  - `src/lib/shared-report-auth.ts` — signed-link + service-token verification
  - `src/lib/shared-report-builder.ts` — pure D1 reader that both endpoints share
  - `src/router.ts` — 2 new routes wired
- **Brain invariant:** No change. ADR-001's anonymous-identity architecture is preserved by construction; this ADR documents the consumer-boundary pattern that extends it across products.
- **CI gate:** Gate 6 in `tests/shared-report-pipeline-invariants.spec.ts` enforces that the read handlers never INSERT/UPDATE/DELETE in pipeline tables, and that the auth lib never touches D1.
- **Service token format:** Opaque bearer (random 32-byte URL-safe base64). Rotated via Doppler.
- **Future consumer onboarding:** When ourAirwaves or OSM whitelabel needs SharedReport data, they get their own service-token env var (`OAIRWAVES_SERVICE_TOKEN`, etc.) and the handler grows a small dispatcher to validate against any of the registered tokens. Out of scope for Session 5.

## References

- ADR-001 — Anonymous-identity architecture (the invariant this ADR extends)
- ADR-002 — Static-invariant gates (Gate 6 is the new instance of this pattern for the read API)
- `docs/features/SHARED-REPORT-DATA-PIPELINE.md` — Session 1 design that named the six SharedReport fields
- `docs/features/SHARED-REPORT-READ-API.md` — Session 5 design where the batch endpoint was ratified
- `~/.claude/.../memory/project_ourwkrp_vision.md` — WKRP vision and identity model
- `~/.claude/.../memory/reference_app_identity_map.md` — per-product identity-mode matrix
- `OCR-docs/OPERATING_SYSTEM.md §3` — routing matrix that locates this ADR in the fleet layer

## Revisit Criteria

Re-open this decision if:

- A consumer requires real-time push updates from OSE (the HTTP API is pull-only; a push pattern would require something like Cloudflare Queues or webhooks).
- A regulatory regime requires direct audit-trail access to the underlying D1 rows that the API obscures (currently no such regime).
- The batch fan-out costs at OSE exceed the network savings at WKRP (would need >1,000 batch req/min sustained — not foreseen in Phase 1-2).
- A future fleet product needs a fundamentally different anonymity model (e.g., differential privacy). The HTTP layer can grow that capability without changing this ADR's boundary shape.

No expected revisit in the next 12 months; the API-consumer pattern is the foundational integration shape for the OCR fleet.
