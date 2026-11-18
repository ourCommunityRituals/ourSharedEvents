---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 85
pr: 1417
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 0, low: 0 }
---

# CCR: ADR-040 decided text (Voting S1, OSE-2123)

Date 2026-11-18. Five loops. Repo `main` at `0459690a`. Subject: ADR-040 as amended by draft PR #1417, branch `adr-040-presence-amendment` at `f64c61c5`.

**Subject.** The decided text of ADR-040: "an anonymous vote is a counter on an object, never a row about a voter". OSE-2123 asks for a CCR on the decided text at the 95% gate, with the Dr of Security in it.

**Class.** `architecture` (an ADR), so 5 loops. The run follows the owner's 2026-11-02 ruling: all five loops ran on the same text, nothing changed between them, and the results are taken together.

**What this CCR did not change.** It edits no ADR, no ticket and no code. Every fix below is a proposal. The owner decides.

## Verdict

| Item                  | Result                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cumulative score      | **0%**. Loop 1 alone scored 0.                                                                                                           |
| System score          | **85%** after the owner's answers, draft PR #1420 and the confirmation pass (addendum 4). It was 0% at the end of the run, then 54%.     |
| Assessment confidence | 70 → 74 → 78 → 80 → 82. It rose in every loop. Loop 5 checked the citations and merged double counts.                                    |
| Gate                  | **Stop.** 85% is under 95%. Two owner questions are open: Q13 (a secret random voter floor) and Q14 (one vote feeding two results).      |
| Security Critical     | **None.** Nothing is built. G2 is an accepted reduction (Q8 A), not a fix.                                                               |
| Recommendation        | Merge #1420 if the owner agrees with its two flagged points. Close K3, H7, K8 and Q8-2, then run a confirmation loop on the merged text. |

**Why the score was 0 at the end of the run.** One Critical and 15 High findings were open. Most are quick. About half are wording or consistency fixes in the ADR. About a third are ticket updates. Six need the owner.

**The one finding that matters most (F1).** As written, the room-screen QR opens the vote page directly. The presence ticket only comes from the poster scan, on the way to the event page. So a person who scanned the poster and then the room screen arrives at the vote page with no ticket. Every vote from the room screen would be refused. No ticket owns the fix, and the obvious fixes (a cookie, browser storage) need their own review.

## What was reviewed

- **In scope:**
  - The decided text of ADR-040 on the PR #1417 branch: decisions 1 to 10, the owner's answers table, Still open, Consequences, Implementation Notes.
  - Its fit with AGENTS.md invariants 1 to 5 (and 6 to 9 in loop 4).
  - The reopen rule (decision 4).
  - The participation measure (decision 8).
  - The tickets: OSE-2122 to OSE-2132 and OW-220, read from Linear on 2026-11-18.
- **Out of scope:**
  - Decision 6's design choice (E-plus). It was reviewed in the presence CCR (#1416, `CCR-S0-PRESENCE-2026-11-18.md`). Here we only checked that the ADR states the owner's Q1 to Q5 answers faithfully.
  - The 2026-11-17 readiness CCR (#1407, reverted in #1413). Used as background only.
  - OurWKRP's code. Production. Real phones.
- **Evidence:** source at `main` `0459690a`, cited per finding. The ADR line numbers are from the PR #1417 branch file. The ticket text was read from Linear. No runtime test was run. Nothing is built, so every finding is about the design text.

## Loop 1

Team: dr-of-security, role-data-scientist, role-product-owner

Critical layer: what is true versus assumed. The most dangerous assumption is that the presence ticket reaches the vote. It does not on the room-screen path. `/q` redirects only to `/events/:id?type=&deployment=` (`handlers/qr-scan.ts:100-108`), while decision 5 has the room screen open `/events/:id/vote` directly (ADR l.82). Other assumptions that did not hold:

- "The event's end" is a fixed point. It is a date-only `end_date` that is nullable and editable (`migrations/0001:15`, `handlers/events.ts:1274`).
- The owner's D5 answer applies to every number. The ADR applies it to the winner only.
- The tickets match the amended ADR. Several still describe the earlier plan.

Findings: F1 to F14 and T1 to T11 in the register. That is 1 Critical, 10 High, 7 Medium and 6 Low (F11 was later merged into G1).

Score: 0%

## Loop 2

Team: dr-of-security, role-backend-architect

Conservative layer: assume a hostile brand admin, a hostile attendee with one phone, and a builder who follows the text literally. The floor does not hold in three places:

- **Live counters (G1).** The set counters S2 adds can be read during the night. With one song open, that is a live per-song count.
- **The lone voter (G2).** One person with 8 browsers can learn a lone voter's side.
- **N1 (G3, G4).** The OurWKRP route is bound by none of decision 4's rules. Its token is not tied to a brand.

Build traps: the timestamp gate misses `votable_objects` (G5). The open check runs outside the write batch (G6). The pepper epoch is undefined (G7). No rate limit is named (G8).

Findings: G1 to G14 (4 High, 7 Medium, 3 Low at the time).

Score: 19%

## Loop 3

Team: dr-of-security, role-frontend-integration

Adversarial layer: play the attacker and walk the real surfaces.

- **Attacks the text resists.** A copied ticket fails (it is bound to the cookie). A ticket from another event fails. A cross-site POST arrives with no cookie (SameSite=Lax).
- **Attacks it does not stop:**
  - A ticket hash built as the scan key links one browser across events through logs (H3).
  - In-app QR scanners have separate cookie jars, so "scan again" cannot rescue a scan made in another app (H2).
  - A named team player sits beside their own "not for me" count (H5).
  - Remote voting from a poster photo is not on the house-rule card (H6).
- **The surface gaps.** Nothing links the event page to a voter page (H1). The fun report is a new public surface with no gates (H7).
- **Correction from this loop.** T5 lowered to Low: S5 bans votes per scan, while decision 8 publishes voters per device. Only the names clash.
- **Dissent recorded.** The Dr of Security asked for G2 to drop to Medium. It was kept at High.

Findings: H1 to H11 (3 High, 6 Medium, 2 Low at the time).

Score: 36%

## Loop 4

Team: dr-of-security, role-qa-automation, role-scrum-master

Compliance layer: does the text comply with the repo's written rules?

- **Invariants.** 3, 6, 7, 9, the two databases, LLM-free and the admin write guard pass. Invariant 4 is ticketed (S1g). Invariants 1 and 2 say "no exceptions", but decision 9 accepts inference risks under them with no governed note (K1).
- **Security docs.** No threat-ledger entry (K4). The vote POST is an unclassified public mutation (K5).
- **Quality gates.** "A set is final" has no born-red fault. "The ticket is stored nowhere" has no gate. "Receipts survive a reopen" is checked at the mock layer only.
- **Process.** The ticket blocker lines disagree with the ADR (K6). N3 is not linked to each story (K7). S4a and S3 are too big for one session (K3).

Findings: K1 to K10 (3 High, 6 Medium, 1 Low at the time). Six of them repeated earlier rows and were merged with no new deduction.

Score: 38%

## Loop 5

Team: dr-of-security, role-product-owner

Recursive layer: was the assessment honest?

- **Citations re-checked.** Eight key citations were re-checked against source. F1, F3, F5, G1 and G2 hold. F2 is partly overstated: a date-only event ends at the end of its start day (`lib/event-datetime.ts:404-405`), so only a timed event with no end stays "on". The core point holds: the end can move, and nothing is one-way.
- **Merges.** H1 into F1, H3 into F4, G14 into F5, K2 into F2, K9 into F3, H6 into the open wording item.
- **Ticket-level rows lowered one step.** G4, G6, G7, H4, H9, K1, K4 and K5 (protocol 3.4, bidirectional correction).
- **F1 stays Critical, not Security Critical.** It blocks every room-screen vote, but it leaks nothing.
- **New findings.** L5-SEC-1: decision 6 says "a room of 150 gets presence today", but the S0 runs passed 2.5 times the edge binding's 60 per 10 s, and no loop explained why. L5-SEC-2: nothing says the room-screen QR must point at OSE and not at an OurWKRP short link.
- **Decision 6 is faithful to Q1 to Q5.** Q2 is at l.97, Q3 at l.98, Q4 at l.99, Q5 at l.100-102, and Q1 is in decision 9 at l.139-142.

Findings: L5-SEC-1, L5-SEC-2 (2 Medium).

Score: 90%

## Findings register

"Loop" is where a row was first found. A withdrawn row was merged into the row named and costs nothing.

| Id       | Severity | Loop | Finding                                                                                                                                                                                                                           | Evidence                                                                      | Status                                                                                                       |
| -------- | -------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F1       | Critical | 1    | The room-screen QR opens the vote page directly, but the presence ticket comes only from `/q`'s redirect to the event page. Room-screen votes are refused. Nothing links the event page to a vote page (H1).                      | `qr-scan.ts:100-108`; ADR l.58, 82, 86, 98; `pages.ts:1240-1290`; OW-220      | closed: Q6 A and the pass (decision 6, PR #1420); OSE-2133 created                                           |
| F2       | High     | 1    | Reopen safety rests on "the event's end", which is a movable, nullable date. No one-way "final" state exists, and no test checks one (K2).                                                                                        | `0001:15`; `events.ts:1274, 1744`; `event-phase.ts:188`; ADR l.78             | closed: Q10 one-way final lock (decision 4, PR #1420); S2, S3, S5 tests                                      |
| F3       | High     | 1    | Decision 1 deletes receipts "when the set closes". Decision 4 lets a closed set reopen and says receipts survive. The reopen case is tested at the mock layer only (K9).                                                          | ADR l.54, l.78                                                                | closed: decision 1, deleted at final (PR #1420); S4a staging reopen case                                     |
| F4       | High     | 1    | The ticket's "hash of the cookie value" is not defined as keyed and per event. The ticket rides in a URL that reaches logs and history. It could equal the scan key and link one browser across events (H3).                      | ADR l.86; `wrangler.toml:107-108`; `qr-scan.ts:190`; `scan-node-key.ts:18-20` | closed: the pass design, decision 6 (PR #1420)                                                               |
| F5       | High     | 1    | D5 asked for 10 voters "before any winner or per-object count". The owner said "At least 10 for a number to be shown". Decision 7 applies 10 to the winner only.                                                                  | ADR l.32, 108-114; readiness worksheet D5                                     | closed: Q7, decision 7 (PR #1420)                                                                            |
| F6       | High     | 1    | Up, "not for me" and voter counts are not one nested chain, so unanimity can show (10 voters, 10 up).                                                                                                                             | ADR l.108, 129; `count-floor.ts:124-147`                                      | closed: Q8, no per-object number (decision 7, PR #1420)                                                      |
| F7       | High     | 1    | Participation names `floorNestedCounts` and `flooredRatePct`. The repo rule for a published chain is `floorPublishedChain` (round, then chain-floor).                                                                             | ADR l.129; `count-floor.ts:170-175`                                           | closed: decision 8, floorPublishedChain (PR #1420)                                                           |
| F8       | Medium   | 1    | Which counter decides a winner is not said. The margin is tested on rounded counts (10 vs 9 publishes as 10 vs 5).                                                                                                                | ADR l.109-114; `count-floor.ts:159-167`                                       | closed: decision 7, up counts and secret margin (PR #1420)                                                   |
| F9       | Medium   | 1    | The participation denominator is not named. A builder's query can fall below the voter count, or can be summed per hour. It then fails closed to nothing.                                                                         | `scan_node_returns`; `shared-report.ts:779`; `data-subject.ts`                | closed: decision 8, denominator named (PR #1420)                                                             |
| F10      | Medium   | 1    | The team-total rule ("only when every part clears 5") differs from `floorTotalOfParts`, which drops small parts and sums the rest.                                                                                                | ADR l.116; `count-floor.ts:79-86`                                             | closed: decision 7, no totals published (PR #1420)                                                           |
| F11      | Medium   | 1    | Invariant 2 for admin screens is implied, not stated.                                                                                                                                                                             | ADR l.106-116                                                                 | withdrawn: merged into G1                                                                                    |
| F12      | Low      | 1    | Decision 6 leaves out the presence CCR's rulings: no ticket on the uncounted path, a missing key fails closed, where a browser keeps its ticket, expiry past midnight.                                                            | presence worksheet l.141-143; R2 gate 6                                       | closed: decision 6, mint rules (PR #1420)                                                                    |
| F13      | Low      | 1    | "Six new tables" against five listed.                                                                                                                                                                                             | ADR l.185, 49-52                                                              | closed: decision 1, five tables (PR #1420)                                                                   |
| F14      | Medium   | 1    | `vote_participants`: its key domain and its deletion are not stated.                                                                                                                                                              | ADR l.52-54                                                                   | closed: decision 1, participant key and deletion (PR #1420)                                                  |
| T1       | High     | 1    | No ticket owns the `/q` change that issues the presence ticket, and no gate checks that it is stored nowhere.                                                                                                                     | ticket text of OSE-2122 to OSE-2132                                           | closed: OSE-2133 created                                                                                     |
| T2       | High     | 1    | S4a (OSE-2128) lacks the presence CCR's gates: cookie-hash mismatch, expiry, missing key, uncounted path, constant-time compare.                                                                                                  | OSE-2128; presence worksheet R2                                               | closed: OSE-2128 rewritten                                                                                   |
| T3       | High     | 1    | N2 (OSE-2126) still builds the cap and says "Blocks S4a". It has no hold and no triggers, and it cites a "decision 12" that does not exist. S0's blocker line is stale.                                                           | OSE-2126; ADR l.100-102                                                       | closed: OSE-2126 held with triggers; no longer blocks S4a                                                    |
| T4       | High     | 1    | S4b (OSE-2129) has no "scan again" message, and its house-rule list lacks "a script" and "zero or not".                                                                                                                           | OSE-2129; ADR l.99, 139-140                                                   | closed: OSE-2129 rewritten                                                                                   |
| T5       | Low      | 1    | S5 bans a "votes-to-scans ratio" next to decision 8's voters-per-device rate. Only the names clash (lowered in loop 3).                                                                                                           | OSE-2130; ADR l.127                                                           | closed: OSE-2130 rewritten                                                                                   |
| T6       | Medium   | 1    | N5 is not among OSE-1193's children. The D10 row says N1 to N5 were created. The Implementation Notes call them "proposed".                                                                                                       | ADR l.37, 203; Linear children list                                           | closed: Implementation Notes and D10 row (PR #1420)                                                          |
| T7       | Medium   | 1    | N4 lacks R6 (`assert_minted_min`). N3 lacks the new gate list.                                                                                                                                                                    | OSE-2132; OSE-2131                                                            | closed: OSE-2131 and OSE-2132 updated                                                                        |
| T8       | Medium   | 1    | The ADR index still lists ADR-040 as Proposed, and #1417 does not change it (an OSE-2123 acceptance item).                                                                                                                        | `docs/adr/README.md:58`; #1417 changes 2 files                                | closed: index row Accepted (PR #1420)                                                                        |
| T9       | Low      | 1    | OSE-2123's acceptance says one open item. The ADR has two (report detail, wording).                                                                                                                                               | OSE-2123; ADR l.150-153                                                       | closed: OSE-2123 acceptance names the open items                                                             |
| T10      | Low      | 1    | The D11 row does not say whether "one vote set per event" was accepted.                                                                                                                                                           | ADR l.38                                                                      | closed: D11 row records one set per event (PR #1420)                                                         |
| T11      | Low      | 1    | D7's rewrite of OSE-513 and OSE-518 is not recorded or ticketed (inferred).                                                                                                                                                       | readiness worksheet D7                                                        | closed: conflict notes on OSE-513 and OSE-518; the owner rewrites or cancels them                            |
| G1       | High     | 2    | The set counters and admin surfaces (S3 list, live monitor, audit details) are not barred before the end. With one song open, a live counter is a live song count.                                                                | OSE-2125; `live-monitor.ts:1-31`; ADR l.78                                    | closed: decision 7, no surface before final (PR #1420); S3 test                                              |
| G2       | High     | 2    | One person with 8 browsers can learn a lone voter's side. The card states "zero or not", not this. Dissent: Dr of Security (loop 3) asked for Medium.                                                                             | `count-floor.ts:38-43, 159-167`; ADR l.135-140                                | closed: accepted reduction, not fixed (Q8 A, PR #1420); about 1 in 5 per try remains                         |
| G3       | High     | 2    | N1 (OW-220) is not bound by decision 4: finality, end, kill switch, audit, no count in the reply. "A replay is a new object" can add to a final set.                                                                              | OW-220; ADR l.64, 78                                                          | closed: decision 3 (PR #1420); OW-220 updated                                                                |
| G4       | Medium   | 2    | N1 has no brand-binding mechanism. `WKRP_SERVICE_TOKEN` is one shared token (lowered in loop 5: N1 already requires the refusal).                                                                                                 | `shared-report-auth.ts:229-238`                                               | closed: OW-220 requires a brand-bound token                                                                  |
| G5       | Medium   | 2    | The timestamp gate's regex misses `votable_objects`, and S2 says "timestamps at the hour" next to `closes_at` for a 2:16 song.                                                                                                    | `timestamp-precision.invariant.spec.ts:728`; OSE-2125                         | closed: OSE-2125 updated                                                                                     |
| G6       | Low      | 2    | The open, `closes_at` and epoch check runs before the batch, so a close can land in between (lowered in loop 5, ticket-level).                                                                                                    | OSE-2128                                                                      | closed: OSE-2128, checks inside the batch                                                                    |
| G7       | Low      | 2    | The pepper epoch is undefined: who stamps it, how null is handled, what a rotation mid-event does (lowered in loop 5, ticket-level).                                                                                              | `lib/anon-id-hash.ts`; OSE-2125                                               | closed: decision 6, the pepper epoch (PR #1420)                                                              |
| G8       | Medium   | 2    | No route rate limit is named for the open-objects read or the vote POST (AGENTS.md: public reads are limited at the route).                                                                                                       | OSE-2127; OSE-2128                                                            | closed: OSE-2127 and OSE-2128 name route limits                                                              |
| G9       | Medium   | 2    | "A form-page kind" can pull a builder into `/api/v2/events/:id/forms/*`, which mints `ose_anon` and reads FORMS_DB.                                                                                                               | `router.ts:2510-2512`; `forms.ts:249`                                         | closed: decision 5 (PR #1420)                                                                                |
| G10      | Medium   | 2    | There is no rule for totals across objects or nights (replays, a season, "champion retains").                                                                                                                                     | `count-floor.ts:208-214`                                                      | closed: decision 7, no totals published (PR #1420)                                                           |
| G11      | Medium   | 2    | "No vote time" holds only for D1. Workers Logs time each vote POST to the millisecond, and with one song open that time names the song.                                                                                           | `wrangler.toml:107-108`                                                       | closed: decision 9, log timing (Q11, PR #1420)                                                               |
| G12      | Low      | 2    | The dedup keys (PRIMARY KEY or UNIQUE) and creating the tally row are not stated. S4a's tests would catch both.                                                                                                                   | OSE-2125                                                                      | closed: OSE-2125 names the keys and tally rows                                                               |
| G13      | Low      | 2    | ADR-034 decision 4's refusal is not a code check, and no ticket amends ADR-034 when voting ships.                                                                                                                                 | ADR-034 l.65                                                                  | closed: decision 10 (PR #1420); OSE-2128 amends ADR-034                                                      |
| G14      | Low      | 2    | The 10-voter test's scope (per set, raw) is not stated.                                                                                                                                                                           | ADR l.112                                                                     | withdrawn: merged into F5                                                                                    |
| H1       | High     | 3    | Nothing links the event page to a vote page, and sending `/q` to `/vote` breaks the poster's form flow.                                                                                                                           | `pages.ts:1229-1290`; `qr-scan.ts:93-99`                                      | withdrawn: merged into F1                                                                                    |
| H2       | High     | 3    | In-app scanners keep separate cookie jars, so "scan again" cannot rescue a scan made in another app. Q4's acceptance relied on that message.                                                                                      | `anonymous-id.ts:48`; ADR l.99                                                | closed: the pass at /q per browser, Q6 (PR #1420)                                                            |
| H3       | High     | 3    | The ticket hash could be the scan key, which is the same at every event.                                                                                                                                                          | `qr-scan.ts:190`; `scan-node-key.ts:18-20`                                    | withdrawn: merged into F4                                                                                    |
| H4       | Low      | 3    | No CSRF or framing control is named. Staging and production share one site (lowered in loop 5).                                                                                                                                   | `wrangler.toml:172-173, 391-393`; `pages.ts:237`                              | closed: decision 5 (PR #1420)                                                                                |
| H5       | Medium   | 3    | Never-who covers voters, not the people voted on. A named team player sits beside their "not for me" count. A label can name a private person.                                                                                    | ADR l.58; OSE-2125 (labels refuse only email and phone shapes)                | closed: Q9, decision 2 (PR #1420)                                                                            |
| H6       | Medium   | 3    | Remote voting from the poster link is not on the house-rule card.                                                                                                                                                                 | ADR l.133-140                                                                 | withdrawn: merged into the open Wording item (Q11)                                                           |
| H7       | Medium   | 3    | The fun report is a new public surface with no ticket and no gates. Nothing attendee-facing is built.                                                                                                                             | `tests/helpers/page-surfaces.ts:68`; OSE-2130 "admin only"                    | closed: OSE-520 carries the ADR rules and the new-surface gates                                              |
| H8       | Medium   | 3    | Nothing stops the OSE display (`display-config`, public and polled) from carrying a "voting open" flag or the open objects.                                                                                                       | `display-config.ts:19-22`; `router.ts:2384`                                   | closed: decision 7 (PR #1420); OSE-2129                                                                      |
| H9       | Low      | 3    | The voter page's states are undefined (ended, final, none open, kill switch, "no cookie" against "no ticket") (lowered in loop 5).                                                                                                | OSE-2129                                                                      | closed: OSE-2129 lists the page states                                                                       |
| H10      | Low      | 3    | `/vote` must join the page-surfaces regex and the `/es` prefix.                                                                                                                                                                   | `tests/helpers/page-surfaces.ts:91`; `router.ts:37-42`                        | closed: OSE-2129                                                                                             |
| H11      | Low      | 3    | The ticket key is not named or tied to one environment.                                                                                                                                                                           | `scripts/set-secrets.sh:99-118`                                               | closed: decision 6, a key per environment (PR #1420)                                                         |
| K1       | Medium   | 4    | Decision 9 accepts inference risks under invariants 1 and 2, which say "no exceptions". There is no governed pointer, and no ticket adds one (lowered in loop 5).                                                                 | AGENTS.md invariants 1, 2; ADR l.135-140                                      | closed: owner ruled no invariant note (Q8); residuals in decision 9 (PR #1420). Accepted, not fixed          |
| K2       | High     | 4    | "A set is final" has no born-red fault and no staging case.                                                                                                                                                                       | OSE-2127; OSE-2130                                                            | withdrawn: merged into F2                                                                                    |
| K3       | High     | 4    | S4a and S3 are each too big for one session once the gaps are folded in.                                                                                                                                                          | OSE-2128; OSE-2127                                                            | closed: split into OSE-2134 (S4c) and OSE-2135 (S3c)                                                         |
| K4       | Low      | 4    | No threat-ledger entry for the new public write path (lowered in loop 5).                                                                                                                                                         | `threat-ledger.yaml:13`                                                       | closed: OSE-2128 requires the ledger entry                                                                   |
| K5       | Low      | 4    | The vote POST is not classified under the route policy §3.2 and is not on the `guardPublicReadOnly` list (lowered in loop 5).                                                                                                     | `ROUTE_CLASSIFICATION_POLICY.md`; `public-readonly.ts:27-52`                  | closed: OSE-2128 requires the classification                                                                 |
| K6       | Medium   | 4    | S1 "Blocks S2, S3" and S2 "Blocks S3" disagree with the ADR's "can start now".                                                                                                                                                    | OSE-2123, OSE-2125; ADR l.197-200                                             | closed: Implementation Notes match the blockers (PR #1420)                                                   |
| K7       | Medium   | 4    | N3 is not linked to each story. It does not cover S1, S1g or N1, names no workflow job per test, and does not require Bruno test names to print.                                                                                  | OSE-2131; AGENTS.md Quality gates                                             | closed: OSE-2131 updated                                                                                     |
| K8       | Medium   | 4    | The tickets lack STORY-FORMAT parts: prerequisite, CI/CD link, pyramid checklist, SDET load target.                                                                                                                               | `docs/brain/STORY-FORMAT.md`                                                  | closed: story-format parts on S2, S3, S3b, S3c, S4a, S4b, S4c and S5                                         |
| K9       | Medium   | 4    | "Receipts survive a reopen" is checked at the mock layer only.                                                                                                                                                                    | OSE-2128                                                                      | withdrawn: merged into F3                                                                                    |
| K10      | Low      | 4    | PR #1417's body names OSE-2122 and OSE-1193, not OSE-2123, though it carries the S1 status change.                                                                                                                                | PR #1417 body                                                                 | closed: #1417 merged; #1420 says Part of OSE-2123                                                            |
| L5-SEC-1 | Medium   | 5    | "A room of 150 gets presence today" claims more than S0 showed. 150 of 150 passed an edge binding of 60 per 10 s, and no one explained why. No ticket exists yet.                                                                 | `wrangler.toml:236-238`; `public-read-limit.ts:240-250`; ADR l.88, 186        | closed: decision 6 reworded (PR #1420)                                                                       |
| L5-SEC-2 | Medium   | 5    | Nothing says the room-screen QR must point at OSE. A short link hosted on OurWKRP would show the named side every voter's tap.                                                                                                    | ADR l.28, 82; OW-220                                                          | closed: decisions 5 and 6, OSE only (PR #1420)                                                               |
| Q8-1     | Medium   | 5    | One secret margin per night could be learned from results one person controls entirely, then used on the target's result. Draw it per result.                                                                                     | design (inferred)                                                             | closed: decision 7 draws T per result (PR #1420); flagged to the owner                                       |
| Q8-2     | Medium   | 5    | The night's rounded voter count shows whether a lone target voted at all: 9 browsers plus the target read "10". Not how they voted.                                                                                               | design (inferred)                                                             | closed: owner dropped the voter count and participation (Q8-2, 06:08 UTC)                                    |
| Q8-3     | Low      | 5    | The secret margins sit in D1's 30-day history until then.                                                                                                                                                                         | inferred                                                                      | closed: decision 9, database history (PR #1420)                                                              |
| Q8-4     | Medium   | 5    | Whether anything is published shows whether at least 10 voted, so someone with 9 browsers can tell whether one other person voted. Dropping the count did not remove it.                                                          | design (inferred)                                                             | closed: owner chose a secret floor V of 10 to 14 (Q13, 06:20 UTC); a reduction accepted knowingly, not a fix |
| CF-1     | Medium   | 5    | A song's up vote feeds its own result and the night winner, each with its own margin, so that vote is exposed about one time in three, not one in five.                                                                           | ADR l.140, 146 (inferred)                                                     | closed: owner chose the night's winner only (Q14, 06:20 UTC); one result per set                             |
| CF-2     | Medium   | 5    | Nothing made a set reach final, so receipts could stay forever.                                                                                                                                                                   | ADR l.68, 96                                                                  | closed: auto-final after 7 days, tallies deleted 30 days after final (PR #1420)                              |
| CF-3     | Low      | 5    | The colluders line still assumed published counts.                                                                                                                                                                                | ADR l.162                                                                     | closed: decision 9 reworded (PR #1420)                                                                       |
| CF-4     | Low      | 5    | The epoch check named no comparison and no one to mark void.                                                                                                                                                                      | `anon-id-hash.ts:55`                                                          | closed: three-way compare, route marks void (PR #1420); OSE-2128 tests                                       |
| CF-5     | Low      | 5    | No route limit, and no rule that a limit key is never stored.                                                                                                                                                                     | ADR (grep)                                                                    | closed: decision 5 (PR #1420)                                                                                |
| CF-6     | Low      | 5    | Half-done: display flag, the pass key's name, the second poster code, the Status line.                                                                                                                                            | ADR l.3, 110, 126, 134                                                        | closed: PR #1420                                                                                             |
| FP-1     | High     | 5    | The residual rate is up to about two in five per set, not one in five: a switch between two songs moves the lead by 2, and backing the leader moves both the lead and the voter count (36%). The owner accepted the lower figure. | arithmetic over T 5 to 9, V 10 to 14 (verified)                               | open (owner, Q15)                                                                                            |
| FP-2     | Medium   | 5    | The report's existence could show the voter floor was met (D5 row).                                                                                                                                                               | ADR l.32, 154                                                                 | closed: every non-void final set gets the same report (PR #1420)                                             |
| FP-3     | Medium   | 5    | Nothing stopped the finalize audit, a log or a response from saying which rule decided.                                                                                                                                           | ADR l.98, 136                                                                 | closed: decision 4 forbids it (PR #1420); OSE-2130 test                                                      |
| FP-4     | Medium   | 5    | The event-level object could add a second result to a set.                                                                                                                                                                        | ADR l.94, 142                                                                 | closed: one kind of object per set (PR #1420)                                                                |
| FP-5     | Low      | 5    | The odds add up over repeated nights.                                                                                                                                                                                             | arithmetic                                                                    | closed: stated in decisions 7 and 9 (PR #1420)                                                               |
| FP-6     | Low      | 5    | Stale wording ("Q6 to Q12", "the 10-voter rule").                                                                                                                                                                                 | ADR l.3, 14, 184                                                              | closed: PR #1420                                                                                             |

Open rows: 1 Critical, 15 High, 22 Medium, 17 Low. No Security Critical. No Regulatory.

**Score arithmetic.** Environment ×1.0 (a design for the production surface, no PII). Loop position ×1.0 for loop 1, ×1.25 for loop 2, ×1.5 for loops 3 to 5. The correlated pairs are F1 with T1, and F5 with F6 (×1.5 each pair).

| Deduction                                                   |                    Points |
| ----------------------------------------------------------- | ------------------------: |
| F1 + T1 = (15 + 10) × 1.5                                   |                      37.5 |
| F5 + F6 = (10 + 10) × 1.5                                   |                      30.0 |
| Other loop 1 rows: 7 High, 7 Medium, 6 Low = 70 + 35 + 12   |                     117.0 |
| Loop 2 rows: 3 High, 6 Medium, 4 Low = (30 + 30 + 8) × 1.25 |                      85.0 |
| Loop 3 rows: 1 High, 3 Medium, 4 Low = (10 + 15 + 8) × 1.5  |                      49.5 |
| Loop 4 rows: 1 High, 4 Medium, 3 Low = (10 + 20 + 6) × 1.5  |                      54.0 |
| Loop 5 rows: 2 Medium = 10 × 1.5                            |                      15.0 |
| Total                                                       | 388.0, so the score is 0% |

## Solutioning

The path to 95% has three parts, all after this review: ADR edits, owner answers, and ticket updates. Then one confirmation loop on the new text.

**ADR text edits that follow from what the owner already said (E1 to E12).** They could go into PR #1417 before it merges. The owner decides.

- **E1. Decision 1.** Change "Receipts are deleted when the set closes" to "Receipts and participants are deleted when the set becomes final." Say the participant key is an HMAC on the set id, in its own key context. (F3, F14)
- **E2. Consequences.** Change "Six new tables" to "Five new tables". (F13)
- **E3. Decision 6.** Change "a hash of the cookie value" to "an HMAC of the cookie value and the event id, under its own key, which differs per environment and is never the scan key. The ticket carries only the event id, the expiry and the MAC; the cookie hash is never sent." Add: "The page that receives the ticket sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and no log line carries the ticket." (F4, H11)
- **E4. Decision 6.** Add the presence CCR's rulings:
  - with no ticket key, `/q` issues no ticket and the vote is refused;
  - the uncounted path issues no ticket;
  - the ticket expires at the end of the event, not at midnight UTC.
    Change "A room of 150 gets presence today" to "150 browsers from one address each got a cookie and a counted scan on staging, through the CI path. Presence tickets are not built yet." (F12, L5-SEC-1)
- **E5. Decision 7.**
  - Say whether a team total uses `floorTotalOfParts` (drop the small parts, sum the rest) or the stricter "every part clears 5". Keep the stricter rule if wanted, and say why.
  - Add: a total across objects or nights uses `floorTotalOfParts`, or `floorCumulativeOfParts` for a running total. (F10, G10)
- **E6. Decision 7.** Add:
  - the winner is decided on the "up" count only;
  - margin and winner are tested on the published, rounded counts;
  - the 10-voter test counts distinct voters in the set, raw.
  - Whether "not for me" is published at all is part of Q7. (F8)
- **E7. Decision 8.** Change "`floorNestedCounts` and `flooredRatePct`" to "`floorPublishedChain`, devices then voters". Name the denominator: distinct keyed scan ids for this event in `scan_node_returns`, counted over the whole event and not summed per hour. If the denominator is missing or below the voter count, publish nothing. (F7, F9)
- **E8. Decision 5.** Change "a form-page kind" to "styled like a form page. It is not a forms route, does not use the forms API, and sets no cookie." Add: "The vote POST takes JSON only, checks `Sec-Fetch-Site: same-origin`, and the page sends `frame-ancestors 'none'`." (G9, H4)
- **E9. Decision 7.** Add: "Before the event's end, no surface shows a vote count or a vote-set counter. That covers the admin list, the live monitor, audit details, the display and `display-config`. Invariant 2 holds for the brand's own admin." (G1, H8)
- **E10. Decision 3.** Add: "N1 obeys decision 4. It is bound to the event's brand, adds no object to a final set or after the end, is audited, and returns no count." (G3)
- **E11. Owner answers table, D11 row.** Record whether "one vote set per event" was accepted. (T10)
- **E12. Implementation Notes and the index.**
  - Call N1 to N4 "created" and N5 "proposed, not created", or remove N5.
  - Match "can start now" to the ticket blockers.
  - Change `docs/adr/README.md:58` to Accepted. (T6, T8, K6)

**Owner questions:** Q6 to Q12, in "Human gate" below.

**Ticket updates (no ADR change).** Each item is proposed for the owner. This CCR edits no ticket.

- **A new story for `/q` presence-ticket issuance**, with its gates. (T1)
- **A new story for the event page's "Vote" choice**, if Q6 is A. (F1)
- **S4a.**
  - Add the R2 gates. (T2)
  - Put the open, `closes_at` and epoch check inside the batch. (G6)
  - Define the pepper epoch. (G7)
  - Name a rate limit. (G8)
  - Run the reopen case on staging. (F3)
  - Split it into the route core and its hardening. (K3)
- **N2.** Mark it held, with the two triggers. Remove "Blocks S4a". Fix the "decision 12" reference. (T3)
- **S4b.** Add the "scan again" message and the full six-risk list (T4). Add the page states (H9), and the page-surfaces and `/es` entries (H10).
- **S5.** Rename the banned ratio. (T5)
- **N3 and N4.** Add the new gate list and R6. Link N3 to each story. (T7, K7)
- **S2.**
  - Add "votable" to the timestamp gate, and an allowlist entry for `closes_at`. (G5)
  - Name the PRIMARY KEY on each dedup table. (G12)
  - Add a one-way "final" state with a born-red test. (F2)
- **S3.** Split it. (K3)
- **OW-220.** Add the brand-bound token design (G4) and the decision 4 rules (G3).
- **New items.**
  - A threat-ledger entry (K4).
  - A route classification for the vote POST (K5).
  - The ADR-034 amendment when voting ships (G13).
  - The fun report surface under OSE-520 (H7).
  - The OSE-513 and OSE-518 rewrite, if still wanted (T11).
- **OSE-2123.** Update its acceptance to name two open items. (T9)
- **The STORY-FORMAT parts on each ticket.** (K8)
- **PR #1417.** Add "Part of OSE-2123" to the body. (K10)

**Projected score.** Only after every open row closes and a confirmation loop finds nothing new. No number is claimed now.

## What must be true before shipping

ADR-040 is "shipped" as a build basis when S2, S3 and S4a can start from it safely:

- The owner has answered Q6 to Q12.
- E1 to E12 (or the owner's version of them) are on `main`.
- T1 has a story. T2, T3 and T4 are updated.
- If Q8 is A: the invariant 1 and 2 pointer has its own 5-loop governance CCR, with a human gate each loop, before S5. That could join S1g (OSE-2124).
- A confirmation CCR loop on the amended text scores at least 95%.

## Commit sequence

1. This worksheet, in its own draft PR. No other file.
2. PR #1417 takes E1 to E12, or the owner's version of them, plus the index line. The owner merges it.
3. The owner's answers to Q6 to Q12 are recorded in the ADR's answers table, dated.
4. Linear: the new stories, and the ticket updates listed in Solutioning.
5. A confirmation CCR loop on the amended text. Its worksheet updates this one, or follows it.

## Verification after shipping

- `node scripts/ci/ccr-worksheet-check.mjs` passes with this worksheet in the tree.
- The ADR on `main` reads Accepted, and the index row agrees.
- Each new or updated ticket names its born-red fault and the CI job that runs it (N3).
- After S4a ships: N4's staging case (150 voters behind one address) is green in a named job, through the room-screen path the owner chose in Q6.

## Risks accepted

This CCR accepts no risk. Only the owner can. These were already accepted by the owner, and are context here:

- Decision 9's six residuals (2026-11-17 and 2026-11-18), and the presence CCR's Q1 to Q5 (2026-11-18).
- Not yet accepted, and put to the owner here:
  - the lone-voter wording (G2, Q8);
  - remote voting and log timing on the card (H6, G11, Q11);
  - naming a person as a vote object (H5, Q9).

## Human gate

The gate is stop. These are the owner's questions, numbered after the presence CCR's Q1 to Q5. Each one names where the gap appeared.

1. **Q6. How does a person on the room screen get a presence ticket?** (F1, H2, L5-SEC-2. Found in loop 1, Critical layer; sharpened in loop 3, Adversarial layer.)
   - A: The room screen shows the event's own `/q` code, the same as the poster. `/q` lands on the event page. A "Vote" choice there carries the ticket to the vote page. The vote page lists the open songs, and each button carries its song's id.
   - B: A per-song `/q` code on the room screen (option F). It needs its own CCR.
   - C: Keep the QR straight to the vote page and keep the ticket in browser storage. It needs its own review under invariant 4.
   - **Recommendation: A.** It uses the one path that already issues a ticket. It works in any in-app scanner, because both scans go through `/q`, and it adds no cookie. It moves the song id from the QR to the button, so the vote still resolves by id and never by clock. In every option, the QR points at OSE, never at an OurWKRP short link. Does A fit what you meant by "by the id in the code" (C1)?
2. **Q7. D5 said "At least 10 for a number to be shown." Should 10 distinct voters in the set be needed before any count shows (side counts, the voter total, participation), and not only before a winner is named?** (F5, F6. Found in loop 1, Critical layer.)
   - A: Yes. Under 10 voters, no counts at all, only "Fewer than 10 people voted".
   - B: No. Side counts show from 5. Only the winner needs 10.
   - **Recommendation: A.** It is what the question asked and what you answered. It also closes the plain unanimity read. Also: should "not for me" counts be published at all, or only used to keep things fair?
3. **Q8. One person with 8 browsers can learn the side of a lone voter on one song. Do you accept that, and write it on the card and as a note under AGENTS.md invariants 1 and 2?** (G2, K1. Found in loop 2, Conservative layer; loop 4, Compliance layer.)
   - A: Accept. The card says it plainly. A 5-loop governance CCR adds a pointer from invariants 1 and 2 to ADR-040 decision 9. It blocks S5.
   - B: Accept on the card only. AGENTS.md is unchanged.
   - C: Do not accept. A per-song count shows only when that song had at least 10 distinct voters. This raises the attack's cost but does not end it.
   - **Recommendation: A.** You already accepted the method (several browsers, colluders). What is missing is the honest wording and a governed rule that matches it.
4. **Q9. May a person be the thing voted on?** (H5. Found in loop 3, Adversarial layer.)
   - A: No person names. Objects are songs, stalls and teams.
   - B: Only people who opted in as presenters (invariant 1's one exception).
   - C: Anyone on a team.
   - **Recommendation: B.** It matches the exception invariant 1 already allows. A team player's per-song "not for me" count is then their own choice to show.
5. **Q10. Once results are computed, should the vote set lock for good with a one-way "final" flag that no date change can undo?** (F2. Found in loop 1, Critical layer.)
   - A: Yes. The flag is set once. Reopen, N1 and any new object are refused after it.
   - B: No. Rely on the event's end date.
   - **Recommendation: A.** Today the end date is optional and anyone with admin access can change it, so a host could read, move it, reopen and read again.
6. **Q11. Should the house-rule card also say two more things?** First, anyone with a photo of the poster can vote from elsewhere for the whole day. Second, Cloudflare's own logs time each vote to the millisecond, which the account holder can see. (H6, G11. Found in loop 2, Conservative layer; loop 3, Adversarial layer.)
   - **Recommendation: yes.** Fold both into the card wording you still owe.
7. **Q12. If you adopt the fragment ticket (see the addendum), do you accept that a forwarded vote link lets someone vote in a person's place, once per song, and that the person cannot tell? How long should a ticket last?** (CK-4. Found after the run.)
   - A: Accept. The ticket lasts 30 minutes and a re-scan renews it. The card names the risk.
   - B: Accept with the whole event day. That is simpler, but the window is wider.
   - **Recommendation: A.** 30 minutes covers a four-song, 20-minute set, and a re-scan is cheap when the room screen shows the `/q` code (Q6 A).

8. **Q13. Should the 10-voter floor be a secret random number per set, from 10 to 14?** Whether anything is published shows whether at least 10 voted, so someone with 9 browsers can tell whether one other person voted (Q8-4, found after the run). **Recommendation: yes.** It is the same reduction you chose for the margin, about one in five per set.
9. **Q14. A song's up vote feeds two results, its own result and the night's winner, so it is exposed about one time in three. Should only one result per set be published?** (CF-1, confirmation pass.) **Recommendation: yes, publish the night's winner only.** That keeps it at about one in five.

10. **Q15. The secret margin and floor leave up to about two in five per set, not one in five. Accept that rate, stated on the card, or widen the ranges (for example T 5 to 14 and V 10 to 19)?** Widening brings it to about one in five, but more small nights end with no winner. (FP-1, final confirmation pass.) **This is the owner's call; no recommendation either way.** Both keep "no exceptions": one states the rate honestly, the other lowers it.

What is verified, inferred and not checked:

- **Verified from source by the session lead:**
  - `qr-scan.ts:100-108, 168-181`
  - `anonymous-id.ts:14, 36, 48`
  - `count-floor.ts:79-86, 98-147, 159-200`
  - `events.ts:1274, 1744`
  - `event-phase.ts:188-190`
  - `shared-report-auth.ts:220-238`
  - `timestamp-precision.invariant.spec.ts:726-730`
  - `wrangler.toml:107-108, 232-238`
  - `pages.ts:230, 3243`
  - `docs/adr/README.md:58`
  - the PR #1417 file list (2 files)
  - the readiness worksheet's D5 wording
  - each ticket's text in Linear
- **Verified from source by role lenses:** the remaining citations, re-checked in loop 5 for eight key rows.
- **Inferred:**
  - each attack's effect;
  - that Workers Logs record request URLs;
  - why the S0 runs passed the edge binding;
  - D1 batch behaviour under load.
- **Not checked:** OurWKRP's code; production; real phones and in-app scanners; Linear comments other than the tickets' descriptions; `OCR-docs` `architectural-invariants.yaml` (not in this repo).

## Addendum: D3 reversed, and the fragment ticket (2026-11-18, after the run)

**Input.** After the five loops, the owner's parent session reported that the owner reversed D3. The owner's words, as quoted on OSE-2124: "How does this get limited on anonymous tokens? There should be no exceptions to keep the privacy footprint clean and unexploitable. Once there is a seam, it's a way in."

So there is no new reader of `ose_anon`, invariant 4 stays as it is, and S1g (OSE-2124) is on hold. This session has not seen those words in a source the owner typed, so they are recorded here as reported.

**The candidate design under test.**

- Every cookie read stays inside `/q`.
- `/q` derives a per-event voter key k from the cookie and the event id.
- `/q` puts a presence ticket holding k in the redirect's fragment.
- The vote page keeps the ticket in memory and posts it in the JSON body.
- The vote route checks the ticket's seal and never reads a cookie.

**How it was tested.** One Dr of Security pass, read-only, against source at `2b33976`. The five loops above are unchanged. The ruling of 2026-11-02 keeps a run's loops fixed. This addendum does not change the register's counts.

**Verdict.** The design holds, and is better than D3 as decided, if all six conditions below are met. The score stays at 0%. F1 is still open until Q6 is answered A and the `/q` story (T1) exists.

Conditions:

1. Q6 is answered A. The room screen shows a vote-kind `/q` code, and `/q` sends the visitor to `/events/:id/vote#t=…`.
2. A receipt is keyed by the server: `HMAC(K_receipt, k ‖ object_id)`, never `HMAC(k, object_id)`. k sits in the ticket in clear, so anyone holding a forwarded ticket could otherwise compute that browser's receipts and match them against the database (CK-2).
3. Separate HKDF labels for the voter key, the ticket seal, receipts and participants. The cookie is length-prefixed. The key is never the scan key (CK-3).
4. A ticket is minted only when the pepper is set, the scan was stored or was a duplicate, a set is open, and `VOTING_ENABLED` is on. The ticket carries the pepper epoch (CK-5, CK-7).
5. The fragment is removed at once with `history.replaceState`. The ticket is short-lived and is never written to storage. No log, and no CI output, carries the ticket, k, a receipt or the `Location` header (CK-4, CK-5, CK-9).
6. The owner accepts the silent bearer risk in the card's own words (CK-4, Q12).

| Id    | Weight   | Finding                                                                                                                                                             | Evidence                                                                         |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| CK-1  | Critical | The design closes F1 only with Q6 A and a vote-kind `/q` target. `qrScanTarget` passes no object and maps unknown types to `register`.                              | `qr-scan.ts:91, 106-107` (verified)                                              |
| CK-2  | High     | `receipt = HMAC(k, object_id)` with k in clear lets a ticket holder compute that browser's receipts. Key the receipt on the server.                                 | design (inferred)                                                                |
| CK-3  | Medium   | k is unlinkable across events only with its own HKDF label, length-prefixed input, and never the scan key or the raw `SHA-256(x\|pepper)` form.                     | `scan-node-key.ts:18-20, 47`; `anon-id-hash.ts:41` (verified)                    |
| CK-4  | High     | The ticket is a bearer token. A forwarded link votes first, and the person's own vote then answers as a duplicate, so they cannot tell.                             | ADR l.76 (inferred)                                                              |
| CK-5  | Medium   | Mint only for a vote-kind code with a set open. The ticket rides in a response header (`Location`), so logging or CI output that prints it would leak it.           | design (inferred)                                                                |
| CK-6  | Low      | The fragment survives the 301 and 308 redirects (RFC 9110 §10.2.2) and never reaches `Referer`, but the language switch and a reload drop it.                       | `language-switch.ts:43`; `pages.ts:2416`; `router.ts:698` (inferred, no browser) |
| CK-7  | Medium   | Mint only from a stored or duplicate scan. Today a failed write still redirects, and the queue path knows only "enqueued". Either would break decision 8's nesting. | `qr-scan.ts:235, 255-270` (verified)                                             |
| CK-8  | Low      | The route reads no cookie, so a ticketless cross-site POST gains nothing. Cookie tossing at `/q` remains. Keep JSON-only and same-origin.                           | inferred                                                                         |
| CK-9  | Medium   | S4a's log ban must name the ticket, k and receipts.                                                                                                                 | inferred                                                                         |
| CK-10 | Low      | Cross-site scripting on `/vote` could read the ticket. Copy the nonce CSP with `connect-src 'self'`.                                                                | `pages.ts:237` (inferred)                                                        |

**What it closes, if adopted with the conditions:**

- F4, with H3 merged into it: no cookie hash travels, and no query string or `Referer` carries the ticket.
- H2: each in-app browser gets its own cookie and ticket at `/q`.
- The CSRF half of H4.
- The S1g dependency, with no governance change.

**What it changes:**

- F1: a fix exists, but only under Q6 A plus T1.
- H1: no link from the event page is needed under Q6 A.
- H9: the page can tell a missing ticket on its own.
- T2: S4a gets a new gate list.

**What stays:** F2, F3, F5 to F10, G1 to G4, G11, K1 and the rest.

**Proposed ADR-040 text (the owner decides).**

- **D3 row.** "**Reversed** (owner, 2026-11-18): 'How does this get limited on anonymous tokens? There should be no exceptions to keep the privacy footprint clean and unexploitable. Once there is a seam, it's a way in.' No new reader of `ose_anon`." In the third column: "Decisions 5 and 6. Invariant 4 is unchanged. S1g is cancelled."
- **Decision 1, the receipt sentences.** "A receipt carries no side. It is `HMAC(K_receipt, k ‖ object_id)`. Here k is the per-event voter key from decision 6, and `K_receipt` is a server-only subkey. A participant marker is `HMAC(K_participant, k ‖ set_id)`, under its own subkey. No cookie value reaches the vote route or the vote tables. Receipts and participant markers are deleted when the set becomes final."
- **Decision 5.** "The voter page is `GET /events/:id/vote`. It is styled like a form page, but it is not a forms route. It uses no forms API and sets no cookie. It explains the vote, carries the house rule (decision 9), and shows the sponsor strip below the title and date. The OurWKRP room screen shows only the event's vote code. That code is a `/q` code on OSE, never an OurWKRP short link, and it lands on this page. The vote write is a `POST` outside `/api/v2/events*`, handled on the `DB` side. It reads no cookie: it never reads the `Cookie` header and never sets one (D3 reversed, 2026-11-18). It takes JSON only and checks `Sec-Fetch-Site: same-origin`. A gate fails if the vote route's files read the `Cookie` header or `ose_anon`. AGENTS.md invariant 4 is unchanged: `/q` stays the only reader on the vote path."
- **Decision 6, the presence paragraph.**
  - "A vote counts only from a browser that scanned this event's vote code. Every cookie read stays inside `/q`."
  - "At `/q`, a vote-kind code, with a set open and `VOTING_ENABLED` on, derives a per-event voter key: `k = HMAC(K_voter, len(cookie) ‖ cookie ‖ event_id)`. `K_voter` comes from `ANON_ID_HASH_PEPPER` by HKDF, under its own label. That label is separate from the scan key, the ticket key and the receipt key. k differs at every event and is stored nowhere."
  - "`/q` mints a ticket only when the pepper is set and the scan was stored, or was a duplicate of one stored. The uncounted path mints none, and a missing key mints none."
  - "The ticket is `{event_id, expiry, pepper_epoch, k}`, sealed with a MAC under its own key in each environment. `/q` puts it in the redirect's fragment (`/events/:id/vote#t=…`). So it is never in a query string, a `Referer` or a request log."
  - "The voter page reads the fragment and removes it from the address bar at once. It keeps the ticket in memory only, writes nothing to storage, and posts the ticket in the JSON body. With no ticket, the page says to scan the code on the screen again."
  - "A ticket lasts 30 minutes (Q12), and a re-scan renews it. A re-scan in the same browser gives the same k, so the same receipts."
  - "The vote route checks the MAC (in constant time), the event, the expiry and the epoch. No log line and no CI output carries the ticket, k, a receipt or the `Location` header."
- **Decision 9, a new line.** "**A forwarded vote link.** The ticket works for whoever holds it. Someone who gets a person's vote link while it is valid can vote in their place, once per song. The person's own vote then answers like a counted one, so they cannot tell. It reveals no identity."
- **Implementation Notes.** S4a and S4b wait on S2, S3 and the `/q` ticket story, no longer on S1g.

**Proposed ticket edits (the owner decides; none made).**

- **S1g (OSE-2124).** Cancel. Its reader-list gate moves into S4a as "the vote route reads no cookie".
- **The `/q` ticket story (new, T1).** Its acceptance, each item seen failing first, at both layers:
  - a vote-kind code mints a ticket only with a set open and `VOTING_ENABLED` on;
  - the ticket is only in the `Location` fragment, never in the query string;
  - no ticket on the uncounted path, with no pepper, or after a failed write;
  - one cookie at two events gives two different k values;
  - k is never equal to the scan key;
  - nothing logs `Location`.
- **S4a (OSE-2128).**
  - Delete check 3 (the read-only parser). Check 4 becomes: the ticket's MAC (constant time), event, expiry and pepper epoch.
  - "no ose_anon: refused [getOrCreateAnonId used]" becomes "no ticket: refused, nothing written, no Set-Cookie [ticket check skipped]".
  - New static gate, listed in T0: "the vote route never reads the `Cookie` header or `ose_anon` [a cookie read added]".
  - "pepper missing [raw cookie fallback]" becomes "[unkeyed fallback]".
  - Add these tests: a ticket for another event is refused; an expired ticket is refused (mock layer, with a controlled clock); a wrong-epoch ticket is refused; a ticket with k altered fails the MAC.
  - Add: "a receipt cannot be computed from the ticket alone [receipt = HMAC(k, object)]".
  - Add, at both layers: "a re-scan gives the same k, so a second vote on one object counts once".
  - The log ban also names the ticket, k and receipts.
  - In Bruno, "refusal with no cookie" becomes "refusal with no ticket". The 10-voter case reads the ticket from the `Location` fragment and never prints `Location`.
  - Blocked by the `/q` ticket story, not by S1g.
- **S4b (OSE-2129).**
  - The page reads the fragment and removes it with `history.replaceState` before any other script runs.
  - It keeps the ticket in memory only. Playwright asserts that cookies, `localStorage`, `sessionStorage` and IndexedDB are unchanged.
  - It posts the ticket in the JSON body.
  - It shows the "scan the code on the screen again" message.
  - Headers: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, a nonce CSP with `connect-src 'self'`, and `frame-ancestors 'none'`.
  - The language switch keeps the ticket, or asks for a re-scan.
  - The house-rule list adds four risks: a script, zero or not, a forwarded link, and remote voting.
- **S2 (OSE-2125).** Name the receipt and participant subkeys. No column holds k.
- **N1 (OW-220).** The room screen shows the event's `/q` vote code, not the vote page's URL.

## Addendum 2: the owner's answers to Q6 to Q12, and the Q8 check (2026-11-18, about 05:53 UTC)

**Source.** The owner answered in question forms in the parent session. This session read those answers in that session's record, as the forms' own results, at 05:52:40 and 05:53:04 UTC.

**The answers.**

- **D3:** reversal confirmed.
- **Q6:** the room screen shows the event's own `/q` code.
- **Q7:** 10 distinct voters before any number.
- **Q8:** remove the lone-voter leak by design, with no exception.
  - Publish no per-song up or down numbers.
  - Publish only each song's outcome (winner, or too close to call) and a rounded voter count for the night.
  - Add no note under invariants 1 or 2.
  - If the design does not close the gap, say so and stop.
- **Q9:** only opted-in presenters may be voted on.
- **Q10:** a one-way final lock.
- **Q11:** the card says both things.
- **Q12:** accept the forwarded-link risk, with a 30-minute pass.
- **Apply:** yes, as a draft PR, with the tickets updated to match.

**The Q8 check. It does not close the gap, so the apply step stopped here.**

The winner rule still works on unpublished counts. The server can count, apply the 10-voter and margin rules, and publish only the outcome. But the outcome still gives away one vote.

- One person with 9 browsers casts every vote except the target's.
- They set the up-count margin between song X and song Y to 4, counting their own votes only.
- If the target voted up on X, the margin becomes 5 and X is named the winner. If not, the night reads "too close to call".
- The 10-voter rule does not stop this. It counts browsers, so 9 browsers plus the target make 10.
- The rounded voter count for the night leaks one bit the same way: with 9 browsers, "10" means the target voted.

**This holds for any fixed rule, not only this one.** Take any published result that is computed from the votes by a fixed rule. If one person can control every other vote, they can set them so the target's vote decides the result. Making the result safe would mean no single vote could ever change it, and then it says nothing. So no fixed publishing rule closes this gap while one person can cast many votes.

Only three things change that:

1. **Chance in the result.** For example, a hidden margin threshold, drawn at random each night from 5 to 9 and deleted after use. This narrows the leak; it does not remove it. With five equally likely thresholds, one try reveals the vote about one time in five. It is a form of the noise the owner declined in D8 (Alternative D).
2. **One vote per person, not per browser.** That cannot be done while voters stay anonymous.
3. **Publishing no result made from the votes.**

**Severity.** G2 stays High, and stays open. It is not Security Critical today, because nothing is built.

**What was not done.** No ADR edit, no ticket edit, and no new PR. The owner's answers are recorded here and on OSE-2123. The owner decides how to handle Q8 before anything is applied.

## Addendum 3: applied, and re-scored (2026-11-18, about 06:10 UTC)

**Source.** The owner answered Q8 again at 05:58:59 UTC, after reading why outcomes alone still leak: **A, a hidden random margin**. This session read that answer in the parent session's record, as the question form's own result. The owner asked for everything to be applied.

**What was applied.**

- **Draft PR #1420**, from `main` at `50338203` (#1417 is already merged). It rewrites ADR-040 for D3 reversed and Q6 to Q12, and sets the index row to Accepted.
- **Linear:**
  - OSE-2133 created: S3b, `/q` issues the pass.
  - OSE-2124 (S1g) cancelled.
  - OSE-2126 (N2) held, with its triggers; it no longer blocks S4a.
  - OSE-2128 (S4a), OSE-2129 (S4b) and OSE-2130 (S5) rewritten.
  - OSE-2125 (S2), OSE-2127 (S3), OSE-2131 (N3), OSE-2132 (N4) and OW-220 (N1) updated.

**Two points flagged to the owner, not changed silently.**

1. **Q8-1.** The secret margin is drawn **per result**, not once per night. A single nightly draw could be learned from results one person controls entirely, then used on the target's result every time.
2. **Q8-2.** The night's rounded voter count still shows whether a lone target voted at all (9 browsers plus the target read "10"), though not how. The text keeps it, as the owner decided. Options: drop it, or publish it only from a higher floor.

**The random margin is a reduction, not a fix.** One person who controls every vote but one can still learn that last vote about one time in five per try. The ADR says so. G2 is closed as "accepted, not fixed".

**The check of the draw.** The margin comes from `crypto.getRandomValues` with rejection sampling, so no value is more likely. It is fixed when the objects open, before any vote. No route returns it, no log carries it, and it is nulled at final. The published outcome says only whether the hidden lead cleared it, so the outcome does not reveal it. It does sit in D1's 30-day history (Q8-3, under "database history" in decision 9). These are text requirements. S3 and S5 carry born-red tests for them, and nothing is built yet.

**Re-score.** These rows are still open:

| Row  | Severity | Loop | Weight × position | Points |
| ---- | -------- | ---- | ----------------- | -----: |
| T9   | Low      | 1    | 2 × 1.0           |    2.0 |
| T10  | Low      | 1    | 2 × 1.0           |    2.0 |
| T11  | Low      | 1    | 2 × 1.0           |    2.0 |
| G7   | Low      | 2    | 2 × 1.25          |    2.5 |
| H7   | Medium   | 3    | 5 × 1.5           |    7.5 |
| K3   | High     | 4    | 10 × 1.5          |   15.0 |
| K8   | Medium   | 4    | 5 × 1.5           |    7.5 |
| Q8-2 | Medium   | 5    | 5 × 1.5           |    7.5 |
|      |          |      | Total             |   46.0 |

**System score: 54%. Gate: stop.** The cumulative score of the run stays 0%.

- **This counts unmerged text.** The closures rest on PR #1420, which is not merged, and on ticket text. If #1420 does not merge, they reopen.
- **Path to 95%.** Close K3 (split S4a and S3), H7 (a ticket for the fun-report surface under OSE-520), K8 (the story-format parts) and Q8-2 (the owner's call). That leaves 8.5 points, so 91.5%. Close G7 (who stamps the pepper epoch, and what a rotation mid-event does) and T9 to T11 as well, and it reaches 100%. Then run one confirmation loop on the merged text.

## Addendum 4: the voter count dropped, the rest closed, and a confirmation pass (2026-11-18, about 06:20 UTC)

**Source.** The owner answered Q8-2 at 06:08:18 UTC: **drop it**. This session read the answer in the parent session's record, as the question form's own result.

**Applied in draft PR #1420** (commits `785da7bc` and `c944456a`):

- No count of voters and no participation figure.
- Who stamps the pepper epoch (G7), compared three ways, with the vote route marking a set void (CF-4).
- Every set reaches final through a scheduled job, and tallies are deleted 30 days after final (CF-2).
- Route limits, and a limit key is never stored (CF-5).
- No vote word on the display; the pass key named; the second poster code; the Status line (CF-6).
- The colluders line reworded (CF-3), and the exposure stated per result (CF-1).

**Applied in Linear:**

- OSE-2134 (S4c, route hardening) and OSE-2135 (S3c, public read and kill switch) created, splitting S4a and S3 (K3).
- OSE-520 updated with the ADR rules and the new-surface gates (H7).
- Story-format parts added to S2, S3, S3b, S3c, S4a, S4b, S4c and S5 (K8).
- OSE-2123's acceptance names the open items (T9).
- Conflict notes added to OSE-513 and OSE-518 (T11).
- S5, S4a, S3 and S2 updated for the above.

**The voter count, checked.** Dropping the count does not fully close the gap. Whether anything is published still shows whether at least 10 voted (Q8-4). Q13 asks whether that floor should be a secret random number too (10 to 14, about one in five). Until then, S5 builds the floor behind one function.

**Confirmation pass.**

Team: dr-of-security. Fresh read of the final text at `785da7bc`, with the register as background.

Verdict: **stable, with edits**. No Security Critical, Critical or High. These are fixed in the text:

- Earlier rows fixed in the text: F1, F3 to F14, G1, G3, G5, G9 to G11, G13, H2 to H4, H6, H7, and L5-SEC-1 and L5-SEC-2.
- Moot because no count is published: F6 to F10.
- The five half-done items (G8, H8, H11, L5-07 and H5) are now in the text. H5 is enforced by policy only: labels refuse email and phone shapes, so the presenter-only rule rests on the admin.
- It confirmed that only `lib/anonymous-id.ts` reads the `Cookie` header today (`anonymous-id.ts:35`, imported by `qr-scan.ts` and `forms.ts`). So the "the vote route reads no cookie" gate is a real property.

It found two new things:

- **CF-1.** A song vote feeds two results, so it is exposed about one time in three. This is Q14 for the owner.
- **CF-2.** Sets had no retention bound. Now fixed.

**Re-score.** These rows are still open:

| Row  | Severity | Loop | Weight × position | Points |
| ---- | -------- | ---- | ----------------- | -----: |
| Q8-4 | Medium   | 5    | 5 × 1.5           |    7.5 |
| CF-1 | Medium   | 5    | 5 × 1.5           |    7.5 |
|      |          |      | Total             |   15.0 |

**System score: 85%. Gate: stop.** Both open rows are owner decisions:

- **Q13:** a secret random voter floor.
- **Q14:** whether one vote may feed two results. The recommendation is to publish only the night's winner.

If the owner answers both as recommended and the text follows, the score is 100%.

**Still to note:**

- **This score counts text that is not merged.** It rests on draft PR #1420 and on ticket text. If #1420 does not merge, those rows reopen.
- **Two defaults are the team's proposal.** The 7 and 30 days in decisions 1 and 4 are flagged for the owner to change.
- **Nothing is built.** Every test named in the tickets is still to be written and seen red.

## Addendum 5: Q13 and Q14 applied, and the final confirmation pass (2026-11-18, about 06:25 UTC)

**Source.** The owner answered at 06:20:03 UTC: **Q13 yes** (a secret voter floor, 10 to 14) and **Q14 the night's winner only**. This session read both answers in the parent session's record, as the question form's own result.

**Applied** in draft PR #1420 (`98e0322a`, `2aa8a73a`) and in Linear (OSE-2130, OSE-520, OSE-2125, OSE-2127, OSE-2129, OSE-2123):

- a secret floor V, drawn and deleted like T;
- below V, the night reads the same words as a close result;
- one result per set, the night's winner;
- no per-song result or belt.

**Final confirmation pass.**

Team: dr-of-security. Fresh read at `98e0322a`, with the arithmetic checked by enumeration and by the session lead.

Verdict: **not stable** until FP-1 is answered. FP-1 (High) is that the true residual rate is up to about two in five per set, not one in five:

- **A switch between two songs:** two of T's five values tell them apart.
- **Backing the leader or staying away:** 1 − 0.8 × 0.8 = 0.36.

The text now states these rates (decisions 7 and 9). Whether to accept them or widen the ranges is Q15. FP-2 to FP-6 are text fixes, now applied. The draw of T and V was found safe on every point checked.

**Re-score.** One row is still open:

| Row  | Severity | Loop | Weight × position | Points |
| ---- | -------- | ---- | ----------------- | -----: |
| FP-1 | High     | 5    | 10 × 1.5          |   15.0 |

**System score: 85%. Gate: stop.** Q15 is the only open item. Either answer closes it: accepting the stated rate, or widening the ranges with the text following. The score would then be 100%.

**For the record, not acted on.** The dependency-audit session reported that the repo's saved branch protection does not require reviews. So "the owner merges" is held by practice, not by settings. That is the owner's to decide.
