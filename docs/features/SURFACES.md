# MVP Surfaces

> The 5 pages that make up the product + the landing page.
> Each surface is a self-contained HTML page embedded in the Cloudflare Worker.

---

## Surface Map

| #   | Surface             | URL             | Purpose                        | Audience    |
| --- | ------------------- | --------------- | ------------------------------ | ----------- |
| 1   | **Landing**         | `/`             | Marketing + email capture      | Visitors    |
| 2   | **Public Events**   | `/events`       | Browse upcoming events         | Attendees   |
| 3   | **Admin Dashboard** | `/admin`        | Event management + form data   | Organizers  |
| 4   | **Display**         | `/display`      | TV/kiosk live event view       | Venue staff |
| 5   | **Poster**          | `/poster`       | Printable poster with QR codes | Print       |
| 6   | **Shared Report**   | `/sharedReport` | Analytics for sponsors         | Sponsors    |

---

## 1. Landing Page (`/`)

**What it does:** First impression. Explains the platform and captures email signups.

**User experience:**

- Hero section: "Gather with your neighborhood on Chicago's Southside"
- Email signup form with inline validation and rate limiting
- Three feature cards: Shared Events, Local Sponsors, Community First
- Navigation links to Events and Admin

**Accessible at:** `/`, `/home`, `/welcome`, `/landing`

**Email capture:**

- Validates email format client-side before submission
- Server-side validation: format, max 254 chars, non-empty
- Rate limited: 10 requests per IP per minute (in-memory sliding window)
- Persists to D1 `subscribers` table (best-effort if DB available)
- Duplicate emails silently accepted (ON CONFLICT DO NOTHING)

---

## 2. Public Events Page (`/events`)

**What it does:** Shows upcoming events in a clean card layout.

**User experience:**

- Event cards with name, date, and venue
- Cards sorted by start date (newest first)
- Only active events shown (archived events hidden)
- Filtered by brand (default: `root`)

**Data flow:**

- Page loads → JS fetches `/api/v2/events`
- Events rendered as cards with left-border accent
- Loading state: "Loading events..." spinner text
- Empty state: "No events scheduled."
- Error state: "Could not load events. Please try again."

**Also accessible at:** `/public`

---

## 3. Admin Dashboard (`/admin`)

**What it does:** Event management control room. View all events, manage forms, see counts.

**Access:** Requires authentication (Cloudflare Access JWT or Bearer token).

**User experience:**

- Table of all events (including archived) with ID, name, date, venue, status
- Status badges: green "active" / gray "archived"
- Click any event row → loads forms management panel below

**Forms Management (Card 2):**
When an event is selected, the forms panel shows:

- **Form links:** 4 clickable cards (Registration, Check-in, Survey, Email List) that open the form page in a new tab
- **Live counts:** 4 count boxes showing current registrations, check-ins, surveys, and emails for the selected event

**Data flow:**

- Page loads → JS fetches `/api/v2/admin/events` (with auth)
- Event click → JS fetches 4 admin form count endpoints in parallel
- All counts update instantly on event selection

---

## 4. Display Surface (`/display`)

**Live** (aliases `/tv`, `/kiosk`, `/screen`; template `display.html`): TV/kiosk-optimized view for live events. Large fonts, auto-refresh, designed for wall-mounted screens at venues.

---

## 5. Poster Surface (`/poster`)

**Live** (aliases `/posters`, `/flyers`, `/tabletop`, `/tent`, `/signage`; template `poster.html`; data from `/api/v2/events/:id/poster-bundle`): Print-optimized page with QR codes for each form type. Designed for physical posters, table tents, and handouts.

---

## 6. Shared Report (`/sharedReport`)

**Live** (aliases `/report`, `/analytics`, `/reports`, `/insights`, `/stats`; template `shared-report.html`; read API `GET /api/v2/events/:id/shared-report` with signed-link auth, depth enforced server-side per OSE-816): Analytics dashboard shareable with sponsors. Shows event metrics, form submission rates, and engagement data. Tier-gated: basic view (Mid), advanced metrics + PDF export (Mid), portfolio view (Enterprise).

---

## Design System

All surfaces share:

| Property          | Value                                  |
| ----------------- | -------------------------------------- |
| Font              | `system-ui, -apple-system, sans-serif` |
| Background        | `#f8f9fa`                              |
| Text              | `#212529`                              |
| Header background | `#1a1a2e`                              |
| Accent            | `#4361ee`                              |
| Success           | `#2f9e44`                              |
| Error             | `#e03131`                              |
| Muted text        | `#868e96`                              |
| Card radius       | `8px` (surfaces) / `12px` (forms)      |
| Card shadow       | `0 1px 3px rgba(0,0,0,.08)`            |

**Security headers** on all HTML responses:

- Content-Security-Policy with per-request nonce
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Strict-Transport-Security: max-age=31536000
- Referrer-Policy: strict-origin-when-cross-origin
