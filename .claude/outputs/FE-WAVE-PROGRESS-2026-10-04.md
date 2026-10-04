# Front-end wave progress — 2026-10-04 (second update)

Legend: ~~struck through~~ = **Done** in Linear. ✅ = merged and the staging chain is green for a `main` SHA that contains it. 🔄 = in progress. 📬 = PR open (CI and review pending; not merged). ⏸ = PR open and held, with the reason. ⬜ = not started.

Staging chain evidence (read with `gh run view <id> --json jobs`; T1 Deploy, T2 Bruno, T3 Playwright and T4 all `success`):

- run `37195677105` on `d52e475` (contains #774 to #797)
- run `37201744298` on `57126b7` (contains #800)
- run `37204489944` on `94c0167` (contains #803)

## Wave 1 (#774)

- ~~OSE-1513 Sponsor strip below the title~~
- ~~OSE-1559 Header wrap + reduced motion moved into `@ocr/ui`~~
- ~~OSE-1431 Sponsor title on sponsor home and report~~
- ~~OSE-1514 Accessibility profile gate (8 surfaces)~~
- ~~OSE-1515 Wizard step 1 (Next never disabled)~~
- ~~OSE-1523 Uniform palette~~

## Wave 2 — Done

- ~~OSE-1558 Body content at 200% text~~ (#803, `94c0167`, staging chain green)

## Wave 2 — merged slices ✅ (stories still open)

- ✅ #788 `/public` → `/events`, tab title names the page (OSE-1520)
- ✅ #789 Landing map legend readable in dark mode (OSE-1548)
- ✅ #790 Form-page sponsor strip owns its logo fallback (OSE-1566)
- ✅ #791 Archived event page says it has ended (OSE-1519)
- ✅ #792 Trust line under the event title (OSE-1518)
- ✅ #793 Consented sponsor on the events card (OSE-1520 / OSE-1522)
- ✅ #800 Core values at publish: leaving draft needs a start time and an event type (OSE-1560, part 1)

## Open PRs 📬 (opened 2026-10-04; each leaves its ticket In Progress)

- 📬 #806 OSE-1529 Organizer entry: landing create cards and the sign-in page explain themselves. Left: apply the Access login page name, logo and text in the Cloudflare dashboard (not in this repo); confirm on staging that the `#create-event` fragments survive the Access redirect.
- 📬 #807 OSE-1526 + OSE-1527 Logs and Settings, read-only first slices. Logs: Activity, System jobs, Security; Cost says "Not recorded yet". Settings: read-only defaults, plan, timings, "fixed for everyone". Left: refused sign-ins and rate-limit trips per brand, the nightly form-data clean-up record, real cost data, editable brand defaults (needs storage), the other settings sections.
- 📬 #808 OSE-1518 + OSE-1519 Three plain choices (Register first and full width), Share + Add to calendar pair, next-at-venue on the live page, shared footer on the error page. Left: "plant my flag" link to ourWKRP (needs a destination URL); the PO decision on what a draft may show.
- ⏸ #809 OSE-1560 Map off by default and the organizer-only sponsor flip (draft, held). Blocker: the public event page returns the generic 404 for any event not on the map (`handlers/pages.ts` ~1815), so a live event with the map off would have a dead QR code and short link. Needs the PO decision: off the map = unlisted but reachable by its link, or hidden entirely. Toast part waits on OSE-1564.
- 📬 #810 OSE-1531 SharedReport ends with next actions; "Repeat this event" is a server-side clone (`POST /api/v2/admin/events/:id/repeat`) that lands as a draft. Left: same-campaign and sponsor carry-over (needs OSE-1552), the map-preview banner, a dedicated prefill screen, WebKit coverage.
- 📬 #811 OSE-1516 Poster layout follows what the event has (art, code count 1 to 8). Left: persisting named spots, drag and drop (separate story), a real printed PDF, WebKit coverage.
- 📬 #812 OSE-1520 + OSE-1522 One event card and one chip control for landing and `/events`, upcoming first; sponsor by the title on landing cards, the landing map legend and the TV. Left: SharedReport sponsor line (depth-gated per reader; PO data-contract decision), an empty-window message on the landing. Review note: most of the design-check baseline drop moved CSS into a TS constant, which the ratchet does not measure.
- 📬 #814 OSE-1521 TV display board rebuilt for distance (120px headline at 1080p, 22px floor, QR to the event page, sponsor under the title); donate-QR pane from a saved https link; opt-in per-sponsor screens. The clock, ticker and "1/3" sponsor counter are removed. Left: fundraiser art (no artwork exists), any amount or goal on screen (needs a data source and a never-who review), a per-screen dwell. Known gap: the admin wizard's TV step still saves its own pane list and drops `donate` until the TV card is saved again.
- 📬 #815 OSE-1528 Create flow: live preview beside the form (no network on typing), a review step with the core values, and in-place edits. Left: poster beside the fields, participation and partner steps, empty/failed states, editing after publish. It raised the wizard-fits-one-viewport ceiling from 2 to 2.5 screens because the preview sits below the form on a phone. Edits `admin.html`, so expect conflicts with #809 and #814 when one of them merges.
- 📬 hub #51 OSE-1564 Toast component in `@ocr/ui` (success, failure, neutral). Left: after it merges, bump `.ocr-hub-ref` (also refresh `package-lock.json`), add the `/ui-toast.js` route, adopt it in admin and sponsor home, request-reference round trip, browser tests on both engines.

## Still in progress, no new PR

- OSE-1548 Landing map legend: fix merged; check measured contrast and the 400-char budget, then close
- OSE-1566 Form-page logo fallback: fix merged; open item is the second-visit failure of the real logo
- OSE-1556 Brand's own public pages by address (`/b/<brand>`): not built; needs slugs for types and sponsors
- OSE-1568 TDD red layer: merged (#782); stays open until each story's red test is promoted

## Not started or waiting ⬜

- OSE-1557 Tablet columns: waiting on a PO decision (a, b or c in the ticket)
- OSE-1524 Live view and OSE-1525 Manager home: wait for the `admin.html` PRs above to merge
- OSE-1578 Browser-level red tests; OSE-1601 levels 1, 3, 6; OSE-1591 to 1600 pyramid tickets

## PO decisions needed

1. Off the map: unlisted but reachable by its link, or hidden entirely (unblocks #809).
2. Tablet layout (a, b or c) for OSE-1557.
3. "Count me in" before the event: the check-in form has no server-side phase check, so a tap before the event counts as a check-in (from #808).
4. Destination URL for "plant my flag" (OSE-1518).
5. SharedReport: may a sponsor line sit beside the title for every reader, or only for the sponsor's own rows (OSE-1522).
6. What a draft may show on the not-found page (OSE-1519).

## Tally

Done in Linear: 7 stories (wave 1 plus OSE-1558) · 7 merged slices green on staging, stories still open · 10 PRs open (one held, one in the hub repo) · OSE-1620 filed for the revised toast (hub PR #51 needs rework first) · 2 waiting on admin PRs · 1 waiting on a PO decision.

Toast: the PO revised the look and behaviour on 2026-10-04; the spec is OSE-1620 (child of OSE-1564) and replaces the 2026-10-03 table.
