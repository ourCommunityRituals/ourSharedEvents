# TDD red map: open front-end stories, written as failing tests first

**What this is.** For each open Linear story in the FE project, the tests that will go green when the story is built, and the flow in [E2E-FLOWS-MAP-2026-10-02.md](E2E-FLOWS-MAP-2026-10-02.md) it belongs to. The tests are written first, as `redStory(...)`.

**How a red test works** (`tests/helpers/red-story.ts`, rule pinned by `tests/red-story-helper.spec.ts`):

- The body must fail on an assertion tagged with its story, e.g. `expect(x, '[OSE-1560] a new event starts off the map')`. Any other failure (a typo, a 500, a missing seed) fails the test as _broken, not red_. A bare `it.fails` would hide that.
- While the story is open, the suite is green.
- When the story's work makes the body pass, the test fails with "now passes: promote this test". Remove the `redStory` wrapper (keep the body as a normal test), change the row below to Done, and move the Linear story on.

So the suite goes red exactly when a story lands, and stays red until the test is promoted. `tests/unit/tdd-red-map.test.js` fails if a `redStory` names a story that is missing from this table, or if a row says Done while a `redStory` for it is still wrapped.

**Levels** (same codes as the flows map): U unit, W Worker route + real D1, A API (Bruno on staging), C browser Chromium, K browser WebKit, S staging smoke.

## Red now (written, failing on the right assertion)

| Story    | Flow       | Level | Test (in `tests/tdd-red-fe-wave.spec.ts`)                                                     | Status |
| -------- | ---------- | ----- | --------------------------------------------------------------------------------------------- | ------ |
| OSE-1560 | O1, O2     | W     | a new event is off the map unless someone turns it on                                         | Open   |
| OSE-1560 | O1, O6     | W     | leaving draft without a time and an event type is refused by name (409)                       | Open   |
| OSE-1519 | P3         | W     | a once-live archived event says it has ended (410, named, no error label, next events listed) | Done   |
| OSE-1520 | P1         | W     | `/public` redirects to `/events`                                                              | Done   |
| OSE-1520 | P1         | W     | the `/events` tab title says what the page is                                                 | Done   |
| OSE-1518 | P3         | W     | a live event page carries the trust header                                                    | Done   |
| OSE-1522 | S4, P1, P3 | W     | the `/events` card shows the consented sponsor by the title                                   | Done   |

Guards that are green today and must survive the fixes: a title-only draft can be created (OSE-1560); an unknown event id keeps the generic not-found page, and a draft is not named to an anonymous visitor (OSE-1519; the story leaves what a draft may show to the PO, so this guard turns an accidental leak into a decision).

## Not written yet, and why

| Story                                              | Flow | What the test needs                                                                                                                                                                      | Blocker                                                        |
| -------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| OSE-1566                                           | S2   | Browser test on the three-sponsor staging fixture (real, none, broken logo): each shows an image. A static check cannot find this bug: the form page already contains the fallback code. | Needs a browser at 375px on staging (T4 surfaces leg)          |
| OSE-1518                                           | P3   | Browser: three plain choices under the facts, Register first and full width. Add after the trust header test goes green.                                                                 | —                                                              |
| OSE-1520                                           | P1   | Browser at 375px: the card button stacks under the text below about 480px, title keeps most of the card width.                                                                           | Needs a listed event in the local audit (grace window)         |
| OSE-1531                                           | O, P | Organizer SharedReport ends with an action row including "Repeat this event"; lexicon words absent.                                                                                      | Needs a signed report link seeded in the workers pool          |
| OSE-1522                                           | S4   | The same rule on landing cards, TV display, recap, form pages, SharedReport. Only the `/events` card is written.                                                                         | One test per surface as the audit proceeds                     |
| OSE-1557                                           | —    | Tablet content width.                                                                                                                                                                    | PO decision still open (layout at 820px), so no test to be red |
| OSE-1558                                           | —    | Body content at 200% text fits 320px.                                                                                                                                                    | Browser; the a11y-profile spec has the harness                 |
| OSE-1528, 1525, 1526, 1527, 1551, 1532, 1524, 1521 | O, M | New screens. Write the red tests when each story is picked up, from its acceptance list.                                                                                                 | Stories are not specified to test depth yet                    |

## Order of work

1. Pick a story from the red table. Its test already says what done means.
2. Build until its `redStory` reports "now passes".
3. Promote the test, mark it Done here, close the story per the Done gate in CLAUDE.md (merged, then the staging chain green).
4. When a story needs a level that is not written (browser, staging), write that test red first, in the same PR that starts the story.
