# Loop 5 (Recursive): Lead Backend Architect lens, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

**Setup.**

- Subject hash: `sha256sum` printed dd9b8522…b7f4. It matches.
- Worktree `ose-clock-gate` is at e7c8297b. `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` is empty.
- Paths are under `workers/oursharedevents/` unless they start with another folder.
- Basis tags: proven, arithmetic, source-read, inferred. "Model" means an in-memory `node:sqlite` run, not D1.
- No score and no gate decision.

## 1. High stability table

| Row   | Claim re-checked at the baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Verdict                                                                                | Basis                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| R1-10 | Both rows of a scan go in one `DB.batch`, placement row first, `INSERT OR IGNORE` (`src/lib/scan-buffer.ts:101-137`; direct path `:158`; consumer `:172-179`). Both tables are rowid tables (`migrations/0062:11-37`). The 0101 UNIQUE index drops a second-poster WHO row (`0101:31-32`). `created_at` is the hour on both tables (`hourStamp`, `:91-93`), so order is the only per-scan join key. "Exact where per-(event, hour) counts match" holds for SQLite: in the model an ignored insert takes no rowid, and rowid order survives a delete plus VACUUM. **The four loops got one line wrong:** loop 4's register basis is plain "proven". The rank join is proven on SQLite only. On D1 it rests on four facts nobody has checked: a batch is one serialized transaction, rowids are max+1, `SELECT rowid` is allowed, and export order is rowid order.                                                                                                                                                                      | STABLE in claim and tier; **basis REVISED** to "proven on a SQLite model; D1 inferred" | model, source-read                                    |
| R1-16 | The INSERT has no upper bound on hour (`src/lib/shared-report.ts:878-907`). The map reads stored cells summed over all hours, with exact `data-count` (`src/lib/shared-report-builder.ts:836-849`; `src/lib/corridor-map.ts:110-112`). Live `poster_attribution` reads raw rows per request (`builder:721-744`). This run's model used the code's own SQL: 8 scans in hour 02, a=5 before the snapshot, b=2 after it. Reading back gives live 15, cell 13, difference 2. **What the loops got wrong:** loops 2 and 3 wrote "l − s = b exactly". That holds only while every hour after the snapshot is still under 5 when it is read. In the model, hour 04 at 6 scans gives a difference of 8, which hides b. A window where the difference is exact always exists: from 04:00 until hour 04 reaches 5 scans, and under S4 at least 04:15 to 05:15. The conditional ruling is broken (section 3, section 9).                                                                                                                         | Claim STABLE (wording REVISED); High STABLE pending a valid condition                  | model, arithmetic, source-read; snapshot lag inferred |
| R1-07 | Marker `get`/`put` at `src/handlers/qr-scan.ts:178-187`. If `put` is dropped, every repeat scan counts. Read against the S2 staging step (subject :252-256): the D1 control rises either way, and K1 − K0 then contains nothing, so the step stays green. AC1 still catches a never-called `put` at the mock layer. **Basis correction:** "proven" covered only the grep. That the staging step would pass on the fault is a reading of plan text for a step that does not exist yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | STABLE; basis REVISED to "source-read (plan) plus grep"                                | source-read                                           |
| R1-08 | `qr-scan.ts:179` today uses `scanKey ?? anonId`, so this does not happen on main. S2 AC2 and AC3 write the fail-open into the spec. **Wrong in loop 3 and the register:** "no log line for a short `RATE_LIMIT_KEY_PEPPER`". `/q` goes through `publicCountLimited`, then `isPublicReadLimited`, `checkRateLimit`, `rateLimitKvKey` and `pepperedKeyHash` (`src/router.ts:596-598`; `src/lib/public-read-limit.ts:147`; `src/lib/rate-limit.ts:202`). That last function logs `RATE_LIMIT_PEPPER_MISSING` once per isolate (`rate-limit.ts:122-131`). So a signal exists on the same request. There is no alert, no criterion, and the line does not say dedup is off. **Reach is narrower than "operator error":** both deploy gates refuse a missing name. Production requires both peppers (`.github/workflows/oursharedevents-ci.yml:2664`), and staging refuses `ANON_ID_HASH_PEPPER` after S2 AC5. What remains is a value under 32 characters put directly, or a secret deleted between deploys (platform behaviour inferred). | Tier STABLE (High, lower confidence; Medium is defensible); evidence REVISED           | source-read                                           |
| R1-01 | Key shape is `scan:dedup:{id}:{pd}:{hour}` (`scan-buffer.ts:72-74`), with `expirationTtl: 3600` (`qr-scan.ts:185`). That the listing returns `expiration` is a typings and emulator fact only. **One line to correct (Security's custody leg):** a deploy-token holder "reads" the pepper. Secret values cannot be read back, as CI's own text says (`ci.yml:1261`, "wrangler cannot read values"). The holder gets the pepper by deploying code that reads `env`. That is a write action (inferred).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | STABLE; custody wording REVISED ("obtains by deploying code")                          | source-read; platform inferred                        |
| R3-03 | `scripts/set-secrets.sh:71-83, 100-121`: it asks for and puts every name, needs 32+ characters, and has no skip. An empty Enter loops forever, and Ctrl-C at the first prompt stops before any put. **Missing qualifier:** a re-run destroys data only where the pasted value differs from the current one. Values cannot be read back, so it destroys unless the owner kept the originals (owner fact). The staging refusal text still sends the owner there: "Provision it: bash scripts/set-secrets.sh staging" (`ci.yml:1257`, `:1267`). S2 AC5 turns that warning into a refusal and does not change the remedy text. On current data the damage looks recoverable (staging data is synthetic, and production forms were empty on 2026-10-07; inferred). That is the environment modifier at scoring, as loop 3 said. The FORMS_HASH_PEPPER effects also appear in R4-03; count them once.                                                                                                                                       | STABLE (qualifier added)                                                               | source-read                                           |

## 2. My own errors across four loops

| Loop | Claim                                                                                             | What was wrong                                                                                                                                                                                                                                                                                     | Correct statement                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | L1-BE-2 (High): S7's stamp fails "the clock gate"                                                 | I read the gate from #1069's spec in the worktree. That spec was absent at 39a63d67 (loop-4 0 g).                                                                                                                                                                                                  | The defect depends on the gate landing, which happened after the freeze (#1069). It is now R1-20, Medium.                                                                                                 |
| 1    | Assumption 5: "S14 limits a compromised step. FALSE"                                              | The table tagged it inferred, but the list stated it as fact.                                                                                                                                                                                                                                      | It was inferred in loop 1. The token's reach was proven in loop 3. Its scope is still unread.                                                                                                             |
| 1    | L1-BE-10: S6 "linked is near certain"                                                             | Tagged correctly as inferred, but never qualified for D1.                                                                                                                                                                                                                                          | Proven on a model, inferred for D1.                                                                                                                                                                       |
| 2    | R1-10: "rowid is queryable ... so measuring D1 order adds nothing; drop the spike's staging read" | Too strong. D1's rowid behaviour under export, restore and maintenance is not proven.                                                                                                                                                                                                              | A staging read has value only if redesigned: at least 2 posters interleaved in one hour, with known ground truth. As written it reads rank 1 against rank 1 and cannot tell the cases apart.              |
| 2    | R1-10: "12/12 is an upper bound"                                                                  | It understated the attack. I corrected this in loop 3.                                                                                                                                                                                                                                             | Exact wherever counts match. **Attribution:** the "at most 4 candidates" model was the Data Scientist's (the `MERGED-loop2.md:41` row), not my report. My loop-3 note credited it to "loop 2" as a whole. |
| 2    | L2-BE-1 (R2-03): S2's new pepper causes double counting at rotation                               | I framed it as created by S2. On main the marker key is `scanKey` (`qr-scan.ts:179`). Rotating `ANON_ID_HASH_PEPPER` changes every key (`src/lib/scan-node-key.ts:39-41`), so a rotation mid-hour already double-counts, and the WHO unique index does not catch it.                               | R2-03 is **M+S**. The register lists it among the 11 created by shipping, which is wrong.                                                                                                                 |
| 2, 3 | R1-16: "l − s = b exactly"                                                                        | Only while hours after the snapshot are under 5 (model).                                                                                                                                                                                                                                           | Exact inside a window that always exists (section 1).                                                                                                                                                     |
| 3    | R1-08: "no log for a short `RATE_LIMIT_KEY_PEPPER`"                                               | Wrong (section 1).                                                                                                                                                                                                                                                                                 | A log line exists once per isolate. There is no alert and no criterion.                                                                                                                                   |
| 3    | R1-10: "A D1 batch is one transaction", stated with no basis tag                                  | That is a platform document plus the code comment at `scan-buffer.ts:163-164`.                                                                                                                                                                                                                     | Inferred for D1. It matters: exact alignment under concurrency depends on it.                                                                                                                             |
| 3    | "Proven": rank join exact, ignored insert takes no rowid, rowid queryable                         | Proven on `node:sqlite` only.                                                                                                                                                                                                                                                                      | **Every proven claim I made in loop 3 rests on the SQLite model, not D1.** The SQL meaning is the same engine. D1's batching, rowid and export behaviour are inferred.                                    |
| 3    | R1-16 mechanism; I silently accepted loop-3 ruling 2.3                                            | I missed that `computed_at` is set at `shared-report.ts:726-728`, before the bucket loop (`:764-798`) and before the INSERT's read (`:878-907`).                                                                                                                                                   | The `computed_at` condition cannot measure the snapshot (section 9).                                                                                                                                      |
| 3    | L3-BE-1 (R3-01) Medium, "proven in model"                                                         | The model proved the mechanism, not that it can happen. I did not read `src/lib/erasure-anon-lookup.ts`.                                                                                                                                                                                           | Unreachable on current data. Low, as loop 4 ruled.                                                                                                                                                        |
| 4    | "(loop 3, proven at SQL level)" for R1-16                                                         | Too strong. Loop 3 had my arithmetic plus the FE lens's in-memory replay.                                                                                                                                                                                                                          | SQL proven on a model (re-run this loop); lag and reach inferred.                                                                                                                                         |
| 4    | L4-BA-2: R4-01 is Medium because "Phase 4/5 events cannot exist"                                  | The heading does scope it to "(Phase 5 events)" (`src/handlers/privacy.ts:118`). But the body states rules for any event a child attends ("A parent or guardian must submit any form"; "do not knowingly collect ... without verifiable parental consent", `:120-122`), and nothing enforces them. | I withdraw my Medium. **High** stands.                                                                                                                                                                    |
| 4    | "ADR-020's premise is false"                                                                      | ADR-020 has a reconciliation note at `:205-212`. I did not read to the end.                                                                                                                                                                                                                        | The drift is in ADR-014 (R3-08).                                                                                                                                                                          |

## 3. Conditional rulings

- **R1-16 (mine).** Condition: "Medium if staging `computed_at` sits within seconds of 03:00 over 7 nights."
  - **It is the wrong measurement.**
    - `computed_at` is `nowIso`, from `Date.now()` at `shared-report.ts:726-728`, taken before:
      - the UPDATE (`:734`);
      - the bucket SELECT (`:740`);
      - one awaited write per bucket over 90 days (`:764-798`);
      - the uncelled COUNT (`:850`).
    - Only after all of those does the INSERT…SELECT read the scans (`:878-907`). So `computed_at` records when the cron started, which will nearly always be near 03:00 whatever the lag.
    - Nine jobs also run at once on one D1 (`src/index.ts:146-158`), so contention adds lag (inferred).
    - Staging volume understates production's bucket count.
  - **The right condition:** the snapshot instant must be within seconds of 03:00 at production-like volume.
    - Upper bound: `computed_at` plus the `scan_aggregation` phase `duration_ms` in the `SHARED_REPORT_MATERIALIZE_COMPLETE` log (`src/handlers/shared-report-materialize.ts:105-119`; owner read 4).
    - Or: bucket count times a measured write latency.
  - **Split:** the repo settles that the old test is invalid (source-read). Only the owner can settle the lag.
  - The accuracy half stays at least Medium either way: a partial hour shown for 24 h, and a "sealed" cell that moves on the next rebuild.
- **R2-02 trigger 2** ("a surface shows the bit per hour without injection"). Partly settled from source for the map:
  - The map's reader has no hour predicate (`builder:836-842`).
  - Stored cells change only at the 03:00 rebuild, which has no other trigger.
  - So the map gives one bit per event per night.
  - Under S4 there is one more transition at 04:15, for the first seconds of hour 03 only.
  - Not met on the map. I did not check the other surfaces.
  - Trigger 1 (one door equals one person) is for the owner.
- **R4-01 / COPPA.** The condition is the protocol's own text (`ccr-protocol.md:1432`), so it is the right one.
  - **Settled from the repo:**
    - There is no age-determination mechanism (grep over `src`).
    - The child form notice renders only at tier 5 or above (`src/handlers/form-pages.ts:149-151`), which cannot be reached.
    - Registration collects a name and email at every tier.
    - So "without a verified prevention mechanism" is true.
    - Youth event _types_ are described as gated by phase (`src/handlers/briefing.ts:122-125`). I did not trace the gating code.
  - **Owner only:** whether children under 13 attending general events and submitting forms is "reasonably possible". That is a deployment fact, and the legal reading is inferred.
- **R1-23.** Not my lens.
  - Trigger (b), a green `T1 Deploy → Production` after 2026-10-20T14:07:30Z, can be settled read-only with `gh run list` without the owner. I did not run it.
  - Trigger (a) and the scope need the owner's dashboard.

## 4. Subject-created versus found on main (my lens)

| Row                                                                  | M (main at 39a63d67)           | S (after shipping)                                      | Correction?                                                                       |
| -------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| R1-01                                                                | yes (name pairing and expiry)  | yes (expiry, rank and pepper-holder legs survive S2)    | none                                                                              |
| R1-07                                                                | no                             | yes (S2's staging control)                              | none                                                                              |
| R1-08                                                                | no (`?? anonId`)               | yes (S2 AC2 and AC3)                                    | none                                                                              |
| R1-10                                                                | yes                            | yes (S6 only measures)                                  | none                                                                              |
| R1-16                                                                | yes                            | yes, worse (S4 calls the stale cell sealed)             | none                                                                              |
| R3-03                                                                | yes (the script)               | yes (E6 adds a name; S2 AC5's refusal names the script) | none                                                                              |
| **R2-03**                                                            | **yes** (ANON pepper rotation) | yes (adds the RATE_LIMIT pepper)                        | **from "created" to M+S**                                                         |
| R3-01, R3-02, R2-18, R4-05, R4-14, R1-41                             | yes                            | left as is                                              | none                                                                              |
| R1-15, R1-20, R1-21, R1-26, R1-27, R1-32, R1-39, R1-40, R2-24, R2-25 | no                             | yes (plan, criteria or bump)                            | none (R1-21's derivable second also sits on main, but its root is S7's inventory) |
| R4-01                                                                | yes                            | left (S15 edits the page)                               | none                                                                              |

## 5. The post-freeze fix (#1073, R1-04, OSE-1787)

The options:

- **(a)** Score at the baseline and record #1073 as an environment fact.
- **(b)** Credit the fix.
- **(c)** Score the subject's own defect (S15's claim, and its file set that omits `pages.ts`) at full weight, and record the label's harm as closed on main.

**Recommendation: (a), read as (c).**

- The subject is frozen. S15's omission is a planning defect that #1073 does not repair.
- #1073's own body concedes "Fewer than 5 Walked in" is not literally true in the old held case (SM).
- Apply the same rule to #1069 (the clock gate: R1-19 and R1-20 judged at the baseline) and #1076.
- OSE-1787 stays out of scope only if the owner confirms RC-01 in writing.

## 6. Systemic promotion and cluster multipliers

**Is "a criterion that cannot fail its own regression" one root or several?** Two roots and a remainder.

- **(i) One subject root.** C.0 concedes staging steps "cannot be born red against a branch", and the ACs assert the positive path with no paired fault at the same layer. These rows would collapse into it, from my lens: R1-07, R1-14, R1-15, R1-27, R1-39, R1-40, R2-12. Other lenses own R2-11, R2-13, R2-14, R2-22, R3-05, R3-11, R4-06, R4-07, R4-12 and R1-46.
- **(ii) A main-side pattern: gates that check presence, not efficacy.** R1-41, R2-15, R2-17, R3-06, R3-08 and R4-02. That is at least 3, so it is its own H4 candidate, not the subject's test design.
- **(iii) Rows with an independent harm must not collapse:** R1-01, R1-10, R1-16 (their non-failing criterion is a secondary leg), R1-08 (the AC asserts the bug), R1-23, R2-25.
- **How to apply H4:** promote root (i) one tier, from its highest member (R1-07, High) to Critical, and count it once, replacing the collapsed rows. Do not also compound those rows in C3. Collapsing raises the score relative to counting rows one by one. The scorer must state that.

**Cluster multipliers:**

- **C1 hold 1.5.** The gain holds through R1-10 plus R4-05 (placement and hour in FORMS_DB) even without the inferred KV-expiry fact. 2.0 only on R1-23's scope.
- **C2 lower.** H2 needs one finding to enable or amplify another (`ccr-protocol.md:472`). A shared vocabulary is not that, and the attacker test failed.
- **C3 hold 2.0.** R1-07 removes the detector for R1-08 and R2-03. R2-03 being on main keeps the causal link.
- **C5 and C6:** not my lens. For C5, note that H2's test is causal, not "reads as bad faith".

## 7. Per-loop score derivation

Loop 4's method (rows open at the end of loop N, at base weight, with modifiers applied once at the discovery loop) is faithful to the owner's model, with three amendments:

1. **Use each row's severity as known at the end of that loop.** A re-rate takes effect from the loop that made it (R1-16 High from loop 2; R3-01 Low from loop 4). Applying final severities backwards scores earlier loops on knowledge they did not have.
2. **H1 defines constants only for loops 1 to 3** (`ccr-protocol.md:463-465`). Loop-4 and loop-5 discoveries have no constant. Inventing 1.75 or 2.0 is a protocol change, so the scorer must state one, preferably the defined maximum of 1.5, as an owner question.
3. **Rule 3.3 (penalty for not correcting) does not apply.** The run model forbade fixes, and 3.3's premise is "choosing not to fix" (`:593`).

With nothing fixed, rows only accumulate, so loop 5 is the worst loop and the cumulative score equals it, as the checker needs. H4 and the C multipliers apply from the loop where each reached its threshold. The Tier-1 cap of 70 applies from the loop that identified it.

## 8. Convergence

- In my lens, new roots fell from 14 lens ids in loop 1 to 4, then 3, then 3. Loop 4 read a different body of documents. Loop 5 adds one row, against the run's conduct, and none against the subject.
- No High changed tier in loops 3 to 5.
- R1-08's evidence and R1-16's arithmetic were narrowed. R2-03's classification moved.
- R1-16 is the one High still unsettled: its deciding condition was invalid and must be restated before it can be lowered.
- My lens is stable enough to score once the basis tags are corrected (R1-10, R1-16, R1-07: "model; D1 inferred" and "plan source-read").

## 9. New findings

**RC-04 (against the run's conduct).**

- **Claim:** loop-3 ruling 2.3, carried into loop 4 §6 item 3 and this brief, lowers R1-16 on a reading that cannot see the variable it tests.
- **Mechanism:** `computed_at` is set from `Date.now()` before the per-bucket loop and before the INSERT…SELECT reads the scans (`shared-report.ts:726-728` against `:764-798` and `:878-907`).
- **Rule:** born red, "a gate that cannot fail counts as absent", applied to the run's own test.
- **Lens tier:** Medium (it would wrongly lower a High).
- **Basis:** source-read; no runtime.
- **Closed when:** the condition is restated against the snapshot instant (section 3), read on production-like volume.
- **Why no loop saw it:** loop 3 sized the loop, but no one opened where the timestamp is set.

## 10. Not checked

- Any D1, KV or Queues runtime behaviour (no network): batch atomicity, rowid assignment, export order, list `expiration`.
- The real snapshot lag.
- Surfaces other than the map for R2-02 trigger 2.
- The phase-gating code for youth event types.
- R1-23's scope, and the `gh` read for trigger (b).
- Clusters C5 and C6 in depth.
- The other lenses' rows in the collapse list (I named them, I did not re-verify them).
- I ran no repository tests.

## 11. Commands run

All read-only; none refused; no file written.

- **Read:** the loop-5 brief; `.claude/skills/backend-architect.knowledge.md`; `loop4/MERGED-loop4.md` (in full); my reports for loops 1 to 4 (in full); `loop3/MERGED-loop3.md` (lines 14-61 and 195-254); the subject (lines 215-324); `.claude/skills/ccr-protocol.md` (lines 452-531, 585-609, 1748-1777).
- **Bash:**
  - `ls`, `wc -l` and `sha256sum` on the scratchpad.
  - `grep` across the loop reports for "4 candidates", "upper bound", `computed_at` and `nowIso`, and for the BE id mapping.
  - In `ose-clock-gate`: `git rev-parse HEAD` and `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src`.
  - `cat -n`, `sed -n` and `grep` over:
    - `migrations/0062`, `migrations/0101`;
    - `src/lib/scan-buffer.ts`, `shared-report.ts` (700-990), `shared-report-builder.ts` (700-880), `corridor-map.ts`, `scan-node-key.ts`, `rate-limit.ts`, `public-read-limit.ts`;
    - `src/handlers/shared-report-materialize.ts`, `qr-scan.ts`, `privacy.ts` (105-127), `briefing.ts`, `form-pages.ts` (140-152);
    - `src/index.ts` (100-200), `src/router.ts` (586-602 and greps), `wrangler.toml` (cron lines);
    - `scripts/set-secrets.sh` (25-125), `ci.yml` (1250-1270, 2658-2672);
    - the subject's headings and its `set-secrets` mentions;
    - `ls tests/e2e/0-architecture`.
  - `grep` over `ccr-protocol.md` for the modifiers.
  - One `node --no-warnings -` run with an in-memory `node:sqlite` database, fed on stdin, that wrote nothing: a replay of the materializer and live SQL, plus the rowid, ignored-insert and VACUUM checks.
