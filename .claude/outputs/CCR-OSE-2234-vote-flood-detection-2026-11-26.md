# CCR: OSE-2234, flag a flood of vote passes (detection only), 2026-11-26

|                           |                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System score**          | 85% (below the 95% gate)                                                                                                                                                               |
| **Assessment confidence** | High for what the code does (tests run, faults injected); medium for how the binding behaves at 300 a minute on staging (not measured)                                                 |
| **Gate**                  | **Human gate.** The two open findings are owner choices, not code defects (questions below)                                                                                            |
| **Classification**        | Security-relevant feature on the vote path: 3 loops                                                                                                                                    |
| **Team**                  | Dr of Security (loop 1, an independent read-only subagent given the code, not this session's conclusions); Lead BE Architect, Sr Automation QA and Sr Design FE lenses in this session |

## What was reviewed

In scope: `migrations/0122_vote_flood_seen.sql`, `src/lib/vote-flood.ts`, the call in `src/handlers/qr-scan.ts`, the router's `ctx` pass-through, `flood_seen` on the admin `VoteSetView` (`src/lib/vote-sets.ts`), `padded` on the public result (`src/lib/vote-public-result.ts`, `src/lib/vote-page-render.ts`), the host warning (`src/templates/admin.html`), `VOTE_FLOOD_LIMITER` in `wrangler.toml`, the gate rule in `tests/e2e/0-architecture/votes-never-who.invariant.spec.ts`, and the ADR-040 amendment.

Out of scope: the per-song cap (OSE-2126, on hold by the owner's decision), cookie signing, the room vote screen's own design (OSE-2226).

## Loop 1: surface (Dr of Security, read-only)

- **Critical:** the riskiest assumption is that a flag can't carry a voter, a count or a time. Read of the key (`vote-flood:<event id>`), the value (a 0/1 column) and the one log line (`{type, event_id}`): nothing identifying. The public answer carries the flag only on a final, non-void set (`RESULT_SQL` requires `is_final = 1 AND is_void = 0`).
- **Conservative:** worst cases are an attacker who stays under the threshold, an attacker who trips it on purpose, and detection that slows or breaks a vote.
- Findings:
  - **H1 (High, 10): the alarm can't see the attack that decides a night.** A night is decided by a lead of 5 to 9 and 10 to 14 voters (decision 7). 10 to 20 forged passes can swing it, far under 300 a minute, and the binding counts per location.
  - **M1 (Medium, 5): anyone can trip the flag on someone else's night.** With a photo of the code and a script, one address passes 300 a minute. Because the flag is one-way, the public line "may be padded" stays for good, even if the attacker never voted. The first wording also said "votes", but the signal counts scans that minted a pass.
  - **L1 (Low, 2): detection sat on the answer path.** It was awaited before the 302, with no timeout.
  - **L2 (Low, 2): a docs claim said the flood's minute is not kept.** The log host stamps its own time on `VOTE_FLOOD_SEEN`.
  - **L3 (Low, 2): a one-bit hint after final.** The Dr of Security judged it not a participation figure under decision 7 / Q8-2, and not a re-identification path. Accepted.
- Score at loop 1: 100 − 10 − 5 − 2 − 2 − 2 = 79%.

## Loop 2: pressure (reacting to loop 1)

- **L1 fixed:** `/q` hands detection to `ctx.waitUntil` (the router passes `ctx`). Test: a binding that never answers still gets the redirect and its pass. Watched failing first: with the old `await`, the test timed out at 60 s.
- **L2 fixed:** the migration, the lib and the ADR now say the database keeps no time, and that the log line carries the log host's own time.
- **M1 words fixed:** both lines now say "scans", not "votes" or "new voters". The smear risk itself is written into the ADR amendment as an owner choice: keep or drop the public line.
- **H1:** cannot be fixed by tuning. Any threshold low enough to see 10 to 20 passes is below a real room. It is written down in the lib and the ADR ("no flag never means a clean night"), and it goes to the owner.
- Pressure checks, all held:
  - A second isolate past the limit writes once more. The UPDATE is `WHERE flood_seen = 0`, so it is idempotent.
  - A void set: the flag is kept, and no public result is shown (unchanged).
  - Brand scope: the admin read is already scoped by `guardAdminObjectScope`.
  - The namespace ids 15097 and 15098 were already used by `wrangler.client-test.toml` (`tests/unit/ci/client-test-site.test.js` caught it). Moved to 22341 to 22343.
  - `REQUIRED_DB_MIGRATION` was bumped to 122 (`scripts/check-schema-guard.mjs` passes).
- Score at loop 2: 100 − 10 − 5 − 2 (L3 accepted, still counted) = 83%.

## Loop 3: confirmation

- Re-ran, all green:
  - the worker vote specs: 14 files, 290 tests;
  - the full `tests/e2e/0-architecture/`: 433 passed, 2 skipped (pre-existing);
  - `tests/integration` and `tests/unit/ci`: 3,328 passed;
  - the admin Voting card in a phone-width browser: 9 passed.
- **Born red:** each new test was watched failing on an injected fault, then the fault was removed. The faults:
  - no count at `/q`;
  - the write keeps the hour;
  - a reopen clears the flag;
  - "padded" shown before final;
  - the key carries more than the event;
  - no try/catch;
  - no isolate memo;
  - the wrangler limit at 600;
  - detection awaited on the answer path;
  - the gate's `flood_seen` rule removed (its negative controls go red);
  - the admin card never unhides the warning.
- L3 is accepted by the reviewer's own judgement, so it drops to 0. Final: 100 − 10 (H1) − 5 (M1) = **85%**.
- The drop from 100 is the protocol working. H1 and M1 are the owner's to accept or change, not this session's to argue away.

## Findings register

| Id  | Weight | Status      | Note                                                                                                  |
| --- | ------ | ----------- | ----------------------------------------------------------------------------------------------------- |
| H1  | 10     | Open: owner | Detection can't see paced stuffing. Documented.                                                       |
| M1  | 5      | Open: owner | Smear route through the public "may be padded" line. Wording fixed; keep-or-drop is the owner's call. |
| L1  | 2      | Fixed       | waitUntil, with a test                                                                                |
| L2  | 2      | Fixed       | Docs corrected                                                                                        |
| L3  | 2      | Accepted    | One bit after final; not a participation figure                                                       |

## Before shipping

- Owner answers the questions below. The PR is a draft until then.
- After merge: the staging chain T1 to T4 is green for the merge SHA. Bruno `23. Voting admin` list 110 checks `flood_seen: false` on staging.
- The scripted burst on staging (story acceptance) needs `VOTING_ENABLED` on in staging (OSE-2227, the owner's PR). Until then it can't run, and the story stays below Done.

## Human-gate questions

1. **Threshold.** Is 300 passes a minute per event right? It is about twice a whole room arriving at once (S0: 150 in 5 s), and one address at full speed passes it.
2. **The public line.** Keep "A sudden burst of scans of the vote code came in during this vote, so this result may be padded." under the final result? Or show the flag to the host only, given that anyone with a photo of the code can trip it?
3. **Accept H1.** Paced or spread-out stuffing is not flagged; the flag catches only a careless bulk flood. Is that acceptable for "detection only"?
