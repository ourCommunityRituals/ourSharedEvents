# CCR v3.0 security sweep: voting red team and blue team (2026-11-26)

**Method note:** this is a ccr-security-sweep report (STRIDE and LINDDUN, six seats played by one reviewer). It is not a repo CCR worksheet: no role agents ran, so it does not go in `.claude/outputs/` and is not a gate result. A repo CCR (`.claude/skills/ccr/SKILL.md`, with `dr-of-security`) is the recommended next step before merge.

**Mode:** 3-loop sweep (Surface, Pressure, Verification against code). **Profile:** github-cloudflare plus ocr-ose. **Target:** OSE voting: the Room Pick, the Access Pass and the Online Pick (ADR-040 decisions 5 to 13), branch `claude/project-thread-9tnu7q`. **Scope note:** not comparable with run 1 (2026-11-25, whole hub); this run is one feature, deeper.

## Verdict: Held, 86%

The vote path holds against every scenario modelled, each control proven by a test that was seen red, but staging has not exercised it, crowd-side detection is missing, and three choices are the owner's.

## Loop scores

| Loop | Pass                      | Score | What moved it                                                                                                                                                                                                               |
| ---- | ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Surface                   | 71    | [Claude] RT-RP-01 High: the vote POST had no route limit. Give-revoke cycling would beat a live-only cap (design risk). No crowd detection, no staging layer, admin card absent, cookie ceiling                             |
| 2    | Pressure                  | 84    | Route limit built (mutant killed). Cap counts revoked passes, checked in the INSERT (mutants killed). Mutation found one survivor: an equivalent mutant (two layers, each sufficient); rewritten to remove both, now killed |
| 3    | Verification against code | 86    | Model checked against the product's SQL on 60 random nights (both channels). Simulations exhaustive for the cap. Component spec for both new pages. Nothing new found                                                       |

Score: 100 − 5 (F1) − 5 (F2) − 2 (F3) − 2 (F4) = 86. No base item fails.

## Decisions only the owner can make

- **D1. The Access Pass cap.** Built at 4 (below the smallest margin, so passes never win from a tie). The cost: 4 passes decide a lead of 4 or 5 with chance 4 in 5. Keep 4, lower it, or grow it with room size (growing does not lower that chance).
- **D2. The Access Pass on for every event by default** (built so), or off until a host turns it on.
- **D3. No bot check on the Online Pick** (built so). It is for fun and says it can be gamed.
- **D4. The cookie-setter ceiling for `qr-scan.ts`, 2 to 3**, for `/q/crowd`. The cookie stays on `/q`; the gate asks for your ruling.

## Findings (open)

| Id  | Seat       | Category             | Severity | Status    | Finding                                                                                                                |
| --- | ---------- | -------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| F1  | [SRE]      | STRIDE R / detection | Medium   | Confirmed | The Online Pick keeps no count of refused or duplicate votes, so a swarm on it is invisible to the host                |
| F2  | [Director] | coverage             | Medium   | Confirmed | No staging layer (Bruno, Playwright on staging) for the new routes; voting is off on staging, so they answer 404 there |
| F3  | [Frontend] | completeness         | Low      | Confirmed | No admin card yet to give or revoke passes or switch the Online Pick; the API is built                                 |
| F4  | [Director] | governance           | Low      | Confirmed | Cookie-setter ceiling raised without the owner's ruling (D4)                                                           |

## Fixed between loops (owner's go: "willing to spend the extra engineering effort")

- RT-RP-01: the vote POST is now limited per caller (600/min, 429), and so are the crowd, access and entry routes.
- RT-AP-03/04: the cap counts every pass ever given, inside the INSERT.
- The equivalent mutant `online-pick-pass-opens-as-room-pass` rewritten to remove both layers.

## Verified against the code (run, in the container)

| Claim                                                | Result          | Evidence                                                         |
| ---------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| Passes never make a winner from a tie or from behind | Confirmed       | `vote-swarm-simulation.spec.ts`, exhaustive over T, V, room 0-60 |
| The SQL decides as the model                         | Confirmed       | `vote-outcome-differential.spec.ts`, 60 nights, both channels    |
| Crowd votes never touch room tables                  | Confirmed       | RT-OP-02, RT-OP-05 swarm, T0 gate, mutant killed                 |
| A revoked pass stops at once                         | Confirmed       | RT-AP-07, mutant killed                                          |
| The token never reaches a URL, cookie or Referer     | Confirmed       | component spec RT-AP-13                                          |
| 10 new integration mutants                           | 10 of 10 killed | `layer-mutation.mjs --layer integration`                         |

## Gaps

- Staging not exercised (voting off everywhere); nothing here counts as Done.
- Edge rate limits and WAF not read.
- Webkit not run locally.
- The full worker suite was run in the container; see the PR for its result.
- OSE-2234 controls (rotating code, room size) are cited, not re-reviewed.

Full red and blue tables: `docs/security/THREAT-MODEL-voting-red-blue-2026-11-26.md`.
