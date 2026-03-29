# Sponsor Pricing & Governance

> How sponsor pricing, screen time, and pool governance work together.
> The governor state machine IS the pricing mechanism — dollar amounts are just the entry ticket to a weight class.
> See [VISION.md](VISION.md) for the fair marketplace principle.

---

## The Model

Sponsors buy into a **weight class** — local, mid, or premium. The weight class determines their screen time allocation across surfaces. The governor dynamically rebalances weights when activity spikes, compressing premium and boosting local. This is the fair marketplace in action.

```
Sponsor signs up → picks weight class → pool-based share calculation
                                              │
                                     Governor monitors scan rate
                                              │
                              ┌───────────────┼───────────────┐
                         Low activity     Normal          High activity
                        (standard)      (standard)       (share compression)
                              │               │               │
                         3x/2x/1x        3x/2x/1x       20% haircut on premium
                         multipliers     multipliers      redistributed to local
```

**When activity is high, local sponsors get proportionally MORE screen time, not less.**

---

## Weight Classes

Screen time is **pool-based**: every sponsor gets `multiplier / sum(all multipliers)`. The ratio between tiers is locked to the multiplier (3:1 premium vs local) regardless of pool size.

| Class | Multiplier | Display Placement | Public Placement |
|-------|:---------:|-------------------|------------------|
| **Premium** | 3x | Headers (top banner) | Sidebars |
| **Mid** | 2x | Headers (top banner) | Sidebars |
| **Local** | 1x | Sidebars (side panel) | Sidebars |

**Multipliers are global** — same for every event type. One set of numbers for the entire platform. Sponsors know exactly what they're buying: "Mid = 2x screen time at every event."

When the governor activates during high activity, it applies **share compression** (20% haircut on premium's computed share, redistributed to local). This preserves the premium investment — premium still gets ~2.2:1 vs local — while giving local sponsors a meaningful boost when the crowd is biggest.

See [GOVERNOR-DESIGN.md](GOVERNOR-DESIGN.md) for the full security, functional, and error handling analysis.

### What Each Class Gets

**Local ($75 illustrative)**
- Side panel placement on Display (TV/kiosk)
- Sidebar placement on Public (mobile)
- Poster/tabletop slot (1 sponsor per physical ad slot)
- Anonymous behavioral analytics in SharedReports
- QR trigger impressions tracking

**Mid ($200 illustrative)**
- Header placement on Display (top banner)
- Sidebar placement on Public (mobile)
- Everything in Local
- More rotation time than Local

**Premium ($500 illustrative)**
- Header placement on Display (top banner) with more dwell time
- Sidebar placement on Public (mobile)
- Everything in Mid
- Primary sponsor badge (1.6x logo on headers, 1.4x on sidebars)
- Most rotation time in the pool

> **Note:** Dollar amounts are illustrative and will vary by event type and phase.
> Package slot counts (3/5/9) are starting estimates, not locked.

---

## The Governor State Machine

The Gaming Compression Governor monitors real-time scan activity and rebalances display weights to protect local sponsors during high-traffic events.

### States

```
INACTIVE ──(scans >= threshold)──→ ACTIVE ──(scans < threshold)──→ COOLING_DOWN
    ↑                                                                    │
    └────────(2 consecutive sub-threshold windows)───────────────────────┘
                                                                         │
                               ACTIVE ←──(scans >= threshold)────────────┘
```

| State | Effect | Behavior |
|-------|--------|----------|
| **INACTIVE** | Standard pool math (3x/2x/1x) | Normal rotation — premium gets 3:1 vs local |
| **ACTIVE** | 20% share compression on premium | High traffic — premium drops to ~2.2:1, local boosted |
| **COOLING_DOWN** | Standard pool math | Hysteresis — waits 2 windows before deactivating |

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ROLLING_WINDOW` | 15 minutes | Scan counting window |
| `THRESHOLD` | 5 scans | Activation threshold per window |
| `HYSTERESIS_WINDOWS` | 2 | Consecutive sub-threshold windows before deactivation |
| `COMPRESSION_PCT` | 20% | Share haircut on premium when governor active |
| `MIN_DWELL_MS` | 2000 | Minimum display time per sponsor (floor) |

### Why This Matters

During a packed bocce night with 200 people scanning QR codes, the governor activates. Premium's share gets a 20% haircut — from 25% to 20% in a typical pool. The freed time goes to local. The national brand still gets the most time — they paid for 3x and they're getting ~2.2x — but the neighborhood bar gets a meaningful boost when it matters most: when the crowd is biggest.

The 2-second minimum dwell floor ensures no sponsor's impression drops below the threshold where a human eye can register the brand. Below 2 seconds, the impression has no value.

---

## Surface Placement Rules

### Display (TV/Kiosk)

| Placement | Classes | Element | Size |
|-----------|---------|---------|------|
| **Top banner** (`.sponsor-top`) | Premium, Mid | Header strip | Standard logo height |
| **Side panel** (`#sponsorSide`) | Local | Sidebar cards | Side logo height |
| **Primary badge** | Premium | 1.6x header, 1.4x sidebar | Enhanced |

**Rotation:** Display supports multi-pane rotation with configurable dwell time per pane:
- Pane types: `public`, `schedule`, `standings`, `sponsors`, `custom`
- Each pane has a `dwellMs` override — premium sponsors get longer dwell
- Default rotation interval: 5000ms

### Poster / Tabletop

- **Physical:** 1 sponsor per ad slot — choice placement, no rotation
- **Digital:** Rotates through sponsors in the pool

### Public (Mobile)

- All classes get sidebar placement
- Sponsor strip scrollable horizontal on mobile
- Tier badge shown for premium sponsors

### SharedReports

All classes see the same anonymous behavioral data:
- QR trigger counts on ads
- Impression counts from screen time
- Event registration as impressions
- Time-on-screen registers as impressions

---

## The Sponsor Pool

The total number of sponsors in the pool is the natural governor of the marketplace. More sponsors = each gets less rotation time. The pricing tiers buy a larger share of that rotation.

The pool is self-governing:
- A crowded pool means each sponsor gets less absolute time but the event is more popular
- A sparse pool means each sponsor gets more time but the event is smaller
- The governor ensures local sponsors always get a fair share regardless of pool size

---

## Event Type Phases & Regulatory Gates

Sponsor pricing and package structure varies by event type. Event types progress through 5 phases of regulatory clearance:

| Phase | Regulatory Level | Event Types | Sponsor Implications |
|-------|-----------------|-------------|---------------------|
| **Phase 1** | Standard | Community gatherings, trivia nights, open tables | Standard sponsor packages |
| **Phase 2** | Youth sports | Recreational leagues with minors | COPPA compliance on data collection |
| **Phase 3** | Health/wellness | Fitness events, health screenings | HIPAA considerations for health data |
| **Phase 4** | Licensed venues | Events at bars, restaurants | Alcohol advertising restrictions |
| **Phase 5** | Full regulatory | Government-partnered, public safety events | Full compliance stack |

**The anonymous-ID-first architecture is designed for this.** Because the scan system collects zero PII, the regulatory burden is significantly lighter at every phase. There's no personal data to protect under HIPAA or COPPA — only anonymous presence signal.

Planning: **47 event types at launch, scaling to 180 by 2028.**

---

## QR Click Playback (Rebuild Needed)

> **Status:** Concept validated, implementation lost in laptop crash. Needs rebuild.

The selling point: ability to replay QR scan activity on poster/tabletop placements over the days leading up to an event. Shows sponsors:
- Which physical placements generated the most scans
- When during the day scans peaked
- How scan activity built over time pre-event
- Activity patterns during the event itself

**Key differentiator:** All of this without personal data. The playback shows behavioral patterns of groups — scan density by time bucket, by placement, by region — never individuals. This is possible because the `scans` table stores `scan_bucket` (hourly), `poster_deployment_id` (placement with lat/lng), and `user_agent_hash` (device class) — nothing that identifies a person.

**Data model already supports this:**
- `scans.scan_bucket` — hourly time windows
- `scans.poster_deployment_id` → `poster_deployments.latitude/longitude`
- `scan_aggregates.bucket_date` + `bucket_hour` — pre-computed rollups

---

## Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| Governor state machine | Tested | `tests/unit/worker/governor-state-machine.test.js` |
| Standard/compressed weights | Tested | `{ premium: 0.50, med: 0.30, local: 0.20 }` / `{ 0.40, 0.32, 0.28 }` |
| SponsorUtils (render + sort by tier) | Working | `src/mvp/SponsorUtils.html` |
| Display surface (headers + sidebars) | Working | `src/mvp/Display.html` |
| Display rotation (multi-pane + dwell) | Working | `schemas/event.schema.json` DisplayRotation |
| Sponsor schema (multi-placement) | Working | `schemas/sponsor.schema.json` |
| Monetization hooks (inert) | Working | `worker/src/handlers/monetizationHooks.ts` |
| Sponsor contract (locked v1.1.0) | Working | `worker/src/domain/sponsor.ts` |
| QR click playback | **Lost — needs rebuild** | Was in development pre-crash |
| Actual pricing ($75/$200/$500) | Illustrative | Not in code — will vary by event type |
| Package slot counts (3/5/9) | Estimates | Not in code — starting numbers |
| Event type regulatory phases | Planned | Not yet in schema or code |
