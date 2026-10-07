# TDD red map: open front-end stories, written as failing tests first

**What this is.** For each open Linear story in the FE project, the tests that will go green when the story is built, and the flow in [E2E-FLOWS-MAP-2026-10-02.md](E2E-FLOWS-MAP-2026-10-02.md) it belongs to. The tests are written first, as `redStory(...)`.

**How a red test works** (`tests/helpers/red-story.ts`, rule pinned by `tests/red-story-helper.spec.ts`):

- The body must fail on an assertion tagged with its story, e.g. `expect(x, '[OSE-1560] a new event starts off the map')`. Any other failure (a typo, a 500, a missing seed) fails the test as _broken, not red_. A bare `it.fails` would hide that.
- While the story is open, the suite is green.
- When the story's work makes the body pass, the test fails with "now passes: promote this test". Remove the `redStory` wrapper (keep the body as a normal test), change the row below to Done, and move the Linear story on.

So the suite goes red exactly when a story lands, and stays red until the test is promoted. `tests/unit/tdd-red-map.test.js` fails if a `redStory` names a story that is missing from this table, or if a row says Done while a `redStory` for it is still wrapped.

**Levels** (same codes as the flows map): U unit, W Worker route + real D1, A API (Bruno on staging), C browser Chromium, K browser WebKit, S staging smoke.

## Red now (written, failing on the right assertion)

Re-checked against `main` on 2026-10-06. One red test is left.

| Story    | Flow       | Level   | Test (in `tests/tdd-red-fe-wave.spec.ts`)                                                                                                                            | Status |
| -------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| OSE-1644 | O1, O2     | W       | the map heads-up shows as a toast with a Turn off action (carried from OSE-1560 when it closed; waits on the toast, OSE-1564 and OSE-1620)                           | Open   |
| OSE-1560 | O1, O2     | W       | a new event is off the map unless someone turns it on                                                                                                                | Done   |
| OSE-1560 | O1, O6     | W       | leaving draft without a time and an event type is refused by name (409)                                                                                              | Done   |
| OSE-1519 | P3         | W       | a once-live archived event says it has ended (410, named, no error label, next events listed)                                                                        | Done   |
| OSE-1520 | P1         | W       | `/public` redirects to `/events`                                                                                                                                     | Done   |
| OSE-1520 | P1         | W       | the `/events` tab title says what the page is                                                                                                                        | Done   |
| OSE-1518 | P3         | W       | a live event page carries the trust header                                                                                                                           | Done   |
| OSE-1518 | P3         | W, C, K | three plain choices, share pair, next at this venue (`tests/event-page-choices.spec.ts` in the Worker suite; browser: `tests/playwright/event-page-choices.spec.ts`) | Done   |
| OSE-1519 | P3         | W       | the error page uses the shared footer (`tests/event-page-choices.spec.ts`; what a draft may show is still a PO decision, OSE-1642)                                   | Done   |
| OSE-1522 | S4, P1, P3 | W       | the `/events` card shows the consented sponsor by the title                                                                                                          | Done   |

Guards that are green today and must survive the fixes: a title-only draft can be created (OSE-1560); an unknown event id keeps the generic not-found page, and a draft is not named to an anonymous visitor (OSE-1519; the story leaves what a draft may show to the PO, so this guard turns an accidental leak into a decision).

## Written alongside the work (plain tests, each seen red before its change)

| Story              | Level   | Test                                                                                                                                                                                                                                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OSE-1520           | U, W    | `tests/event-card-filter.spec.ts`: one card (landing = /events card), upcoming first, wrapped under its own heading, five chips, heading follows the filter, one count sentence, empty states link wider, stylesheet (button stacks under 480px, `font: inherit`, sizes)             |
| OSE-1520           | C       | `tests/playwright/sponsor-surfaces-journey.spec.ts`: at 375px the button stacks under the text and the title keeps the card, on /events and the landing; same date, place and Register on both                                                                                       |
| OSE-1522           | U, W    | `tests/event-card-filter.spec.ts` (landing card sponsor, list API `sponsor_titles`), `tests/display-pane-rotation.spec.ts` (TV featured event and "also coming up")                                                                                                                  |
| OSE-1522           | C       | `tests/playwright/sponsor-surfaces-journey.spec.ts`: the sponsor is on the /events card, the landing card and the TV featured event after Accept, and off them after Decline                                                                                                         |
| OSE-1566           | C       | `tests/playwright/form-sponsor-logo-fallback.spec.ts`: a logo that fails to load is swapped to the default image on the form pages. The ticket records that this test was not seen red before its fix.                                                                               |
| OSE-1531           | W, C    | `tests/event-repeat.spec.ts` (the server-side copy lands as a draft, off the map) and `tests/playwright/report-repeat-journey.spec.ts` (the report ends with actions; Repeat this event)                                                                                             |
| OSE-1558           | C       | `tests/playwright/a11y-profile.spec.ts`: body content at 200% text fits a 320px screen                                                                                                                                                                                               |
| OSE-1528           | U, C    | `tests/admin-wizard-preview-review.spec.ts` and `tests/playwright/admin-create-preview.spec.ts`: live preview, review step, in-place edits                                                                                                                                           |
| OSE-1521           | U, C    | `tests/display-pane-rotation.spec.ts` and `tests/playwright/display-tv-board.spec.ts`: the TV board                                                                                                                                                                                  |
| OSE-1526, OSE-1527 | C       | `tests/playwright/admin-logs-settings-journey.spec.ts`: the read-only Logs and Settings screens                                                                                                                                                                                      |
| OSE-1516           | C       | `tests/playwright/poster-layout.spec.ts`: the poster layout follows the code count and artwork (Chromium only)                                                                                                                                                                       |
| OSE-1629           | U, C    | `tests/landing-area.spec.ts` and `tests/playwright/landing-empty-window.spec.ts`: an empty landing window says so and links to a wider range (Chromium only)                                                                                                                         |
| OSE-1644           | U, W, C | `tests/admin-wizard-preview-review.spec.ts` (a refused Publish opens the missing field), `tests/admin-create-core-values.spec.ts` (the advanced form asks once), `tests/core-values-refused-log.spec.ts` (the refusal is logged), `tests/playwright/admin-deep-dive-journey.spec.ts` |
| OSE-1644, OSE-1622 | A       | `bruno/ose-api` folder 12 (the 409 for a draft with no start time or type) and `bruno/ose-pages` folder 1 (one canonical link on the events list, an event page and the landing)                                                                                                     |
| OSE-292            | C       | `tests/playwright/mobile-workability.spec.ts`: the event page before, during and after the event, the poster for a real event and the signed report, at phone, desktop and tablet size                                                                                               |
| OSE-1578           | C, K    | `tests/playwright/poster-to-page-journey.spec.ts`: from the digital poster a tap on the event-page code opens that event page, and the short address printed under the code leads to the same page when typed                                                                        |

## Not written yet, and why

| Story                            | Flow | What the test needs                                                                                                                                                                                 | Blocker                                                                       |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| OSE-1522                         | S4   | The sponsor line on the SharedReport. The report is depth-gated per reader (a sponsor sees only its own rows), so a sponsor list beside the title is a data-contract decision, not a render change. | PO decision (OSE-1630); nothing to test until then                            |
| OSE-1557                         | —    | Tablet content width.                                                                                                                                                                               | PO decision still open (layout at 820px), so no test to be red                |
| OSE-292                          | P3   | An action in view on a phone before the event, and on a laptop during it.                                                                                                                           | PO decision recorded on the epic; the contract is off for those two cases     |
| OSE-1516, OSE-1629               | P    | WebKit runs of the poster layout and landing empty-window browser tests.                                                                                                                            | Not started; both specs run on Chromium only                                  |
| OSE-1525, 1551, 1532, 1524, 1556 | O, M | New screens. Write the red tests when each story is picked up, from its acceptance list.                                                                                                            | Stories are blocked on backend or a decision, and not specified to test depth |
| OSE-1636, 1639, 1640, 1645       | O, M | Second slices of the create flow, Logs, Settings and the SharedReport.                                                                                                                              | Not started; write the red tests in the PR that starts each                   |

## Order of work

1. Pick a story from the red table. Its test already says what done means.
2. Build until its `redStory` reports "now passes".
3. Promote the test, mark it Done here, close the story per the Done gate in CLAUDE.md (merged, then the staging chain green).
4. When a story needs a level that is not written (browser, staging), write that test red first, in the same PR that starts the story.
