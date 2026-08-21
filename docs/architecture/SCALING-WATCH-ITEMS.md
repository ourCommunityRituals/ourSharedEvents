# Scaling Watch-Items — SharedReport D1 Fan-Out & BigQuery Egress

> **Status: TRACKED, NON-ACTIONED.** This is a risk register, not a task list.
> Each watch-item below is a runtime-cost surface the pooled cost audit flagged
> as scaling super-linearly with adoption. At pilot (1×) scale each is
> negligible; the point of recording them is so the cost does not get
> _rediscovered cold_ at 100× — it is already named, already instrumented, and
> the mitigation is already sketched. **Do not "fix" these preemptively.** Act
> only when the leading indicator (below) crosses its trigger.
>
> Tracking ticket: **COST-503 / OSE-788** (M5 Documentation, Cost Sustainability
> & Free-Forever Guardrails). Made observable by **COST-301** (runtime
> `OPERATION_COST` metric) and **COST-302** (CI cost history).

---

## Why a watch-item (and not a fix)

Free-forever is structurally sustainable **only while runtime stays LLM-free**
(the load-bearing property — see `docs/cost-sustainability/FREE-FOREVER-THESIS.md`
in the hub). Runtime LLM cost is zero. The _next_ costs that could threaten
free-forever are not tokens — they are **D1 rows-read** and **BigQuery egress**
from the SharedReport materialization/export path. Those are cheap today and
would stay cheap under linear growth; the risk is the handful of places where
work grows _faster_ than 1:1 with adoption.

Fixing them now would be premature optimization against a load we do not yet
carry, and would add complexity (batched IN-clauses, pagination) to code that is
correct and legible. The disciplined move is to **instrument, threshold, and
wait** — which is exactly what M3 Observability put in place.

---

## WI-1 — SharedReport D1 read fan-out

**Surface.** `buildSharedReport()` assembles one report from ~6 sequential D1
aggregations plus per-section lookups:
`workers/oursharedevents/src/lib/shared-report-builder.ts` (`buildSharedReport`,
roughly lines 199–738). Each individual query is bounded and indexed; the
concern is **multiplicity**, not any single statement.

**The one super-linear path.** The `headcount_trend` computation for a
_confirmed recurring series_ issues **one D1 read per series instance**, in a
sequential loop:

- `shared-report-builder.ts:659` — `for (const r of inst.results ?? [])`
- `shared-report-builder.ts:663` — `SELECT distinct_agent_hashes ... FROM scan_aggregates WHERE event_id = ?`, executed once per instance.

Instance count grows with the **calendar length** of the series, not with
attendee volume: a weekly event running for two years is ~104 instances → ~104
sequential D1 reads inside a single `buildSharedReport()` call. This is unbounded
in time and independent of the K-anonymity floor that protects the _output_.

**The multiplier.** The batch read endpoint caps at **50 report IDs per
request** (`workers/oursharedevents/src/handlers/shared-report-read.ts:40`,
`BATCH_MAX_IDS = 50`; enforced at `:212`), each ID triggering its own
`buildSharedReport()`. Worst case for one batch request is therefore
`50 × N` per-instance reads, where `N` is the longest series in the batch. At
today's series lengths (10–20 instances) that is ~500–1,000 reads; a mature
deployment with multi-year recurring series pushes the same request into the
low thousands of D1 reads.

**Honest bounds.**

- Non-series and short-series reports are flat — the loop only runs for
  confirmed series (`event_series` in the confirmed state), otherwise
  `headcount_trend` is suppressed. Most reports never enter the loop.
- `.first()`-style single-row reads inside the builder are counted as _queries_
  but their `rows_read` is not observable in-request (see the cost-metric
  contract's honest-limits section). The fan-out is visible via `d1Queries`
  even where `d1RowsRead` under-reports.

**Leading indicator (watch this).** Rising `d1Queries` / `d1RowsRead` on the
`OPERATION_COST` line for the SharedReport `op` labels (single-read and batch),
especially a widening gap between median and p99 as long-lived series
accumulate. Instrumentation: `workers/oursharedevents/src/lib/cost-metric.ts`,
contract `docs/monitoring/COST-METRIC-CONTRACT.md`.

**Suggested trigger.** Revisit when p99 SharedReport `d1Queries` sustains above
~1,000 per request, or when a single batch request's D1 reads approach the D1
per-invocation practical ceiling. (Thresholds are advisory placeholders — set
real ones from baseline once production traffic exists; do not gold-plate before
then.)

**Mitigation when triggered (do not apply now).** Collapse the per-instance
loop into a single set query — `SELECT event_id, distinct_agent_hashes FROM
scan_aggregates WHERE event_id IN (...)` over all instance IDs — then bucket in
memory. This turns `N` sequential reads into 1. The batch endpoint's 50-ID cap
already bounds the outer multiplier; no change needed there.

---

## WI-2 — BigQuery egress from SharedReport export

**Surface.** The nightly export streams materialized aggregates to BigQuery via a
Workers-native Storage Write client (fetch + WebCrypto, no SDK):

- `workers/oursharedevents/src/cloud/bigquery.ts` — `bigQueryInsertRows` /
  `bigQueryInsertRowsToDataset`, `MAX_ROWS_PER_BATCH = 500`
  (`bigquery.ts:26`).
- `workers/oursharedevents/src/lib/shared-report-export.ts` — the three
  exporters (`exportAnonIdReturns`, `exportCorridorDensityBaseline`,
  `exportEventSeries`).
- `workers/oursharedevents/src/handlers/shared-report-export.ts` — orchestrates
  the export post-materialization.
- Per-row regulatory pool routing to `general` / `hipaa` / `coppa` datasets:
  `workers/oursharedevents/src/lib/pool-contract.ts`.

**What scales super-linearly.** `anon_id_returns` emits roughly one row per
`(distinct anon_hash, event)` per tick. That product grows with **attendees ×
events**, so egress volume rises faster than either dimension alone as adoption
compounds. `corridor_density_baseline` is windowed (per corridor × dow × hour)
and effectively flat; `event_series` grows only with the number of confirmed
series. The egress is already batched at 500 rows/request, so the risk is
_total volume and subrequest count_, not batch inefficiency.

**Honest bounds.**

- BigQuery **write/streaming** is cheap (streaming ingestion, not query scan);
  the free-forever risk here is subrequest count and egress bandwidth, and
  downstream _query_ cost on whatever reads these datasets — not the write.
- Outbound BigQuery `fetch()` subrequests are **not** counted by
  `OPERATION_COST` (`d1Queries` counts D1 statements only — see the contract's
  honest-limits). Egress must be watched via **Cloudflare analytics** (outbound
  subrequests) and **BigQuery's own billing/storage metrics**, not the runtime
  cost line.

**Leading indicator (watch this).** Outbound subrequest count on the export
path (Cloudflare analytics) and BigQuery streamed-bytes / stored-bytes per tick.
The CI-side wall-clock view of export jobs is in
`docs/monitoring/ci-cost-history.jsonl` (COST-302).

**Suggested trigger.** Revisit when nightly streamed rows or bytes trend toward
a fixed fraction of the BigQuery free tier, or when export wall-clock starts
crowding the scheduled window. (Advisory — baseline first.)

**Mitigation when triggered (do not apply now).** Options, cheapest first:
partition/prune `anon_id_returns` emission to changed rows only (delta export
rather than full re-stream); raise the K-anon floor for export to shed
low-signal singleton rows; move cold datasets to longer BigQuery
partition-expiry to cap storage. None of these is warranted until the indicator
moves.

---

## The cost dashboard (where these are observed)

"Linked to the cost dashboard" for these watch-items means the two M3
observability surfaces:

| Surface                  | What it shows                                                                                                              | Source                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Runtime `OPERATION_COST` | Per-request `d1Queries`, `d1RowsRead`, `wallMs`, `status` by aggregate `op` label (never-who) — the WI-1 leading indicator | `workers/oursharedevents/src/lib/cost-metric.ts` · contract `docs/monitoring/COST-METRIC-CONTRACT.md` |
| CI cost history          | Per-job CI wall-clock time-series, incl. export/materialization jobs                                                       | `docs/monitoring/ci-cost-history.jsonl` · collector `scripts/ci-cost-collector.mjs` (COST-302)        |
| Cloudflare analytics     | Outbound subrequests + egress bandwidth — the WI-2 leading indicator (not in `OPERATION_COST` by design)                   | Cloudflare dashboard                                                                                  |

Both `OPERATION_COST` and the CI collector are **aggregate-only and never-who**
by contract — they surface _how much_ without surfacing _whose_.

---

## Related

- Runtime cost metric contract: `docs/monitoring/COST-METRIC-CONTRACT.md`
  (§ "The 100× watch-item" forward-references this doc)
- SharedReport ↔ consumer boundary: `docs/adr/ADR-011-shared-report-wkrp-consumer-boundary.md`
- Free-forever thesis (hub): `docs/cost-sustainability/FREE-FOREVER-THESIS.md`
- Evidence pack (hub): `docs/cost-sustainability/EVIDENCE-PACK.md` (Phase-1 unit-cost row that seeded this)
- Master ADR (OCR-docs): ADR-006 — Cost Sustainability & Free-Forever Guardrails
- Backlog: Cost Sustainability & Free-Forever Guardrails (OSE), M5 Documentation — COST-503 / OSE-788
