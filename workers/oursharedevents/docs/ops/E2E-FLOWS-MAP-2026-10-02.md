# End-to-end flows map (2026-10-02)

**What this is.** The PO asked for every flow, from loading the site to finishing a task, to be mapped, tested in layers, and run in a real browser on Chromium **and** WebKit where possible. This file is the map. Each row says:

- what a person does;
- which test layer covers it today;
- what is still missing.

It does **not** claim coverage it hasn't checked. "Covered" names the spec.

**Principles (PO, 2026-10-02):**

- Base practical wins. Speed and understanding come first.
- The app thinks for someone doing this for the first time, or once every few months. Advanced settings are there for anchors and enterprise. Everyone gets the forgiving flows: fat-finger, back and forth, publish/undo/republish.
- Patrons should reach **poster → public page** with the 5Ws, address and map exposed.
- When sponsors are configured, they sit **between the title and the content/map**.
- Testing is layered. Fast tests skip timing rules such as the publish grace window. API and Playwright tests respect them.

**Layers:**

| Code | Layer                  | Where it lives                                       |
| ---- | ---------------------- | ---------------------------------------------------- |
| U    | unit / jsdom (node)    | `workers/oursharedevents/tests` (node project)       |
| W    | Worker route + real D1 | `workers/oursharedevents/tests` (workers pool)       |
| A    | API against a worker   | Bruno `bruno/ose-api`, T2 on staging                 |
| C    | browser, Chromium      | blocking phone audit (`playwright.mobile.config.ts`) |
| K    | browser, WebKit        | same audit, `mobile-webkit` project                  |
| S    | staging smoke (T3/T4)  | `tests/e2e`, post-merge                              |

## 1. Organizer flows

| #   | Flow                                                                                             | Covered                                                                             | Missing                                                  |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| O1  | Front door → Create Event (wizard): name, date, venue → step 4                                   | U `admin-wizard-tv`, C+K `publish-loop-journey`                                     | —                                                        |
| O2  | Step 4: preview the real page and poster as a draft; TV screens and speed                        | U `admin-wizard-tv`, W `admin-poster-preview`/`admin-draft-preview`, C+K journey    | Visual snapshot of the draft poster print (DRAFT mark)   |
| O3  | Publish → Undo → Back to step 4 → change TV → Publish, repeated                                  | U, W `publish-grace`, C+K journey                                                   | —                                                        |
| O4  | Publish grace window: live by link, off list/map/sitemap/discovery, lists itself after           | W `publish-grace` (window on), C+K journey (1-minute window), C `sponsor-home-flow` | A: a Bruno check that a fresh publish is not in the list |
| O5  | Advanced create form (anchors / enterprise)                                                      | W (create/update specs), C `mobile-workability`                                     | C+K flow test of the advanced form end to end            |
| O6  | Your events: filter, status panel (Mark ready / Go live / Take offline / Archive / Reopen), Undo | U `admin-event-lifecycle-ui`, W `admin-events-lifecycle-list`                       | C+K click-through of the status panel and its Undo       |
| O7  | Browser Back / Forward inside the wizard                                                         | U `admin-wizard-phone-and-history`                                                  | C+K: real history (popstate) on both engines             |
| O8  | TV display card (deeper settings), saved per event                                               | U `admin-tv-display-card`, W `display-config`                                       | C: the card at phone width                               |

## 2. Sponsor flows

| #   | Flow                                                                    | Covered                                                         | Missing                                                              |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| S1  | Front door → Create Sponsor (admin form, image choice, card fields)     | C `admin-sponsor-form`, W sponsor specs                         | K                                                                    |
| S2  | Sponsor link → Accept / Decline → shows / drops on the event page       | C `sponsor-home-flow`                                           | K                                                                    |
| S3  | Sponsor discovery → ask to join → organizer approves                    | C `sponsor-home-flow` (waits out the grace window)              | K                                                                    |
| S4  | Sponsor placement between the title and the content/map on public pages | W `public-event-stakeholder-surfaces`, `pre-event-funnel-order` | C+K: measured order in a real layout (strip above WHAT, below title) |

## 3. Patron (attendee) flows

| #   | Flow                                                                        | Covered                                                             | Missing                                                                                                                              |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Site load → Events on the list (`/events`, search, when chips)              | W `event-discovery`, C `flow-events-discovery` (staging)            | Blocking C+K on the local worker                                                                                                     |
| P2  | Site load → Event on the map (attendee map, corridor gate)                  | W `events-map*`, C `landing-theme`                                  | K                                                                                                                                    |
| P3  | **Poster → scan → public page** with 5Ws, address and map, sponsors placed  | W `qr-roundtrip`, `scan-to-export-trace`, S `trace-scan-staging.sh` | **C+K journey: poster QR → `/q/` → `/events/:id`, asserting 5W order, address, map and sponsor strip position.** Highest value next. |
| P4  | Public page Back button returns to where the patron came from (list or map) | —                                                                   | C+K                                                                                                                                  |
| P5  | Forms from the public page (RSVP / check-in / survey / email)               | W forms specs, C `flow-forms-fillability` (staging)                 | Blocking C+K per form type                                                                                                           |

## 4. Product modes

| #   | Mode                                                           | Covered          | Missing                                                                                    |
| --- | -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| M1  | OSE only (anonymous)                                           | everything above | —                                                                                          |
| M2  | OW (ourWKRP, named identity): DJ live page and poster          | OW repo suites   | A cross-product journey: OSE event → OW music seam (`/api/events/:eventId/music`)          |
| M3  | Hybrid: an OSE event with OW music, both sides of the boundary | —                | C+K journey that proves the anonymous / named boundary holds (no OW identity on OSE pages) |

## Order of work (recommended)

1. **P3:** poster → public page journey (C+K). This is the patron path the PO named.
2. **S4 + P4:** sponsor position measured, and Back from the public page.
3. **O6 + O7:** status panel and real browser history on both engines.
4. **P1, P5:** list and forms, blocking on the local worker.
5. **M2, M3:** cross-product, once the OW seam is agreed.

Profile testing (accessibility through power user) runs across these flows. Its results go in its own report.
