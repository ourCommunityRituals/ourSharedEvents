# ADR-040: An anonymous vote is a counter on an object, never a row about a voter

**Status:** Proposed. The owner answered nine of the twelve questions on 2026-11-17 (in a comment on PR #1413). Three are still open: D3, D6 and D10. Nothing here is built.
**Date:** 2026-11-17
**Deciders:** Owner (PO). Sr Architect owns the draft. Dr of Security advises on the membrane.
**Ticket:** OSE-1193 (blocks OSE-2000 under the fairs epic OSE-1996; step 1 of OW-218, Fist of Five)

## Context

Fist of Five nights and fair competitions need a vote: a person in the room taps a code and backs a song, a stall or a team. OurSharedEvents has no voting code (read 2026-11-17 at `main` 82a4767: no vote, ballot, votable or tally table or handler).

A vote adds **preference** to presence. "Never who" (AGENTS.md invariant 1) and the under-5 floor (invariant 2) must hold for it as they do for scans.

A five-loop CCR on the smallest safe shape ran on 2026-11-17 (PR #1407, worksheet `CCR-VOTABLE-OBJECT-READINESS-2026-11-17.md`). The owner reverted it from `main` in PR #1413 and answered its twelve questions in a comment there. Its findings are summarised in the comment on OSE-1193 and are the basis of this ADR.

What the code already gives:

- **The hour only.** The scan path keeps no time finer than the hour (`migrations/0100`, `tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts`).
- **A keyed browser id.** `scan_node_returns` holds a keyed id, never the cookie (`lib/scan-node-key.ts`, `migrations/0101`).
- **The count floor.** `lib/count-floor.ts` has `applyCountFloor`, `roundForPublish`, `floorTotalOfParts` and `floorNestedCounts`.
- **Booths.** Booths are rows (`migrations/0109`, ADR-034 decision 1).
- **One id per play, on the OurWKRP side.** ourWKRP migration 0011 (`playback_events`) gives every play of a song its own id. Its scan-resolution law says a vote resolves by the unit id carried in the code, never by comparing a time with a play log.

## The owner's answers (2026-11-17, PR #1413)

| Question                                                                                                       | Owner's answer                                                                                                                                                                                                                                              | What it means here                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D1. Votes on OSE's anonymous database, aggregate-only                                                          | **Yes.** "The person hitting the qr shorturl is expected privacy when tapping." Votes are attributed to the song through the OurWKRP assignment, which carries the authorization token. Team players sign up to compete; audience members vote anonymously. | Decision 1. OW-73 sends voters to OSE and stores no votes. See the open confirmation C1. |
| D2. The vote button on an OSE page; the room screen shows a QR code                                            | **Yes.** No reason it could not. The owner had kept them separate only to leave room for explanation.                                                                                                                                                       | Decision 5. The voter page carries the explanation.                                      |
| D3. Read `ose_anon` (never set it) on one new route, through its own 5-loop CCR                                | **Not answered.**                                                                                                                                                                                                                                           | Open. The vote route waits on it.                                                        |
| D4. The winner only from published counts, a margin of at least 5, "Fewer than 5" in place of "held"           | **Yes.**                                                                                                                                                                                                                                                    | Decision 7.                                                                              |
| D5. At least 10 distinct voters before any count or winner                                                     | **At least 10** for a number to be shown. That is also when a **fun version of the SharedReport** is made, so the people in attendance have faith in the voting. "This is for fun and sponsorship, but not hard numbers (yet)."                             | Decisions 7 and 8.                                                                       |
| D6. Gate votes on their own vote set; ADR-034 decision 4 refuses `competition` only until the vote route ships | **Not answered.**                                                                                                                                                                                                                                           | Open.                                                                                    |
| D7. No tally, winner or count before the event's end; none on the display                                      | **"Yeah."** The owner has "rethought this into more transparency".                                                                                                                                                                                          | Decision 7, with the open confirmation C2.                                               |
| D8. Accept the residual risks in writing, or add noise                                                         | **Accepted, under a house rule.** Bocce has a "don't be a dick" rule; voting goes under a "don't be a jag-off" rule that lists the risks so the people there can self-police.                                                                               | Decision 9.                                                                              |
| D9. Own-team voting allowed; "too close to call, the champion retains"                                         | **Yes.**                                                                                                                                                                                                                                                    | Decision 7.                                                                              |
| D10. Move OSE-1193 out from under OSE-1192; take the refreshed text; split S0 to S5                            | **Not answered.**                                                                                                                                                                                                                                           | Open.                                                                                    |
| D11. One vote set per event, never reopened                                                                    | **"One vote an event, one vote a stall, one vote a song to start."**                                                                                                                                                                                        | Decision 4. See the open confirmation C3.                                                |
| D12. Drop the participation rate against the logged headcount                                                  | **"Add it if you think it will find value to our overall goal."**                                                                                                                                                                                           | Decision 8: kept, against a denominator that is nested by construction.                  |

**A further direction (owner, PR #1413, same day).** The owner gave a four-song set totalling exactly 20:00: 7:11, 6:30, 4:03 and 2:16. They wrote: "This [is] what the time needs to be reacting to what is coming in for the Fist of Five and not be dictated by the 1 hr gate. The stacks are tiny and are fun." This is decision 3.

## Decision

### 1. Votes live in `DB`, aggregate-only

The tables are additive and live in `DB`, never in `FORMS_DB` and never on OurWKRP:

- `votable_objects`: what can be voted on.
- `vote_sets`: one per event.
- `vote_tallies`: two counters per object, up and "not for me".
- `vote_receipts` and `vote_participants`: one-vote markers.

There is no per-vote row, no voter id and no vote time. A receipt carries no side. It is an HMAC of the raw cookie value and the object id, under a key derived from `ANON_ID_HASH_PEPPER`. The cookie is stored nowhere, so the database is not a list of voters. Receipts are deleted when the set closes.

### 2. A vote finds its song by an id in the code, never by the clock

A song object stands for one play. OurWKRP keeps the link from its `playback_events` id to the OSE object id, and OSE stores no OurWKRP id. The code on the room screen carries the object's id. "During this time frame" (D1) is when that object is open; it is never worked out by comparing a timestamp with a play log.

### 3. A song's window follows the song, not the hour

Opening and closing an object is a state change made by the server. For a song, OurWKRP's song-change signal triggers it, through the route in proposed ticket N1. A window can be 2:16 or 7:11 long.

This does not conflict with the hour rule. That rule limits the time **stored on scan rows**, and a vote stores no time at all. The only clock the vote path keeps is the object's `closes_at`, which names a song's window, not a voter. Each open and close is written to the admin audit log, which times the song, not a person.

### 4. One vote per person per song, per stall, and per event

A person has one vote per object:

- per song, for Fist of Five;
- per stall, for a fair;
- per event, through one event-level object (for example "best of the night").

Dedup is the receipt per object. A duplicate changes nothing and answers the same as a counted vote. "To start" means the limits may be loosened later by a new decision; none is built for that now.

### 5. The voter page is on OSE

The voter page is `GET /events/:id/vote`, a form-page kind, on the same host that served `/q`. It explains the vote, carries the house rule (decision 9), and shows the sponsor strip below the title and date. The OurWKRP room screen shows only a QR code that opens it. The vote write is a `POST` outside `/api/v2/events*`, handled on the `DB` side. Its exact route waits on D3.

### 6. Presence

A vote counts only from a browser that scanned this event's code. Proof is a short-lived presence ticket that `/q` adds to its redirect: an HMAC over the event id, an expiry within the event day, and a hash of the cookie value. The ticket is stored nowhere.

Before the route ships, the S0 spike on staging must show that a full room behind one Wi-Fi address can still get a cookie through `/q` (`/q` mints none past its per-caller limit, `handlers/qr-scan.ts:168-181`). OSE-1496 cookie signing comes first.

### 7. Results after the event

No tally, winner or voter count appears before the event's end, and none on the display (invariant 5). After the end:

- A side's count goes through `applyCountFloor`, then `roundForPublish`. Under 5, it reads "Fewer than 5".
- A winner is named only from published counts, and only when all of these hold:
  - the winner's and the runner-up's counts are both published;
  - the margin between them is at least 5;
  - at least **10** distinct voters voted.

  Otherwise the result reads "too close to call", and the champion retains.

- A team total is the sum of its published parts, shown only when every part clears 5.
- Own-team voting is allowed.

### 8. The fun report and participation

Once at least 10 distinct people have voted, the event gets a **fun results report** after the event, for the people who were there and for sponsors. It shows only what decision 7 allows and says plainly that the numbers are for fun, not hard numbers. It belongs to OSE-520.

**Participation** (D12, delegated to the team) is kept, because sponsors and organizers value it:

- It is published as voters against the devices that scanned in at this event, not against the logged headcount.
- Presence (decision 6) makes every voter one of those devices, so the two counts are nested.
- The pair goes through `floorNestedCounts` and `flooredRatePct`, after the event only.

### 9. The house rule: "don't be a jag-off"

The owner accepts these residual risks, and the voter page states them in plain words so the room can self-police:

- **Colluders.** Five or more people who know their own votes can work out one other person's vote from a published result.
- **Several browsers.** Someone who scans with several browsers can vote more than once.
- **Database history.** For 30 days, D1's history can link a scan to a vote by the order of writes.
- **Timing.** A duplicate may answer faster than a counted vote.

The card's exact wording is the owner's.

## Still open

| Id  | Question                                                                                                                                                                                                                           | Blocks                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| D3  | May `ose_anon` be read, never set, on the one vote route, amended into invariant 4 through its own 5-loop CCR?                                                                                                                     | The vote route (S4a)                      |
| D6  | Do votes gate on their own vote set, with ADR-034 decision 4 refusing `competition` only until the vote route ships?                                                                                                               | The vote route; OSE-2000 competition mode |
| D10 | Does OSE-1193 move out from under OSE-1192, take the refreshed text, and split into S0 to S5?                                                                                                                                      | Linear only                               |
| C1  | Confirm: "attributed to the song during this time frame" means through the id the code carries (decision 2), never by comparing a clock with the play log?                                                                         | Decision 2                                |
| C2  | "Rethought into more transparency": does that mean the fun report after the event (decision 8), or something shown during the night? A count shown during the night would need a change to invariant 5 through its own 5-loop CCR. | Decision 7                                |
| C3  | "One vote a song to start": may a closed vote set ever reopen, or is it final (the CCR's recommendation, to stop counts being differenced)?                                                                                        | Decision 4                                |

## Alternatives Considered

### Alternative A: one row per vote, with a hashed voter key

This is the September 2026 design (migration "0069", never merged).

**Rejected because:** a stable voter key beside a song object is a per-person timeline of preference. The September CCR held it.

### Alternative B: votes stored on OurWKRP

**Rejected because:** OurWKRP holds named people. The owner ruled on 2026-10-09 (OSE-520), and again in D1, that votes live on OSE's anonymous side.

### Alternative C: a vote resolved by the time of the tap

**Rejected because:** of OurWKRP's scan-resolution law and OW-219. A clock-matched vote would need a fine time on the vote, which the hour rule forbids.

### Alternative D: noise added to counts

**Rejected because:** the owner chose a house rule instead (D8). Noise would end exact winners.

## Consequences

### Positive

- One engine serves songs, stalls, teams and an event-wide vote.
- No table can say who voted.
- Song windows can be as short as the song.

### Negative

- Six new tables and a presence ticket on `/q`.
- A vote needs a cookie from `/q`, so a full room behind one address depends on the S0 spike.
- The residual risks are carried by a house rule, not by code.

### Neutral

- Counts are seen only after the event. The fun report is the moment of transparency.

## Implementation Notes

The planned stories (proposed in the OSE-1193 comment; D10 is open):

- **Can start now:**
  - S0, the staging spike on room presence;
  - S2, the tables and their gates, including the timestamp gate's scan-shaped rule learning `vote|tally|ballot|receipt|participant`;
  - S3, admin open and close of sets and objects.
- **Waits on D3, D6, OSE-1496 and S0:** S4a, the vote route, and S4b, the voter page.
- **Waits on decisions 7 and 8:** S5, results after the event. The fun report waits on OSE-520.
- **Proposed new tickets:** N1 (the OurWKRP route that opens and closes song objects, scoped to a brand), N2 (a cookie-mint cap at `/q`), N3 (the CI/CD testing ticket), N4 (a staging load case for a room behind one address), N5 (widen the unrun-spec check).

Every test is seen failing first, at the workers-pool layer and on staging (Bruno, Playwright).

## References

- **Tickets:** OSE-1193, OSE-1192, OSE-2000, OSE-1996, OSE-513, OSE-514, OSE-518, OSE-520, OSE-1496; OW-73, OW-218, OW-219.
- **PRs:** #1407 (the CCR worksheet), #1413 (its revert, with the owner's answers).
- **ADRs:** ADR-034 (booths, participation mode), ADR-032 (a mode as a column).
- **Rules:** AGENTS.md invariants 1, 2, 3, 4 and 5.

## Revisit Criteria

- The owner answers D3, D6, D10, C1, C2 or C3.
- A count is wanted during the night (invariant 5).
- A vote limit beyond one per object is wanted ("to start").
