---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 0
pr: 1417
subject_sha: 'f64c61c5be5a84f1fb17f90a9257d230d6f42fc3'
unresolved: { regulatory: 0, security_critical: 0, critical: 1, high: 15, medium: 22, low: 17 }
---

# CCR: ADR-040 decided text (Voting S1, OSE-2123)

Date 2026-11-18. Five loops. Repo `main` at `0459690a`. Subject: ADR-040 as amended by draft PR #1417, branch `adr-040-presence-amendment` at `f64c61c5`.

**Subject.** The decided text of ADR-040: "an anonymous vote is a counter on an object, never a row about a voter". OSE-2123 asks for a CCR on the decided text at the 95% gate, with the Dr of Security in it.

**Class.** `architecture` (an ADR), so 5 loops. The run follows the owner's 2026-11-02 ruling: all five loops ran on the same text, nothing changed between them, and the results are taken together.

**What this CCR did not change.** It edits no ADR, no ticket and no code. Every fix below is a proposal. The owner decides.

## Verdict

| Item                  | Result                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cumulative score      | **0%**. Loop 1 alone scored 0.                                                                                                                     |
| System score          | **0%**. No finding is closed yet. Solutioning below is a plan, not a fix.                                                                          |
| Assessment confidence | 70 → 74 → 78 → 80 → 82. It rose in every loop. Loop 5 checked the citations and merged double counts.                                              |
| Gate                  | **Stop.** Six owner questions (Q6 to Q11), about 12 ADR text edits, and ticket updates.                                                            |
| Security Critical     | **None.** Nothing is built. G2 would become Security Critical if S5 shipped before Q8 is answered.                                                 |
| Recommendation        | Do not treat ADR-040 as ready to build from yet. Merge #1417 with the text edits, answer Q6 to Q11, fix the tickets, then run a confirmation loop. |

**Why the score is 0.** One Critical and 15 High findings are open. Most are quick. About half are wording or consistency fixes in the ADR. About a third are ticket updates. Six need the owner.

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

| Id       | Severity | Loop | Finding                                                                                                                                                                                                      | Evidence                                                                      | Status                                             |
| -------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| F1       | Critical | 1    | The room-screen QR opens the vote page directly, but the presence ticket comes only from `/q`'s redirect to the event page. Room-screen votes are refused. Nothing links the event page to a vote page (H1). | `qr-scan.ts:100-108`; ADR l.58, 82, 86, 98; `pages.ts:1240-1290`; OW-220      | open (Q6)                                          |
| F2       | High     | 1    | Reopen safety rests on "the event's end", which is a movable, nullable date. No one-way "final" state exists, and no test checks one (K2).                                                                   | `0001:15`; `events.ts:1274, 1744`; `event-phase.ts:188`; ADR l.78             | open (Q10)                                         |
| F3       | High     | 1    | Decision 1 deletes receipts "when the set closes". Decision 4 lets a closed set reopen and says receipts survive. The reopen case is tested at the mock layer only (K9).                                     | ADR l.54, l.78                                                                | open (edit E1)                                     |
| F4       | High     | 1    | The ticket's "hash of the cookie value" is not defined as keyed and per event. The ticket rides in a URL that reaches logs and history. It could equal the scan key and link one browser across events (H3). | ADR l.86; `wrangler.toml:107-108`; `qr-scan.ts:190`; `scan-node-key.ts:18-20` | open (edit E3)                                     |
| F5       | High     | 1    | D5 asked for 10 voters "before any winner or per-object count". The owner said "At least 10 for a number to be shown". Decision 7 applies 10 to the winner only.                                             | ADR l.32, 108-114; readiness worksheet D5                                     | open (Q7)                                          |
| F6       | High     | 1    | Up, "not for me" and voter counts are not one nested chain, so unanimity can show (10 voters, 10 up).                                                                                                        | ADR l.108, 129; `count-floor.ts:124-147`                                      | open (Q7)                                          |
| F7       | High     | 1    | Participation names `floorNestedCounts` and `flooredRatePct`. The repo rule for a published chain is `floorPublishedChain` (round, then chain-floor).                                                        | ADR l.129; `count-floor.ts:170-175`                                           | open (edit E7)                                     |
| F8       | Medium   | 1    | Which counter decides a winner is not said. The margin is tested on rounded counts (10 vs 9 publishes as 10 vs 5).                                                                                           | ADR l.109-114; `count-floor.ts:159-167`                                       | open (edit E6)                                     |
| F9       | Medium   | 1    | The participation denominator is not named. A builder's query can fall below the voter count, or can be summed per hour. It then fails closed to nothing.                                                    | `scan_node_returns`; `shared-report.ts:779`; `data-subject.ts`                | open (edit E7)                                     |
| F10      | Medium   | 1    | The team-total rule ("only when every part clears 5") differs from `floorTotalOfParts`, which drops small parts and sums the rest.                                                                           | ADR l.116; `count-floor.ts:79-86`                                             | open (edit E5)                                     |
| F11      | Medium   | 1    | Invariant 2 for admin screens is implied, not stated.                                                                                                                                                        | ADR l.106-116                                                                 | withdrawn: merged into G1                          |
| F12      | Low      | 1    | Decision 6 leaves out the presence CCR's rulings: no ticket on the uncounted path, a missing key fails closed, where a browser keeps its ticket, expiry past midnight.                                       | presence worksheet l.141-143; R2 gate 6                                       | open (edit E4)                                     |
| F13      | Low      | 1    | "Six new tables" against five listed.                                                                                                                                                                        | ADR l.185, 49-52                                                              | open (edit E2)                                     |
| F14      | Medium   | 1    | `vote_participants`: its key domain and its deletion are not stated.                                                                                                                                         | ADR l.52-54                                                                   | open (edit E1)                                     |
| T1       | High     | 1    | No ticket owns the `/q` change that issues the presence ticket, and no gate checks that it is stored nowhere.                                                                                                | ticket text of OSE-2122 to OSE-2132                                           | open (ticket)                                      |
| T2       | High     | 1    | S4a (OSE-2128) lacks the presence CCR's gates: cookie-hash mismatch, expiry, missing key, uncounted path, constant-time compare.                                                                             | OSE-2128; presence worksheet R2                                               | open (ticket)                                      |
| T3       | High     | 1    | N2 (OSE-2126) still builds the cap and says "Blocks S4a". It has no hold and no triggers, and it cites a "decision 12" that does not exist. S0's blocker line is stale.                                      | OSE-2126; ADR l.100-102                                                       | open (ticket)                                      |
| T4       | High     | 1    | S4b (OSE-2129) has no "scan again" message, and its house-rule list lacks "a script" and "zero or not".                                                                                                      | OSE-2129; ADR l.99, 139-140                                                   | open (ticket)                                      |
| T5       | Low      | 1    | S5 bans a "votes-to-scans ratio" next to decision 8's voters-per-device rate. Only the names clash (lowered in loop 3).                                                                                      | OSE-2130; ADR l.127                                                           | open (ticket)                                      |
| T6       | Medium   | 1    | N5 is not among OSE-1193's children. The D10 row says N1 to N5 were created. The Implementation Notes call them "proposed".                                                                                  | ADR l.37, 203; Linear children list                                           | open (edit E12)                                    |
| T7       | Medium   | 1    | N4 lacks R6 (`assert_minted_min`). N3 lacks the new gate list.                                                                                                                                               | OSE-2132; OSE-2131                                                            | open (ticket)                                      |
| T8       | Medium   | 1    | The ADR index still lists ADR-040 as Proposed, and #1417 does not change it (an OSE-2123 acceptance item).                                                                                                   | `docs/adr/README.md:58`; #1417 changes 2 files                                | open (edit E12)                                    |
| T9       | Low      | 1    | OSE-2123's acceptance says one open item. The ADR has two (report detail, wording).                                                                                                                          | OSE-2123; ADR l.150-153                                                       | open (ticket)                                      |
| T10      | Low      | 1    | The D11 row does not say whether "one vote set per event" was accepted.                                                                                                                                      | ADR l.38                                                                      | open (edit E11)                                    |
| T11      | Low      | 1    | D7's rewrite of OSE-513 and OSE-518 is not recorded or ticketed (inferred).                                                                                                                                  | readiness worksheet D7                                                        | open (ticket)                                      |
| G1       | High     | 2    | The set counters and admin surfaces (S3 list, live monitor, audit details) are not barred before the end. With one song open, a live counter is a live song count.                                           | OSE-2125; `live-monitor.ts:1-31`; ADR l.78                                    | open (edit E9)                                     |
| G2       | High     | 2    | One person with 8 browsers can learn a lone voter's side. The card states "zero or not", not this. Dissent: Dr of Security (loop 3) asked for Medium.                                                        | `count-floor.ts:38-43, 159-167`; ADR l.135-140                                | open (Q8)                                          |
| G3       | High     | 2    | N1 (OW-220) is not bound by decision 4: finality, end, kill switch, audit, no count in the reply. "A replay is a new object" can add to a final set.                                                         | OW-220; ADR l.64, 78                                                          | open (edit E10)                                    |
| G4       | Medium   | 2    | N1 has no brand-binding mechanism. `WKRP_SERVICE_TOKEN` is one shared token (lowered in loop 5: N1 already requires the refusal).                                                                            | `shared-report-auth.ts:229-238`                                               | open (ticket)                                      |
| G5       | Medium   | 2    | The timestamp gate's regex misses `votable_objects`, and S2 says "timestamps at the hour" next to `closes_at` for a 2:16 song.                                                                               | `timestamp-precision.invariant.spec.ts:728`; OSE-2125                         | open (ticket)                                      |
| G6       | Low      | 2    | The open, `closes_at` and epoch check runs before the batch, so a close can land in between (lowered in loop 5, ticket-level).                                                                               | OSE-2128                                                                      | open (ticket)                                      |
| G7       | Low      | 2    | The pepper epoch is undefined: who stamps it, how null is handled, what a rotation mid-event does (lowered in loop 5, ticket-level).                                                                         | `lib/anon-id-hash.ts`; OSE-2125                                               | open (ticket)                                      |
| G8       | Medium   | 2    | No route rate limit is named for the open-objects read or the vote POST (AGENTS.md: public reads are limited at the route).                                                                                  | OSE-2127; OSE-2128                                                            | open (ticket)                                      |
| G9       | Medium   | 2    | "A form-page kind" can pull a builder into `/api/v2/events/:id/forms/*`, which mints `ose_anon` and reads FORMS_DB.                                                                                          | `router.ts:2510-2512`; `forms.ts:249`                                         | open (edit E8)                                     |
| G10      | Medium   | 2    | There is no rule for totals across objects or nights (replays, a season, "champion retains").                                                                                                                | `count-floor.ts:208-214`                                                      | open (edit E5)                                     |
| G11      | Medium   | 2    | "No vote time" holds only for D1. Workers Logs time each vote POST to the millisecond, and with one song open that time names the song.                                                                      | `wrangler.toml:107-108`                                                       | open (Q11)                                         |
| G12      | Low      | 2    | The dedup keys (PRIMARY KEY or UNIQUE) and creating the tally row are not stated. S4a's tests would catch both.                                                                                              | OSE-2125                                                                      | open (ticket)                                      |
| G13      | Low      | 2    | ADR-034 decision 4's refusal is not a code check, and no ticket amends ADR-034 when voting ships.                                                                                                            | ADR-034 l.65                                                                  | open (ticket)                                      |
| G14      | Low      | 2    | The 10-voter test's scope (per set, raw) is not stated.                                                                                                                                                      | ADR l.112                                                                     | withdrawn: merged into F5                          |
| H1       | High     | 3    | Nothing links the event page to a vote page, and sending `/q` to `/vote` breaks the poster's form flow.                                                                                                      | `pages.ts:1229-1290`; `qr-scan.ts:93-99`                                      | withdrawn: merged into F1                          |
| H2       | High     | 3    | In-app scanners keep separate cookie jars, so "scan again" cannot rescue a scan made in another app. Q4's acceptance relied on that message.                                                                 | `anonymous-id.ts:48`; ADR l.99                                                | open (Q6)                                          |
| H3       | High     | 3    | The ticket hash could be the scan key, which is the same at every event.                                                                                                                                     | `qr-scan.ts:190`; `scan-node-key.ts:18-20`                                    | withdrawn: merged into F4                          |
| H4       | Low      | 3    | No CSRF or framing control is named. Staging and production share one site (lowered in loop 5).                                                                                                              | `wrangler.toml:172-173, 391-393`; `pages.ts:237`                              | open (edit E8)                                     |
| H5       | Medium   | 3    | Never-who covers voters, not the people voted on. A named team player sits beside their "not for me" count. A label can name a private person.                                                               | ADR l.58; OSE-2125 (labels refuse only email and phone shapes)                | open (Q9)                                          |
| H6       | Medium   | 3    | Remote voting from the poster link is not on the house-rule card.                                                                                                                                            | ADR l.133-140                                                                 | withdrawn: merged into the open Wording item (Q11) |
| H7       | Medium   | 3    | The fun report is a new public surface with no ticket and no gates. Nothing attendee-facing is built.                                                                                                        | `tests/helpers/page-surfaces.ts:68`; OSE-2130 "admin only"                    | open (ticket, OSE-520)                             |
| H8       | Medium   | 3    | Nothing stops the OSE display (`display-config`, public and polled) from carrying a "voting open" flag or the open objects.                                                                                  | `display-config.ts:19-22`; `router.ts:2384`                                   | open (edit E9)                                     |
| H9       | Low      | 3    | The voter page's states are undefined (ended, final, none open, kill switch, "no cookie" against "no ticket") (lowered in loop 5).                                                                           | OSE-2129                                                                      | open (ticket)                                      |
| H10      | Low      | 3    | `/vote` must join the page-surfaces regex and the `/es` prefix.                                                                                                                                              | `tests/helpers/page-surfaces.ts:91`; `router.ts:37-42`                        | open (ticket)                                      |
| H11      | Low      | 3    | The ticket key is not named or tied to one environment.                                                                                                                                                      | `scripts/set-secrets.sh:99-118`                                               | open (edit E3)                                     |
| K1       | Medium   | 4    | Decision 9 accepts inference risks under invariants 1 and 2, which say "no exceptions". There is no governed pointer, and no ticket adds one (lowered in loop 5).                                            | AGENTS.md invariants 1, 2; ADR l.135-140                                      | open (Q8)                                          |
| K2       | High     | 4    | "A set is final" has no born-red fault and no staging case.                                                                                                                                                  | OSE-2127; OSE-2130                                                            | withdrawn: merged into F2                          |
| K3       | High     | 4    | S4a and S3 are each too big for one session once the gaps are folded in.                                                                                                                                     | OSE-2128; OSE-2127                                                            | open (ticket)                                      |
| K4       | Low      | 4    | No threat-ledger entry for the new public write path (lowered in loop 5).                                                                                                                                    | `threat-ledger.yaml:13`                                                       | open (ticket)                                      |
| K5       | Low      | 4    | The vote POST is not classified under the route policy §3.2 and is not on the `guardPublicReadOnly` list (lowered in loop 5).                                                                                | `ROUTE_CLASSIFICATION_POLICY.md`; `public-readonly.ts:27-52`                  | open (ticket)                                      |
| K6       | Medium   | 4    | S1 "Blocks S2, S3" and S2 "Blocks S3" disagree with the ADR's "can start now".                                                                                                                               | OSE-2123, OSE-2125; ADR l.197-200                                             | open (ticket or edit E12)                          |
| K7       | Medium   | 4    | N3 is not linked to each story. It does not cover S1, S1g or N1, names no workflow job per test, and does not require Bruno test names to print.                                                             | OSE-2131; AGENTS.md Quality gates                                             | open (ticket)                                      |
| K8       | Medium   | 4    | The tickets lack STORY-FORMAT parts: prerequisite, CI/CD link, pyramid checklist, SDET load target.                                                                                                          | `docs/brain/STORY-FORMAT.md`                                                  | open (ticket)                                      |
| K9       | Medium   | 4    | "Receipts survive a reopen" is checked at the mock layer only.                                                                                                                                               | OSE-2128                                                                      | withdrawn: merged into F3                          |
| K10      | Low      | 4    | PR #1417's body names OSE-2122 and OSE-1193, not OSE-2123, though it carries the S1 status change.                                                                                                           | PR #1417 body                                                                 | open (PR body)                                     |
| L5-SEC-1 | Medium   | 5    | "A room of 150 gets presence today" claims more than S0 showed. 150 of 150 passed an edge binding of 60 per 10 s, and no one explained why. No ticket exists yet.                                            | `wrangler.toml:236-238`; `public-read-limit.ts:240-250`; ADR l.88, 186        | open (edit E4)                                     |
| L5-SEC-2 | Medium   | 5    | Nothing says the room-screen QR must point at OSE. A short link hosted on OurWKRP would show the named side every voter's tap.                                                                               | ADR l.28, 82; OW-220                                                          | open (Q6)                                          |

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

**Owner questions:** Q6 to Q11, in "Human gate" below.

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

- The owner has answered Q6 to Q11.
- E1 to E12 (or the owner's version of them) are on `main`.
- T1 has a story. T2, T3 and T4 are updated.
- If Q8 is A: the invariant 1 and 2 pointer has its own 5-loop governance CCR, with a human gate each loop, before S5. That could join S1g (OSE-2124).
- A confirmation CCR loop on the amended text scores at least 95%.

## Commit sequence

1. This worksheet, in its own draft PR. No other file.
2. PR #1417 takes E1 to E12, or the owner's version of them, plus the index line. The owner merges it.
3. The owner's answers to Q6 to Q11 are recorded in the ADR's answers table, dated.
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
