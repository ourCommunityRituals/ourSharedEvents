# ADR-037: A migration dry run prints counts, and on production it obeys the floor

**Status:** Accepted. The owner asked for a production dry run on 2026-11-15, on the condition that it
respects the invariants. This ADR is how it does. The owner merged it (PR #1293) and accepted it in
words the same day (OSE-2085).
**Date:** 2026-11-15
**Deciders:** Owner (PO). Dr of Security advises on what a public log may hold; DevOps owns the deploy jobs.
**Tickets:** OSE-2085 (this decision and its code), OSE-2016 (the staging dry run it extends)

## Context

A migration can carry a dry-run file: read-only SQL that says what the migration will mean for the
rows that are there. Since 2026-11-14 the staging deploy runs it before it applies migrations
(`scripts/ci/migration-dry-run.mjs`, OSE-2016). The owner then asked for the same on production.

Three facts decide the shape:

- **This repository is public.** Method: `gh api repos/ourCommunityRituals/ourSharedEvents --jq .visibility`
  reads `public`. So every Actions log and job summary is public. Anything a dry run prints is published.
- **The script checked only that a statement reads.** It refused anything but a `SELECT`. It did not
  check what was selected. A dry-run file could select a column of row values, and the script would
  print them.
- **Two invariants cover what is published.** "Never who, only how many" (AGENTS.md invariant 1), and
  "the under-5 floor has no exceptions" (invariant 2): a published count below 5 is withheld, and a
  withheld count reads in words, never as 0.

So a production dry run that prints what its file selects would break both. On staging the data is
test data, but the forms database is still the identified side, and the script had no rule there either.

## Decision

**A dry run prints counts, never rows. Where the data is real or identified, each statement returns
one row of counts and the floor applies.**

| Where                                                | Rule   | What may be printed                                                                            |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Production, both databases                           | strict | one row per statement; every cell a `COUNT(...)`; a count under 5 prints as "Fewer than 5"     |
| Forms database, staging and local                    | strict | the same                                                                                       |
| Main database, staging and local                     | plain  | numbers as they are; a text cell only if it is a short lower-case label, such as a status word |
| Any database, a statement that reads only the schema | exact  | numbers and labels as they are                                                                 |

In detail:

1. **Strict statements are checked from the SQL alone, before anything is sent.** The statement starts
   with `SELECT` (every statement must, under any rule); every item of its select list is `COUNT(...)` with an optional alias and nothing
   else; there is no `GROUP BY`, `UNION`, `INTERSECT` or `EXCEPT`. `MIN` and `MAX` are refused because
   they return a row's own value. Arithmetic on a count is refused because it can carry a value out.
   **No statement, under any rule, may hold a double quote, a backtick or a square bracket, or the
   word `WITH`.** Those quote an identifier or name a temporary table, and each was a way past the
   checks as first written (see "Security review" below).
2. **Every pending file is checked before any statement of any file runs.** A file that may print more
   than counts stops the job before the migrations are applied.
3. **The answer is checked again before it is printed.** A strict statement must return exactly one
   row of non-negative whole numbers. Anything else stops the run, and the message names the column
   and the kind of value, never the value.
4. **The floor is 5**, the same number as `CORRIDOR_MAP_MIN_COUNT` in the worker. A test fails if the
   two differ. Under the floor the cell reads "Fewer than 5". Zero reads the same way.
5. **A schema fact is not a count of anything people did.** A statement whose every table is
   `pragma_table_info`, `pragma_table_xinfo`, `pragma_index_list`, `pragma_index_info`, `sqlite_master`,
   `sqlite_schema` or `d1_migrations` prints exactly. "Is the column there: 0 or 1" has to be readable.
6. **Production has no on-demand run.** The script takes `--env production` only with `--pending`,
   which is what the production deploy job passes. The dispatch workflow stays staging only.
7. **A wrangler failure is reported in the script's own words.** Its output can quote the database, so
   it is not copied into the log for a statement that failed.

## What this costs

- **A production dry run cannot tell 0 from 4.** That is the floor doing its work. A dry run that needs
  the difference has to ask a question whose answer is a schema fact, or be read by the owner another way.
- **No breakdowns on production.** "How many per status" is a `GROUP BY`, which is refused. It can be
  written as one `COUNT` per status, each of which meets the floor on its own.
- **The 0108 file was changed to fit:** its per-status breakdown became one count.

## What this does not do

- **It does not stop an author who means to leak.** Many narrow counts (`WHERE id = '…'`) can be
  differenced against each other down to the floor. A dry-run file is a committed file in a reviewed
  PR; review is what stops that. This rule stops an accident.
- **It does not make production live, and it runs nothing from a session.** The step runs only inside a
  production deploy the owner starts (AGENTS.md, "Production posture").
- **It does not change ADR-021.** Production stays read-only for every test suite. A dry run is a read.

## Security review (2026-11-15)

Dr of Security read the first version of this rule and broke it. All of it was confirmed by running
the script's own checks, and for the first finding by running the statement on a local SQLite.

| Finding                                             | The input                                                                                                                                             | Fixed by                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A write passed every check                          | `WITH sqlite_master AS (SELECT 1 AS "'") DELETE FROM events …`: a single quote inside a double-quoted name made the string blanking hide the `DELETE` | refusing `"`, backtick, `[` and `]` in every statement; refusing `WITH`                             |
| Data was read as a schema fact, and printed exactly | `FROM sqlite_master JOIN "registrations"`, `JOIN(registrations)`, a CTE named `sqlite_master`                                                         | the same refusals; every `FROM` and `JOIN` must be followed by a plain listed name                  |
| A non-count value passed the select-list check      | brackets inside double-quoted aliases threw off the bracket count                                                                                     | the same refusals                                                                                   |
| A parser message could quote the database's answer  | a failed `JSON.parse` put its input in the error                                                                                                      | the script's own words for an answer it cannot read; no wrangler text for production's pending list |

Each input is now a test case. The write finding also applied to the script as it has been on `main`
since #1239 (staging only). No dry-run file that used it was ever committed.

Not checked by that review: the behaviour of real D1 (it would need a credential and a write).

## Alternatives

### A. Print what the file selects on production, as on staging

Not chosen: it breaks invariants 1 and 2 in a public log.

### B. Keep production's dry run out of the log, in a private artifact

Not chosen: an artifact of a public repository's run is as public as its log. There is no private place
in this pipeline to put it.

### C. No dry run on production

The state before this ADR. The cost is the one OSE-2012
met: the counts are read after the migration, when they can no longer change the decision.

### D. Apply the strict rule everywhere, staging's main database too

Not chosen for now: staging's main database is seeded test data on the anonymous side, and a breakdown
there is useful when writing a migration. If staging ever holds real data, this becomes the rule.

## Consequences

- `scripts/ci/migration-dry-run.mjs` carries the rule; `tests/unit/ci/migration-dry-run.test.js` holds it,
  each part watched failing on a planted fault.
- Every committed dry-run file must pass the strict check, whichever database it is for, because every
  migration reaches production. A test fails a file that would stop a production deploy.
- The production deploy job has a dry-run step above its two apply steps.
- `docs/runbooks/PRODUCTION-MIGRATION-PLAN.md` says the same as this ADR.

## Validation

- Unit: `tests/unit/ci/migration-dry-run.test.js`.
- Local, for real: a forms-database file with a count under 5 prints "Fewer than 5"; a file that selects
  a text column is refused before it is sent.
- Not yet seen: the production step running. It first runs at the next production deploy. Migration
  0108 is pending on production and has a dry-run file, so that run is the first real one.
