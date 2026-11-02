# Loop 3 (Adversarial), Sr Data Scientist lens, epic OSE-1766, subject v4 frozen (sha256 dd9b8522...b7f4)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision. Basis tags: proven (command result), arithmetic (in-memory `node -e`), source-read, inferred. Code read in `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` (worktree HEAD `e7c8297b`, `src/` equals main 39a63d67 per the register). Paths are under `workers/oursharedevents/` unless noted.

Scope. I attacked these Highs: R1-02, R1-03, R1-04 (wording half in scope, recovery half OSE-1787/1783), R1-08, R1-10, R1-16, R2-02. I left R1-01 (cluster test only), R1-05, R1-06 (Design and Compliance), R1-07 and R1-09 (QA, SRE), R1-23 and R2-01 (Security, DevOps) to other lenses.

Two corrections to the loop-1 and loop-2 registers that came out of the arithmetic:

- Subject section A and H say the presence bit needs "4 injected scans". R2-02 below gives an organizer the bit with zero injection, so A understates.
- R1-02's differencing needs no injection either, when a second poster clears the floor.

## 1. Attack cards

### Card R1-02: event-hour distinct vs poster-hour cells on the SharedReport (before OSE-1784)

- **Actor:** hostile organizer (also holds the registration list), or a sponsor with a mid-depth report token. Both read `distinct_scanners` and `poster_attribution`, which are both in the mid depth list (`src/lib/report-depth.ts:50-62`, source-read).
- **Goal:** the exact size, 1 to 4, of a poster-hour group the floor withholds. A bonus is a presence bit at a door poster.
- **Steps:**
  1. Place poster P1 (public) and P3 (a private door). Both carry `poster_deployments` rows.
  2. Read the report after the nightly materialization. `distinct_scanners` is `floorTotalOfParts` over `scan_aggregates.distinct_agent_hashes`. That column is `COUNT(DISTINCT COALESCE(anonymous_id, user_agent_hash))` per event-hour, written at `src/lib/shared-report.ts:~740-790`. The builder reads it at `src/lib/shared-report-builder.ts:327-347` (source-read).
  3. `poster_attribution` is a different grain. It is a per-poster sum of poster-hour cells that are at least 5 (`:722-743`), and sub-5 posters are dropped (`:750+`).
  4. Difference: D minus S, where S is the sum of the published poster rows (arithmetic, `node -e`, K=5, drop before sum). The poster-hour cells are (P1,P3):

     | Case                                                           | D   | S   | D−S     |
     | -------------------------------------------------------------- | --- | --- | ------- |
     | (7,3)                                                          | 10  | 7   | 3 exact |
     | (7,1), door scanned once                                       | 8   | 7   | 1       |
     | (7,0), nobody at the door                                      | 7   | 7   | 0       |
     | (5,4), organizer injects 5 cookie-less scans at a decoy poster | 9   | 5   | 4       |
     | door alone with 3 scans and no decoy                           | 0   | 0   | 0       |
     | (7,3) with 1 person at both posters                            | 9   | 7   | 2       |

  5. The residual is a lower bound. A person who scans two posters in one hour counts once in D and twice in the cells. Door posters at different places make that rare, so the organizer treats R as exact.
  6. With the registration list (`source_placement_id` plus the `registration_bucket` hour, `src/handlers/forms.ts:296-302`): 3 named registrants via P3 in hour h, and R=3. That means the three named people are the whole group, nobody else scanned. With 2 registrants and R=3, exactly one unnamed scanner exists. What is new is the count and the "nobody else". Names were already the organizer's. Most of the identification risk is the R=1 door bit with no registration.
- **What it needs:** no injection when any other poster in the same hour clears 5. Otherwise 5 own cookie-less scans at a decoy; each fresh cookie-less request counts as a distinct id. Cost is a few requests.
- **Multi-hour:** the residual is Σ over hours (D_h − S_h). Two hours with withheld cells 3 and 2 give R=5, not separable (arithmetic). So the exact attack needs a single hour, or only one hour with withheld cells.
- **Criterion while it runs:** nothing goes red. S15 AC1/AC2 scan text only, and S4 AC2 bounds `scan_placement_events` and `scan_cell_aggregates`. The writer of `scan_aggregates` is untouched.
- **Success:** the under-5 floor is broken by differencing. Never-who is not broken for a person. The leak is OSE-1784's and is not rated here.
- **Verdict:** works on main. Works after the subject ships. Not blocked by any AC. Wording half, in scope: S15's sentence "We show a scan count only when at least 5 scans were counted at one poster in one hour" is published while this holds, and S15 has no edge to OSE-1784 (E.2).
- **Severity:** High, as the register has it. Loop 4 tests Regulatory. Substance: the data leak itself is Critical.

### Card R1-04 (wording half): the recap's walk-in label

- **Actor:** outsider with a public recap page. Hostile organizer for the stronger variant.
- **Goal:** the number of registered people who checked in, when it is 1 to 4. For a lone registrant, whether they attended.
- **Steps:**
  1. Source-read, `src/handlers/pages.ts:1757-1762`:
     - Walk-ins are floored as a nested pair, `floorNestedCounts([checkins, walkIns])`.
     - The label "Walked in: held, so a group under 5 cannot be worked out" prints exactly when check-ins c is at least 5, walk-ins w is at least 5, and the gap c−w is 1 to 4.
     - At gap 0 the exact walk-in count prints.
  2. I enumerated c and w with the repo's own `floorNestedCounts` logic (arithmetic):

     | c          | Label shows           | Registered check-ins (c−w) |
     | ---------- | --------------------- | -------------------------- |
     | 6          | yes                   | exactly 1                  |
     | 7          | yes                   | 1 or 2                     |
     | 9          | yes                   | 1 to 4                     |
     | 10, 11, 12 | yes                   | 1 to 4                     |
     | any        | no, "Fewer than 5"    | c−w ≥ 5 or w < 5           |
     | any        | no, the number prints | gap 0, or ≥ 5              |

     The label tells a gap of 1 to 4 from gap 0 and from gap 5 or more.

  3. Worked trail (outsider, public pages only). A recurring event series has one registrant Alice, whose employer's name is on the list outsiders know. Walk-ins are at least 5 every event. For each event k the recap shows the label (Alice checked in) or an exact walk-in count equal to c (she did not). That is a per-event attendance bit sequence for a named person from public pages alone. Over 6 events it is a 6-bit habit string.
- **Needs:** a published c of at least 5, w of at least 5, and a known small registered population (1 to 4).
- **Criterion while it runs:** nothing goes red. S15 AC1 scans `never-who.ts`, `privacy.ts` and `docs/`, not `pages.ts`. The label's own words, "so a group under 5 cannot be worked out", remain on the public page.
- **Success:** a group of 1 is recovered (OSE-1783/1787, not rated). In scope: S15's goal "public words say only what holds" is false for this string.
- **Verdict:** works on main. Works after the subject ships. Wording half not blocked: no AC reaches `pages.ts`.
- **Severity:** High, in-scope half, as the register has it. The exact leak is Critical in substance. The cross-event trail is a new, worse use of the same root, so it is not a new row.

### Card R1-10: the cross-event trail from row order (candidate-set arithmetic)

- **Actor 1:** a hostile organizer colluding with an export holder (insider, leaked D1 export, Time Travel copy), who also holds the registration list. The organizer alone has no rowid.
- **Actor 2:** an outsider with only public pages across several events. See the end of this card.
- **Goal:** one named registrant's (cross-event key, poster, hour) trail at other events and other brands.
- **Facts (source-read):**
  - Both scan tables are rowid tables (`migrations/0062_split_scan_path.sql:11-38`). The placement row and the return row of one scan are written by one `DB.batch` in that order (`src/lib/scan-buffer.ts:101-137`, `:158`, `:179`).
  - Both rows carry `scan_bucket`. `created_at` is the hour (`hourStamp`, `scan-buffer.ts:~70-80`), so there is no second-level time.
  - The return key `snk1_` is the same for one browser at every event (`scan-node-key.ts` header; ADR-001:52).
  - Migration 0101 adds a UNIQUE index on (event, anonymous_id, scan_bucket) on `scan_node_returns` and writes `INSERT OR IGNORE`. A browser that scans two posters in one hour is dropped from WHO and kept in WHERE. So within an event-hour, placement rows number k and return rows k−d, d being the duplicates.
  - The `forms` side stores a per-event `evk1_` key (`event-anon-key.ts`), which does not equal the scan key. The join to a name is `source_placement_id` plus the hour.
- **Steps:**
  1. From the registration list, take Alice: registered at E1 via P at hour h.
  2. In the export, within (E1, h), pair placement rank i with return rank i. If d=0 this is exact.
  3. Alice's candidate set is the keys at cell (P,h). If the cell is withheld, n is 1 to 4. With d dropped rows the candidate size is at most d+1 per target, so 1, 2, 3, 4 for d = 0..3 (arithmetic).
  4. Alice registers at a second event E2 via (P2,h2). Intersect the key sets, since `snk1_` is cross-event.
  5. Monte Carlo (arithmetic, in-memory, seeded, 20,000 trials per row). Alice plus (n−1) others drawn from a pool of R regulars shared by all events. Mean candidate-set size and P(exactly Alice):

     | Pool R | Cell n | After 1 event | After 2 events | After 3 events |
     | ------ | ------ | ------------- | -------------- | -------------- |
     | 10     | 4      | 4.00, 0%      | 1.90, 29%      | 1.27, 74%      |
     | 30     | 4      | 4.00, 0%      | 1.30, 72%      | 1.03, 97%      |
     | 200    | 4      | 4.00, 0%      | 1.05, 96%      | 1.00, 100%     |
     | 5000   | 4      | 4.00, 0%      | 1.00, 100%     | 1.00, 100%     |
     | any    | 1      | 1.00, 100%    | 1.00, 100%     | 1.00, 100%     |
     | 10     | 2      | 2.00, 0%      | 1.10, 90%      | 1.01, 99%      |

     A small community (R=10 or 30) narrows more slowly, but two events are usually enough.

  6. With the key, take all rows of that key in `scan_node_returns` (365-day life, ADR-001:52). Pair each by rank to its placement row. That gives (poster, hour) for every event of every brand in the export.
  7. Fallback with no usable rank join (platform reorders, or D1 id reuse): the anonymity set is the whole event-hour. Event-hour N=12 and pool 200: intersection after 2 events 1.61 (arithmetic). N=40: 8.60. So row order is what collapses a large hour to 1 to 4.
- **Criterion while it runs:** nothing goes red. S6 AC2 injects a shared counter column and expects "linked". The baseline is already "linked" on a model (loop 1, proven on SQLite 12 of 12). A predictor that always says "linked" also passes AC2.
- **Success:** never-who at rest is broken, as are place-not-person and OSE-798 rule 6. The floor holds, since no published figure changes.
- **Verdict:** works on main. Works after the subject ships. S6 as written measures and records; the follow-up rebuild has no ticket (B.1/C.6). D1 rowid on the direct path is inferred.
- **Outsider variant, public pages only across several events:** there is no cross-event key in a public page, so there is no trail. What exists is the per-event bits above: the R1-04 label (attendance of a sole registrant) and the R2-02 map state. Across 6 events that is a 6-bit string per recurring poster or registrant, which is the "habit" residual the subject lists as OPEN.
- **Severity:** High, as the register has it. See section 5.

### Card R1-16: stored snapshot vs live read, after S4

- **Actor:** hostile organizer at an evening event (no injection needed if a crowd scans at the hour), or an injector under RA-1.
- **Goal:** a sub-5 slice of a poster-hour, by two published figures of one poster-hour that differ.
- **Steps:**
  1. Source-read, `src/lib/shared-report.ts:~866-905`: the nightly job (cron `0 3 * * *`, `wrangler.toml:105,231,384`, merge-verified in loop 2) runs `DELETE FROM scan_cell_aggregates` then `INSERT`. The INSERT has no upper bound on `scan_bucket`, so it stores the open UTC hour (hour 03) from its first seconds.
  2. A rush at 03:00:00 (a timed organizer, or an event start) puts 5 scans at one poster before the snapshot. The stored cell is 5 and is kept.
  3. Scans continue to 8 by 03:59. The corridor map reads the stored cells (`shared-report-builder.ts:835-845`, rendered with `data-count` in `src/lib/corridor-map.ts:~110`). `poster_attribution` reads raw rows per request (`:722-743`), live.
  4. S4's read-time bound (`sealedBefore`) lets hour 03 appear after 04:15 UTC. The map still shows 5 (stale snapshot) beside the poster row showing 8, until the next 03:00 rebuild moves the cell. The two figures differ by 3, a slice under 5 (arithmetic).
  5. The next-night rebuild also rewrites that published cell from 5 to 8: the same 3, across snapshots.
- **Criterion while it runs:** nothing goes red. S4's staging step seeds stored cells without a materializer run (C.10), so it cannot build the state. S4 AC2 adds a row in an unsealed hour and checks no figure moves; a stale-but-sealed cell passes it.
- **Success:** the under-5 floor is broken by figure-against-figure differencing on the place side.
- **Verdict:** works on main. Works after the subject ships. S4 closes only the minute view. The cron-timed seed of the cell is not touched. C.10's "a cell cannot change after its hour plus the grace" is false for stored cells.
- **Reach:** needs 5 or more scans at one poster in the first seconds after 03:00:00 UTC. How long after 03:00:00 the snapshot runs (nine jobs share the minute) is an open platform fact. Inferred.
- **Severity:** High (raised in loop 2). I keep it.

### Card R2-02: the SharedReport map's none-versus-1-to-4 switch

- **Actor:** hostile organizer at a door (or a sponsor with a report token) at a one-poster or low-volume event.
- **Goal:** whether anyone scanned at all, with no injected scans.
- **Steps:**
  1. Source-read, `src/lib/shared-report-builder.ts:~836-862`: the stored cell rows branch on `cellData.length > 0`. A sub-5 poster-hour is kept as a 0 row (`shared-report.ts:~866-871`).
  2. Nobody scanned: no cell rows, and with an event h3_res7 the report takes the fallback branch, source `fallback`, heading "Neighborhood Preview" (`src/templates/shared-report.html:~1245-1262`). No suppression entry is pushed.
  3. One person scanned: a 0 row exists, so source is `suppressed`, heading "Corridor Scan Map" with "Map hidden to keep things anonymous". The JSON also carries `suppression` field `corridor_map: below_min_sample_size`, so the bit is readable without rendering.
  4. At events where some poster clears 5, the withheld cell is dropped from the map and the bit disappears. It lives only where no poster clears: exactly the low-volume case the epic is about.
- **Needs:** one real scan, a report token, and that the materializer has run. No injection and no insider.
- **Criterion while it runs:** nothing goes red. S4 changes the hour bound on this read, not the branch. S15's sentence "below that it reads 'fewer than 5'" is false for the map.
- **Success:** a presence bit at a chosen location. It is not covered by RA-1 (which needs 5 injected scans and reads a count). It contradicts section A's recipe and H's "needs 4 injected scans". The subject records the bit as OPEN in OSE-1780, but this variant needs no injection.
- **Verdict:** works on main. Works after the subject ships.
- **Severity:** High as registered. Proposed Critical, see section 5.

### Card R1-03: open-hour wording after S4

- **Actor:** hostile organizer, or a sponsor's lawyer.
- **Goal:** two things:
  - First, a false official statement. During the open hour an unsealed hour with many scans reads "Fewer than 5", "Held" or "<5" on 7 or more surfaces.
  - Second, whether the seal transition leaks a small group.
- **Steps:**
  1. Seed an open hour with 80 scans. Surfaces from the register: `live-monitor.ts:124-125, 143-144`; `admin.html:4944-4950, 6864, 8161, 8367, 8447`; `sponsor-home-render.ts:115-117, 133-134`.
  2. The reader sees withheld words for 1 h 15 min (S4 AC4 vs AC5 disagree on the lag), then an exact 80.
  3. Information test: a withheld value read after H+1h+G means below 5. A withheld value read inside the open hour means "unknown". A reader who does not know the clock learns nothing. A reader who does cannot tell more than before S4. No small group leaks (arithmetic and source-read).
- **Success:** a false statement, not an identification. The floor in letter holds. In meaning it breaks. S15 then states publicly that this is what below 5 means.
- **Criterion while it runs:** nothing goes red. AC4/AC5 cover 2 surfaces of 8 or more.
- **Verdict:** works after the subject ships. Not reachable on main, since S4 creates it.
- **Severity:** High on false public statement, as the register has it. The privacy-exposure criterion is not met.

### Card R1-08: scans are not people, dedup off by misconfiguration

- **Actor:** one visitor (or the organizer) after an operator mis-sets a pepper.
- **Goal:** a published "5" from one person.
- **Steps:**
  1. Source-read: S2 AC3 says that with `RATE_LIMIT_KEY_PEPPER` missing or under 32 characters no marker is written and the scan is counted. Today the marker is written whether or not that pepper exists (`qr-scan.ts:177-187`; `rate-limit.ts:~109-135` only warns and falls back to unpeppered SHA-256 for other keys).
  2. An owner runs `wrangler secret put` with a short value. `set-secrets.sh`'s 32-character check is skipped, and both deploy gates check names only (`ci.yml:~1255-1267`, `:2663`).
  3. One cookie scans one poster 5 times. The /q per-address allowance is 360 per minute (`public-read-limit.ts:~53`), so 5 scans take about a second.
  4. The cell is 5 and is published. Mid-depth sponsors read "People scanning" (`admin.html:8175-8178`).
- **Success:** a false published figure from one person (poisoning). `scan-cells.ts:11-14` ("K scans = K people") is false.
- **Criterion while it runs:** nothing goes red. S2 AC2 and AC3 assert the fail-open as intended, and the mock layer never runs the short-pepper path (R2-12).
- **Verdict:** works after the subject ships (S2 adds the path). Not reachable on main via this pepper. Cookie-less padding already works on main and is OSE-1780's.
- **Severity:** High, as the register has it.

## 2. Attacks on the subject's own controls

Each injected fault below leaves the named criterion green.

1. **S4 AC2** (adding a row in an unsealed hour changes nothing).
   - Fault: bound every reader correctly, but leave the nightly stored snapshot of the open hour as it is.
   - Result: AC2 stays green, because it tests rows in a future hour. R1-16's 5-versus-8 survives (card above).
   - Also, a lone row is withheld with or without the bound unless the cell sits at 4, so per-reader faults are equivalent mutants.
2. **S6 AC2** (an injected shared column must read "linked").
   - Fault: a predictor that returns "linked" for any input.
   - Result: AC2 is green. The baseline is already linked on the model.
   - The criterion has no control that can read "not linked", for example shuffled WHO insertion order. The staging step has no pass or fail. Recorded outcome "negative" is unreachable.
3. **S15 AC1 and AC2** (banned phrases absent, non-promise sentence present).
   - Fault: ship all the words while R1-02's differencing and R1-04's label stay live.
   - Result: green. The text is pinned, not its truth.
   - Also a green test for `pages.ts:1762` "so a group under 5 cannot be worked out", since `pages.ts` is not scanned.
4. **S16 AC2** (the ADR sentence about the presence bit exists).
   - Fault: ADR-025 states "with 4 injected scans the figure is withheld exactly when no real scan occurred".
   - Result: green, and the sentence is incomplete. R2-02 shows the bit with no injection. The test pins words.
5. **S2 AC1** (marker key equals an independently computed hash).
   - Fault: key is correct but built from `RATE_LIMIT_KEY_PEPPER`, which rotates on exposure (R2-03).
   - Result: m1 to m4 green. People are counted again after a rotation (3 people × 2 = 6 publishes).

## 3. Cluster tests

- **C1 (scan order as a join key): combining R1-01 and R1-10 gives more.**
  - KV listing is inferred to return an expiry (unsettled). Expiry order equals scan time equals rowid order.
  - After S2 the marker key is a peppered hash. Pairing the k-th marker by expiry with the k-th placement row gives (poster, second) per scan without the pepper. That defeats S3's "no clock finer than the hour" for placements.
  - Rank-join with the return table adds the browser key (card R1-10). With `source_placement_id` plus hour it adds a name.
  - So combined: (browser, poster, second), then a name. Either alone gives less.
- **C2 (withheld vocabulary): R1-03 + R1-13 + R2-02.**
  - Combining the map state ("suppressed") with the figure's words ("Fewer than 5") gives the presence bit, which R2-02 gives alone.
  - The words add no information for an attacker. For defenders they mislead: an open-hour 80 reads as "Fewer than 5", and 4 poster-hours of 3 read the same as 1.
  - So combining gives no more to an attacker. The cluster is a false-statement cluster.
- **C3 (scans are not people): R1-07 + R1-08 + R2-03 (+ R2-06).**
  - Worked: dedup off (R1-08) puts 5 scans from one cookie at one poster-hour, published as "5". After a pepper rotation (R2-03) 3 people count 6. The label says "People scanning" (R2-06 lower bound).
  - R1-07 means none of these is detected on staging. Combined, the organizer can publish a false figure with no cost and no alert. This is more than any one alone.
  - It also makes the R1-02 residual arbitrary. With dedup off and one cookie, D counts 1 while the cell counts 5.
- **C5 (privacy notice):** combining R1-02 (public sentence false for who-side figures), R1-04 (label), R1-05 and R1-06 gives a complainant a page with four false claims. That is more than any one alone for a regulator. This is Compliance's loop.
- **C6 (staging evidence):** no combination gives more data exposure. S4's step has a static seed and cannot build R1-16's state. R2-01's concurrent deploy could turn it falsely green. Combined, T4 is green on a state that does not have the stale-cell shape.

## 4. New findings table

None. I checked each candidate root cause against R1/R2 and found it already a row:

- D−S residual: R1-02, out of scope (OSE-1784).
- The 0101 UNIQUE drop and rank drift: part of R1-10's measurement.
- The `suppression` JSON entry that carries the R2-02 bit: R2-02.
- The attendance-habit trail from the label: the same root as R1-04 (OSE-1783/1787); recorded once, not rated.

Out-of-scope records, never rated: injected-scan presence bit and padding (OSE-1780); D−S who-side exact recovery and the recap's exact recovery (OSE-1783/1784/1787); forged cookies (OSE-1496).

## 5. Re-rates with reasons

| Row   | Proposal                                            | Reason                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-02 | High to Critical (proposed)                         | No injection, no insider, no count. The bit is available at a person's door (D5 memo section 0 item 1: "at a door that bit is the identification"). The subject's A and H claim 4 injected scans are needed, and that is false for this branch. It sits in a read S4 edits. Counter: the bit is event-level, read by a report token, and the code chose the state on purpose. Lead decides. |
| R1-10 | Keep High; Critical if an export holder is in scope | The exact join over all brands and all events, with a name via `source_placement_id` and hour, is the worst re-identification I could build. It needs an export holder, who is an insider or a leaked copy, so I keep High as the register does.                                                                                                                                            |
| R1-02 | Keep High                                           | The leak is OSE-1784's. The in-scope false-notice half supports the Regulatory test in loop 4.                                                                                                                                                                                                                                                                                              |
| R1-04 | Keep High (in-scope half)                           | The cross-event attendance trail strengthens the substance (Critical, OSE-1783/1787).                                                                                                                                                                                                                                                                                                       |
| R1-16 | Keep High                                           | S4 does not close it.                                                                                                                                                                                                                                                                                                                                                                       |
| R1-08 | Keep High                                           | Floor in letter, not in meaning.                                                                                                                                                                                                                                                                                                                                                            |
| R1-03 | Keep High, on false statement only                  | The privacy-exposure criterion is not met.                                                                                                                                                                                                                                                                                                                                                  |

## 6. Not checked, and why

- **Platform facts not settled.** I have no network or platform access and may not infer them as true.
  - KV listing expiry: settle by an owner-terminal read-only `wrangler kv key list --binding RATE_LIMIT_KV --env staging --remote` and inspect the output for an `expiration` field.
  - Workers Logs for `/q`: read the log schema in the dashboard (F-15).
  - Dead-letter queue retention: `wrangler queues info ose-scans-dlq` or the dashboard.
  - Staging token scope and the secret level of `CLOUDFLARE_API_TOKEN_OSE`: `gh secret list` and environment secret list show names and levels, not values. I did not run them (outside my lens).
  - Production migration level (77 vs 104): an owner read-only `wrangler d1 migrations list --env production --remote`. I did not run it.
- D1 rowid assignment and queue order on the live platform: only the SQLite model (loop 1, proven by another lens) and source order. Inferred for D1.
- How long after 03:00:00 UTC the snapshot runs (R1-16 reach).
- I did not run any spec. Counts, rates and overlaps are arithmetic on the repo's own `floorTotalOfParts`, `applyCountFloor` and `floorNestedCounts` logic, re-implemented in-memory. I did not call the real code.
- `shared-report-export.ts` and the SharedReport read of `return_rate` are out of scope (OSE-1784).
- The registration `source_placement_id` is client-carried via `?deployment=`; whether the form validates it against real deployments was not read.

## 7. Commands run (all read-only; none was refused)

- Read tool: the brief, the frozen subject (three reads, lines 1-669), the loop-1 register, the loop-2 register.
- Bash (read-only, in `ose-clock-gate/workers/oursharedevents`):
  - `git log --oneline -1`.
  - `cat` of `src/lib/scan-cells.ts`, `sed -n` of `src/lib/count-floor.ts` 1-140.
  - `sed -n` of `src/lib/shared-report-builder.ts` 320-370, 495-560, 715-775, 825-1000.
  - `sed -n` of `src/lib/shared-report.ts` 205-300, 300-420, 690-830, 840-912.
  - `sed -n` of `src/lib/scan-buffer.ts` 20-200 (twice), `src/handlers/qr-scan.ts` 120-270.
  - `grep -rn scan_aggregates src`.
  - `sed -n` of `src/handlers/pages.ts` 1735-1775, `src/lib/corridor-map.ts` 100-125, `src/lib/report-depth.ts` 25-95, `src/templates/shared-report.html` 1235-1275, `src/lib/scan-node-key.ts` 30-60, `src/handlers/forms.ts` 290-320, `src/lib/event-anon-key.ts` (two ranges), `src/lib/rate-limit.ts` 60-135, `src/lib/public-read-limit.ts` 40-60 and 195-215.
  - `grep -n` over `migrations/0062*`, `migrations/0101*` and forms handlers; `sed -n` of the 0101 and 0062 migrations.
- `node -e` (in-memory only, no file or network access): three runs.
  - D−S on the floor logic.
  - The `floorNestedCounts` enumeration for the walk-in label.
  - The seeded Monte Carlo for cross-event candidate sets.
- One tool call used the wrong tool name (`bash` lowercase) and returned "No such tool available". That was a name error, not a permission refusal, and I re-ran with `Bash`.
- No write to the repo and no file written; this report is returned in the final message because my rules forbid writing.
