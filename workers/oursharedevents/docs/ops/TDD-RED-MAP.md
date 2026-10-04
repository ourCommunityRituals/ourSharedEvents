# TDD red map: open front-end stories, written as failing tests first

**What this is.** For each open Linear story in the FE project, the tests that will go green when the story is built, and the flow in [E2E-FLOWS-MAP-2026-10-02.md](E2E-FLOWS-MAP-2026-10-02.md) it belongs to. The tests are written first, as `redStory(...)`.

**How a red test works** (`tests/helpers/red-story.ts`, rule pinned by `tests/red-story-helper.spec.ts`):

- The body must fail on an assertion tagged with its story, e.g. `expect(x, '[OSE-1560] a new event starts off the map')`. Any other failure (a typo, a 500, a missing seed) fails the test as _broken, not red_. A bare `it.fails` would hide that.
- While the story is open, the suite is green.
- When the story's work makes the body pass, the test fails with "now passes: promote this test". Remove the `redStory` wrapper (keep the body as a normal test), change the row below to Done, and move the Linear story on.

So the suite goes red exactly when a story lands, and stays red until the test is promoted. `tests/unit/tdd-red-map.test.js` fails if a `redStory` names a story that is missing from this table, or if a row says Done while a `redStory` for it is still wrapped.

**Levels** (same codes as the flows map): U unit, W Worker route + real D1, A API (Bruno on staging), C browser Chromium, K browser WebKit, S staging smoke.

## Red now (written, failing on the right assertion)

| Story    | Flow       | Level   | Test (in `tests/tdd-red-fe-wave.spec.ts`)                                                                                                                            | Status |
| -------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| OSE-1560 | O1, O2     | W       | a new event is off the map unless someone turns it on                                                                                                                | Open   |
| OSE-1560 | O1, O6     | W       | leaving draft without a time and an event type is refused by name (409; promoted, story stays open for the map default)                                              | Open   |
| OSE-1519 | P3         | W       | a once-live archived event says it has ended (410, named, no error label, next events listed)                                                                        | Done   |
| OSE-1520 | P1         | W       | `/public` redirects to `/events`                                                                                                                                     | Done   |
| OSE-1520 | P1         | W       | the `/events` tab title says what the page is                                                                                                                        | Done   |
| OSE-1518 | P3         | W       | a live event page carries the trust header                                                                                                                           | Done   |
| OSE-1518 | P3         | W, C, K | three plain choices, share pair, next at this venue (`tests/event-page-choices.spec.ts` in the Worker suite; browser: `tests/playwright/event-page-choices.spec.ts`) | Done   |
| OSE-1519 | P3         | W       | the error page uses the shared footer (`tests/event-page-choices.spec.ts`; what a draft may show is still a PO decision)                                             | Done   |
| OSE-1522 | S4, P1, P3 | W       | the `/events` card shows the consented sponsor by the title                                                                                                          | Done   |

Guards that are green today and must survive the fixes: a title-only draft can be created (OSE-1560); an unknown event id keeps the generic not-found page, and a draft is not named to an anonymous visitor (OSE-1519; the story leaves what a draft may show to the PO, so this guard turns an accidental leak into a decision).

## Written alongside the work (plain tests, each seen red before its change)

| Story    | Level | Test                                                                                                                                                                                                                                                                     |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OSE-1520 | U, W  | `tests/event-card-filter.spec.ts`: one card (landing = /events card), upcoming first, wrapped under its own heading, five chips, heading follows the filter, one count sentence, empty states link wider, stylesheet (button stacks under 480px, `font: inherit`, sizes) |
| OSE-1520 | C     | `tests/playwright/sponsor-surfaces-journey.spec.ts`: at 375px the button stacks under the text and the title keeps the card, on /events and the landing; same date, place and Register on both                                                                           |
| OSE-1522 | U, W  | `tests/event-card-filter.spec.ts` (landing card sponsor, list API `sponsor_titles`), `tests/display-pane-rotation.spec.ts` (TV featured event and "also coming up")                                                                                                      |
| OSE-1522 | C     | `tests/playwright/sponsor-surfaces-journey.spec.ts`: the sponsor is on the /events card, the landing card and the TV featured event after Accept, and off them after Decline                                                                                             |

## Not written yet, and why

| Story                                              | Flow | What the test needs                                                                                                                                                                                                                                                                          | Blocker                                                        |
| -------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| OSE-1566                                           | S2   | Browser test on the three-sponsor staging fixture (real, none, broken logo): each shows an image. A static check cannot find this bug: the form page already contains the fallback code.                                                                                                     | Needs a browser at 375px on staging (T4 surfaces leg)          |
| OSE-1531                                           | O, P | Organizer SharedReport ends with an action row including "Repeat this event"; lexicon words absent.                                                                                                                                                                                          | Needs a signed report link seeded in the workers pool          |
| OSE-1522                                           | S4   | SharedReport and the admin previews. SharedReport: the report is depth-gated per reader (a sponsor sees only its own rows), so a sponsor list beside the title is a data-contract decision, not a render change. Admin previews are the event page and poster, covered by their own stories. | PO decision (SharedReport); nothing to test until then         |
| OSE-1557                                           | —    | Tablet content width.                                                                                                                                                                                                                                                                        | PO decision still open (layout at 820px), so no test to be red |
| OSE-1558                                           | —    | Body content at 200% text fits 320px.                                                                                                                                                                                                                                                        | Browser; the a11y-profile spec has the harness                 |
| OSE-1528, 1525, 1526, 1527, 1551, 1532, 1524, 1521 | O, M | New screens. Write the red tests when each story is picked up, from its acceptance list.                                                                                                                                                                                                     | Stories are not specified to test depth yet                    |

## Order of work

1. Pick a story from the red table. Its test already says what done means.
2. Build until its `redStory` reports "now passes".
3. Promote the test, mark it Done here, close the story per the Done gate in CLAUDE.md (merged, then the staging chain green).
4. When a story needs a level that is not written (browser, staging), write that test red first, in the same PR that starts the story.
