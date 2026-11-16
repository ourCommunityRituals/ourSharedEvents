# ADR-035: Keep the street-map archive in one bucket that staging and production both read

**Status:** Proposed. It records a decision the owner made on 2026-11-14 and merged as PR #1257
(`bf1c696d`, 2026-11-15 00:44 UTC). The owner ratifies this record by merging the pull request
that carries it.
**Date:** 2026-11-15
**Deciders:** Owner (PO). Dr of Security advises on who may write.
**Ticket:** OSE-2064 (the load), OSE-1884 (the archive), epic OSE-1880

## Context

The landing map and the public area map (OSE ADR-033) draw streets from one PMTiles file: the
United States part of a Protomaps build of OpenStreetMap data, read by the Worker through the R2
binding `MAP_TILES` (`lib/street-map.ts`, `lib/pmtiles.ts`). Where the data comes from, its
licence and how the file is cut are in [`NOTICE.md`](../../NOTICE.md).

Until 2026-11-14 the plan was a bucket for each environment (`ose-map-tiles-staging`,
`ose-map-tiles-production`). That left a question nobody had answered: how production gets its
copy (OSE-2068). Protomaps keeps a daily build for about a week, so the same file cannot be cut a
second time once its build is gone. A second copy would have to be copied across from staging and
compared, by a credential that reaches both.

The street-map review of 2026-11-15 (`.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md`,
finding R26) found the owner's answer in the runbook, `wrangler.toml` and three tests, and in no
ADR. This is that record.

Rules already in force that the decision must keep:

- Production changes only through CI, and an agent never touches Cloudflare, a secret or a
  repository setting (AGENTS.md, Human approval).
- Staging gets the archive before production (owner, 2026-11-09).
- Nothing is run, built or checked on the owner's computer (owner, 2026-11-14), so the cut, the
  check and the upload run in a workflow.

## Decision

**D1. One bucket.** `ose-map-tiles`, on the account staging deploys to. There is no production
bucket, no second load and no second copy.

**D2. One key per build, never overwritten.** An object is named `us-YYYYMMDD.pmtiles` after the
Protomaps build it was cut from (`us-20261115.pmtiles` since 2026-11-16; `us-20261109.pmtiles` when
this was accepted, a build that aged out at Protomaps before any load). Each environment reads the key in
its own `MAP_TILES_ARCHIVE` setting, and both blocks of `wrangler.toml` carry the same key. A
refresh is a new key and a pull request, never a write over an object: a running Worker keeps an
archive's directories in memory by key.

**D3. A loaded object is locked.** After a green load the owner adds an R2 bucket lock rule whose
prefix is the whole key, with no end date. Cloudflare then refuses to overwrite or delete that
object for every credential. One rule per loaded key, and never a rule with no prefix.

**D4. Who reads.**

| Reader                                   | How                                                                              | Today                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| The staging Worker                       | the `MAP_TILES` binding in `[env.staging]`                                       | bound; the bucket is empty                |
| The production Worker                    | the same binding, added in its own PR                                            | not bound; production draws hexagons      |
| The load workflow's `bucket-private` job | two reads of the bucket's settings, by wrangler, with `CLOUDFLARE_API_TOKEN_OSE` | never run                                 |
| Anyone else                              | nothing: no r2.dev address, no custom domain                                     | not read by anyone yet (see "Not proven") |

No other binding in `wrangler.toml` may name this bucket. Local development has its own bucket,
`ose-map-tiles-dev`.

**D5. Who writes.** One writer is intended: the workflow "Street-map archive load (stg)"
(`.github/workflows/street-map-archive-load.yml`), dispatched by the owner, from `main` only, in
`load` mode. It writes with an R2 API token ("Object Read & Write", this bucket only) that the
owner creates for the load, sets as the secrets `R2_MAP_TILES_ACCESS_KEY_ID` and
`R2_MAP_TILES_SECRET_KEY`, and deletes afterwards. The workflow adds a new key and never changes
or removes an object. It has no production input and no production credential.

**D5a. Where the write key lives (owner, 2026-11-16).** On a GitHub environment of its own,
`street-map-load`, whose branch list is branch `main` alone. The load job names that environment
and no other job does. GitHub starts a job in an environment only from a ref its branch list
allows, so a branch's copy of any workflow cannot read the pair, which the `staging` environment
could not promise (below). Two things hold it: the workflow's first job reads the environment and
its branch list and stops the run unless the list is `main` alone, before the job that names the
environment starts (GitHub makes a missing environment on first use, with no list); and
`tests/integration/adr008-wiring.test.js` fails when any other job names it. The owner makes the
environment in the browser; no script and no agent does. Not held by anything: that the pair is
set there and not also at repository level, which no job can read from the outside.

**D6. Who creates the bucket.** The owner, before the pull request that names it merges. See
"What happened" below: this part of the decision was not kept.

**D7. Production binds later.** One pull request adds the production binding, after the staging
street cases are binding (`streetMapArchiveLoaded` is `"true"`). Binding the bucket is not a
launch: production stays closed and no `PRODUCTION_LIVE` is set.

## What holds the decision in CI

- `tests/unit/ci/street-map-archive-load.test.js`: the load script takes the bucket by exact name
  (`STREET_MAP_BUCKET` in `scripts/ci/street-map-archive-load.mjs`); the workflow is dispatch
  only, `main` only, staging only, with no production name; the upload is `--immutable`.
- `tests/unit/ci/prod-preflight.test.js`: `MAP_TILES` is the one binding production shares with
  staging (`SHARED_WITH_STAGING` in `scripts/prod-preflight.mjs`). Production naming a bucket of
  its own fails. Every other production binding that names anything of staging's still fails.
- `tests/unit/ci/env-parity.test.js`: production, once bound, names the bucket staging names; no
  other binding names it; a production binding is refused while `streetMapArchiveLoaded` is not
  `"true"`.

Nothing in CI holds D3 (the lock) or D6 (who creates the bucket). Both are owner steps.

## What happened, and what the review proved

- **A deploy created the bucket, not the owner.** PR #1257 merged before a bucket of that name
  existed on the account. The staging deploy of `bf1c696d` (run 43659704554, job
  `T1 Deploy → Staging`, 2026-11-15 01:07 UTC) listed `MAP_TILES` as a binding to provision and created
  `ose-map-tiles` with default settings. The same thing made `ose-map-tiles-staging` on
  2026-11-10 (run 42865404464). The runbook has the log lines ("When the binding lands before the
  bucket"). T1 to T4 stayed green both times.
- **The GitHub `staging` environment has no branch policy.** Read 2026-11-15 with
  `gh api repos/ourCommunityRituals/ourSharedEvents/environments/staging`:
  `deployment_branch_policy` is `null` and there are no protection rules. A secret set on that
  environment can be read by a job that names it, from any branch.
- **A branch's Worker has the binding.** Every branch runs on staging before it is called ready
  (owner, 2026-11-13), so a pull request's head is deployed to the staging Worker, and that Worker
  holds `MAP_TILES`. An R2 binding can write as well as read.
- **The load workflow has never run** (0 runs, read 2026-11-15). So the bucket is empty, no object
  is locked, and no street has been drawn on staging.

Together: D5 says one writer, and nothing enforces it. Before the lock, a branch deployed to
staging could write the key the owner is about to load. The review rates this High today and
Security Critical on the day production binds, if it is unchanged (finding R8).

## Alternatives Considered

### Alternative A: A bucket for each environment, loaded twice

Cut the build once for staging and again for production.

**Rejected because:** the build is gone after about a week, so the second cut is of another
build and production would not draw from the file staging proved.

### Alternative B: A bucket for each environment, the object copied across

Copy the staging object to a production bucket and compare its SHA-256.

**Rejected because:** it needs a credential that reaches both buckets and a step nobody had
designed (OSE-2068), to end with two copies of one read-only file.

### Alternative C: One bucket with no lock

Share the bucket and rely on the workflow never overwriting.

**Rejected because:** the workflow's check is made before the write and is not a lock inside R2.
With no lock, a mistake or a stolen token on the staging side could change what production draws.

## Consequences

### Positive

- Production draws from the object staging drew from. There is nothing to copy and nothing to
  compare.
- One load, one storage line, one runbook.

### Negative

- **The load writes the bucket production will read.** Staging's credentials reach production's
  street data. The lock (D3) is the control, and it has not been tried.
- **An object removed is removed for both environments.** There is no way to take streets off
  staging alone at once; that is a pull request.
- **Who may write is a rule, not a control** ("What happened", above).
- A deploy can create the bucket again under any new name, with settings nobody chose (D6).

### Neutral

- Production moves to a new key at its own deploy, not at the load.
- `scripts/ci/env-parity.mjs` lists the missing production binding as an open difference until
  the production pull request removes the entry.

## Not proven

- The lock rule: that a rule whose prefix is a whole key refuses an overwrite and a delete, through
  the S3 API and through a Worker binding, and lets the next dated key load.
- Two Workers reading one bucket on this account.
- The settings of the bucket the deploy made: its jurisdiction, and that it has no public
  address. The workflow's first job reads the two public-address settings; no run has happened.
- That a replaced object would be noticed. The Worker pins no etag or hash of the object it reads
  (review finding R13).

## Open, for the owner

The review's human gate (questions 2 and 3), as it stands on 2026-11-16:

1. **Answered (owner, 2026-11-16): keep it.** The bucket the deploy made stays as it is (location
   WNAM, jurisdiction `default`); it is not deleted and remade by hand.
2. **Answered (owner, 2026-11-16): the `street-map-load` environment, branch `main` only** (D5a).
   Accepted by merging the pull request that moved the load job there. The `staging` environment
   could not be it, because branches must deploy there.
3. **Open.** Whether AGENTS.md should name bucket creation among the things an agent, and a deploy, never
   does. AGENTS.md is a governed file; the sentence is proposed in the pull request, not edited
   here.

## Implementation Notes

- Names and the three places they are written: `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`,
  "Names".
- Binding and key: `workers/oursharedevents/wrangler.toml` (`[[env.staging.r2_buckets]]`,
  `MAP_TILES_ARCHIVE` in both `vars` blocks).
- Security records: the secret names are in `docs/security/CI_SECRET_NAMING.md` section 3.5; the
  threats are TL-098 to TL-101 in `workers/oursharedevents/tests/fixtures/threat-ledger.ts`.

## References

- PR #1257 (the decision, merged by the owner); PR #1244 (the load workflow); PR #1262 (the
  record that the deploy made the bucket).
- OSE ADR-033 (the public area map, the second reader of the street layer).
- `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`; `NOTICE.md`.
- `.claude/outputs/CCR-STREET-MAP-WILL-IT-WORK-2026-11-15.md`, findings R8, R13 and R26.

## Revisit Criteria

- The lock rule is tried and does not refuse a write through a binding.
- Production is about to bind and a branch can still reach a credential or a binding that writes
  the bucket.
- A second region or a second product needs its own archive.
