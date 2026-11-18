---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 0
system_score: 77.5
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 2, medium: 0, low: 0 }
---

# CCR: S0 presence recommendation (OSE-2122, Voting S0)

Date 2026-11-18. Three loops, at the owner's request. Repo `main` at `66251c7`.

**Subject.** How `/q` gives out the `ose_anon` cookie that a vote will accept as presence (ADR-040 decision 6), when a whole room shares one Wi-Fi address. Options: A (raise the `/q` limits per event), B (an edge rule, OSE-1589), C (a cookie-mint budget per event, per address, per day: the recommendation under review), plus the variants the review produced (C′, D, E, F).

**Class.** `security-fix` (3 to 4 loops). The subject is a control against ballot stuffing, and the plan this review lands on changes no architecture. If the owner picks C′, D or F later, each one is an architecture change and needs its own five-loop CCR.

**Update, later on 2026-11-18: the owner answered Q1 to Q3.** In the owner's words: "yes to Q1, Q2 not a blocker, poster for night one". The score moves from 0% to 77.5%. Two items are still open: the card and report wording (R4, R5), and real phones (Q4). Q5 is unanswered. Details are in "Findings register", "Risks accepted" and "Human gate". The three loops above are unchanged.

## Verdict

| Item                  | Result                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cumulative score      | **0%** (every loop scored 0)                                                                                                                                  |
| System score          | **77.5%** after the owner's answers (Q1 to Q3, 2026-11-18). Open: U3 (card and report wording) and U5 (real phones).                                          |
| Assessment confidence | 63 → 68 → 75 (never fell between loops)                                                                                                                       |
| Gate                  | **Stop.** Two items are left: the owner's wording (R4, R5) and Q4. Q5 is unanswered.                                                                          |
| Recommendation        | **Not C. "E-plus": change nothing at `/q` now; make presence real and born red at the vote route; say the stuffing risk plainly; hold D as a flood ceiling.** |

Why not C:

- It caps the wrong thing. The cookie can be forged, and five routes mint it.
- No per-address cap can be both big enough for a room and small enough to stop stuffing.
- Every cap hands one person a lever to lock the room out.
- The staging measurements show the room already gets in: 150 of 150, at 7.5 and at 30 a second.

**Departure from the 2026-11-02 ruling, disclosed.** The ruling says nothing changes between loops. In this run, the candidates under test were revised between loops (C, then C′/D/E, then the E-plus plan), because each loop's findings broke the one before. The findings are taken together here as one cumulative score. The resulting plan is in "Solutioning".

## What was reviewed

- **In scope:** the options above; their cost against stuffing (ADR-040 decision 9); the two staging measurements; the source of the `/q` path.
- **Out of scope:** building any option; editing ADR-040 (another session owns it); production; Cloudflare settings.
- **Evidence:**
  - Staging run 44227517345: 150 fresh browsers from one address over 20 s. 150 cookies, 150 scan rows, 150 distinct ids, 0 edge answers, 0 429s.
  - Staging run 44231501658: 150 over 5 s, all inside one 10 s window (2.5x the edge binding's 60 per 10 s). Same counts.
  - Source as cited per finding.

## Loop 1

Team: dr-of-security, role-backend-architect, role-data-scientist, role-product-owner

Critical layer: what is true versus assumed in the case for C. The case assumed only the Worker can issue a cookie. That is false: `getOrCreateAnonId` accepts any `anon_[a-zA-Z0-9_-]+` value and records nothing (`anonymous-id.ts:34-41`). A script with made-up cookies takes C's "already has a cookie" path and never meets the budget.

Findings:

- **L1-1, Security Critical.** The cookie is forgeable (above).
- **L1-2, High.** The cap is on the wrong object. Four form routes also mint the cookie (`forms.ts:249-615`), and it lives a year (`anonymous-id.ts:18`). What lets a browser vote is the presence ticket.
- **L1-3, High.** A key per event can't be made where the limiter runs: `/q` learns the event only after the D1 lookup (`router.ts:750`, `qr-scan.ts:141-152`).
- **L1-4, High.** C keeps an address-derived key for a day (today 60 s), and it can be listed (`rate-limit.ts:199-217`, `router.ts:2233`).
- **L1-5, High.** The measurement misses:
  - real phones, because the CI header skips the edge challenge;
  - production;
  - carrier NAT;
  - more than 360 a minute.
- **L1-6, High (inferred).** A raw IPv6 address is the bucket key (`public-read-limit.ts:85-89`).
- **L1-7, High (inferred).** Decision 7's floor, margin and 10-voter rules do not stop stuffing.
- **L1-8 to L1-14, Medium and Low.**
  - KV can't hold an exact cap, and no Durable Object exists.
  - The organizer field adds setup.
  - A refusal is silent.
  - One device can drain a shared budget.
  - C solves a failure nobody has seen.
  - The burst job is not a gate.
  - Minting and counting must be one decision.

Score: 0%

## Loop 2

Team: dr-of-security, role-backend-architect, role-data-scientist, role-sdet-sre, role-product-owner

Conservative layer: assume the worst. The candidates under test were C′ (cap tickets, not cookies), D (cap ballots per song at the vote route) and E (change nothing now).

- Signing the cookie (OSE-1496) does not bound stuffing. A browser with no cookie gets a fresh signed cookie and a ticket in one request.
- Every per-address cap is multiplied by extra addresses (phone data plus Wi-Fi, IPv6), and hands one actor a lockout lever.
- The poster link has no time window (`qr-scan.ts:143`).

Findings:

| Id       | Severity | Finding                                                                                                                                             |
| -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| L2-SEC-1 | High     | Signing does not bound stuffing. Only a cap on issued tickets (C′) or on accepted ballots (D) does, and D's bound holds even with unsigned cookies. |
| L2-SEC-2 | High     | Presence means knowing a static poster link, not being in the room.                                                                                 |
| L2-SEC-3 | High     | No address cap is both room-sized and floor-sized. One actor meets the 10-voter rule alone.                                                         |
| L2-SEC-4 | High     | Caps hand one actor a lockout lever: under C′ all night, under D per song.                                                                          |
| L2-SEC-5 | High     | A Durable Object count resets on eviction or deploy. Persisting it stores address-derived keys.                                                     |
| L2-SEC-6 | Medium   | D on KV fails under a real room (about 1 write per second per key).                                                                                 |
| L2-BE-1  | High     | A Durable Object means a binding plus a migration tag in both environments, and migrations are hard to undo.                                        |
| L2-BE-2  | High     | The vote route already writes a receipt for each object, so a cap there costs one more write, and only on votes.                                    |
| L2-BE-3  | Medium   | Signing touches 5 call sites, needs async HMAC and a key, and either resets or grandfathers year-long cookies.                                      |
| L2-DS-1  | High     | The cap value is the error bar on every published number.                                                                                           |
| L2-DS-3  | High     | A fixed cap is wrong both ways: a room of 300 runs at 100%, and a 40-person event can take 7.5 times its size.                                      |
| L2-SRE-2 | High     | Agents cannot measure real phones within the rules. That is the owner's choice.                                                                     |
| L2-SRE-4 | Medium   | The burst job exits 0 whatever the limiter does.                                                                                                    |
| L2-PO-1  | High     | Decision 9 accepts "several browsers", not one person with a script.                                                                                |

Rejected claim: invariant 3 is not broken. `CF-Connecting-IP` is not a `CF-IP*` header, and `src` reads no `CF-IP*` header.

Four of five lenses rejected C′. The majority verdict was "E-plus, D in reserve".

Score: 0%

## Loop 3

Team: dr-of-security, role-qa-automation, role-scrum-master

Recursive layer: was the assessment honest? Two things were still being rationalised:

- The vote-route gates prove a ticket is genuine. They do not bound stuffing.
- "D on a Durable Object" is a flood ceiling, not a stuffing bound.

Findings:

- **L3-SEC-2, High (Security Critical if the owner answers Q1 "no").** Four browsers on one phone, no script needed, reveal whether a side's real count is 0. A count is floored at 5, then rounded down (`count-floor.ts:38-43,159-167`; ADR-040:94). So a true 0 plus 4 reads "Fewer than 5", and any true count of 1 or more plus 4 reads 5. No `/q` or address cap changes this.
- **L3-SEC-1, High.** The ticket must fail closed when its key is missing. Today the scan id fails open (`qr-scan.ts:183-185`).
- **L3-QA-1 to L3-QA-4, High and Medium.** The gate list has gaps:
  - a tampered HMAC;
  - a missing key;
  - a closed song;
  - expiry, testable only at the mock layer;
  - the uncounted `/q` path.
- **L3-SM-1.** Checked in Linear: OSE-2126 (N2) Backlog, OSE-2128 (S4a) Backlog, OSE-2132 (N4) Backlog, OSE-1496 In Progress.

Resolved conflict:

- QA said a browser that re-scans on the uncounted path should still get a ticket. Security said it should not.
- Ruling: no ticket on the uncounted path, so every voter is a device that scanned in (decision 8).
- A browser keeps its earlier ticket for the event day.

Score: 0%

## Findings register

Open rows count toward the frontmatter's `unresolved`. A row closed by solutioning names the plan item that closes it.

| Id                      | Severity          | Finding                                                                    | Status                                                                                               |
| ----------------------- | ----------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| L1-1                    | Security Critical | The cookie is forgeable, so C's mint budget can be walked around           | closed: C dropped. The forgery itself is tracked in OSE-1496.                                        |
| L1-2                    | High              | The cap is on cookies, not presence tickets                                | closed: no mint cap (R1)                                                                             |
| L1-3                    | High              | A per-event key can't be made where the limiter runs                       | closed: no `/q` cap (R1)                                                                             |
| L1-4                    | High              | An address-derived key kept for a day                                      | closed: no new address key (R1)                                                                      |
| L1-6                    | High              | IPv6 /64 rotation                                                          | closed: no address cap (R1). It still applies to D, recorded in R8.                                  |
| L1-7                    | High              | Floors and margin are not stuffing defences                                | closed: merged into U3 (disclosure)                                                                  |
| L2-SEC-4                | High              | A cap is a lockout lever                                                   | closed: no cap (R1). Written into the R8 trigger.                                                    |
| L2-SEC-5                | High              | A Durable Object count resets, or stores keys                              | closed: no Durable Object now (R1)                                                                   |
| L2-BE-1                 | High              | Durable Object build cost                                                  | closed: none built now                                                                               |
| L2-DS-3                 | High              | A fixed cap is wrong both ways                                             | closed: no cap (R1)                                                                                  |
| L3-SEC-1                | High              | The ticket fails open without a key                                        | closed: gate in R2                                                                                   |
| L3-QA-1                 | High              | Gate list gaps                                                             | closed: R2 list corrected                                                                            |
| L1-10                   | Medium            | A refusal is silent                                                        | closed: R3                                                                                           |
| L2-SRE-4                | Medium            | The burst job never fails on the limiter                                   | closed: R6                                                                                           |
| U1 (L2-SEC-3, L3-SEC-2) | High              | One actor can add many votes and learn whether a side got zero other votes | closed: owner accepted the risk, Q1 "yes", 2026-11-18 (accepted, not fixed)                          |
| U2 (L2-PO-1)            | High              | Decision 9 may not cover one actor with several browsers or a script       | closed: owner answered Q1 "yes", 2026-11-18 (decision 9 covers it)                                   |
| U3 (L2-DS-1)            | High              | The stuffing error bar is not disclosed on the card or the report          | open: closes when the owner's wording is approved and live on the card and in the report (R4, R5)    |
| U4 (L2-SEC-2)           | High              | Presence is a static poster link                                           | closed: owner chose the static poster for night one, Q3, 2026-11-18. Option F is recorded for later. |
| U5 (L1-5, L2-SRE-2)     | High              | Real phones unmeasured                                                     | open: owner, Q4 (a real-room scan on staging, or accept the risk in writing)                         |
| U6 (L2-BE-3)            | Medium            | Whether OSE-1496 signing still blocks S4a                                  | closed: owner ruled OSE-1496 is not a blocker for S4a, Q2, 2026-11-18                                |

Score arithmetic (production design, environment ×1.0; Loop 2 discoveries ×1.25; U1 to U3 are three correlated findings, ×2.0):

| Deduction                                 |                     Points |
| ----------------------------------------- | -------------------------: |
| U1 + U2 + U3 = (12.5 + 12.5 + 12.5) × 2.0 |                         75 |
| U4 = 10 × 1.25                            |                       12.5 |
| U5 = 10 × 1.0                             |                         10 |
| U6 = 5 × 1.25                             |                       6.25 |
| Total                                     | 103.75, so the score is 0% |

After the owner's answers (2026-11-18: Q1 "yes", Q2 not a blocker, Q3 the static poster):

| Deduction      |                      Points |
| -------------- | --------------------------: |
| U3 = 10 × 1.25 |                        12.5 |
| U5 = 10 × 1.0  |                          10 |
| Total          | 22.5, so the score is 77.5% |

- U1 and U2 are closed by the owner's acceptance of the risk. They are accepted, not fixed.
- U3 was one of three correlated findings. Alone it is not multiplied.
- U4 and U6 are closed by the owner's answers to Q3 and Q2.

Path to 95%:

| What closes                                                              | Score |
| ------------------------------------------------------------------------ | ----: |
| U3 only: the owner's wording is approved and live (R4, R5)               |   90% |
| U5 only: Q4 answered (a real-room scan, or the risk accepted in writing) | 87.5% |
| Both                                                                     |  100% |

Neither step alone reaches 95%.

## Solutioning

The plan is "E-plus, D in reserve". R1 to R9:

**R1. No change to `/q` minting now.** Re-scope N2 (OSE-2126, Backlog) to "held", with the written triggers from R8. Needs the owner's Q5.

**R2. S4a (OSE-2128) gates.** Each gate is seen red on an injected fault, at both layers unless marked (workers-pool spec `tests/vote-presence.spec.ts`; a Bruno folder run in T2). These prove the ticket is genuine; they do not bound stuffing. With Q2 (no signed cookie before S4a), the vote route reads the cookie with a read-only parser that checks no signature, so gates 3 and 4 carry the vote-side proof. The gates:

1. A ballot with no ticket is refused.
2. A ticket for another event is refused.
3. A tampered ticket is refused.
4. A ticket whose cookie hash does not match is refused.
5. An expired ticket is refused (mock layer only, with a controlled clock).
6. With the ticket key missing, `/q` issues no ticket and the vote is refused.
7. A ballot on a closed song is refused.
8. The uncounted `/q` path issues no ticket.
9. A second ballot from one cookie on one object is counted once.
10. The ticket compare is constant-time (checked in code review).

**R3. A "scan the code again" message** on the vote page when the ticket is missing or invalid. Lands in S4b.

**R4. House-rule card**, in the owner's words. It says that one phone with several browsers can add votes and can tell whether a song got zero other votes.

**R5. Report text** (new child story of OSE-520): counts are devices, not people; the margin and 10-voter rules do not stop stuffing; the results are for fun.

**R6. Room-burst job:** add an `assert_minted_min` input (default `min(150, requests)`). See it red first with `assert_minted_min=151`. It stays dispatch-only, a measurement and not a gate. Lands in N4 (OSE-2132) or N3.

**R7. Real-phone check on staging.** Agents can't do it, because of the edge challenge. Owner's Q4.

**R8. Triggers, written on N2:**

- Refusals seen in a real room → option A: a per-event `/q` limit above 360, which skips the edge binding.
- A flood seen → option D on a Durable Object, labelled "flood ceiling, not a stuffing bound", with its lockout risk recorded.

**R9. Owner questions Q1 to Q5.** Q1 to Q3 were answered on 2026-11-18. Q4 and Q5 are open. Q1 is not a blocker on S4a any more.

Critical path to a first bar night:

1. S0 evidence and the owner's answers.
2. S1g. OSE-1496 carries on by itself and no longer blocks S4a (Q2).
3. S2, S3 and N1.
4. S4a with R2, then S4b with R3 and R4.
5. N4 with R6 on staging.
6. S5 and the report, after the night.

## What must be true before shipping

- The owner answered Q1 "yes" on 2026-11-18, so S4a may be built. The house-rule card and the report must carry the plain wording (R4, R5) before the first bar night.
- The R2 gates exist at both layers, and each was seen red on its fault.
- The R3 message and the R4 card text are live on the vote page.
- N2's hold and its R8 triggers are written on OSE-2126.

## Verification after shipping

- T2 runs the Bruno vote-presence folder, and its `test()` names print.
- The room-burst job runs with `assert_minted_min` after any change to the `/q` limits or the edge binding.
- After the first bar night, the organizer compares voters against scanned devices (decision 8) for an implausible ratio.

## Risks accepted

The owner answered on 2026-11-18:

- **Q1 "yes".** These risks are accepted. They go on the house-rule card and in the report, in the owner's wording (R4, R5):
  - One person with several browsers, or a script, can add many votes.
  - Four browsers on one phone can show whether a song got zero other votes.
- **Q2, not a blocker.** OSE-1496 (cookie signing) does not hold up S4a. The ticket's HMAC does the vote-side job. OSE-1496 carries on by itself and still protects scan counts.
- **Q3, the poster for night one.** Presence comes from the static poster. A per-song code on the room screen (option F) is recorded for later. It changes decision 6, so it needs its own CCR.

Still open: real phones are unmeasured (Q4), and N2 is not yet held (Q5).

## Human gate

1. **Q1. Decision 9 scope. Answered 2026-11-18: yes.** One person, with four browsers on a phone (no script needed) or with a script, can (a) add many votes and (b) learn whether a song got zero other votes. Does decision 9 accept both?
   - If yes, the house-rule card and the report say it plainly.
   - If no, voting needs a different publishing rule before S4a, because no `/q` or address cap closes (b).
   - Closes: U1, U2, U3. Gap found: Loop 2, Conservative layer; sharpened in Loop 3, Recursive layer.
2. **Q2. Keep "OSE-1496 cookie signing comes first" ahead of S4a? Answered 2026-11-18: not a blocker.** This review found that signing does not bound stuffing; the ticket HMAC (decision 6) does the vote-side job. Signing protects the honesty of scan counts and costs about two stories. Recommendation: not a blocker for S4a. Closes: U6.
3. **Q3. Presence from the static poster, or from a per-song code on the room screen (option F)? Answered 2026-11-18: the poster for night one.** F narrows "anyone with a photo of the poster" to "anyone who could see the screen during this song". It does not stop a stuffer in the room, and it changes decision 6. Recommendation: the static poster for the first night, with F recorded for later. Closes: U4.
4. **Q4. Real phones. Open.** Agents can't measure the real-phone path. Will you run one real-room scan on staging, or accept the risk with the "scan again" message? Closes: U5.
5. **Q5. Open.** Re-scope N2 (OSE-2126) to "held, with triggers"?

What is verified, inferred and not checked:

- **Verified at runtime:** the two staging runs.
- **Verified from source by the session lead:**
  - `anonymous-id.ts:18,34-41`
  - the `forms.ts` mint sites
  - `qr-scan.ts:143`
  - `count-floor.ts:38-43,159-167`
  - ADR-040:94
  - no `CF-IP*` read in `src`
  - songs last 2 to 7 minutes
  - the Linear states of OSE-2126, OSE-2128, OSE-2132 and OSE-1496
- **Inferred:** each attack's effect; IPv6 rotation; Durable Object eviction; KV write limits.
- **Not checked:** production edge settings; real phones; how Cloudflare handles IPv6 in rate limiting.
