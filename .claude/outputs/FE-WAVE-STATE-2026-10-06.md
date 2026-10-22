# Front-end wave — one state page

Read live on 2026-10-06 from Linear, `origin/main` and GitHub Actions. This page replaces the ticket lists in `FE-WAVE-PROGRESS-2026-10-04.md` and the work order (v3) in `CCR-FE-SEQUENCE-STRATEGY-2026-10-06.md`. The CCR findings in that file still stand.

## Where things are

Re-read at about 15:35 UTC on 2026-10-07.

- `main` is at `c57273e5` (#851). The staging chain is green for it (run `37560163193`), so #849, #850 and #851 are confirmed on staging.
- The phone audit is required on GitHub and runs as three legs: phone (required), desktop, tablet.
- **The required phone leg fails on any pull request today** until #853 merges: on the during-the-event page the first action sits at 815px on an 812px screen (it passed on 2026-10-06; nothing on the page changed). #853's third commit takes the above-the-fold contract off that page.
- Open: **#853** (red-test map, poster-to-page journey, the audit change), all checks green, waiting to be merged. **#852** (another thread's security work) got the same audit commit (`56ce9b17`) so it is not held up; its checks are re-running.
- Merged 2026-10-06/07 from this session: #849 (accessibility scan phone first, display at TV size), #850 (Bruno: the 409 and three canonical checks), #851 (canonical test no longer fails between 00:00 and 05:00 UTC).
- Linear on 2026-10-07: OSE-1622 → In Review (Bruno green on staging; four recorded decisions and the sitemap origin are the PO's). OSE-1644 stays In Progress with only the two map toasts left.
- "Branch protection drift" still fails on `main` because the secret `BRANCH_PROTECTION_READ_TOKEN` is not set.
- Production still runs an older build.

**Done today from this session:** OSE-1629 (landing empty window, #843); OSE-1637 (phone audit: limit, required, split, install limits; #837, #839, #848).

**Merged today, ticket still open:** OSE-1644 field marking (#845 wizard, #846 advanced form) and its refused-publish log (#847). Left: the two toasts and the Bruno 409 check. OSE-292: lifecycle surfaces in the audit (#844).

**Decision for the PO, on OSE-292:** the first action sits just below the fold on the before-the-event page on a phone (842px of 812), and on the during-the-event page on a laptop (825px of 800) and, on 2026-10-07, on a phone (815px of 812). Keep an action in view, or accept one short scroll? Until that is answered the audit does not measure it on either page.

## Linear brought in line with the code (2026-10-06, about 12:15 UTC)

| Ticket                                      | Was         | Now       | Why                                                                                    |
| ------------------------------------------- | ----------- | --------- | -------------------------------------------------------------------------------------- |
| OSE-1632 wizard dropped the donate screen   | In Progress | Done      | #836 on `main`, chain green on `f423bec7`                                              |
| OSE-1625 robots rule for the sponsor card   | In Progress | Done      | #831 on `main`, chain green since                                                      |
| OSE-1624 Event JSON-LD and meta description | In Progress | In Review | Merged and green; four differences from its acceptance list wait on the PO             |
| OSE-1623 alias redirects                    | In Progress | In Review | Merged and green; aliases are an inline list, not the shared table the ticket asks for |
| OSE-1556 brand pages                        | In Progress | Backlog   | Nothing built; both blockers missing                                                   |

Commented, state unchanged:

- OSE-1622 canonical URLs: In Progress. Left: the Bruno assertion against staging.
- OSE-1637 phone audit: In Progress. Applied live and the ten-run bar is met (11 runs, none cut off). Left: the job split and a time limit on the browser install steps.
- OSE-1568 red-test layer: In Progress. Left: `TDD-RED-MAP.md` lists five finished stories as not written.
- OSE-1578 browser red tests: Backlog. Most of its list is already on `main`; needs trimming.

Not looked at: OSE-1470 (credentials in traces, #838) against its done list; OSE-1564 stays In Progress (hub only, waits on OSE-1620).

## Closed today (all Done in Linear)

| Closed                         | What is left, and where it lives now                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| OSE-1516 poster layout         | OSE-1628 printed-sheet check; OSE-1517 drag and drop (older ticket); WebKit run noted on OSE-1597 |
| OSE-1520 event card            | OSE-1629 landing empty-window message                                                             |
| OSE-1522 sponsor by the title  | OSE-1630 and OSE-1631 (decisions)                                                                 |
| OSE-1521 TV display            | OSE-1632 donate defect; OSE-1633 fundraiser art; OSE-1634 and OSE-1635 (decisions)                |
| OSE-1528 create flow           | OSE-1636 slice 2                                                                                  |
| OSE-1529 organizer entry       | OSE-1638 Access page text (Cloudflare dashboard)                                                  |
| OSE-1526 Logs                  | OSE-1639 slice 2                                                                                  |
| OSE-1527 Settings              | OSE-1640 slice 2                                                                                  |
| OSE-1518 event page            | OSE-1641 "plant my flag" URL                                                                      |
| OSE-1519 non-public event page | OSE-1642 (decision)                                                                               |
| OSE-1560 map off by default    | OSE-1643 (five decisions); OSE-1644 leftovers                                                     |
| OSE-1531 report actions        | OSE-1645 slice 2                                                                                  |
| OSE-1566 logo fallback         | OSE-1646 (decision)                                                                               |
| OSE-1548 map legend            | none found (see "No home yet")                                                                    |
| OSE-293, 296, 297, 299 mobile  | epic OSE-292 stays open                                                                           |

## Decisions (PO)

**Not on any ticket yet**

- What must be on production by 2026-10-24, and the last day to merge.
- Whether stories that widen what admins or sponsors can read wait for OSE-1561.

**High**

- **OSE-1643**, five questions. Number 4 is the live one: a live event that is off the map has a closed public page, so its codes and short link land on "couldn't find". Confirmed on staging (`pcard-live-evt` returns 404). The publish message says so; the wizard's "No" card says the links keep working.
- **OSE-1620**: the eight toast assumptions. The hub rework waits on this.
- **OSE-1557**: tablet layout a, b or c.

**Medium**

- OSE-1642: what a link to a draft may show.
- OSE-1646: the logo proxy answers 502, or the default image.
- OSE-1630: sponsor line on the SharedReport, and for which readers.
- OSE-1641: the "plant my flag" destination URL.

**Low**

- OSE-1631 relationship labels; OSE-1634 fundraiser progress on the TV; OSE-1635 live scoreboard.

**An action, not a decision**

- OSE-1638: set the Access sign-in page name, logo and text in the Cloudflare dashboard.

## Build queue

**Unblocked now**

1. The required accessibility scan at phone size first, then desktop, then tablet; the display stays at TV size.
2. One Bruno PR: the 409 contract (OSE-1644), the canonical URL check (OSE-1622), confirming the alias redirects (OSE-1623), and the Bruno level of OSE-1601. The red-test map update (OSE-1568) can ride along.
3. Test tickets: OSE-1578 (browser) and the pyramid tickets OSE-1591 to 1600, including the WebKit runs still owed.
4. OSE-1636: create flow slice 2, which includes editing a saved event's start time and type (today that is only possible inside the wizard session that created the event). Its drawings are not in the repo.

Done from this list: OSE-1629 (#843), OSE-1644 field marking (#845, #846), the audit split and install limits (#848).

**After a decision**

- OSE-1643 number 4: the public page of a live off-map event (`handlers/pages.ts`).
- OSE-1620, then OSE-1564 adoption, then the two toasts in OSE-1644.
- OSE-1557 tablet.
- OSE-1524 Live view (security question above).

**Blocked on backend not on `main`**

- OSE-1640 Settings slice 2: needs OSE-1553 (brands table).
- OSE-1639 Logs slice 2: the records it would show are not stored anywhere yet.
- OSE-1645 (the campaign part) and OSE-1525 Manager home: need OSE-1552.
- OSE-1556 brand pages: needs OSE-1555 and OSE-1553.
- OSE-1633 fundraiser art screen: no artwork exists.

**Needs a person**

- OSE-1628: a real printed poster with real artwork.

**Rewrite or cancel before work**

- Cancel as superseded: OSE-1331 (by #806), OSE-1334 (by #811).
- Rewrite: OSE-1329, 1330, 1333, 1336; OSE-1335 (asks for a TV clock that #814 removed); the text of epic OSE-292.
- Check then close: OSE-1332.

## No home yet

- **OSE-1548** is Done, but one session reported that the rendered legend's contrast was never measured (staging has no real map until ten events are listed). No follow-up ticket was found.
- **OSE-1566** is Done. Two items a session reported open (the second-visit failure never explained; the browser test not red before the change) are not in OSE-1646's title. Its body was not read.
- A longer time on screen for QR screens on the TV was noted on OSE-1521 and not ticketed.
- The wave tickets were closed on the staging chain while their pyramid tickets are still Backlog. The repo's Done gate asks for all seven levels; this was the PO's choice on 2026-10-06.
- Three items written into new tickets as "not checked": whether the staging Access page was updated, whether the "ERROR 404" label was dropped, whether the refused-transition log was built.

## On disk

- 30 local story branches carry the old slice names and hold no commits (all level with `main` or an older `main`). `test/mobile-workability-baseline-report` is merged.
- Worktrees whose work is merged: `ose-wt-mobile-baseline`, `ose-wt-wizard-donate`.
- Worktree in use: `ose-wt-1560c` (this session's working folder; its last two branches are merged).
- Untracked in the main folder: this file, the CCR worksheet, and `.telemetry/`.
