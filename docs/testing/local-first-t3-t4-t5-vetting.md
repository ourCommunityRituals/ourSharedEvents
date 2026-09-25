# Local-first T3/T4/T5 vetting (OSE-1367)

> **Rule:** reproduce a T3/T4/T5 failure locally before spending another staging
> CI/CD run to chase it. T6 (security finale) and genuine red-team/adversarial
> execution against the deployed edge remain staging-based — see
> [When staging is required](#when-staging-is-required) below.

This runbook exists because PR #645's T4b (`sponsor-journey.spec.ts` /
`cross-brand-isolation.spec.ts`) failed three times against staging before the
root cause (a browser-cacheable public sponsor read, then a stale server-side
cache read) was fixed. Each staging rerun cost a full pipeline pass — deploy,
seed, T0–T3 — to reach the one T4 step that mattered. The fix was found and
proven **locally**, against a `wrangler dev --local` worker and local D1, in
minutes. This doc captures that workflow so the next T3/T4/T5 red does not have
to rediscover it.

## Scope: what is local-capable, what is not

| Tier                                | Local-capable? | Notes                                                                                                                                                                                                       |
| ----------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 (worker unit/integration)        | Yes, always    | `vitest` against `@cloudflare/vitest-pool-workers` — no network.                                                                                                                                            |
| T2 (Bruno API/Pages contracts)      | Yes            | Point `baseUrl` at `http://127.0.0.1:8787` via `--env-var`.                                                                                                                                                 |
| T3 (Playwright smoke)               | Mostly         | Needs a running local worker; some specs assume staging-only fixtures.                                                                                                                                      |
| T4 (Playwright functional/journeys) | Mostly         | Needs local worker + local D1 + seed fixtures + `.dev.vars`. Auth-gated flows need REAL auth gating locally (see the DEV_OPEN_ADMIN gotcha below) to mean anything.                                         |
| T5 (red-team adversarial)           | Partially      | Auth-bypass and leakage-shape assertions are provable locally. CF Access edge behavior, Cloudflare WAF, and Bot Management are NOT reproducible locally — those assertions only prove something on staging. |
| T6 (security finale)                | No             | Staging-only by design, per the standing team rule.                                                                                                                                                         |

## One-time local setup

```bash
cd workers/oursharedevents
npx wrangler d1 migrations apply ocr-db-local --local
npx wrangler d1 migrations apply ocr-forms-db-local --local
npm run seed:local-launch   # seeds a public shortlink + poster deployment on test-event-001
```

`npm run seed:local-launch` applies
[`tests/ui/smoke/fixtures/launch-story-local.sql`](../../tests/ui/smoke/fixtures/launch-story-local.sql).
It is idempotent — safe to re-run.

### `.dev.vars` — gitignored, never commit

`workers/oursharedevents/.dev.vars` is covered by `.gitignore` (`.dev.vars` and
`.dev.vars.*`). Create it locally; it never leaves your machine:

```
ALLOW_ADMIN_KEY_FALLBACK="true"
ADMIN_KEY="local-t4-admin"
ALLOW_OCR_INTERNAL="true"
X_OCR_INTERNAL="local-t4-internal"
ADMIN_SCOPE_ALL="true"
SPONSOR_HOME_SIGNING_SECRET="local-sponsor-home-signing-secret-min-32-chars" # pragma: allowlist secret
SHARED_REPORT_SIGNING_SECRET="local-shared-report-signing-secret-min-32-chars" # pragma: allowlist secret
BEACON_TOKEN_SECRET="local-beacon-token-secret-min-32-chars" # pragma: allowlist secret
```

Then start the worker:

```bash
npx wrangler dev --ip 127.0.0.1 --port 8787
```

Verify it is up: `curl http://127.0.0.1:8787/health` should return
`{"ok":true, ...}`.

### ⚠️ The `DEV_OPEN_ADMIN` gotcha — do not use it for auth-gated vetting

`auth/admin.ts` supports a local-dev-only open-admin bypass
(`DEV_OPEN_ADMIN="true"`) that makes `requireAdmin` return `null` (authorized)
for **any** caller, with no credential check at all. It exists for manually
clicking around the admin UI in a browser without Cloudflare Access.

**Do not set `DEV_OPEN_ADMIN` in `.dev.vars` when vetting anything that
exercises an auth gate** — T4b sponsor-journey admin calls, T4g launch-story
draft-preview/go-live, or any T5 adversarial auth-bypass assertion
(`RT-LNCH-007/008/009` etc.). With it set, an unauthenticated or fabricated-
token request that SHOULD 401 will instead succeed, and the test will falsely
pass having proven nothing. Leave it unset (as in the template above) and use
`ALLOW_ADMIN_KEY_FALLBACK` / `ALLOW_OCR_INTERNAL` with a real `ADMIN_KEY` /
`X_OCR_INTERNAL` value instead — that authenticates legitimate calls while
still correctly rejecting everything else, exactly like staging.

(`ADMIN_SCOPE_ALL="true"` is separate and always safe locally — it mirrors
staging's own `wrangler.toml` setting for the CI/automation key actors.)

## Per-tier local commands

All commands assume the worker above is running on `127.0.0.1:8787` and are
run from the **repo root** unless noted.

### T0 — launch-story worker contracts (no worker process needed)

```bash
npm run test:local:launch-contracts
```

Runs the same seven files as the CI `T0 Tests (launch-contracts)` shard
directly against the Vitest Worker pool — no `wrangler dev`, no network.

### T2 — Bruno contracts against localhost

```bash
cd bruno/ose-pages
npx bru run "13. Launch Story - Public Calendar (OSE-1358)" \
  --env ose-staging --env-var "baseUrl=http://127.0.0.1:8787"

cd ../ose-api
npx bru run "13. Launch Story Contracts (OSE-1355 OSE-1357)" \
  --env ose-staging \
  --env-var "baseUrl=http://127.0.0.1:8787" \
  --env-var "adminKey=local-t4-admin" \
  --env-var "ocrInternalSecret=local-t4-internal" \
  --env-var "cfAccessClientId=local" \
  --env-var "cfAccessClientSecret=local"
```

`--env ose-staging` still selects the environment file for its non-secret
defaults (`testEventId`, etc.); `--env-var` overrides just what needs to point
at localhost.

#### Bruno CLI quirk: `code: |` block scalars can crash with a leading comment

While authoring the OSE-1355/1357/1358 contracts, any `after-response` script
written as a YAML `code: |` block scalar whose FIRST line is a `//` comment
made `@usebruno/cli` 4.1.0 throw `ReferenceError: 'elapsed' is not defined`
from inside the **collection-level** script (`opencollection.yml`), not the
file itself — a script-concatenation bug, not a problem with the test logic.
Every existing hand-authored `.yml` in this repo avoids it by using a
**double-quoted scalar with literal `\r\n` escapes** instead (the same style
Bruno's own GUI export produces):

```yaml
code: "// comment is fine here\r\ntest('...', function () { expect(1).to.eql(1); });"
```

If a new Bruno `.yml` file mysteriously fails with `'elapsed' is not defined`,
check whether its script uses `code: |` with a leading comment line, and
convert it to the double-quoted style above.

### T4b — sponsor journey / cross-brand isolation

```bash
$env:BASE_URL='http://127.0.0.1:8787'          # PowerShell
$env:ADMIN_KEY='local-t4-admin'
$env:X_OCR_INTERNAL='local-t4-internal'
$env:SMOKE_EVENT_SPONSORED='evt_smoke_sponsored'
$env:PW_REQUIRE_PRECONDITIONS='1'
npx playwright test --config=playwright.e2e-smoke.config.ts sponsor-journey.spec.ts cross-brand-isolation.spec.ts
```

Requires the sponsored-event fixture too:
`npx wrangler d1 execute ocr-db-local --local --file tests/ui/smoke/fixtures/sponsored-event.sql`
(run from `workers/oursharedevents`).

### T4g — launch story smoke (public card → calendar; admin preview → go-live)

```bash
npm run test:local:launch-smoke
```

(Set `BASE_URL`, `ADMIN_KEY`, `X_OCR_INTERNAL` to the local values first, same
as T4b above.)

### T4h — poster print layout (rendered, `page.emulateMedia({ media: 'print' })`)

```bash
npm run test:local:poster-print
```

The art-viewport-clamp and multi-slot-overflow assertions skip gracefully
unless `test-event-001` has `cover_image_url` set and a second (`donate`)
shortlink slot enabled — see the optional-follow-ups comment at the top of
[`launch-story-local.sql`](../../tests/ui/smoke/fixtures/launch-story-local.sql)
for the exact `UPDATE`/`INSERT` statements to exercise those branches.

### T5 — launch adversarial subset (auth-bypass and leakage shape only)

```bash
$env:BASE_URL='http://127.0.0.1:8787'
$env:ADMIN_KEY='local-t4-admin'
$env:X_OCR_INTERNAL='local-t4-internal'
$env:SMOKE_EVENT_ID='test-event-001'
npm run test:local:red-team-launch
```

This proves the auth-gate and cache-header assertions (`RT-LNCH-007` through
`RT-LNCH-015`) with REAL auth enforcement (no `DEV_OPEN_ADMIN`). It does
**not** prove anything about Cloudflare Access, WAF, or Bot Management — those
only exist on the deployed edge.

## When staging is required

Rerun against staging (and accept the CI/CD spend) when:

- The failure is in a tier that is **not** local-capable per the table above
  (T6 always; any T5 case that specifically targets CF Access/WAF/Bot
  Management behavior).
- A local repro genuinely cannot be constructed (a staging-only fixture, a
  secret that only exists in the staging environment, a timing/scale
  characteristic of the real edge).
- The fix has already been vetted locally and you are confirming the fix on
  the real pipeline before merge — this is the normal, expected use of
  staging CI, not the thing this runbook is trying to avoid. The goal is to
  stop _chasing_ a still-unknown failure through repeated staging reruns, not
  to skip staging altogether.

## Before you push: cleanup checklist

- [ ] Stop the local `wrangler dev` process.
- [ ] Delete `workers/oursharedevents/.dev.vars` (or leave it — it's
      gitignored — but never let it linger with `DEV_OPEN_ADMIN` set).
- [ ] `git status --short` shows no local-only artifacts staged.
- [ ] Re-run the fast gate: `npm run ci:all:fast`.
