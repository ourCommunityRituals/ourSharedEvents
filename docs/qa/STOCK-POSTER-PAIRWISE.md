# Stock posters on stg: pairwise manual test plan

Owner, 2026-11-08: "Create the testing scenarios in pairs to confirm pursue coverage in which can be extrapolating into future scenarios. This is has to be for manual confirmation." And: "Please add failure cases. ALWAYS."

A person runs this by hand on stg (`https://stg.oursharedevents.com`) after a green "Stock data (stg)" run. Every pair of values below appears in at least one scenario. Rows are laid out so a new value (Enterprise, Boutique, a new code kind, a new poster format) is added as more rows, not a rewrite.

## What is being shown

Poster language: the event type suggests which calls to action a poster makes (the event; registration; donation). Each one carries a person from the paper poster into the event's pages privately. `/q` and `/s` stay anonymous (a count and a time, never who). Only a person who chooses REGISTER reaches a form. DONATE leaves the site for its link.

Choice: the type only suggests a starting set ("Choice though. they are not fixed."). The organizer adds or drops any code. The stock build plays the organizer: `stock/poster-code-sets.json` holds each type's suggested set, saved through the organizer's own route (`PUT /api/v2/admin/events/:id/poster-codes`). The app reads nothing from that file.

The poster is the existing one (`/events/<id>/poster`). It draws the event's art whole (`object-fit: contain`), so landscape and portrait both fit with no layout change.

## Factors and values

| Factor   | Values now                                                              | Where a person sets or finds it                                                                                                                                        | Values later                                                    |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Plan     | Local (free), Anchor (mid)                                              | One plan for all of stg. Read it: admin, or `GET /api/v2/admin/flags/current-tier`. Change it: owner only (`POST /api/v2/admin/flags/apply-tier` needs the admin key). | Enterprise, Boutique                                            |
| Code set | Events; Events + Register; Events + Register + Donate                   | The run summary's "Poster showcase" table names one poster per set and art                                                                                             | New code kinds (Tickets, Sign up, ...)                          |
| Art      | Landscape; Portrait                                                     | Same table                                                                                                                                                             | No art; a flyer                                                 |
| Entry    | `/q` (the placement's tracking code); `/s` (the poster's routing codes) | Same table: the `/q (placement)` and `/s codes` columns                                                                                                                | `/e` share link; poster format (print, digital `?kind=digital`) |

What each plan allows, from the code (`POSTER_CODE_LIMITS` in `lib/poster-codes.ts`, counting the event-page code): Local 3, Anchor 5. Every kind is open on every plan. The largest stock set is 3 codes, so every set fits Local.

## Before you start

1. Open the latest "Stock data (stg)" run in GitHub Actions. Its summary must be green, with a "Poster showcase" table of six rows and no "not shown this run".
2. Note stg's current plan, so you can put it back at the end.
3. Use a private browser window for every `/q` and `/s` step: no admin sign-in, a clean cookie jar.

In the steps, `<poster>`, `<q>` and `<s ...>` are the addresses in the showcase row for that scenario's code set and art.

## Pairwise scenarios

Six rows cover every pair of the four factors at least once (plan x set, plan x art, plan x entry, set x art, set x entry, art x entry). Run rows P1, P3 and P6 with stg on Local, then rows P2, P4 and P5 with stg on Anchor.

| #   | Plan   | Code set                   | Art       | Entry |
| --- | ------ | -------------------------- | --------- | ----- |
| P1  | Local  | Events                     | Landscape | /q    |
| P2  | Anchor | Events                     | Portrait  | /s    |
| P3  | Local  | Events + Register          | Landscape | /s    |
| P4  | Anchor | Events + Register          | Portrait  | /q    |
| P5  | Anchor | Events + Register + Donate | Landscape | /s    |
| P6  | Local  | Events + Register + Donate | Portrait  | /q    |

### Steps every scenario shares

1. Open `<poster>`. Expected: the event title, then the sponsor strip, then date and venue on one line, then the art shown whole (no crop) in its orientation, then the codes.
2. Count the codes. Expected: Events = EVENT only; Events + Register = EVENT, REGISTER; Events + Register + Donate = EVENT, REGISTER, DONATE. Each code shows its word and its UEC name in text, not color alone.
3. In admin, open the event's poster codes card. Expected: the plan line reads 3 codes on Local, 5 on Anchor, and the same codes as the poster, in the same order.

### Entry steps

**/q (P1, P4, P6).** In the private window open `<q>`. Expected: a redirect to the event's page (`/events/<id>...`). The page shows the same title and art as the poster. No cookie other than `ose_anon` is set. Nothing asks who you are.

**/s (P2, P3, P5).** In the private window open each `/s` address in the row:

| /s code  | Expected                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| EVENT    | Redirect to the event's page. No cookie is set.                                                                               |
| REGISTER | Redirect to the event's own registration form (`/events/<id>/register`). Nothing is stored until you choose to send the form. |
| DONATE   | Redirect to `https://example.org/donate`, a reserved address that can never take money (owner, 2026-11-08).                   |

### Per-scenario checks

| #   | Check beyond the shared steps                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Landscape art fills the width. The plan line reads 3.                                                                                    |
| P2  | Portrait art is whole, top to bottom, not cropped. The plan line reads 5.                                                                |
| P3  | REGISTER `/s` opens the registration form. Leave the form without sending.                                                               |
| P4  | The placement QR on the admin Placements card encodes `<q>`.                                                                             |
| P5  | DONATE `/s` lands on `https://example.org/donate`. The poster still shows three codes on Anchor (Anchor allows 5; the stock set uses 3). |
| P6  | All three codes print on Local, which allows exactly 3.                                                                                  |

## Failure cases

Each runs once. Put back any change you make (the next morning's run resets stock events anyway).

| #   | Plan   | Do                                                                                                                                                        | Expected                                                                                                                                                                                                                                                                |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Local  | On the P6 event, add a 4th code (for example TICKETS with an https link) and save.                                                                        | Refused: "Your plan fits 3 codes on a poster, including the event page." (403 PLAN_LIMIT). The poster still shows its 3 codes.                                                                                                                                          |
| F2  | Anchor | On any stock event, save 5 codes, then try a 6th.                                                                                                         | 5 save. The 6th is refused with the plan line for 5 (403 PLAN_LIMIT).                                                                                                                                                                                                   |
| F3  | Either | On the P5 event, set the DONATE link to `http://example.org/donate`, then `javascript:alert(1)`, then `data:text/html,x`. Do the same for a SIGN UP code. | Each is refused: "The DONATE link must be a full https:// address." (400 INVALID_TARGET). The saved link is unchanged.                                                                                                                                                  |
| F4  | Either | On the P3 event, take REGISTER off the poster and save. Open its old `/s` REGISTER address.                                                               | The poster no longer shows REGISTER. The old address still opens the registration form: a printed code keeps working. Put REGISTER back.                                                                                                                                |
| F5  | Either | Open `/q/not-a-real-token` in the private window.                                                                                                         | A redirect to the home page, not an error page.                                                                                                                                                                                                                         |
| F6  | Either | Open `/s/ZZZZZZ` and `/s/bad` in the private window.                                                                                                      | The same "not found" answer for both, so probing learns nothing.                                                                                                                                                                                                        |
| F7  | Either | Read the run summary of a run where a save was refused or a pair was missing (or the latest red run).                                                     | Each problem is named, never passed over: `poster codes not saved for <id>: ...`, `poster code <kind> missing for <id>`, `showcase pair not shown: <set> <art>`, or the showcase row `not shown this run`. An edge challenge reads `edge-challenged` with the WAF note. |
| F8  | Either | Choice: on a P1 (Events) poster, add REGISTER and save. Then take it off.                                                                                 | Both save. The event type locks nothing.                                                                                                                                                                                                                                |

## After the run

1. Put stg's plan back to what it was before you started (owner only).
2. Record the run id, the plan used per row, and each row's pass or fail on the Linear testing ticket.

## Adding a value later

- **New plan (Enterprise, Boutique):** add one row per code set, so each set meets the new plan once. Alternate art and entry across those rows so the new plan meets both of each. Add a failure row for its limit (Enterprise: a 9th code is refused).
- **New code kind:** add it to a code set in `stock/poster-code-sets.json`, or as a new set. Add one row per plan for the new set, alternating art and entry. Add a failure row for its target rule (an external kind refuses a non-https link).
- **New art value (no art, flyer):** add one row per code set, alternating plan and entry.
- **New entry or format (`/e`, digital poster):** add one row per code set, alternating plan and art.

Check after adding: every pair of values across the factors appears in at least one row.

## Out of scope now

Enterprise (owner, 2026-11-08: "I only want local and anchor (mid) covered right now as that is what I will be releasing"). A per-brand plan: the plan is one setting for all of stg today. Any mutation testing targets the rule modules (`lib/poster-codes.ts`, `lib/report-depth.ts`, `lib/count-floor.ts`), never the HTML templates (owner, 2026-11-08).
