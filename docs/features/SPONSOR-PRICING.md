# Sponsor Pricing & Governance

> How sponsor pricing, screen time, and pool governance work together.
> The governor state machine IS the pricing mechanism — dollar amounts are just the entry ticket to a weight class.
> See [VISION.md](VISION.md) for the fair marketplace principle.
> This is the **mechanism**; for the go-to-market pricing & free-to-paid business
> plan (dollar strategy, term structure, conversion playbook) see
> [../positioning/PRICING-PLAN.md](../positioning/PRICING-PLAN.md).

---

## The two things money can buy

Invariant **#25 — Sponsor Share Covenant** (status: `live`) defines the entire commercial surface:

> _"Sponsor rotation on the public-URL surface is a share-of-voice percentage computed by the
> covenant allocation math — never a purchasable position. Size, slot, and logo treatment are
> uniform for all sponsors regardless of spend. Every is_local sponsor receives at least the
> guaranteed local floor share. No pricing tier or individual sponsor's share exceeds the premium
> cap. is_local is geo-derived (corridor-cell match), never a purchasable or admin-toggle flag.
> Money buys frequency-share and report depth only — never size, slot, position, or is_local status."_

| Purchasable                                                  | Not purchasable                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Frequency-share** — how often you appear in the rotation   | Size — every logo renders at the same height in a given region            |
| **Report depth** — how much detail your SharedReport carries | Slot or position — nobody buys the header, the rail, or the top of a list |
|                                                              | Dwell — every appearance lasts the same time for every sponsor            |
|                                                              | Visible rank — no tier badges, no "primary sponsor" treatment             |
|                                                              | `is_local` status — geo-derived from the address, never sold or toggled   |

**The sponsor-facing sentence:** _you are never smaller than anyone else; you are on screen more often._

---

## The Model

Sponsors buy into a **weight class** — local, mid, or premium. The weight class determines their
share of rotation frequency across surfaces. The governor dynamically rebalances shares when
activity spikes, compressing premium and boosting local. This is the fair marketplace in action.

```
Sponsor signs up → picks weight class → pool-based share calculation
                                              │
                                     Governor monitors scan rate
                                              │
                              ┌───────────────┼───────────────┐
                         Low activity     Normal          High activity
                        (standard)      (standard)       (share compression)
                              │               │               │
                         7x/3x/1x        7x/3x/1x       20% haircut on premium
                         multipliers     multipliers      redistributed to local
```

**When activity is high, local sponsors get proportionally MORE screen time, not less.**

---

## Weight Classes

Screen time is **pool-based**: every sponsor gets `multiplier / sum(all multipliers)`. The ratio
between tiers is locked to the multiplier (7:1 premium vs local, 3:1 mid vs local) regardless of
pool size.

> **Canonical source:** these multipliers are owned by the org brain at
> `OCR-docs/ocr-docs-brain/sponsor-allocation.yaml` (`weights:` — `base: 1`,
> `mid: 3`, `premium: 7`) and mirrored byte-for-byte into the OSE substrate at
> `workers/oursharedevents/src/lib/sponsor-allocation.ts`. The OSE-336 drift
> gate fails CI on any mismatch. If these ever disagree, the YAML wins.

| Class       | Multiplier | What it buys                                  |
| ----------- | :--------: | --------------------------------------------- |
| **Premium** |     7x     | 7x base rotation frequency + deepest report   |
| **Mid**     |     3x     | 3x base rotation frequency + mid report depth |
| **Local**   |     1x     | base rotation frequency + base report depth   |

**Multipliers are global** — same for every event type. One set of numbers for the entire platform.
Sponsors know exactly what they're buying: "Mid = 3x rotation frequency at every event."

**Every class appears on every eligible surface.** Placement is not a product. A local sponsor and
a premium sponsor both appear in the Display header band and both appear in the rail; the premium
sponsor simply comes around more often.

### The three walls

From `sponsor-allocation.yaml`, enforced in `allocateShares()`:

| Wall                           | Value | Meaning                                                            |
| ------------------------------ | ----- | ------------------------------------------------------------------ |
| **WALL 1** — `premium_cap_pct` | 40%   | No single premium sponsor may hold more than 40% of rotation share |
| **WALL 2** — `local_floor_pct` | 30%   | The `is_local` class collectively holds at least 30%, always       |
| `mid_cap_pct`                  | 20%   | No single mid sponsor exceeds 20%                                  |

The walls bind harder than the weights in small pools. With one premium and one local sponsor, raw
7:1 would give premium 87.5% — the cap crushes it to 40% and the local floor holds 30%. **The
ratio is a starting point; the walls are the guarantee.**

### What each class gets

**Local ($75 illustrative)**

- Appears on every eligible surface, at the same size as everyone else
- Base rotation frequency, protected by the 30% collective local floor
- Poster/tabletop slot (1 sponsor per physical ad slot)
- Anonymous behavioural data in SharedReports — base depth
- QR trigger counts

**Mid ($200 illustrative)**

- Everything in Local
- 3x base rotation frequency
- Mid report depth

**Premium ($500 illustrative)**

- Everything in Mid
- 7x base rotation frequency, capped at 40% share
- Deepest report tier

> **Note:** Dollar amounts are illustrative and will vary by event type and phase.
> `weights.base: 1` is defined in the brain as the _unpaid / free_ sponsor weight — the relationship
> between the free tier and the illustrative $75 Local price point is a go-to-market decision, not a
> mechanism decision. See [../positioning/PRICING-PLAN.md](../positioning/PRICING-PLAN.md).

---

## The Sponsor Pricing Tier Balancer

The Balancer monitors real-time scan activity and rebalances rotation share to protect local
sponsors during high-traffic events.

### States

```
INACTIVE ──(scans >= threshold)──→ ACTIVE ──(scans < threshold)──→ COOLING_DOWN
    ↑                                                                    │
    └────────(2 consecutive sub-threshold windows)───────────────────────┘
                                                                         │
                               ACTIVE ←──(scans >= threshold)────────────┘
```

| State            | Effect                           | Behavior                                            |
| ---------------- | -------------------------------- | --------------------------------------------------- |
| **INACTIVE**     | Standard pool math (7x/3x/1x)    | Normal rotation — premium gets 7:1 vs local         |
| **ACTIVE**       | 20% share compression on premium | High traffic — premium share cut 20%, local boosted |
| **COOLING_DOWN** | Standard pool math               | Hysteresis — waits 2 windows before deactivating    |

### Configuration

| Parameter            | Default    | Description                                                       |
| -------------------- | ---------- | ----------------------------------------------------------------- |
| `ROLLING_WINDOW`     | 15 minutes | Scan counting window                                              |
| `THRESHOLD`          | 5 scans    | Activation threshold per window                                   |
| `HYSTERESIS_WINDOWS` | 2          | Consecutive sub-threshold windows before deactivation             |
| `COMPRESSION_PCT`    | 20%        | Share haircut on premium when balancer active                     |
| `MIN_DWELL_MS`       | 2000       | Minimum display time per appearance — **uniform for all classes** |

### Why This Matters

During a packed bocce night with 200 people scanning QR codes, the balancer activates. Premium's
computed share gets a 20% haircut, and the freed frequency is redistributed to local. The national
brand still leads the pool — they paid for 7x weight — but the neighborhood bar gets a meaningful
boost when it matters most: when the crowd is biggest.

`MIN_DWELL_MS` is a **floor applied equally to every sponsor**, not a premium benefit. Below two
seconds an appearance is too brief for a human eye to register a brand, so no appearance is allowed
to fall below it. Nobody can purchase a longer one.

---

## Surface Rendering Rules

**One rule governs every surface: within a region, all sponsors render identically.** Regions may
differ from one another — a header band logo may be a different height from a rail logo — but two
sponsors in the same region are indistinguishable by treatment, regardless of spend.

### Display (TV/Kiosk)

| Region                           | Element       | Who appears     | Size                  |
| -------------------------------- | ------------- | --------------- | --------------------- |
| **Header band** (`.sponsor-top`) | header strip  | **all classes** | uniform within region |
| **Side rail** (`#sponsorSide`)   | sidebar cards | **all classes** | uniform within region |

- Order comes from `buildShareRotation()` in `sponsor-resolver.ts` and **carries no size, slot or
  position meaning** — it is a rotation sequence, nothing more.
- The band and the rail are two independent rotations over the same covenant-share-ordered list.
- No tier badge. No primary-sponsor treatment. No per-class region assignment.
- Every surface currently has `cap: null` in `sponsor-allocation.yaml` — all opted-in sponsors
  render, so surfaces must handle unbounded N. When a cap is introduced, `slot_floor` reserves
  `local_floor: 2` for the TV sidebar specifically.

**Pane rotation** (`public`, `schedule`, `standings`, `sponsors`, `custom`) is a property of the
_pane_, not of any sponsor. Default interval 5000ms. There is no per-sponsor dwell override.

### Poster / Tabletop

- **Physical:** 1 sponsor per physical ad slot. The main sponsor pays for the printed artifact.
- **Digital:** rotates through the pool by covenant share.

### Public (Mobile)

- All classes appear in the sidebar, rendered identically
- Sponsor strip scrolls horizontally on mobile
- No tier badge

### SharedReports

**Report depth is the second purchasable dimension under #25.** Depth is scoped to the token and
enforced server-side — see ADR-0001 and OSE-816.

All classes receive anonymous behavioural data; the class determines how much detail:

- QR trigger counts on ads
- Screen-time signal from rotation appearances
- Event registration signal

> **Lexicon note:** the words _impressions_, _unique_, _reach_, _attendance_, _visits_, _turnout_,
> _eyeballs_ and _people_ are banned catalogue-wide and must not appear in sponsor-facing copy,
> field names, or report headers. Use _appearances_, _scan counts_, _distinct agent hashes_.

---

## The Sponsor Pool

The total number of sponsors in the pool is the natural governor of the marketplace. More sponsors
means each gets a smaller share of rotation. The pricing tiers buy a larger share of that rotation.

The pool is self-governing:

- A crowded pool means each sponsor gets less absolute time but the event is more popular
- A sparse pool means each sponsor gets more time but the event is smaller
- The walls ensure local sponsors always hold at least 30% collectively, regardless of pool size

**A note on what the ratio does and does not guarantee.** The 7:1 ratio holds at every pool size,
but the _absolute_ number of appearances a premium sponsor receives falls as the pool grows. Ratio
is guaranteed; absolute rate is not. If premium is ever sold on an appearances-per-hour basis rather
than a share basis, that number must be stated as a floor and the pool capped to honour it.

---

## Event Type Phases & Regulatory Gates

Sponsor pricing and package structure varies by event type. Event types progress through 5 phases of
regulatory clearance:

| Phase       | Regulatory Level | Event Types                                      | Sponsor Implications                 |
| ----------- | ---------------- | ------------------------------------------------ | ------------------------------------ |
| **Phase 1** | Standard         | Community gatherings, trivia nights, open tables | Standard sponsor packages            |
| **Phase 2** | Youth sports     | Recreational leagues with minors                 | COPPA compliance on data collection  |
| **Phase 3** | Health/wellness  | Fitness events, health screenings                | HIPAA considerations for health data |
| **Phase 4** | Licensed venues  | Events at bars, restaurants                      | Alcohol advertising restrictions     |
| **Phase 5** | Full regulatory  | Government-partnered, public safety events       | Full compliance stack                |

**The anonymous-ID-first architecture is designed for this.** Because the scan system collects zero
PII, the regulatory burden is significantly lighter at every phase. There is no personal data to
protect under HIPAA or COPPA — only anonymous presence signal.

Planning: **47 event types at launch, scaling to 180 by 2028.**

---

## QR Click Playback (Rebuild Needed)

> **Status:** Concept validated, implementation lost in laptop crash. Needs rebuild.

The selling point: ability to replay QR scan activity on poster/tabletop placements over the days
leading up to an event. Shows sponsors:

- Which physical placements generated the most scans
- When during the day scans peaked
- How scan activity built over time pre-event
- Activity patterns during the event itself

---

## Change log

**17 Aug 2026 — OSE-809.** Reconciled to Invariant #25 (`sponsor_share_covenant`, status `live`) and
`sponsor-allocation.yaml`. Removed nine claims that sold what #25 forbids: per-class placement
tables (Display and Public), the 1.6x/1.4x primary badge, per-class `dwellMs` overrides, "more dwell
time" for premium, tier badges, and package slot counts. Corrected the SharedReports section, which
had stated all classes receive identical depth — report depth is the second purchasable dimension
under #25. Replaced banned lexicon terms. Added the three walls, which the document had never
stated. The multipliers themselves were already correct as of COST-111 (OSE-773).
