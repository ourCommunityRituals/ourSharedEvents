# Sponsors

> How sponsors interact with the platform — from a local bar to a national brand.
> Sponsors are the bottom-left vertex of the Triangle: **Events (apex) → Sponsors (bottom-left) → Customers (bottom-right)**, with SharedReports at the center.
> See [VISION.md](VISION.md) for the foundational philosophy.

---

## The Fair Marketplace Principle

**Every local sponsor has a seat at the event.**

A neighborhood bar hosting trivia night gets the same QR system, the same mobile form UX, the same privacy protection, and the same real-time counts as a national franchise. The tiers unlock operational tools (analytics, branding, config) — they never create a better customer experience for premium buyers.

This is how the market gets real signals. When a local bar sees "42 people checked in tonight" from the same infrastructure a national brand uses, both get honest data. The local economy works when all participants compete on the quality of their events, not the size of their tech budget.

---

## What Sponsors Get

Sponsors support community events. In return, they get visibility to attendees and anonymous signal on their impact — never personal data on individual attendees.

### The Sponsor Value Chain

```
Sponsor invests in event
    │
    ├── Placement: logo on poster, QR code at table, link in email
    │
    ├── Attribution: source_placement_id tracks which placement drove which registration
    │
    ├── Analytics: shared report shows engagement, registration counts, check-in numbers
    │
    └── Insight: "My poster at Beverly Park drove 47 registrations this season"
```

---

## Sponsor Tiers by Scale

### Local Venue (Free Tier)

> A neighborhood bar hosting a trivia night or watch party.

**What they get:**

- Events listed on the shared public page
- Registration + check-in forms for their event
- Basic admin dashboard (read-only counts)
- QR code links to share

**What they don't get:**

- Own brand namespace (events live under `root`)
- Analytics reports
- Surveys or email signup
- Custom branding

**Cost:** Free. The platform benefits from more events.

---

### Regional Brand (Mid Tier)

> A league like American Bocce Co. running events across multiple venues.

**What they get:**

- Own brand namespace (`abc`) — isolated events, URLs, admin
- All 4 form types (registration, check-in, survey, email signup)
- Self-serve event configuration
- Shared analytics report to show other sponsors or stakeholders
- Advanced metrics and PDF export
- Brand-specific URLs: `/abc/events`, `/abc/manage`

**What they don't get:**

- White-label (ourSharedEvents branding remains)
- Custom domain
- Custom QR designs
- Per-event feature overrides

**Use case:** ABC runs a spring bocce league with 8 weekly events. They share the analytics report with their venue partner to prove attendance growth.

---

### National Brand (Enterprise Tier)

> A franchise or organization operating across multiple markets.

**What they get:**
Everything in Mid, plus:

- White-label — their brand, not ourSharedEvents
- Custom domain — `events.theirbrand.com`
- Custom color palette — their brand colors
- Custom QR codes with their logo
- File upload — logos, posters, custom assets
- Portfolio reports — aggregated view across all events
- Per-event feature overrides — enable specific features for specific events

**Use case:** A national league operates in 12 cities. Each city's events have custom branding. Corporate sees a portfolio report across all markets. Individual venues get local analytics.

---

## Sponsor Attribution — How It Works

When a customer fills out a form, the system can track which sponsor placement brought them:

### The Flow

1. **Sponsor creates placement** — a QR code, poster, email link
2. **Placement includes tracking** — `sourcePlacementId` parameter in the form URL
3. **Customer scans/clicks** — arrives at the form page
4. **Customer submits** — `source_placement_id` stored with the registration
5. **Admin reviews** — sees which placements drove the most registrations

### Technical Detail

Registration form submissions accept an optional `sourcePlacementId` field:

```json
POST /api/v2/events/bocce-spring/forms/register
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "sourcePlacementId": "abc-poster-beverly-park"
}
```

The `source_placement_id` is stored alongside the registration. Admin list endpoint returns it:

```json
GET /api/v2/admin/events/bocce-spring/forms/registrations
{
  "ok": true,
  "items": [
    {
      "id": "uuid",
      "source_placement_id": "abc-poster-beverly-park",
      "attendee_name": "Jane Smith",
      "attendee_email_hash": "a1b2c3...",
      "registration_bucket": "2026-03-27T14",
      "status": "confirmed"
    }
  ]
}
```

---

## Sponsor Data Model (Phase 2)

The sponsors table connects brands to events with placement tracking:

| Field                 | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| **name**              | Sponsor display name                                         |
| **event_id**          | Which event they sponsor                                     |
| **logo_url**          | Brand logo for display surfaces                              |
| **website_url**       | Link-back URL                                                |
| **tier**              | Sponsor tier within the event (standard, premium, title)     |
| **placement_formats** | JSON: where/how the sponsor appears (poster, table, digital) |
| **click_token**       | Unique click tracking token                                  |
| **display_token**     | Unique impression tracking token                             |

---

## Sponsor Visibility Across Surfaces

| Surface           | How Sponsors Appear                                         | Tier Required |
| ----------------- | ----------------------------------------------------------- | :-----------: |
| **Public page**   | Event cards show event details (sponsor name in event data) |     Free      |
| **Poster**        | Sponsor logo on printed poster                              |      Mid      |
| **Display**       | Sponsor logo on TV/kiosk during event                       |      Mid      |
| **Shared Report** | Sponsor attribution data in analytics                       |      Mid      |
| **Admin**         | Placement-level registration counts                         |     Free      |

---

## What Sponsors Cannot See

Privacy boundaries protect attendees:

| Data                             |         Sponsor Access          |
| -------------------------------- | :-----------------------------: |
| Registration count per placement |               Yes               |
| Attendee names                   |         No (admin only)         |
| Attendee emails                  |        Never stored raw         |
| Survey responses                 |  No (admin only, PII-scrubbed)  |
| Email signup list                | No (count only, even for admin) |
| Individual attendee behavior     |          Never tracked          |

---

## Sponsor Pricing Tiers (Governance)

Within a single event, sponsors are ranked by sponsorship tier — this determines display priority across surfaces and placement eligibility:

| Tier         | Display Priority | Typical Sponsor                               |
| ------------ | :--------------: | --------------------------------------------- |
| **Title**    |   1 (highest)    | Headline sponsor — name on the event          |
| **Platinum** |        2         | Major sponsor — logo on all surfaces          |
| **Gold**     |        3         | Supporting sponsor — logo on poster + display |
| **Silver**   |        4         | Contributing sponsor — logo on poster         |
| **Bronze**   |        5         | Community sponsor — name mention              |
| **Primary**  |        6         | Default / untiered sponsor                    |

**Fair marketplace principle:** Tiers determine **display priority within an event**, not access to the platform. A bronze sponsor at Nicky's Pub gets the same QR system, the same anonymous analytics, and the same real-time counts as a title sponsor at a national event. The tier affects where and how prominently their logo appears — not whether they can participate.

### Multi-Placement Configuration

Each sponsor can be placed on multiple surfaces simultaneously:

| Placement      | Surface | Description                  |
| -------------- | ------- | ---------------------------- |
| `posterTop`    | Poster  | Top banner on printed poster |
| `tvTop`        | Display | Top banner on TV/kiosk       |
| `tvSide`       | Display | Side panel on TV/kiosk       |
| `mobileBanner` | Public  | Mobile banner on public page |

### Sponsor Metrics (Computed Server-Side)

All sponsor metrics are aggregated at the backend — the UI never computes these values:

| Metric        | Description                          | Source       |
| ------------- | ------------------------------------ | ------------ |
| `impressions` | Page views where sponsor was visible | Scan system  |
| `scans`       | QR code scans attributed to sponsor  | Scan system  |
| `conversions` | Click-throughs on sponsor links      | Click tokens |

---

## Monetization Readiness (Story F4)

The platform is **pre-revenue by contract**. The one monetization hook that is built is the inert header: the Worker puts `X-Monetization-Inert: true` on every response (`src/index.ts`, `fetch()` wrapper), as machine-readable evidence that no billing logic ran. Nothing bills, charges or processes a payment, and there is no user-visible billing UI.

### Key Invariant

**Monetization hooks are INERT** (Brain Invariant #6). The header is checked by `tests/e2e/0-architecture/monetization-inert.invariant.spec.ts` (in the T0 invariants step) and by `workers/oursharedevents/tests/testid-pyramid.spec.ts`. When actual billing launches, it will be a new layer on top of this.

### Not built: billable-unit endpoints

An earlier version of this page listed three read-only endpoints at `/api/v2/sponsor/:sponsorId/monetization`, `/api/v2/event/:eventId/monetization` and `/api/v2/monetization/inert`. **The router has no such routes and no handler exists** (corrected 2026-10-23 against `workers/oursharedevents/src/router.ts`). They were a design intent for later: billable units would be QR scans attributed to the sponsor, sponsor-visible impressions, and the count of associated events, summed over a rolling 30-day window. Any such endpoint would sit behind the same two-sided consent and under-5 floor rules as every other sponsor count.

---

## Sponsor Contract (Locked)

The sponsor data shape is a **locked contract** (version 1.1.0). Any field removal or type change requires a version bump. This ensures sponsors can trust that their integration won't break:

```json
{
  "sponsorId": "abc-sponsor-1",
  "name": "American Bocce Co.",
  "tier": "gold",
  "events": ["bocce-spring-2026", "bocce-summer-2026"],
  "metrics": {
    "impressions": 1247,
    "scans": 89,
    "conversions": 23
  },
  "logoUrl": "https://...",
  "linkUrl": "https://americanbocce.com",
  "placements": {
    "posterTop": true,
    "tvTop": true,
    "tvSide": false,
    "mobileBanner": true
  }
}
```

---

## Roadmap

| Feature                                 | Status            | Phase   |
| --------------------------------------- | ----------------- | ------- |
| Basic attribution (source_placement_id) | Working           | Phase 1 |
| Sponsor contract domain model           | Working           | Phase 1 |
| Monetization hooks (inert)              | Working           | Phase 1 |
| Sponsor tier normalization              | Working           | Phase 1 |
| Sponsors table in D1                    | Migration written | Phase 2 |
| Sponsor dashboard surface               | Prototyped        | Phase 2 |
| Click/impression tracking               | Schema ready      | Phase 2 |
| Active billing on monetization hooks    | Not started       | Phase 3 |
| Sponsor self-serve portal               | Not started       | Phase 3 |
| Sponsor API (programmatic access)       | Not started       | Phase 3 |
