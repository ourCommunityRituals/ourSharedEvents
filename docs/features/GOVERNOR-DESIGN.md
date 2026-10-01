# Sponsor Pricing Tier Balancer — Design

> Deep dive into the pool-based tier multiplier model with share compression.
> Security, functional edge cases, error handling, and implementation path.
>
> Formerly "Sponsor Pricing Tier Balancer." Renamed for clarity — you should be
> able to read the name once and know exactly what it does.
>
> **Design status:** Decisions D1-D4 resolved. This doc is the spec.
> See [SPONSOR-PRICING.md](SPONSOR-PRICING.md) for the business model context.

---

## The Formula

Every sponsor gets a share of screen time based on pool size and tier multiplier:

```
share(sponsor) = multiplier(tier) / sum(all multipliers in pool)
```

### Standard Multipliers

| Tier    | Multiplier | What It Means                         |
| ------- | :--------: | ------------------------------------- |
| Premium |     3x     | 3x the screen time of a local sponsor |
| Mid     |     2x     | 2x the screen time of a local sponsor |
| Local   |     1x     | Base unit                             |

### Compressed Multipliers (Governor Active)

| Tier    | Multiplier | Change           |
| ------- | :--------: | ---------------- |
| Premium |     2x     | -1x (compressed) |
| Mid     |    1.8x    | -0.2x            |
| Local   |    1.5x    | +0.5x (boosted)  |

### Worked Examples

**Pool A:** 1 premium, 2 mid, 5 local (typical bocce night)

```
Standard:    3 + 2(2) + 5(1) = 12 units
  Premium:   3/12 = 25.0%
  Each mid:  2/12 = 16.7%
  Each local: 1/12 =  8.3%
  Ratio premium:local = 3:1 ✓

Compressed:  2 + 2(1.8) + 5(1.5) = 13.1 units
  Premium:   2/13.1 = 15.3%   (was 25.0%, -9.7pp)
  Each mid:  1.8/13.1 = 13.7%  (was 16.7%, -3.0pp)
  Each local: 1.5/13.1 = 11.5%  (was 8.3%, +3.2pp)
  Ratio premium:local = 1.3:1 (was 3:1)
```

**Pool B:** 1 premium, 0 mid, 1 local (small trivia night)

```
Standard:    3 + 1 = 4 units
  Premium:   3/4 = 75.0%
  Local:     1/4 = 25.0%
  Ratio = 3:1 ✓

Compressed:  2 + 1.5 = 3.5 units
  Premium:   2/3.5 = 57.1%
  Local:     1.5/3.5 = 42.9%
  Ratio = 1.3:1 ✓
```

**Pool C:** 1 premium, 2 mid, 20 local (regional event)

```
Standard:    3 + 2(2) + 20(1) = 27 units
  Premium:   3/27 = 11.1%
  Each mid:  2/27 = 7.4%
  Each local: 1/27 = 3.7%
  Ratio premium:local = 3:1 ✓ (same ratio regardless of pool size)
```

**Pool D:** 5 local only (all-local event)

```
Standard:    5(1) = 5 units
  Each local: 1/5 = 20.0%  — equal share ✓
```

---

## Security Analysis

### S1: Pool Manipulation — Fake Sponsor Injection

**Threat:** Attacker creates fake sponsor accounts to dilute other sponsors' screen time. Adding 100 fake local sponsors would shrink a premium sponsor's share from 25% to ~3%.

**Mitigation:**

- Sponsor creation requires admin authentication (Bearer token / CF Access JWT)
- Sponsor records live in the admin-controlled SPONSORS sheet / D1 table — no public write access
- Every sponsor is tied to an event via `event_id` FK — admin must explicitly associate
- Monetization hooks track billable units per sponsor — fake sponsors with zero impressions are obvious in analytics

**Residual risk:** A compromised admin key could inject sponsors. Mitigated by:

- Rate limiting on admin endpoints
- Audit logging (`SPONSOR_MONETIZATION_REQUEST` events)
- Future: multi-user auth (Phase 3 Firebase) with role-based access

### S2: Tier Escalation — Self-Upgrading

**Threat:** A local sponsor manipulates their tier field to premium to get 3x instead of 1x.

**Mitigation:**

- Tier field is admin-controlled (SPONSORS sheet column or D1 column) — no public API to change it
- `normalizeSponsor()` in `SponsorUtils.html` coerces tier from backend data, not from client input
- The locked sponsor contract (`sponsor.ts`) defines `VALID_SPONSOR_TIERS` — invalid tiers are rejected
- Tier validation at schema level (`sponsor.schema.json`: enum constraint)

**Residual risk:** None for external attackers. Admin error could set wrong tier — detectable via monetization hook audit trail.

### S3: Governor Threshold Gaming — Artificial Scan Spikes

**Threat:** A local sponsor sends automated scan requests to trigger the governor, compressing premium's share to boost their own.

**Mitigation:**

- Scans are anonymous — `user_agent_hash` + `scan_bucket` — but repeated identical hashes in a short window are detectable
- In-memory rate limiting exists on the subscribe endpoint. Scan recording (`/q/`) and short links (`/s/`) have no rate limit today (reconciliation 2026-10-01); adding one is a separate story
- Governor threshold (default 5 scans per 15-min window) is per-event, not per-sponsor — gaming requires broad QR code access
- QR tokens (`qr_token` UNIQUE in `poster_deployments`) are per physical placement — attacker needs physical access to poster

**Residual risk:** Someone standing at a poster rapidly scanning could trigger the governor. But:

- This is also legitimate high engagement
- The hysteresis (2 consecutive sub-threshold windows to deactivate) prevents rapid on/off cycling
- Peak tracking (`peak_scan_rate`) records the spike for audit
- The compression benefits ALL local sponsors, not just the attacker

**Design decision:** The governor should react to real activity. Gaming it requires physical presence at an event, which means real engagement is happening. The system can tolerate this.

### S4: Stale Pool Data — Time-of-Check vs Time-of-Use

**Threat:** Display surface renders with stale sponsor pool data. A sponsor was removed but still appears in rotation.

**Mitigation:**

- Display surface fetches sponsor data from API on page load and on event selection
- Carousel renders from the current pool — removing a sponsor from the backend removes them on next fetch
- `is_active` flag on sponsors table allows soft-delete without data loss

**Enhancement needed:** The display surface should re-fetch pool data periodically (every N rotation cycles) to stay current during long-running display sessions.

### S5: Weight Calculation Integrity — Client vs Server

**Threat:** Display surface computes weights client-side, which could be manipulated via browser DevTools.

**Current state:** `SponsorUtils.html` does sorting and filtering client-side. The carousel gives equal `rotationMs` per sponsor — no weight math exists client-side yet.

**Design principle from sponsor contract:** "All aggregation happens server-side. UI must NEVER compute these values."

**Mitigation for pool-based model:**

- **Option A (preferred):** Server computes `dwellMs` per sponsor and includes it in the API response. Client just uses the number. No weight math on the client.
- **Option B:** Server returns the pool and multipliers. Client computes dwell. Simpler API but weight math is exposed.

**Recommendation:** Option A. The sponsor contract already establishes that metrics are server-computed. Extend this to dwell time. The API response includes:

```json
{
  "sponsors": [
    { "id": "abc", "name": "ABC", "tier": "premium", "dwellMs": 7500 },
    { "id": "nicks", "name": "Nicky's", "tier": "local", "dwellMs": 2500 }
  ],
  "governorState": "INACTIVE",
  "poolSize": 8,
  "totalRotationMs": 40000
}
```

---

## Functional Edge Cases

### F1: Empty Pool — No Sponsors

**Scenario:** Event has zero sponsors.

**Expected behavior:** No sponsor strip/sidebar rendered. No rotation. No error. The Display surface already handles this — `SponsorUtils.renderStrip` returns empty HTML when picks is empty, and `renderCarousel` returns `{ sponsors: [], stop: () => {} }`.

**Pool-based impact:** `sum(multipliers) = 0`. Division by zero.

**Mitigation:** Guard clause: if pool is empty, skip weight calculation entirely. Already handled at the rendering layer — no calculation needed when there's nothing to display.

### F2: Single Sponsor — Any Tier

**Scenario:** Event has exactly 1 sponsor (any tier).

**Expected behavior:** That sponsor gets 100% of screen time. No rotation needed.

**Pool-based math:** `share = multiplier / multiplier = 100%` ✓ regardless of tier.

**Carousel behavior:** `renderCarousel` already handles this — `if (picks.length > 1)` gates the rotation interval. Single sponsor just renders statically.

### F3: All Same Tier

**Scenario:** 5 local sponsors, no mid or premium.

**Expected behavior:** Equal share. Each gets 20%.

**Pool-based math:** `1 / (5×1) = 20%` each ✓

**This is a key selling point.** An all-local event works perfectly — nobody subsidizes a premium tier that doesn't exist.

### F4: Tier Transition Mid-Event

**Scenario:** Admin upgrades a sponsor from local to mid during a live event.

**Expected behavior:** The pool rebalances on next data fetch. No jarring visual change.

**Risk:** If display surface caches pool data, the transition is delayed.

**Mitigation:**

- Display re-fetches pool data periodically (see S4)
- Governor state is independent of tier — a tier change doesn't trigger state transition
- Carousel smoothly transitions on next rotation cycle with new dwell times

### F5: Governor Activation During Sparse Pool

**Scenario:** Pool of 2 (1 premium, 1 local). Governor activates.

**Standard:** premium 75%, local 25%
**Compressed:** premium 57%, local 43%

**Is this correct?** Yes. The compression gives the local bar much more visibility during the busiest part of the event. The premium sponsor paid for 3x, but during peak engagement the community sponsor gets boosted. This IS the fair marketplace.

### F6: Very Large Pool

**Scenario:** 50 sponsors (3 premium, 7 mid, 40 local).

**Pool-based math:**

```
Standard:  3(3) + 7(2) + 40(1) = 63 units
  Each premium: 3/63 = 4.8%
  Each mid:     2/63 = 3.2%
  Each local:   1/63 = 1.6%
  Total rotation time at 5s/slide = 50 × 5s = 250s (4+ min full cycle)
```

**Concern:** At 1.6% per local sponsor with a 5s base rotation, each local gets 1.6% of display time. In a 250s cycle, that's ~4 seconds per cycle. Is that enough?

**Options:**

1. Cap pool size (e.g., max 20 sponsors per event) — simple but arbitrary
2. Increase base rotation speed for larger pools — more sponsors = faster cycle
3. Split into rotation groups — premium/mid in top banner, locals in sidebar carousel
4. Minimum dwell time floor — no sponsor gets less than N seconds per cycle

**Recommendation:** Option 4 (minimum dwell floor) combined with Option 3 (placement-based groups). Premium/mid rotate in the header with their multiplied dwell. Locals rotate in the sidebar carousel with equal time. The governor compresses the header rotation to show locals there too during peak activity. This matches the existing Display.html architecture (`.sponsor-top` for headers, `#sponsorSide` for sidebars).

### F7: Multiplier Values — What's the Right Ratio?

**Design space:**

| Multiplier Set    | P:L Ratio | Character                                                        |
| ----------------- | :-------: | ---------------------------------------------------------------- |
| 5x / 3x / 1x      |    5:1    | Premium-dominant — closer to fixed weights                       |
| 3x / 2x / 1x      |    3:1    | Balanced — premium gets meaningful advantage, local stays viable |
| 2x / 1.5x / 1x    |    2:1    | Local-friendly — premium advantage is modest                     |
| 1.5x / 1.25x / 1x |   1.5:1   | Near-equal — tiers barely matter                                 |

**Recommendation:** Start with **3x / 2x / 1x**. This gives premium a clear advantage (3x screen time) while ensuring local always gets a meaningful share. The price-to-multiplier ratio creates diminishing returns:

- Local: $75 for 1x = $75 per unit
- Mid: $200 for 2x = $100 per unit
- Premium: $500 for 3x = $167 per unit

Local gets the best value per dollar. Premium pays a premium for premium. This incentivizes local participation.

**The multiplier values are tunable without code changes** if they're stored as event-level or global configuration (via feature flags or event settings). Start with 3/2/1 and adjust based on market feedback.

### F8: Transition from Fixed Weights to Pool-Based

**Current state:** Governor test uses fixed weights (`{ premium: 0.50, med: 0.30, local: 0.20 }`). Carousel uses equal `rotationMs`.

**Migration path:**

1. Add multiplier configuration to event settings or global config
2. Replace `getDisplayWeights()` with `getPoolWeights(pool, multipliers, governorState)`
3. Server computes `dwellMs` per sponsor from pool weights
4. Carousel uses per-sponsor `dwellMs` instead of uniform `rotationMs`
5. Update governor test to validate pool-based math instead of fixed percentages

**Backwards compatible:** Events without multiplier config fall back to equal time (all multipliers = 1x).

---

## Error Handling

### E1: Database Unavailable During Weight Calculation

**Scenario:** D1 is down when Display surface fetches sponsor pool.

**Expected behavior:** Display renders with cached/stale pool data or no sponsors. Never a broken display.

**Mitigation:**

- Display surface already has loading/error states in the HTML
- API returns last-known pool from cache if DB is unavailable
- Governor state is in-memory (per-isolate) — independent of DB availability
- `handleDbError()` pattern from forms system returns 503 with structured error

### E2: NaN / Infinity in Weight Calculation

**Scenario:** Division by zero, corrupt multiplier value, or negative multiplier.

**Guard clauses needed:**

```
if (totalUnits <= 0) → equal time for all (1/N)
if (multiplier < 0) → treat as 1x
if (multiplier > MAX_MULTIPLIER) → cap at MAX_MULTIPLIER
if (!isFinite(share)) → fallback to equal time
```

**Design:** All weight calculation happens in a single function (`computePoolWeights`) that validates inputs and returns safe defaults on any error. Never expose raw math to the rendering layer.

### E3: Governor State Corruption

**Scenario:** Governor state object has invalid fields (`state: null`, `sub_threshold_windows: -1`).

**Current mitigation:** `createGovernorState()` initializes with known-good defaults. State transitions are explicit — no partial updates.

**Enhancement:** Add validation on governor state read:

```
if (!['INACTIVE', 'ACTIVE', 'COOLING_DOWN'].includes(govState.state)) → reset to INACTIVE
if (govState.sub_threshold_windows < 0) → reset to 0
```

### E4: Clock Skew in Rolling Window

**Scenario:** Cloudflare Worker isolate has stale `Date.now()` or scan events arrive out of order.

**Mitigation:**

- `scan_bucket` uses hourly windows — tolerant of seconds-level skew
- Governor rolling window (15 min) is coarse enough to absorb jitter
- `activated_at` timestamp is informational, not used in state transitions

### E5: Race Condition — Concurrent Pool Updates

**Scenario:** Two admin requests simultaneously change the sponsor pool (add and remove a sponsor at the same time).

**Mitigation:**

- D1 provides serializable transactions per database
- Sponsor list is read atomically (single `SELECT` query)
- Weight calculation is pure function of pool snapshot — no mutable shared state
- Display re-fetches on next cycle — eventual consistency is acceptable for rotation display

### E6: Carousel Timer Drift

**Scenario:** `setInterval` in carousel drifts over long display sessions (hours on a TV).

**Current behavior:** `renderCarousel` uses `setInterval(fn, rotationMs)` — susceptible to drift over time.

**Enhancement:** Use `requestAnimationFrame` with elapsed-time tracking, or re-sync interval periodically. For a TV display running 8+ hours, drift could accumulate to seconds, causing sponsors to get slightly more or less time than calculated.

**Practical impact:** Low. Over 8 hours of 5-second rotations (5,760 cycles), drift of ~1ms per cycle = ~6 seconds total. Acceptable for display use case.

---

## Implementation Priority

| Item                                             | Priority | Effort | Dependencies                    |
| ------------------------------------------------ | -------- | ------ | ------------------------------- |
| `computePoolWeights()` pure function             | P0       | Small  | None — pure math                |
| Test suite for pool-based weights                | P0       | Small  | computePoolWeights              |
| Guard clauses (E2)                               | P0       | Small  | computePoolWeights              |
| Server-side `dwellMs` in API response (S5)       | P1       | Medium | computePoolWeights + API change |
| Governor multiplier tables (standard/compressed) | P1       | Small  | computePoolWeights              |
| Carousel per-sponsor dwell time                  | P1       | Medium | dwellMs in API response         |
| Multiplier config in event settings              | P2       | Medium | Feature flag system             |
| Pool re-fetch on display (S4)                    | P2       | Small  | Display surface change          |
| Minimum dwell floor (F6)                         | P2       | Small  | computePoolWeights              |
| Governor state validation (E3)                   | P3       | Small  | Governor state machine          |
| Timer drift fix (E6)                             | P3       | Small  | Carousel rendering              |

---

## Design Decisions (Resolved)

### D1: Share Compression, Not Multiplier Compression

**Decision:** Compress the final share, not the multiplier.

**Rationale:** Share compression honors the premium buy. The sponsor paid for 3x — the ratio stays meaningful even during peak activity. Multiplier compression (3x → 2x) collapses the ratio to 1.3:1, which undermines the value proposition of paying $500 vs $75.

Share compression applies a percentage haircut to the premium share and redistributes to local:

```
Pool A: 1 premium, 2 mid, 5 local (20% compression on premium)

Standard:     P=25.0%   M=16.7%   L=8.3%   (ratio 3:1)
Compressed:   P=20.0%   M=13.3%   L=9.3%   (ratio 2.2:1)
```

Premium still gets 2.2x local — they paid 6.7x more but the diminishing returns are the feature, not a bug. Local gets a meaningful floor boost. The premium sponsor's investment is respected.

**Compression parameter:** The compression percentage is tunable. 20% is the starting point. Higher compression = more local protection. Lower = more premium advantage. This is a single global config value.

### D2: Global Multipliers, Not Per-Event

**Decision:** Global multipliers only. No per-event override.

**Rationale:** Per-event tuning is the ideal, but the processing cost and operational complexity at scale are prohibitive. With 47 event types now and 180 by 2028:

- Per-event multipliers require a lookup + computation per sponsor per event on every display render
- Configuration surface area explodes — who manages 180 different multiplier sets?
- Sponsors expect consistent treatment across events — "I bought mid, I get 2x everywhere"
- Edge workers have limited compute budget per request — global lookup is O(1), per-event is O(N)

Global multipliers mean one set of numbers for the entire platform. Change once, applies everywhere. Sponsors can explain their package to anyone: "We get 2x screen time at every event."

If market data later proves that certain event types need different ratios, the architecture supports adding per-event overrides through the existing feature flag system. But start global.

### D3: Absolute Minimum Dwell Floor — Before Compression

**Decision:** Floor applies before compression. No sponsor ever shows for less than 2 seconds, period. The balancer cannot push anyone below.

**Rationale:** Same reasoning as global multipliers — simpler guarantee, less edge cases, less to explain. "2 seconds minimum, always" is a rule anyone can understand. An absolute floor means:

- Sponsors can trust their minimum visibility regardless of pool size or activity
- The balancer works within a bounded range — it can compress premium but can never eliminate anyone
- No scenario, however extreme, produces a sub-2-second impression

```
computePoolWeights(pool, multipliers)
  → apply 2-second minimum dwell floor  ← first, absolute guarantee
  → apply pool-based share calculation
  → apply share compression if balancer active
```

Below 2 seconds, the human eye can't register the brand. The floor is a practical reality constraint. It protects all tiers equally — local and premium alike.

### D4: GOVERNOR-DESIGN.md Replaces the Lost Spec

**Decision:** This document is the spec. The test is refactored to match.

**Rationale:** The governor state machine test (`governor-state-machine.test.js`) validates state transitions and hysteresis — that logic is correct and unchanged. The fixed weight constants (`STANDARD_WEIGHTS`, `COMPRESSED_WEIGHTS`) are replaced with:

1. `computePoolWeights(pool, multipliers)` for standard allocation
2. `applyShareCompression(weights, compressionPct)` for governor-active state
3. `applyDwellFloor(dwellTimes, minDwellMs)` for the 2-second minimum

The test file becomes the executable spec. This document is the design rationale.

---

## Open Questions (Remaining)

1. **What compression percentage?** Starting at 20%. Should this be tunable by admin, or fixed in code? Recommendation: fixed in code for Phase 1, admin-tunable in Phase 2 via feature flag system.

2. **Should the compression percentage vary by pool size?** A 20% haircut on premium in a pool of 3 has a different feel than in a pool of 30. Constant percentage is simpler and predictable. Variable adds complexity but could feel more fair at extremes. Recommendation: constant for launch, evaluate after market data.

3. **How should the SharedReport surface display the weight allocation?** Sponsors see their impression counts and screen time. Should the report show the pool size, their multiplier, and the governor state? More transparency builds trust. But it also reveals the pricing mechanics to competitors in the same pool. Recommendation: show impressions and percentage of total — not the underlying multiplier math.
