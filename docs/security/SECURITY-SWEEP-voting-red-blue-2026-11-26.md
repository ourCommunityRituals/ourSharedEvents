# CCR v3.0 security sweep: voting red team and blue team (2026-11-26)

**Method note:** loops 1 to 3 are a ccr-security-sweep (STRIDE and LINDDUN, six seats played by one reviewer). Loops 4 and 5 add three scrum-team role agents from `.claude/agents/` (`dr-of-security`, `role-backend-architect`, `role-qa-automation`), each given the diff and no conclusion, read-only, each listing the commands it ran. This is still not a repo CCR worksheet: it does not go in `.claude/outputs/` and it is not a gate result. A score is a signal, never permission; the owner's review and the required checks decide.

**Mode:** 5 loops (Surface, Pressure, Verification against code, Scrum-team review, Confirmation). **Profile:** github-cloudflare plus ocr-ose. **Target:** OSE voting: the Room Pick, the Access Pass and the Online Pick (ADR-040 decisions 5 to 13), branch `claude/project-thread-9tnu7q`, diff `aa681f0...HEAD`. **Scope note:** not comparable with run 1 (2026-11-25, whole hub); this run is one feature, deeper. Loops 1 to 5 share one scope, so their scores compare.

## Verdict: PASS, 98% (for this scope), with four owner decisions open

Every scenario modelled is held by a control, each proven by a test that was seen failing on a planted fault. The one open finding is the owner's ruling on the cookie ceiling (D4). D1 to D3 are choices the build made on the proposal's defaults, and the owner may change them. Nothing here counts as Done until the staging chain runs after merge (AGENTS.md).

## Loop scores

| Loop | Pass                      | Score | What moved it                                                                                                                                                                                                                                                      |
| ---- | ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Surface                   | 71    | [Claude] RT-RP-01 High: the vote POST had no route limit. Give-revoke cycling would beat a live-only cap (design risk). No crowd detection, no staging layer, admin card absent, cookie ceiling                                                                    |
| 2    | Pressure                  | 84    | Route limit built (mutant killed). Cap counts revoked passes, checked in the INSERT (mutants killed). Mutation found one survivor: an equivalent mutant (two layers, each sufficient); rewritten to remove both, now killed                                        |
| 3    | Verification against code | 86    | Model checked against the product's SQL on 60 random nights (both channels). Simulations exhaustive for the cap. Component spec for both new pages. Nothing new found                                                                                              |
| 4    | Scrum-team review         | 34    | [Claude] F1 and F3 were built before this loop. [Agent] no Critical. The three seats raised 1 High, 7 Medium and 8 Low that were new, not duplicates, not pre-existing and not refuted (table below, severities as the seats gave them), plus F2 and F4 still open |
| 5    | Confirmation              | 98    | Every loop-4 finding fixed, or shown to be by design with the reason. Fresh runs: root suite, worker specs, T0 gates, the new mutants killed, Bruno in both switch positions. Only F4 (D4) stays open                                                              |

How the scores are counted: 100, less 10 per High, 5 per Medium and 2 per Low open at the end of the loop. Loop 4: QA-1 (High); QA-2, QA-3, QA-4, QA-5, QA-6, QA-7, BE-M1 and F2 (Medium, 8); BE-L1, BE-L2, BE-L4, SEC-1, SEC-2, SEC-3, SEC-4 and F4 (Low, 8): 100 − 10 − 40 − 16 = 34. Loop 5: F4 only, 100 − 2 = 98. Left out of both: QA-8 (the same as F2), BE-L3 (the same as SEC-4), QA-9 and BE-L5 (pre-existing, not in this diff) and QA-10 (refuted). No base item fails.

## Decisions only the owner can make

- **D1. The Access Pass cap.** Built at 4 (below the smallest margin, so passes never win from a tie). The cost: 4 passes decide a lead of 4 or 5 with chance 4 in 5. Keep 4, lower it, or grow it with room size (growing does not lower that chance).
- **D2. The Access Pass on for every event by default** (built so), or off until a host turns it on.
- **D3. No bot check on the Online Pick** (built so). It is for fun and says it can be gamed. The host now sees a swarm flag (F1, SEC-1).
- **D4. The cookie-setter ceiling for `qr-scan.ts`, 2 to 3**, for `/q/crowd`. The cookie stays on `/q`; the gate asks for your ruling.

## Findings and what happened to them

| Id    | Seat             | Severity | Finding                                                               | Status                                                                                                      |
| ----- | ---------------- | -------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| F1    | [SRE]            | Medium   | A swarm on the Online Pick was invisible to the host                  | Fixed: a per-minute trip on the way in (`VOTE_FLOOD_LIMITER`, key `crowd-flood:<event>`)                    |
| F2    | [Director]       | Medium   | No staging layer for the new routes                                   | Fixed: Bruno folder 32, 26 requests, both switch positions; run green on a local worker, not yet on staging |
| F3    | [Frontend]       | Low      | No admin card for passes or the Online Pick switch                    | Fixed: the card, 2 mobile Playwright tests, both seen red                                                   |
| F4    | [Director]       | Low      | Cookie-setter ceiling raised without the owner's ruling               | **Open: D4**                                                                                                |
| QA-1  | [Agent] QA       | High     | `vitest-pool-triage.json` stale (T0 lint red)                         | Fixed: regenerated, `--check` passes                                                                        |
| QA-3  | [Agent] QA       | Medium   | No test for the no-pepper refusal                                     | Fixed: give and switch both answer 503 with no row written                                                  |
| QA-4  | [Agent] QA       | Medium   | No test for "no vote set", an unknown or bad pass id, a second revoke | Fixed: one table test; seen red with revoke answering ok for an unknown id                                  |
| QA-5  | [Agent] QA       | Medium   | The crowd route's guards untested                                     | Fixed: RT-OP-07; seen red with the same-origin check removed                                                |
| QA-6  | [Agent] QA       | Medium   | No mutant on the redeem and crowd guards                              | Fixed: 3 mutants, all killed                                                                                |
| BE-M1 | [Agent] Backend  | Medium   | The 4 admin routes missing from the router's route list               | Fixed                                                                                                       |
| BE-L1 | [Agent] Backend  | Low      | `/q/crowd` could answer 500 on a crypto or cookie error               | Fixed: any failure sends the browser to the event page with no pass                                         |
| BE-L2 | [Agent] Backend  | Low      | Migration comment said "live passes"                                  | Fixed: "4 passes a set, ever"                                                                               |
| SEC-1 | [Agent] Security | Low      | The alarm saw bursts, not a steady swarm under 300 a minute           | Fixed: more than twice the room size of crowd voters sets the same flag; seen red; mutant killed            |
| SEC-2 | [Agent] Security | Low      | A log line named the event against its comment                        | Fixed: the comment now says the host-only alarm names the event, as the room's flood alarm does             |
| SEC-3 | [Agent] Security | Low      | An event named `online-pick` would collide with the Online Pick page  | Fixed: `online-pick` added to the reserved names in `canonical.ts`                                          |
| SEC-4 | [Agent] Sec + BE | Low      | A vote in flight when its pass is revoked could still count           | Fixed: the revoke is checked inside the receipt INSERT; seen red; mutant killed                             |
| QA-2  | [Agent] QA       | Medium   | No measured shard time for the 3 new specs                            | By design: times are measured from CI runs on `main`; new specs take the median until then                  |
| QA-7  | [Agent] QA       | Medium   | Layer mutants run nightly, not per PR                                 | Pre-existing design; this branch's 23 mutants were run by hand, all killed                                  |
| QA-9  | [Agent] QA       | Low      | A `waitForTimeout(500)` in the admin card spec                        | Pre-existing (2026-11-20), not in this diff; left to its owner                                              |
| QA-10 | [Agent] QA       | Low      | Monte Carlo might be unseeded                                         | Refuted: seeded (`rng(404)`, `rng(2026)`)                                                                   |
| BE-L4 | [Agent] Backend  | Low      | Nightly sweep has `LIMIT 200` with no order                           | By design: every run makes progress                                                                         |
| BE-L5 | [Agent] Backend  | Low      | Event delete does not clear vote rows                                 | Pre-existing posture: the foreign key refuses the delete                                                    |

## Verified against the code (run, in the container)

| Claim                                                | Result    | Evidence                                                                    |
| ---------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| Passes never make a winner from a tie or from behind | Confirmed | `vote-swarm-simulation.spec.ts`, exhaustive over T, V, room 0-60            |
| The SQL decides as the model                         | Confirmed | `vote-outcome-differential.spec.ts`, 60 nights, both channels               |
| Crowd votes never touch room tables                  | Confirmed | RT-OP-02, RT-OP-05 swarm, T0 gate, mutant killed; Bruno 86, 87              |
| A revoked pass stops at once, even mid-flight        | Confirmed | RT-AP-07, SEC-4 test, two mutants killed; Bruno 80                          |
| Every redeem refusal is one answer                   | Confirmed | RT-AP-08; Bruno 80 and 81 compare the bodies byte for byte                  |
| The token never reaches a URL, cookie or Referer     | Confirmed | component spec RT-AP-13                                                     |
| The host card shows no number and the link once      | Confirmed | `tests/playwright/admin-voting-card.spec.ts`, 11 of 11, axe clean at 375 px |
| Layer mutants for decision 13                        | 15 killed | `node scripts/ci/layer-mutation.mjs --layer integration --only …`           |

## Gaps

- Staging is the environment of record and has not run any of this. Voting is on in staging (#1552), so after merge the Bruno folder runs its voting-on half there. Until the staging chain is green for the merge, nothing here is Done.
- Bruno requests were run green against a local worker, in both switch positions. They were not seen failing on a planted fault; their mock-layer twins were.
- Edge rate limits and WAF not read. Webkit not run locally.
- A wide botnet under the per-address limits stays a residual (threat model, section 6); the host now sees it on the Online Pick, and the room check sees it on the Room Pick.
- OSE-2234 controls (rotating code, room size) are cited, not re-reviewed; that thread runs its own loops.

Full red and blue tables: `docs/security/THREAT-MODEL-voting-red-blue-2026-11-26.md`.
