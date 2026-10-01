# Scan Time-Bucketing — Threat Model & OSE-683 Reconciliation Memo

> **Status:** Pre-constitution design memo. Resolves the blockers a 3-loop CCR
> raised against the "configurable scan time-buckets" design before any invariant
> or code is written. This memo is the input to the Story-0 ADR; it is **not** the
> ratified invariant. Nothing here ships until it clears a full (5+ loop) CCR on
> the privacy surface with a human gate per loop.
>
> **Owner:** Matthew Zdano · **Consulted:** CCR (2 surface + 1 confirmation loop, SCRUM POVs)

---

## 0. Why this memo exists

The design goal (from design discussion): let a report viewer see scan activity
**over time at a chosen resolution**, with a **privacy floor**, so **low-turnout
free events can participate with high, inspectable trust**.

A CCR run (Loops 1–3, confidence 80 → 73 → 75, **below the 95% gate → human
gate**) found the design was _not_ ratifiable as sketched. Four load-bearing
blockers. This memo resolves the three disclosure-model blockers (1–3) and the
language blocker (4), and hands the remaining product decision (scope, blocker 5)
to the PO.

The key discovery: the codebase **already** has a ratified privacy rule —
**OSE-683 "K-anon Per-Bucket Consistency"** (`sumContributingBuckets`,
`shared-report-builder.ts`) — that the naive ladder design **contradicts**. This
memo reconciles them.

---

## 1. Threat model

### 1.1 Asset under protection

The ability to **attribute a scan to an individual** — to learn "person _X_ was
at event _E_, at poster _Y_, around time _Z_." Scans are already pseudonymous
(hashed `anonymous_id`, no PII, `user_agent_hash`; the coarse `country_code`
was removed by OSE-1460 on 2026-10-01). The residual risk is
**re-identification via quasi-identifiers**
(`time-bucket × H3/corridor × ua_hash × sponsor`) combined with
**auxiliary knowledge** (who was physically present).

### 1.2 Adversaries

| ID     | Adversary                                                              | Capability                                           | Trust                                                              |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| **A1** | Report reader (organizer / sponsor / anyone with a shared-report link) | Reads any exposed figure/breakdown                   | semi-trusted, curious                                              |
| **A2** | Longitudinal reader                                                    | A1 + polls the report over time (esp. live events)   | semi-trusted                                                       |
| **A3** | Insider / raw-DB access                                                | Queries raw scan rows directly                       | out of scope for the _report_ model; bounded by §4 (at-rest floor) |
| **A4** | External + auxiliary info                                              | Knows who attended; cross-references exposed figures | untrusted                                                          |

### 1.3 Attack surfaces (named by CCR)

- **S1 — Temporal cross-rung differencing.** Reader sees 1h _and_ 6h of the same series; 6h − Σ(shown 1h) recovers suppressed cells.
- **S2 — Cross-dimensional sub-K cells.** A day total ≥ K, but a `day × sponsor × corridor` cell < K is exposed → individual re-identifiable on the combination.
- **S3 — Cross-report longitudinal.** A reader watches an **open** bucket cross the K threshold (4→5) and learns the marginal scan occurred → correlates to a person arriving.
- **S4 — At-rest.** Raw rows finer than the exposed floor widen the A3 surface.

---

## 2. The OSE-683 reconciliation (Blocker 1)

**OSE-683 rule (ratified 2026-08-09):** when _summing fine buckets into an
aggregate_, each contributing bucket with `count < K (=5)` is **dropped before
summation** — never laundered into the total, never recoverable by differencing.

**The apparent conflict:** the ladder wanted to "coarsen up until a rung clears
K," i.e. _rescue_ a low-turnout event by rolling its sub-K fine buckets up. That
is the **opposite** of drop-before-sum. If we honor OSE-683 by summing pre-floored
fine buckets, a small event where every hour has < 5 scans shows **nothing at any
rung** — defeating the whole "low-turnout can participate" goal.

**Resolution — the two rules govern different operations:**

1. **Temporal ladder = direct-per-rung count.** Each rung's counts are computed
   **directly from raw scans grouped to that rung** (`COUNT(*) … GROUP BY <rung
bucket>`), _not_ by summing pre-floored finer buckets. A 6-hour window with 12
   scans reads **12** and clears K — the small event is rescued.
2. **OSE-683 still governs cross-entity aggregation** (portfolio rollups summing
   across events/corridors) — unchanged.
3. **Differencing (S1) is closed structurally by single-rung exposure** (§3), not
   by drop-before-sum. So we get both: rescue _and_ differencing-safety, via a
   different mechanism than OSE-683 — and the two no longer contradict because
   they apply to different operations (per-rung temporal count vs cross-bucket sum).

> **Constitution note:** the Story-0 ADR must state this explicitly — "direct
> count per temporal rung; OSE-683 drop-before-sum for cross-entity aggregation" —
> and the existing invariant tests that encode drop-before-sum must be scoped to
> aggregation, not to the temporal ladder.

---

## 3. Disclosure-control rules (Blockers 1–3)

### R1 — Single-rung-per-reader (closes S1)

A rendered report presents **exactly one temporal resolution** for a given series.
The reader never sees two rungs of the same series simultaneously. Switching
resolution **re-queries and replaces** the view.

### R2 — Offered rungs are bounded to the finest fully-K-safe rung (reinforces S1)

The system offers, as the finest selectable rung, **the finest resolution at which
_every_ exposed cell already clears K**. Finer rungs are **not offered** (not
"shown-with-suppression"). Because a sub-K finer view never exists, there is
nothing finer to switch to and difference against. Coarser rungs remain available
(strictly safer).

_Consequence, by design:_ a large event's finest rung may be 1h; a 30-person
ritual's may be 1 day or 1 week; a 3-person event's may be "insufficient sample."
The ladder **rescues** small events by letting them live at the coarse end where
counts accumulate — the intended behavior, now differencing-safe.

### R3 — K over the full exposed tuple (closes S2)

Every **exposed cell**, at any rung _and_ any dimensional breakdown, must have
`count ≥ K` over its **full** `(rung × all-exposed-dimensions)` tuple — not K on
time alone. The count floor is applied to **each** dimensional cross-section the
report renders (corridor, sponsor, …; country is no longer recorded, OSE-1460). A breakdown is only offered where
every such cell clears K; otherwise it coarsens or is withheld.

> **Verify in code:** confirm the sponsor path (`shared-report-builder.ts:~394`,
> `GROUP BY si.sponsor_id …`) applies the same `CORRIDOR_MAP_MIN_COUNT` floor as
> the corridor path. If not, that is a **live gap**, independent of this feature.

### R4 — Finalized-only exposure (closes S3)

A bucket is eligible for exposure only once it **can no longer change** (its time
window has closed) **and** it clears K. **No live / near-real-time counts for the
current open bucket.** The SharedReport is a **proof artifact (post-hoc)**, not a
live dashboard — so this costs nothing real. (A future live view, if ever wanted,
needs separate coarser + noised treatment and is explicitly out of scope.)

---

## 4. At-rest floor (S4)

- **60-minute floor, ratified:** no scan analytic is **stored** finer than the
  hourly `scan_bucket`. This is the _current_ behavior (`scanBucket → …:00`) — the
  invariant **codifies existing safe behavior**, it does not lower the floor.
- **One reconciliation:** the scan rows also write `created_at = datetime('now')`
  (full precision), which contradicts the file's own _"no exact timestamp"_ note.
  **Decision for the ADR:** audit whether any analytic/report path reads
  `created_at`; if not, coarsen it to the hourly floor or restrict it so it is
  never exposed — remove the only finer-than-floor field from the A3 surface.

---

## 5. Honest trust claim (Blocker 4)

**Do not ship** "practically mathematically impossible to identify." K=5
k-anonymity is defeatable with auxiliary information; the words overclaim and would
themselves breach the honesty lexicon (`docs/architecture/HONESTY-LEXICON.md`).

**Ratified claim (honest, inspectable, still strong):**

> _"When a number is shown, you are one of at least 5 people who are
> indistinguishable within it. The system stores no identity, and never shows
> anything finer than one hour or below that group of 5 — and when there aren't 5,
> it shows nothing at all."_

This is verifiable against the published invariants (K, floor, single-rung,
finalized-only) — trust you can **check**, not trust you're **asked for**. That
inspectability is the covenant/moat logic, applied to privacy.

---

## 6. What flows to the constitution (Story 0) and the pyramid

### 6.1 Candidate invariants (for the Brain ADR — TB-*)

- **TB-1 Floor:** no scan analytic stored or exposed finer than the 60-min base.
- **TB-2 Ladder:** offered resolutions are exact integer multiples of the base `{60,360,1440,10080} min`; each rung is a **direct count**, never a sum of pre-floored finer buckets.
- **TB-3 Single-rung:** one temporal resolution per rendered series (R1); finest offered = finest fully-K-safe rung (R2).
- **TB-4 K over full tuple:** every exposed cell ≥ K over `(rung × all exposed dimensions)` (R3).
- **TB-5 Finalized-only:** only closed, K-clearing buckets are exposed (R4).
- **TB-6 Store-precise / present-coarse (scope boundary):** storage granularity ≥ finest _presentable_; **scans → 60-min floor** (privacy); **events → full UTC datetime** (scheduling; no privacy floor — sibling item, see §7).

### 6.2 Adversarial pyramid obligations (born-red)

Correctness tests are insufficient; the disclosure surface must be tested as an
**attack matrix**:

| Surface                | Test rung      | Assertion                                                                                   |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| S1 temporal cross-rung | L2/L3          | no two rungs of one series co-rendered; no sub-K rung offered                               |
| S2 cross-dimensional   | L0/L2          | every exposed cell ≥ K on the full tuple; sponsor path floored                              |
| S3 longitudinal        | L3 adversarial | open buckets never exposed; small-N event, poll over time → no marginal-scan leak           |
| S4 at-rest             | L0 structural  | no store/emit finer than 60-min; `created_at` not exposed                                   |
| small-N covenant       | L3             | seed a handful of scans → _nothing_ re-identifiable at any offered rung; honest suppression |

---

## 7. Sibling item — Events → full UTC datetime

Separate from scans, same "store-precise/present-coarse" philosophy but **no
privacy floor** (event times are scheduling metadata, not PII). The events endpoint
currently validates `start_date/end_date` as date-only `YYYY-MM-DD` (`isValidIsoDate`),
which is **lossy**: `phase-cache.ts` uses them as phase boundaries, so a 7pm event
flips phase at 00:00 UTC. Recommend: widen validation to accept ISO-8601 UTC
datetimes, store as-is (`TEXT` column already allows), UI keeps rendering the date
(`formatHumanDate`). Tracked separately from the scan-bucketing constitution.

---

## 8. Open decisions for the human gate (do not assume)

1. **Scope vs First Scan (PO).** North Star is _one real scan_ (M0/M1). Is
   adaptive bucketing an M-milestone now, or deferred until post-first-scan? **This
   memo does not assume it is in scope.**
2. **K value.** K=5 is current (`CORRIDOR_MAP_MIN_COUNT`). Is 5 the right floor for
   the published trust claim, or higher for the low-turnout promise?
3. **`created_at` at-rest handling** (§4).
4. **Single-rung UX acceptance** — no simultaneous multi-resolution zoom; confirm
   that trade is acceptable.

---

## 9. CCR status

| Loop | Confidence | Verdict                                      |
| ---- | ---------- | -------------------------------------------- |
| 1    | 80%        | OSE-683 conflict + scope surfaced            |
| 2    | 73% ↓      | S2/S3 disclosure surface + K=5 overclaim     |
| 3    | 75% ≈      | stable below gate; blockers named, tractable |

**Design was not ratifiable as sketched.** This memo resolves blockers 1–4
(reconciliation §2, disclosure rules §3, at-rest §4, language §5) and routes
blocker 5 (scope) to the PO. **Next gate:** with §8 decisions closed, run the full
5+-loop CCR (human gate per loop) on the §6.1 invariants before authoring Story 0.
