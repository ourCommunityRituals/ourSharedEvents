---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 41
system_score: 63
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 3, low: 6 }
pr: 1562
subject_sha: '04a906e9b07e2e17f29970ada066d128e66ab33e'
---

# CCR: stricter in-room voting (OSE-2234, PR #1562)

**Subject:** branch `claude/project-thread-a7vakd`. Loops 1 and 2 reviewed `51eb3a9`; loop 3 reviewed `04a906e`, which carries the fixes from loops 1 and 2. The ADR-040 wording fixes and the owner's decision (built after loop 3) are unreviewed by a further loop.

**Owner's asks (Matt, 2026-11-26):** flood detection only (decision card); keep the public "may be padded" note (decision card); "I would like the voting as stringent as you can make it"; chose "Changing code + room size" (decision card); "I want to keep any kind of manipulation in check too by sponsors and events manipulating results"; "I don't results pushed positively or negatively"; "Integrity is a main goal here"; "this way further AI manipulation is also in check"; and the standing rule that voting stays in the room, never online.

## Verdict

**41% (cumulative, the worst loop); 63% after the fixes built since loop 3. Below 95%: human gate.** The owner chose "Room check only, show room size" (decision card, 2026-11-26 05:36 UTC), now built: the public "may be padded" line comes only from the room check at final, the per-minute alarm is a host-only flag (`burst_seen`), and the final result shows the room size the host gave. No Security Critical finding: nothing leaks who voted or a count, and no auth bypass was found. The change does make voting stricter than `main` (a photo of the code goes stale in two minutes; padding past the declared room size is flagged at any pace; names and room size cannot move after open). It does not meet the owner's bar that no host can push a result, and the public flag can be tripped against an honest night. The owner's choice closes the smear path and makes a host's room size visible; a host can still boost up to the size they declare.

## What was reviewed

`git diff origin/main...HEAD` under `workers/oursharedevents/src`, `migrations/0122_vote_integrity.sql`, the tests named below, the Bruno 25 folder, and `docs/adr/ADR-040-anonymous-votable-object.md` (2026-11-26 amendments). Not reviewed: OurWKRP, the vote-cast path beyond the participant insert, sponsor-role reach into admin routes (predates this diff), staging runtime.

## Loop 1

Team: dr-of-security
Critical layer: what is true versus assumed in the code, comments and ADR.
Score: 51%

Eight findings: host boost through a self-declared room size and fresh admin stamps (Critical); a one-way public flag that can be tripped without padding (High); a fixed 300/min threshold against room sizes to 50000 (Medium); stamp proves freshness, not presence (Medium); a duplicate-name object after open splits votes (Medium); the admin card's static QR dies in two minutes with no word to voters (Medium); Bruno 51 and 52 pass vacuously on an edge 403 (Low); a set with no room size is never room-checked (Low). Found sound: the stamp crypto and window, the room check's place in the final batch, no code path that clears the flag or moves the room size, no public leak, brand scope.

## Loop 2

Team: role-backend-architect
Conservative layer: assume the worst insider, sponsor, attendee, remote relay and script, for both boost and smear.
Score: 56%

Confirmed the loop 1 core (smear High, boost High) and added: the vote screen skipped reloads while hidden, so a sleeping screen silently stops votes (Medium); the host can still add decoys, close a rival's window early or reopen a favourite's after open (Medium); the flood detector is per location (Low); stale-photo scans still write scan rows (Low).

## Loop 3

Team: role-qa-automation
Recursive layer: were loops 1 and 2 honest, are the fixes real, what did both miss.
Score: 41%

Merged the duplicates between loops 1 and 2, kept the host boost at Critical, verified the duplicate-name fix (pre-check, atomic SQL guard, test) and the reload fix, and added: ADR sentences that overstated (no remote path; photo stops within two minutes; sees padding at any pace; a stale "photo can trip" line), a residual on the name fix (pre-open repeats allowed, ASCII-only case folding, the SQL guard untested alone), and test gaps (room check tested by direct inserts only; no Bruno case for LABEL_TAKEN or the room check).

## Findings register

| Id  | Severity | Finding                                                                                                                                                                                                                                                                                              | Status                                                                                                                                                                                                        |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | High     | A host declares the room size (10 to 50000) and can fetch fresh stamps from the admin list, so paced forged voters below that size boost a result and nothing flags it. Was Critical; lowered because the declared size is now printed with the final result, so the room can see an inflated number | Open: mitigated (room size public at final); refusing it needs a ceiling the host does not choose                                                                                                             |
| F2  | High     | The one-way public "may be padded" flag could be tripped against an honest night by one browser re-scanning fast                                                                                                                                                                                     | Fixed after loop 3 (owner decision): the alarm writes host-only `burst_seen`; the public line comes only from the room check. Born red. The under-declaring host is now visible through the printed room size |
| F3  | Medium   | The fixed 300/min alarm misjudges big honest rooms and small padded ones                                                                                                                                                                                                                             | Fixed after loop 3: the alarm no longer marks a public result (host warning only)                                                                                                                             |
| F4  | Medium   | The stamp proves a fresh view, not presence: one live relay serves anyone, each pass lasts 30 minutes                                                                                                                                                                                                | Open: accepted residual risk to name with the owner; code comment and ADR now say so                                                                                                                          |
| F5  | Medium   | A duplicate-name object after open splits a song's votes                                                                                                                                                                                                                                             | Fixed in 04a906e (LABEL_TAKEN, code and SQL, born red)                                                                                                                                                        |
| F6  | Medium   | Admin card showed a code that dies in two minutes as if it were the room code; the vote screen skipped reloads while hidden                                                                                                                                                                          | Fixed in 04a906e (card wording, always reload, reload on becoming visible)                                                                                                                                    |
| F7  | Medium   | A stale-stamp scan lands on the event page with no word, so an honest voter is dropped silently                                                                                                                                                                                                      | Open: follow-up (voter landing message)                                                                                                                                                                       |
| F8  | Medium   | After open a host can add a decoy with a new name, close a rival's window early, or reopen a favourite's                                                                                                                                                                                             | Open: owner decision (freeze adding after open; window moves are already audited)                                                                                                                             |
| F9  | Low      | A set with no room size (opened by an older Worker) is never room-checked                                                                                                                                                                                                                            | Open                                                                                                                                                                                                          |
| F10 | Low      | Bruno 51 and 52 pass vacuously on an edge 403 (pattern predates this branch)                                                                                                                                                                                                                         | Open                                                                                                                                                                                                          |
| F11 | Low      | The flood alarm counts per Cloudflare location, so a spread flood is unseen                                                                                                                                                                                                                          | Open (documented in vote-flood.ts)                                                                                                                                                                            |
| F12 | Low      | A stale-stamp scan still writes a scan row                                                                                                                                                                                                                                                           | Open                                                                                                                                                                                                          |
| F13 | Low      | Name fix residual: repeats before open are allowed; `lower()` folds ASCII only                                                                                                                                                                                                                       | Open                                                                                                                                                                                                          |
| F14 | Low      | Test gaps: room check proven by direct inserts only; no Bruno case for LABEL_TAKEN or the room check at final                                                                                                                                                                                        | Open                                                                                                                                                                                                          |
| F15 | Low      | ADR-040 overstated (no remote path; photo dead in two minutes; any pace; stale "photo can trip" line)                                                                                                                                                                                                | Fixed after loop 3 (ADR wording), unreviewed                                                                                                                                                                  |

## What must be true before shipping

- The owner answers F8 (freeze adding objects after open) and accepts or refuses F4 and F11.
- PR #1562 CI green, then the staging chain (T1 to T4) green for the merge SHA.
- Migration 0122's two triggers apply on staging D1 (the first `CREATE TRIGGER` in this migrations folder); seen on staging, not assumed.
- Bruno 50 (fresh stamp mints) and 51/52 (no or old stamp mints none) print their test names on staging, not only the EDGE branch.

## Verification

- Born red after the owner's decision: the alarm writing `flood_seen` again, the public result dropping the room size, the `burst_seen` trigger removed, and the gate's `burst_seen` rule removed: each went red, each restored.
- Born red: nine injected faults went red before the loops (stamp check, window, room trigger, flag trigger, room check compare, room check placement, open without room size, label lock with both guards removed); the duplicate-name test went red with both its guards removed (04a906e).
- Local runs: vote worker specs 16 files, 1591 tests passed; `vote-set-admin` and vote-screen specs 69 passed after 04a906e; architecture structural gates passed (lexicon, lexicon allowance and votes-never-who: 57 passed after 04a906e); Bruno structure tests 421 passed; Playwright admin voting card and vote screen 12 passed. `tsc --noEmit` clean.
- Not verified: staging runtime, trigger apply on remote D1, the full worker suite's last run.

## Risks accepted

None accepted yet by the owner. Proposed for acceptance: F4 (a live relay of the screen; in-room presence cannot be proven anonymously), F11 (a per-location alarm is a smoke alarm, not a meter). Both are stated in ADR-040.

## Human gate

Below 95%, so the owner decides. ADR-040 is a governance artifact and needs Matt's review before merge. The decision card on the public note was answered ("Room check only, show room size") and is built.

Questions for the owner:

- Should a host be refused from adding new songs or stalls once voting has opened (F8)?
- Do you accept that one person relaying a live view of the room screen can still let others vote, with the room check as the only backstop (F4)?
- Should the room size have a ceiling the host does not choose, such as a venue capacity the operator keeps (F1)?

## Solutioning

- F2 and F3: done (owner decision, built after loop 3).
- F1: the declared size is now public at final. Closing it fully needs a ceiling the host does not choose (for example the venue's capacity held by the operator); owner choice.
- F7: a stale stamp lands on the event page with one line ("This vote code has changed. Scan the code on the room screen again."), no count.
- F8: refuse new objects once voting has opened, or show the host and operator when a window was moved; owner choice.
- F9: refuse a reopen of a set with no room size, or let that reopen set it once.
- F10: make Bruno 51 and 52 fail when the EDGE branch runs on a request that should reach the Worker.
- F12 to F14: Unicode case folding in the label key; a cast-path test past the room size; Bruno cases for LABEL_TAKEN and the room check.
- With F1, F7, F8 and F9 closed and F4, F11 accepted, the open weight is about 8 (four Lows), a projected 92%; reaching 95 also needs F13 and F14 closed and a fresh CCR on the result.
