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
country_code, region_code          names, emails (raw)
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

## The 11-QR Standard System

OurSharedEvents has developed a standardized QR interaction framework that spans the entire event lifecycle. Each QR code serves a specific purpose in a specific phase:

### Pre-Event QR Codes

| # | QR Purpose | Phase | What It Does |
|---|-----------|-------|-------------|
| 1 | **Registration** | Pre-event | Attendee signs up for the event |
| 2 | **Event Info** | Pre-event | Links to public event page with details |
| 3 | **Sponsor Intro** | Pre-event | Sponsor placement — "brought to you by" |

### During-Event QR Codes

| # | QR Purpose | Phase | What It Does |
|---|-----------|-------|-------------|
| 4 | **Check-In** | Arrival | Tap-to-count at the door |
| 5 | **Sponsor Funnel** | During | Table-top/poster sponsor engagement — tracks placement interaction |
| 6 | **Gamification** | During | Interactive challenges, scavenger hunts, leaderboards |
| 7 | **Shopping** | During | Sponsor product/service link — direct commerce |
| 8 | **Donations** | During | Community fundraising — direct giving |

### Post-Event QR Codes

| # | QR Purpose | Phase | What It Does |
|---|-----------|-------|-------------|
| 9 | **Survey** | Post-event | Event feedback with 1-5 rating |
| 10 | **Email Signup** | Post-event | Opt-in for future event notifications |
| 11 | **Shared Report** | Post-event | Sponsor/stakeholder analytics dashboard |

### How It Works Physically

```
Poster at venue entrance     Table tent at sponsor table     Display screen at exit
┌─────────────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
│                     │     │                         │     │                      │
│  [Event Name]       │     │  [Sponsor Logo]         │     │  How was tonight?    │
│                     │     │                         │     │                      │
│  ┌───┐  Register    │     │  ┌───┐  Learn More      │     │  ┌───┐  Rate Us      │
│  │QR1│  for event   │     │  │QR5│  from sponsor    │     │  │QR9│  Survey        │
│  └───┘              │     │  └───┘                  │     │  └───┘               │
│                     │     │                         │     │                      │
│  ┌───┐  Check in    │     │  ┌───┐  Special offer   │     │  ┌───┐  Stay in loop │
│  │QR4│  on arrival  │     │  │QR7│  Shop now        │     │  │QR10│ Email signup  │
│  └───┘              │     │  └───┘                  │     │  └───┘               │
│                     │     │                         │     │                      │
└─────────────────────┘     └─────────────────────────┘     └──────────────────────┘
```

Every scan is tracked anonymously via the `scans` table — `poster_deployment_id` links to the physical placement (with lat/lng), `scan_bucket` records the time window, and `user_agent_hash` indicates device class. No personal data. Just presence signal.

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

**The data model is already built for this.** The `poster_deployments` table stores `latitude` and `longitude`. The `scan_aggregates` table rolls up by `bucket_date` and `bucket_hour`. The `sponsors` table tracks `click_token` and `impression_token`. When event density is high enough, these tables become a geo-spatial dataset of hyperlocal economic activity — all built from anonymous presence signal.

**Future audiences** that this unlocks:

| Audience | What They Get |
|----------|--------------|
| **Government** | Venue utilization data, public event density, community gathering patterns |
| **Policy** | Evidence-based community investment signals, engagement equity metrics |
| **Public Services** | Library/community center event performance, nonprofit event analytics |
| **Researchers** | Anonymized community engagement datasets, neighborhood economic indicators |

---

## How This Connects to Everything Else

| Principle | Where It Lives in the Platform |
|-----------|-------------------------------|
| Anonymous ID first | `scans` table schema (no PII columns), forms PII lifecycle (hash/encrypt/delete) |
| Fair marketplace | Same form UX at all tiers, tiered ops tools not customer experience |
| Event automation | 4 form types × 11 QR standard × 3 event phases |
| Presence signal | `scan_bucket`, `user_agent_hash`, `poster_deployment_id` with lat/lng |
| Geo-spatial horizon | `poster_deployments` (lat/lng) + `scan_aggregates` (time bucketed) |

**Read next:**
- [PRIVACY.md](PRIVACY.md) — how anonymous-ID-first is implemented technically
- [SPONSORS.md](SPONSORS.md) — how the fair marketplace works for sponsors
- [TIERS.md](TIERS.md) — what each tier unlocks (ops tools, not customer experience)
- [QR-ROUTING.md](QR-ROUTING.md) — the QR code interaction framework
- [FORMS.md](FORMS.md) — the 4 form types that power event engagement
