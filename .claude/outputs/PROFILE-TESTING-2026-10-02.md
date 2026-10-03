# Profile testing — accessibility to power user (2026-10-02)

**Setup:**

- **Target:** the local worker, built from this branch (PR #758, head `d11cfc2`).
- **Browser:** Chromium only. WebKit is not available in the sandbox.
- **Seed data:** one live event with the 5Ws, an address and coordinates, plus one accepted sponsor, all seeded through the admin API.
- **Script:** `tests/playwright/profile-testing.spec.ts`, a scratch run that is not in CI yet.
- **Method:** each profile records findings instead of failing, so one run reports everything. Two findings looked overstated and were re-checked. Only re-checked findings are listed as real.

**Surfaces:**

1. `/` (landing)
2. `/events`
3. `/events/:id`
4. `/poster?event=`
5. `/forms/:id?type=register`
6. `/sponsor?t=`
7. `/sponsors/:id`
8. `/admin`

`/display` was checked for motion and keys only.

## Results by profile

| Profile                                | Result                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen reader (axe WCAG 2.1 AA, light) | **Clean on all 8 surfaces.** One `<h1>`, one `<main>`, `lang` and `<title>` set everywhere.                                                                                                                                  |
| Screen reader (axe, dark)              | **1 serious:** colour contrast on the attendee-map event links on `/` (5 nodes, `a[data-testid="amap-event"]`).                                                                                                              |
| Keyboard only                          | Every control up to Create Event shows a visible focus ring. Escape closes the wizard. Enter in the name field does not move on: you must Tab to Next.                                                                       |
| Low vision, 320px at normal text       | **1 fail (WCAG 1.4.10):** `/events` scrolls sideways (350px > 320px). The Search button (`disc-go`) does not wrap. The other 7 surfaces fit.                                                                                 |
| Low vision, 320px at 200% text         | Headers don't wrap: the brand title and nav run off the edge on `/events`, `/sponsor`, `/sponsors/:id` and `/admin`. Covers WCAG 1.4.4 + 1.4.10 together, so it is harsher than the standard test. Fix after the 1.4.10 one. |
| Reduced motion                         | Public and admin surfaces: nothing animates. **The TV keeps scrolling its ticker** (`display-ticker-text`) when the system asks for reduced motion.                                                                          |
| Windows high contrast                  | No control loses its label or outline.                                                                                                                                                                                       |
| First-timer on a phone                 | **Next is a disabled button until the name AND venue are filled, and nothing says why.** It is skipped by Tab and silent to screen readers. **A 2020 date is accepted with no warning.**                                     |
| Every-few-months returner              | The front door says "What are you making?" and offers Create a sponsor, Create an event and **Your events**. Good.                                                                                                           |
| Slow phone (3G-ish, 4x CPU)            | Every public surface reaches DOMContentLoaded in **0.4–0.8 s**.                                                                                                                                                              |
| Patron (poster → public page)          | 5Ws in order, with address and map above the fold on a 375px phone. Order: sponsor strip (76px) → title (142) → when → what → where → who → why → how.                                                                       |
| Power user                             | Full dashboard reachable from the front door. Soonest first + Live filter answer. TV accepts Space and the arrow keys.                                                                                                       |

## Fix list (recommended order)

1. **`/events` sideways scroll at 320px.** Let the search row wrap. WCAG AA fail; small CSS change.
2. **Wizard Next gives no reason.** Keep Next enabled. When pressed with the name or venue empty, say "Add a name and a place to continue", mark the empty field `aria-invalid` and move focus to it. A first-timer and a screen-reader user both need this.
3. **Past date in the wizard.** Warn: "That date has passed. Is that right?" Allow it (an organizer may be logging a past event), but never silently.
4. **Dark-mode contrast on the map links** on `/`. Change the token, not the hex.
5. **TV ticker under reduced motion.** Stop scrolling; show the text statically or step it.
6. **Headers at 200% text.** Let the brand and nav wrap on `/events`, `/sponsor`, `/sponsors/:id` and `/admin`.
7. **Enter on the name field** moves to Next. Small, and kind to keyboard users.

## A PO question this raised

The PO's flow direction (2026-10-02) puts **sponsors between the title and the content/map**. The live page has the **sponsor strip above the title**, from the 2026-09-13 canonical order: sponsor strip → title/when → What → Where …

These disagree. Moving the strip under the title/when line is a small template change on pre, live and post. It is gated by `pre-event-funnel-order.spec.ts` and `public-event-stakeholder-surfaces.spec.ts`, which would be updated together.

## What this run did not cover

- **WebKit:** not available here. The publish-loop journey runs on WebKit in CI from PR #758 on.
- **A real screen reader** (VoiceOver or NVDA). axe and landmark checks are a proxy, not the experience.
- **OW and Hybrid flows.** See `workers/oursharedevents/docs/ops/E2E-FLOWS-MAP-2026-10-02.md`, M2/M3.
