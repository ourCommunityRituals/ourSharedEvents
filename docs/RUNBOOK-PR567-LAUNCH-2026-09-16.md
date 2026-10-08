# Runbook — PR #567 (Epic TRIANGLE) → staging → production → ≥95

**Date:** 2026-09-16 · **Branch:** `feat/epic-triangle-event-lifecycle` · **Owner:** DevOps / Matt
**State going in:** PR #567 is CI-green and `mergeStateStatus: CLEAN` (only the draft flag holds merge). The reach-95 _code_ queue is closed. What remains to reach a CCR ≥95 **and** go live is infra — this runbook. All of it runs from **your terminal** (Cloudflare-authed); secrets are typed at the wrangler prompt, never pasted anywhere.

> **Why these steps close ≥95:** the CCR's remaining deductions are (a) the full test pyramid can't run on `feat/*` (−5) and (b) the migration + fail-closed secret are unprovisioned (−2). Step 2 runs the full pyramid; Steps 1+2 provision the secret + apply the migrations. P1-7 (first staging sign-off) is the true critical path to posters and is the point of Step 3.

---

## Preconditions (already done in-repo)

- Migrations **0075** (`events.created_by` + indexes) and **0076** (`event_type_category_registry`) are committed; `REQUIRED_DB_MIGRATION = 76`.
- `SHARED_REPORT_SIGNING_SECRET` is now declared in `.github-secrets-required.json → cloudflareWorker.secrets` (documentation; **not** a CI gate — see note in Step 1).
- D1 database names (from `wrangler.toml`): staging = `ocr-db-staging` / `ocr-forms-db-staging`; production = `ocr-db-production` / `ocr-forms-db-production`.

---

## Step 1 — Provision the signing secret (separate terminal, per env)

`sponsor-home-auth.ts` is **fail-closed**: if `SHARED_REPORT_SIGNING_SECRET` is unset, mint returns null and the **entire `/sponsor` screen + all `/sharedReport` signed links are inert** (the page shows "not valid"). It is shared across both token kinds (OSE-272), so this one secret unblocks both corners.

Generate a strong value (≥32 chars, **different per env**) and set it — the value is typed at the prompt, not on the command line:

```sh
# staging
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # copy this
npx wrangler secret put SHARED_REPORT_SIGNING_SECRET --env staging                # paste at prompt

# production (generate a SEPARATE value)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put SHARED_REPORT_SIGNING_SECRET --env production
```

While you're here, confirm the other worker secrets exist (they should from prior infra work) — the sponsor/forms corners also depend on these:

```sh
npx wrangler secret list --env staging       # expect: SHARED_REPORT_SIGNING_SECRET, FORMS_ENCRYPTION_KEY, ADMIN_TOKEN, X_OCR_INTERNAL
npx wrangler secret list --env production
```

> **Note:** `verify-secrets.js` only checks GitHub-Actions env secrets, **not** wrangler secrets — but as of CCR-PR567 H2 the `deploy-staging` and `deploy-production` jobs **hard-gate** on `wrangler secret list` before the Deploy step, so an unset secret now **fails the deploy** instead of shipping a silent-inert corner. Still run the `wrangler secret list` above at sign-off.

---

## Step 2 — Deploy to staging + run the FULL pyramid

The Bruno/Newman contract + Playwright E2E + staging-mobile tiers **skip on `feat/*`**; this is what makes them run. **Migrations apply automatically** inside the deploy job (the `Apply D1 migrations (main DB)` / `(forms DB)` steps run `wrangler d1 migrations apply {DB,FORMS_DB} --env staging --remote`) — you do **not** run them by hand. A pre-migrate **required-secrets gate** (`Gate: required secrets present (pre-migrate…)`, CCR item 5 + OSE-1343) aborts the deploy _before_ migrate if `SHARED_REPORT_SIGNING_SECRET`, `FORMS_ENCRYPTION_KEY`, or `FORMS_HASH_PEPPER` is unset, so a missing secret fails fast with a clear error rather than migrating and shipping a fail-closed corner inert (or, for the pepper, a masked 503 on register/email-signup).

```sh
gh workflow run "OurSharedEvents CI/CD" \
  --ref feat/epic-triangle-event-lifecycle \
  -f deploy_staging=true \
  -f run_functional=true
gh run watch $(gh run list --workflow "OurSharedEvents CI/CD" --branch feat/epic-triangle-event-lifecycle --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

This fires: `deploy-staging` (applies 0075/0076 to both staging D1s, then `wrangler deploy --env staging`) → `smoke-staging` → `contract-staging` (Bruno) → `functional-staging` (T4). Green here = the full pyramid the PR couldn't run.
_(Alternative: rename the branch to `full-pipeline/*` and push — same trigger, via the `full-pipeline/*` branch-name match in the workflow's push filter.)_

---

## Step 3 — P1-7: smoke the three triangle corners on staging

On `https://stg.oursharedevents.com`, walk the loop by hand (this is the sign-off the whole launch hinges on):

1. `/admin` → create/find an event → **Go live**.
2. Sponsors card → **Sponsor link** (mint) → open the `/sponsor?t=…` link → it must render the sponsor page (**not** "this link isn't valid" — that means the Step-1 secret is unset) → **Accept** a placement.
3. Confirm the accepted sponsor appears on the public `/events/:id` and `/poster`.
4. `/events` discovery loads (search + when-chips), `/poster` prints with QR codes, `/sharedReport` signed link opens.

If `/sponsor` shows "not valid" → the staging secret didn't take; re-do Step 1 and redeploy.

---

## Step 4 — Merge + production

Once staging is green and smoked:

```sh
gh pr ready 567                       # un-draft (signals ready)
# merge PR #567 to main via the UI or:  gh pr merge 567 --squash
```

Push-to-main re-runs `deploy-staging` automatically. Then, with the **production** secret set (Step 1) and staging validated, fire production (migrations apply to prod D1 automatically in the production deploy job's `Apply D1 migrations` steps, behind the same pre-migrate signing-secret gate):

```sh
gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_production=PRODUCTION
```

→ `deploy-production` → `smoke-production`. Posters can print once prod is green (9/24 ideal / 10/1 hard).

---

## Verification checklist

- [ ] `wrangler secret list --env staging` and `--env production` both show `SHARED_REPORT_SIGNING_SECRET`.
- [ ] Staging workflow run all green (deploy → smoke → contract → functional).
- [ ] Staging D1 at migration 76 (`npx wrangler d1 migrations list DB --env staging --remote` shows 0076 applied).
- [ ] `/sponsor?t=…` renders on staging (secret is live).
- [ ] Production run green; `/events`, `/events/:id`, `/poster` serve on `oursharedevents.com`.

## Rollback

- Worker: see [runbooks/ROLLBACK.md](./runbooks/ROLLBACK.md) (revert through CI; switching the production Worker back by hand is break-glass, §6). `npm run deploy:rollback`, named here before 2026-10-07, prints steps for the old Apps Script system.
- Migrations are additive (0075 adds a column + indexes; 0076 adds tables/column) — no destructive down-migration; a Worker rollback to the prior version + the pre-existing schema is safe because the old code doesn't read the new columns.

## Not-yet-a-gate (follow-up, not launch-blocking)

~~`SHARED_REPORT_SIGNING_SECRET` has no CI gate~~ — **DONE (CCR-PR567 H2).** The `deploy-staging` and `deploy-production` jobs now run a `wrangler secret list` presence check before the Deploy step and fail the deploy when the secret is absent, so an unset fail-closed secret can no longer ship a silent-inert `/sponsor` + `/sharedReport` corner.
