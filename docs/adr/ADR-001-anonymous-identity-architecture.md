# ADR-001: Anonymous-identity architecture — separate the per-attendee data plane from the event-metadata data plane

**Status:** Accepted
**Date:** 2026-05-14
**Deciders:** mzdan + Co-Architect

> **Supersession-of-routing note (2026-09-10, OSE-1285).** The **regulatory-pool
> routing** described in the [Decision](#decision) section — `REGULATORY_POOLS =
['general', 'hipaa', 'coppa']` and the claim that "adding a fifth regulatory
> pool … is a `pool-contract.ts` edit + a new BigQuery dataset" — is **superseded
> by [ADR-018](ADR-018-declined-regulatory-regimes.md)**. HIPAA and COPPA are now
> _declined regimes_ (refuse, not route): `REGULATORY_POOLS = ['general']`,
> `phaseToPool(4|5)` throws, and the tier ceiling is clamped to 3. The revisit
> line "GDPR / BIPA / HIPAA / COPPA are all satisfied or improved by the
> separation" should be read as: HIPAA/COPPA are satisfied by being **declined**,
> not by being routed. **The rest of this ADR still stands** — the two-DB
> (`DB` ↔ `FORMS_DB`) separation, the anon_id contract, hourly bucketing, and
> the static gates are unchanged and remain the architectural floor.

## Context

OurSharedEvents (OSE) is an event-coordination platform whose value proposition to attendees is summarized in a single sentence rendered on every public event page:

> "You're part of the group, anonymously. We track when groups gather, not who you are. Event hosts and sponsors see corridors and venues, not people."

This sentence is **architecturally load-bearing**. It is not a marketing claim; it is the user-facing artifact of an implementation choice that is enforced at the database, handler, CI, and brain-invariant layers. If the implementation drifts, the sentence becomes a lie — and the entire trust model that distinguishes OSE from generic event platforms collapses. Conversely, if the implementation holds, attendees can be told the truthful, plain-language version of the architecture, and that explainability is itself a product feature.

The forces in tension when this decision was made:

1. **Two distinct data shapes coexist on the platform.** Event metadata (titles, 5W content, venue, host, corridor membership) is descriptive content authored by event organizers and intentionally shared. Per-attendee data (registrations, check-ins, survey responses, email signups) is private interaction data that must remain unlinkable to individuals.
2. **Sponsors need geographic and density data.** The "this event is at this venue, in this corridor, with this scan density" signal is the basis of hyperlocal sponsor matching (FEAT-04 and downstream). Sponsors must see the location-graph; they must never see the people-graph.
3. **Regulatory tiers are real.** Some events fall under HIPAA-adjacent rules (museum/medical), some under COPPA (school events), most under general state biometric/consent law (IL/BIPA, MI, IN, WI). The compliance posture is determined per event, but the data pipeline must physically segregate the resulting data flows so a HIPAA-tier event's data never lands in a general-tier dataset.
4. **The system must be cheap to operate at single-developer scale.** Two-database compartmentalization adds operational overhead; the design must absorb that cost without creating a maintenance black hole.
5. **The architectural choice must be enforceable by CI, not by review discipline.** Single-developer projects cannot rely on humans catching every cross-link bug; the data plane separation has to be a property the compiler / type system / static analyzer enforces.

This ADR records the decision that resolves these forces.

## Decision

We separate OSE's data into **two distinct D1 databases**, bound at the Worker runtime by separate environment bindings (`DB` and `FORMS_DB`), and we enforce the separation at three independent layers:

- **Database layer.** `DB` holds event metadata, sponsors, corridors, node hierarchy, poster deployments, scan aggregates, admin audit logs, shortlinks, and other non-attendee state. `FORMS_DB` holds form submissions (registrations, surveys, check-ins, email signups) and the regulatory pool audit log. There are zero foreign keys between the two databases; the schema cannot express a cross-link.

- **Handler layer.** Handlers that write or read per-attendee data live in `src/handlers/forms.ts`. Handlers that touch event metadata, sponsors, or any non-attendee table live in other handler files. The two classes of handler never share a function.

- **CI layer.** A static invariant gate (`tests/architecture.spec.ts`, OSE-205) parses every handler source file and asserts:
  - `forms.ts` MUST NOT contain `env.DB` or `.DB.prepare` references.
  - Non-forms handlers MUST NOT contain `env.FORMS_DB` references.
  - The forms-DB utility module (`lib/forms-db.ts`) MUST NOT reference any main-DB table.
  - The lifecycle/retention cron job MUST only write to `FORMS_DB`.

The correlation key between an attendee's actions across time is the **`anonymous_id`**, an HTTP-only / Secure / SameSite=Lax cookie set per visitor (see `src/lib/anonymous-id.ts`). It is opaque, unguessable and never linked to any real-world identifier: nothing in OSE can **resolve** it to a person. It is not, however, unlinkable inside OSE. The Worker reads it server-side and hashes it, so OSE can tell that the same browser came back to another event (pseudonymous correlation); that link is used only to count returns and never leaves OSE except as k-floored corridor counts. *Reconciled 2026-10-01: since migration 0062 (OSE-798) the main `DB` also holds the pseudonymous `anonymous_id` on `scan_node_returns`, kept in a separate table from the placement (WHERE) row and never joined to `FORMS_DB`; the nightly job hashes it into `anon_id_returns`, and since OSE-1460 only k-floored corridor counts of those hashes leave for OER.*

Time is **bucketed to the hour** at submission time (`bucketTimestamp()` in `lib/forms-db.ts` returns `toISOString().slice(0, 13)`). *Reconciled 2026-10-01 (OSE-1460): this ADR said 15-minute tranches; the code has always bucketed hourly, which is coarser, so the anonymity guarantee is unchanged.* This quantization is the temporal complement to the anon_id correlation: an attendee's exact submission time cannot be inferred from group-aggregate logs, only the bucket they fell into.

Regulatory tier compliance is implemented as a **routing concern, not a correlation concern**. `src/lib/pool-contract.ts` declares the regulatory pools and maps each to its dedicated BigQuery dataset. *Reconciled 2026-10-01: today the only pool is `general`; HIPAA and COPPA are declined regimes (OSE-1220), so `phaseToPool` refuses tiers 4–5 and those rows are withheld, never routed.* Per-event regulatory pool determines which dataset the form-submission row is forwarded to. The pools are physically separate at the BigQuery layer; cross-pool joins are not possible at the platform.

PII-bearing columns use one of three patterns:

- **Hashed** (peppered SHA-256): `subscribers.ip_hash`, `form_registrations.attendee_email_hash`, `email_signups.email_hash`. The pepper rotates per OSE-203 lifecycle.
- **Encrypted** (AES-GCM with retention TTL): `email_signups.email_encrypted`. Decryptable only with the server-side key + within the retention window.
- **Aggregated** (counter + hour bucket, no individual rows): `checkin_counts`, `scan_aggregates`. The unit of record is the bucket, not the visit.

The **`pii-invariant.spec.ts`** gate (OSE-207) asserts that no table in either database carries a raw network identifier column (`ip_address`, `client_ip`, `cf_connecting_ip`, `x_forwarded_for`, etc.).

The user-facing artifact of this decision is the **anonymity affordance** rendered on every public event page (`handlePublicEventPage` in `src/handlers/pages.ts`, OSE-243a). It states the architectural truth in plain language so attendees can read and verify the claim before deciding to RSVP.

## Alternatives Considered

### Alternative A: Single database with row-level access control

A single D1 database holding both event metadata and form submissions, with row-level access policies (e.g., a `pii_class` column + access predicates in handlers) to prevent cross-linking.

**Rejected because:**

- A single bug in a single handler, a single misconfigured access policy, or a single SQL `JOIN` written by a future contributor would cross-link attendee identity to event-author identity.
- Row-level enforcement is a _runtime_ contract; we need a _compile-time / static-analysis_ contract because we cannot rely on review discipline at solo-developer scale.
- The user-facing anonymity claim ("we track when groups gather, not who you are") becomes much harder to verify if a SQL `JOIN` is even _possible_ in principle. The product surface degrades.
- D1's row-level security primitives are nascent and would lock us to a specific access-policy mechanism that may not survive runtime upgrades.

### Alternative B: Per-event ephemeral storage purged after each event

Each event gets its own short-lived KV namespace or D1 instance that is purged within hours of the event ending. No long-term retention; no aggregate analytics.

**Rejected because:**

- Defeats the entire corridor-signal aggregation thesis. The whole point of the platform is to detect and reinforce community patterns _across_ events (corridor reverb, sponsor density, recurring group membership) over months and years.
- Cannot satisfy the regulatory-pool requirement: HIPAA/COPPA tiers explicitly require retained audit logs of consent + data-handling actions for compliance periods that exceed event lifetimes.
- Operational complexity: provisioning and tearing down per-event databases at scale would dominate the platform's failure surface.

### Alternative C: Hashed-but-correlatable IDs (e.g., `SHA256(email)`)

Use a deterministic hash of the user's email as the primary correlation key across event-metadata and form-submission rows. Allows cross-event analytics without storing plaintext PII.

**Rejected because:**

- Vulnerable to rainbow-table attacks: an attacker with a list of target emails can hash them all and look up every match. The "anonymity" is computational fiction, not architecture.
- The same person can be re-identified across events without their consent, defeating the per-event opt-in model OSE relies on.
- Email-as-identity also breaks for attendees who use different emails per context (work vs. personal) — they get partial re-identification.

### Alternative D (the chosen path): Two distinct databases + anon_id cookie + hourly buckets + static-gate enforcement

Described above under [Decision](#decision). Accepted.

## Consequences

### Positive

- **Cross-linking is physically impossible to land.** The static invariant gate fails CI on any PR that references the wrong database from the wrong handler class. A bug, a misconfigured handler, or an SQL JOIN cannot be introduced; the code that would do it cannot pass code review.
- **Regulatory tier compliance becomes a routing concern, not a data-correlation concern.** Adding a fifth regulatory pool (e.g., GDPR-strict) is a `pool-contract.ts` edit + a new BigQuery dataset; it does NOT require any changes to the handler topology.
- **Sponsors see the location-graph; never the people-graph.** Sponsor-matching code paths only ever touch `DB` (events, corridors, sponsor_areas, sponsor_event_types, sponsor_impressions). They have no API surface that exposes per-attendee data.
- **The user-facing anonymity claim is truthful.** Attendees can read the anonymity affordance on the public event page and verify it by inspecting the platform's behavior (no Set-Cookie set on the page load pre-RSVP; no anon_id present in event metadata responses).
- **Solo-developer maintenance is feasible.** The static gate is the primary review burden; once CI is green on a PR, the cross-link risk is eliminated. The human reviewer can focus on intent, not on auditing every query.
- **Brain invariant 1 (`anonymous_id`) self-extends.** When sibling OCR products (OW, OSM, OA, OER) come online, they inherit the contract; the brain pyramid validates conformance.

### Negative

- **Two migration paths.** Schema changes to forms-side data require a separate migration file in `migrations-forms/` from event-side changes in `migrations/`. Slight ongoing cost; absorbed by the canonical migration-smoke spec which validates both sets.
- **Two backup strategies.** Each database needs its own retention, restore, and rotation policy. Currently both rely on D1's default backup; if either needs custom logic, the work doesn't compose.
- **Handler classification onboarding cost.** Every new handler must be consciously placed in `forms.ts` or elsewhere before the static gate accepts it. A contributor who doesn't internalize the dichotomy will get bounced at CI and have to refactor.
- **Cross-database analytics requires explicit consent.** Analytics across the people-graph and the location-graph (e.g., "is event density correlated with corridor reverb?") cannot be done with a row-level JOIN. The analytics layer (downstream BigQuery) must perform the correlation only through aggregates (corridor × hour; since OSE-1460 no anon_id or anon_id hash is exported at all), never through row identity. This is a feature, not a bug, but it means analytics work is more deliberate.
- **Hourly bucketing reduces temporal resolution for the platform's own diagnostics.** Operational issues that depend on sub-hour event ordering (e.g., scan-rate spikes) are observable only via aggregates, not via individual submission times. Acceptable trade-off for the anonymity guarantee.

### Neutral

- **The compartmentalization extends one level deeper than most "PII isolation" implementations.** Many platforms isolate PII columns; OSE isolates the entire PII _plane_. This is intentional. It costs nothing extra at the database layer (D1 namespaces are free) and pays off the moment a future contributor proposes a feature that would have crossed the line.
- **The anon_id cookie is the only stateful per-visitor identifier.** Removing the cookie (manual deletion, incognito mode, etc.) does NOT break the attendee's experience — they get a new anon_id and become a "new" group member. The architecture tolerates anon_id loss gracefully because the platform's value isn't predicated on cross-session identity.

## Implementation Notes

- **Brain invariant 1** (`anonymous_id`) in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml`. CI-enforced contract across all OCR repos.
- **Static gates:**
  - `workers/oursharedevents/tests/architecture.spec.ts` — handler ↔ database binding gate (OSE-205, PR #148).
  - `workers/oursharedevents/tests/pii-invariant.spec.ts` — forbidden raw-PII column gate (OSE-207, PR #153).
- **Code:**
  - `workers/oursharedevents/src/lib/anonymous-id.ts` — anon_id cookie contract.
  - `workers/oursharedevents/src/lib/forms-db.ts` — `bucketTimestamp()`, `hashEmail()`, `encryptEmail()`, `decryptEmail()`.
  - `workers/oursharedevents/src/lib/pool-contract.ts` — regulatory pool routing + REQUIRED_TAGS.
  - `workers/oursharedevents/src/handlers/forms.ts` — every per-attendee handler.
  - `workers/oursharedevents/src/handlers/pages.ts` `handlePublicEventPage` + `ANONYMITY_AFFORDANCE` constant — user-facing artifact (OSE-243a, PR #167).
- **Database bindings** declared in `workers/oursharedevents/wrangler.toml` for both staging and production environments.

## References

- Brain invariants: [`OCR-docs/ocr-docs-brain/architectural-invariants.yaml`](../../../OCR-docs/ocr-docs-brain/architectural-invariants.yaml) — invariant id 1
- Doctrine: `feedback_pii_new_columns.md` — guides every net-new column on either database
- Doctrine: `feedback_security_first_gate.md` — the test pyramid that makes the gate work
- OSE-205 (architectural isolation gate PR)
- OSE-207 (PII guardrails + cross-DB no-raw-IP invariant PR)
- OSE-243a (anonymity affordance on the public event page)

## Revisit Criteria

This is a **foundational decision**; no expected revisit. The conditions that would trigger reconsideration:

- **A regulatory regime emerges that requires JOIN-able audit trails across the two planes.** (Not currently anticipated; GDPR / BIPA / HIPAA / COPPA are all satisfied or improved by the separation.)
- **A second product surface emerges that cannot tolerate the separation cost.** For example, an attendee-facing "your event history" view would require a different correlation model — but at that point we would build it as a _third_ surface that joins via the explicit anon_id + bucket protocol, not as a JOIN across the two databases. The ADR for that surface would supersede or extend this one, not invalidate it.
- **D1 introduces a primitive that makes the static-gate enforcement obsolete.** E.g., if Cloudflare ships a runtime-level binding-isolation guarantee that's strictly stronger than the source-code static gate, the gate could be deprecated in favor of the platform guarantee.

Until one of those triggers fires, this ADR is the architectural floor.
