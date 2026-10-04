# Front-end wave progress — 2026-10-04 (corrected)

Legend: ~~struck through~~ = **Done** in Linear. ✅ = merged and the staging chain is green for a `main` SHA that contains it. 🔄 = in progress, with what is left. ⬜ = not started.

Staging chain evidence: run `37195677105` on `d52e475` (contains #774 to #797): T1 Deploy, T2 Bruno, T3 Playwright and all four T4 jobs `success` (`gh run view 37195677105 --json jobs`). The run on `543717b` (#798) was still in progress when this was written. An earlier version of this file said nothing could close yet; that was wrong.

## Wave 1 (#774)

- ~~OSE-1513 Sponsor strip below the title (post-event "Thanks to our sponsors")~~
- ~~OSE-1559 Header wrap + reduced motion moved into `@ocr/ui`~~
- ~~OSE-1431 Sponsor title on sponsor home and report~~
- ~~OSE-1514 Accessibility profile gate (8 surfaces)~~
- ~~OSE-1515 Wizard step 1 (Next never disabled)~~
- Tablet audit project + WebKit sponsor journey: shipped inside #774 (no separate story)

## Wave 2 — merged slices since wave 1 (all ✅ by the run above)

- ✅ #788 `/public` → `/events`, tab title names the page (OSE-1520 slice)
- ✅ #789 Landing map legend readable in dark mode (OSE-1548)
- ✅ #790 Form-page sponsor strip owns its logo fallback (OSE-1566)
- ✅ #791 Archived event page says it has ended (OSE-1519 slice)
- ✅ #792 Trust line under the event title (OSE-1518 slice)
- ✅ #793 Consented sponsor on the events card (OSE-1520 / OSE-1522 slice)

## In progress 🔄 (what is left, from each ticket's own text)

- OSE-1548 Landing map legend: fix merged; check measured contrast and the 400-char budget, then close
- OSE-1566 Form-page logo fallback: fix merged; open item is the second-visit failure of the real logo (explain, fix if ours)
- OSE-1519 Non-public scan page: archived case done; open: shared footer on the error page, and the PO decision on what a draft may show (guard keeps drafts unnamed)
- OSE-1518 Event page: trust line done; open: three plain choices, Register first and full width, Share + Add to calendar pair, next-at-venue and partners on the live page; require What and time is covered by OSE-1560
- OSE-1520 One event card, one filter control: `/public` redirect and title done; open: one card and filter for landing and `/events`, upcoming first with wrapped under its own heading, 4 to 5 chips, button stacks below ~480px, empty-state links
- OSE-1522 Sponsor by the title everywhere: poster and `/events` card done; open: landing cards, TV display, recap, form pages, SharedReport, admin previews
- OSE-1560 Core values at publish: two red tests open (new event off the map; leaving draft needs time and type, 409); three PO questions open in the ticket
- OSE-1556 Brand's own public pages by address (`/b/<brand>`): not built; needs slugs for types and sponsors
- OSE-1564 Toast service: not built; hub `@ocr/ui` component plus a pin bump
- OSE-1568 TDD red layer: merged (#782); stays open until each story's red test is promoted

## Not started ⬜

- OSE-1558 Body content at 200% text: fix written and verified locally on Chromium (`fe/body-200-percent`, not pushed; waiting on the design-check baseline edit)
- OSE-1557 Tablet columns: waiting on a PO decision
- OSE-1516 Poster layout follows the event
- OSE-1521 TV display rebuild + fundraiser screens
- OSE-1524 Live view: sponsor version, scan-area map, report link
- OSE-1525 Manager home
- OSE-1526 Logs screen
- OSE-1527 Settings page
- OSE-1528 Create flow: live preview, review, quick edits
- OSE-1529 Organizer entry and sign-in
- OSE-1531 Report actions + "Repeat this event"
- OSE-1578 Browser-level red tests; OSE-1601 levels 1, 3, 6; OSE-1591 to 1600 pyramid tickets

## Tally

Done 5 stories in Linear (wave 1) · 6 merged slices green on staging, stories still open · 10 in progress · 1 fixed locally and unpushed · 14+ not started.
