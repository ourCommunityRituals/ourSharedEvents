# ADR-040: An anonymous vote is a counter on an object, never a row about a voter

**Status:** Accepted. The owner accepted this ADR by merging PR #1414 on 2026-11-18. The owner answered every question on 2026-11-17 and 2026-11-18 (comments on PRs #1413 and #1414; D6 and D10 in the owner's own session on 2026-11-18; Q6 to Q16 in question forms on 2026-11-18, Q17 in the owner's own words). Amended twice on 2026-11-18: decision 6 after the S0 spike (OSE-2122) and a three-loop CCR (PR #1416, merged in #1417); then decisions 1 to 10 after the five-loop S1 CCR (PR #1418) and the owner's answers to it, including the reversal of D3, in PR #1420 (a draft until the owner merges it). Amended a third time on 2026-11-18, after the owner's decisions on S3d and S3e: the room's own vote code (decision 6) and decision 11, "nothing is more live than its container" (OSE-2140, OSE-2142). Still open: the level of detail in the published report (OSE-520), and the owner's wording for the house-rule card and the report. Amended a fourth time on 2026-11-24 for scan to vote at events and markets (decision 12, OSE-2223 under OSE-2222). Built: the tables (S2), the admin set-up (S3), the pass at `/q` (S3b), the public open-objects read and the switch (S3c), the vote code and the container rule (S3d, S3e), and the vote route, the voter page and the night's result (S4a, S4b, S5, PR #1490). Voting is switched off in every environment (`VOTING_ENABLED = "off"`). Built for decision 12 (PR #1545, 2026-11-24): the `entry` kind (OSE-2224) and the off-limits list with the host's warning (OSE-2225). Not built: the host's vote-code screen (decision 12, OSE-2226) and the fun report (OSE-520). Amended a fifth time on 2026-11-26: flood detection only, under decision 6 (OSE-2234). Amended a sixth time on 2026-11-26: integrity, in the room only (the rotating code, the room size and its check at final, the one-way flag, names fixed once voting opens), under decision 6. Amended a seventh time on 2026-11-26 for the Access Pass and the Online Pick (decision 13, the owner's permission of 2026-11-26), built in the same PR except the host's admin card.
**Date:** 2026-11-17. Amended 2026-11-18 (decision 6 after S0; decisions 1 to 10 after the S1 CCR; decisions 6 and 11 after S3d and S3e), 2026-11-24 (decision 12, scan to vote at events and markets) and twice on 2026-11-26 (decision 6, flood detection only; then integrity, in the room only; then decision 13, the Access Pass and the Online Pick).
**Deciders:** Owner (PO). Sr Architect owns the draft. Dr of Security advises on the membrane.
**Ticket:** OSE-1193 (blocks OSE-2000 under the fairs epic OSE-1996; step 1 of OW-218, Fist of Five)

## Context

Fist of Five nights and fair competitions need a vote: a person in the room taps a code and backs a song, a stall or a team. OurSharedEvents has no voting code (read 2026-11-17 at `main` 82a4767: no vote, ballot, votable or tally table or handler).

A vote adds **preference** to presence. "Never who" (AGENTS.md invariant 1) and the under-5 floor (invariant 2) must hold for it as they do for scans.

A five-loop CCR on the smallest safe shape ran on 2026-11-17 (PR #1407, worksheet `CCR-VOTABLE-OBJECT-READINESS-2026-11-17.md`). The owner reverted it from `main` in PR #1413 and answered its twelve questions in a comment there. Its findings are summarised in the comment on OSE-1193 and are the basis of this ADR. A five-loop CCR on the decided text ran on 2026-11-18 (PR #1418, worksheet `CCR-ADR-040-DECIDED-TEXT-2026-11-18.md`); its questions Q6 to Q16 and the owner's answers are below.

What the code already gives:

- **The hour only.** The scan path keeps no time finer than the hour (`migrations/0100`, `tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts`).
- **A keyed browser id.** `scan_node_returns` holds a keyed id, never the cookie (`lib/scan-node-key.ts`, `migrations/0101`).
- **The count floor.** `lib/count-floor.ts` has `applyCountFloor`, `roundForPublish`, `floorTotalOfParts`, `floorNestedCounts`, `floorPublishedChain` and `floorCumulativeOfParts`.
- **Booths.** Booths are rows (`migrations/0109`, ADR-034 decision 1).
- **One id per play, on the OurWKRP side.** ourWKRP migration 0011 (`playback_events`) gives every play of a song its own id. Its scan-resolution law says a vote resolves by the unit id carried in the code, never by comparing a time with a play log.

## The owner's answers (2026-11-17, PR #1413)

| Question                                                                                                       | Owner's answer                                                                                                                                                                                                                                                                                                                                                                                                 | What it means here                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D1. Votes on OSE's anonymous database, aggregate-only                                                          | **Yes.** "The person hitting the qr shorturl is expected privacy when tapping." Votes are attributed to the song through the OurWKRP assignment, which carries the authorization token. Team players sign up to compete; audience members vote anonymously. On 2026-11-18 (C1): yes, by the id in the code.                                                                                                    | Decisions 1 and 2. OW-73 sends voters to OSE and stores no votes.                                                     |
| D2. The vote button on an OSE page; the room screen shows a QR code                                            | **Yes.** No reason it could not. The owner had kept them separate only to leave room for explanation.                                                                                                                                                                                                                                                                                                          | Decision 5. The voter page carries the explanation. The room screen's code is the event's `/q` vote code (Q6).        |
| D3. Read `ose_anon` (never set it) on one new route, through its own 5-loop CCR                                | **Reversed** (2026-11-18). It was yes ("this is the ose anonymous token"), then: "How does this get limited on anonymous tokens? There should be no exceptions to keep the privacy footprint clean and unexploitable. Once there is a seam, it's a way in." No new reader of `ose_anon`.                                                                                                                       | Decisions 5 and 6. Invariant 4 is unchanged. S1g (OSE-2124) is cancelled. Every cookie read stays inside `/q`.        |
| D4. The winner only from published counts, a margin of at least 5, "Fewer than 5" in place of "held"           | **Yes.** Refined by Q8 (2026-11-18): no per-object number is published, so the winner rule runs on unpublished counts and only the outcome is published.                                                                                                                                                                                                                                                       | Decision 7.                                                                                                           |
| D5. At least 10 distinct voters before any count or winner                                                     | **At least 10** for a number to be shown. That is also when a **fun version of the SharedReport** is made, so the people in attendance have faith in the voting. (Decision 8: every final set that is not void gets the report, so its existence says nothing about the minimum.) "This is for fun and sponsorship, but not hard numbers (yet)." Q7 (2026-11-18): 10 before **any** number, not only a winner. | Decisions 7 and 8.                                                                                                    |
| D6. Gate votes on their own vote set; ADR-034 decision 4 refuses `competition` only until the vote route ships | **A** (2026-11-18, answered in the owner's session): voting turns on when an admin opens voting for the event, such as tonight's songs. It works for a bar night with no fair.                                                                                                                                                                                                                                 | Decision 10.                                                                                                          |
| D7. No tally, winner or count before the event's end; none on the display                                      | **"Yeah."** The owner has "rethought this into more transparency". On 2026-11-18 (C2): publish the reports with enough detail to give trust in the process.                                                                                                                                                                                                                                                    | Decisions 7 and 8. The level of detail is open (Still open).                                                          |
| D8. Accept the residual risks in writing, or add noise                                                         | **Accepted, under a house rule.** Bocce has a "don't be a dick" rule; voting goes under a "don't be a jag-off" rule that lists the risks so the people there can self-police. Q8 (2026-11-18) adds a secret random margin for outcomes only.                                                                                                                                                                   | Decisions 7 and 9.                                                                                                    |
| D9. Own-team voting allowed; "too close to call, the champion retains"                                         | **Yes.**                                                                                                                                                                                                                                                                                                                                                                                                       | Decision 7.                                                                                                           |
| D10. Move OSE-1193 out from under OSE-1192; take the refreshed text; split S0 to S5                            | **Yes, move and split** (2026-11-18, answered in the owner's session). OSE-1193 leaves the post-launch epic, takes the refreshed story text, and becomes S0 to S5, one session each. N1 to N4 are created.                                                                                                                                                                                                     | Implementation Notes. Done in Linear.                                                                                 |
| D11. One vote set per event, never reopened                                                                    | **"One vote an event, one vote a stall, one vote a song to start."** On 2026-11-18 (C3): a closed vote set may reopen, "to be flexible in case there is time screw up". Q10 (2026-11-18): once results are computed, the set locks for good.                                                                                                                                                                   | Decision 4, with the reopen rule and the final lock. One vote set per event stands (decision 1), accepted with #1414. |
| D12. Drop the participation rate against the logged headcount                                                  | **"Add it if you think it will find value to our overall goal."**                                                                                                                                                                                                                                                                                                                                              | Decision 8: kept at first, then dropped (Q8-2, 2026-11-18). No participation figure is published.                     |

**A further direction (owner, PR #1413, same day).** The owner gave a four-song set totalling exactly 20:00: 7:11, 6:30, 4:03 and 2:16. They wrote: "This [is] what the time needs to be reacting to what is coming in for the Fist of Five and not be dictated by the 1 hr gate. The stacks are tiny and are fun." This is decision 3.

## The owner's answers to the S1 CCR (2026-11-18, question forms, PR #1418)

| Question                                                                                               | Owner's answer                                                                                                                                                                                                                                                                                                                                             | Where                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Q6. How does a person at the room screen get presence?                                                 | **The room screen shows the event's own `/q` scan code.** Scanning gives the pass and opens the vote page. Each song's button carries the song's id. Never an OurWKRP short link.                                                                                                                                                                          | Decisions 2, 5 and 6 |
| Q7. Is 10 voters needed before any number, not only a winner?                                          | **Yes.** At least 10 distinct voters in the set before any number is shown.                                                                                                                                                                                                                                                                                | Decision 7           |
| Q8. One person who controls every vote but one can learn that last vote. How is that handled?          | **Remove it by design, no exception:** no per-song up or down numbers are published, only outcomes and a rounded voter count (the count was later dropped, Q8-2). Then, told that outcomes alone still leak: **A, a hidden random margin**, a reduction accepted knowingly, not a fix. No note under invariants 1 or 2.                                    | Decisions 7 and 9    |
| Q8-2. The night's voter count can show whether one person voted at all. Publish it?                    | **Drop it.** No count of voters is published, and the participation figure goes too.                                                                                                                                                                                                                                                                       | Decisions 7 and 8    |
| Q9. May a person be the thing voted on?                                                                | **Only opted-in presenters.** Otherwise objects are things: songs, stalls, teams.                                                                                                                                                                                                                                                                          | Decision 2           |
| Q10. Should a set lock for good once results are computed?                                             | **Yes, a one-way final lock.** No date change undoes it; a final set never reopens.                                                                                                                                                                                                                                                                        | Decision 4           |
| Q11. Should the card also name remote voting and log timing?                                           | **Yes, both.** A poster photo lets someone vote from elsewhere while voting is open. Cloudflare's logs record each vote's arrival time to the millisecond. The final card wording is the owner's.                                                                                                                                                          | Decision 9           |
| Q12. Do you accept the forwarded-pass risk, and how long does a pass last?                             | **Accept, 30 minutes,** renewed by scanning again. It goes on the card.                                                                                                                                                                                                                                                                                    | Decisions 6 and 9    |
| Q13. Make the 10-voter minimum a secret random number per set (10 to 14)?                              | **Yes, secret 10 to 14,** drawn and deleted like the margin. A reduction accepted knowingly, not a fix.                                                                                                                                                                                                                                                    | Decision 7           |
| Q14. A song's up vote feeds two results. Publish only the night's winner?                              | **The night's winner only** (or "too close to call"). No per-song results.                                                                                                                                                                                                                                                                                 | Decisions 7 and 8    |
| Q15. The secret numbers still leave up to about two in five per set. Accept that, or widen the ranges? | **Accept it, stated on the card.** Keep the margin at 5 to 9 and the voter floor at 10 to 14. A risk accepted knowingly. This is the stop point: no further changes to the publishing rules.                                                                                                                                                               | Decisions 7 and 9    |
| Q16. On a team night, how is the winner counted?                                                       | **Teams win on their total, and one voter counts once per team:** a team's total is the number of distinct voters who gave any of its songs an up vote. Voting up several of a team's songs counts once. Chosen so the risk stays at the level accepted in Q15; the per-song sum, which would need an exception, was declined.                             | Decisions 1 and 7    |
| Q17. On a team night, may the player with the most votes break a tie?                                  | **No: pulled.** The owner's words: "if it raise the risk then pull it." A check found it raises the risk above the Q15 rate (to about four in five per set, and every time if the player is named). A close night stays "too close to call, the champion retains". No tiebreak, no "won on the tiebreak" flag, and no player picked by the votes is named. | Decision 7           |
| Apply the review's text and ticket edits?                                                              | **Yes, as a draft PR.**                                                                                                                                                                                                                                                                                                                                    | This text            |

## Decision

### 1. Votes live in `DB`, aggregate-only

The tables are additive and live in `DB`, never in `FORMS_DB` and never on OurWKRP. There are six:

- `votable_objects`: what can be voted on.
- `vote_sets`: one per event.
- `vote_tallies`: two counters per object, up and "not for me".
- `vote_receipts` and `vote_participants`: one-vote markers.
- `vote_team_markers`: one marker per voter per team, on a team night (Q16).

There is no per-vote row, no voter id and no vote time. A receipt carries no side. It is `HMAC(K_receipt, k ‖ object_id)`, where k is the per-event voter key from decision 6 and `K_receipt` is a server-only subkey. A participant marker is `HMAC(K_participant, k ‖ set_id)`, under its own subkey, so it can never equal a receipt. On a team night, a team marker is `HMAC(K_team, k ‖ team_id)`, under its own subkey, written in the same batch as an up vote on any of that team's songs, only if it is new. A team's total is the count of its team markers, so one voter counts once per team, however many of its songs they back. A team marker carries no voter id; it is deleted at final with the receipts. No cookie value reaches the vote route or the vote tables, and k is stored nowhere, so the database is not a list of voters. Receipts and participant markers are deleted when the set becomes final (decision 4), never when it only closes. Tallies are deleted 30 days after final; only the published outcomes are kept. Every set reaches final (decision 4), so nothing is kept without a bound.

### 2. A vote finds its song by an id, never by the clock

A song object stands for one play. OurWKRP keeps the link from its `playback_events` id to the OSE object id, and OSE stores no OurWKRP id. OurWKRP shows a team or player by the name they chose: their profile name, or a team name plus a stage name. OSE holds no name of any kind: a team is an OSE `group_id`, and OurWKRP keeps the link from its own ids to OSE's. The room screen shows the event's vote code, a `/q` code on OSE (Q6, decision 6). The vote page lists the objects that are open now, and each vote button carries its object's id. "During this time frame" (D1) is when that object is open; it is never worked out by comparing a timestamp with a play log.

The owner confirmed this on 2026-11-18 (C1), and added that it sets up voting on whatever else comes to be voted on: an art competition, community parade floats, and so on. Each of those is one more kind of object; the engine does not change.

An object is a thing: a song, a stall, or an entry the organizer names (decision 12). On a team night each song carries its team in `group_id`, set when the song is created and fixed once the set first opens, and the team is what wins (decision 7). A person may be the object only if they opted in as a presenter (Q9; AGENTS.md invariant 1). Labels refuse email- and phone-shaped text.

### 3. A song's window follows the song, not the hour

Opening and closing an object is a state change made by the server. For a song, OurWKRP's song-change signal triggers it, through the route in N1 (OW-220). A window can be 2:16 or 7:11 long.

This does not conflict with the hour rule. That rule limits the time **stored on scan rows**, and a vote stores no time at all. The only clock the vote path keeps is the object's `closes_at`, which names a song's window, not a voter. Each open and close is written to the admin audit log, which times the song, not a person.

N1 obeys decision 4. It is bound to the event's brand (the shared service token alone is not enough), it adds no object to a final set or after the event's end, it is audited, it honours the kill switch, and it returns no count.

### 4. One vote per person per song, per stall, and per event

A person has one vote per object:

- per song, for Fist of Five;
- per stall, for a fair;
- per event: an event has one vote set (decision 1), and the set reports one result (Q14), so the event-level vote is the set's result itself. There is no separate event-level object; a single object would have no runner-up to be compared with. A set holds objects of one kind (songs, or stalls), and is played by songs or by teams, fixed when it first opens (decision 7). On a Fist of Five night the songs are the vote, and the night's winner is the result.

Dedup is the receipt per object. A duplicate changes nothing and answers the same as a counted vote. "To start" means the limits may be loosened later by a new decision; none is built for that now.

**Reopening (owner, 2026-11-18, C3) and the final lock (Q10).** A host may reopen a closed object or vote set while the event is still on and Published (decision 11), to recover from a timing mistake. This is safe only because no count is read before the set is final (decision 7), so nobody can compare a count before and after the reopen. Results are computed once. Computing them sets a one-way `final` flag on the set. After it, nothing reopens the set or adds an object to it: not a host, not N1, and not a change to the event's dates or status. If nobody computes results within 7 days of the event's end date (or of the set's last close, when the event has no end date), a scheduled job computes them, which sets final. A void set is finalized the same way and publishes nothing. These two numbers, 7 and 30 days, are proposed defaults the owner may change. Every close, reopen and finalization is written to the audit log. No audit entry, log line or response says which rule decided the result (the margin, the voter floor, or none); it records only that the set became final. A receipt survives a reopen, so a person who already voted on an object still cannot vote on it twice.

### 5. The voter page is on OSE

The voter page is `GET /events/:id/vote`. It is styled like a form page, but it is not a forms route: it uses no forms API and sets no cookie. It explains the vote, carries the house rule (decision 9), and shows the sponsor strip below the title and date. The OurWKRP room screen shows only the event's vote code, a `/q` code on OSE, never an OurWKRP short link.

The vote write is a `POST` outside `/api/v2/events*`, handled on the `DB` side. It reads no cookie: it never reads the `Cookie` header and never sets one (D3 reversed, 2026-11-18). It takes JSON only and checks `Sec-Fetch-Site: same-origin`, and the page cannot be framed. The vote `POST` and the public open-objects read each have a rate limit at the route (`lib/public-read-limit.ts`). An address used as a limit key is a key only, never stored or logged (invariant 3). A gate fails if the vote route's files read the `Cookie` header or `ose_anon`. AGENTS.md invariant 4 is unchanged: `/q` stays the only reader on the vote path.

### 6. Presence

A vote counts only from a browser that scanned this event's vote code. Every cookie read stays inside `/q` (D3 reversed).

**The room's own vote code (owner, 2026-11-18; S3d, OSE-2140).** The vote code is a placement of its own: a `poster_deployments` row marked `is_vote_code = 1` (migration 0113), with a token of its own (128 random bits), made only by `POST /api/v2/admin/events/:id/votables/code` (`lib/vote-code.ts`). One is in use per event (a partial unique index). A host who fears it was photographed replaces it from the Voting card (`POST .../votables/code/replace`): the old one is retired and a new token made in one batch, and the old code then resolves to nothing at `/q`. A retired code is never brought back: the placement edit refuses `is_active` on a vote code. Its URL is `/q/<token>?type=vote`.

- `/q` mints a pass only for that placement. `?type=vote` on an ordinary poster code of the event mints nothing and keeps today's redirect. The S3b security review (F1) found the old rule, any code of the event with `?type=vote`, wider than the accepted risk, because a poster code's token can be reached from a shared event-page link, through `&deployment=` and the public poster bundle.
- The vote code's token is in no public answer. The public poster bundle never resolves a vote code from `&deployment=` (it answers as for no placement), the admin poster list leaves it out, and the event page reads no token. The admin Voting card shows its URL and QR; the host puts it on the room screen.
- The OSE display (the TV page and `display-config`) does not show it: decision 7 keeps every vote word off the display. The room screen that shows it is OurWKRP's.
- Why a marked placement, not a token kept on the vote set: `/q` stores the scan the pass stands on against a placement, so a placement is the smaller safe shape. A token on the set would need a second scan path.
- A scan of the vote code is stored like any placement's, once per browser per hour, so the pass can stand on it. It is in no poster figure (owner, 2026-11-18): not the SharedReport's poster attribution, the per-poster scans, reach, booth counts, the scans gauge, the dashboards' poster scans and anonymous participation, or any count of posters. The vote code is the room screen, not a poster, and its scans would publish a rough participation figure for the vote. The event-level scan totals built from `scan_node_returns`, which by design hold no placement, still include them.

- At `/q`, the event's vote code, with a set open, the event live (decision 11) and `VOTING_ENABLED` on, derives a per-event voter key `k = HMAC(K_voter, len(cookie) ‖ cookie ‖ event_id)`. `K_voter` comes from `ANON_ID_HASH_PEPPER` by HKDF under its own label, separate from the scan key, the pass seal, the receipt key, the participant key and the team key. k differs at every event and is stored nowhere.
- `/q` mints a pass only when the pepper is set and the scan was stored, or was a duplicate of one stored. The uncounted path mints none, a missing key mints none, and a failed write mints none.
- The pass is `{event_id, expiry, pepper_epoch, k}`, sealed with a MAC under `K_pass`, which comes from `ANON_ID_HASH_PEPPER` by HKDF under its own label, so it differs in each environment. `/q` puts it in the redirect's fragment (`/events/:id/vote#t=…`), so it is never in a query string, a `Referer` or a request log.
- The voter page reads the fragment and removes it from the address bar at once. It keeps the pass in memory only, writes nothing to storage, and posts it in the JSON body. With no pass, it says to scan the code on the screen again.
- A pass lasts 30 minutes (Q12), and a re-scan renews it. A re-scan in the same browser gives the same k, so the same receipts.
- The vote route checks the MAC (in constant time), the event, the expiry and the epoch. No log line and no CI output carries the pass, k, a receipt or the `Location` header.
- **The pepper epoch.** S3 stamps `vote_sets.pepper_epoch` with `pepperEpoch(ANON_ID_HASH_PEPPER)` (`lib/anon-id-hash.ts`) when the set first opens, and never restamps it. A pass carries the epoch it was minted under. The vote route compares three epochs: the pass's, the set's and the current one (`pepperEpoch` of the pepper it runs with). All three must match. If the pepper rotates while the set is open, they differ, every later vote is refused, and the vote route marks the set void, with its reason, on the first mismatch. A pass minted before the rotation is refused too, so no one gets a second receipt under the new key. A void set publishes nothing, and a reopen cannot clear the void. A missing pepper has no epoch, and no epoch never matches. The pepper is not rotated while a vote set is open (runbook).

**S0 result (OSE-2122, 2026-11-18).** `/q` counts scans per address, across all events: an edge binding (60 per 10 s) and KV (360 a minute). Past either, it sends the visitor on with no cookie (`handlers/qr-scan.ts:168-181`). On staging, 150 fresh browsers from one address each got a cookie and a counted scan, once over 20 s and once over 5 s, through the CI path (Room burst (stg) runs 44227517345 and 44231501658; 150 of 150 each time). The 5-second run passed the edge binding's nominal rate, and why is not yet explained. The pass is not built yet. Not measured: real phones, production, carrier shared addresses, more than 360 scans a minute.

**Decision (owner, 2026-11-18, after the three-loop CCR, PR #1416).**

- `/q` minting does not change for the first night. No per-address cap is added at `/q`:
  - The cookie can be forged (`lib/anonymous-id.ts` accepts any `anon_` value), so a cap on cookies would not bound votes.
  - No cap per address can be both room-sized and small enough to stop stuffing.
  - Every such cap gives one person a way to lock the room out.
- Presence is the pass above, checked by the vote route (decision 5).
- Cookie signing (OSE-1496) no longer comes first. It does not block the vote route.
- Presence comes from the event's vote code, on the room screen (Q6). The vote code is its own placement beside the poster's codes (S3d, above); every poster code keeps today's redirect to the event page, whatever its `?type=`. A per-song code is not used; it would change this decision and need its own CCR.
- Real phones are untested, because agents cannot get past staging's edge check. The owner accepts that risk. The vote page tells anyone whose scan did not register to scan the code again.
- The cookie-mint cap (N2, OSE-2126) is on hold, with two triggers:
  - Refusals seen in a real room: raise the `/q` limit for that event (a limit above 360 skips the edge binding).
  - A flood seen: a per-song ballot cap on a Durable Object. It is a flood ceiling, not a bound on stuffing, and its lockout risk is written down.

**Amendment (owner, 2026-11-26, OSE-2234): flood detection only.** The owner chose "Add flood detection only" (decision card, 2026-11-26), so a flood can be seen without changing anything above. Nothing is capped, slowed or refused.

- **The signal.** Every vote pass `/q` mints for an event counts once, a renewal included, because a forged cookie never needs a new one. The count is a Workers Rate Limiting binding (`VOTE_FLOOD_LIMITER`), keyed by the event id only, over one 60-second window, held in memory at the Cloudflare location (`lib/vote-flood.ts`). Past 300 passes in the window, the set's `flood_seen` turns to 1.
- **Why 300 (proposed; the owner picks).** S0 put a room of 150 browsers through `/q` in 5 seconds, so a whole room arriving at once is about 150 passes in a minute. One address is held to 360 a minute at `/q`, so a script from one address at full speed passes 300.
- **Why not KV.** A KV counter needs one write per pass on one key, and KV refuses more than one write a second to a key, so it would fail during a flood. The binding has no write limit and stores nothing. Its known limit: it counts per location and syncs in the background (`lib/edge-rate-limit.ts` measured ~500 through before its first refusal), so it trips late, and a flood spread over many locations may not trip it. It is a smoke alarm, not a meter.
- **What is kept.** `vote_sets.burst_seen` for this alarm and `vote_sets.flood_seen` for the room check, each 0 or 1 (`migrations/0122`). No time (the write leaves `updated_at` alone), no count, no address, no cookie, no k and no pass, in the key, the value or any log line. Each is set only to the literal 1 and never cleared: not by a reopen, not at final (gate: `votes-never-who`, rule 5, over every SQL statement in the Worker, the migrations, `scripts/` and the workflows; no database trigger, because D1's remote runner cannot take one, migration 0025).
- **Who sees it (changed by the owner, decision card 2026-11-26, "Room check only, show room size").** The per-minute alarm now writes `vote_sets.burst_seen`, not `flood_seen`, and only the host sees it, in the admin Voting card: "A burst of scans came in faster than one room makes. Only you see this; the result says it may be padded only if more voters take part than the room holds. If the code was photographed or shared, replace it." Why: CCR loops 1 to 3 showed one browser re-scanning fast, or a large honest room arriving at once, can trip it, so it must not mark a public result. The public line now comes only from the room check at final (below): "More voters took part than the room holds, so this result may be padded." It says nothing about how many voted. Never the room's vote screen (it is on a wall), the display, `display-config`, or any public answer before final (invariant 5). No count anywhere (invariant 2).
- **Fail-safe.** No binding, a binding that fails, or a D1 error: nothing is flagged, and the scan keeps its pass. Detection runs after the redirect is sent (`ctx.waitUntil`), so it never slows a vote.
- **What it cannot see (CCR, 2026-11-26).** A night is decided by a lead of 5 to 9 and 10 to 14 voters (decision 7), so 10 to 20 forged passes can swing it, far under 300 a minute. A paced or spread-out stuffer is not flagged. No flag never means a clean night. And anyone holding a live stamp of the code (anyone in the room, or with a live view of the screen) can trip the flag on purpose, even by re-scanning with one browser, because renewals count. It no longer reaches the public result (decision above); it only warns the host.
- **What it does not change.** The per-song cap (N2, OSE-2126) stays on hold. A flag is the "flood seen" trigger above; the owner then decides whether to build the cap.

**Amendment (owner, 2026-11-26): integrity, in the room only.** The owner asked for voting "as stringent as you can make it", chose "Changing code + room size" (decision card, 2026-11-26), and set the goal: results are never pushed up or down, by outsiders, by hosts, by sponsors, or by scripts and AI agents. Integrity is a main goal. The 18 November decision stands: no per-song cap, no per-address cap, no lockout.

- **Voting stays in the room (standing rule, owner, 2026-11-26).** Being physically in the room is the first security layer, and it fosters in-person participation. Events and sponsors will want online voting because it is better for marketing and the bottom line; it is resisted, because it brings privacy concerns and far more ways in. No online, link or remote voting path is to be built, and no host, sponsor, brand or tier setting may add one or loosen the in-room rule. The code below raises the cost of voting from elsewhere; it does not make it impossible (see "What it still cannot see"). This replaces the "remote-voting risk accepted" sentence of decision 12 with a control: the rotating code below.
- **The rotating code.** The URL on the room screen carries a stamp for the current minute: `w=<minute>.<seal>`, where the seal is an HMAC over the code's token and the minute under a subkey of `ANON_ID_HASH_PEPPER` (HKDF label `ose:vote:code-window:v1`, `lib/vote-code-window.ts`). `/q` mints a pass only for this minute's stamp or the last one's, so a stamp lives 60 to 120 seconds. The room screen reloads every 20 seconds. No stamp, an old or future stamp, another code's stamp, a changed seal or no pepper: no pass, and the scan stands as any other code's (fails closed). A photo of the code, posted to a group chat or handed to a script or an AI agent, stops working within two minutes. To keep voting from elsewhere, someone must relay a live view of the screen (or, as a signed-in host, poll the admin list), and one such relay serves any number of people; each pass then lasts 30 minutes. The token itself does not change, so scans per placement count as before.
- **The room size.** The first open of a set needs the host to say how many the room can hold, a whole number from 10 to 50000. It is written once, by that open, and never changes: the gate `votes-never-who` refuses any statement that writes it without a `room_size IS NULL` guard, so a host cannot raise it after the night to hide padding. It has a ceiling the host cannot set (owner, decision cards 2026-11-26): the venue's `room_cap`, which only a platform admin sets (`PUT /api/v2/admin/venues/:id/room-ceiling`), indoors the building's fire-marshal capacity and outdoors the permit's attendance limit; with no venue, no setting, or no permit limit, 500. A first open above the ceiling is refused, in the open statement itself. A reopen keeps it. The host sees it in the Voting card. Once the set is final, the voter page's result shows it ("Room size the host gave when voting opened: N."), so the room can see the number the check used: a size far above the room weakens the check, and one far below marks an honest night (owner, decision card 2026-11-26). It is a capacity the host typed, not a count of anyone, and it is in no answer before final.
- **The room check at final.** In the same batch that makes a set final, `ROOM_CHECK_UPDATE` (`lib/vote-results.ts`) compares the number of distinct voters with the room size inside SQL. More voters than the room holds sets `flood_seen` to 1, the only flag that marks the public result. The count never reaches the Worker, and the check changes no outcome and no winner. It sees padding at any pace, which the per-minute alarm cannot, but only above the room size the host gave: a script or an AI agent spreading fake voters across the night is caught once their total passes that number, and not before. A set opened before the room size existed is not checked.
- **The flags are one-way.** No statement in the code base may turn `flood_seen` or `burst_seen` from 1 back to 0 (gate `votes-never-who`, rule 5). No host route can clear either. This binds the code, not a person with direct database access: that is the operator's break-glass, which AGENTS.md reserves to the owner.
- **Names are fixed once voting opens.** A song's, stall's or entry's label changes only before the first open (`LABEL_FIXED`). A rename after votes are cast would move those votes to another name. Once voting has opened, nothing can be added to the set at all (`OBJECTS_FIXED`, owner 2026-11-26): no decoy, no second copy that splits a song's votes, no late favourite. Everything to be voted on is added before voting opens.
- **Hosts are blind until final.** A host sees no count before final (decision 7), so closing, reopening or finalizing cannot be timed to a lead they can see.
- **Accepted by the owner (2026-11-26).** One person relaying a live view of the room screen (a video call, a phone on a stand) can let others vote from elsewhere while the stamp is fresh; the room check at final, against a room size under the platform's ceiling and shown with the result, is the backstop. In-room presence cannot be proven anonymously.
- **What it still cannot see.** Someone in the room, or with a live view of the screen, who stays under both the per-minute alarm and the room size. A host who gives a room size larger than the room: it is fixed, and shown with the final result, so the room can see it, but nothing refuses it. A host who reopens a favourite's window or closes a rival's early (each move is audited). A voter whose scan of a stale code lands on the event page with no word about why. These are written in the CCR worksheet for the owner.

### 7. Results after the set is final

No tally, winner or outcome appears before the set is final, and none on the display (invariant 5). Before then, no surface shows a vote count or a vote-set counter: not the admin list, the live monitor, audit details, the display or `display-config`. The display and `display-config` carry no vote word at all: no "voting open" flag and no open-objects list. Invariant 2 holds for the brand's own admin.

After the event, results are computed once (decision 4). Only these are published, to anyone, the brand admin included (Q7, Q8):

- **No per-object number.** No up or "not for me" count, for any object, is ever published. No total of them is published either: not for a team, not across objects, not across nights.
- **A secret voter floor (Q13).** Nothing is published unless the set's distinct voters (participant markers, counted raw) reach V. V is a secret whole number drawn for the set, uniform from 10 to 14. Below V, the night reads "too close to call, the champion retains", the same words as a close result, so the reading alone does not say which rule applied.
- **One result per set: the night's winner (Q14).** A set reports exactly one outcome: the winner of the night, or "too close to call, the champion retains". A set is played either by songs or by teams, fixed when it first opens. By songs, the winner is the song with the largest up count, against the runner-up song. By teams, the winner is the team with the largest total, against the runner-up team, where a team's total is the number of distinct voters who gave any of its songs an up vote (Q16, decision 1). Either way, one voter moves the lead by at most 2 and the voter count by at most 1, so the rates in this decision hold. There is no tiebreak: a lead under the margin is "too close to call, the champion retains", for teams as for songs (Q17). No per-song result, no standings and no runner-up are published.
- **The winner rule.** It runs on the unpublished up counts only (a song's up count, or a team's total of distinct up-voters); "not for me" counts are not used in the margin. A winner needs a lead over the runner-up of at least T. T is a secret whole number drawn for the set, uniform from 5 to 9 (Q8 A).
- **How T and V are drawn.** Each comes from `crypto.getRandomValues`, by rejection sampling, so no value is more likely. Both are drawn when the set first opens, before any vote, and are never redrawn, not even at a reopen. They are stored only on the server, in columns no route returns, and never logged. They are set to null when the set is final, and they are never published. The outcome tells only whether the hidden lead cleared T and the voters reached V, so a person who controls the votes learns a bound on that set's numbers and nothing about any other set's.
- **No count of voters** is published, for a night or a season, and no participation figure (Q8-2).
- Own-team voting is allowed.

**What the secret numbers do, and do not do.** They are reductions the owner accepted knowingly (Q8, Q13, 2026-11-18), not fixes. With fixed numbers, one person who controls every vote but one learns that last vote every time. With T from 5 to 9 and V from 10 to 14, that person can still learn something about the last voter, per set:

- whether they backed song A or song B: about two times in five (a switch moves the lead by 2, so two of T's five values tell them apart);
- whether they backed the leader or did not vote: about one time in three (1 − 0.8 × 0.8 = 0.36), because the lead and the voter count both move;
- whether they voted at all, or backed the leader or another song: about one time in five.

These add up over nights for a regular voter: at two in five a night, about four in five over three nights. No fixed publishing rule can do better while one person can vote from many browsers; wider ranges lower the rate (T from 5 to 14 brings the first case to about one in five) but leave more small nights with no winner. The owner accepted these rates knowingly on 2026-11-18 (Q15) and kept the ranges. That is the stop point: no further changes to the publishing rules without a new decision. Because a set reports one result (Q14) and each set has its own T and V, the secret numbers themselves do not carry from one set to another. The card says plainly that the numbers vary and what they still allow (decision 9).

### 8. The fun report

**Transparency (owner, 2026-11-18, C2).** The reports are published with enough detail to give trust in the process. Where the line falls between too much and too little detail on the SharedReport is still to be worked out, in OSE-520, inside the rules of decision 7.

After the set is final, every set that is not void gets the same **fun results report**, whichever rule decided it, for the people who were there and for sponsors. It shows only what decision 7 allows: the night's winner, or "too close to call, the champion retains". It says plainly that this is for fun, not hard numbers. The belt follows the night's winner; there is no per-song belt or result. It belongs to OSE-520, and it is a new public surface with its own gates.

**Participation** (D12) was kept at first, then dropped on 2026-11-18 (Q8-2). No count of voters and no rate of voters against devices is published. If it is wanted again, it needs its own decision and a fresh look at the risk in decision 7.

### 9. The house rule: "don't be a jag-off"

The owner accepts these residual risks, and the voter page states them in plain words so the room can self-police:

- **Colluders.** People who know their own votes, together cast every vote but one, and know who the last voter is can sometimes work out that last vote from an outcome: up to about two times in five per set (the same risk as "one vote can decide the result").
- **Several browsers.** Someone who scans with several browsers can vote more than once.
- **A script.** One person with a script can cast many votes. Signing the cookie would not stop it: a browser with no cookie gets a fresh one, and a pass, in one request.
- **One vote can decide the result.** One person who casts every vote but one, and knows who the last voter is, can learn how that person voted from the night's result up to about two times in five per night, and more often over several nights against the same person. The owner accepted this knowingly (Q15). The margin varies to make this rare; it cannot make it impossible (decision 7).
- **Remote voting.** A photo of the code lets someone vote from elsewhere while voting is open.
- **A forwarded pass.** The pass works for whoever holds it. Someone who gets a person's vote link while it is valid can vote in their place, once per song. The person's own vote then answers like a counted one, so they cannot tell. Whoever holds the pass may also learn, from how fast a duplicate answers, which songs the person already voted on. It reveals no identity.
- **Database history.** For 30 days, D1's history can link a scan to a vote by the order of writes, and it holds the secret margins and voter floors until then. On a team night it also shows when a voter backs a second song of a team already backed, which links votes within one set, never across teams or events. A receipt carries no side, but a team marker is written only for an up vote: until final, someone who holds the pepper and a person's cookie can work out k and test which teams that browser backed. The markers are deleted at final.
- **Log timing.** Cloudflare's logs record when each vote arrives, to the millisecond. With one song open, that time names the song. Only the account holder can see them.
- **Timing.** A duplicate may answer faster than a counted vote.
- **Whether someone voted.** One person who casts every vote but one, and knows who the last possible voter is, can, about one time in five to one time in three per set, tell whether that person voted at all, and more often over several nights. The minimum number of voters varies to make this rare; it cannot make it impossible (decision 7).

"Zero or not" (accepted on 2026-11-18 through PR #1416) no longer applies: no per-side count is published. The card's exact wording is the owner's.

### 10. What turns voting on

Voting turns on when an admin opens a vote set for the event (D6 = A). No fair setting is needed, so a Fist of Five night at a bar works by itself. ADR-034 decision 4 refuses `competition` mode until voting exists; that refusal ends when the vote route ships, and ADR-034 is amended in the same change. A fair's competition mode then uses this same voting.

### 11. Nothing is more live than its container

**Owner, 2026-11-18 (S3e, OSE-2142):** "Just like events there is draft and live designation, take advantage of status markers across containers where applicable."

An event's status (Draft, Ready, Published, Archived; Published may be listed or unlisted) is the master switch for everything inside it: a vote set and its objects today, and any later container that can be voted on. A child's own state (a set's draft, open or closed) works only inside what its event allows. No child gets a status column for this; each reads its event's.

- **Live** means Published (`status = 'active'`), listed or unlisted, and on its dates (its last date is yesterday or later, UTC, or it has none). It is one SQL fragment, `EVENT_LIVE` in `lib/event-live.ts`. Its status part is `eventLiveSql` in `domain/event-state.ts` (OSE-2144), the one test of "the parent event is live"; `EVENT_LIVE` adds the held event id and the dates.
- **Needs live:** opening and reopening a set, opening or reopening an object, adding an object to a set that has opened, and the `/q` pass mint. The vote route (S4a) uses the same fragment.
- **Setting up stays allowed on a draft or ready event:** making the set, adding objects while the set is still in draft, and editing objects. A host prepares the night before publishing it, and admin set-up keeps working while `VOTING_ENABLED` is off (owner, 2026-11-18). The admin card greys out Open and says "Publish the event to open voting."
- **Leaving Published closes the set, in the same transaction.** Every app path that moves an event's status batches `closeVoteSetUnlessPublished` with the move (the admin edit and the QR verify undo). Closing was chosen over "read as closed everywhere" because a closed set is simply closed: the admin card, the pass, the public read and the coming vote route need no second rule, and a host reopens it on purpose once the event is Published again. Nothing here makes a set final. A D1 trigger was not used: migration 0025 keeps D1 free of triggers, because remote migration apply once split their bodies. A status written outside the app (a seed, a script) is caught by the nightly vote job, which closes the set; until then the pass and the public read refuse it.
- **A reopen.** A reopen after the event comes back to Published follows the usual rules: the same epoch, T and V, and never after final.

**Not in this decision:** stalls, sponsors and other children of an event. A sweep of every public read that shows a child of an event is follow-up work under the same rule (OSE-2144 covers sponsors and scans).

### 12. Scan to vote at events and markets

**Owner, 2026-11-24** (in the project thread for splitting music out of ourWKRP; recorded in OSE-2222): "it is what ever the event organizer sets up to be voted on. This is the point. We may have to designate certain items are off limits, but yes, this design open up the ability for onsite voting." And: scan to vote "encourages onsites engagement. Whereas offisite donations will are already possible."

This decision opens the same engine to any event or market. It changes no table, no rule in decisions 1 to 11, and no published number.

- **An entry the organizer names.** One more kind, `entry`, is added to `VOTABLE_KINDS` beside `song` and `stall`. It stands for whatever the organizer puts up for a vote: a painting, a float, a dish, a business's display. The label is the organizer's words, checked by the off-limits list below. An entry's window defaults to the whole event, as a stall's does. A set still holds one kind (decision 4). No migration: the kinds are a code list (decision 2).
- **The off-limits list.** Some things may never be an object. The rules live in one module (`lib/vote-off-limits.ts`), used by `parseVotableLabel`, and nowhere else, not even as a first check in the admin page; `tests/vote-off-limits.spec.ts` fails on a copy. They start as the rules already in force: a label holding an email address or a phone number is refused, and a person may be the object only if they opted in as a presenter (Q9). The host's Voting card says plainly, under the label box: "Name the work, not the person who made it." A rule is added to the list only by a decision recorded here.
- **The host's vote-code screen.** An event or market without an ourWKRP room screen still needs a screen to scan. A host-only page shows the event's vote code (decision 6) as a large QR with one short line, "Scan to vote", and nothing else: no count, no list of objects. It is an admin page, scoped to the event's brand. It is not the public display: the TV page and `display-config` still carry no vote word (decision 7, invariant 5), and the vote code's token stays out of every public answer.
- **On-site only.** Voting exists to bring people to the event. Support from elsewhere is a donation, which already works. A vote still needs a scan of the room's code, and a pass lasts 30 minutes (Q12). No location check is added, because it would mean collecting where a person is (invariant 3). Since 2026-11-26 the code rotates every minute (decision 6, "integrity, in the room only"), so a photo of it stops working within two minutes; before that, a photo could be used from elsewhere until the host replaced the code.
- **Solo or as a team.** On the ourWKRP side, a single artist or business owner may stand alone, or people may group together for a fun competition (owner, 2026-11-24: "again, choice"). On OSE this needs nothing new: a set is played by objects or by teams (decision 7), and a team stays an opaque `group_id`.

**Not in this decision:** a code beside each piece of work in place of the event's one vote code (decision 6 says that needs its own review), and remote or link voting (out, by the on-site rule). Amended 2026-11-26: decision 13 adds two narrow ways in from outside the room, the Access Pass (counts in the Room Pick, capped) and the Online Pick (a separate result that never changes the Room Pick). The on-site rule still governs the Room Pick.

### 13. The Access Pass and the Online Pick

**Owner, 2026-11-26** (project thread on voting from outside the room, relayed by the coordinator): "If 'Online Pick' means voting from outside the room, please check it with Matt before building it. I give permission." The design is OCR-docs PR #200; the red team and blue team review is `docs/security/THREAT-MODEL-voting-red-blue-2026-11-26.md`.

**How this sits with the in-room rule** (decision 6, amended the same day). The Room Pick stays in the room: no host, sponsor, brand or tier setting can open it to the link. Decision 13 adds two narrow exceptions the owner allowed by name, and nothing else: the Access Pass, which is capped, given one by one by the host, and counts the same as a person in the room; and the Online Pick, which is a separate result and never changes the Room Pick. The owner is asked to confirm this reading in the PR that builds it.

The night's official result is now called the **Room Pick**. It is decided exactly as decisions 1 to 12 say. Two ways in from outside the room are added.

- **The Access Pass.** A host gives a link to someone who cannot be in the room. It needs no reason, no proof and no name, and the vote carries the same weight as anyone in the room. The word is always "Access Pass".
  - At most **4 per vote set, counting every pass ever given, revoked ones too**, so give, vote, revoke, give cannot cycle. The count is checked inside the INSERT. Why 4: it is below the smallest margin T (5), so passes alone never make a winner from a tie or from behind (`tests/vote-swarm-simulation.spec.ts`).
  - The link is `/access#<token>`: 256 random bits in the fragment, never in a request line or a log. The database stores only HMAC(K_access_lookup, token). The voter key is HMAC(K_access_voter, token, event), so a forwarded pass is still one voter.
  - A revoke is one-way and stops the pass at once, including a pass already redeemed: the vote route checks the pass id on every vote. Votes already cast stay. A final set's passes are deleted.
  - One refusal for every failure, so a guess learns nothing.
- **The Online Pick.** A host may turn on a second, for-fun result that anyone with the event's link can vote in. It is off by default, not offered on team nights (v1), open only while the Room Pick is open, and decided by the same rule (V and T, its own draw) only after the Room Pick is final. Its receipts, markers and counters are deleted at final, as the room's are.
  - It lives in its own tables (`vote_crowd_*`), with its own HKDF labels, pass prefix (`vc1.`) and seal. A crowd pass never opens as a room pass, and no file names a crowd table and a room counter (T0 gate `votes-never-who`, "channels never mix").
  - The way in is `/q/crowd/:eventId`, so the cookie stays on `/q` (AGENTS.md invariant 4).
  - Its page says: "Anyone can vote here, so this can be gamed. That's why it's for fun and never the official result." The result page shows the Room Pick first.
  - No bot check (the proposal's default): a bot check would add a third party and still not make it official.
- **The vote route is limited per caller** (found in the review): 600 votes a minute per caller on each vote route, then 429. The address is a bucket key only.

Migration 0123. Still the owner's to confirm (built on the proposal's defaults): the cap of 4, or one that grows with room size; the Access Pass on for every event by default; and no bot check on the Online Pick.

## Relation to campaigns

**Owner, 2026-11-18:** voting does not replace campaigns.

- **Voting is the OSE and OurWKRP hybrid.** On OSE it is anonymous, as this ADR builds it: a person in the room scans the room's vote code and backs a song, a stall or a team, and no one is named. On the OurWKRP side, voting is tokenized and represented: a team or a player plants their flag with an authorization token. The two sides together are the vote.
- **Campaigns stay as they are.** The OSE campaigns (`lib/campaigns.ts`, the `campaigns` table, sponsor campaigns, `sponsor_placement.campaign_id` and `events.campaign_id`) are not changed by voting. They serve a larger piece of the whole: a brand's named group of sponsor placements across its events.
- **Side by side, not folded in.** A vote set is not a campaign, and a campaign is not a vote set. No vote table reads or writes `campaign_id`, and `campaign_id` is not reused to group vote sets. An event may be in a campaign and have a vote set; each keeps its own rules.

## Still open

| Id        | Question                                                                                                                                                                                                         | Proposed default                                        | Blocks                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| C2 detail | How much detail does the published report carry, so it builds trust without narrowing to a person?                                                                                                               | Work it out in OSE-520, inside decision 7.              | The fun report (OSE-520)                   |
| Wording   | The owner's words for the house-rule card and the report: the ten risks in decision 9; the margin and the minimum vary, and what they still allow; the minimum number of voters does not stop stuffing; for fun. | A plain draft is on OSE-2122. The owner's words govern. | The voter page (S4b), the report (OSE-520) |

## Alternatives Considered

### Alternative A: one row per vote, with a hashed voter key

This is the September 2026 design (migration "0069", never merged).

**Rejected because:** a stable voter key beside a song object is a per-person timeline of preference. The September CCR held it.

### Alternative B: votes stored on OurWKRP

**Rejected because:** OurWKRP holds named people. The owner ruled on 2026-10-09 (OSE-520), and again in D1, that votes live on OSE's anonymous side.

### Alternative C: a vote resolved by the time of the tap

**Rejected because:** of OurWKRP's scan-resolution law and OW-219. A clock-matched vote would need a fine time on the vote, which the hour rule forbids.

### Alternative D: noise added to counts

**Rejected for counts** (D8): noise would end exact winners. On 2026-11-18 (Q8) the owner took a narrower step: no counts are published at all, the margin a winner needs is a secret random number per set, and so is the minimum number of voters (Q13). That is a small, bounded form of noise on one outcome per set only.

### Alternative E: the vote route reads `ose_anon`

This was D3 as first decided, with an amendment to AGENTS.md invariant 4 (S1g).

**Rejected because:** the owner reversed D3 on 2026-11-18: "Once there is a seam, it's a way in." The pass in decision 6 keeps every cookie read inside `/q`.

## Consequences

### Positive

- One engine serves songs, stalls, team nights and an event-wide vote.
- No table can say who voted, and no cookie reaches the vote route.
- Song windows can be as short as the song.
- No per-object number is ever published, so a small count cannot be read off.

### Negative

- Six new tables, a pass from `/q`, and a secret margin and voter floor per set.
- A vote needs a pass from `/q`. The S0 spike showed that 150 browsers behind one address each get a cookie and a counted scan through the CI path. Real phones are untested, and the owner accepts that (decision 6).
- The pass is a bearer token for 30 minutes (decision 9).
- The residual risks are carried by a house rule, not by code. They include one person with a script, one vote deciding the result up to about two times in five per set, and a forwarded pass (decision 9).

### Neutral

- Results are seen only after the set is final, and then only as outcomes. The fun report is the moment of transparency.

## Implementation Notes

The stories (D10 = yes; each is a Linear ticket under OSE-1193):

- **Done:** S0, the staging spike on room presence (2026-11-18, decision 6).
- **This ADR:** S1 (OSE-2123).
- **Cancelled:** S1g (OSE-2124). D3 is reversed, so invariant 4 is not amended.
- **After S1:**
  - S2 (OSE-2125), the tables and their gates, including the timestamp gate's scan-shaped rule learning `vote|votable|tally|ballot|receipt|participant`, with `votable_objects.closes_at` on its allowlist;
  - S3 (OSE-2127), admin open, close, reopen, the final lock, the pepper epoch, the play mode (songs or teams), and the secret margin and voter floor;
  - S3c (OSE-2135), the public open-objects read and the kill switch, after S3;
  - S3b (OSE-2133), `/q` issues the pass (decision 6);
  - S3d (OSE-2140), the room's own vote code (decision 6), and S3e (OSE-2142), a vote set follows its event's status (decision 11). Both before S4a and S4b.
- **After S2, S3 and S3b:** S4a (OSE-2128), the vote route. Then S4c (OSE-2134), its hardening, and S4b (OSE-2129), the voter page (also after S3c).
- **After S4a:** S5 (OSE-2130), results after the set is final, team totals as distinct up-voters included. The fun report is OSE-520, after S5.
- **Not voting work, but in conflict:** OSE-513 and OSE-518 describe a live tally on the display. Decision 7 and invariant 5 forbid it. The owner canceled OSE-513 and its children on 2026-11-24.
- **Decision 12 (2026-11-24), under OSE-2222:** OSE-2223 (this amendment), then OSE-2224 (the `entry` kind) and OSE-2225 (the off-limits list and the warning), both built in PR #1545, then OSE-2226 (the host's vote-code screen); the shared brain follows in OCR-229. Then S4c (OSE-2134), N3 (OSE-2131) and N4 (OSE-2132), a staging real-room test (OSE-2227), and the owner's production switch (OSE-2228).
- **Other tickets:**
  - N1 (OW-220), the OurWKRP route that opens and closes song objects, brand-bound, after S3;
  - N2 (OSE-2126), a cookie-mint cap at `/q`, on hold with triggers (decision 6);
  - N3 (OSE-2131), the CI/CD testing ticket;
  - N4 (OSE-2132), a staging load case for a room behind one address.
  - N5 (widen the unrun-spec check) is proposed, not created.

Every test is seen failing first, at the workers-pool layer and on staging (Bruno, Playwright).

## References

- **Tickets:** OSE-1193, OSE-1192, OSE-2000, OSE-1996, OSE-513, OSE-514, OSE-518, OSE-520, OSE-1496, OSE-2122 to OSE-2135, OSE-2140, OSE-2142, OSE-2144; OW-73, OW-218, OW-219, OW-220.
- **PRs:** #1407 (the readiness CCR), #1413 (its revert, with the owner's answers), #1414 (this ADR), #1415 (the room-burst measurement), #1416 (the presence CCR), #1417 (the presence amendment), #1418 (the S1 CCR on the decided text), #1420 (this amendment), #1439 (S3b), and the S3d and S3e PR (the vote-code and container amendment).
- **ADRs:** ADR-034 (booths, participation mode), ADR-032 (a mode as a column).
- **Rules:** AGENTS.md invariants 1, 2, 3, 4 and 5.

## Revisit Criteria

- The owner settles the published report's level of detail.
- A rule is wanted on the off-limits list, or a code beside each piece of work is wanted (decision 12).
- A count is wanted during the night (invariant 5).
- A per-object number, or a per-song result, is wanted in a published result (Q8, Q14).
- A vote limit beyond one per object is wanted ("to start").
- A way to bind one vote to one person, while staying anonymous, becomes available (it would close the risk in decision 7).
- A refusal is seen in a real room, or a flood is seen (the triggers in decision 6). Since 2026-11-26 a flood shows as `flood_seen` on the set (OSE-2234).
- The flood threshold (300 passes a minute) is too tight or too loose for a real room.
- A per-song code on the room screen is wanted in place of the event's vote code (decision 6).
