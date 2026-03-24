# End-to-End User Flows - Software Tester Documentation

**Purpose:** Document all critical user journeys from end-user perspective
**Priority:** Always think from the user's POV - How does this actually work? How do I actually use this?

---

## User Personas

### Persona 1: Sarah (Event Organizer / Admin)
- **Role:** Marketing coordinator at Chicago Bocce Club
- **Tech Level:** Moderate (comfortable with Google Forms, basic web apps)
- **Goal:** Create and promote upcoming bocce tournament
- **Pain Points:** Limited time, needs simple interface, wants sponsor visibility

### Persona 2: Mike (Event Attendee / Mobile User)
- **Role:** Bocce enthusiast, frequent tournament participant
- **Tech Level:** Basic (smartphone user, not tech-savvy)
- **Goal:** Find event details, register quickly
- **Pain Points:** Small screen, bad WiFi at venues, needs quick access

### Persona 3: Venue (TV Display / Passive Viewer)
- **Role:** Bar/restaurant hosting tournament
- **Tech Level:** N/A (automated display)
- **Goal:** Show event info and sponsor logos on TV
- **Pain Points:** Must work unattended, need sponsor ROI tracking

---

## Flow 1: Pre-Event Setup (Admin)

**Persona:** Sarah (Event Organizer)
**Entry Point:** Admin page URL
**Success Criteria:** Event created, links generated, poster printed

### Steps:

1. **Navigate to Admin Page**
   - URL: `https://zeventbooks.io?page=admin`
   - See: Empty event creation form
   - Action: Scroll to understand available fields

2. **Fill Core Event Details**
   - **Event Name:** "Chicago Bocce Summer Classic 2025" (REQUIRED)
   - **Date:** Select July 15, 2025 from date picker (REQUIRED)
   - **Time:** Type "6:00 PM"
   - **Location:** "Wrigley Square Park, Chicago"
   - **Entity:** "Chicago Bocce Club"
   - **Expected Behavior:** All fields accept input, no errors

3. **Add Summary**
   - **Summary:** Type event description (200-300 characters)
   - **Summary Link:** Paste link to detailed event page
   - **Expected Behavior:** Textarea expands as needed

4. **Add Media**
   - **Event Image URL:** Paste Cloudinary or Google Drive image URL
   - **Video URL:** Paste YouTube event promo video
   - **Gallery URLs:** Paste 3-5 image URLs, comma-separated
   - **Expected Behavior:** URLs validated (must be http/https)

5. **Add Bio**
   - **Bio:** Type organizer bio or event history
   - **Bio Link:** Link to club website
   - **Expected Behavior:** Text saves without character limit warning

6. **Submit Event**
   - Click "Create Event" button
   - **Prompt appears:** "Admin key for root"
   - Type admin secret (first time only - then cached in sessionStorage)
   - **Expected Behavior:**
     - Button shows "Working..." overlay
     - Within 2-3 seconds: Event card appears below form
     - See event ID, name, date confirmation

7. **View Generated Links**
   - **Public (Mobile):** Copy link for social media/email
   - **Display (TV):** Copy link for venue TV setup
   - **Poster (Print/QR):** Copy link for QR code generation
   - **Action:** Click each "Copy Link" button
   - **Expected Behavior:** Browser copies to clipboard, shows "Link copied!" alert

8. **Configure Sign-Up Forms**
   - Click "Configure Sign-Up Forms" button
   - See form with 4 Google Forms links:
     - **Pre-Event Registration:** Paste Google Form URL
     - **Check-In:** Paste check-in form URL
     - **Walk-In:** Paste walk-in registration form
     - **Survey:** Paste post-event feedback form
   - Click "Save All Forms"
   - **Expected Behavior:** Alert "Sign-up forms saved!" appears

9. **Configure Display & Sponsors**
   - Click "Configure Display & Sponsors" button
   - **Display Mode:** Select "Dynamic (Carousel with URLs)"
   - Click "Add URL" 3 times
   - **URL 1:** Paste YouTube event trailer (30 seconds)
   - **URL 2:** Paste Google Slides presentation (20 seconds)
   - **URL 3:** Paste event website (15 seconds)
   - Click "Add Sponsor" twice
   - **Sponsor 1:**
     - Name: "Miller Lite"
     - URL: https://millerlite.com
     - Image URL: (Miller logo PNG)
     - Check: ✅ TV Top, ✅ Mobile Banner
   - **Sponsor 2:**
     - Name: "Bocce Equipment Co."
     - URL: https://bocceequipment.com
     - Image URL: (Company logo)
     - Check: ✅ TV Side, ✅ Poster Top
   - Click "Save Configuration"
   - **Expected Behavior:** Alert "Display configuration saved!"

10. **Print Posters**
    - Open Poster URL in new tab
    - See: Event details + QR codes + sponsor strip
    - Print to PDF or physical printer
    - **Expected Behavior:** QR codes are scannable, layout fits 8.5x11" paper

### Pain Points to Test:

- ❓ What if admin key is wrong? → Should show clear error
- ❓ What if required field is empty? → Should highlight field before submit
- ❓ What if image URL is invalid? → Should validate and show error
- ❓ What if user clicks "Save" multiple times? → Idempotency should prevent duplicates
- ❓ Can user edit event after creation? → Currently NO - must note in docs

---

## Flow 2: During Event (Mobile Attendee)

**Persona:** Mike (Attendee)
**Entry Point:** QR code on poster or link in email
**Success Criteria:** Mike registers, checks in, sees event details

### Steps:

1. **Scan QR Code**
   - Mike scans QR code at venue entrance
   - Phone opens: `https://zeventbooks.io?p=events&id=EVENT_ID`
   - **Expected Behavior:** Page loads in < 2 seconds on 4G

2. **View Event Details**
   - See: Event name in large font (h1)
   - See: Date, time, location (icons for visual clarity)
   - See: Sponsor banner at top (Miller Lite logo)
   - Scroll down
   - See: Event image (full-width, responsive)
   - **Expected Behavior:** Images load progressively, no layout shift

3. **Click Register Button**
   - Tap "Register" button (prominent, blue)
   - **Expected Behavior:** Opens Google Form in new tab
   - Mike fills form, submits
   - Returns to event page

4. **View Video**
   - Scroll to "Video" section
   - See: YouTube video embedded (16:9 aspect ratio)
   - Tap play button
   - **Expected Behavior:** Video plays inline, no full-screen required

5. **View Gallery**
   - Scroll to "Gallery" section
   - See: Grid of 5 event photos (responsive grid)
   - Tap photo to expand (browser zoom)
   - **Expected Behavior:** Images lazy-load, don't block page render

6. **Click Sponsor Banner**
   - Tap Miller Lite logo in sponsor banner
   - **Expected Behavior:**
     - Opens https://millerlite.com in new tab
     - Analytics event logged (click, sponsorId=miller, surface=public)

7. **Check In**
   - Tap "Check In" button
   - Opens check-in Google Form
   - Fill form, submit
   - **Expected Behavior:** Form submission recorded

### Pain Points to Test:

- ❓ What if WiFi is slow? → Page should work with progressive loading
- ❓ What if sponsor image fails to load? → Fallback to text name
- ❓ What if video is blocked (Instagram)? → Show "Watch on Instagram" link
- ❓ Can Mike save event to calendar? → Currently NO - future feature

---

## Flow 3: During Event (TV Display)

**Persona:** Venue TV (Automated Display)
**Entry Point:** Display URL set to auto-refresh
**Success Criteria:** Content rotates, sponsors visible, analytics logged

### Steps:

1. **Initial Load**
   - TV browser opens: `https://zeventbooks.io?page=display&id=EVENT_ID&tv=1`
   - **Expected Behavior:**
     - Dark background (easy on eyes in bar setting)
     - Large font (readable from 10-12 feet)
     - Sponsor banner at top (Miller Lite)
     - Sponsor sidebar on right (Bocce Equipment Co.)
     - Main stage: iframe loading

2. **Carousel Mode Active**
   - Display mode: "Dynamic"
   - **Slide 1:** YouTube event trailer loads
   - See: Video plays automatically (if allowed)
   - Wait 30 seconds
   - **Expected Behavior:** Auto-advance to next slide

3. **Slide 2:** Google Slides presentation
   - iframe loads Google Slides
   - **Expected Behavior:**
     - If embed allowed: Shows slides
     - If blocked: Shows fallback "Content Unavailable" for 2s, then skips
   - Wait 20 seconds
   - Auto-advance

4. **Slide 3:** Event website
   - iframe loads event website
   - Wait 15 seconds
   - **Expected Behavior:** Loop back to Slide 1

5. **Analytics Logging**
   - Every 6 seconds: Batch analytics flushed
   - **Logged Events:**
     - Sponsor impressions (tvTop, tvSide)
     - Dwell time per slide
     - Blocked embed events
   - **Expected Behavior:** No visible UI change, background logging

6. **Unattended Operation**
   - TV runs for 4 hours straight
   - **Expected Behavior:**
     - No crashes
     - No memory leaks
     - Carousel continues rotating
     - Analytics continue logging

### Pain Points to Test:

- ❓ What if iframe blocks embedding (Instagram, TikTok)? → Skip gracefully
- ❓ What if internet drops mid-carousel? → Show fallback, retry on reconnect
- ❓ What if video autoplays with sound? → Might annoy venue - need mute option
- ❓ Can venue pause carousel? → Currently NO - add pause button?

---

## Flow 4: Post-Event (Analytics Review)

**Persona:** Sarah (Event Organizer)
**Entry Point:** Admin dashboard (future) or Apps Script console
**Success Criteria:** Sarah sees sponsor ROI metrics

### Steps:

1. **Run Diagnostics** (Manual)
   - Sarah opens Apps Script editor
   - Runs `api_getReport({ id: 'EVENT_ID' })`
   - **Response:**
     ```json
     {
       "ok": true,
       "value": {
         "totals": { "impressions": 523, "clicks": 47, "dwellSec": 12450 },
         "bySponsor": {
           "miller-lite": { "impressions": 523, "clicks": 42, "ctr": 0.0803 },
           "bocce-equip": { "impressions": 523, "clicks": 5, "ctr": 0.0096 }
         }
       }
     }
     ```

2. **Export Report to Sheets**
   - Runs `api_exportReport({ id: 'EVENT_ID' })`
   - **Expected Behavior:**
     - New sheet created: "Report – EVENT_ID"
     - Tables for:
       - Totals (impressions, clicks, dwell)
       - By Surface (display, public, poster)
       - By Sponsor (with CTR)
       - By Token (shortlinks)
     - Auto-sized columns

3. **Share with Sponsors**
   - Sarah downloads report as PDF
   - Emails to Miller Lite: "Your logo was seen 523 times, 42 clicks, 8% CTR"
   - **Expected Behavior:** Sponsor renews for next event

### Pain Points to Test:

- ❓ Can Sarah access this without Apps Script knowledge? → Need Admin UI dashboard
- ❓ Are metrics accurate? → Validate against expected values
- ❓ Can Sarah filter by date range? → Currently NO - future feature

---

## Flow 5: Shortlink Redirect

**Persona:** Mike (Attendee)
**Entry Point:** Shortlink on poster or social media
**Success Criteria:** Mike redirects to target URL, click logged

### Steps:

1. **Create Shortlink** (Admin)
   - Sarah runs: `api_createShortlink({ targetUrl: 'https://forms.google.com/register', eventId: 'EVENT_ID', surface: 'poster' })`
   - **Response:**
     ```json
     { "ok": true, "value": { "token": "a1b2c3d4", "shortlink": "https://zeventbooks.io?p=r&t=a1b2c3d4" } }
     ```

2. **Print Shortlink as QR Code**
   - Sarah generates QR code from shortlink
   - Prints on poster

3. **Mike Scans QR Code**
   - Phone opens: `https://zeventbooks.io?p=r&t=a1b2c3d4`
   - **Expected Behavior:**
     - Server looks up token in SHORTLINKS sheet
     - Logs click event (eventId, sponsorId, token, surface=poster)
     - Redirects to https://forms.google.com/register
     - Redirect happens within 1 second

4. **Analytics Logged**
   - ANALYTICS sheet updated:
     - timestamp, eventId, surface=poster, metric=click, token=a1b2c3d4

### Pain Points to Test:

- ❓ What if token doesn't exist? → Show "Shortlink not found" page
- ❓ What if targetUrl is malicious? → Validate URL in api_createShortlink
- ❓ Can shortlinks expire? → Currently NO - future feature

---

## Flow 6: Edge Cases & Error Handling

### Case 1: Offline / Network Failure

**Scenario:** Mike's phone loses internet mid-page
**Expected Behavior:**
- Page content already loaded: Still visible
- Analytics batch: Queued in logBatch[], will flush on reconnect
- RPC calls: Show error "Could not connect"

### Case 2: Invalid Admin Key

**Scenario:** Sarah types wrong admin key
**Expected Behavior:**
- API returns: `{ ok: false, code: 'BAD_INPUT', message: 'Invalid admin key' }`
- Frontend shows alert: "Error: Invalid admin key"
- sessionStorage not updated (prompts again next time)

### Case 3: Rate Limiting

**Scenario:** Sarah creates 25 events in 1 minute
**Expected Behavior:**
- First 20: Success
- Next 5: `{ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' }`
- Frontend shows alert: "Error: Too many requests"
- After 1 minute: Rate limit resets

### Case 4: XSS Attempt

**Scenario:** Sarah enters event name: `<script>alert('XSS')</script>`
**Expected Behavior:**
- Backend: sanitizeInput_() removes `<>` → `scriptalert('XSS')/script`
- Frontend: NU.esc() escapes on render → `&lt;script&gt;...`
- Result: No script execution, safe display

### Case 5: Blocked Iframe Embed

**Scenario:** Display carousel includes Instagram post
**Expected Behavior:**
- iframe.onerror triggered
- Fallback card shown: "Content Unavailable"
- After 2 seconds: Skip to next URL
- Analytics logged: metric=blocked_embed

---

## Usability Checklist

From end-user perspective, rate each flow:

| Flow | Easy to Use? | Confusing? | Needs Improvement |
|------|--------------|-----------|-------------------|
| Admin: Create Event | ✅ | Admin key prompt unclear | Add inline help text |
| Admin: Configure Sponsors | ⚠️ | Can't preview placements | Add live preview |
| Public: View Event | ✅ | - | - |
| Public: Register | ✅ | - | - |
| Display: TV Carousel | ✅ | No pause button | Add remote control |
| Analytics: View Report | ❌ | Requires Apps Script | Build Admin dashboard |
| Shortlink: Redirect | ✅ | - | - |

---

## Recommended Test Automation Priorities

Based on user impact and failure risk:

**Priority 1 (Critical):**
1. Admin creates event → Public page shows event ✅
2. Configure sponsors → Display page shows sponsors ✅
3. Shortlink redirect → Analytics logged ✅

**Priority 2 (High):**
4. Analytics batch flush → Report aggregates correctly ✅
5. Display carousel rotation → Auto-advances ✅
6. XSS sanitization → No script execution ✅

**Priority 3 (Medium):**
7. Mobile responsive design → Readable on small screens
8. Offline handling → Graceful degradation
9. Rate limiting → Prevents abuse

**Priority 4 (Low):**
10. Poster print layout → QR codes scannable
11. Gallery lazy loading → Performance optimization
12. Keyboard navigation → Accessibility

---

## User Feedback Collection

**How to gather real user feedback:**

1. **Sarah (Admin):** 30-minute usability session
   - Task: Create event, configure display
   - Record screen, ask to "think aloud"
   - Note: Where does she get confused? What's missing?

2. **Mike (Attendee):** In-venue observation
   - Watch Mike scan QR, navigate public page
   - Note: Does he find Register button? Does he click sponsor?

3. **Venue (TV Display):** 4-hour soak test
   - Set up TV, let it run unattended
   - Check after 4 hours: Still running? Any errors?

4. **Post-Event Survey:**
   - Send to all attendees: "How easy was it to register? (1-5 stars)"
   - Collect NPS score

---

## End-User Documentation Needed

**For Sarah (Admin):**
- Quick Start Guide: Create Your First Event (5 steps with screenshots)
- Video Tutorial: Configuring Sponsors (2 minutes)
- FAQ: "How do I change admin key?" "Can I edit event after creation?"

**For Mike (Attendee):**
- No docs needed - must be self-explanatory!
- If confused: Redesign UI

**For Venue:**
- TV Display Setup Guide: "Point browser to this URL, set to kiosk mode"
- Troubleshooting: "If carousel stops, refresh page"

---

**Conclusion:** From the end-user POV, this app must be **dead simple**. If Sarah needs training, we failed. If Mike can't register in 30 seconds, we failed. If the TV display crashes during the event, we failed.

**Next Steps:**
1. Run these flows manually (human testing)
2. Automate critical flows (Playwright E2E)
3. Collect real user feedback
4. Iterate based on pain points
