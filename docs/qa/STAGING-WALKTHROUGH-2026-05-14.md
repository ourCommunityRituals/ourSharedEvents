# Staging Walkthrough — Pulse 1 Manual QA Pass

**Date:** 2026-05-14
**Target environment:** `https://stg.oursharedevents.com`
**Executor:** mzdan
**Estimated time:** 1.5–2 hours
**Purpose:** ground-truth assessment of what actually works on staging end-to-end after Pulse 1, before OSE-15 production launch

---

## Why this doc exists

`docs/qa/QA-FLOWS.md` was written 2025-11-23 for the **legacy Google Apps Script architecture** (`Admin.html`, `Public.html`, `Display.html`, `Poster.html`, `Code.gs`). The Cloudflare Worker + D1 migration changed every surface URL and every backend pattern; that doc was never migrated.

This document is the **current-architecture manual walkthrough** for Pulse 1. It maps the original QA-FLOWS intent to today's Cloudflare URLs, adds the new flows from FEAT-03.2 (lifecycle-aware public page), and gives you a scorecard to fill out as you go.

When this walkthrough is complete and scored, the result becomes the source of truth for what ships in OSE-15 and what gets bumped to Pulse 2.

A formal rewrite of `QA-FLOWS.md` is tracked as **OSE-273** (queued separately); this document is the executable scorecard for **right now**.

---

## How to use this document

- **Open this file in one tab. Open staging in another.** Work top-to-bottom.
- **One flow at a time.** Each flow has preconditions, steps, what-to-look-for, and a scorecard line. Mark the scorecard line as you complete each step.
- **Scorecard symbols:**
  - ✅ **Works.** Behaves as specified.
  - ⚠️ **Partial.** Works but with a notable issue (capture the issue in the notes column).
  - ❌ **Broken.** Does not work; the flow fails.
  - 🚧 **Not yet shipped.** Surface or feature isn't on staging yet. (Expected for Phase-2+ surfaces.)
  - ❓ **Couldn't test.** Missing precondition, environment issue, or unclear. Capture why.
- **Don't fix as you go.** Note issues. Triage after the full pass. The point is the _audit_, not the patch.
- **Anonymization:** if you capture real attendee data anywhere during this walkthrough, scrub it before logging. Use the placeholder convention `attendee-{N}` and `test-{purpose}@example.com`.

---

## Preconditions for the entire walkthrough

Before starting, confirm:

- [ ] `https://stg.oursharedevents.com/health` returns `{"ok":true,"env":"staging"}` and HTTP 200.
- [ ] You have access to the staging admin surface (CF Access JWT signed in, or `ADMIN_KEY` Bearer token if you're hitting the API directly).
- [ ] You have a clean browser profile (no cookies, no extensions interfering — Chrome Guest mode or a private window works).
- [ ] You have the test event IDs from a fresh seed (or you'll create your own in Flow 1).
- [ ] Your phone is available for at least one mobile-surface check.

If any precondition fails, **stop and resolve before continuing.** The walkthrough assumes a known-good baseline.

---

## Flow 1 — Event Lifecycle: Admin → Public → Poster → Display

**Original QA-FLOWS Flow 1, migrated to Cloudflare architecture.**

**Goal:** verify an event created in Admin flows through every surface the attendee/sponsor/operator would touch on event day.

### Steps

1. **Open `https://stg.oursharedevents.com/admin`**
   - Expected: admin dashboard loads, CF Access JWT check passes, you see the event list.
   - **Look for:** error states, broken UI, console errors, slow load.
   - Scorecard: `[ ]` \_\_\_\_

2. **Create a new event** in the admin form (5W fields per OSE-239):
   - Title: `Walkthrough Test Event 2026-05-14`
   - What (short summary): `Manual walkthrough for staging readiness`
   - When (start_date / end_date): start 1 hour from now, end 3 hours from now (this lets you also test the live phase later)
   - Where (venue + address): pick a real venue near you so the geocoding has something real to do
   - Who (host): your name or "QA"
   - Why (purpose): `Pulse 1 staging readiness`
   - How (details): anything — testing the field
   - Save / submit.
   - **Look for:** geocoding actually resolves the address; event row appears in the list with a generated ID and shortcode; no warnings panel with errors.
   - Capture: `event_id = ____________` and `shortcode = ____________`.
   - Scorecard: `[ ]` \_\_\_\_

3. **Navigate to `https://stg.oursharedevents.com/events/{event_id}`** (the public surface).
   - Expected: pre-event render (since `start_date` is in the future). Should show:
     - LIVE NOW is **absent** (we're pre-event)
     - 5W content sections all populated
     - Venue map image (Google Maps `/api/v2/maps/venue-image`)
     - Anonymity affordance visible
     - "Skip to event content" link if you press Tab
   - **Mobile check:** repeat on your phone. The page should be mobile-first responsive.
   - Scorecard: `[ ]` Desktop \_**\_ `[ ]` Mobile \_\_**

4. **Navigate to `https://stg.oursharedevents.com/poster/{event_id}`**.
   - Expected: print-shaped layout, QR code rendered, event title + venue, no console errors.
   - **Try the browser's print preview** (Ctrl+P) — does the QR code render in print mode without artifacts?
   - Scorecard: `[ ]` Print preview \_\_\_\_

5. **Navigate to `https://stg.oursharedevents.com/display/{event_id}`**.
   - Expected: TV/kiosk-shaped layout. Larger text. Suitable for viewing across a room.
   - **Mock a TV check:** resize your browser to 1920×1080. The layout should hold.
   - Scorecard: `[ ]` \_\_\_\_

6. **Navigate to `https://stg.oursharedevents.com/sharedReport/{event_id}`**.
   - Expected: **probably a placeholder** (OSE-245 hasn't shipped). If you see real data, that's a surprise — capture what's there.
   - Scorecard: `[ ]` Placeholder \_**\_ or `[ ]` Has-content \_\_** (with notes)

7. **Wait for the event to enter the `event` phase** (or update the event's `start_date` to 1 minute ago via admin/API).
   - Refresh `https://stg.oursharedevents.com/events/{event_id}`.
   - Expected: now shows the **event-live render** (OSE-244a, deployed 2026-05-14):
     - LIVE NOW badge with pulsing dot animation
     - Check-in CTA button pointing at `/forms/{event_id}?type=checkin`
     - "Navigate now" wayfinding link (vs "See on" in pre-event)
     - 5W sections still present with `-live` suffixed test IDs
   - Scorecard: `[ ]` \_\_\_\_

### Notes (Flow 1)

```
Issues found:
-
-
-
```

---

## Flow 2 — Form Submission Lifecycle

**Original QA-FLOWS Flow 2, expanded for the four form types.**

**Goal:** verify each form type accepts a submission, stores it in `FORMS_DB`, and respects the tier gating from feature flags.

### Steps

1. **Registration form** — `https://stg.oursharedevents.com/forms/{event_id}?type=registration`.
   - Expected: form loads, accepts name + email, submits, returns success state with sponsor acknowledgment if configured.
   - **Architecturally critical:** email is hashed at write time. Verify by hitting admin API: `GET /api/v2/forms/registrations?event_id={event_id}` should show the hash, not the raw email.
   - Scorecard: `[ ]` \_\_\_\_

2. **Check-in form** — `https://stg.oursharedevents.com/forms/{event_id}?type=checkin`.
   - Expected: simple tap form, no PII, increments check-in counter. Tap it 5 times.
   - Verify counter via `GET /api/v2/forms/checkins/count?event_id={event_id}` → should equal 5.
   - **Anonymity test:** no IP, no anon_id, no cookie should be stored. The platform's own static gate enforces this; this manual check is the operational mirror.
   - Scorecard: `[ ]` \_\_\_\_

3. **Survey form** — `https://stg.oursharedevents.com/forms/{event_id}?type=survey`.
   - Expected: if the event's tier is `free`, the form returns `403 FORM_DISABLED`. If `mid` or `enterprise`, the form loads.
   - **Test the tier gate:** create one event at free tier, one at mid; verify the gate flips correctly.
   - Scorecard: `[ ]` Free=blocked \_**\_ `[ ]` Mid=allowed \_\_**

4. **Email signup form** — `https://stg.oursharedevents.com/forms/{event_id}?type=emailsignup`.
   - Expected: form accepts email; the email is **AES-GCM encrypted** at rest (not just hashed). The encryption + retention TTL is the per-attendee identifier story (OSE-203 lifecycle).
   - **Dedup test:** submit the same email twice; the second submission should dedupe (no second row, or a row marked as duplicate).
   - **Case-insensitive dedup:** submit `Test@Example.com` then `test@example.com`; should also dedupe.
   - Scorecard: `[ ]` Submit \_**\_ `[ ]` Dedup \_\_** `[ ]` Case-insensitive \_\_\_\_

### Notes (Flow 2)

```
Issues found:
-
-
-
```

---

## Flow 3 — Sponsor Visibility & Impression Logging

**Original QA-FLOWS Flow 3, migrated to Cloudflare architecture.**

**Goal:** verify sponsors render on the surfaces where they're configured and that impressions are logged.

### Preconditions

- [ ] You have at least one event with a sponsor configured. If not, create one via admin or use a known-seeded event.
- [ ] You know which surfaces the sponsor is placed on (typically `public`, `display`, `poster`).

### Steps

1. **Load `/events/{event_id}`** for an event with a sponsor.
   - Expected: sponsor logo / line visible. Hover or focus should show a clickable link.
   - **Click the sponsor link.** Verify:
     - You're redirected to the sponsor's destination URL.
     - An impression event was logged (check `GET /api/v2/sponsors/impressions?event_id={event_id}` — should include `surface: public`, `metric: impression`, the sponsor ID).
     - A click event was logged (same endpoint, `metric: click`).
   - Scorecard: `[ ]` Render \_**\_ `[ ]` Impression logged \_\_** `[ ]` Click logged \_\_\_\_

2. **Load `/display/{event_id}`**.
   - Expected: sponsor banner / strip visible.
   - Verify impression event logged with `surface: display`.
   - Scorecard: `[ ]` \_\_\_\_

3. **Load `/poster/{event_id}`**.
   - Expected: sponsor logo on print layout.
   - Verify impression event logged with `surface: poster`.
   - Scorecard: `[ ]` \_\_\_\_

4. **Rotation check** (if sponsor rotation is enabled).
   - Refresh the page 5 times. Verify that:
     - If only one sponsor is configured, the same sponsor renders every time.
     - If multiple sponsors are configured, they rotate per refresh.
     - **Impressions are logged once per page load**, not per rotation. (One impression per pageview, not five per pageview if you cycle.)
   - Scorecard: `[ ]` \_\_\_\_

### Notes (Flow 3)

```
Issues found:
-
-
-
```

---

## Flow 4 — Error Handling & Negative Cases

**Original QA-FLOWS Flow 4, expanded.**

**Goal:** verify the platform fails gracefully on bad input and never leaks data.

### Steps

1. **Bad event ID — public surface.**
   - Open `https://stg.oursharedevents.com/events/evt_does_not_exist_walkthrough`.
   - Expected: 404 with a user-friendly "Event not found" page.
   - **MUST NOT** show event content, stack traces, or leak any event titles.
   - Scorecard: `[ ]` \_\_\_\_

2. **Bad event ID — draft or ready state.**
   - Create a draft event in admin. Try to open it at `/events/{event_id}`.
   - Expected: **404** (draft events MUST NOT be public).
   - The 404 MUST NOT leak the event title.
   - Try the same for a `ready` state event (approvals pending).
   - Expected: also **404**.
   - Scorecard: `[ ]` Draft=404 \_**\_ `[ ]` Ready=404 \_\_** `[ ]` No title leak \_\_\_\_

3. **Malformed event ID (path traversal).**
   - Open `https://stg.oursharedevents.com/events/evt..%2Ffoo`.
   - Expected: 404 with no leak.
   - Scorecard: `[ ]` \_\_\_\_

4. **Over-long event ID.**
   - Open `https://stg.oursharedevents.com/events/aaaaaaaaaaaaaaaa...` (200+ chars).
   - Expected: 404 (router or validator rejects).
   - Scorecard: `[ ]` \_\_\_\_

5. **Oversized form body (OSE-204).**
   - POST a >100KB body to `/forms/{event_id}?type=survey`.
   - Expected: **413 PAYLOAD_TOO_LARGE** (this is the contract OSE-204 fixed; the prior version returned 400 INVALID_BODY).
   - Scorecard: `[ ]` \_\_\_\_

6. **Admin endpoints without auth.**
   - `GET https://stg.oursharedevents.com/api/v2/events` with no token.
   - Expected: **401 Unauthorized** with no body leak.
   - Try with an invalid token; same result.
   - Scorecard: `[ ]` No-auth=401 \_**\_ `[ ]` Bad-auth=401 \_\_**

7. **Cross-layer isolation check (OSE-205 architecture invariant).**
   - In the browser DevTools, inspect a request to `/api/v2/forms/registrations`.
   - Verify the response does NOT include any cross-references to the main `DB` (event metadata leaking through the forms API).
   - Conversely, `/api/v2/events` MUST NOT include any per-attendee form data.
   - This is enforced by the static gate (`tests/architecture.spec.ts`), but the manual check confirms the runtime mirrors the source-code rule.
   - Scorecard: `[ ]` \_\_\_\_

### Notes (Flow 4)

```
Issues found:
-
-
-
```

---

## Flow 5 — Phase Transition on `/events/:id` (FEAT-03.2)

**New flow from Pulse 1 — pre-event → event-live → post-event lifecycle rendering.**

**Goal:** verify the same URL renders three different phase-appropriate surfaces depending on the time window relative to the event's `start_date` and `end_date`.

### Steps

1. **Pre-event phase.**
   - Visit `/events/{event_id}` for an event whose `start_date` is in the future.
   - Expected: pre-event render (OSE-243a, shipped). Confirm:
     - LIVE NOW badge **absent**
     - 5W sections present with `data-testid="event-what"`, `event-where`, `event-who`, `event-why`, `event-how` (no `-live` suffix)
     - "See on Google Maps" link (pre-event wayfinding language)
     - Anonymity affordance present
     - Skip-to-content link works on Tab
   - Scorecard: `[ ]` \_\_\_\_

2. **Event-live phase.**
   - Visit `/events/{event_id}` for an event whose `start_date ≤ now ≤ end_date`.
   - Expected: event-live render (OSE-244a, shipped 2026-05-14, on staging). Confirm:
     - **LIVE NOW badge present** with pulsing dot animation (`data-testid="event-live-badge"`)
     - `data-testid="event-main-live"`, `event-header-live`, `event-title-live`
     - Check-in CTA button with `data-testid="event-checkin"` pointing at `/forms/{event_id}?type=checkin`
     - "Navigate now" wayfinding link with `data-testid="gmaps-link-live"`
     - 5W sections with `-live` suffixed test IDs (`event-what-live`, etc.)
     - Anonymity affordance still present
   - Scorecard: `[ ]` \_\_\_\_

3. **Post-event phase.**
   - Visit `/events/{event_id}` for an event whose `end_date` is in the past.
   - Expected: **minimal post-event stub** (full SharedReport rendering is OSE-245, not yet shipped). Confirm:
     - Page says "This event has ended"
     - `data-testid="event-phase-msg"` present
     - Anonymity affordance still present
   - Scorecard: `[ ]` Stub \_\_\_\_ 🚧 (full SharedReport pending OSE-245)

4. **Archived state forces post-event.**
   - Archive an event whose `start_date` is in the future (status forces post_event regardless of timestamps).
   - Visit `/events/{event_id}`.
   - Expected: minimal post-event stub renders ("This event has ended"), HTTP 200.
   - Scorecard: `[ ]` \_\_\_\_

### Notes (Flow 5)

```
Issues found:
-
-
-
```

---

## Flow 6 — Anonymity Invariant Check (Manual Confirmation of Static Gate)

**New flow — operational mirror of the source-code invariants from ADR-001 + ADR-002.**

**Goal:** confirm at the running-system layer that the anonymity-preserving architecture holds, beyond just the static gates that enforce it in CI.

### Steps

1. **DevTools Network panel inspection** while loading `/events/{event_id}`.
   - Confirm the response has **no `Set-Cookie: anon_id`** for the public page (the anon_id cookie is only set on forms surface, not on the public read-only event page per OSE-263 scope).
   - Confirm no third-party trackers, analytics pixels, or ad-tech beacons in the request waterfall.
   - Confirm Content-Security-Policy header is present and tight.
   - Scorecard: `[ ]` No anon_id on public page \_**\_ `[ ]` No 3p trackers \_\_** `[ ]` CSP present \_\_\_\_

2. **DevTools Network panel** while submitting a registration form.
   - Confirm the request body has the raw email.
   - Confirm the response acknowledges submission with **no leaked database ID or raw email echo**.
   - In a separate admin call, confirm the stored record has the hashed email, never the raw value.
   - Scorecard: `[ ]` \_\_\_\_

3. **Public event page source view** (right-click → View Source on `/events/{event_id}`).
   - The HTML MUST NOT contain any attendee names, emails, anon_ids, or device identifiers.
   - The anonymity affordance should be visible inline.
   - Scorecard: `[ ]` \_\_\_\_

### Notes (Flow 6)

```
Issues found:
-
-
-
```

---

## Flow 7 — Newman / Postman Contract Verification (Smoke)

**Existing automated coverage — confirm it still passes against staging.**

**Goal:** confirm the Postman contract collection (`postman/collections/ose-api.json`) still passes against the deployed staging environment end-to-end.

### Steps

1. **Run the staging contract suite locally:**
   ```bash
   cd C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents
   # Newman command — replace API_BASE and ADMIN_KEY with staging values
   npx newman run postman/collections/ose-api.json \
     --env-var "API_BASE=https://stg.oursharedevents.com" \
     --env-var "ADMIN_KEY=<staging admin key>" \
     --reporters cli
   ```
2. **Expected:** all assertions pass (this was last green at PR #170 / staging deploy 2026-05-14).
3. If anything fails, capture which assertion. The contract file is the canonical truth source; a failure here means either staging drift or contract drift.
   - Scorecard: `[ ]` All-pass \_\_\_\_

### Notes (Flow 7)

```
Failures (if any):
-
-
-
```

---

## Flow 8 — Vitest E2E Scenarios Cross-Reference

**Existing automated coverage — for reference only; not part of manual walkthrough.**

The 10 numbered scenarios in `workers/oursharedevents/tests/forms-e2e.spec.ts` run on every PR and on main. They cover:

| #   | Scenario                                                                       | Status       |
| --- | ------------------------------------------------------------------------------ | ------------ |
| 1   | Registration lifecycle (submit → admin reads hashed email → expired destroyed) | ✅ automated |
| 2   | Check-in lifecycle (5 taps → counter=5 → zero PII in DB)                       | ✅ automated |
| 3   | Survey lifecycle with PII scrub                                                | ✅ automated |
| 4   | Email signup lifecycle (encryption + case-insensitive dedup + retention)       | ✅ automated |
| 5   | Auth enforcement (admin endpoints reject without auth)                         | ✅ automated |
| 6   | Input guards (bad JSON, bad event ID, missing fields, oversized body)          | ✅ automated |
| 7   | Cross-layer data isolation (DB ↔ FORMS_DB never cross-reference)               | ✅ automated |
| 8   | Tier gating (free → 403, mid → 200)                                            | ✅ automated |
| 8b  | Enterprise event override (global OFF + event ON = allowed)                    | ✅ automated |
| 9   | Existing routes unaffected (regression guard)                                  | ✅ automated |
| 10  | Full organizer flow (admin → configure → QR → submit → verify)                 | ✅ automated |

**No manual walkthrough needed for these** — they run on every PR. The manual walkthrough above is the _complement_ to the automated coverage, exercising surfaces and flows the unit-test suite can't reach (browser rendering, mobile responsiveness, real geocoding, real CF Access JWT, real CSP enforcement).

---

## Overall scorecard summary

Fill out this table after completing the walkthrough.

| Flow                         | Status | Issues found | Pulse-2 follow-up needed? |
| ---------------------------- | ------ | ------------ | ------------------------- |
| Flow 1 — Event lifecycle     |        |              |                           |
| Flow 2 — Form submissions    |        |              |                           |
| Flow 3 — Sponsor visibility  |        |              |                           |
| Flow 4 — Error handling      |        |              |                           |
| Flow 5 — Phase transition    |        |              |                           |
| Flow 6 — Anonymity invariant |        |              |                           |
| Flow 7 — Newman contract     |        |              |                           |

**Status legend:** ✅ all-green / ⚠️ partial (acceptable for Pulse 1) / ❌ blocking for Pulse 1 / 🚧 not yet shipped (expected)

---

## After the walkthrough — what happens next

1. **Any ❌ result** is a blocker for OSE-15 production launch. File a Linear story per blocker.
2. **Any ⚠️ result** is triage: is it Pulse-1 acceptable, or does it need fixing before launch? Note in the table.
3. **Any 🚧 result** is expected (Phase 2+ surfaces); no action needed unless the doc surfaces a new gap.
4. **All-green** means OSE-15 is unblocked from a manual-readiness standpoint.

The completed scorecard becomes a cited artifact in OSE-15's launch checklist. It also feeds OSE-271 (bar-owner discovery) — "the platform works end-to-end on staging" is one of the things you can say with confidence in a sponsor pitch only _after_ this walkthrough is green.

---

## Companion artifacts

- [`QA-FLOWS.md`](QA-FLOWS.md) — **STALE** (GAS-era, 2025-11-23). Migration to current architecture tracked as OSE-273.
- [`STAGING-SMOKE.md`](STAGING-SMOKE.md) — automated smoke tests that run as T2 in CI.
- [`E2E_TEST_DATA.md`](E2E_TEST_DATA.md) — seed data conventions.
- [`forms-e2e.spec.ts`](../../workers/oursharedevents/tests/forms-e2e.spec.ts) — the automated 10 scenarios.
- [`BEACHHEAD-ICP-2026-05-14.md`](../positioning/BEACHHEAD-ICP-2026-05-14.md) — the product narrative this walkthrough validates against.
