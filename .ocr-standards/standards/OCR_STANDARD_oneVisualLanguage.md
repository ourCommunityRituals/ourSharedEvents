# OCR Standard — One visual language

**Status:** Proposed (needs the owner's review) · **Owner:** OCR governance · **Date:** 2026-11-28 · **Decision record:** [ADR-014](../adr/ADR-014-one-visual-language-across-every-app-and-partner.md)

## Rule

Every screen in every OCR app uses the same building blocks, in the same places, the same way.
Only the **labels** change between apps, partners and roles.

- **Apps:** ourSharedEvents, ourWKRP, ourAirwaves, ourSharedMagnets, ourSharedGames, ourSharedRecords, ourSharedPulse, and every white-label or partner deployment.
- **Partners:** bars and venues, event organizers, schools and boosters, places of worship, government and village services, leagues.
- **Why:** these groups work together. A person who volunteers at a church fundraiser, referees a league game and checks in at a bar night should never have to relearn the screen.

## The building blocks

| Block | What it is | Use it for |
|---|---|---|
| **Tabs** | A row across the top; one tab = one phone screen | Splitting a page into parts (Schedule · Roles · Board) |
| **Chips** | Small one-tap pills, one or many selected | Picking: nights, roles, categories, filters |
| **Cards** | A boxed item with a picture or code, a title, must-knows and one button | Any item in a list: an event, a shift, a game, a sponsor |
| **Buttons** | Big, one tap, a short verb that names the outcome | Every action ("Take this shift", "Check in") |
| **Deeper Dive** | An arrow plus the words "Deeper Dive"; tap to open, tap to close | The longer explanation, never the must-knows |
| **More** | A button that shows the next screen of items | Long lists (6 rows a screen, then More) |
| **UEC colours** | The Universal Event Code colours, with a word or glyph beside each | Codes, map cells, categories, everywhere |

## The screen rules

- **One phone screen per tab.** No scrolling (375 × 812 baseline). Too much for one screen means another tab, paging, or More.
- **Must-knows stay on screen.** Price, cash only, sign-up needed, age limits: on the card, never behind Deeper Dive.
- **Reading level: 5th to 8th grade.** Short words, short labels, cards and buttons instead of paragraphs.
- **Taps at least 44 px** (org floor, invariant #14; the hub targets 48). Input text at least 16 px.
- **Colours only from the hub tokens** (`packages/tokens`). Colour is never the only signal.
- **Same pattern, new labels.** Before designing a new screen, copy an existing one (below) and change the words.

<details>
<summary>Deeper Dive: the same pattern, three partners</summary>

A sign-up uses one layout everywhere: tabs **Schedule · Roles · My shifts**, chips for the night, a card per slot with one button.

| Partner | Tab labels | Chip labels | Card button |
|---|---|---|---|
| Boosters (school) | Games · Roles · My shifts | Fri · Sat · Gate · Concessions | Take this shift |
| League | Games · Referees · My games | Week 3 · Court 1 · Court 2 | Take this game |
| Church fundraiser | Days · Helpers · My times | Sat · Sun · Kitchen · Setup | Sign me up |

The person who learned one already knows the other two.
</details>

<details>
<summary>Deeper Dive: reference screens to copy</summary>

- **Create an event or sponsor in two screens:** ourSharedEvents draft PR 1593 (create flows).
- **Tabs and chips for roles:** the boosters roles mockups (project files, `boosters/mockups/`).
- **Tabs, More and a big table on one screen:** leagues, ourSharedEvents PR 1584.
- **Deeper Dive:** hub `packages/ui/src/styles.ts` (`.deeper-dive`, `.needs-you` when the person needs it to act); ourSharedEvents `src/lib/deeper-dive.ts`.
</details>

<details>
<summary>Deeper Dive: Deeper Dive details</summary>

- One name and one icon everywhere. Never "More info", "Details", "Learn more" or "How X works ›" for the same thing.
- A real control: `<details class="deeper-dive"><summary>Deeper Dive</summary>…</details>` or a button with `aria-expanded` and `aria-controls`. Enter and Space open and close it; focus is visible.
- Highlighted (`.needs-you`) only when the person needs that information to finish an action.
- Text inside also reads at a 5th to 8th grade level.
</details>

<details>
<summary>Deeper Dive: where each block lives</summary>

- **One home:** the hub, `ourCommunityRituals/packages/ui` (`@ocr/ui`). Apps consume it through their `.ocr-hub-ref` pin (ADR-008). An app never builds its own tabs, chips or Deeper Dive.
- **Both forms:** each block is in the shared stylesheet (server-rendered pages) and in `@ocr/ui/react` (ourAirwaves and later React apps), with the same class names.
- **Skins** (ourAirwaves self-serve) may change the brand accent, images and words. They never change the blocks, their order, tap sizes or the screen rules. Same rail as "never tier-gated" in the ourAirwaves proposal.
- **Languages:** labels are translated strings; the layout never changes by language.
</details>

<details>
<summary>Deeper Dive: how this relates to other standards</summary>

- **Mobile workability** (`OCR_STANDARD_mobileWorkability.md`, invariant #14): sets the measurable floors (no sideways scroll, 44 px taps, 16 px inputs, CTA above the fold). This standard adds the shared blocks and the one-screen-per-tab rule on top.
- **Hub design system** (`packages/ui/design-system/README.md`): colours, type, contrast, "choice, made easy". This standard does not repeat them.
- **One layer map** (ADR-013): maps follow that ADR; a map sits inside a tab like any other block.
</details>

## Space and flow (owner, 2026-11-28)

Keep the clean, modern look. Use more of the screen, keep the breathing room, and make moving from screen to screen feel like one smooth app.

- **Pictures go edge to edge;** text keeps a 16 px side margin. The picture gets more room without crowding words.
- **Space by grouping, not boxes.** 8 px inside a group, 16 to 24 px between groups. Fewer borders inside cards.
- **One spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 px, as named hub tokens. The 12 px gap between taps never shrinks.
- **Fit the real screen:** size one-screen tabs with `svh`/`dvh` and the phone's safe areas, so browser bars and notches never push the button off screen.
- **Thin, sticky top and bottom:** the header shrinks once you move; tabs stay pinned; the main button sits at the bottom, in thumb reach.
- **Screens flow into each other:** the event picture on a card grows into the event page header; tabs slide left or right in the direction you tapped; Deeper Dive opens smoothly.
- **Quick and calm motion:** 150 to 250 ms, easing out. Instant for anyone who turns motion off. Nothing moves under a finger.
- **Fresh comes from the content:** event art, photos and short muted loops change; the blocks, colours and layout rules do not. Event lists may mix card sizes; sponsor cards stay the same size (fairness covenant).

<details>
<summary>Deeper Dive: our rules next to modern web practice</summary>

Hub rules read from `packages/ui/design-system/README.md` and `src/styles.ts`, hub main `2c6699c`.

| Topic | Ours today | Modern practice (2026) | Gap and recommendation |
|---|---|---|---|
| Spacing | Exact values: page 16 to 20 px, section 24, card 16 | A 4 px base scale held as tokens | Add named space tokens (4 to 32) so every app spaces alike |
| Taps | 48 px, 56 px primary, 12 px gap | 44 to 48 px, spacing between taps matters as much as size | Ahead of practice. Keep |
| Screen height | `100dvh` in one place | `svh`/`dvh`/`lvh` plus safe-area insets | Use `svh` for one-screen tabs, `dvh` for full-screen panels |
| Pictures | Fixed frame, crop photos, fit flyers | Full-bleed media, fixed aspect ratio while loading | Make the frame full-bleed on phones |
| Separation | Lines and radius, no shadows | Flat with lines, or light elevation | Keep lines (it is the modern flat look); optional later: one soft shadow for sheets only |
| Screen-to-screen | Plain page loads | View Transitions: shared pictures morph, tabs slide | Add it. Works with no framework |
| Open/close | Deeper Dive snaps open | Smooth height (`interpolate-size`, `@starting-style`) | Animate open and close, instant under reduced motion |
| Lists of pictures | Scroll-snap in one place | Snap rows for galleries | Use snap rows for photos only, never for must-knows |
| Reduced motion | Honoured | Honoured | Keep |
</details>

<details>
<summary>Deeper Dive: screen-to-screen motion, who gets it</summary>

- **Cross-page View Transitions** (`@view-transition { navigation: auto; }`): Chrome and Edge 126+, Safari and iPhone 18.2+, about 90% of users (caniuse, October 2026). Firefox and Samsung Internet do not have it yet: they just load the page normally, so nothing breaks.
- **Same-page transitions** (tabs, Deeper Dive, React in ourAirwaves): in every major browser since October 2025.
- **How a shared picture morphs:** the card picture and the page header carry the same `view-transition-name` (one per event). One CSS rule in the hub, no script.
- Sources: [caniuse](https://caniuse.com/cross-document-view-transitions), [web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available), [Chrome docs](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document), [web.dev tap targets](https://web.dev/articles/accessible-tap-targets).
</details>

## Navigation (owner, 2026-11-28)

The same three layers in every app, so a person always knows where they are and how to get back.

**Simple is better** (owner). Three layers and no more. Every move is a visible tap; swipes and gestures are extras, never the only way. When two designs both work, pick the one with fewer parts.

| Layer | What | Rules |
|---|---|---|
| **1. Bottom bar** | Moving between the big parts of an app | 3 to 5 slots, icon plus a word, always visible, in thumb reach. Same slot order in every app; only the words change |
| **2. Top tabs** | Parts of one page | Sticky under the header; the selected tab is marked by more than colour |
| **3. Drill in and back** | Opening one item (an event, a shift, a game) | A back arrow top left; the phone's back button and swipe always work |

- **Never hide the main places in a hamburger menu.** Hidden menus get used far less; the bottom bar keeps them in sight.
- **Every tab and item has its own web address.** Back, refresh and sharing a link all land on the same screen.
- **Motion tells direction:** going deeper slides in from the right, back slides out to the right, top tabs slide toward the tab you tapped, and bottom-bar switches fade (they are siblings, not a path).
- **The bottom bar slots** (proposed, every app): **Home · Find · Mine · More**. Find holds the map and search; Mine holds what you signed up for, your shifts or your profile; More holds settings and help. Labels are translated and may change per app (for example "My shifts"), but the order stays.

**Staying oriented in the flow**

- **Every screen says where you are:** a short title, plus one context line above it ("Juniper Grove boosters · Friday game").
- **The bottom bar and top tab always show which one you are in.**
- **Steps show progress:** a flow of more than one screen shows "Step 1 of 2" and dots; going back never loses what you typed.
- **The picture you tapped comes with you:** the card picture grows into the page header, so you see what you opened.
- **Back returns you to the same spot:** the same tab, the same place in the list, the same filters (chips) still picked.
- **Every flow ends on a done screen** that says what happened and gives one next step ("You're signed up · Add to calendar").

<details>
<summary>Deeper Dive: navigation next to modern practice</summary>

| Topic | Ours today | Modern practice (2026) | Recommendation |
|---|---|---|---|
| Main places | ourAirwaves: bottom bar. ourSharedEvents and ourWKRP: links per page, no shared bar | Bottom navigation bar, 3 to 5 places (Material 3, Apple tab bar) | One shared bottom bar in the hub, used by every app |
| Inside a page | Hand-built tabs per page | Sticky top tabs or a segmented control | Shared hub tabs (next step 1) |
| Hidden menus | Some pages | Avoid for main places; fine for rarely used items | Main places in the bar; rare items under More |
| Back | Browser back, varies by page | Every screen has a real address; back always works | Rule above; test it in CI |
| Direction | No motion | Forward and back slide; sibling switches fade | View Transitions with direction (works without a framework) |
| Where am I | Varies | Active slot shows icon, word and a filled marker | Hub marks the active slot one way for all apps |

Sources: [Material 3 navigation bar](https://m3.material.io/components/navigation-bar/guidelines), [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [NN/g on hidden navigation](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/), [Chrome view transition types](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document).
</details>

## One flow for every layer (owner, 2026-11-28)

The same flow on a phone for everyone who puts on an event: a backyard party, a park meetup, a regular at a bar, the bar itself, the rec center, an art fair booth and the art fair. Only the size changes.

1. **Create one event** (the two-screen create flow). On the map or off it: the host chooses.
2. **Make it a campaign if it repeats:** "every Friday for 8 months", "once a month". All the dates appear as **drafts**.
3. **See the drafts right away** on a calendar and on the map, before anyone else can.
4. **Group campaigns into a season** ("Fall season": trivia, pinball, Saturday one-offs).
5. **Review and launch together:** look over every draft, approve, then **Launch**. Everything goes live on the map at once.
6. **Share it:** each launch comes with a ready share kit (links, QR posters, a short post) for the host's own social channels.
7. **Watch the response, counts only:** interest from the posters going up until the event (scans, link opens); then the door (check-ins); then inside the event (scans of the QR codes there).
8. **Come back to Mine:** only your own events, campaigns and seasons, with draft, live and finished marked.

**Depth grows with the layer** (owner, 2026-11-28). Same screens, more of them switched on as the host grows. Nobody sees steps they do not need.

| Layer | Who | What they see |
|---|---|---|
| Single | A person, a backyard party, a park meetup | Steps 1, 6, 7 and 8: create, share, counts, Mine. No campaigns, no review |
| Organizer | A league, a booth, a regular night | Adds campaigns (2) and the draft calendar and map (3) |
| Anchor | The bar, the rec center, the art fair, the owner of the property | Everything: seasons, the full draft review, the detailed preview, one Launch, and the **property footprint**: every event happening on their place, on one calendar and map |

- **The framework does the organizing.** The columns, states (draft, approved, live, finished) and groupings are set for the anchor, so they just fill them in.
- **Why one app:** today these steps are spread over separate tools that each cover one slice. ourSharedEvents covers the whole circle: create, campaign, launch, share, the landing page people find it on, the door, and the report. That is what speeds up every organizer, whatever size their event.
- **Who sees the footprint and the report** (owner, 2026-11-28): whoever uses the service, the client who hired it. If the bar is the client, the bar sees every event on its account and gets the report. Events someone else runs on their own account stay theirs.

- **Sponsors on an anchor's events** (owner, 2026-11-28): local sponsors attached to an event are in, at the local tier; the anchor is at least mid-level, possibly premium. Higher tiers get more advertising as **more often** (more rotations, more events), never a bigger or better spot: same size, same spots for every sponsor, and locals keep at least 30% of the rotation.

<details>
<summary>Deeper Dive: how sponsors rotate on screens (owner, 2026-11-28; proposed)</summary>

- **Every screen change is a fresh sponsor turn:** each TV display cycle and each phone page that opens.
- **1 or 2 sponsor spots per turn,** all the same size.
- **With 2 spots:** one always holds a paying sponsor (anchor, mid or premium); the other rotates through the locals.
- **Who comes next is picked by the math:** whoever is furthest behind their paid share so far goes next. The shares are the ones already live in `ocr-docs-brain/sponsor-allocation.yaml` (`share_of_voice`): mid buys 3x, premium 7x base frequency; locals hold at least 30% together; no premium above 40%, no mid above 20%; nobody below 2%.
- **The anchor is at least mid** for this math.
- **Paying also buys a fuller SharedReport** (owner, 2026-11-28): the features per tier are in `ocr-docs-brain/tier-gates.yaml`. Every tier keeps the same privacy rules and the under-5 floor.
- **With only 1 spot** (owner, 2026-11-28): the spot takes turns by the shares above, so locals keep their 30%.
- Changing `sponsor-allocation.yaml` is a separate governance PR.
</details>

- **Two kinds of behaviour, kept apart:** *interest before* the event and *taking part at* the event. Seen side by side over a season, they show how the local economy behaves.
- **Never who, only how many.** Every number is a count with the under-5 floor ("Fewer than 5"). Interest is never a list of people.

<details>
<summary>Deeper Dive: what ourSharedEvents already has, and what is missing</summary>

Read from ourSharedEvents main `adde6ff`, route table in `src/router.ts` and `migrations/`.

| Step | Have today | Missing |
|---|---|---|
| 1 Create | Two-screen create, save as draft or publish (PR 1593) | Off-map choice in the same flow (check) |
| 2 Campaign | `event_series` (migration 0033): declare a series, attach events; "repeat" makes one draft copy (OSE-1531) | Make all the dates of a series as drafts in one step |
| 3 See drafts | Brand calendar feed `/brands/:brand/calendar.ics` (published events); attendee map | A private draft preview on a calendar and the map |
| 4 Season | Nothing | A season that groups campaigns and one-offs |
| Footprint | Venues and booths per event | One anchor view of every event on its property |
| 5 Launch | Publish one event at a time | Review list and one Launch for many drafts (audited) |
| 6 Share | Share links `/e` `/p` `/r` `/c`, posters with QR (OSE-1684) | One share kit per launch or season |
| 7 Watch | Poster scans `/q`, share opens, check-ins, booth scans, SharedReport | One timeline per campaign: interest before, door, inside |
| 8 Mine | Admin dashboard per brand | A "Mine" view of your own seasons, campaigns and drafts |
</details>

## How it is tested (the test pyramid)

A rule counts only when a test fails if an app breaks it. Each new test is watched failing on purpose first (born red).

**Checks that already run today**

- **Hub design check** (`check-spoke-styles.mjs`, ourSharedEvents and ourWKRP CI, blocking): colours only from tokens; a page's own CSS may only shrink.
- **Mobile workability** (invariant #14, ourSharedEvents `tests/playwright/mobile-workability.spec.ts`): no sideways scroll, 44 px taps, 16 px inputs, main button visible at 375 × 812.
- **One screen per create step** (ourSharedEvents `tests/playwright/admin-wizard-isolation.spec.ts`).
- **Accessibility scans** (ourSharedEvents `a11y-axe` specs).
- **This PR itself** is docs: docs CI and the ADR edge check run on it. Docs cannot be unit-tested; the rules become tests as the blocks are built.

<details>
<summary>Deeper Dive: which layer tests which rule, once built</summary>

| Layer | Where | What it proves |
|---|---|---|
| **L0 structure** | Hub check, every app's CI | No app ships its own tab, chip or Deeper Dive class; no "Learn more" / "Details ›" labels; no raw colour; only hub space tokens |
| **Unit** | Hub (`@ocr/ui`) | Tabs, chips, Deeper Dive, bottom bar, More: 44 px+, `aria-selected`/`aria-expanded`, Enter and Space work; sponsor turn picker keeps locals ≥ 30% and caps over thousands of turns |
| **Contract** | Each app vs the hub | The page uses the pinned hub's markup (snapshot of class names); every tab and item answers at its own address |
| **Component / visual** | Hub, light and dark | Screenshots of each block at 375 px; reduced motion turns transitions off |
| **E2E on staging** | Playwright, each app | Every tab fits one phone screen; back returns to the same tab and filters; bottom bar same order in every app; create → drafts → Launch → Mine works |
| **Mutation** | Hub and the turn picker | A changed tap size, floor or share math is caught by a failing test |
| **Cross-app** | Brain check (`check_brain_contract.py`) | Every app's pin includes the shared blocks; a lagging pin is flagged |
</details>

## Where apps differ today

Read on default branches, 2026-11-28. Method in the PR description.

- **Hub (`@ocr/ui`):** has Deeper Dive (CSS only). No shared tabs or chips. The React kit has `BottomNav` but no Tabs, Chips or DeeperDive.
- **ourSharedEvents:** pinned to current hub main, uses Deeper Dive in 3 source files. Tabs and chips are hand-built per page (about 10 source files).
- **ourWKRP:** pinned to an older hub commit (`b039d2f`, 22 Oct) that has no Deeper Dive. Uses its own `.filter-chip`. No tabs.
- **ourAirwaves:** uses `@ocr/ui/react`, with a bottom nav instead of top tabs. No chips or Deeper Dive yet.
- **ourSharedMagnets, Games, Records, Pulse:** docs only; no screens yet, so they start on this standard.

## Next steps (not done in this PR)

1. Add shared **tabs** and **chips** to the hub (CSS + React), with tests for 44 px taps and keyboard use.
2. Add **DeeperDive**, **Tabs** and **Chips** to `@ocr/ui/react`.
3. Bump ourWKRP's hub pin; swap `.filter-chip` for the shared chips.
4. Move ourSharedEvents' hand-built tabs onto the shared ones, page by page.
5. Decide (owner): top tabs vs the ourAirwaves bottom nav. See ADR-014, open question Q1.
6. Add the space tokens, full-bleed frame, View Transitions and smooth Deeper Dive to the hub (one hub PR), then show them on one ourSharedEvents page on staging before rolling out.
7. Build the tests in "How it is tested", starting with the L0 hub check and the unit tests for each block.
