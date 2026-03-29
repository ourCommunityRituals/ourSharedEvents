# Sponsors

> How sponsors interact with the platform — from a local bar to a national brand.
> Sponsors are one vertex of the Triangle: **Events ↔ Sponsors ↔ Customers**.

---

## What Sponsors Get

Sponsors support community events. In return, they get visibility to attendees and data on their impact.

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

| Field | Description |
|-------|-------------|
| **name** | Sponsor display name |
| **event_id** | Which event they sponsor |
| **logo_url** | Brand logo for display surfaces |
| **website_url** | Link-back URL |
| **tier** | Sponsor tier within the event (standard, premium, title) |
| **placement_formats** | JSON: where/how the sponsor appears (poster, table, digital) |
| **click_token** | Unique click tracking token |
| **impression_token** | Unique impression tracking token |

---

## Sponsor Visibility Across Surfaces

| Surface | How Sponsors Appear | Tier Required |
|---------|--------------------|:-------------:|
| **Public page** | Event cards show event details (sponsor name in event data) | Free |
| **Poster** | Sponsor logo on printed poster | Mid |
| **Display** | Sponsor logo on TV/kiosk during event | Mid |
| **Shared Report** | Sponsor attribution data in analytics | Mid |
| **Admin** | Placement-level registration counts | Free |

---

## What Sponsors Cannot See

Privacy boundaries protect attendees:

| Data | Sponsor Access |
|------|:-------------:|
| Registration count per placement | Yes |
| Attendee names | No (admin only) |
| Attendee emails | Never stored raw |
| Survey responses | No (admin only, PII-scrubbed) |
| Email signup list | No (count only, even for admin) |
| Individual attendee behavior | Never tracked |

---

## Roadmap

| Feature | Status | Phase |
|---------|--------|-------|
| Basic attribution (source_placement_id) | Working | Phase 1 |
| Sponsors table in D1 | Migration written | Phase 2 |
| Sponsor dashboard surface | Prototyped | Phase 2 |
| Click/impression tracking | Schema ready | Phase 2 |
| Sponsor self-serve portal | Not started | Phase 3 |
| Sponsor API (programmatic access) | Not started | Phase 3 |
