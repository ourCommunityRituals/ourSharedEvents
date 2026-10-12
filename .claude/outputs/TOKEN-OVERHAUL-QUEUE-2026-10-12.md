# Token overhaul queue

**Read on 2026-10-12, read-only, names and dates only. No value was read, printed or stored.**

Sources:

- `gh secret list` (repo, the three environments, org)
- `wrangler secret list` (staging, production)
- the workflows on `main` (`secrets.*` references)
- OSE-1467 and OSE-1490
- `.ocr-standards/standards/OCR_STANDARD_secretsAndTokens.md` (status: PROPOSED under ADR-012)

Every step below is yours to run in your own terminal. Agents do not set, rotate or read secrets (AGENTS.md).

## 1. Do first

| #   | What                                                                                                                         | Why now                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Revoke the Anthropic API key in `~/.claude/config.json`** (`primaryApiKey`; also remove the `customApiKeyResponses` entry) | Printed into a session transcript on 2026-10-11. Revoke it; a rotation that keeps the old key alive does not help.                                                       |
| 2   | **Rotate `OCR_PROPAGATE_TOKEN`** (org secret), then **delete the old token**                                                 | Write access to every org repo. Listed as exposed in OSE-1467. Secret dated **2026-04-06**, about 6 months old. Updating the secret alone does not revoke the old token. |
| 3   | **Rotate `CLOUDFLARE_API_TOKEN_OSE`**                                                                                        | Deploy plus D1 read/write on staging **and** production. Exposed per OSE-1467. Secret dated 2026-08-31, so not rotated since the 2026-10-01 inventory.                   |

## 2. Rotate (exposed per OSE-1467, all still dated 2026-08-31)

| Secret (repo level)                              | Used by                                                                | Note                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_KEY`                                      | 15 workflow references; also a Worker secret on staging and production | Rotate the GitHub secret and both Worker secrets together, as **separate** staging and production values (ADR-012 Phase 1).             |
| `X_OCR_INTERNAL`                                 | 10 references; Worker secret on **staging only**                       | Production does not have it (checked 2026-10-12), so OSE-1467's "check production, delete if set" box can be ticked: nothing to delete. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | 18 and 22 references                                                   | One pair today. The standard wants one pair per environment.                                                                            |
| `CLOUDFLARE_ACCOUNT_ID`                          | 26 references                                                          | An identifier, not a credential. No rotation needed.                                                                                    |

Also named as exposed in OSE-1467 but **not in this repo**, so check where they live (OW or the hub):

- `ROBOT_PAT`
- OW's `DOPPLER_TOKEN_STG` and `DOPPLER_TOKEN_PRD`
- OW's `ANTHROPIC_API_KEY`

## 3. Create (referenced by workflows, not set anywhere)

| Secret                                                        | Workflow                                                  | What happens without it today                                                                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`                                     | `claude-review.yml`                                       | **The Claude PR reviewer skips every PR while its check shows green.** Risk routing (#944) and base-branch instructions (#939) are never exercised. Create with `claude setup-token`. |
| `ANTHROPIC_API_KEY`                                           | `claude-review.yml` (fallback only)                       | Optional. Leave unset if the OAuth token is used; then there is one fewer non-expiring key to rotate.                                                                                 |
| `BRANCH_PROTECTION_READ_TOKEN`                                | `branch-protection-drift.yml`, `oursharedevents-ci.yml`   | The workflow says "Branch protection settings are not being verified". Fine-grained, one repo, read-only.                                                                             |
| `STAGING_ADMIN_KEY`, `SECURITY_WEBHOOK_URL`, `LINEAR_TEAM_ID` | `security-monitoring.yml`, `premature-close-detector.yml` | Monitoring runs without admin health checks, alerts or Linear filing. Check each job's log; do not trust the green check.                                                             |
| `STAGING_BASE_URL`                                            | `security-monitoring.yml`                                 | Has a default (`https://stg.oursharedevents.com`). It is a URL, not a secret; better as a repo **variable**, or drop it.                                                              |
| `OSE_ADMIN_BEARER`                                            | `mobile-workability-audit.yml` (deployed-staging job)     | That job skips `/admin`. The blocking PR-code audit does not use it. Decide whether to keep the deployed-staging job at all.                                                          |

Repo **variables** that are unset: `PR_REVIEWER` and `RED_TEAM_BASE_URL` (both have working defaults). `PRODUCTION_LIVE` is also unset and **stays unset**: production is on hold by the owner's decision of 2026-10-12. It is not on this queue.

## 4. Delete (set, no longer used)

| What                                                                                                                               | Why                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMOKE_RPT_ADMIN_TOKEN`, `SMOKE_RPT_LOCAL_TOKEN`, `SMOKE_RPT_MID_TOKEN`, `SMOKE_RPT_OTHER_EVENT_TOKEN` (repo secrets, 2026-09-19)  | No workflow reads them from `secrets.*` any more; T4 mints its report tokens per run (`scripts/mint-t4-report-tokens.mjs`, guarded by `scripts/guard-no-smoke-rpt-secrets.mjs`). They are signed report links that still sit in the secret store. |
| Org runner registrations `BLOODRAVEN`, `BLOODRAVEN-2`, `BLOODRAVEN-3` (all offline)                                                | You no longer self-host. Still registered as of 2026-10-12.                                                                                                                                                                                       |
| `.runner`, `.credentials`, `.credentials_rsaparams` in `actions-runner`, `-2`, `-3` under `C:\Users\mzdan\dev\ourCommunityRituals` | Runner credentials for the registrations above. Delete the folders after deregistering.                                                                                                                                                           |

## 5. Production Worker: secrets staging has and production does not

| Secret                                   | Read by                                                                                         | Effect in production                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ANON_ID_HASH_PEPPER`                    | `handlers/data-subject.ts` (erasure checks for it explicitly); `scripts/set-secrets.sh` sets it | Erasure of scan/return rows needs it. Set it before production handles an erasure request.    |
| `GOOGLE_MAPS_API_KEY`                    | `lib/maps.ts`, `lib/geo.ts`, `lib/event-place.ts`                                               | Venue map image and geocoding are off. Related: OSE-1688 (turn on Geocoding, cap the quota).  |
| `WIF_PRIVATE_KEY_PEM`, `WIF_PUBLIC_JWKS` | `cloud/bigquery.ts`, `google/auth.ts`                                                           | BigQuery backup cannot authenticate. A data-protection key: never bulk-written (standard §3). |

Production has: `ADMIN_KEY`, `FORMS_ENCRYPTION_KEY`, `FORMS_HASH_PEPPER`, `RATE_LIMIT_KEY_PEPPER`, `SHARED_REPORT_SIGNING_SECRET`.

**Do not rotate the data-protection keys in this overhaul** (`FORMS_ENCRYPTION_KEY`, the peppers, the signing secrets). OSE-1467 says they were not exposed, and the standard (§2.1) says a key without a keyring rotates only on compromise, because a new value breaks stored data.

## 6. Structure (what the standard asks for, if you want the overhaul to land there)

- **Every secret is at repo level today; the `staging`, `production` and `copilot` environments hold none.** Any job in any workflow can read the production-capable Cloudflare token. The standard wants environment secrets with required reviewers (also OSE-1662).
- **Split the Cloudflare token:** `CF_DEPLOY_STG`, `CF_DEPLOY_PRD`, `CF_READ`, `CF_DNS` (people only), each with a 90-day expiry.
- **Replace `OCR_PROPAGATE_TOKEN` (a PAT) with GitHub Apps:** `ocr-ci-reader` and `ocr-automation`, minted per job.
- **Expiry on everything that can have one (≤ 90 days);** a calendar rotation for keys that cannot (Anthropic, Linear, Google Maps), each with a spend or rate cap.
- **This workstation:** wrangler is logged in with production rights. Deploys go through CI, so consider a read-only or staging-only login here.

## 7. Calendar

| Secret                               | Dated      | 90 days falls on                             |
| ------------------------------------ | ---------- | -------------------------------------------- |
| `LINEAR_API_KEY` (org)               | 2026-08-12 | 2026-11-10                                   |
| `OCR_CI_EDGE_TOKEN`                  | 2026-10-02 | 2026-12-31                                   |
| Whatever is rotated in this overhaul | today      | +90 days: record `expires:` in the inventory |

## 8. Tickets

- **OSE-1490** (`OCR_CI_EDGE_TOKEN`, In Review):
  - the secret exists (2026-10-02);
  - `T4 Functional → Staging` is `success` on `main` (run 38191239228);
  - remaining: note the expiry in the inventory, then it can close.
- **OSE-1467** (In Progress, release-blocking), six boxes:
  - "check production for `X_OCR_INTERNAL`": answered above, not set;
  - the other five are open: rotate and delete `OCR_PROPAGATE_TOKEN`; review the GitHub and Cloudflare audit logs; rotate the Cloudflare/admin/Access credentials per environment; rotate the OW tokens; record the outcome in `OCR_REFERENCE_secretsInventory_2026-10-01.md` §1.

## 9. A safe order

1. Revoke the exposed Anthropic key (#1).
2. Review the two audit logs **before** rotating, so old-token activity is still attributable.
3. Create the new credential → update the secret → push or re-run a job that uses it → confirm green **in the log** → delete the old credential.
4. One credential at a time. Each push cancels the running OSE CI run, so let the verifying run finish.
5. Delete the stale items (section 4).
6. Record names, scopes and expiry dates (never values) in the inventory.

## Not checked

- Secrets in other repos (OW, hub, OCR-docs) and in Doppler.
- Scopes and expiry of any existing token (GitHub and Cloudflare do not show them to `gh` / `wrangler`).
- Whether the missing monitoring secrets make those jobs skip or fail; read their logs.
- Audit logs. That is an OSE-1467 owner action.
