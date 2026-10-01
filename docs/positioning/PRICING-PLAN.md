# OSE Sponsor & Event-Manager Pricing Plan (authoritative)

> **Single authoritative pricing plan.** This document folds the two former
> root drafts — a 6-month-free plan and its 3-month-free reconciliation
> (2026-08-14) — into one current record. The 3-month reconciliation supersedes
> the 6-month draft; both former root files are retired and their content lives
> here. Story: **COST-112** (OSE-774).
>
> **Scope:** this is the go-to-market **pricing & free-to-paid business plan**
> (dollar strategy, term structure, conversion playbook). The _mechanism_ — how
> weight classes, the governor, and screen-time allocation actually work — is
> owned by [`../features/SPONSOR-PRICING.md`](../features/SPONSOR-PRICING.md).
> Dollar figures here are illustrative per that doc; the canonical allocation
> **weights are 7×/3×/1×** (see the drift resolution immediately below).
> Willingness-to-pay anchor: [`COMPETITIVE-BRIEF-2026-05-14.md`](COMPETITIVE-BRIEF-2026-05-14.md).

## Allocation-weight drift resolution (COST-111)

Recorded here because an earlier copy of the pricing docs disagreed with the
code on the sponsor allocation weights, and this is the durable record of how it
was resolved:

- **The conflict:** `SPONSOR-PRICING.md` (an earlier revision, lines 32–40)
  stated the weights as premium **3×** / mid **2×** / local **1×**, while the
  org-brain canonical `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml`
  (`weights:`, schema 1.1, ratified 2026-08-07) sets **premium 7× / mid 3× /
  local 1×**.
- **Which copy is canonical, and why:** the **brain YAML wins.** It is the
  single source of truth for allocation weights; the OSE substrate mirror
  (`workers/oursharedevents/src/lib/sponsor-allocation.ts`) is a byte-for-byte
  consumer of it per ADR-012, not an independent authority. The doc was drifted;
  the code and the YAML already agreed on 7×/3×/1×.
- **The gate that now enforces it:** the **OSE-336** byte-equivalence drift
  check (`sponsor-allocation.ts:104-107`) fails CI on any mismatch between the
  brain canonical and the substrate mirror. If the two ever disagree again, the
  build goes red and the YAML is the tie-breaker.
- **Resolution:** `SPONSOR-PRICING.md` was corrected to the canonical 7×/3×/1×
  in **PR #329** (COST-111 / OSE-773, merged 2026-08-16). All figures in this
  plan use 7×/3×/1×.

## Reconciliation note (3-month vs 6-month)

The 3-month reconciliation that this document carries forward verified three
adversarial critiques against live code — **all correct**; each materially
changed the earlier 6-month draft. The draft's headline — no phase-4 gate on the
map, so the phase-4-race is mis-scoped — survives. But the draft then
**mis-modeled the accrual gate that replaces it** (Critic 1), **mis-calibrated
churn and grandfather for compression** (Critic 2), and **stated one false claim
about what the invariant permits** (Critic 3). All three fixes push the same
direction: **3 months is honest on the sponsor side and too short on rendered
value for the median manager; every in-window dollar is manual.**

_Provenance: 6-month draft produced by the grounded 2-brainstorm + 2-solution
fleet (wf_65f9df48-4f5, 19 agents); 3-month reconciliation by the focused
3-month fleet (wf_dbdce895-e40, 14 agents), seeded with the grounded plan._

_2026-09-03 (OSE-1198, Matt): Local sponsor price split three ways — community use $0 forever · established business flat fee · first-year business first placement free. Recorded in §A; 3-month-clock position in §B; schema follow-up OSE-1207; front-door copy hand-off on OCR-116._

---

## (A) PRICING TABLE — confirmed, no change forced by 3 months

The term-length change compresses _when the flip fires_, not _what is sold_. Table carries as settled:

| Tier                                                                                                | Event Managers                                                                                                    | Sponsors (frequency SKU only; weights **1x/3x/7x**, `sponsor-allocation.ts:90`)                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local · community use** (block party host, neighbor, community group, league, charity, faith org) | $0 forever [ATT — 30% floor + locals-first, `sponsor-allocation.ts:249`]; hosting stays free at every Local class | **$0 forever** [DECIDED 2026-09-03, OSE-1198]. Keyed on `sponsor_business.business_type` in the non-commercial set (community_org, charity, nonprofit, league_org, sports_club; faith_org already free by `tier-gates.yaml`). The class attaches to the **placement / activity**, not the letterhead: a church's own potluck is community; a church's for-profit night is a business placement. |
| **Local · established business** (the barber, the tavern)                                           | —                                                                                                                 | **Small flat fee** [HYP: $10–25/mo flat, validated with the first five local businesses before written as fact]. Keyed on a commercial `business_type` (bar, brewery, retail, restaurant, professional_services, photographer, corporate). Same 1× weight, same 30% floor, never outbid for position.                                                                                           |
| **Local · first-year business** (license issued within the last 12 months at activation)            | —                                                                                                                 | **First placement free, then the flat fee** [DECIDED 2026-09-03]. Unit of "first placement" [REC]: one event template + one area for one cycle (one month), matching two-sided acceptance. Eligibility: self-attested `license_issued_month` (OSE-1207), visible to the host at acceptance; no license number stored.                                                                           |
| **Mid**                                                                                             | $49/mo target [HYP], value = `corridor_map` **live** + `return_rate`                                              | $25–75/event headline **or** $99/mo wrapper [HYP], under the one attested WTP point ($200/mo, COMPETITIVE-BRIEF:88)                                                                                                                                                                                                                                                                             |
| **Premium**                                                                                         | NOT priced until phase5 (visible-not-given)                                                                       | $149–199/mo [HYP] ≈ 1.5–2x Mid, frequency SKU (7x vs 3x = 2.33x reach), 40% cap, never outranks a local                                                                                                                                                                                                                                                                                         |

Constraints holding the table (verified this loop): `SPONSOR_MAX='mid'` (report-depth.ts:118) — sponsors never buy Premium depth. Revenue = event managers + **non-local** sponsors + **local business** sponsors (community-use Local stays $0 forever by decision, not by leakage — see OSE-1198).

**Doc corrections owed (independent of 3 months, now CI-load-bearing — Critic 3):**

- `SPONSOR-PRICING.md:32-40` mis-states weights as 3x/2x/1x; canonical is **1x/3x/7x**. **Fix the brain canonical (`ocr-docs-brain/sponsor-allocation.yaml`) FIRST, then the src mirror, in one PR** — the OSE-336 byte-equivalence drift check (`sponsor-allocation.ts:104-107`) fails CI on any mismatch. Do not edit the rationale strings' trailing `\n`.
- `tier-gates.yaml:147-199` asserts `map_visualization = phase4` — **documentation drift**. **Correct the doc to match code (map renders Phase 3); DO NOT add runtime enforcement** — wiring the gate would turn Mid revenue OFF and break the plan (Critic 3). Flag explicitly so a later reader doesn't "fix" the drift by adding the gate.

---

## (B) VERDICT ON 3-MONTH FREE MODEL

**ADOPT the ASYMMETRIC model, with the two sides on DIFFERENT clocks AND different durations.** The draft's asymmetry was right; the shared 90-day duration was not.

**Phase4-race mitigation (confirmed correct, keep):** There is no phase gate in the `corridor_map` build path (`shared-report-builder.ts:588-614` builds live + fallback unconditionally). `map_visualization=phase4` is inert doc drift. The phase4 cliff the prior fleet feared does not gate Mid revenue. **But** the replacement risk — per-organizer scan accrual — is _harder_ than the draft modeled, not easier (Critic 1).

### Sponsors — hard flat 3-month flip from their own activation. YES, and it is honest.

Sponsor paid value = frequency rotation (1x/3x/7x), which renders in Phase 3 **today** and needs no accrual. A sponsor's 7x-vs-3x weight is live from their first funded event. Gates would be dead weight. Flip fires per-sponsor at `activation + 90d` (own anniversary, never a corridor cohort). This is the founder's clean "3 months then pay" on the only side where it is honest.

### Local business sponsors — NOT on the 3-month clock [REC — awaiting founder ratification]

The 3-month flip above is a Mid/Premier mechanism. Local business sponsors pay the flat fee from day one (it is already the cheap tier; a trial on top of cheap is dead weight), and the **first-year credit is the only free window a Local business ever holds** — so the two rules never stack. Community-use Local never enters the clock at all. If ratified, the flip logic keys on `sponsor_class ∈ {mid, premier}` only.

**Deferred on purpose (OSE-1198 year-one scope):** discount grammar (kind · amount · cadence · window · stacking · scope), coupons, rebates. They attach to the same pricing-plan object later; nothing in year one is built as a special case. Computing a rebate at runtime is where billing stops being inert (invariant #6) and needs an ADR.

### Event-managers — the manager clock must START at first LIVE-map render, not signup (Critic 1 & 2 converge here).

The draft proposed "90-day floor + Gate A′ ∧ Gate B." **Two corrections make this the single biggest change from the draft:**

1. **Gate A′ is re-scoped: drop `corridor_density` ratio from the in-window value entirely.** The ratio's `window_30d_count >= 10` is **distinct returning attendees over a 30-DAY ROLLING window** (`shared-report.ts:244-249,231`), NOT 10 event firings. It saturates at ~4 weekly instances' worth of distinct anons and is _perversely hardest for high-retention corridors_ — if the same loyal people return each week, `COUNT(DISTINCT hash)` stops climbing. The draft's "day 70 ratio publishes" is arithmetically wrong. **Gate A′ fires only on: `corridor_map.source === 'live'` (a poster cell in `scan_cell_aggregates` with at least one hour of ≥5 scans — OSE-1459 + the OSE-683 drop-before-sum floor) AND `return_rate` un-suppressed (min-sample 3). The density ratio is a month-4+ upsell, never an in-window billed section.**

2. **Redefine when "3 months" begins (Critic 1 Fix 2b, adopted).** The manager clock does not start at first report pull (that shows the _fallback_ map). It starts at the **first `source:'live'` report pull for that organizer.** This structurally guarantees you never invoice a fallback map and makes the founder's "3 months" honest by anchoring it to first rendered value. Below that: **auto-extend free** with an honest banner ("Corridor map is in preview — it runs live once your events accumulate scans"). Reads only already-computed `corridorMap.source` (builder:576) — invariant-clean, no new flag.

**So: managers = 3 months _from first live-map render_, gated on `source:'live'` + `return_rate`, plus Gate B (≥1 ring rotation: ≥1 event, poster/QR, scans, ≥2 report pulls).** This is superior to a flat manager floor because the median community organizer is monthly/bi-weekly cadence — a signup-anchored 90-day flip only ever fires for hand-picked weekly comp anchors, which is a sample-of-one, not a conversion signal.

**Premium caveat carried:** Premium depth (BigQuery/OER cross-corridor + Vertex predictive = phase5) has no ETA and unprovisioned infra. Priced visible-not-given. **Do not promise Premium inside 3 months.**

---

## (C) 3-MONTH SATURATION / RING-ACTIVATION PLAN

The window closes **ONE ring in ONE corridor.** Compression forces engineered ignition. The binding constant is **live-map render + `return_rate` (min-sample 3)** — NOT the density ratio (unreachable in-window per Critic 1) and NOT phase4.

### Governing thresholds (verified)

| Constant                          | Value              | Gates                                                                                                              | In-window?               |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `CORRIDOR_MAP_MIN_COUNT` (K-anon) | **5**              | a map cell is a poster's res9; it renders only from hours with ≥5 scans there (sub-K hours dropped before the sum) | YES (per event)          |
| `RETURN_RATE_MIN_SAMPLE`          | **3**              | return_rate publishes at ≥3 distinct anons across ≥2 instances                                                     | YES (~2-3 events)        |
| `CORRIDOR_BASELINE_MIN_SAMPLE`    | **10**             | density **ratio** — 10 distinct return-anons in a **30-day rolling** bucket                                        | **NO — month-4+ upsell** |
| fallback map                      | res7 cell + ring-1 | renders on the **first single event**                                                                              | Day 1                    |

### First-corridor choice criteria (select by CADENCE, not geography)

1. **Event cadence ≥ weekly in a single (dow, hour) slot** — maximizes distinct-attendee accrual toward `source:'live'` + `return_rate`, keeps the rolling 30-day bucket occupied. It does NOT "clear 10 events."
2. **≥5 people scanning one poster within one hour** (scans are deduplicated per person per poster per hour, OSE-1459) — the live map counts scans per poster cell per hour and drops any hour under K=5 before summing (`CORRIDOR_MAP_MIN_COUNT`, OSE-683). Thinly spread scans never light a cell; posters at the door during the event do.
3. **NEW-attendee turnover, not just loyal returners** — the corridor needs a stream of _distinct_ anons to ever cross return_rate's min-sample cleanly.
4. **A confirmable recurring `event_series`** so headcount_trend teaser can light (Premium visible-not-given demo).
5. **Defensibly geo-derivable `is_local`** at the promotion seam (`draft.h3_res7 === ev.h3_res7`, sponsor-promotion.ts:166-168) — pick a corridor where locality is NOT contested (OSE-662 hazard).

_Auto-disqualify:_ monthly cadence, scattered dow/hour, no poster reaching 5 scans in an hour, all-loyal-zero-turnover, no series, contested locality.

### Comp-anchor footprint (all in ONE corridor)

- **3 comp event-manager anchors** (density≥3 spine; comp = `free_tier`/`comp` boolean, never touches `allocateShares()`).
- **1 weekly slot** among them (the live-map factory).
- **2–3 comp sponsors** seeded so `sponsor_impressions` render and the frequency SKU demonstrably works — **these are the ones you can honestly bill at day 90.**
- **Poster/QR subsidy** so participant cost-to-close ≈ $0.
- **Hard provenance requirement:** set a server-side `comp`/seeded flag on these records **before** the window, or synthetic density contaminates the WTP read.

### Timeline (weekly anchor, best case — CORRECTED per Critic 1)

Day 1 fallback map + logo counts visible → ~day 14-21 first `source:'live'` render (once scan-aggregation cron runs over an event where a poster drew ≥5 scans in one hour; **note the baseline/aggregate refresh is nightly cron, `shared-report-materialize.ts:81-89`, not read-time — accrual is cron-cadence-bound**) → ~day 21-30 `return_rate` clears min-sample 3 → **manager clock STARTS here (first live pull), not at signup** → day 90 (sponsor side, own anniversary): 2–3 comp sponsors convert to paid frequency SKU via Payment Link. **Revenue inside the founder's 90 days = the sponsors only, collected manually. The ~1 manager conversion the draft booked lands ~90 days AFTER first live render (≈ calendar day 110-120), i.e. outside the founder's window.**

### Failure tripwires (each code-grounded)

1. No poster reaches 5 scans in any hour → every poster cell is dropped and `corridor_map.source` is `'suppressed'` ("Map hidden to keep things anonymous") — **fatal, abort the corridor.**
2. All-loyal audience, no distinct-anon turnover → `return_rate` never clears min-sample 3 → no differentiated Mid value renders.
3. Scan-aggregation cron hasn't run / no `scan_cell_aggregates` rows (scans at poster cells, OSE-1459) → map stuck `source:'fallback'` → auto-extend, clock never starts.
4. Live map + return_rate render, still no manager conversion after their 90d = **the real, honest WTP failure** — the map isn't worth $49.
5. Comp sponsors don't convert at day 90 despite frequency rendering → the $99/mo wrapper is mispriced (independent of any gate).

---

## (D) PER-TIER FREE→PAID TRANSITION PLAYBOOK

Two verified code facts re-ground this section:

- **The monetization-inert invariant forbids only 5 charge-EXECUTION call-sites** (`stripe.charge/createPaymentIntent/confirmPayment`, `charge_customer(`, `createInvoice(`, `processPayment(`, `.debit(`) via `expect.soft` over all src `.ts`, plus a hard `X-Monetization-Inert: true` header (monetization-inert.invariant.spec.ts:55-70,105-126). **BUT Critic 3 is correct and the draft was WRONG:** Invariant #25 (`sponsor-eligibility.ts:9-12` + covenant shape-lock `sponsor-share-covenant.invariant.spec.ts:84-93`) forbids **any tier/price/weight/time-since-activation dimension from reaching `allocateShares()`.** You may NOT thread `anniversary`, `dunning_stage`, `days_since_activation`, or `subscription_started_at` onto the promoted-sponsor record or `ShareAllocation`.
- `is_local` is geo-derived at the promotion seam (sponsor-promotion.ts:166-168) but **defaults `false` at rest** (sponsor-allocation.ts:95) and is admin-set until OSE-661/663 → no price attribute may key on it (OSE-662).

### The billing-clock QUARANTINE (mandatory build rule — Critic 3 Fix 1)

Ship the 3-month clock, dunning ladder, and anniversary meter as real tested `src/` code NOW — **only** as a standalone `billing-clock.ts` that (a) is pure/zero-I/O like `sponsor-eligibility.ts`, (b) emits **one boolean** into the existing 4-source ladder (`subscription`/`store_credit`), and (c) **never** adds a field to `ShareAllocation`, the promoted-sponsor row, or anything `allocateShares()` reads. Dunning stage + anniversary date live in a **billing-side table keyed by `founding_cell_id + founding_ts`**, resolving to `subscription: boolean` at the seam. **Born-red contract test:** "no field matching `/anniversary|dunning|days_since|price|amount|_at\b/` appears in the `ShareAllocation` interface or the promoted-sponsor row." Without this quarantine the (D) build lands red on the next `:91` denylist extension.

### TIER 1 — SPONSORS (frequency renders now → hard 90-day flip is honest)

- **T0 = activation** (first promoted placement clears the 402). Clock starts here, per-sponsor, never cohort.
- **Probe-1 @ first SharedReport pull showing their placement:** inline "your rotation reached N scans" + soft "lock 7x frequency" CTA → **Payment Link URL** (never a `src/` charge call). Take-rate here is the honest list-price WTP read.
- **Probe-2 @ ~day 60:** present the 7x-vs-3x math (2.33x reach) with observed scan delta.
- **Flip @ own day-90 anniversary:** hard ask; value rendered twice. **Manual: admin flips `free_tier`→off / sets `comp`, collection out-of-band.**
- **Grandfather — LEANER than the draft (Critic 2 Fix 2):** the draft's 60/40/20/0-from-first-invoice is _more generous under compression_ (short free period → whole cohort synchronizes onto the richest rung). **Use 50/25/0 (3-year), metered from `min(first_invoice, signup + 120d)`** — prevents a sponsor sitting free indefinitely then starting a fresh clock. Keyed `founding_cell_id + founding_ts` (NEVER `is_local`). Cap year-1 credit at the Mid dollar; **model finance on the capped, SYNCHRONIZED base** (materially larger than the draft's staggered assumption).
- **Anti-churn — FIX THE FREE-RIDE (Critic 2 Fix 1):** the draft's "lapse = downgrade to base 1x, keep ≥2% `min_presence`, never evicted" is a churn **accelerant**, not a retention feature. Because `allocateShares` water-fills (`sponsor-allocation.ts:262-281`), a lapsed sponsor's vacated share **redistributes to survivors** — a rational, correlated incentive to also lapse and free-ride at 2%. **Make the 2% floor paid-or-comp-gated after one grace cycle:** on soft-lapse a sponsor falls to base for one anniversary cycle, then `min_presence` applies only if `free_tier|comp` is true; a pure non-paying lapsed sponsor decays out of _guaranteed_ presence (still eligible to re-enter). **Model small-sponsor churn at 55–70% CORRELATED, not 40–60% independent** — lapses are coupled through the shared pool. If the $99/mo wrapper doesn't survive 65% correlated flip churn, it is mispriced.

### TIER 2 — EVENT MANAGERS (Mid = live map + return_rate; clock starts at first live render)

- **Term = 3 months FROM FIRST `source:'live'` PULL**, gated `source:'live'` ∧ `return_rate` un-suppressed ∧ Gate B. Below that → **auto-extend free** (never invoice an empty/fallback map).
- **Probe-1 @ first report pull (fallback map):** CTA "$19 single-event **live-map unlock**" — the settled honest WTP instrument, a **Payment-Link URL**, priced explicitly as a *sample/founding SKU*, **never "the map subscription."** **Critic 3 Fix 3a:** the `$19` instrument must read a **different signal** (an explicit user click-to-unlock event) than the flip gate reads (`corridorMap.source`) — otherwise the take-rate measures the gate, not willingness (endogenous WTP).
- **Probe-2 @ Gate A′ satisfied (live map renders):** first honest recurring $49/mo Mid ask.
- **Grandfather:** same 50/25/0 metered from `min(first_invoice, signup+120d)`, keyed `founding_cell_id + founding_ts`.
- **Anti-churn small locals — RESTORE THE RAMP (Critic 2 Fix 3):** the draft's hard $25–75/event ask at day 90 lands *before* differentiated value for the most price-sensitive, covenant-protected cohort. **Small locals get the SAME depth-gate protection managers get** (no hard ask before their own `source:'live'`), **PLUS a graduated first step: one de-risked $19 unlock first, then $25–75/event or wrapper only after one successful $19 event.** Model **40–60% flip churn on the $19 step**, and derive $25–75 conversion _conditional on surviving $19_.
- **Compressed dunning (both tiers, via quarantined billing-clock):** reminder day-75 → offer day-85 → soft-lapse day-95 → `subscription:false` → `free_tier` (fallback map stays, differentiated depth locks). Ships with a born-red `local_floor_pct ≥ 30` covenant test.

---

## (E) SPONSOR-PAYMENT COURSE OF ACTION (invariant + Stripe/402 + CI-CD)

Carried as settled, sharpened by the compression and Critic 3:

- One 402 seam at `promoteSponsorDraft` (live, sponsor-promotion.ts:154-164); eligibility **boolean-only** (`free_tier → comp → subscription → store_credit`, `sponsor-eligibility.ts:44-49,62-65`); price never reaches `allocateShares()`; collection **out-of-band** via Stripe Payment Links + Wave.
- **EVERY in-window conversion is MANUAL (Critic 3 Fix 2, hard rule not footnote):** `subscription`/`store_credit` are typed `false` stubs pending **OSE-745** (`sponsor-eligibility.ts:34-37`). There is **no invariant-legal self-serve flip path.** The $19 unlock and every day-90 sponsor conversion = admin sets `free_tier`/`comp`, money via Payment Link + Wave, **zero `src/` charge code.** Any `createInvoice(`/`createPaymentIntent` in src flips the build red. **Do not model any self-serve conversion until OSE-745.**
- **BUILD NOW (the one sequencing win, correctly scoped):** the eligibility ladder + anniversary clock + dunning state machine ship as real tested `src/` code — as the **quarantined `billing-clock.ts`** (D), emitting one boolean, never touching the allocator. Header stays honestly `true` (no charge executes). ADR-before-any-`src/`-money-movement, in the same PR — covering the `$19` instrument copy so a later dev doesn't "productionize" the link into a `createPaymentIntent`.
- **Born-red enforcement tests (two):** (1) allocator-quarantine denylist (D); (2) **depth gate:** "no account transitions `subscription:true` while its `corridor_map.source === 'fallback'` OR any billed section reports `below_min_sample_size`" (Critic 3 Fix 3a — predicate must be cleared-min-sample, not density-count≥3).

**Unbuilt-code dependencies (flag):** OSE-745 (subscription/store_credit resolvers — the single biggest constraint on "invoice at term close"); depth-gate telemetry (surface `corridorMap.source` + suppression to the eligibility check — both already computed at builder:576); first-live-pull clock-start + comp provenance flag + per-cell auto-extend (three small invariant-clean builds).

---

## (F) EXPLICIT 3-vs-6-MONTH DELTA

| Axis                           | 6-month               | 3-month                                                                                     | Net after reconciliation                                                                                              |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Vapor-sale risk (managers)** | Low                   | **Higher** — naive hard flip lands before live map exists                                   | Engineered out ONLY by starting the manager clock at first `source:'live'` pull (not signup, not first fallback pull) |
| **Sponsor risk**               | Low                   | **Low** — frequency renders day one                                                         | Slight gain: revenue sooner, honest                                                                                   |
| **Density-ratio value**        | Reachable             | **Unreachable in-window** (30-day rolling distinct-anon count, hardest for loyal audiences) | **Dropped from in-window Mid entirely**; month-4+ upsell                                                              |
| **Churn (small cohort)**       | Later, thicker value  | **Earlier, thin value + water-fill free-ride**                                              | Model **55–70% correlated** (not 40–60% indep.); gate the 2% floor paid-or-comp after grace                           |
| **Grandfather liability**      | Staggered, diluted    | **Synchronized onto richest rung**                                                          | **Lean to 50/25/0 metered from `min(first_invoice, signup+120d)`**; model on capped synchronized base                 |
| **Small-local ask**            | Runway for habit      | **Ask before value**                                                                        | Restore ramp: $19 gated on `source:'live'`, then $25–75                                                               |
| **WTP-sample**                 | Broader               | **Biased to weekly comp anchors**                                                           | Sample-of-one; book as price-discovery, not MRR                                                                       |
| **Automated revenue in 90d**   | —                     | **ZERO** (OSE-745 stubs)                                                                    | Every dollar is a human sending a Payment Link                                                                        |
| **Phase4 dependency**          | Assumed critical-path | **Removed** (no phase gate in code)                                                         | Correct; replaced by a HARDER, per-organizer accrual risk the draft under-scoped                                      |

**THE SINGLE MOST IMPORTANT THING TO GET RIGHT:** **The event-manager clock must start at the first `source:'live'` report pull, not at signup.** This converts "3 months then pay regardless" (which would invoice a fallback smoke-test map and invite chargebacks) into "3 months of real, rendered value then pay." It costs nothing to build (a read of `corridorMap.source`, already computed at builder:576) and it is the hinge on which the whole compressed manager side stands or falls.

---

## WHAT 3 MONTHS CANNOT BUY (honest limits)

- **No automated revenue.** OSE-745 stubs mean every conversion is a founder hand-selling a Payment Link. Book the 90-day goal as **"N out-of-band Payment-Link conversions from comp sponsors at $99/mo or $25–75/event" — a price-discovery number, not MRR.**
- **No median-manager conversion in the founder's window.** Only hand-picked weekly comp anchors clear live-map + return_rate fast enough; their ~90-days-from-first-render lands near calendar day 110-120. Monthly/bi-weekly organizers ride auto-extend — that is correct behavior, not failure.
- **No corridor-density value.** The differentiated density ratio is unreachable in 90 days and hardest for the retention story you want. Sell live-map + return_rate; hold density as a month-4+ upsell.
- **No Premium.** Phase5 infra unprovisioned; visible-not-given.
- **No local-keyed pricing.** `is_local` is buyable-attack-exposed until OSE-661/663; grandfather keys `founding_cell_id + founding_ts` only.

## THE DECISION, AS ONE PATH

```
Sponsors  → hard 3-month flip from own activation (frequency renders TODAY — honest; manual Payment-Link collection)
Managers  → 3 months FROM FIRST source:'live' PULL, gated source:'live' ∧ return_rate ∧ Gate B; auto-extend on fallback
Saturate  → ONE weekly, high-turnover corridor: 3 comp anchors + 1 weekly slot + 2–3 comp sponsors + poster subsidy;
            DROP the density ratio (unreachable in-window); bill on live-map + return_rate only
Transition→ event-triggered WTP probes (Payment-Link URLs, never src/ charges);
            grandfather 50/25/0 metered from min(first_invoice, signup+120d), keyed founding_cell_id+ts;
            small locals: $19 unlock gated on source:'live' first, then $25–75 @ 40–60% churn;
            2% floor paid-or-comp-gated after grace; model sponsor churn 55–70% CORRELATED
Payment   → all in-window conversions MANUAL (OSE-745 stubs); build billing-clock STATE in src/ now as a
            QUARANTINED pure module emitting one boolean — never a field allocateShares() reads
Pricing   → unchanged; fix brain-canonical weights FIRST then mirror (OSE-336 drift check);
            correct tier-gates.yaml phase-drift by DOC edit, never by adding enforcement
```

**Load-bearing files (all verified this loop):** `shared-report.ts:229-257` (baseline = COUNT(DISTINCT anon) over 30-day ROLLING window); `sponsor-allocation.ts:262-281` (water-fill redistribution — the free-ride), `:87,90,95,249`; `sponsor-eligibility.ts:9-12,34-37,44-49,55-66` (boolean-only; subscription/store_credit false stubs → OSE-745); `sponsor-share-covenant.invariant.spec.ts:84-93` (ShareAllocation field denylist, #25 shape-lock); `monetization-inert.invariant.spec.ts:55-70,105-126`; `report-depth.ts:118` (SPONSOR_MAX='mid'); `shared-report-builder.ts:588-614` (map live/fallback, no phase gate); `shared-report-materialize.ts:81-89` (baseline refreshed nightly by cron).
