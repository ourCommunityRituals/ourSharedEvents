# Platform Vision

> The foundational philosophy that drives every design decision.
> Every feature doc, architecture choice, and privacy policy traces back to this page.

---

## The Mission

**Serve the hyperlocal economy through event automation — making every community gathering, public or private, an opportunity for local businesses to compete fairly in a real-signal marketplace.**

---

## Three Principles

### 1. Anonymous ID First — Presence, Not Identity

The platform does not collect personal information. By design.

What the system captures is **signal of presence** — that someone was there, that they scanned a QR code, that they engaged with a sponsor's placement. What it does NOT capture is who they are.

```
What we store:                     What we never store:
─────────────────                  ──────────────────────
scan_bucket (hourly window)        exact timestamps
user_agent_hash (device class)     IP addresses
(no location, OSE-1460)            names, emails (raw)
poster_deployment_id               individual tracking
aggregate counts                   behavioral profiles
```

**Why this matters for customers:** You can scan any QR code at any event knowing that no personal data is being collected. Your email, if you voluntarily provide one, is immediately hashed or encrypted and auto-deleted on a schedule. Your presence is counted. Your identity is not.

**Why this matters for sponsors:** The data you receive is honest. It's aggregate signal — how many people engaged with your placement, when during the event, from what region. It's not inflated by bots, not enriched with purchased data, not tracking individuals across events. It's real presence at real events.

**Why this matters for the platform:** By removing PII from the data layer by design, the platform can scale across thousands of events without becoming a surveillance system. The `scans` table schema enforces this at the database level — there is no column for email, name, or IP address. This isn't a policy. It's architecture.

---

### 2. Fair Marketplace — Every Local Sponsor Has a Seat

The platform exists to serve the hyperlocal economy. A neighborhood bar sponsoring trivia night deserves the same quality of event infrastructure as a national franchise buying premium placement.

```
Nicky's Pub (Free)          American Bocce Co. (Mid)      National League Corp (Enterprise)
─────────────────           ────────────────────          ────────────────────────────────
Same QR system              Same QR system                Same QR system
Same form quality           Same form quality             Same form quality
Same mobile UX              Same mobile UX                Same mobile UX
Same privacy protection     Same privacy protection       Same privacy protection
Same real-time counts       Same real-time counts         Same real-time counts
                            + surveys, email signup        + white-label, custom domain
                            + shared reports               + portfolio reports
                            + own brand namespace          + per-event overrides
```

**The core experience is the same at every tier.** A customer scanning a QR code at Nicky's Pub gets the same 10-second mobile form, the same privacy protection, the same instant confirmation as one at a national franchise event. The tiers unlock operational tools (analytics, branding, config) — they don't create a better customer experience for premium sponsors.

**This is deliberate.** The local bar gets real signal — "42 people checked in tonight" — without needing Enterprise pricing. The marketplace works when all participants get honest data from the same infrastructure.

**Sponsor pricing tiers** (title, platinum, gold, silver, bronze, primary) determine **display priority within an event** — where and how prominently a sponsor's logo appears. They do NOT gate access to the platform, the QR system, or the analytics. A bronze sponsor gets the same anonymous signal data as a title sponsor. Monetization hooks track billable units (QR scans, impressions, event count) per sponsor, preparing for future pricing without coupling billing logic to product logic. See [SPONSORS.md](SPONSORS.md) for the full governance model.

---

### 3. Event Automation — Volume Creates the Signal

The platform's value compounds with event density. One event gives you counts. A hundred events across a neighborhood gives you a hyperlocal economic picture.

**The event lifecycle creates natural engagement windows:**

```
PRE-EVENT (Incubation)          EVENT (Engagement)           POST-EVENT (Analytics)
──────────────────────          ──────────────────           ─────────────────────
Registration opens              Check-in at door             Survey collection
Audience builds organically     Sponsor QR engagement        Email signup
Poster/QR distribution          Gamification touchpoints     Shared report generation
Word of mouth amplification     Real-time presence signal    Attribution analysis
```

Each phase generates different signal. Pre-event shows demand. During-event shows engagement. Post-event shows satisfaction. Across enough events, the pattern reveals which venues, which sponsors, which event types drive the most community engagement.

---

## The UEC System — Universal Event Code

OurSharedEvents uses a color-based semantic standard for QR codes: the **Universal Event Code (UEC)**. Seven colors. One meaning each. No instructions required. The color tells you what the code does before you scan it.

### 7 Core Codes

| #   | Color        | Code     | What It Does                                  | Phase   |
| --- | ------------ | -------- | --------------------------------------------- | ------- |
| 01  | **Green**    | ENTER    | Venue entry, gate access, check-in            | Arrival |
| 02  | **Coral**    | LIVE     | Real-time scoring, brackets, live feed        | During  |
| 03  | **Blue**     | SPONSOR  | Sponsor offers, brand activation, local deals | During  |
| 04  | **Purple**   | ARCHIVE  | Past results, SharedReport, memories          | Post    |
| 05  | **Pink**     | HELP     | ADA assistance, first aid, accessibility      | Anytime |
| 06  | **Amber**    | FEEDBACK | Surveys, ratings, post-event voice            | Post    |
| 07  | **Charcoal** | UTILITY  | WiFi, schedule, maps, general info            | Anytime |

### 4 Extensions

| Color         | Code     | What It Does                             | Priority |
| ------------- | -------- | ---------------------------------------- | -------- |
| **Yellow**    | ALERT    | Safety notices, weather, emergencies     | HIGH     |
| **Red**       | STAFF    | Staff-only, admin tools, backstage       | HIGH     |
| **Teal**      | CHECK-IN | Attendance tracking, roster verification | MEDIUM   |
| **Dark Teal** | SHOP     | Merchandise, concessions, silent auction | MEDIUM   |

### How It Works Physically

```
Poster at venue entrance     Table tent at sponsor table     Display screen at exit
┌─────────────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
│                     │     │                         │     │                      │
│  [Event Name]       │     │  [Sponsor Logo]         │     │  How was tonight?    │
│                     │     │                         │     │                      │
│  ┌───┐  GREEN       │     │  ┌───┐  BLUE            │     │  ┌───┐  AMBER        │
│  │ ■ │  ENTER       │     │  │ ■ │  SPONSOR         │     │  │ ■ │  FEEDBACK     │
│  └───┘              │     │  └───┘                  │     │  └───┘               │
│                     │     │                         │     │                      │
│  ┌───┐  CORAL       │     │  ┌───┐  TEAL            │     │  ┌───┐  PURPLE       │
│  │ ■ │  LIVE        │     │  │ ■ │  SHOP            │     │  │ ■ │  ARCHIVE      │
│  └───┘              │     │  └───┘                  │     │  └───┘               │
│                     │     │                         │     │                      │
└─────────────────────┘     └─────────────────────────┘     └──────────────────────┘
```

The color IS the instruction. An attendee sees green and knows it's entry. Sees blue and knows it's a sponsor. No training, no legend, no explanation needed.

Every scan is tracked anonymously via the `scans` table — `poster_deployment_id` links to the physical placement (with lat/lng), `scan_bucket` records the time window, and `user_agent_hash` indicates device class. No personal data. Just presence signal.

See [UEC-CODES.md](UEC-CODES.md) for the complete UEC v1.1 specification: color psychology, contrast audits, deployment checklist, and the full 7+4 code system.

---

## The NCR Horizon — Geo-Spatial Intelligence

Once enough event data accumulates across enough venues and neighborhoods, the platform transitions from event automation to **community intelligence**.

**NCR** (Neighborhood Community Rituals) methodology:

```
Phase 1: Event Automation (now)
    Thousands of events → anonymous scan data → per-event analytics

Phase 2: Pattern Recognition (next)
    Cross-event aggregation → which venues, times, sponsors perform
    Scan density maps → where community engagement concentrates

Phase 3: Geo-Spatial Intelligence (horizon)
    AI processing of scan_aggregate + poster_deployment (lat/lng) data
    Hyperlocal economic mapping → "this block has 3x engagement on Thursdays"
    Community planning signal → where to invest, where events thrive
    Real signal for: urban planning, local business development, sponsor ROI
```

**The data model is already built for this.** The `poster_deployments` table stores `latitude` and `longitude`. The `scan_aggregates` table rolls up by `bucket_date` and `bucket_hour`. The `sponsors` table tracks `click_token` and `display_token`. When event density is high enough, these tables become a geo-spatial dataset of hyperlocal economic activity — all built from anonymous presence signal.

**Future audiences** that this unlocks:

| Audience            | What They Get                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| **Government**      | Venue utilization data, public event density, community gathering patterns |
| **Policy**          | Evidence-based community investment signals, engagement equity metrics     |
| **Public Services** | Library/community center event performance, nonprofit event analytics      |
| **Researchers**     | Anonymized community engagement datasets, neighborhood economic indicators |

---

## How This Connects to Everything Else

| Principle           | Where It Lives in the Platform                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Anonymous ID first  | `scans` table schema (no PII columns), forms PII lifecycle (hash/encrypt/delete)                   |
| Fair marketplace    | Same form UX at all tiers, Sponsor Pricing Tier Balancer, tiered ops tools not customer experience |
| UEC system          | 7 core codes + 4 extensions, color-semantic QR standard across all event types                     |
| Event automation    | 4 form types × UEC codes × 3 event phases                                                          |
| Presence signal     | `scan_bucket`, `user_agent_hash`, `poster_deployment_id` with lat/lng                              |
| Geo-spatial horizon | `poster_deployments` (lat/lng) + `scan_aggregates` (time bucketed)                                 |

**Read next:**

- [PRIVACY.md](PRIVACY.md) — how anonymous-ID-first is implemented technically
- [SPONSORS.md](SPONSORS.md) — how the fair marketplace works for sponsors
- [TIERS.md](TIERS.md) — what each tier unlocks (ops tools, not customer experience)
- [QR-ROUTING.md](QR-ROUTING.md) — the QR code interaction framework
- [FORMS.md](FORMS.md) — the 4 form types that power event engagement
