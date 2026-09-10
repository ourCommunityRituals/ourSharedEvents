# ADR-016 — `/api/v2` response contract: one envelope, one name per value

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** PO (Matt) + backend lead
- **Tickets:** OSE-842 (X-9, envelope), OSE-844 (X-10, field names), OSE-871 (P-1, public dual-reads)
- **Invariants touched:** #16 `api_response_schema_stability` (live), #1 `anonymous_id` (live), #21 `shared_report_schema_stability` (live, untouched)

## Context

Two drifts had accumulated at the `/api/v2` seam, both invisible at runtime and
only biting a new caller:

1. **Envelope (X-9).** Multiple 200 shapes shipped across the handlers, and the
   event-state string and the numeric HTTP status both travelled under the key
   `status` inside `poster-bundle`.
2. **Field names (X-10).** The DB projects `title` / `start_date` / `location`;
   every surface template reads `name` / `startDateISO` / `venue`. Nothing
   bridged the two, so a seeded event rendered "Untitled Event" on the display
   TV and an empty ticker. `public.html` had grown `|| e.title` /
   `|| e.start_date` / `|| e.location` dual-reads — a local patch that taught
   every future surface author that two names per value is normal (X-10 → P-1).

The direction of both fixes is a contract decision, not a unilateral DEV call.

## Decision

**Envelope — Option A.** Every `/api/v2` 200 carries `ok: true` and a numeric
`status` equal to the HTTP status, with the payload under a named key
(`items` / `item` / `bundle` / `report`). Where `status` previously carried an
event-state string (`poster-bundle`), that value is renamed (`eventStatus`) so
`status`, where present, is always the numeric HTTP status.

**Field names — Option A.** The API emits the canonical names
`name` / `startDateISO` / `venue`, mapped **once** in `enrichWithPhase`
(`handlers/events.ts`) — the single enrichment seam feeding list, detail and
admin-list — rather than in four templates. The DB columns remain in the payload
(additive; #16 is a floor, not a ceiling), so no snapshot column is removed.
Templates and `public.html` then read one name per value; the `|| 'Untitled
Event'` / `|| 'Event'` / `|| 'Untitled'` fallback literals are deleted.

Reconciliation reason: `public.html` already dual-read these names, and the
`public-events` snapshot + `bundle-response` schema already named `startDateISO`
— the codebase was already leaning Option A. The event carries the location, so
`venue ← location` is the natural mapping (PO, 2026-08-19).

## Consequences

- **Positive.** One unwrapping mental model for the FE. The display TV, poster
  and public grid render real title/date/venue for a seeded event. The drift is
  now guarded by an object whose job is to go red:
  `tests/e2e/0-architecture/api-response-schema.invariant.spec.ts` asserts the
  `enrichWithPhase` mapping and the snapshot's `computed_fields`; an integration
  spec (`events-field-name-contract.spec.ts`) drives a seeded row through
  `SELF.fetch` and asserts the emitted names; the display Playwright spec that
  _documented_ the gap now asserts the real shape.
- **Neutral / additive.** `public-events.snapshot.json` → v1.1.0, adding
  `name` / `startDateISO` / `venue` to `computed_fields`. No column removed.
- **Deliberately deferred (tracked, not silently dropped).** Verify-first found
  much of X-9 already resolved in the tree: the `src/frontend/apiClient/base.ts`
  `data.value` unwrapper, the `tests/contract/*.js` files asserting the phantom
  `{ ok, value, etag }` seventh shape, and a `poster-bundle` schema snapshot **do
  not exist**. The genuine X-9 residual is narrow — the `poster-bundle` `status`
  collision (rename → `eventStatus`) and unifying the two surviving `jsonResponse`
  signatures — and stays on OSE-842. This ADR records the contract; that residual
  is its remaining implementation.
- **Untouched.** #21 locks the SharedReport top-level fields; this change does
  not move them (`status` would be added only as an envelope sibling of `report`,
  which is out of scope here and left to the OSE-842 residual).

## Enforced by invariants

Back-reference added per OSE-1291 / CCR finding F3 (ADR↔invariant traceability),
recorded in the OCR-docs brain `architectural-invariants.yaml`:

- **Invariant #16 — api_response_schema_stability.** This ADR *is* the `/api/v2`
  response contract (envelope + canonical field names); #16 is the invariant
  that locks it. (Header line above already declared "#16 … (live)".)
- **#1 anonymous_id** and **#21 shared_report_schema_stability** are *touched*
  by this seam but governed by their own ADRs — #1 by ADR-001, and #21 is
  explicitly left **untouched** here (see Consequences), so neither gets a
  governing back-link to ADR-016.
