# ADR-027: Cap the landing list at 10 and add a More action

**Status:** Proposed (2026-11-10). The owner decided D1, D1a, D3 and D4 on 2026-11-10. D2, D5 and
D7 are open; D6 follows from D1a. Nothing in it is built.
**Date:** 2026-11-10
**Deciders:** Owner (PO). Dr of Security advises on D7; the Data Scientist confirms the count rule.
**Ticket:** OSE-1977 (Feature OSE-1976, epic OSE-1320)

## Context

The owner's request (2026-11-10), quoted exactly: "When >10 events are listed in list form, cut off
the list at 10 and place a More button underneath in an action button. This will announce there is
more events after the user selects, the next 10 will load."

**What the code does today** (`main` at `1095872c`):

- `renderLandingArea` (`workers/oursharedevents/src/lib/landing-area.ts`) renders **every** upcoming
  event as a card. There is no cap. `LIST_MAX = 10` only decides whether the map or the list leads
  the page (OSE-1312), and the landing latch keeps the map leading once an area has reached it.
- The filters (window, Type by category, Where) are CSS-only: hidden radios plus
  `#id:checked ~ .area .event-card:not(.cls){display:none}` rules, built by `hide()`. The chosen
  filter lives only in the browser. It never reaches the server or the address.
- The **default** filter already hides cards: the default window is `next-90`, so an event more than
  90 days out is in the page but not shown until the visitor picks a wider window.
- In map view the same card list sits under the map (OSE-1354). A zoomed area (`?area=<res-7 cell>`)
  and a searched place (`?zip=`, a town name) render the same list, narrowed on the server.
- `/events` (`lib/event-discovery.ts`, `renderEventList`) shares `renderEventCard` but not the list.
  Its filters are server-rendered links (`?when=`, `?q=`) and it has no cap either.
- `GET /api/v2/events` returns every active event with no paging. The admin list
  (`GET /api/v2/admin/events`) has cursor paging, `limit` clamped to 1–100 (`handlers/events.ts`).
- `/` is not wrapped in `publicReadLimited` (`router.ts`, the "Landing page" block). `/near`,
  `/api/v2/events` and `/api/v2/events/map` are.
- The landing already carries one inline script ("Use my location", `src/templates/landing.html`)
  under the page CSP `script-src 'self' 'nonce-…'; connect-src 'self'`
  (`handlers/pages.ts` `securityHeaders`).
- The public pages are in four languages since PR #1175: `en`, `es`, `pl`, `ar` (Arabic right to
  left). `fmtCount` picks only `one` or `other`, which is not enough for Polish (`few`, `many`) or
  Arabic (`two`, `few`, `many`).

**The design problem.** `nth-child` counts hidden cards. A plain CSS cap of 10 therefore fails under
any filter, including the default one: pick "This weekend" and the first 10 cards in server order can
all be hidden, so the page shows nothing while weekend events sit past the cut. The rule every option
must keep:

> **A filter never shows an empty first page while matching events exist.**

## Decision

Items 1, 2, 4 and 5 are decided by the owner (2026-11-10). Items 3, 6, 7 and 8 are this ADR's
recommendations; each becomes the decision only when the owner answers it. Answers are recorded in the **Owner answers**
table, and the status moves to Accepted when the code lands.

1. **Mechanism (D1, decided): reveal in place (option B).** The server keeps rendering every card,
   as today, so the filters stay correct. A small block added to the landing's one inline script
   (beside "Use my location", under the page's existing nonce) shows the first 10 _visible_ cards
   and hides the rest; More reveals the next 10 within the current filter. No request, no storage,
   no cookie. "The next 10 will load" means **they appear**, not that they are fetched.
2. **No-JS behaviour (D1a, decided): every card shows**, exactly as today (variant B1). There is no
   `?n=` parameter, no parser and no new route.
3. **Scope (D2): the landing first** (`/`, `/es/`, `/pl/`, `/ar/`, including a zoomed area and a
   searched place). `/events` follows in its own story.
4. **The card list under the map (D3, decided): the same cap**, on a page led by the map and in a
   zoomed area. The map itself still draws every area.
5. **Wording (D4, decided):** the button reads "Show 10 more events", and "Show 1 more event" or
   "Show the last 3 events" when fewer remain. After a tap an `aria-live="polite"` line reads
   "Showing 20 of 34 events", and focus moves to the first new card. The text is in every page
   language. One detail is still to confirm: which label applies when 2 to 10 remain (see D4).
6. **Filter change (D5):** changing window, Type or Where resets the cap to 10 inside the new filter.
   Switching between List and Map does not.
7. **Step (D6):** a fixed step of 10, named `LIST_STEP` and kept separate from `LIST_MAX`.
8. **Rate limit (D7):** a separate story. Paging under B does not change what a request to `/`
   costs; the landing's missing rate limit is a real gap, but not this Feature's.

### How option B works (for the code stories)

- The server marks each card with its position in the server order (`data-pos`) and renders, after
  the last card, a hidden block: one `btn btn-primary` button from `@ocr/ui` (no new component, no
  new colour) and one `role="status"` line. Every string is rendered on the server in the page's
  language. The button label has only ten possible values (1 to 10 left), so all ten are rendered
  as data on the block; the status line uses the CLDR plural forms of the page language, chosen in
  the script with `Intl.PluralRules`.
- On load, and on every `change` of a filter radio, the script counts the cards the filter leaves
  visible, adds a cap class to visible cards after the cap, and shows or hides the block. A tap moves
  the cap by `LIST_STEP`. Nothing leaves the page.
- More adds no history entry. Back leaves the page; returning shows 10 (or the browser's own
  back-forward cache state). A reload shows 10.
- **One script, not two.** `tests/landing-where-unit.spec.ts` asserts the landing has exactly one
  `<script>` and checks its ban list (storage, `document.cookie`, `fetch(`, `sendBeacon`,
  `XMLHttpRequest`, `history.`) against that script. The More code goes into the same script, so the
  existing gate covers it. If a later change ever needs a second script, the bans must apply to every
  script on the page, not the count be raised.
- The More code also uses no geolocation, no inline `on*=` handler, no `innerHTML`,
  `insertAdjacentHTML`, `eval`, `Function`, string timers, script creation or `import()`, and reads
  no `location.search`, `location.hash` or `document.referrer`. It shows and hides cards by toggling
  a class or `hidden` only. No catalog string (`{{t:…}}`) is filled inside the script: labels travel
  in escaped DOM text or attributes, because `fillTemplate` fills the whole template and a string
  there would land in a JS context. A structural invariant spec (OSE-1980) reads the More block by a
  marker comment and fails if any of these appear.
- **Fail open to the full list.** Cards are hidden by the script only, never by default CSS, so a
  script error leaves every card showing.

## Alternatives Considered

The comparison asked for by OSE-1977:

| Concern             | A. Server `?n=`                                                                                                                                                                                         | B. Reveal in place (proposed)                                                                                        | C. Fetch from a paged public read                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Without JS          | Works: 10 cards and a More link.                                                                                                                                                                        | B1: every card shows (today). B2: adds A's `?n=` link for the default filter only.                                   | The server renders the first 10 only, so without JS there is no way on.                                                   |
| Cookies and storage | None.                                                                                                                                                                                                   | None.                                                                                                                | None needed, but the script now talks to the network.                                                                     |
| New read surface    | None. One new public input (`n`) on `/`.                                                                                                                                                                | None. B2 adds the `n` input.                                                                                         | A new paged public read and a cursor contract under ADR-016 and org invariant 16. It must sit behind `publicReadLimited`. |
| Enumeration         | No change: `/` already lists everything.                                                                                                                                                                | No change.                                                                                                           | Small in itself (`/api/v2/events` already returns everything), but a cursor is a new handle to reason about.              |
| Crawlability        | Good: each step is a URL; canonical stays `/`.                                                                                                                                                          | Good: every card is in the HTML.                                                                                     | Worse: cards after the first 10 exist only after a script runs.                                                           |
| Filter correctness  | **Breaks the rule.** The filters are client-only, so a More link either drops the visitor's choice or the filters become a GET form (each tap a page load: a reversal of the OSE-1312 CSS-only design). | Correct: the cap counts visible cards in the current filter.                                                         | Hard: the server must apply the client's filters (so they enter the request) or the script fetches pages until 10 match.  |
| Per-request cost    | `n` must be clamped so it never costs more than the full list.                                                                                                                                          | Unchanged.                                                                                                           | Each tap is a new D1 read.                                                                                                |
| Test cost           | Parser, clamp, reflection, canonical, goldens per `n`.                                                                                                                                                  | Renderer markup (node), script behaviour (Playwright), the invariant spec. B2 adds A's parser tests.                 | Everything in B, plus the endpoint's contract, cursor, rate limit, refusal of coordinate input, and the Bruno suite.      |
| Mutation targets    | The parser (whole file) and the `n` lines in `handlers/pages.ts` (a range).                                                                                                                             | The cap markup in `landing-area.ts` (already a whole-file target). The script is checked by Playwright, not Stryker. | B's targets plus the new handler (a range) and the cursor codec.                                                          |

### Alternative A: server page parameter (`/?n=20`)

The server renders the first `n` cards and a More link to `/?n=n+10`.

**Not proposed because:** the filters live only in the browser, so the server cannot know which cards
are visible. Under any non-default filter the first page can be empty while matches exist, which
breaks the rule above. Making the filters a GET form fixes that but turns every filter tap into a
page load and reverses the OSE-1312 design.

### Alternative B2: reveal in place, plus `?n=` for no-JS visitors

As B, with a `<noscript>` More link to `/?n=20` that works for the default filter only. This was the
recommendation filed on OSE-1976.

**Rejected (owner, D1a, 2026-11-10: "No, show all cards").** The default filter already hides
events past 90 days, so the server cap would have to count default-window cards only while keeping
every other card in the page for the other windows; that needs a second set of CSS rules keyed on
three radios at once. It adds a public input (a fat-finger and reflection surface) for a small share
of visitors, and crawlers already get every card under B1.

### Alternative C: fetch the next 10 from a new paged public read

The script fetches, for example, `/api/v2/events?cursor=…&limit=10` and appends cards.

**Rejected (owner, D1, 2026-11-10).** It adds a public read surface and a cursor contract (ADR-016,
org invariant 16) to page a list the page already holds in full. The script would either build
cards in the browser (a second card renderer and an `innerHTML` path to keep safe) or take HTML fragments from a
new endpoint. The filters would either enter the request or force repeated fetches. If C is ever
chosen, the cursor must be opaque, must never carry a brand chosen by the caller, the endpoint must
return `toPublicEvent` output only inside the ADR-016 envelope, and it must refuse coordinate-shaped
input as `/api/v2/events/map` does.

## Owner decisions (D1–D7)

Each lists the options, the trade-offs, and the recommendation.

### D1. Mechanism (decided 2026-11-10)

- **Owner: "B: reveal in place"**, and **D1a: "No, show all cards"** without JS (variant B1). No
  new request, input or surface; correct under every filter. Without JS the list is not cut.
- Weighed and not chosen: B2 (B plus a `?n=` no-JS link for the default filter), A (server `?n=`,
  which breaks the filter rule unless the filters become a GET form), and C (fetch, a new public
  read and cursor contract for a list the page already holds).

### D2. Scope

- **Landing only, `/events` as a follow-up story (recommended).** `/events` filters are already in
  the address (`?when=`, `?q=`), so a server `?page=` fits there and is a different design; doing
  both at once doubles the test matrix.
- Both now, on one shared pattern: one story, but the two pages work differently.

### D3. The card list under the map (decided 2026-11-10)

- **Owner: "Yes, same cap".** The card list under the map shows 10 cards and More, as in list view,
  on a page led by the map (10 or more events, or latched) and in a zoomed area (E9, E10). The map's
  hexagons and dots are not capped.
- Weighed and not chosen: no cap under the map (the list would run long exactly where it is
  longest).

### D4. Wording and announcement (decided 2026-11-10)

- **Owner: "Yes, use it"**, to the wording recommended on OSE-1976: "Show 10 more events", and
  "Show 1 more event" or "Show the last 3 events" when fewer remain. After a tap an
  `aria-live="polite"` line says "Showing 20 of 34 events" and focus moves to the first new card.
- The strings are in every page language (en, es, pl, ar), with the full CLDR plural forms Polish
  and Arabic need.
- **One detail to confirm.** Scenario H1 expects "Show 5 more events" with 5 left, but the decided
  wording uses "Show the last N events" when fewer than 10 remain. Proposed rule: more than 10 left,
  "Show 10 more events"; 2 to 10 left, "Show the last N events"; 1 left, "Show 1 more event". H1
  then reads "Show the last 5 events".
- Weighed and not chosen: a single "Show N more events" form, and a plain "Show more events" with no
  number.
- These are counts of **events**, never of people (AGENTS invariant 1). The under-5 floor is for
  counts of people, and anyone can count the cards; `/events` already prints "3 upcoming events".
  The Data Scientist confirms this in the backend story (OSE-1978).

### D5. A filter change after More

- **Reset to 10 inside the new filter (recommended).** Each filter starts a fresh list; the first
  page is never empty while matches exist.
- Keep the revealed count (for example 20) across filter changes: fewer taps for someone who
  compares filters, but a filter change can then open a long list.
- List ↔ Map does not reset either way: it is the same list.

### D6. Step and ceiling

- **A fixed step of 10, `LIST_STEP`, applied by the script and kept separate from `LIST_MAX`
  (recommended).** After D1a there is no URL parameter and no ceiling to clamp: every card is
  already in the page. An unknown query parameter on `/` (`?n=abc`, `?more=1`) is ignored, and the
  page is the same as `/` (scenario F1).
- A step that grows (10, then 20, then all): fewer taps on a long list, but the button's promise
  changes with each tap.
- "Show all" after the first 10: one tap, but a 35-card list comes back in one go, which the cut-off
  exists to avoid.

### D7. Rate limit on `/`

The Dr of Security read (2026-11-10, from source, no tests run):

- `/` is already an unlimited, uncached read. Every request reads up to 1000 event rows with no
  cache (`data-provider.ts`, "No CF cache for the list"), plus the latches, the sponsor titles, the
  type catalog and the street map. `?area=` and a searched place let a caller look up events area by
  area, the same reason OSE-1247 gave for limiting `/api/v2/events/map`. Neither `/`, its language
  prefixes, its five aliases nor `/events` is wrapped.
- **Paging does not change that cost under A or B.** Every row is still read and filtered in the
  Worker; B renders exactly what is rendered today. Under C the new endpoint must be wrapped from its
  first PR.
- The edge layer keys on `CF-Connecting-IP`. The invariant-3 gate (`cf-ip[a-z-]+` in
  `tests/poster-deployments-h3-tagging.spec.ts`) explicitly allows it as a rate-limit bucket key,
  and logging it is gated by `tests/log-never-who.spec.ts`. That exception is written only in code
  and tests, not in AGENTS.md or an ADR.
- Wrapping `/` needs: an HTML 429 page in the page's language (`publicReadLimitResponse` returns
  JSON today); every route that serves the landing; and a plan for venues behind one shared address,
  since the edge limit is 60 per 10 s per scope per address, so the 61st load from one venue's Wi-Fi
  in 10 s is refused. A higher `max`, or counting without refusing (as `/q` does), are the options.
  The limiter keeps failing open.
- No gate lists which public reads are wrapped; a new public read could ship unwrapped.

Options:

- **Its own story, outside this Feature (recommended).** Paging under B adds no cost, so D7 does not
  block the cut-off. The story covers the HTML 429, every landing route and `/events`, the
  shared-address threshold, a gate that lists the wrapped public reads, and writing the
  `CF-Connecting-IP` bucket-key exception into AGENTS.md invariant 3.
- Wrap `/` in this Feature: the landing gets a limit sooner, but the paging PRs then carry an HTML
  429, four languages and a venue-Wi-Fi threshold that have nothing to do with More.
- Leave `/` unlimited: today's posture, with the uncached read and the area-by-area lookup left
  open.

## Consequences

### Positive

- The owner's cut-off at 10 holds on every filter, in list and map view, in four languages, with no
  new read surface, input, request or storage (under B1).
- Every card stays in the HTML, so search engines and no-JS readers keep the full list.
- The cap logic sits in `landing-area.ts`, already a whole-file Stryker target (OSE-1824), so its
  mutants are covered by the required check from the first PR.

### Negative

- The landing's one inline script grows, and the cut-off depends on it: without JS the list is not
  cut (B1).
- The script's behaviour (visible-card counting, focus, live region, rapid taps, Back) is reachable
  only in a browser, so it is tested by Playwright and the phone audit, not by node specs or Stryker.
- The button and status strings need full CLDR plural forms in Polish and Arabic, which
  `fmtCount` does not provide today.

### Neutral

- `LIST_MAX` (map leads) and `LIST_STEP` (page size) are both 10 by coincidence. They are separate
  constants so that changing one never moves the other.
- `/events` keeps its uncapped list until its own story.

## Invariants touched, and how each holds

| Invariant                                            | How it holds under B1                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AGENTS 1, never who / org 7, aggregate-only          | The only numbers are counts of events on the page.                                                                      |
| AGENTS 2, the under-5 floor                          | Does not apply to event counts (the Data Scientist confirms in OSE-1978); no count of people is added.                  |
| AGENTS 3, place, not person                          | The paging code reads no `CF-IP*` header, no `request.cf` and no geo. D7 is where this is weighed for the rate limiter. |
| AGENTS 4, no cookies on public surfaces / org 1      | No cookie, no storage, no identifier. Gate: OSE-1980's invariant spec and a workers-pool `Set-Cookie` check.            |
| AGENTS 8, design system / org 14, mobile workability | `btn btn-primary` from `@ocr/ui`, colours from tokens only, one `<h1>`, a 44 px target at 375 px, light and dark.       |
| Map refresh by visitor choice                        | Nothing is pulled; More only shows what the page already holds.                                                         |
| Org 16, API response schema stability                | Untouched under B. It applies only if C is chosen.                                                                      |

If the owner's answers add a new rule (for example "the landing More makes no request"), it is
listed in `OCR-docs/ocr-docs-brain/architectural-invariants.yaml` enforcement locations through a
spine PR (OSE-1980).

## Implementation Notes

The stories under OSE-1976, in dependency order: docs (OSE-1984), invariants (OSE-1980), backend
(OSE-1978), frontend (OSE-1979), CI/CD wiring (OSE-1982), the test pyramid (OSE-1981), mutation
(OSE-1983). Their criteria were updated on 2026-11-10 to match D1a: no `n` parameter, no parser,
and F1 is "an unknown query parameter on `/` is ignored". D3–D5 block the frontend story. The
scenario matrix (H1–H5, R1–R4, E1–E10, F1–F5, S1–S7) is on OSE-1976.

## Owner answers

| Decision | Answer                                                                                        | Date       |
| -------- | --------------------------------------------------------------------------------------------- | ---------- |
| D1       | "B: reveal in place"                                                                          | 2026-11-10 |
| D1a      | "No, show all cards" (without JS every card shows; no `?n=`)                                  | 2026-11-10 |
| D2       | open                                                                                          |            |
| D3       | "Yes, same cap"                                                                               | 2026-11-10 |
| D4       | "Yes, use it" (the wording recommended on OSE-1976; the label for 2 to 10 left is to confirm) | 2026-11-10 |
| D5       | open                                                                                          |            |
| D6       | follows from D1a: a step of 10, applied by the script; no URL parameter                       | 2026-11-10 |
| D7       | open                                                                                          |            |

## References

- Linear: OSE-1976 (Feature), OSE-1977 (this ADR), OSE-1312 (list or map leads), OSE-1354 (cards
  under the map), OSE-1824 (Type by category), OSE-1547 (doors under the cards).
- ADR-016 (API v2 response contract), relevant only to option C.
- ADR-024 (the `ose_anon` cookie and invariant 4).
- `workers/oursharedevents/src/lib/landing-area.ts`, `src/handlers/pages.ts` (`handleLandingPage`,
  `securityHeaders`), `src/templates/landing.html`, `src/lib/public-read-limit.ts`.

## Revisit Criteria

- If the landing ever holds enough events that rendering every card slows `/` measurably (record the
  latency at the matrix maximum, 35 events, in OSE-1978), revisit C or a server cap.
- If the filters move into the address (for shareable filtered links), A becomes correct and simpler.
- When `/events` gets its own paging story, check that the two pages word More the same way.
