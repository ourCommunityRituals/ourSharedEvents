# QR Code Form Routing

> How attendees get from a physical QR code to the right digital form.

---

## How It Works

Every event can generate QR codes that link to form pages. A single URL pattern routes to all 4 form types:

```
https://oursharedevents.com/forms/{eventId}?type={formType}&event={eventName}
```

### URL Parameters

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `type` | `register`, `checkin`, `survey`, `email` | `register` | Which form to show |
| `event` | Any text | "Event" | Event name shown in header (URL-encoded) |

### Examples

| QR Code Purpose | URL |
|----------------|-----|
| Pre-event registration | `/forms/bocce-night-spring-2026?type=register&event=Bocce+Night` |
| Door check-in counter | `/forms/bocce-night-spring-2026?type=checkin&event=Bocce+Night` |
| Post-event survey | `/forms/bocce-night-spring-2026?type=survey&event=Bocce+Night` |
| Email list signup | `/forms/bocce-night-spring-2026?type=email&event=Bocce+Night` |

---

## The QR-to-Form Flow

```
Physical QR Code (poster, table tent, display)
    │
    ▼
Phone camera scans → opens browser
    │
    ▼
GET /forms/:eventId?type=register
    │
    ▼
Worker serves mobile-first HTML form page
    │
    ▼
User fills form → JS fetch() to POST /api/v2/events/:id/forms/:type
    │
    ▼
Success state shown inline (no page reload)
```

## Page Design

Every form page follows the same layout:

```
┌─────────────────────────┐
│   OurSharedEvents       │  ← Dark header with branding
│   [Event Name]          │  ← Event name, prominent
├─────────────────────────┤
│                         │
│   ┌───────────────────┐ │
│   │  Form Card        │ │  ← White card, rounded corners
│   │  [Title]          │ │
│   │  [Fields]         │ │  ← Mobile-optimized inputs
│   │  [Submit Button]  │ │  ← Full-width, 44px+ touch target
│   └───────────────────┘ │
│                         │
└─────────────────────────┘
```

**Design principles:**
- 10-second comprehension: user sees event name, one action, done
- Mobile-first: max-width 480px, system fonts, no external dependencies
- No page reload: form submits via `fetch()`, success shown inline
- Touch-optimized: 44px+ touch targets, no double-tap zoom

## Test IDs for Automation

Every interactive element has a `data-testid` attribute for stable Playwright selectors:

| Element | Test ID |
|---------|---------|
| Form container | `form-register`, `form-checkin`, `form-survey`, `form-email` |
| Error message | `form-error` |
| Success state | `form-success` |
| Header | `form-header` |
| Event name | `form-event-name` |
| Registration name input | `register-name-input` |
| Registration email input | `register-email-input` |
| Registration submit | `register-submit` |
| Check-in button | `checkin-submit` |
| Check-in counter | `checkin-count` |
| Survey rating row | `survey-rating-overall` |
| Survey rating buttons | `survey-rating-1` through `survey-rating-5` |
| Survey comments | `survey-comments-input` |
| Survey submit | `survey-submit` |
| Email input | `email-email-input` |
| Email submit | `email-submit` |

## Feature Flag Gating

Before serving a form submission, the router checks the feature flag for that form type:

| Form Type | Flag Key | Free | Mid | Enterprise |
|-----------|----------|:----:|:---:|:----------:|
| Register | `forms.register` | ON | ON | ON |
| Check-in | `forms.checkin` | ON | ON | ON |
| Survey | `forms.survey` | OFF | ON | ON |
| Email Signup | `forms.email-signup` | OFF | ON | ON |

If a form type is disabled, the API returns `403 FORM_DISABLED`. The form page itself still renders (for now) — the gate is at the API level.

## Admin: Managing QR Links

In the admin dashboard, selecting an event shows Card 2 (Forms Management):
- Links to each form page for the selected event
- Current counts for registrations, check-ins, surveys, and emails
- Links open in new tab — ready to generate QR codes from the URL
