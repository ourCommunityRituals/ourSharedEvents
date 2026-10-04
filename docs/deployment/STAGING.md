# Staging: stg.oursharedevents.com

Staging is the live, deployed copy of the Worker that every story is judged on. Local runs and mocks only vet a change before it gets here. A story is Done only when the staging chain is green for its merge SHA (root `CLAUDE.md` §5, "Two stages: Merged, then Done").

Read on 2026-10-04 from the live site, `workers/oursharedevents/wrangler.toml` and the CI workflow. For the full environment table, see [ENVIRONMENT_MATRIX.md](ENVIRONMENT_MATRIX.md). For deploy steps, see [DEPLOYMENT.md](DEPLOYMENT.md) and `docs/runbooks/RUNBOOK-DEPLOYMENT.md`.

## What it is

|               |                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker        | `oursharedevents-stg` (`[env.staging]` in `wrangler.toml`)                                                                                  |
| Route         | `stg.oursharedevents.com/*` on the `oursharedevents.com` zone                                                                               |
| Databases     | `ocr-db-staging` (binding `DB`, anonymous surface) and `ocr-forms-db-staging` (binding `FORMS_DB`, identified surface). Separate on purpose |
| Storage       | R2 bucket `ose-uploads-staging`; KV provisioned (see matrix)                                                                                |
| Scheduled job | Daily at 03:00 UTC (`0 3 * * *`): PII lifecycle, draft expiry                                                                               |
| Deployed by   | CI, on push to `main`, job T1 "Deploy → Staging". Never by hand                                                                             |

## Check that it is up

```bash
curl -s https://stg.oursharedevents.com/health
```

A healthy answer on 2026-10-04:

```json
{
  "ok": true,
  "env": "staging",
  "version": "stg-d60896b-20261004",
  "db": "ok",
  "dataSource": "live"
}
```

- `env` must say `staging`. `version` is `stg-<short SHA>-<date>`, so it tells you which commit is live.
- Staging `/health` includes a `_debug` block. Production does not.

## What each address does

| Address                    | Without signing in                                            |
| -------------------------- | ------------------------------------------------------------- |
| `/`, `/events`, `/display` | 200, public                                                   |
| `/admin`                   | 302 to the Cloudflare Access login for this host              |
| `/sponsor`                 | 403 until opened from a signed sponsor link (expected)        |
| `/api/v2/admin/*`          | Refused without Access, or without a CI/test fallback (below) |

## How it differs from production

These settings are on in staging and must stay out of production (`[env.staging.vars]`):

- **Test-only admin routes in:** `ALLOW_ADMIN_KEY_FALLBACK` and `ALLOW_OCR_INTERNAL` let automation call admin routes with a bearer key or `X-OCR-Internal`. Production relies on Cloudflare Access only.
- **`ADMIN_SCOPE_ALL = "true"`:** the automation actor sees every brand's rows. Guarded by `tests/prod-admin-scope-config.spec.ts`, which fails if it ever appears in production.
- **CORS:** `stg.oursharedevents.com` is allowed only when `WORKER_ENV` is `staging` (`lib/cors.ts`).
- **BigQuery:** staging writes to its own `_stg` datasets, never the ones OER reads (OSE-1416).
- **Publish grace window:** 10 minutes. A published event is live by link but off the list, map and sponsor discovery until it passes. Browser tests that need a listed event must wait or use the fixtures below.
- **Off in staging:** Turnstile (`TURNSTILE_ENABLED = "0"`), sponsor geo matching.

## What runs against it

After a merge to `main`, `OurSharedEvents CI/CD` runs these against staging (they are skipped on pull requests):

| Job                                 | What it proves                                               |
| ----------------------------------- | ------------------------------------------------------------ |
| T1 Deploy → Staging                 | The Worker and migrations apply cleanly                      |
| T2 Contract → Staging (Bruno)       | API shape and assertions (pyramid level 6)                   |
| T3 E2E Smoke → Staging (Playwright) | Key surfaces load and work (level 7)                         |
| T4 Functional → Staging             | Full flows, including the sponsor journey                    |
| T5 Red team                         | Adversarial run, only after a fully green push run on `main` |

Check a merge with:

```bash
gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push
gh run view <id> --json jobs
```

Confirm T1 to T4 are `success`. Only then move the story to Done.

## Test data on staging

Staging holds fixtures that tests depend on. Do not delete them.

- `test-event-001`: seeded by CI before T3 and T4. A shortlink points at it.
- `SMOKE_EVENT_SPONSORED`: an event with a sponsor, used to prove sponsor impressions on `/display` and `/events`.
- `evt_sponsor_logo_check`: three sponsors (real logo, none, broken logo) for the register-form logo check (OSE-1566).

Staging is shared. A change that deletes or archives events can break the next CI run.

## Known quirks

- **Bot management:** Cloudflare can answer Playwright's request client on HTML pages with 403. Drive pages through a real browser context, not the request client.
- **Staging is the verdict:** a test that passes locally and fails here is a failing test.
- **Access page is Cloudflare's:** you cannot test its content, only the hand-off to it and back.

## Related

- Production is a separate Worker (`oursharedevents-prod`) and is not launched yet. See `docs/runbooks/RUNBOOK-DEPLOYMENT.md`, "First Production Launch".
- CI design: `docs/architecture/ci-cd-architecture.md`.
- Worker configuration values are documented in [CLOUDFLARE_SECRETS.md](CLOUDFLARE_SECRETS.md). Never put one in this file.
