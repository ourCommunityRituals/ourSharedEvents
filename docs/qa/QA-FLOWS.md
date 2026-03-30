# QA Critical Flows

**Story Card:** ZEVENT-005 – Architect + QA mini-audit
**Last Updated:** 2025-11-23
**Status:** MVP Focus Group Ready

---

## Overview

This document defines the critical test flows for MVP validation. These flows represent the core user journeys that must work for the focus group.

---

## Flow 1: Event Lifecycle (Create → Admin → Sign Up → Poster → Public → Display)

**Goal:** Verify an event created in Admin flows through the realistic user journey: create, configure signup, print poster for promotion, view public page, then display at venue.

### Preconditions

- [ ] Brand is configured in `Config.gs` with valid `brandId`
- [ ] At least one template exists (e.g., `bar_night`, `rec_league`, `custom`)
- [ ] Admin has valid `adminKey` for the brand
- [ ] Web app is deployed and accessible
- [ ] Google Forms API permissions granted (for signup form)

### Steps

1. **Open Admin.html**
   - Navigate to: `?page=admin&brand={brandId}`
   - Verify: Create Event form is displayed

2. **Create Event**
   - Fill required fields:
     - Event Name: "Test Event QA-001"
     - Date/Time: Tomorrow at 7:00 PM
     - Venue: "Test Venue"
   - Select a template (e.g., `bar_night`)
   - Click "Create Event"
   - Verify: Event card appears with generated links

3. **Generate Sign Up Form**
   - In Admin, scroll to "Registration" section
   - Click "Generate Registration Form"
   - Verify: Shortlink is generated
   - Verify: "Edit Form" and "View Responses" links appear
   - Copy the shortlink for later testing

4. **Open Poster.html** (for printing/promotion)
   - From Admin, click "Poster" link
   - Verify: URL contains `?page=poster&brand={brandId}&id={eventId}`
   - Verify:
     - Event name, date, venue display
     - QR codes render (public page QR, signup QR if configured)
     - Print button is functional
   - Print or save as PDF for distribution

5. **Open Public.html** (user-facing event page)
   - Scan the QR code from poster OR click "Public Page" link
   - Verify: URL contains `?page=events&brand={brandId}&id={eventId}`
   - Verify:
     - Event name displays: "Test Event QA-001"
     - Date/time displays correctly (formatted)
     - Venue displays: "Test Venue"
     - Signup CTA is visible (links to form shortlink)
     - No error states shown

6. **Open Display.html** (at venue on TV)
   - From Admin, click "TV Display" link
   - Verify: URL contains `?page=display&brand={brandId}&id={eventId}&tv=1`
   - Verify:
     - Event info displays in TV-optimized layout
     - Public page is embedded in iframe
     - Sponsor strip displays (if sponsors configured)
     - No error states shown

### Expected Result

- Event created once in Admin appears consistently across all surfaces
- Sign Up form is generated with trackable shortlink
- Poster is print-ready with scannable QR codes
- Public page shows event details and signup CTA
- Display shows TV-optimized view with sponsor rotation
- All surfaces use `event.links.*` from canonical Event (no hardcoded URLs)

### Code References

| Step | File | Line |
|------|------|------|
| Create Event RPC | `Admin.html` | 1020 |
| Show Event Card | `Admin.html` | 1044 |
| Generate Form RPC | `Admin.html` | 1361 |
| Generate Shortlink | `Admin.html` | 1378 |
| Poster render | `Poster.html` | 602 |
| Public render | `Public.html` | 1854 |
| Display boot | `Display.html` | 680 |

---

## Flow 2: Form Generation & Signup Tracking

**Goal:** Verify forms can be generated and signups are trackable.

### Preconditions

- [ ] Event exists (from Flow 1)
- [ ] Event is selected in Admin.html
- [ ] Google Forms API permissions granted to script

### Steps

1. **Open Admin.html with existing event**
   - Navigate to: `?page=admin&brand={brandId}&id={eventId}`
   - Verify: Event card is loaded with existing data

2. **Generate Registration Form**
   - Scroll to "Registration" section
   - Click "Generate Registration Form"
   - Wait for form creation (loading overlay)
   - Verify:
     - Shortlink is generated
     - "Edit Form" link appears
     - "View Responses" link appears

3. **Copy Shortlink**
   - Click "Copy Shortlink" button
   - Verify: URL is copied to clipboard
   - Verify: URL format is trackable shortlink (contains token)

4. **Open Form (simulated signup)**
   - Open shortlink in new incognito tab
   - Verify: Google Form loads with event name in title
   - Fill form and submit (test data)

5. **Verify Signup Counted**
   - Return to Admin.html
   - Click "View Responses" link
   - Verify: Response sheet shows the test submission

### Expected Result

- Form is created with event-specific title
- Shortlink redirects to form correctly
- Responses are captured in linked Google Sheet
- Form URL uses shortlink for tracking (not raw Google Forms URL)

### Code References

| Step | File | Line |
|------|------|------|
| Generate Form RPC | `Admin.html` | 1361 |
| Generate Shortlink RPC | `Admin.html` | 1378 |
| Form creation backend | `Code.gs` | 4766 |
| Shortlink creation | `Code.gs` | 4709 |

### Notes

- Form responses are stored in Google Sheets (linked from form)
- Signup counts require manual check of response sheet (MVP)
- Future: Automated response count in Admin dashboard

---

## Flow 3: Sponsor Visibility & Analytics

**Goal:** Verify sponsors display on surfaces and impressions/clicks are logged.

### Preconditions

- [ ] Event exists with sponsors configured
- [ ] Sponsor has: `id`, `name`, `logoUrl`, `linkUrl`
- [ ] Sponsor placements configured (e.g., `public`, `display`, `poster`)
- [ ] ANALYTICS sheet exists in brand spreadsheet

### Steps

1. **Configure Sponsor in Event Data**
   - Event must have sponsors array in data:
     ```json
     {
       "sponsors": [
         {
           "id": "sponsor-001",
           "name": "Test Sponsor",
           "logoUrl": "https://example.com/logo.png",
           "linkUrl": "https://example.com",
           "placements": { "public": true, "display": true }
         }
       ]
     }
     ```
   - Save event via Admin

2. **Open Public.html**
   - Navigate to event's public page
   - Verify: Sponsor logo/banner displays
   - Verify: Console shows `logEvent` call with:
     - `surface: 'public'`
     - `metric: 'impression'`
     - `sponsorId: 'sponsor-001'`

3. **Click Sponsor Link**
   - Click on sponsor logo/link
   - Verify: Redirects to sponsor's `linkUrl`
   - Verify: Console shows `logEvent` call with:
     - `surface: 'public'`
     - `metric: 'click'`
     - `sponsorId: 'sponsor-001'`

4. **Open Display.html**
   - Navigate to event's display page
   - Verify: Sponsor displays in TV banner/strip
   - Verify: Impression logged for display surface

5. **Open Poster.html**
   - Navigate to event's poster page
   - Verify: Sponsor logo displays (if placement includes poster)

6. **Verify Analytics Logged**
   - Open brand's spreadsheet
   - Navigate to ANALYTICS sheet
   - Verify: Rows exist with:
     - `eventId` matching test event
     - `sponsorId: 'sponsor-001'`
     - `metric: 'impression'` and `metric: 'click'`
     - `surface` values match where viewed

### Expected Result

- Sponsors render on all configured surfaces
- Impressions logged when sponsor becomes visible
- Clicks logged when sponsor link is clicked
- All analytics rows contain proper attribution fields

### Code References

| Step | File | Line |
|------|------|------|
| Sponsor render (Public) | `Public.html` | 1192-1276 |
| Sponsor render (Display) | `Display.html` | 713-719 |
| logEvent function | `SponsorUtils.html` | 65 |
| Flush to backend | `SponsorUtils.html` | 75-80 |
| Backend log handler | `Code.gs` | (api_logEvents) |

### Notes

- Analytics use batched logging (flush every 5 seconds or on page unload)
- Impressions are logged once per page load (not per rotation)
- Click tracking uses fire-and-forget pattern (no blocking)

---

## Flow 4: Error Handling (Invalid Event ID)

**Goal:** Verify graceful error states when event doesn't exist.

### Preconditions

- [ ] Web app is deployed
- [ ] No event exists with ID "nonexistent-id-12345"

### Steps

1. **Open Public.html with bad ID**
   - Navigate to: `?page=events&brand={brandId}&id=nonexistent-id-12345`
   - Verify:
     - "Event Not Found" message displays
     - Message text: "This event link may be outdated or incorrect."
     - "View All Events" button is shown
     - No JavaScript errors in console

2. **Open Display.html with bad ID**
   - Navigate to: `?page=display&brand={brandId}&id=nonexistent-id-12345&tv=1`
   - Verify:
     - Falls back to public mode (iframe loads event list)
     - OR shows TV-themed error state
     - No JavaScript errors in console

3. **Open Poster.html with bad ID**
   - Navigate to: `?page=poster&brand={brandId}&id=nonexistent-id-12345`
   - Verify:
     - "Trouble Loading" error state displays
     - Retry button is shown
     - No JavaScript errors in console

4. **Open Admin.html with bad ID**
   - Navigate to: `?page=admin&brand={brandId}&id=nonexistent-id-12345`
   - Verify:
     - Error message or empty state displays
     - Create form is still accessible
     - No JavaScript errors in console

### Expected Result

- All surfaces handle missing events gracefully
- User sees helpful error message, not blank page or stack trace
- Navigation options are provided to recover

### Code References

| Step | File | Line |
|------|------|------|
| Public error state | `Public.html` | 1820-1836 |
| Display fallback | `Display.html` | 681, 685 |
| Poster error state | `Poster.html` | 611-618 |

---

## Quick Checklist

Use this for rapid smoke testing:

### Event Lifecycle (in order)
- [ ] Admin: Create event with name, date, venue
- [ ] Admin: Event card shows with 3 links (Public, Display, Poster)
- [ ] Admin: Generate registration form → shortlink created
- [ ] Poster: Print view renders with QR codes (public + signup)
- [ ] Public: Event displays correctly, signup CTA visible
- [ ] Display: TV mode loads with event + sponsor strip

### Forms
- [ ] Form: Opens from shortlink
- [ ] Form: Accepts test submission
- [ ] Responses: Submission appears in response sheet

### Sponsors
- [ ] Public: Sponsor banner/logo displays
- [ ] Display: Sponsor strip displays
- [ ] Analytics: Impressions logged in sheet
- [ ] Analytics: Clicks logged when sponsor clicked

### Error Handling
- [ ] Public: "Not Found" for bad event ID
- [ ] Display: Fallback mode for bad event ID
- [ ] Poster: Error state for bad event ID

---

## Test Data Templates

### Minimal Valid Event

```json
{
  "name": "QA Test Event",
  "startDateISO": "2025-01-15T19:00:00Z",
  "venue": "Test Venue, 123 Main St",
  "signupUrl": "https://example.com/signup"
}
```

### Event with Sponsor

```json
{
  "name": "QA Sponsor Test",
  "startDateISO": "2025-01-15T19:00:00Z",
  "venue": "Sponsor Test Venue",
  "sponsors": [
    {
      "id": "qa-sponsor-001",
      "name": "QA Test Sponsor",
      "logoUrl": "https://via.placeholder.com/200x100?text=Sponsor",
      "linkUrl": "https://example.com/sponsor",
      "placements": {
        "public": true,
        "display": true,
        "poster": true
      }
    }
  ],
  "settings": {
    "showSponsors": true
  }
}
```

---

## Future Automation Notes

These flows are designed to be automatable with:

- **Playwright/Puppeteer**: For UI flows (create, view, click)
- **Apps Script Test Runner**: For backend API tests
- **Sheet Assertions**: For analytics verification

Priority for automation:
1. Flow 1 (Event Lifecycle) - Most critical path
2. Flow 4 (Error Handling) - Regression prevention
3. Flow 3 (Sponsor Analytics) - Revenue-critical
4. Flow 2 (Form Generation) - Depends on Google Forms API

---

## Sign-Off

- [x] Flow 1 walked through and verified in code
- [x] Flow 2 walked through and verified in code
- [x] Flow 3 walked through and verified in code
- [x] Flow 4 walked through and verified in code
- [x] All flows documented with preconditions, steps, expected results

**Author:** Claude Code
**Date:** 2025-11-23
