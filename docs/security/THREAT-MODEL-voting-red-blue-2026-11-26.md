# Threat model: voting, red team and blue team (2026-11-26)

**Scope.** The three ways a vote reaches OurSharedEvents (OSE ADR-040):

- **Room Pick.** The official result. A person in the room scans the room's vote code at `/q`, gets a 30-minute pass in the URL fragment, and votes on the voter page.
- **Access Pass** (decision 13, new). A host gives a link to someone who cannot be in the room. It needs no reason, no proof and no name, and the vote counts in the Room Pick with the same weight as anyone in the room. At most 4 per night.
- **Online Pick** (decision 13, new). An optional, for-fun result that anyone with the event's link can vote in. It never changes the Room Pick, and it says so on the page.

**Owner's words (Matt, 2026-11-26).** "I would like this type of voting to be as strong as engineering will allow." And on voting from outside the room: "I give permission." Standing rules: voting stays anonymous, in-room voting is the first layer and is never loosened, and the guard runs against voters, sponsors, hosts and bots, in both directions (boosting and burying).

**Method.** STRIDE and LINDDUN over every element below, then a red team (the attack) and a blue team (the control, where it lives in code, and the test that proves it) for each scenario. Every control named here was seen failing on an injected fault before it was trusted (born red). Tests marked "run" were run in this branch's container; that is a test rig, not staging (AGENTS.md).

**Related work.** OSE-2234 (PR #1562) owns the rotating per-minute vote code and the host-entered room size. This model names those controls where they answer a scenario and does not duplicate them.

---

## 1. Data flow and trust boundaries

```
 Phone in the room ──scan──▶ /q (sets ose_anon) ──302──▶ /events/:id/vote#t=vp1.…  ──POST──▶ /api/v2/vote/:id
                                                                                                  │
 Host (Cloudflare Access) ──▶ /api/v2/admin/events/:id/votables/access-passes (give, list, revoke) │
          │ shows the link once: /access#<token>                                                  ▼
 Access Pass holder ──▶ /access (script) ──POST {token}──▶ /api/v2/vote/access ──▶ /events/:id/vote#t=vp1.…(a)
                                                                                                  │
 Anyone with the link ──▶ /q/crowd/:id ──302──▶ /events/:id/online-pick#t=vc1.… ──POST──▶ /api/v2/vote/:id/crowd
                                                                                                  │
                                                         D1 (DB, the anonymous side) ◀────────────┘
     Room:   vote_sets, vote_tallies, vote_receipts, vote_participants, vote_team_markers
     Access: vote_access_passes (an HMAC lookup of the token, never the token)
     Online: vote_crowd_sets, vote_crowd_tallies, vote_crowd_receipts, vote_crowd_participants
```

| Boundary           | What crosses it                     | Control                                                                                                   |
| ------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Internet → Worker  | every request                       | per-route, per-caller limits (`lib/public-read-limit.ts`); the address is a bucket key only, never stored |
| Phone → vote route | a pass in a JSON body               | HMAC seal, expiry, epoch, event binding (`lib/vote-pass.ts`)                                              |
| Host → admin       | give, revoke, Online Pick on or off | Access JWT, brand scope, same-origin JSON writes, audit log                                               |
| Room ↔ Online Pick | nothing, by construction            | separate tables, keys, seals and prefixes; the T0 gate "channels never mix"                               |
| Token → database   | an HMAC of the token                | `accessLookup` under its own HKDF label                                                                   |

---

## 2. Attacker profiles

| Profile                              | Wants                              | Budget                                              |
| ------------------------------------ | ---------------------------------- | --------------------------------------------------- |
| A1. A voter with friends             | push their song, or sink a rival   | a few phones, cleared cookies                       |
| A2. A scripted swarm or botnet       | a result, or to deny the vote      | many browsers, many addresses                       |
| A3. An AI agent swarm                | the same as A2, faster and cheaper | automated browsers that read pages and follow links |
| A4. A host or sponsor (insider)      | a result that favours them         | admin access to one brand, Access Passes            |
| A5. Another brand's admin            | to touch this event                | admin access to a different brand                   |
| A6. A remote voter                   | a vote without coming              | a photo or a relay of the room's code               |
| A7. A data thief or curious operator | who voted for what                 | a copy of D1, logs, or request lines                |
| A8. Supply chain                     | code in the Worker                 | a dependency or an action                           |

---

## 3. Red team and blue team

Status: **Built** = in this branch, with a test that was seen red. **Existing** = already on `main`. **#1562** = in OSE-2234's PR. **Residual** = accepted or open, listed again in section 6.

### Access Pass

| Id       | Red team: the attack                                  | Blue team: the control                                                                                                        | Code                                     | Test (run)                                                                  | Status                                  |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| RT-AP-01 | Steal D1 and vote with the stored passes              | The token is never stored; only HMAC(K_access_lookup, token). A table copy cannot vote                                        | `lib/vote-access-pass.ts` `accessLookup` | `vote-access-online.spec.ts` RT-AP-01                                       | Built                                   |
| RT-AP-02 | Make a pass carry who it is for (name, note, reason)  | The give route takes an empty body only; 400 on any field. Audit names no recipient                                           | `handlers/votables.ts` give-access       | RT-AP-02                                                                    | Built                                   |
| RT-AP-03 | Host gives 4, revokes, gives 4 more, and so on        | The cap counts every pass ever given for the set, revoked ones too                                                            | cap inside the INSERT                    | RT-AP-03; mutant `access-pass-cap-frees-on-revoke` killed                   | Built                                   |
| RT-AP-04 | Twelve gives at once race past the cap                | The count is inside the INSERT … SELECT, one statement                                                                        | same                                     | RT-AP-04 (12 parallel gives, at most 4); mutant `access-pass-no-cap` killed | Built                                   |
| RT-AP-05 | Another brand gives, lists or revokes passes here     | Brand scope: 404, no row changes                                                                                              | `guardAdminObjectScope`                  | RT-AP-05                                                                    | Built                                   |
| RT-AP-06 | Forward one pass to many people                       | Every redeem of one token gives the same voter key, so it is one voter however many hold it                                   | `accessVoterKey(token, event)`           | RT-AP-06                                                                    | Built                                   |
| RT-AP-07 | Keep voting after the host takes the pass back        | The vote route checks the pass id (`a`) on every vote, and the receipt INSERT checks it again (SEC-4)                         | `handlers/vote.ts` `accessPassUsable`    | RT-AP-07; mutant `access-pass-revoke-not-checked-at-vote` killed            | Built                                   |
| RT-AP-08 | Learn why a token failed (guessing oracle)            | One identical 403 for unknown, revoked, closed, voting off and bad shape                                                      | `handlers/vote-access.ts` `refuse()`     | RT-AP-08                                                                    | Built                                   |
| RT-AP-09 | Redeem from another site (CSRF) or smuggle fields     | POST, JSON, same-origin, exactly `{token}`, 512 bytes                                                                         | same                                     | RT-AP-09                                                                    | Built                                   |
| RT-AP-10 | Reuse an Access Pass key as a room key or the reverse | Its own HKDF label; keys differ for the same bytes                                                                            | `lib/vote-pass.ts`                       | RT-AP-10; mutant `access-pass-key-is-room-key` killed                       | Built                                   |
| RT-AP-11 | Host stacks 4 passes on their own song                | 4 is below the smallest margin (5), so from a tie or from behind the passes never make a winner, for every T and V            | `ACCESS_PASS_CAP`                        | `vote-swarm-simulation.spec.ts` (exhaustive)                                | Built; residual from a lead (section 5) |
| RT-AP-12 | Passes used to bury a narrow winner                   | They can turn a win by less than T + 4 into "too close", never into a win for the runner-up                                   | the rule                                 | simulation (exhaustive)                                                     | Residual                                |
| RT-AP-13 | Lift the token from a URL, log, Referer or cookie     | The token rides in the fragment; the page takes it out of the bar, sends it once in a POST body with no cookie and no Referer | `ACCESS_PAGE_SCRIPT`                     | `access-and-online-pick.component.spec.ts`                                  | Built                                   |
| RT-AP-14 | Guess a token                                         | 256 random bits; the redeem route is limited per caller                                                                       | `giveAccessPass`, router                 | by construction                                                             | Built                                   |

### Online Pick

| Id       | Red team                                                             | Blue team                                                                                                                                                                                                                                    | Code                                                     | Test (run)                                                    | Status                        |
| -------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| RT-OP-01 | Use a crowd pass in the Room Pick, or a room pass in the Online Pick | Another prefix, bound into the MAC, and another seal key. Each layer alone holds                                                                                                                                                             | `lib/vote-pass.ts` CROWD channel                         | RT-OP-01; mutant `online-pick-pass-opens-as-room-pass` killed | Built                         |
| RT-OP-02 | A crowd vote that moves the room's counter                           | Separate tables; the T0 gate fails a file that names a crowd table and a room counter                                                                                                                                                        | `lib/vote-crowd.ts`; `votes-never-who.invariant.spec.ts` | RT-OP-02; mutant `online-pick-counts-into-room` killed        | Built                         |
| RT-OP-03 | Vote twice from one browser, or while it is off                      | One receipt per browser per object; `is_on` checked in the batch                                                                                                                                                                             | `castCrowdVote`                                          | RT-OP-03; mutant `online-pick-takes-votes-when-off` killed    | Built                         |
| RT-OP-04 | Keep the Online Pick open after the room closes                      | It is open only while the room set is open                                                                                                                                                                                                   | `CROWD_OPEN_NOW`                                         | RT-OP-04                                                      | Built                         |
| RT-OP-05 | 300 browsers back B online to beat 12 in the room for A              | Room Pick: A. Online Pick: B. The page shows the Room Pick first                                                                                                                                                                             | as above                                                 | RT-OP-05 swarm                                                | Built                         |
| RT-OP-06 | Publish the Online Pick before the room, to steer it                 | Every crowd final statement is guarded by the room set being final                                                                                                                                                                           | `finalizeOnlinePickAndPasses`                            | RT-OP-06; mutant `online-pick-final-before-room` killed       | Built                         |
| RT-OP-07 | The Online Pick page posting into the room                           | The page posts to `/crowd` only and never shows the Access Pass line                                                                                                                                                                         | `vote-page-render.ts`                                    | component spec RT-OP-07                                       | Built                         |
| RT-OP-08 | Clear cookies and vote again online (Sybil)                          | Not stopped, by design: the page says "Anyone can vote here, so this can be gamed." Limited per address. It never changes the Room Pick. The host's flag trips on a minute's burst or on more than twice the room size of voters (F1, SEC-1) | words, route limit                                       | page words checked                                            | Residual (accepted by design) |

### Room Pick

| Id       | Red team                                                    | Blue team                                                                                         | Code                    | Test (run)                                                                  | Status                                                  |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| RT-RP-01 | Flood the vote route from one address                       | **Found in this sweep:** the vote POST had no route limit. Now 600 a minute per caller, then 429  | `router.ts` `vote-cast` | RT-RP-01; mutant `vote-route-unlimited` killed                              | Built                                                   |
| RT-RP-02 | Relay the room's code live to people outside                | The code rotates every minute and the pass lasts 30 minutes                                       | OSE-2234                | in #1562                                                                    | #1562; residual: a live relay still works               |
| RT-RP-03 | Clear cookies, rescan, vote again (device farm in the room) | Each scan needs the current code; the room-size check flags more voters than people               | OSE-2234                | in #1562                                                                    | #1562; residual                                         |
| RT-RP-04 | Stuff "not for me" to sink a song                           | The rule reads up counts only; down counts never decide                                           | `vote-results.ts`       | simulation (5,000 nights, down counts up to 1,000) and the SQL differential | Existing, now proven                                    |
| RT-RP-05 | A scripted swarm of extra up votes                          | From a tie, s extra votes win with chance (#T ≤ s)/5; 9 always win. T alone cannot protect a room | the rule                | simulation                                                                  | Residual: the rotating code and room size are the guard |
| RT-RP-06 | A tiny night decided by a few browsers                      | Nothing is published below V; 14 browsers can decide an empty room                                | the rule                | simulation                                                                  | Residual: the room-size check flags it                  |
| RT-RP-07 | Replay or forge a pass                                      | HMAC seal, one canonical spelling, expiry, epoch, event binding, exact keys                       | `openPass`              | `vote-pass.spec.ts` and RT-OP-01                                            | Existing                                                |
| RT-RP-08 | Read live counts to time a push (side channel)              | No count is shown before final; the answer is the same for a counted or a duplicate vote          | decision 7              | existing specs                                                              | Existing                                                |

### Host, sponsor and platform

| Id        | Red team                                                    | Blue team                                                                                               | Status                                                                       |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| RT-HS-01  | A host voids or reopens to restart a losing night           | Decision 11: the same epoch, T and V on reopen, never after final; void is audited                      | Existing                                                                     |
| RT-HS-02  | A host turns the Online Pick on to muddy a result           | The Room Pick is the official result and is shown first; the switch is audited (`VOTE_ONLINE_PICK_SET`) | Built                                                                        |
| RT-HS-03  | A sponsor asks for online voting in the Room Pick           | Refused by rule (owner, 2026-11-26): the Room Pick stays in the room                                    | Rule                                                                         |
| RT-DOS-01 | Exhaust D1 through the vote, crowd, access and entry routes | Each route has its own per-caller limit and scope, plus the edge layer                                  | Built (route limits); residual: a wide botnet stays under per-address limits |
| RT-SC-01  | A dependency in the vote path                               | No dependency was added; lockfiles pinned                                                               | Existing                                                                     |

---

## 4. STRIDE and LINDDUN coverage

| Element                         | S            | T                | R                                     | I                        | D            | E        | Privacy (LINDDUN)                                                           |
| ------------------------------- | ------------ | ---------------- | ------------------------------------- | ------------------------ | ------------ | -------- | --------------------------------------------------------------------------- |
| Access Pass token               | RT-AP-06, 14 | RT-AP-09         | give and revoke audited, no recipient | RT-AP-01, 13             | RT-AP-14     | RT-AP-05 | No name, no note, no reason (RT-AP-02); the pass id never reaches a log     |
| Vote pass (room, access, crowd) | RT-RP-07     | RT-OP-01         | not needed: a vote is a counter       | RT-RP-08                 | RT-RP-01     | RT-AP-10 | Linking: one key per person per event, under a per-channel label (RT-AP-10) |
| Crowd tables                    | RT-OP-08     | RT-OP-02         | on/off audited                        | results after final only | route limit  | RT-OP-06 | Detecting: receipts and markers are HMACs, deleted at final                 |
| Room tables                     | RT-RP-03     | RT-RP-04         | counters only                         | decision 7               | RT-RP-01     | RT-HS-01 | Never who, only how many                                                    |
| Admin routes                    | Access JWT   | same-origin JSON | audit log                             | brand scope              | admin limits | RT-AP-05 | Audit names no voter                                                        |

---

## 5. What the simulations show

`tests/vote-swarm-simulation.spec.ts` (node project, seeded, run) models the publishing rule. `tests/vote-outcome-differential.spec.ts` (workers pool, run) checks the model against the product's SQL on 60 random nights, for the Room Pick and the Online Pick, with random down counts. Both were seen red on injected faults.

**Access Passes on a song already leading by L** (T is 5 to 9, each equally likely):

| Lead before the passes | Chance 4 passes decide it |
| ---------------------- | ------------------------- |
| 1                      | 1 in 5                    |
| 2                      | 2 in 5                    |
| 3                      | 3 in 5                    |
| 4                      | 4 in 5                    |
| 5                      | 4 in 5                    |
| 6                      | 3 in 5                    |
| 7                      | 2 in 5                    |
| 8                      | 1 in 5                    |

From a tie or from behind, never, for every T, V and room size (checked exhaustively).

**A swarm in a room of 40 with a 55/45 lean**, the attacker backing the trailing song (4,000 nights each):

| Extra votes             | Result changed |
| ----------------------- | -------------- |
| 0                       | 0.0%           |
| 4 (the Access Pass cap) | 29.2%          |
| 10                      | 75.0%          |
| 20                      | 94.8%          |
| 50                      | 95.6%          |

Method: `VOTE_SIM_PRINT=1 npx vitest run --config vitest.node.config.mts tests/vote-swarm-simulation.spec.ts` in `workers/oursharedevents`; the swarm table was also re-derived with a standalone script using the same seed (2026).

What this means: the margin T stops a handful of extra votes from a tie, and nothing more. The real guard against a swarm in the Room Pick is that each vote needs a fresh scan of the room's code in the room (OSE-2234), and the room size the host enters flags a night with more voters than people.

---

## 6. Residuals (true and open)

1. **A live relay of the rotating code** (RT-RP-02) still lets someone outside vote while a friend streams the screen. Accepted in decision 9; the host replaces the code.
2. **Paced script stuffing by people in the room** (RT-RP-03, RT-RP-05) is limited by the rotating code and flagged by room size, not stopped.
3. **Access Passes from a lead** (RT-AP-11): 4 passes decide a lead of 4 or 5 with chance 4 in 5. This is the price of equal weight. A cap that grows with room size would not lower it; a smaller cap would.
4. **Access Passes can bury a narrow win** (RT-AP-12) into "too close". The champion retains.
5. **A tiny night** (RT-RP-06): 14 browsers decide an empty room. The room-size check flags it.
6. **The Online Pick is gameable** (RT-OP-08), by design, and says so.
7. **No count of refused or duplicate crowd votes** is kept for the Online Pick, so a swarm on it is not visible to the host. Detection gap.
8. **A wide botnet** stays under per-address limits (RT-DOS-01). The edge layer is the only other guard; it was not checked here.

---

## 7. Gaps in this review

- Staging was not exercised. Voting is on in staging (#1552) and off in production; nothing in this branch changes either. Every result here is from the container's test rig, so none counts as Done until the staging chain runs after merge (AGENTS.md).
- Bruno folder 32 covers the new routes in both switch positions (26 requests). It was run green on a local worker, not yet on staging.
- The edge rate limits and WAF were not read.
- The host's admin card for giving and revoking passes and for the Online Pick switch is not built; the API is.
- Webkit was not run locally (only Chromium is installed here); CI runs the component step.
- The cookie-setter ceiling for `qr-scan.ts` was raised from 2 to 3 for `/q/crowd`. The cookie stays on `/q`, so AGENTS.md invariant 4 is unchanged in words, but the gate asks for the owner's ruling to raise a ceiling.
