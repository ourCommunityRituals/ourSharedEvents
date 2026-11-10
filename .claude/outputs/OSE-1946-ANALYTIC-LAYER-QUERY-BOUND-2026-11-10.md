# OSE-1946: the query bound for the analytic layer, worked against the current export

2026-11-10. This is the written analysis that OSE-1946 scope item 2 asks for. It is an input to the
ADR and to the external privacy review. It is not a ruling, and it changes no code.

Each number is tagged **derived** (worked by hand from the code) or **computed** (from the script in
the appendix). Nothing here was simulated with real churn or checked on staging.

## 1. What the analytic layer holds today

OSE writes four tables to `oureventring_general` (`_stg` on staging). They are written by the daily
cron (`0 3 * * *`, `wrangler.toml`), which materializes and then exports
(`src/index.ts` `runSharedReportPipeline`).

| Table             | Source                                | Key                                        | Values                                              | Rule                                                            | New rows                                                                          |
| ----------------- | ------------------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| events backup     | `handlers/bigquery.ts`                | one row per listed event                   | id, brand, title, slug, dates, res-7 corridor, type | listed events only                                              | daily, for events changed in the last 24 h                                        |
| event series      | `lib/shared-report-export.ts` phase 3 | one row per confirmed series               | event id, cadence, day of week, hour                | none (no counts)                                                | when a series changes                                                             |
| corridor returns  | phase 1                               | corridor × pool × event type, over 90 days | people, returned 2+, 3+, 5+                         | round down to 5, withhold under 5, chain gap of at least 5      | **weekly** snapshot                                                               |
| corridor baseline | phase 2                               | corridor × weekday × hour of event start   | distinct people over 30 and 90 days                 | round down to 5, withhold under **10**, chain gap of at least 5 | **every row, every day** (each refresh stamps every row with a new `computed_at`) |

## 2. The question in the ticket assumes a query service, and there isn't one

The ticket asks for the minimum number of well-formed queries needed to rebuild a cell under K. That
frame fits an interactive query layer (OSE-1150, not built). The analytic layer today is a
**publication**: every snapshot ever exported sits in the dataset, and one `SELECT` reads all of
them.

So the reader's number of queries is not what limits them. What limits them is **the number of
snapshots**, and the export cadence sets it: one a day per baseline bucket and one a week per
returns group.

**Consequence (derived):** a query budget on ourEventRings bounds nothing today. The control has to
sit where the snapshots are made (cadence, grain, window), which is invariant 17
(`oer_emission_boundary`), together with a rule on what OER may pass on to whom. A query budget
becomes relevant only once OSE-1150 or a finer table exists.

## 3. A reader with read access only

**One snapshot: no cell under K can be rebuilt (derived).**

- Inside each table the cells partition the key space, and no total or margin is published beside
  them. There is nothing to subtract.
- The chains (people ⊇ 2+ ⊇ 3+ ⊇ 5+, and 90 days ⊇ 30 days) go through `floorPublishedChain`.
  Values are rounded before the floor is applied, a gap under 5 is withheld, and a chain that is not
  nested fails closed.
- The two count tables split overlapping populations in different ways (type against weekday and
  hour), and no linear identity links them. A corridor with one event type and one bucket is close
  to an exception: there both tables count nearly the same people. Returns would then publish a value
  of 5 to 9 that the baseline withholds under its floor of 10. That is not a leak under 5, but it does
  make the baseline's higher floor meaningless in that case.

**Across snapshots: the fixed lattice leaks _when_ a count crosses a step (derived).** The events table
gives each event's corridor, weekday, hour and start date, so a daily step in a baseline bucket can be
traced to the event that caused it. In a bucket that holds a single event in its window, a step up on
the night after event E means E brought at least one person new to the bucket.

That is a presence bit for E. It is visible about one time in five (when E's arrival crosses a
multiple of 5) and is never a false positive. A read-only reader gets bounds like these, not exact
counts under the floor. Exact recovery needs side knowledge or injected scans (section 4). A
simulation with realistic churn should confirm this before anyone relies on it.

## 4. A reader who can also inject scans: the number the ticket asks for

This is the organizer probe (OSE-1780) moved up to the analytic grain. It needs two things together:
values from the dataset reaching someone, and that same person being able to add distinct
anonymous ids through the public scan route. Per OSE-1496 the `ose_anon` cookie can be forged and
`/q` has no rate limit; that was not re-checked here. The owner's threat scope (2026-10-31) puts
organizers, collusion and poisoning in scope.

The attacker adds forged distinct ids, which stay counted for the whole window, and reads the
published value after each snapshot. The rounded value shows which multiple of 5 the true count is
over, so each snapshot is a threshold question about the hidden count. An adaptive attacker can
place each threshold, so they run a binary search.

| Target                                                               | Values to tell apart | Snapshots needed (computed, no churn) | Lower bound from information alone | Elapsed time at current cadence |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------- | ---------------------------------- | ------------------------------- |
| A returns group under 5                                              | 0 to 4               | **3**                                 | ⌈log₂ 5⌉ = 3                       | 3 weeks                         |
| A baseline bucket under 10                                           | 0 to 9               | **4**                                 | ⌈log₂ 10⌉ = 4                      | 4 days                          |
| A published value's hidden remainder (shows 20, true value 20 to 24) | 5                    | **3**                                 | 3                                  | 3 weeks or 3 days               |
| Adding one id per snapshot instead of searching                      |                      | 5 (returns), 10 (baseline)            |                                    |                                 |

To target a baseline bucket, the attacker needs an event in the same res-7 corridor and the same
weekday and hour, and any organizer can create one. Real arrivals and departures between snapshots
blur the reading, and they are rarest in sparse corridors. So this attack works best exactly where
OSE-1944 says K protects least.

**What this decides (derived):** under any fixed public rule, a reader who can inject recovers an
exact count under K in about ⌈log₂ K⌉ snapshots, a single-digit number. No query budget changes this,
because the snapshots exist whether or not anyone queries them. The options are:

1. **Keep the injector away from the values.** The ADR states that dataset values never reach an
   organizer, a sponsor or anyone else who can create events or scan, whether as raw rows, as OER
   answers, or as anything derived from a cell. This is enforceable only if OER's output surface is
   also gated. Today nothing gates it, and that is the gap the ticket names.
2. **Make snapshots scarce.** Export the baseline weekly or once per sealed period instead of daily.
   That moves the 4 days to 4 weeks. It slows the attack and does not stop it.
3. **Add noise.** Noise on the published values is the only option here that bounds the injecting
   reader (the same conclusion the D5 spike reached for the poster hour), and it comes with the
   spike's conditions: sealed periods, values that never change once published, and every total
   derived from the noisy values.

Options 1 and 2 hold against a reader who only reads the dataset. Against organizers, which the
owner's threat scope includes, only option 3 holds. (Section 5 adds a second reason option 1 is
needed.)

## 5. Checked later the same day

### 5.1 An exact SharedReport figure beside a rounded export figure (computed)

The SharedReport publishes no corridor or type total of the returns measure, so there is no total
to subtract the exported groups from. But it does publish each event's `return_rate.sample_size`
(and `corridor_density.this_event_count`) **exactly** once it reaches 5, without rounding
(`shared-report-builder.ts`, steps 3 and 4). The export rounds the corridor × type group that the
same people fall into. When an exact figure and a rounded figure cover overlapping people, the
rounding stops protecting.

Take one snapshot and a corridor × type group holding two events in its 90-day window. The events
table names them both. E1's report shows its sample size, s1, exactly. E2's report withholds its own
because E2 had x₂ people, fewer than 5, none of whom were at E1. The reader knows s1, the group's
rounded value and that x₂ is 0 to 4.

| Outcome over s1 = 5…104, x₂ = 0…4                                          | Share     |
| -------------------------------------------------------------------------- | --------- |
| x₂ recovered exactly (for example s1 = 11, group shows 15, so x₂ = 4)      | **8.0%**  |
| x₂ narrowed to fewer than five values, which says more than "fewer than 5" | **72.0%** |
| Nothing learned                                                            | 20.0%     |

This needs no injected scans and only one snapshot. It does need a reader who holds E1's
SharedReport (E1's organizer, or its sponsor at a depth that shows sample size) and the dataset
values. That breaks invariant 2 directly. **So option 1 (dataset values never reach anyone who
reads a SharedReport) is required on its own merits, or the export's group must be built only from
parts that are themselves published** (the `floorTotalOfParts` rule the SharedReport already uses
for its own totals). Under that rule a withheld event adds nothing to the group, and the script
finds no case that leaks.

Rounding the SharedReport's sample size the way the export does is **not** enough. With both
figures rounded, x₂ is never recovered exactly, but in 200 of the 500 cases (40%) the reader still
learns that x₂ is at least 1: someone was at E2, which is the presence bit.

### 5.2 OSE-1496 on `main` (still In Progress)

- **`/q` now has a per-caller count limit** (#852, `publicCountLimited`, `PUBLIC_READ_MAX` = 360 per
  window). Scans past it are not counted.
- **The cookie is still unsigned.** `getOrCreateAnonId` (`src/lib/anonymous-id.ts`) accepts any
  `ose_anon=anon_<letters, digits, _ or ->` value, so a caller can present as many distinct ids as
  they like.

The attack in section 4 needs at most about ten forged ids over three weeks, which is far below any
per-minute limit, so the bound stands as computed.

## 6. Still not checked

- Real churn. Every number above assumes no real people arrive or leave between snapshots. A
  simulation on seed-shaped data should give the real success rate by density.
- Differences in filters between the two surfaces. The export's group counts only rows under the
  current pepper epoch and inside the 90-day `last_seen_at` window; the sample size counts every row
  for the event. Section 5.1 assumes both cover the same people, which is the usual case for a recent
  event.

## Appendix: the script (re-derive with `node probe.mjs`)

```js
// The injecting reader reads the published value each snapshot and adds forged
// distinct ids. Added ids accumulate and are never removed.
// Published rule: v = floor5(n), withheld if n < floor. Find the fewest adaptive
// snapshots that pin x in [0, floor - 1].
const pub = (n, floor) => (n < floor ? -1 : Math.floor(n / 5) * 5);
function solve(cands, J, floor, depth) {
  if (cands.length <= 1) return true;
  if (depth === 0) return false;
  for (let add = 0; add <= 20; add++) {
    const j = J + add,
      groups = new Map();
    for (const x of cands) {
      const k = pub(x + j, floor);
      groups.set(k, [...(groups.get(k) || []), x]);
    }
    if (groups.size === 1) continue;
    if ([...groups.values()].every((g) => solve(g, j, floor, depth - 1))) return true;
  }
  return false;
}
for (const floor of [5, 10]) {
  const cands = [...Array(floor).keys()];
  let d = 0;
  while (!solve(cands, 0, floor, d)) d++;
  console.log(`floor ${floor}: ${d} snapshots`); // floor 5: 3, floor 10: 4
}
```

At each smaller depth the search fails (2 snapshots for floor 5, 3 for floor 10). That failure is
the check that the minimum is real and is not just the first depth the loop tried.

## Appendix: the section 5.1 script (re-derive with `node mix.mjs`)

```js
// One snapshot. SharedReport publishes E1's sample size s1 exactly (5 or more). The export
// publishes the corridor x type group (E1 + E2) rounded down to 5. E2 has x2 < 5 people, none
// of them at E1. The reader knows s1, the rounded group value, and that x2 is 0 to 4.
const f5 = (n) => Math.floor(n / 5) * 5;
let exact = 0,
  narrowed = 0,
  total = 0;
for (let s1 = 5; s1 < 105; s1++)
  for (let x2 = 0; x2 < 5; x2++) {
    total++;
    const pub = f5(s1 + x2);
    const cands = [0, 1, 2, 3, 4].filter((x) => f5(s1 + x) === pub);
    if (cands.length === 1) exact++;
    else if (cands.length < 5) narrowed++;
  }
console.log({ total, exact, narrowed }); // 500, 40 (8.0%), 360 (72.0%)
```

Three variants, run to check that the script can tell the cases apart:

- **The export publishes the group exactly** (`f5 = (n) => n`): 500 of 500 cases are recovered
  exactly.
- **The SharedReport also rounds s1:** no case is recovered exactly, but 200 of 500 still show that
  x₂ is at least 1.
- **The group is built only from published parts:** 0 of 500 leak.
