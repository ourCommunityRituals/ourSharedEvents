# Event Type Framework — ourSharedEvents Platform

> **Purpose**: Comprehensive catalog of every event type the platform can support, organized by phase unlock, category, regulatory/geographic considerations, and seasonal patterns.
> **Lives**: Internal phase planning | AJ demo material | Investor TAM evidence | Phase 4/5 compliance mapping seed
> **Status**: SKELETON — gaps flagged with 🔬 for Research pass

---

## How to Read This Document

- **Phase** = when the platform technically unlocks this event type (infrastructure + features required)
- **Confidence** = how certain the categorization is (✅ High | 🟡 Medium | 🔬 Needs Research)
- **Regulatory** = known licensing, insurance, or permit requirements
- **Seasonal** = peak season pattern (🌸 Spring | ☀️ Summer | 🍂 Fall | ❄️ Winter | 🔄 Year-round)
- **Community Fit** = which community types this serves (Urban | Suburban | Small Town | Rural)

---

## Phase 1 — Google Sheets + Cloudflare Worker

> **What's unlocked**: Basic event CRUD, registration forms, check-in, QR codes, single admin token, sponsor placement, shared reports. No auth beyond Bearer token. No payment processing. No recurring event logic.

### Category 1: Recreational Sports Leagues

The core use case. ourRecNights is the first brand on the platform.

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 1 | Adult rec volleyball league | ✅ | 🔄 Year-round (indoor winter, outdoor summer) | All | Facility rental agreement, liability waiver |
| 2 | Adult rec basketball league | ✅ | ❄️🌸 Fall-Spring (gym availability) | Urban, Suburban | Same |
| 3 | Adult rec kickball league | ✅ | ☀️🍂 Spring-Fall | Suburban, Small Town | Park permit |
| 4 | Adult rec softball league | ✅ | ☀️ Summer | All | Field permit, insurance |
| 5 | Adult rec flag football league | ✅ | 🍂 Fall | Suburban, Urban | Field permit |
| 6 | Adult rec soccer league | ✅ | ☀️🍂 Spring-Fall | All | Field permit |
| 7 | Adult rec dodgeball league | ✅ | 🔄 Year-round (indoor) | Urban, Suburban | Facility rental |
| 8 | Adult rec pickleball league | ✅ | 🔄 Year-round | All | Court reservation |
| 9 | Adult rec bowling league | ✅ | ❄️ Fall-Winter | All | Alley partnership |
| 10 | Adult rec cornhole league | ✅ | ☀️🍂 Summer-Fall | All | Minimal — bar/venue partnership |
| 11 | Adult rec tennis league | ✅ | ☀️ Spring-Summer | Suburban, Urban | Court reservation |
| 12 | Adult rec ultimate frisbee | ✅ | ☀️ Spring-Fall | Urban, Suburban | Field permit |
| 13 | One-night tournament (any sport) | ✅ | 🔄 Year-round | All | Same as league sport |
| 14 | Preseason/skills clinic | ✅ | Varies | All | Instructor liability |

### Category 2: Community Social Events

Low-regulation, high-frequency gathering types. OurOpenTables territory.

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 15 | Community potluck / dinner | ✅ | 🔄 Year-round | All | Venue-dependent; 🔬 cottage food laws vary by state |
| 16 | Open mic night | ✅ | 🔄 Year-round | Urban, Small Town | Venue handles liquor license |
| 17 | Trivia night | ✅ | 🔄 Year-round | All | Venue partnership |
| 18 | Board game night | ✅ | 🔄 Year-round | All | Minimal |
| 19 | Community movie night | ✅ | ☀️ Summer (outdoor) / ❄️ Winter (indoor) | All | 🔬 Public performance licensing (MPLC/Swank) |
| 20 | Karaoke night | ✅ | 🔄 Year-round | Urban, Suburban | Venue handles licensing |
| 21 | Book club meetup | ✅ | 🔄 Year-round | All | Minimal |
| 22 | Community dance / social dance | ✅ | 🔄 Year-round | All | Venue rental |
| 23 | Networking mixer | ✅ | 🔄 Year-round | Urban, Suburban | Minimal |
| 24 | Speed dating / friend-matching event | 🟡 | 🔄 Year-round | Urban | 🔬 Any state-level event matchmaking regs? |

### Category 3: Fundraisers & Charity Events

Sponsor-heavy — SharedReports prove ROI for sponsors.

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 25 | Charity 5K / fun run | ✅ | ☀️🍂 Spring-Fall | All | Road closure permits, insurance, 🔬 state charitable solicitation registration |
| 26 | Charity auction (silent/live) | ✅ | 🔄 Year-round | All | 🔬 Auctioneer licensing varies by state |
| 27 | Benefit dinner / gala | ✅ | 🔄 Year-round | Suburban, Urban | Venue + catering permits |
| 28 | Charity sports tournament | ✅ | ☀️ Summer | All | Same as rec sports + charitable reg |
| 29 | Raffle / drawing event | 🟡 | 🔄 Year-round | All | 🔬 HIGHLY variable — some states treat as gambling |
| 30 | Bingo night (charity) | 🟡 | 🔄 Year-round | All | 🔬 State gaming commission licensing in many states |

### Category 4: Local Business & Market Events

Sponsor integration is the obvious value — every vendor is a sponsor.

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 31 | Farmers market | ✅ | ☀️🍂 Spring-Fall | All | 🔬 State agricultural dept permits, scales/weights compliance |
| 32 | Pop-up shop / vendor market | ✅ | 🔄 Year-round | Urban, Suburban | Temporary retail permits vary by municipality |
| 33 | Food truck rally | ✅ | ☀️ Summer | Urban, Suburban | 🔬 Mobile food vendor permits (county health dept) |
| 34 | Art walk / gallery night | ✅ | 🔄 Year-round | Urban, Small Town | Minimal — street closure if applicable |
| 35 | Small business expo | ✅ | 🔄 Year-round | All | Venue rental |
| 36 | Job fair | ✅ | 🌸🍂 Spring/Fall | Urban, Suburban | Minimal |

### Category 5: Seasonal & Holiday Events

High visibility, anchor events for communities. Peak sponsor interest.

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 37 | Halloween trunk-or-treat | ✅ | 🍂 October | Suburban, Small Town | Parking lot permit |
| 38 | Holiday tree lighting | ✅ | ❄️ November-December | All | Municipal coordination |
| 39 | Easter egg hunt | ✅ | 🌸 March-April | Suburban, Small Town | Park permit |
| 40 | 4th of July community picnic | ✅ | ☀️ July | All | Park permit, 🔬 fireworks licensing if applicable |
| 41 | Harvest festival / fall fest | ✅ | 🍂 September-October | Small Town, Suburban | Outdoor event permit |
| 42 | New Year's Eve community event | ✅ | ❄️ December | Urban, Suburban | Venue + noise ordinance |
| 43 | Valentine's Day couples event | 🟡 | ❄️ February | Urban | Venue partnership |
| 44 | Community parade (any holiday) | 🟡 | Varies | All | 🔬 Road closure + municipal parade permits — process varies wildly |

### Category 6: Faith & Cultural Community Events

| # | Event Type | Confidence | Seasonal | Community Fit | Regulatory Notes |
|---|-----------|------------|----------|---------------|-----------------|
| 45 | Church/mosque/temple community dinner | ✅ | 🔄 Year-round | All | Minimal — hosted on private property typically |
| 46 | Cultural festival (Diwali, Lunar New Year, Juneteenth, etc.) | ✅ | Varies by tradition | Urban, Suburban | Outdoor event permits, 🔬 cultural sensitivity review needed per type |
| 47 | Interfaith community gathering | 🟡 | 🔄 Year-round | Urban, Suburban | Minimal |

**Phase 1 Total: 47 event types**

---

## Phase 2 — D1 Database (Replace Google Sheets)

> **What's unlocked**: Recurring event series, multi-brand isolation (dual-key pattern), faster queries (<50ms vs 200-800ms), anonymous ID tracking across events, richer sponsor analytics, conversion funnels in SharedReports.

### New event types enabled by Phase 2 infrastructure:

| # | Event Type | Why Phase 2 | Confidence | Seasonal | Regulatory |
|---|-----------|-------------|------------|----------|------------|
| 48 | Recurring weekly league night (auto-series) | Needs series/recurrence in DB | ✅ | 🔄 | Same as base sport |
| 49 | Multi-week workshop series | Series tracking | ✅ | 🔄 | Instructor agreements |
| 50 | Season-long sponsor tracking (cumulative) | Cross-event sponsor analytics | ✅ | 🔄 | Sponsor contracts |
| 51 | Community loyalty program events | Anonymous ID correlation | 🟡 | 🔄 | 🔬 Loyalty program regulations vary |
| 52 | Multi-brand co-hosted event | Brand isolation + dual-key | ✅ | 🔄 | Shared liability agreements |
| 53 | Conference / multi-session event | Session-within-event data model | ✅ | 🔄 | Venue permits |
| 54 | Festival with multiple stages/areas | Needs relational zone model | ✅ | ☀️🍂 | Outdoor event permits, sound |
| 55 | Recurring community meetup (monthly) | Series recurrence | ✅ | 🔄 | Minimal |
| 56 | League playoff bracket | Tournament bracket data model | ✅ | Varies | Same as base sport |
| 57 | Multi-venue pub crawl / event crawl | Multi-location in single event | 🟡 | 🔄 | 🔬 Varies — bar crawl permits in some cities |

**Phase 2 adds: ~10 types (cumulative: ~57)**

---

## Phase 3 — Firebase Auth + React/Tailwind

> **What's unlocked**: Multi-user admin roles, self-service event creation, attendee accounts, RSVP tracking, social features, payment integration possible, real-time updates.

### New event types enabled by Phase 3 infrastructure:

| # | Event Type | Why Phase 3 | Confidence | Seasonal | Regulatory |
|---|-----------|-------------|------------|----------|------------|
| 58 | Ticketed event (paid admission) | Needs payment integration + auth | 🟡 | 🔄 | 🔬 State ticket resale laws, sales tax collection, PCI compliance |
| 59 | Member-only event (gated) | Needs attendee auth | ✅ | 🔄 | Membership agreement |
| 60 | RSVP-limited event (capacity cap) | Needs real-time RSVP with auth | ✅ | 🔄 | Fire code capacity |
| 61 | Volunteer coordination event | Needs role-based attendee accounts | ✅ | 🔄 | 🔬 Volunteer liability, background check requirements for youth-adjacent |
| 62 | Self-service community event (user-created) | Multi-user admin, self-service | ✅ | 🔄 | Platform liability for user-created content |
| 63 | Private / invite-only event | Auth-gated access | ✅ | 🔄 | Minimal |
| 64 | Hybrid virtual + in-person event | Needs streaming integration hooks | 🟡 | 🔄 | 🔬 Virtual event accessibility requirements (ADA) |
| 65 | Co-working / drop-in session | Real-time capacity + auth | 🟡 | 🔄 | Facility agreement |
| 66 | Multi-admin league (delegated roles) | Role-based admin | ✅ | 🔄 | Same as base league |
| 67 | Subscription/season pass event series | Payment + recurring auth | 🟡 | 🔄 | 🔬 Auto-renewal disclosure laws (FTC + state) |

**Phase 3 adds: ~10 types (cumulative: ~67)**

---

## Phase 4 — Health, Wellness & Licensed Events 🔬

> **What's unlocked**: Events requiring professional licensing, health/safety compliance, insurance verification, or regulated activities. THIS ENTIRE PHASE NEEDS HEAVY RESEARCH.

### Category: Fitness & Wellness

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 68 | Community yoga class | 🟡 | 🔄 | 🔬 Instructor certification requirements vary; liability waivers |
| 69 | Group fitness bootcamp | 🟡 | ☀️ Spring-Summer (outdoor) | 🔬 Personal trainer licensing in some states (DC, Louisiana?) |
| 70 | Community 5K training program | 🟡 | 🌸☀️ | 🔬 Coaching liability |
| 71 | Meditation / mindfulness session | 🟡 | 🔄 | Minimal — unless therapeutic claims made |
| 72 | Community health screening | 🔬 | 🔄 | 🔬 HIPAA, state health dept oversight, licensed practitioners required |
| 73 | Blood drive coordination | 🔬 | 🔄 | 🔬 Red Cross/blood bank partnership, FDA regulations |
| 74 | Mental health awareness event | 🔬 | 🔄 | 🔬 Licensed counselor requirements if services provided |
| 75 | Substance-free social event | 🟡 | 🔄 | Minimal |

### Category: Food & Beverage (Licensed)

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 76 | Wine/beer tasting event | 🔬 | 🔄 | 🔬 State liquor licensing — massive variation (ABC laws, wet/dry counties) |
| 77 | Cooking class / community kitchen | 🔬 | 🔄 | 🔬 Commercial kitchen requirements, food handler certification |
| 78 | Homebrewing competition | 🔬 | 🍂 Fall | 🔬 Federal/state homebrew competition laws |
| 79 | Community garden event | 🟡 | ☀️ Spring-Summer | Land use agreements |

### Category: Outdoor & Adventure

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 80 | Community hike / trail event | 🟡 | ☀️🍂 | 🔬 Land management permits (BLM, state parks, national forest) |
| 81 | Fishing tournament | 🔬 | ☀️ Summer | 🔬 State fishing licenses for participants, tournament permits |
| 82 | Camping / outdoor overnight | 🔬 | ☀️ Summer | 🔬 Campground permits, minor supervision ratios if youth |
| 83 | Kayak / canoe community paddle | 🔬 | ☀️ Summer | 🔬 Waterway permits, Coast Guard regs for group events, PFD requirements |
| 84 | Bike ride / community cycling event | 🟡 | ☀️ Spring-Fall | 🔬 Road closure permits, helmet law variations |

**Phase 4 adds: ~17 types (cumulative: ~84)**

---

## Phase 5 — Youth, Education & Specialized Programming 🔬

> **What's unlocked**: Events involving minors, educational programming, specialized insurance, background check integration. HIGHEST REGULATORY BURDEN — NEEDS MOST RESEARCH.

### Category: Youth Sports & Activities

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 85 | Youth rec sports league | 🔬 | Varies | 🔬 Background checks (state-mandated for youth coaches), SafeSport compliance, parental consent, COPPA if digital collection on under-13 |
| 86 | Youth skills clinic | 🔬 | Varies | 🔬 Same as above + instructor certification |
| 87 | Youth esports / gaming tournament | 🔬 | 🔄 | 🔬 COPPA, screen time guidelines, age verification |
| 88 | Summer camp day program | 🔬 | ☀️ Summer | 🔬 State licensing for day camps varies ENORMOUSLY — some states require licensing, some don't |
| 89 | After-school program event | 🔬 | 🍂❄️🌸 School year | 🔬 School district partnership agreements, background checks, facility use |

### Category: Education & Workshops

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 90 | Community education class (adult ed) | 🟡 | 🔄 | 🔬 Continuing education credit requirements if offered |
| 91 | Financial literacy workshop | 🟡 | 🔄 | 🔬 SEC/FINRA if investment advice given |
| 92 | Tech/coding workshop | ✅ | 🔄 | Minimal |
| 93 | Art / craft class | ✅ | 🔄 | Minimal — material safety if youth |
| 94 | Language exchange meetup | ✅ | 🔄 | Minimal |
| 95 | CPR / first aid certification event | 🔬 | 🔄 | 🔬 Certified instructor requirements (AHA, Red Cross), state EMS office |
| 96 | College prep / tutoring event | 🔬 | 🍂🌸 School year | 🔬 If involving minors — background checks, parental consent |

### Category: Civic & Government

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 97 | Town hall / community forum | ✅ | 🔄 | 🔬 Open meeting laws if government-affiliated |
| 98 | Voter registration drive | 🟡 | 🍂 Election season | 🔬 State voter registration volunteer requirements, NVRA compliance |
| 99 | Neighborhood watch meetup | ✅ | 🔄 | Minimal |
| 100 | Community cleanup / service day | ✅ | 🌸☀️ Spring-Summer | 🔬 Municipal coordination, volunteer liability |

### Category: Arts & Performance

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 101 | Community theater production | 🟡 | 🔄 | 🔬 Performance rights licensing (Samuel French, MTI, etc.) |
| 102 | Battle of the bands / music showcase | 🟡 | ☀️ Summer | 🔬 Sound permits, ASCAP/BMI licensing |
| 103 | Poetry slam / spoken word | ✅ | 🔄 | Venue partnership |
| 104 | Community art show / exhibition | ✅ | 🔄 | Minimal |
| 105 | Film festival / screening series | 🔬 | 🔄 | 🔬 Public performance licensing, MPAA ratings if youth |

### Category: Senior & Accessibility-Focused

| # | Event Type | Confidence | Seasonal | Regulatory |
|---|-----------|------------|----------|------------|
| 106 | Senior social / coffee morning | ✅ | 🔄 | Minimal — ADA venue compliance |
| 107 | Adaptive / inclusive sports event | 🟡 | 🔄 | 🔬 ADA compliance, specialized equipment liability |
| 108 | Caregiver support group | 🔬 | 🔄 | 🔬 If therapeutic — licensed facilitator requirements |

**Phase 5 adds: ~24 types (cumulative: ~108)**

---

## Summary by Phase

| Phase | Event Types | Confidence Breakdown | Key Blocker |
|-------|------------|---------------------|-------------|
| **Phase 1** | 47 | 40 ✅ / 5 🟡 / 2 🔬 | None — ship it |
| **Phase 2** | +10 (57) | 6 ✅ / 4 🟡 / 0 🔬 | D1 provisioning |
| **Phase 3** | +10 (67) | 5 ✅ / 4 🟡 / 1 🔬 | Firebase Auth |
| **Phase 4** | +17 (84) | 2 ✅ / 6 🟡 / 9 🔬 | Licensing research |
| **Phase 5** | +24 (108) | 7 ✅ / 3 🟡 / 14 🔬 | Youth compliance research |
| **TOTAL** | **108** | **60 ✅ / 22 🟡 / 26 🔬** | |

---

## Research Gaps — Prioritized for Deep Dive

### Priority 1: High Impact on TAM / Investor Story

| Gap ID | Topic | Why It Matters |
|--------|-------|---------------|
| R-01 | State charitable solicitation registration (50-state) | Every charity 5K, auction, fundraiser needs this |
| R-02 | Raffle/bingo/gaming laws by state | Determines if 2 common event types are viable in each state |
| R-03 | State liquor licensing for tasting events | Wine/beer tastings are high-sponsor-value events |
| R-04 | Youth sports coaching background check requirements (50-state) | Phase 5 youth sports is a massive TAM segment |
| R-05 | COPPA compliance for youth event digital registration | Blocks all youth event types with digital check-in |
| R-06 | Ticketed event sales tax obligations by state | Phase 3 paid events — tax nexus question |

### Priority 2: Medium Impact — Community Type Differentiation

| Gap ID | Topic | Why It Matters |
|--------|-------|---------------|
| R-07 | Cottage food / community kitchen laws by state | OurOpenTables potluck/cooking class viability |
| R-08 | Public performance licensing landscape (MPLC, Swank, ASCAP, BMI) | Movie nights, music events, theater — cost/complexity |
| R-09 | Municipal parade/road closure permit processes (sample 5 cities) | Community parade viability — is it too hard? |
| R-10 | Outdoor event permits — BLM/state parks/national forest | Phase 4 outdoor events on public land |
| R-11 | Summer camp day program licensing (50-state overview) | Phase 5 — some states license, some don't |

### Priority 3: Nice to Have — Seasonal / Geographic Patterns

| Gap ID | Topic | Why It Matters |
|--------|-------|---------------|
| R-12 | Midwest community event seasonal calendar (real-world patterns) | Helps sequence Phase 1 launch timing |
| R-13 | Small town vs urban event type popularity differences | Helps prioritize which 47 to demo first |
| R-14 | Event insurance landscape — general liability cost ranges | Helps sponsors understand platform value |
| R-15 | Volunteer liability / Good Samaritan law coverage by state | Phase 5 volunteer coordination events |

---

## Suggested Research Prompt (for Deep Research Pass)

> See companion file: `RESEARCH-PROMPT-EVENT-FRAMEWORK.md`

---

## Document History

| Date | Action |
|------|--------|
| 2026-03-31 | Skeleton created — 108 event types across 5 phases, 26 research gaps identified |
