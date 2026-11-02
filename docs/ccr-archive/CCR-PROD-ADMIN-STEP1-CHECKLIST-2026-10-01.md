# Step 1 Checklist (Production Admin-Ready) — CCR Assessment, 3 loops, extended scrum team

**Artifact under review:** the 5-item "Step 1 checklist for tonight" given in chat on 2026-10-01 (Access app → founder row → `ose-platform` row → sign-in check → `PRODUCTION_LIVE`).
**Variable item set:** custom (production enablement + auth configuration), using the fixed severity weights.
**Environment modifier:** 1.0 (production surface, no user PII in this scope).
**Evidence base:** `origin/main` @ `8dde906` (this worktree's checkout is `296c83f`, 15 commits behind; every citation below was re-checked against `origin/main`), plus live HTTP probes and `gh` run data taken 2026-10-01 ~21:45 UTC.
**Not readable:** production D1 (the read was refused by the session's permission classifier) and production Worker secrets. Both stay with the human gate.

## Loop Summary

| Loop           | Confidence | Key finding                                                                                                                                                              |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Surface      | 30.0%      | The Access app scope was too narrow (`/admin` only), and the checklist left out the production deploy, which red `main` currently blocks                                 |
| 2 Pressure     | 77.5%      | `ALLOW_OCR_INTERNAL="true"` is set on production, and the launch steps `main` added after this worktree was cut (0088 backfill, 0091 purge, BigQuery table) were missing |
| 3 Confirmation | 92.5%      | No decay. The canary does not probe every admin path. Production D1 and secrets are still unverified, so this goes to the **human gate**                                 |

## Extended scrum team — POV findings

| Role                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PO                     | "Confirm `/admin` shows your brand" cannot pass or fail. Production has 0 events (migration 0086), and a deny-scoped list also returns `ok:true, items:[]` (`handlers/events.ts:318-322`). The only signal that tells them apart is the `filters` echo (runbook `:244`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Lead BE                | The Worker requires Access identity on `/admin`, `/manage`, `/api/v2/admin*` (`router.ts:570`) and `/briefing`, `/overview`, `/summary` (`router.ts:1708`). An app scoped to `/admin` alone leaves the admin UI's API calls with no JWT, so they all get 401.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Lead FE Integration    | Same root cause from the UI side: the dashboard would load and then fail on every data call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sr Design FE           | No design surface in scope. N/A.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sr Automation QA       | Every verification step needs an observable pass/fail. Added curl probes per path and the `filters` key check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| SRE/SDET + Sr SDET/SRE | The canary probes only `/admin` and `/api/v2/admin/sponsors` (`cf-access-canary.yml:82`), so a green canary says nothing about `/manage` or `/briefing`. `PRODUCTION_LIVE` before the first production smoke opens a daily urgent Linear issue (runbook `:287-298`). Production `/health` says `version:"main"`, which the CI path never produces (CI `sed`s `prod-<sha>`, `oursharedevents-ci.yml:2307`), so nobody can tell which build is live.                                                                                                                                                                                                                                                                                                                                                                                                     |
| DevOps + DevOps Mgr    | The checklist had no deploy step. `deploy-production` needs `functional-staging` (CI `deploy-production.needs`). T4 has failed on the last 4 pushes to `main` with `OCR_CI_EDGE_TOKEN is not set` (run 36915116607). Pinning `CF_ACCESS_AUD` is a `wrangler.toml` change, so it also needs a deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dr of Security         | **S-a:** production `CF_ACCESS_AUD = ""` (`wrangler.toml:333`), so a JWT from any Access app on team `mzdano` verifies on production. The staging app's AUD is `5c42a434…` (live probe). Already tracked as S10 / OSE-1377. **S-b:** production `ALLOW_OCR_INTERNAL = "true"` (`wrangler.toml:324`), a header-only admin path that skips Access. It is contained because key actors are deny-scoped (`admin-brand-scope.ts:69-70`), create is refused (`events.ts:519-520`), and platform routes need `all`. No workflow sends the header to production (`git grep` empty), and CLAUDE.md §4 says the fallbacks are staging-only, so the docs have drifted. **S-c:** `ALLOWED_ADMIN_DOMAINS = "oursharedevents.com"`, so the Access policy should be the single email, not the domain. `www` → 301 to the apex (live probe), so `www` is not a bypass. |
| Sr Data Scientist      | `main` added a production BigQuery step (runbook: create `oureventring_general` + `corridor_returns_export` before the first `0 3 * * *` UTC export) and a 0091 purge. Neither was in the checklist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Scoring Worksheet — Loop 1

| Item                                            | Tier     | Sev      | State | Evidence                                                                                        | Deduction            |
| ----------------------------------------------- | -------- | -------- | ----- | ----------------------------------------------------------------------------------------------- | -------------------- |
| Environmental assumptions verified              | Base     | —        | P     | Production D1 and secrets unread                                                                | 7.5                  |
| Full surface mapped                             | Base     | —        | P     | Admin path inventory not yet done                                                               | 7.5                  |
| Partial fix risk assessed                       | Base     | —        | V     | Canary would stay red on `/api/v2/admin`, so a partial setup is detectable                      | 0                    |
| Chunk scope correctly defined                   | Base     | —        | V     | Step 1 only                                                                                     | 0                    |
| Human gate not bypassed                         | Base     | —        | V     | No production writes were made                                                                  | 0                    |
| F1 Access app covers every Worker-guarded path  | Variable | Critical | U     | `router.ts:570,1708`; live `api-admin:401` with no redirect; 3 extra path groups → ×log₂4 = 2.0 | 30.0                 |
| F2 Production deploy step present and unblocked | Variable | Critical | U     | `/health` `version:"main"`; T4 red on `OCR_CI_EDGE_TOKEN`                                       | 15.0                 |
| F3 `CF_ACCESS_AUD` pinned                       | Variable | Medium   | U     | `wrangler.toml:333`                                                                             | 5.0                  |
| F4 Sign-in verification observable              | Variable | Medium   | U     | `events.ts:318-322`, migration 0086                                                             | 5.0                  |
| **Score**                                       |          |          |       |                                                                                                 | **100 − 70 = 30.0%** |

**Corrections L1→2:** checklist rewritten with full Access path list (F1), deploy step + `OCR_CI_EDGE_TOKEN` prerequisite (F2), AUD pin PR (F3), `filters`-key check (F4). Surface base item now Verified (router inventory + probes of apex, `www`, api, staging).

## Scoring Worksheet — Loop 2 (new findings × 1.25)

| Item                                                 | Sev    | State | Evidence                                                         | Deduction              |
| ---------------------------------------------------- | ------ | ----- | ---------------------------------------------------------------- | ---------------------- |
| Environmental assumptions                            | Base   | P     | Unchanged                                                        | 7.5                    |
| F5 Production `ALLOW_OCR_INTERNAL=true` unaddressed  | Medium | U     | `wrangler.toml:324`; contained, see Dr of Security               | 6.25                   |
| F6 Post-deploy runbook steps from `main` missing     | Medium | U     | `git diff HEAD origin/main -- RUNBOOK-DEPLOYMENT.md` (+66 lines) | 6.25                   |
| F7 Access policy should be the email, not the domain | Low    | U     | `wrangler.toml` `ALLOWED_ADMIN_DOMAINS`                          | 2.5                    |
| F1–F4                                                | —      | V     | Corrected in the artifact                                        | 0                      |
| **Score**                                            |        |       |                                                                  | **100 − 22.5 = 77.5%** |

**Corrections L2→3:** added the F5 ticket/PR item, the F6 runbook steps, and the F7 policy guidance.

## Scoring Worksheet — Loop 3 (new findings × 1.5)

| Item                                                      | Sev  | State | Evidence                       | Deduction             |
| --------------------------------------------------------- | ---- | ----- | ------------------------------ | --------------------- |
| Environmental assumptions                                 | Base | P     | Production D1 + secrets unread | 7.5                   |
| F8 A green canary does not prove `/manage` or `/briefing` | Low  | V     | Corrected with per-path curl   | 0 (3.0 before fix)    |
| F1–F7                                                     | —    | V     | In the artifact                | 0                     |
| **Score**                                                 |      |       |                                | **100 − 7.5 = 92.5%** |

No decay (30 → 77.5 → 92.5). **Below 95%, so the human gate applies.**

## Human gate — what closes the last 7.5

1. Production D1: `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1;` and `SELECT * FROM admin_brand_memberships;` (expected `0092_…`, or below that if production is behind; 0–2 rows).
2. `npx wrangler secret list --env production`: is `X_OCR_INTERNAL` set (which decides whether F5 is live or latent), and is everything from `scripts/set-secrets.sh production` present?
3. `OCR_CI_EDGE_TOKEN` repo secret set, and `main` T1–T4 green.

## Revised checklist (the corrected artifact)

0. **Unblock deploys** (separate terminal): set the `OCR_CI_EDGE_TOKEN` repo secret, then re-run `main` and confirm T1–T4 green.
1. **Production Access app**, host `oursharedevents.com`, paths: `admin`, `admin/*`, `manage`, `api/v2/admin`, `api/v2/admin/*`, `briefing`, `overview`, `summary`. Policy: Allow → Emails → `mzdano@gmail.com` (not the domain). Copy the AUD tag.
   Verify: each path → `302` to `mzdano.cloudflareaccess.com/cdn-cgi/access/login/oursharedevents.com`; re-dispatch CF Access Canary → production `access_ok`.
2. **PR (non-secret):** production `CF_ACCESS_AUD = "<aud>"` (OSE-1377). In the same PR or a ticket: production `ALLOW_OCR_INTERNAL = "false"`.
3. **Deploy production** (`deploy_production=PRODUCTION` dispatch). Verify `/health` `version` = `prod-<sha>`.
4. **D1 rows:** founder `root` (runbook OSE-1415) + `ose-platform` (OSE-1447, `--env production`); run both SELECT verifies.
5. **Post-deploy steps from `main`'s runbook:** 0088 backfill, 0091 purge, BigQuery dataset + `corridor_returns_export` before 03:00 UTC.
6. **Sign in:** `GET /api/v2/admin/events` returns `ok:true` **and has a `filters` key**; `GET /briefing` → 200.
7. **`PRODUCTION_LIVE=true`** after the production smoke passes.
8. **Tickets:** `/health` `_debug` + `version`; production `ALLOW_OCR_INTERNAL`; CLAUDE.md §4 drift on fallbacks.

## Post-assessment update (2026-10-02)

The loop scores and worksheets above are left as assessed. Corrections found after Loop 3 are recorded here.

**Evidence base:** `origin/main` @ `876554d4` and live probes on 2026-10-02.

| Item                                 | Change                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F5 (production `ALLOW_OCR_INTERNAL`) | **Closed on `main`** by ADR-012 gate R2 (OSE-1467): the flag and `ALLOW_ADMIN_KEY_FALLBACK` are absent from `[env.production.vars]`, locked by a spec. The deployed production Worker still has the old config until the next deploy.                                                                         | `tests/prod-admin-scope-config.spec.ts` (`%s is NOT set in [env.production.vars]`); `wrangler.toml` production comment              |
| New deploy precondition              | `deploy-production` refuses to run while `ADMIN_KEY`, `X_OCR_INTERNAL` or `ADMIN_TOKEN` is set as a production Worker secret. This goes into the checklist before the deploy step.                                                                                                                            | `oursharedevents-ci.yml` "static admin credentials must be ABSENT on production" loop                                               |
| F1 path list                         | **8 path groups, not 6.** `/dashboard` and `/create` are `requireAdmin` aliases too. The revised checklist step 1 above (and its `admin/*` / `api/v2/admin` split) is replaced by `scripts/ci/access-protected-paths.txt`, which a router-derived test now locks.                                             | `router.ts` admin aliases block (`/manage`, `/dashboard`, `/create`); `tests/integration/access-protected-paths.test.js` (47 sites) |
| Staging gap (new)                    | Staging's Access app covers `admin`, `manage` and `api/v2/admin/*` only. `/dashboard`, `/create`, `/briefing`, `/overview` and `/summary` reach the Worker unauthenticated and return 401, so the runbook's "`GET /briefing` returns 200" could not pass on staging either.                                   | Canary loop run locally: staging 3 `access_ok`, 5 `no_access`                                                                       |
| F8 (canary coverage)                 | **Fixed durably** in PR #756: the canary probes every line of the path file, and the test fails if the router guards a group the file misses. Born-red against 4 injected faults.                                                                                                                             | PR #756                                                                                                                             |
| Production build age (new)           | Production predates 2026-09-30: `/sponsor-default-logo.svg` returns 404 on production and 200 on staging. Its `/health` version is `main`, so the exact build is unknown. Bocce setup (sponsor logos, TV display screens, league links) needs the deploy first.                                               | Live probe 2026-10-02                                                                                                               |
| Ordering                             | Only three dependencies are real: Access must cover every guarded path before sign-in; the app exists before the AUD pin; the pin and the post-deploy steps need a deploy. The membership rows are inert without an Access identity, so they can go in at any point. Admin-ready needs no deploy; Bocce does. | `auth/admin.ts` `requireAdmin`; `lib/admin-brand-scope.ts`                                                                          |

**Score:** unchanged at **92.5%**. The open item is still the environmental-assumptions base item (production D1 and production secrets unread), so the human gate stands. F5 closing removes no deduction, because Loop 3 had already scored it Verified as a checklist item.

**Current checklist** (replaces "Revised checklist" above):

**Admin-ready, no deploy needed:**

1. Production Access app: the 8 destinations in `scripts/ci/access-protected-paths.txt`, a policy that allows only `mzdano@gmail.com`. Copy the AUD tag, then verify with the runbook loop.
2. Staging Access app: add `dashboard`, `create`, `briefing`, `overview`, `summary`.
3. Production D1 rows: `root` (OSE-1415) and `ose-platform` (OSE-1447).
4. Sign in: `GET /api/v2/admin/events` has a `filters` key, and `GET /briefing` returns 200.

**Before Bocce setup:**

5. Set the `OCR_CI_EDGE_TOKEN` repo secret, then confirm `main` T1–T4 green.
6. Delete `ADMIN_KEY`, `X_OCR_INTERNAL` and `ADMIN_TOKEN` from production secrets if present.
7. PR pinning production `CF_ACCESS_AUD` (OSE-1377).
8. Deploy production. `/health` version shows `prod-<sha>`.
9. Post-deploy runbook steps: 0088 backfill, 0091 purge, BigQuery dataset and table before 03:00 UTC.
10. `PRODUCTION_LIVE=true` after the production smoke passes.

**Ticket:** production `/health` exposes `_debug`.
