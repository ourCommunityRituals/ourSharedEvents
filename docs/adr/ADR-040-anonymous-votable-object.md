# ADR-040: An anonymous vote is a counter on an object, never a row about a voter

**Status:** Accepted. The owner accepted this ADR by merging PR #1414 on 2026-11-18. The owner answered every question on 2026-11-17 and 2026-11-18 (comments on PRs #1413 and #1414; D6 and D10 in the owner's own session on 2026-11-18; Q6 to Q12 in question forms on 2026-11-18). Amended twice on 2026-11-18: decision 6 after the S0 spike (OSE-2122) and a three-loop CCR (PR #1416, merged in #1417); then decisions 1 to 10 after the five-loop S1 CCR (PR #1418) and the owner's answers to it, including the reversal of D3. Still open: the level of detail in the published report (OSE-520), and the owner's wording for the house-rule card and the report. Nothing here is built.
**Date:** 2026-11-17. Amended 2026-11-18 (decision 6 after S0; decisions 1 to 10 after the S1 CCR).
**Deciders:** Owner (PO). Sr Architect owns the draft. Dr of Security advises on the membrane.
**Ticket:** OSE-1193 (blocks OSE-2000 under the fairs epic OSE-1996; step 1 of OW-218, Fist of Five)

## Context

Fist of Five nights and fair competitions need a vote: a person in the room taps a code and backs a song, a stall or a team. OurSharedEvents has no voting code (read 2026-11-17 at `main` 82a4767: no vote, ballot, votable or tally table or handler).

A vote adds **preference** to presence. "Never who" (AGENTS.md invariant 1) and the under-5 floor (invariant 2) must hold for it as they do for scans.

A five-loop CCR on the smallest safe shape ran on 2026-11-17 (PR #1407, worksheet `CCR-VOTABLE-OBJECT-READINESS-2026-11-17.md`). The owner reverted it from `main` in PR #1413 and answered its twelve questions in a comment there. Its findings are summarised in the comment on OSE-1193 and are the basis of this ADR. A five-loop CCR on the decided text ran on 2026-11-18 (PR #1418, worksheet `CCR-ADR-040-DECIDED-TEXT-2026-11-18.md`); its questions Q6 to Q12 and the owner's answers are below.

What the code already gives:

- **The hour only.** The scan path keeps no time finer than the hour (`migrations/0100`, `tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts`).
- **A keyed browser id.** `scan_node_returns` holds a keyed id, never the cookie (`lib/scan-node-key.ts`, `migrations/0101`).
- **The count floor.** `lib/count-floor.ts` has `applyCountFloor`, `roundForPublish`, `floorTotalOfParts`, `floorNestedCounts`, `floorPublishedChain` and `floorCumulativeOfParts`.
- **Booths.** Booths are rows (`migrations/0109`, ADR-034 decision 1).
- **One id per play, on the OurWKRP side.** ourWKRP migration 0011 (`playback_events`) gives every play of a song its own id. Its scan-resolution law says a vote resolves by the unit id carried in the code, never by comparing a time with a play log.

## The owner's answers (2026-11-17, PR #1413)

| Question                                                                                                       | Owner's answer                                                                                                                                                                                                                                                                                              | What it means here                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D1. Votes on OSE's anonymous database, aggregate-only                                                          | **Yes.** "The person hitting the qr shorturl is expected privacy when tapping." Votes are attributed to the song through the OurWKRP assignment, which carries the authorization token. Team players sign up to compete; audience members vote anonymously. On 2026-11-18 (C1): yes, by the id in the code. | Decisions 1 and 2. OW-73 sends voters to OSE and stores no votes.                                              |
| D2. The vote button on an OSE page; the room screen shows a QR code                                            | **Yes.** No reason it could not. The owner had kept them separate only to leave room for explanation.                                                                                                                                                                                                       | Decision 5. The voter page carries the explanation. The room screen's code is the event's `/q` vote code (Q6). |
| D3. Read `ose_anon` (never set it) on one new route, through its own 5-loop CCR                                | **Reversed** (2026-11-18). It was yes ("this is the ose anonymous token"), then: "How does this get limited on anonymous tokens? There should be no exceptions to keep the privacy footprint clean and unexploitable. Once there is a seam, it's a way in." No new reader of `ose_anon`.                    | Decisions 5 and 6. Invariant 4 is unchanged. S1g (OSE-2124) is cancelled. Every cookie read stays inside `/q`. |
| D4. The winner only from published counts, a margin of at least 5, "Fewer than 5" in place of "held"           | **Yes.** Refined by Q8 (2026-11-18): no per-object number is published, so the winner rule runs on unpublished counts and only the outcome is published.                                                                                                                                                    | Decision 7.                                                                                                    |
| D5. At least 10 distinct voters before any count or winner                                                     | **At least 10** for a number to be shown. That is also when a **fun version of the SharedReport** is made, so the people in attendance have faith in the voting. "This is for fun and sponsorship, but not hard numbers (yet)." Q7 (2026-11-18): 10 before **any** number, not only a winner.               | Decisions 7 and 8.                                                                                             |
| D6. Gate votes on their own vote set; ADR-034 decision 4 refuses `competition` only until the vote route ships | **A** (2026-11-18, answered in the owner's session): voting turns on when an admin opens voting for the event, such as tonight's songs. It works for a bar night with no fair.                                                                                                                              | Decision 10.                                                                                                   |
| D7. No tally, winner or count before the event's end; none on the display                                      | **"Yeah."** The owner has "rethought this into more transparency". On 2026-11-18 (C2): publish the reports with enough detail to give trust in the process.                                                                                                                                                 | Decisions 7 and 8. The level of detail is open (Still open).                                                   |
| D8. Accept the residual risks in writing, or add noise                                                         | **Accepted, under a house rule.** Bocce has a "don't be a dick" rule; voting goes under a "don't be a jag-off" rule that lists the risks so the people there can self-police. Q8 (2026-11-18) adds a secret random margin for outcomes only.                                                                | Decisions 7 and 9.                                                                                             |
| D9. Own-team voting allowed; "too close to call, the champion retains"                                         | **Yes.**                                                                                                                                                                                                                                                                                                    | Decision 7.                                                                                                    |
| D10. Move OSE-1193 out from under OSE-1192; take the refreshed text; split S0 to S5                            | **Yes, move and split** (2026-11-18, answered in the owner's session). OSE-1193 leaves the post-launch epic, takes the refreshed story text, and becomes S0 to S5, one session each. N1 to N4 are created.                                                                                                  | Implementation Notes. Done in Linear.                                                                          |
| D11. One vote set per event, never reopened                                                                    | **"One vote an event, one vote a stall, one vote a song to start."** On 2026-11-18 (C3): a closed vote set may reopen, "to be flexible in case there is time screw up". Q10 (2026-11-18): once results are computed, the set locks for good.                                                                | Decision 4, with the reopen rule and the final lock.                                                           |
| D12. Drop the participation rate against the logged headcount                                                  | **"Add it if you think it will find value to our overall goal."**                                                                                                                                                                                                                                           | Decision 8: kept, against a denominator that is nested by construction.                                        |

**A further direction (owner, PR #1413, same day).** The owner gave a four-song set totalling exactly 20:00: 7:11, 6:30, 4:03 and 2:16. They wrote: "This [is] what the time needs to be reacting to what is coming in for the Fist of Five and not be dictated by the 1 hr gate. The stacks are tiny and are fun." This is decision 3.

## The owner's answers to the S1 CCR (2026-11-18, question forms, PR #1418)

| Question                                                                                      | Owner's answer                                                                                                                                                                                                                                                                      | Where                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Q6. How does a person at the room screen get presence?                                        | **The room screen shows the event's own `/q` scan code.** Scanning gives the pass and opens the vote page. Each song's button carries the song's id. Never an OurWKRP short link.                                                                                                   | Decisions 2, 5 and 6 |
| Q7. Is 10 voters needed before any number, not only a winner?                                 | **Yes.** At least 10 distinct voters in the set before any number is shown.                                                                                                                                                                                                         | Decision 7           |
| Q8. One person who controls every vote but one can learn that last vote. How is that handled? | **Remove it by design, no exception:** no per-song up or down numbers are published, only outcomes and a rounded voter count. Then, told that outcomes alone still leak: **A, a hidden random margin**, a reduction accepted knowingly, not a fix. No note under invariants 1 or 2. | Decisions 7 and 9    |
| Q9. May a person be the thing voted on?                                                       | **Only opted-in presenters.** Otherwise objects are things: songs, stalls, teams.                                                                                                                                                                                                   | Decision 2           |
| Q10. Should a set lock for good once results are computed?                                    | **Yes, a one-way final lock.** No date change undoes it; a final set never reopens.                                                                                                                                                                                                 | Decision 4           |
| Q11. Should the card also name remote voting and log timing?                                  | **Yes, both.** A poster photo lets someone vote from elsewhere while voting is open. Cloudflare's logs record each vote's arrival time to the millisecond. The final card wording is the owner's.                                                                                   | Decision 9           |
| Q12. Do you accept the forwarded-pass risk, and how long does a pass last?                    | **Accept, 30 minutes,** renewed by scanning again. It goes on the card.                                                                                                                                                                                                             | Decisions 6 and 9    |
| Apply the review's text and ticket edits?                                                     | **Yes, as a draft PR.**                                                                                                                                                                                                                                                             | This text            |

## Decision

### 1. Votes live in `DB`, aggregate-only

The tables are additive and live in `DB`, never in `FORMS_DB` and never on OurWKRP. There are five:

- `votable_objects`: what can be voted on.
- `vote_sets`: one per event.
- `vote_tallies`: two counters per object, up and "not for me".
- `vote_receipts` and `vote_participants`: one-vote markers.

There is no per-vote row, no voter id and no vote time. A receipt carries no side. It is `HMAC(K_receipt, k ‖ object_id)`, where k is the per-event voter key from decision 6 and `K_receipt` is a server-only subkey. A participant marker is `HMAC(K_participant, k ‖ set_id)`, under its own subkey, so it can never equal a receipt. No cookie value reaches the vote route or the vote tables, and k is stored nowhere, so the database is not a list of voters. Receipts and participant markers are deleted when the set becomes final (decision 4), never when it only closes.

### 2. A vote finds its song by an id, never by the clock

A song object stands for one play. OurWKRP keeps the link from its `playback_events` id to the OSE object id, and OSE stores no OurWKRP id. The room screen shows the event's vote code, a `/q` code on OSE (Q6, decision 6). The vote page lists the objects that are open now, and each vote button carries its object's id. "During this time frame" (D1) is when that object is open; it is never worked out by comparing a timestamp with a play log.

The owner confirmed this on 2026-11-18 (C1), and added that it sets up voting on whatever else comes to be voted on: an art competition, community parade floats, and so on. Each of those is one more kind of object; the engine does not change.

An object is a thing: a song, a stall, a team or the event. A person may be the object only if they opted in as a presenter (Q9; AGENTS.md invariant 1). Labels refuse email- and phone-shaped text.

### 3. A song's window follows the song, not the hour

Opening and closing an object is a state change made by the server. For a song, OurWKRP's song-change signal triggers it, through the route in N1 (OW-220). A window can be 2:16 or 7:11 long.

This does not conflict with the hour rule. That rule limits the time **stored on scan rows**, and a vote stores no time at all. The only clock the vote path keeps is the object's `closes_at`, which names a song's window, not a voter. Each open and close is written to the admin audit log, which times the song, not a person.

N1 obeys decision 4. It is bound to the event's brand (the shared service token alone is not enough), it adds no object to a final set or after the event's end, it is audited, it honours the kill switch, and it returns no count.

### 4. One vote per person per song, per stall, and per event

A person has one vote per object:

- per song, for Fist of Five;
- per stall, for a fair;
- per event, through one event-level object (for example "best of the night").

Dedup is the receipt per object. A duplicate changes nothing and answers the same as a counted vote. "To start" means the limits may be loosened later by a new decision; none is built for that now.

**Reopening (owner, 2026-11-18, C3) and the final lock (Q10).** A host may reopen a closed object or vote set while the event is still on, to recover from a timing mistake. This is safe only because no count is read before the set is final (decision 7), so nobody can compare a count before and after the reopen. Results are computed once. Computing them sets a one-way `final` flag on the set. After it, nothing reopens the set or adds an object to it: not a host, not N1, and not a change to the event's dates or status. Every close, reopen and finalization is written to the audit log. A receipt survives a reopen, so a person who already voted on an object still cannot vote on it twice.

### 5. The voter page is on OSE

The voter page is `GET /events/:id/vote`. It is styled like a form page, but it is not a forms route: it uses no forms API and sets no cookie. It explains the vote, carries the house rule (decision 9), and shows the sponsor strip below the title and date. The OurWKRP room screen shows only the event's vote code, a `/q` code on OSE, never an OurWKRP short link.

The vote write is a `POST` outside `/api/v2/events*`, handled on the `DB` side. It reads no cookie: it never reads the `Cookie` header and never sets one (D3 reversed, 2026-11-18). It takes JSON only and checks `Sec-Fetch-Site: same-origin`, and the page cannot be framed. A gate fails if the vote route's files read the `Cookie` header or `ose_anon`. AGENTS.md invariant 4 is unchanged: `/q` stays the only reader on the vote path.

### 6. Presence

A vote counts only from a browser that scanned this event's vote code. Every cookie read stays inside `/q` (D3 reversed).

- At `/q`, a vote-kind code, with a set open and `VOTING_ENABLED` on, derives a per-event voter key `k = HMAC(K_voter, len(cookie) ‖ cookie ‖ event_id)`. `K_voter` comes from `ANON_ID_HASH_PEPPER` by HKDF under its own label, separate from the scan key, the pass seal, the receipt key and the participant key. k differs at every event and is stored nowhere.
- `/q` mints a pass only when the pepper is set and the scan was stored, or was a duplicate of one stored. The uncounted path mints none, a missing key mints none, and a failed write mints none.
- The pass is `{event_id, expiry, pepper_epoch, k}`, sealed with a MAC under its own key in each environment. `/q` puts it in the redirect's fragment (`/events/:id/vote#t=…`), so it is never in a query string, a `Referer` or a request log.
- The voter page reads the fragment and removes it from the address bar at once. It keeps the pass in memory only, writes nothing to storage, and posts it in the JSON body. With no pass, it says to scan the code on the screen again.
- A pass lasts 30 minutes (Q12), and a re-scan renews it. A re-scan in the same browser gives the same k, so the same receipts.
- The vote route checks the MAC (in constant time), the event, the expiry and the epoch. No log line and no CI output carries the pass, k, a receipt or the `Location` header.

**S0 result (OSE-2122, 2026-11-18).** `/q` counts scans per address, across all events: an edge binding (60 per 10 s) and KV (360 a minute). Past either, it sends the visitor on with no cookie (`handlers/qr-scan.ts:168-181`). On staging, 150 fresh browsers from one address each got a cookie and a counted scan, once over 20 s and once over 5 s, through the CI path (Room burst (stg) runs 44227517345 and 44231501658; 150 of 150 each time). The 5-second run passed the edge binding's nominal rate, and why is not yet explained. The pass is not built yet. Not measured: real phones, production, carrier shared addresses, more than 360 scans a minute.

**Decision (owner, 2026-11-18, after the three-loop CCR, PR #1416).**

- `/q` minting does not change for the first night. No per-address cap is added at `/q`:
  - The cookie can be forged (`lib/anonymous-id.ts` accepts any `anon_` value), so a cap on cookies would not bound votes.
  - No cap per address can be both room-sized and small enough to stop stuffing.
  - Every such cap gives one person a way to lock the room out.
- Presence is the pass above, checked by the vote route (decision 5).
- Cookie signing (OSE-1496) no longer comes first. It does not block the vote route.
- Presence comes from the event's vote code, on the poster and on the room screen (Q6). A per-song code is not used; it would change this decision and need its own CCR.
- Real phones are untested, because agents cannot get past staging's edge check. The owner accepts that risk. The vote page tells anyone whose scan did not register to scan the code again.
- The cookie-mint cap (N2, OSE-2126) is on hold, with two triggers:
  - Refusals seen in a real room: raise the `/q` limit for that event (a limit above 360 skips the edge binding).
  - A flood seen: a per-song ballot cap on a Durable Object. It is a flood ceiling, not a bound on stuffing, and its lockout risk is written down.

### 7. Results after the set is final

No tally, winner, outcome or voter count appears before the set is final, and none on the display (invariant 5). Before then, no surface shows a vote count or a vote-set counter: not the admin list, the live monitor, audit details, the display or `display-config`. Invariant 2 holds for the brand's own admin.

After the event, results are computed once (decision 4). Only these are published, to anyone, the brand admin included (Q7, Q8):

- **No per-object number.** No up or "not for me" count, for any object, is ever published. No total of them is published either: not for a team, not across objects, not across nights.
- **10 voters first.** Nothing is published unless at least 10 distinct voters voted in the set (participant markers, counted raw).
- **Outcomes only.** For each result the set reports (the winner of the night, or a song's result against the champion), only the outcome: the winner, or "too close to call", and the champion retains.
- **The winner rule.** It runs on the unpublished up counts only; "not for me" counts are not used in the margin. A winner needs an up-count lead of at least T. T is a secret whole number drawn for that result, uniform from 5 to 9 (Q8 A).
- **How T is drawn.** It comes from `crypto.getRandomValues`, by rejection sampling, so no value is more likely. It is drawn when the objects open, before any vote. It is stored only on the server, in a column no route returns, and never logged. It is set to null when the set is final. It is never published, and the outcome does not reveal it.
- **The voter count.** The night's distinct voter count, rounded down to 5 (`roundForPublish`), published only from 10. A season's voter count is a running total through `floorCumulativeOfParts`.
- Own-team voting is allowed.

**What the random margin does, and does not do.** It is a reduction the owner accepted knowingly (Q8, 2026-11-18), not a fix. One person who controls every vote but one can still learn that last vote about one time in five per try; with a fixed margin, every time. No fixed publishing rule can do better while one person can vote from many browsers. T is drawn per result, not once per night, so a person who controls a few results with their own browsers cannot learn T there and use it on the target's result. The card says plainly that the margin varies (decision 9).

### 8. The fun report and participation

**Transparency (owner, 2026-11-18, C2).** The reports are published with enough detail to give trust in the process. Where the line falls between too much and too little detail on the SharedReport is still to be worked out, in OSE-520, inside the rules of decision 7.

Once at least 10 distinct people have voted, the event gets a **fun results report** after the event, for the people who were there and for sponsors. It shows only what decision 7 allows and says plainly that the numbers are for fun, not hard numbers. It belongs to OSE-520, and it is a new public surface with its own gates.

**Participation** (D12, delegated to the team) is kept, because sponsors and organizers value it:

- It is the night's voter count against the devices that scanned in at this event, not against the logged headcount.
- The device count is the number of distinct keyed scan ids for this event in `scan_node_returns`, counted over the whole event, never summed per hour.
- A pass is minted only from a stored scan (decision 6), so every voter is one of those devices, and the two counts are nested.
- The pair goes through `floorPublishedChain` (devices, then voters: round, then chain-floor), and the rate is worked out only from the two published counts, after the set is final and only from 10 voters. If the device count is missing or below the voter count, nothing is published.

### 9. The house rule: "don't be a jag-off"

The owner accepts these residual risks, and the voter page states them in plain words so the room can self-police:

- **Colluders.** Five or more people who know their own votes can work out one other person's vote from a published result.
- **Several browsers.** Someone who scans with several browsers can vote more than once.
- **A script.** One person with a script can cast many votes. Signing the cookie would not stop it: a browser with no cookie gets a fresh one, and a pass, in one request.
- **One vote can decide an outcome.** One person who casts every vote but one can, about one time in five per try, learn that last vote from the outcome. The margin varies to make this rare; it cannot make it impossible (decision 7).
- **Remote voting.** A photo of the code lets someone vote from elsewhere while voting is open.
- **A forwarded pass.** The pass works for whoever holds it. Someone who gets a person's vote link while it is valid can vote in their place, once per song. The person's own vote then answers like a counted one, so they cannot tell. It reveals no identity.
- **Database history.** For 30 days, D1's history can link a scan to a vote by the order of writes, and it holds the secret margins until then.
- **Log timing.** Cloudflare's logs record when each vote arrives, to the millisecond. With one song open, that time names the song. Only the account holder can see them.
- **Timing.** A duplicate may answer faster than a counted vote.

"Zero or not" (accepted on 2026-11-18 through PR #1416) no longer applies: no per-side count is published. The card's exact wording is the owner's.

### 10. What turns voting on

Voting turns on when an admin opens a vote set for the event (D6 = A). No fair setting is needed, so a Fist of Five night at a bar works by itself. ADR-034 decision 4 refuses `competition` mode until voting exists; that refusal ends when the vote route ships, and ADR-034 is amended in the same change. A fair's competition mode then uses this same voting.

## Still open

| Id        | Question                                                                                                                                                                                      | Proposed default                                        | Blocks                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| C2 detail | How much detail does the published report carry, so it builds trust without narrowing to a person?                                                                                            | Work it out in OSE-520, inside decision 7.              | The fun report (OSE-520)                   |
| Wording   | The owner's words for the house-rule card and the report: the nine risks in decision 9; counts are devices, not people; the margin varies; the 10-voter rule does not stop stuffing; for fun. | A plain draft is on OSE-2122. The owner's words govern. | The voter page (S4b), the report (OSE-520) |

## Alternatives Considered

### Alternative A: one row per vote, with a hashed voter key

This is the September 2026 design (migration "0069", never merged).

**Rejected because:** a stable voter key beside a song object is a per-person timeline of preference. The September CCR held it.

### Alternative B: votes stored on OurWKRP

**Rejected because:** OurWKRP holds named people. The owner ruled on 2026-10-09 (OSE-520), and again in D1, that votes live on OSE's anonymous side.

### Alternative C: a vote resolved by the time of the tap

**Rejected because:** of OurWKRP's scan-resolution law and OW-219. A clock-matched vote would need a fine time on the vote, which the hour rule forbids.

### Alternative D: noise added to counts

**Rejected for counts** (D8): noise would end exact winners. On 2026-11-18 (Q8) the owner took a narrower step: no counts are published at all, and the margin a winner needs is a secret random number per result. That is a small, bounded form of noise on outcomes only.

### Alternative E: the vote route reads `ose_anon`

This was D3 as first decided, with an amendment to AGENTS.md invariant 4 (S1g).

**Rejected because:** the owner reversed D3 on 2026-11-18: "Once there is a seam, it's a way in." The pass in decision 6 keeps every cookie read inside `/q`.

## Consequences

### Positive

- One engine serves songs, stalls, teams and an event-wide vote.
- No table can say who voted, and no cookie reaches the vote route.
- Song windows can be as short as the song.
- No per-object number is ever published, so a small count cannot be read off.

### Negative

- Five new tables, a pass from `/q`, and a secret margin per result.
- A vote needs a pass from `/q`. The S0 spike showed that 150 browsers behind one address each get a cookie and a counted scan through the CI path. Real phones are untested, and the owner accepts that (decision 6).
- The pass is a bearer token for 30 minutes (decision 9).
- The residual risks are carried by a house rule, not by code. They include one person with a script, one vote deciding an outcome about one time in five, and a forwarded pass (decision 9).

### Neutral

- Counts are seen only after the set is final, and then only as outcomes and a rounded voter count. The fun report is the moment of transparency.

## Implementation Notes

The stories (D10 = yes; each is a Linear ticket under OSE-1193):

- **Done:** S0, the staging spike on room presence (2026-11-18, decision 6).
- **This ADR:** S1 (OSE-2123).
- **Cancelled:** S1g (OSE-2124). D3 is reversed, so invariant 4 is not amended.
- **After S1:**
  - S2 (OSE-2125), the tables and their gates, including the timestamp gate's scan-shaped rule learning `vote|votable|tally|ballot|receipt|participant`, with `votable_objects.closes_at` on its allowlist;
  - S3 (OSE-2127), admin open, close, reopen and the final lock;
  - S3b (OSE-2133), `/q` issues the pass (decision 6).
- **After S2, S3 and S3b:** S4a (OSE-2128), the vote route. Then S4b (OSE-2129), the voter page.
- **After S4a:** S5 (OSE-2130), results after the set is final. The fun report waits on OSE-520.
- **Other tickets:**
  - N1 (OW-220), the OurWKRP route that opens and closes song objects, brand-bound, after S3;
  - N2 (OSE-2126), a cookie-mint cap at `/q`, on hold with triggers (decision 6);
  - N3 (OSE-2131), the CI/CD testing ticket;
  - N4 (OSE-2132), a staging load case for a room behind one address.
  - N5 (widen the unrun-spec check) is proposed, not created.

Every test is seen failing first, at the workers-pool layer and on staging (Bruno, Playwright).

## References

- **Tickets:** OSE-1193, OSE-1192, OSE-2000, OSE-1996, OSE-513, OSE-514, OSE-518, OSE-520, OSE-1496, OSE-2122 to OSE-2133; OW-73, OW-218, OW-219, OW-220.
- **PRs:** #1407 (the readiness CCR), #1413 (its revert, with the owner's answers), #1414 (this ADR), #1415 (the room-burst measurement), #1416 (the presence CCR), #1417 (the presence amendment), #1418 (the S1 CCR on the decided text).
- **ADRs:** ADR-034 (booths, participation mode), ADR-032 (a mode as a column).
- **Rules:** AGENTS.md invariants 1, 2, 3, 4 and 5.

## Revisit Criteria

- The owner settles the published report's level of detail.
- A count is wanted during the night (invariant 5).
- A per-object number is wanted in a published result (Q8).
- A vote limit beyond one per object is wanted ("to start").
- A way to bind one vote to one person, while staying anonymous, becomes available (it would close the risk in decision 7).
- A refusal is seen in a real room, or a flood is seen (the triggers in decision 6).
- A per-song code on the room screen is wanted in place of the event's vote code (decision 6).
