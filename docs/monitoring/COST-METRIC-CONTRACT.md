# Cost Metric Contract — `OPERATION_COST` (COST-303 / OSE-782)

> Companion to the implementation in
> [`workers/oursharedevents/src/lib/cost-metric.ts`](../../workers/oursharedevents/src/lib/cost-metric.ts)
> and the never-who invariant
> [`tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts`](../../tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts).
> This contract is enforced against the code by the L7 test
> [`tests/contract/cost-metric-contract.contract.test.js`](../../tests/contract/cost-metric-contract.contract.test.js)
> — the documented schema and the emitted schema cannot drift.

## Why this metric exists

The free-forever promise to churches and chosen clients is structurally
sustainable **only while served-user runtime stays cheap** — deterministic
Cloudflare Workers compute at ~0 LLM tokens. To keep that honest we must _see_
runtime cost as it grows, so we can act **before** the 100× scaling watch-item
(below) bites. `OPERATION_COST` is that visibility, emitted once per request to
Workers Logs (`[observability] enabled = true` in `wrangler.toml`).

It is deliberately **aggregate-only / never-who**: observability must never
become a privacy back-door. Cost is a property of an operation _type_, never of
a person.

## The emitted schema

Exactly one line is emitted per request, at the `index.ts` fetch seam:

```json
{
  "type": "OPERATION_COST",
  "op": "GET /api/v2/admin/events/:x",
  "wallMs": 12,
  "d1RowsRead": 8,
  "d1RowsWritten": 0,
  "d1Queries": 2,
  "status": 200
}
```

| Field           | Type   | Meaning                                                               |
| --------------- | ------ | --------------------------------------------------------------------- |
| `type`          | string | Always the literal `"OPERATION_COST"` (log-routing discriminator).    |
| `op`            | string | Method + **keyword-masked** route label. See "Operation label" below. |
| `wallMs`        | number | Wall-clock milliseconds for the whole request (rounded, ≥ 0).         |
| `d1RowsRead`    | number | Sum of D1 `rows_read` across the request.                             |
| `d1RowsWritten` | number | Sum of D1 `rows_written` across the request.                          |
| `d1Queries`     | number | Count of D1 statement executions in the request.                      |
| `status`        | number | HTTP status code of the response.                                     |

This is the **complete** set. The payload is a sealed literal built
field-by-field in `emitOperationCost()`; there is no code path that can add a
field at runtime.

## Never-who guarantee — what is forbidden

The payload MUST NEVER carry, in any field, directly or by derivation:

- user identifiers of any kind — email, name, phone, user id, account id
- the anonymous visitor id / `anon_id_hash` or any hash of a person
- IP address (`CF-Connecting-IP`) or any network locator
- admin `actor` / bearer identity
- auth tokens, cookies, secrets, or the `FORMS_ENCRYPTION_KEY` / peppers
- **raw path segments** — an event slug, QR token, or resource id (any of which
  could identify a specific church, event, or attendee)

### How the guarantee holds (three legs)

1. **Sealed payload** — `emitOperationCost()` constructs an explicit
   `OperationCostMetric` literal with the fixed key set above. Extra properties
   on the accumulator or inputs are never read.
2. **Operation-label masking** — `normalizeOperation()` uses an **allowlist** of
   known static route segments. Every segment that is not a recognized keyword
   is replaced with `:x`. The default is to mask, so a slug/token/id can never
   surface even for a route the allowlist has not enumerated.
3. **Structural + contract tests** — the never-who invariant locks the sealed
   key-set and forbids identifier tokens in the payload/emitter; this contract
   test locks doc↔code parity. A new field or a leaked identifier turns CI red.

## Operation label (`op`)

`op` = `<METHOD> /<masked-path>`. Segments are kept verbatim only if they are in
the `STATIC_SEGMENTS` allowlist (route keywords like `api`, `v2`, `admin`,
`events`, `flags`, `sponsors`, `health`, …). Everything else becomes `:x`.

| Request                                   | `op`                                     |
| ----------------------------------------- | ---------------------------------------- |
| `GET /api/v2/events`                      | `GET /api/v2/events`                     |
| `PUT /api/v2/admin/events/abc123`         | `PUT /api/v2/admin/events/:x`            |
| `POST /api/v2/admin/events/xyz/verify-qr` | `POST /api/v2/admin/events/:x/verify-qr` |
| `GET /events/my-church-picnic-2026`       | `GET /events/:x` (slug masked)           |
| `GET /q/SECRET_QR_TOKEN`                  | `GET /q/:x` (token masked)               |

This bounds cardinality **and** enforces never-who in one mechanism.

## Sampling — none (no silent caps)

Every request emits exactly one line. There is **no sampling and no rate cap**.
If sampling is ever introduced, the sampling rate and any dropped-request
accounting MUST be documented here and logged — a silent cap would misrepresent
"we measured everything" when we did not.

## Honest limits

These are deliberate, documented gaps — not silent ones:

- **`wallMs` is wall-clock, a proxy for CPU-ms.** True CPU-milliseconds are not
  readable inside a request; they come from Cloudflare's own billing analytics.
  `wallMs` includes any awaited I/O, so it over-reports pure compute.
- **`.first()` rows are uncounted.** D1's `.first()` returns the row directly
  with no `.meta`, so its `rows_read` cannot be observed in-request. The query
  is still counted in `d1Queries`; only its row total is missing.
- **External `fetch()` subrequests are not counted.** `d1Queries` counts D1
  statement executions only. Outbound HTTP subrequests (e.g. BigQuery, geocode)
  are surfaced via Cloudflare analytics, not this line.

## The 100× watch-item (why this exists early)

The pooled cost audit flagged one runtime-cost surface that scales
super-linearly with adoption: **D1 read volume and BigQuery egress from the
SharedReport materialization / export path.** At 1× (pilot) it is negligible; at
100× (many churches, frequent report rebuilds) D1 rows-read and BigQuery egress
are the first costs that could threaten free-forever.

`OPERATION_COST` exists to make that visible _before_ it bites: rising
`d1RowsRead` on the SharedReport and admin-analytics `op` labels is the leading
indicator. This is tracked as **COST-503 / OSE-788** (100× SharedReport/BigQuery
scaling watch-item); the CI-side cost view is **COST-302 / OSE-781**.

## Related

- Implementation: `workers/oursharedevents/src/lib/cost-metric.ts`
- Never-who invariant: `tests/e2e/0-architecture/cost-metric-never-who.invariant.spec.ts`
- Boundary/regression unit tests: `workers/oursharedevents/tests/cost-metric.spec.ts`
- Contract test (this doc ↔ code): `tests/contract/cost-metric-contract.contract.test.js`
- Free-forever thesis: `docs/cost-sustainability/FREE-FOREVER-THESIS.md` (hub)
- Backlog: Cost Sustainability & Free-Forever Guardrails (OSE), M3 Observability
