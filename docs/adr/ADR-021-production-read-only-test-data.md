# ADR-021: Keep production read-only for every test suite

**Status:** Proposed (needs founder sign-off; see OSE-906)
**Date:** 2026-10-01
**Deciders:** Founder (PO), drafted by Claude Code

## Context

Staging tiers depend on seeded data. Production cannot be seeded the same way, so
the production post-deploy tier (OSE-905) needs a deliberate data strategy before it
asserts anything beyond `/health`. OSE-906 offered two options:

1. **Synthetic canary event.** A permanent, tagged `prod-canary-*` event that the
   production suite writes to (form register, poster-bundle QR fetch), with rows
   scrubbed by cron and excluded from every aggregate and the First-Scan metric.
2. **Strictly read-only.** Health, schema-version assert (OSE-803 pattern) and public
   GET contract shapes only. Zero writes.

Facts on 2026-10-01:

- Production D1 holds **0 events** (CLAUDE.md §3 DevOps, D1 `SELECT COUNT(*) FROM events`).
- The production smoke job (`smoke-production`, `oursharedevents-ci.yml`) already runs
  read-only in practice. Every `security-smoke.spec.js` describe that creates events
  carries `test.skip(IS_PRODUCTION, …)`. The API smoke specs make no write calls.
  Nothing enforced this, though: a new write test without the skip would have run
  against production.
- T5 red-team and T6 finale read their target from the repo variable
  `RED_TEAM_BASE_URL` (OSE-1418). Nothing stopped that variable from naming production.

## Decision

**Production is read-only for every test suite.** No suite seeds, mutates or probes
production with writes. The production post-deploy tier asserts health, the schema
version and public GET shapes only.

It is enforced in three places:

- `security-smoke.spec.js` `createEvent()` throws on production before it posts. This
  is the second line behind each describe's `test.skip(IS_PRODUCTION)`.
- `config/production-read-only.js` `refuseProductionTargets()` runs at load in every
  `playwright*.config.*` except the two the production smoke job uses
  (`e2e-smoke`, `smoke`, listed in `PRODUCTION_READ_ONLY_CONFIGS`). It checks the
  config's own base URL plus `BASE_URL` and `STAGING_URL`, since many specs read those
  directly. A suite that can write fails before any request if pointed at production.
- The CI gate `tests/integration/production-read-only.test.js` (root vitest, so it runs
  on every PR) locks all of the following:
  - the allowlist of specs on `smoke-production`;
  - no write calls in the API smoke specs;
  - the guard, the skips and the write-site inventory in `security-smoke`;
  - `IS_PRODUCTION` coming from the shared helper and matching `PROD_BASE_URL`;
  - the production refusal in every Playwright config outside the allowlist.

Every `security-smoke` describe that sends a write, including the rejected-key probe
(an invalid bearer, expected 401), skips on production. A rejected-key POST could still
create a row if authentication ever regressed, so it does not run there. Production
detection is the shared `isProductionUrl()` helper, so ports, paths and case are caught.

One bounded exception: `scripts/security/security_regression.sh` (the production
security monitor once `PRODUCTION_LIVE=true`) sends credential-less, body-less POSTs to
admin routes to detect an open admin surface, and POSTs to `/jserror`, which no longer
exists in the Worker (404). Neither can create a row: no credentials and no body. The
probe's purpose is the production check itself, so it stays.

## Alternatives Considered

### Alternative A: Synthetic canary event with scrub cron

**Rejected because:** every aggregate, SharedReport, OER export, k-floor and the
First-Scan metric would need a canary exclusion predicate, forever. A missed predicate
puts fake activity into real corridor data, which breaks Invariant 7 (aggregate-only
reporting reflects real participation) silently. With 0 real events in production, a
canary would also be the _only_ data, so a missed exclusion would dominate the first
real SharedReport. The scrub cron is one more PII-lifecycle-shaped job to monitor.

### Alternative B: Read-only by convention (status quo)

**Rejected because:** it already held, but only by habit. One unreviewed `test(…)`
without the skip, or a variable change on `RED_TEAM_BASE_URL`, would write to
production with no failing check.

## Consequences

### Positive

- Real corridor data and SharedReports never contain test rows, so no exclusion logic
  is needed anywhere.
- A suite pointed at production fails loudly at config load, not after it has written.

### Negative

- The production tier cannot prove write paths (register, check-in, scan) end to end.
  Those are proven on staging with the same build (OSE-1217: production deploys only
  after the same-SHA staging chain is green), and in the field (OSE-1252, OSE-1209).
- The production tier no longer checks that a wrong admin key is refused on production.
  That refusal is covered on staging and in the worker suite. On production, OSE-1353's
  Access app answers first, and the CF Access Canary watches that.

### Neutral

- If a write-path canary is ever needed, it reopens this ADR. It does not get added
  quietly to a suite.

## Implementation Notes

- Code: `config/production-read-only.js`, `playwright.red-team.config.ts`,
  `tests/e2e/1-smoke/security-smoke.spec.js` (`createEvent`)
- CI gate: `tests/integration/production-read-only.test.js`. Mutation-checked: removing
  the createEvent guard, dropping one skip, removing the red-team refusal, adding a spec
  to `smoke-production`, or adding an unlisted write each turns it red.
- Related: OSE-905 (production tier), OSE-1418 (`RED_TEAM_BASE_URL`), OSE-1251 (gate)

## References

- Linear OSE-906, OSE-905, OSE-1251, OSE-1353
- `CLAUDE.md` §3 DevOps (production state, 2026-10-01)
