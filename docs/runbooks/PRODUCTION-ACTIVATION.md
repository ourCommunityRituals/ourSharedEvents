# Production activation: what turns on with the live switch

Written 2026-10-12 from the owner's rule: going live is one act, and it activates
the governance, monitoring, observability and documentation processes that belong
to production. Until then production is held (AGENTS.md, "Production posture").

This lists what is **already wired to activation**, what **changes for the people
and agents who work here**, and what is **not built yet**. It is read from the
repo on 2026-10-12; check a line against the file it names before relying on it.

## Turns on with `PRODUCTION_LIVE=true` (repository variable, an owner step)

| What                                    | Where                                       | Effect                                                                               |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Security monitoring includes production | `.github/workflows/security-monitoring.yml` | the daily check covers production; a production failure opens an urgent Linear issue |
| Pulse includes production               | `.github/workflows/pulse.yml`               | the environment matrix becomes staging and production                                |
| Security regression targets production  | `.github/workflows/security-regression.yml` | scheduled runs and pushes to `main` run against production                           |

## Applies from activation (a rule, not a switch)

| What                                 | Where                                                                                      | Effect                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A ticket for every production change | `AGENTS.md`, "Human approval → Production"                                                 | each deploy, migration or setting has a Linear ticket named in its PR, with the post-deploy evidence on it |
| Production joins the Done bar        | `AGENTS.md`, "Definition of Done"                                                          | a story is Done when the staging chain and the production deploy and smoke are green                       |
| The posture section lapses           | `AGENTS.md`, "Production posture"                                                          | the owner removes it; the restraints in it end                                                             |
| Production deploy gates stay         | `.github/workflows/oursharedevents-ci.yml` (schema, secrets, canonical shape, health gate) | unchanged; they already run on every production deploy                                                     |

## Documentation that has to be true on the day

| Document                                            | State on 2026-10-12                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/runbooks/RUNBOOK-DEPLOYMENT.md`               | has the first-launch one-time steps; read it against the deploy before activation         |
| `docs/runbooks/ROLLBACK.md`, `DISASTER-RECOVERY.md` | rewritten; **no command on them has been run**, and a staging restore drill is still owed |
| `docs/runbooks/PRODUCTION-MIGRATION-PLAN.md`        | covers migrations 0078 to 0104                                                            |
| Threat ledger, brain, ADRs                          | follow the code; the brain was brought up to date in OCR-docs#163                         |

## Not built, or not yet decided

- **Closing the host.** No code switch closes production; it answers on `oursharedevents.com`. An Access policy over the whole host is an owner edge setting (OSE-1353, OSE-1377). Activation is the opposite act, so this is decided before it, not at it.
- **Observability floor and alerting.** Beyond the Linear issue a failed production check opens, there is no dashboard or paging path in the repo. OSE-1603 tracks it.
- **A continuous staging-versus-production comparison of the databases.** The config comparison is in CI (`scripts/ci/env-parity.mjs`); migration levels are read by the preflight from saved readings.
- **Open parity items** (`node scripts/ci/env-parity.mjs --strict`): the scan write-buffer queue exists in staging only; the Access audience is not pinned in either environment.
- **The first-scan definition.** M1 needs a production scan, so it stays open until production takes a real one.

## The order

1. Staging and production fully aligned (`env-parity --strict` clean; the preflight clean).
2. Production smoke passes on the still-closed host.
3. The owner activates: the variable, the announcement, the first customer.
4. The posture section is removed; the ticket rule and the Done bar apply.
