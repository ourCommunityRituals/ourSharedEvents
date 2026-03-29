# Multi-Brand Isolation

> How ourSharedEvents supports multiple brands/tenants within one platform.
> Brands are the **Sponsor** vertex of the Triangle — they range from a neighborhood bar to a national franchise.

---

## Sponsor Layering

Sponsors are not one-size-fits-all. The platform supports a spectrum of sponsor scale:

```
Local Venue          Regional Brand         National Brand
(neighborhood bar)   (American Bocce Co.)   (franchise / chain)
      │                    │                      │
      ▼                    ▼                      ▼
   Free tier           Mid tier              Enterprise tier
   root brand          own brand_id          white-label + custom domain
   shared events       own event series      per-event flag control
   basic forms         all 4 form types      custom QR + assets
   no analytics        shared reports        portfolio reports
```

### Example Sponsor Profiles

| Sponsor | Scale | Brand ID | Tier | What They Get |
|---------|-------|----------|------|---------------|
| **Nicky's Pub** | Local bar hosting trivia night | `root` | Free | Registration + check-in. Events appear on the shared public page. |
| **American Bocce Co.** | Regional league across 4 venues | `abc` | Mid | Own brand space. All 4 forms. Surveys after matches. Shared report for league sponsors. |
| **OurRecordNights** | Multi-city vinyl listening events | `orn` | Mid | Own brand. Email signup for mailing list. Event analytics for venue partners. |
| **National League Corp** | Franchise operating in 12 markets | `nlc` | Enterprise | White-label. Custom domain `events.nlc.com`. Per-event overrides. Portfolio reports across all markets. Custom QR codes with brand logo. |

---

## How Brands Work

Every event belongs to a **brand**. The default brand is `root`. Other brands are isolated — they only see their own events.

### Brand Filtering

| API | Filter | Behavior |
|-----|--------|----------|
| `GET /api/v2/events` | `?brand=root` (default) | Only root brand events |
| `GET /api/v2/events?brand=abc` | `?brand=abc` | Only ABC brand events |
| `GET /api/v2/admin/events` | `?brand=root` (default) | Admin view, root brand |
| `GET /api/v2/admin/events?brand=abc` | `?brand=abc` | Admin view, ABC brand |

### Data Model

Events have a `brand_id` column (column B in Google Sheets, will be a column in D1):

| Event ID | Brand ID | Name |
|----------|----------|------|
| `bocce-spring` | `root` | Spring Bocce Night |
| `abc-league-1` | `abc` | ABC League Week 1 |
| `orn-vinyl-night` | `orn` | OurRecordNights Vinyl |

### Dual-Key Pattern

In Phase 2 (D1), all queries use dual-key isolation: `WHERE id = ? AND brand_id = ?`. This ensures no cross-brand data leakage even if event IDs collide across brands.

---

## Sponsor Attribution

When a customer interacts with a form, the system tracks which sponsor placement brought them there:

```
Sponsor placement (QR code on poster, link in email)
    │
    ▼
Form page URL: /forms/:eventId?type=register&sourcePlacementId=abc-poster-spring
    │
    ▼
Registration stored with: source_placement_id = "abc-poster-spring"
    │
    ▼
Admin can see which placements drove registrations
```

### Sponsors Table (D1, Phase 2)

| Column | Description |
|--------|-------------|
| `id` | Sponsor ID |
| `event_id` | Which event they sponsor |
| `name` | Sponsor display name |
| `logo_url` | Brand logo |
| `website_url` | Sponsor website |
| `tier` | Sponsor tier (standard, premium, etc.) |
| `placement_formats` | JSON array of display configurations |
| `click_token` | Unique token for click tracking |
| `impression_token` | Unique token for impression tracking |
| `is_active` | Whether the sponsorship is active |

---

## Brand-Specific URLs (Phase 2+)

Friendly URLs support brand-specific paths:

| URL | Maps To |
|-----|---------|
| `/events` | Public events (root brand) |
| `/abc/events` | Public events (ABC brand) |
| `/abc/manage` | Admin for ABC brand |
| `/abc/posters` | Posters for ABC brand |
| `/abc/analytics` | Analytics for ABC brand |

See [`docs/architecture/FRIENDLY_URLS.md`](../architecture/FRIENDLY_URLS.md) for the full URL system.

---

## What Each Tier Unlocks for Sponsors

| Capability | Free | Mid | Enterprise |
|-----------|:----:|:---:|:----------:|
| Events on shared public page | Y | Y | Y |
| Own brand_id namespace | - | Y | Y |
| Brand-specific URLs | - | Y | Y |
| Registration attribution tracking | Y | Y | Y |
| Shared analytics report | - | Y | Y |
| Advanced metrics + PDF export | - | Y | Y |
| Portfolio reports (multi-event) | - | - | Y |
| White-label (remove ourSharedEvents) | - | - | Y |
| Custom domain | - | - | Y |
| Custom color palette | - | - | Y |
| Custom QR codes with logo | - | - | Y |
| Per-event feature overrides | - | - | Y |

See [`TIERS.md`](TIERS.md) for the full 17-flag breakdown.

---

## Current State

| Capability | Status |
|-----------|--------|
| Brand filtering on events API | Working |
| Dual-key isolation in queries | Working (Sheets), Ready (D1) |
| Sponsor attribution (`source_placement_id`) | Working (registration form) |
| Sponsors table (D1) | Migration written, not applied |
| Brand-specific friendly URLs | Designed, not yet routed |
| White-label branding | Flag exists, UI not implemented |
| Custom domains | Flag exists, DNS not configured |
| Custom color palette | Flag exists, CSS not parameterized |
| Sponsor dashboard surface | Prototyped in archive, not in MVP |
