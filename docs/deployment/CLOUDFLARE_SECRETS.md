# Secrets & Environment Variables Reference

> **Last Updated: 2026-04-09 — corrected for D1-native architecture**

> **Story 2** - Confirm Secrets & Environment Variables
>
> This document provides a comprehensive inventory of all secrets and environment
> variables required by the oursharedevents platform. It covers GitHub Actions secrets,
> Cloudflare Worker secrets, and test environment variables.

## Overview

The oursharedevents platform relies on multiple secrets for:

- **Cloudflare Workers** - Deployment and routing configuration
- **Cloudflare D1** - Edge SQLite database (replaced Google Sheets in Phase 2)
- **Admin Authentication** - API endpoint security
- **Forms Encryption** - AES-GCM encryption for PII in form submissions
- **CI/CD Notifications** - Slack/Teams webhooks (optional)

**Security Principles:**

- Never store secrets in source code or `wrangler.toml`
- Use GitHub Secrets for CI/CD and Wrangler secrets for Workers
- Rotate credentials according to the documented schedule
- Separate staging and production credentials

---

## Quick Reference

### Required GitHub Actions Secrets

| Secret                     | Category   | Required For      |
| -------------------------- | ---------- | ----------------- |
| `CLOUDFLARE_API_TOKEN_OSE` | Cloudflare | Worker deployment |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare | Worker deployment |
| `ADMIN_KEY`                | Admin      | E2E testing       |

### Required Cloudflare Worker Secrets

| Secret                 | Category   | Required For                        |
| ---------------------- | ---------- | ----------------------------------- |
| `ADMIN_KEY`            | Admin      | Bearer token for admin endpoints    |
| `FORMS_ENCRYPTION_KEY` | Encryption | AES-GCM encryption for PII in forms |

### Removed Secrets (Phase 2 D1 Migration)

The following secrets were removed when the data layer migrated from Google Sheets to Cloudflare D1. They are no longer needed.

| Secret                              | Status                         |
| ----------------------------------- | ------------------------------ |
| ~~`GOOGLE_CLIENT_EMAIL`~~           | Removed (Phase 2 D1 migration) |
| ~~`GOOGLE_PRIVATE_KEY`~~            | Removed (Phase 2 D1 migration) |
| ~~`GOOGLE_SA_CLIENT_EMAIL`~~        | Removed (Phase 2 D1 migration) |
| ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~     | Removed (Phase 2 D1 migration) |
| ~~`SHEETS_SPREADSHEET_ID`~~         | Removed (Phase 2 D1 migration) |
| ~~`STAGING_SHEETS_SPREADSHEET_ID`~~ | Removed (Phase 2 D1 migration) |
| ~~`OAUTH_CREDENTIALS`~~             | Removed (Phase 2 D1 migration) |

### Verification

Run the verification script to check your secrets configuration:

```bash
# Check all secrets
node scripts/verify-secrets.js

# Check Stage-1 deployment secrets only
node scripts/verify-secrets.js --stage1

# Check Stage-2 testing secrets only
node scripts/verify-secrets.js --stage2

# JSON output for automation
node scripts/verify-secrets.js --json
```

---

## Secret Categories

### 1. ~~Google Service Account~~ (Removed — Phase 2 D1 Migration)

> **This entire section is deprecated.** The data layer migrated from Google Sheets
> to Cloudflare D1 (edge SQLite). All Google Sheets secrets (`GOOGLE_SA_CLIENT_EMAIL`,
> `GOOGLE_SA_PRIVATE_KEY_PEM`, `SHEETS_SPREADSHEET_ID`) should be **deleted** from
> both GitHub Secrets and Cloudflare Worker secrets if still present.

---

### 2. Cloudflare Deployment

**Purpose:** Deploy and manage Cloudflare Workers.

**Environment:** Both (same credentials)

**Rotation Policy:** 90 days (per SEC-1.2)

> **Security Policy (SEC-1.2):** All Cloudflare API tokens must be scoped with least-privilege permissions.
> Global API keys (`CF_API_KEY`, `CLOUDFLARE_API_KEY`) are **PROHIBITED**.
> See [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) for details.

| Secret Name                | Description                            | Required |
| -------------------------- | -------------------------------------- | -------- |
| `CLOUDFLARE_API_TOKEN_OSE` | Scoped API token for Worker deployment | Yes      |
| `CLOUDFLARE_ACCOUNT_ID`    | Cloudflare account identifier          | Yes      |

**Alternative Naming (SEC-1.2 standard):**
| Current Name | Recommended Name | Purpose |
|--------------|------------------|---------|
| `CLOUDFLARE_API_TOKEN_OSE` | `CF_DEPLOY_TOKEN` | CI/CD Worker deployment |
| `CLOUDFLARE_ACCOUNT_ID` | `CF_ACCOUNT_ID` | Account identifier |

**Required API Token Permissions (Least-Privilege):**

- Workers Scripts: Edit
- Workers Routes: Edit
- Account Settings: Read

**Zone Restrictions:**

- Zone: `oursharedevents.com` only

**Prohibited Permissions (token MUST NOT have):**

- DNS: Edit (use separate `CF_DNS_TOKEN`)
- SSL/TLS: Edit
- Firewall: Edit
- Billing: Read/Edit
- Members: Read/Edit

**Setting Up:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token** → **Edit Cloudflare Workers** template
3. **Verify permissions match least-privilege requirements above**
4. Set Zone Resources to **Specific zone: oursharedevents.com**
5. Add to GitHub Secrets as `CLOUDFLARE_API_TOKEN_OSE` (or `CF_DEPLOY_TOKEN`)
6. Find Account ID in the Cloudflare dashboard URL or Overview page
7. Add to GitHub Secrets as `CLOUDFLARE_ACCOUNT_ID`

**Verification (SEC-1.2 Compliance):**

```bash
# Token should work for Worker operations
CLOUDFLARE_API_TOKEN_OSE=<token> wrangler whoami

# Token should NOT work for DNS (expected to fail)
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer <token>" | jq '.success'
# Expected: false (permission denied)
```

---

### 3. Admin Authentication

**Purpose:** Secure admin API endpoints for event management.

**Environment:** Staging + Production

**Rotation Policy:** Every 90 days

| Secret Name            | Description                             | Required |
| ---------------------- | --------------------------------------- | -------- |
| `ADMIN_KEY`            | Bearer token for admin endpoints        | Yes      |
| `FORMS_ENCRYPTION_KEY` | AES-GCM key for PII encryption in forms | Yes      |

**Setting in Cloudflare Worker:**

```bash
cd workers/oursharedevents
wrangler secret put ADMIN_KEY --env staging
wrangler secret put ADMIN_KEY --env production
wrangler secret put FORMS_ENCRYPTION_KEY --env staging
wrangler secret put FORMS_ENCRYPTION_KEY --env production
```

**Setting in GitHub Actions:**

```bash
# Navigate to: https://github.com/ourCommunityRituals/ourSharedEvents/settings/secrets/actions
# Add: ADMIN_KEY (same value used for E2E tests against staging)
```

---

### 4. ~~Google Apps Script~~ (Removed — Phase 2 D1 Migration)

> **This entire section is deprecated.** Google Apps Script is no longer used.
> All related secrets (`OAUTH_CREDENTIALS`, `STAGING_SCRIPT_ID`, `PROD_SCRIPT_ID`,
> `STAGING_DEPLOYMENT_ID`, `PROD_DEPLOYMENT_ID`) should be **deleted** if still present.

---

### 5. CI/CD Notifications (Optional)

**Purpose:** Send deployment status notifications to Slack/Teams.

**Environment:** Both

**Rotation Policy:** As needed

| Secret Name         | Description                 | Required |
| ------------------- | --------------------------- | -------- |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL  | No       |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams webhook URL | No       |

**Setting Up Slack:**

1. Create a Slack App at https://api.slack.com/apps
2. Enable Incoming Webhooks
3. Add to Workspace and copy webhook URL
4. Add to GitHub Secrets as `SLACK_WEBHOOK_URL`

---

### 6. Testing Configuration

**Purpose:** Configure Playwright tests and Cloudflare Access for CI.

**Environment:** CI/CD testing

**Rotation Policy:** Not sensitive (can be static)

| Secret Name               | Description                 | Required |
| ------------------------- | --------------------------- | -------- |
| `CF_ACCESS_CLIENT_ID`     | Cloudflare Access client ID | No       |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access secret    | No       |

> **Removed:** All `SPREADSHEET_ID_*` secrets are no longer needed (Phase 2 D1 migration).

---

## Environment Variables (Non-Secret)

These are configured in workflow files or `wrangler.toml`, not as secrets:

| Variable       | Description                             | Default                         |
| -------------- | --------------------------------------- | ------------------------------- |
| `BASE_URL`     | Target URL for Playwright tests         | https://stg.oursharedevents.com |
| `CI`           | CI environment flag                     | Set by GitHub Actions           |
| `WORKER_ENV`   | Worker environment (staging/production) | Set in wrangler.toml            |
| `BACKEND_MODE` | Backend mode (worker/gas/mixed)         | worker                          |
| `DEBUG_LEVEL`  | Logging level (debug/error)             | error                           |

---

## Cloudflare Worker Secrets

Secrets that must be set in Cloudflare (not GitHub):

| Secret                 | Description                    | Command                                                  |
| ---------------------- | ------------------------------ | -------------------------------------------------------- |
| `ADMIN_KEY`            | Admin bearer token             | `wrangler secret put ADMIN_KEY --env staging`            |
| `FORMS_ENCRYPTION_KEY` | AES-GCM key for PII encryption | `wrangler secret put FORMS_ENCRYPTION_KEY --env staging` |

> **Removed:** ~~`GOOGLE_SA_CLIENT_EMAIL`~~, ~~`GOOGLE_SA_PRIVATE_KEY_PEM`~~, ~~`SHEETS_SPREADSHEET_ID`~~ — no longer needed after Phase 2 D1 migration.

**List Secrets:**

```bash
wrangler secret list --env staging
wrangler secret list --env production
```

---

## Health Check Verification

After setting secrets, verify the configuration:

### Backend Health Check

```bash
# Staging
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Production
curl -s https://www.oursharedevents.com/api/health/backend | jq
```

**Expected Response:**

```json
{
  "ok": true,
  "env": "staging",
  "version": "1.0.0"
}
```

> **Note:** The health endpoint no longer reports `googleAuth` or `sheetsProbe` fields.
> Those were removed in the Phase 2 D1 migration. The health check validates Worker
> availability and D1 connectivity.

---

## Rotation Schedule

| Secret Type          | Rotation Period   | Next Rotation   |
| -------------------- | ----------------- | --------------- |
| Admin Key            | 90 days           | Manual tracking |
| Forms Encryption Key | 90 days           | Manual tracking |
| Cloudflare API Token | 90 days (SEC-1.2) | On compromise   |

**Rotation Process:**

1. Generate new credential
2. Update GitHub Secret / Wrangler secret
3. Verify with health check
4. Delete old credential (after verification)
5. Update rotation tracking

---

## Troubleshooting

### Secret Not Taking Effect

Cloudflare Workers may need redeployment after secret changes:

```bash
wrangler deploy --env staging
```

### Missing Secrets in CI

Run the verification script locally:

```bash
node scripts/verify-secrets.js --json
```

---

## Security Best Practices

1. **Never commit secrets** - Use `.gitignore` to exclude credential files
2. **Separate staging/production secrets** - Use distinct values per environment
3. **Principle of least privilege** - Only grant necessary permissions
4. **Rotate regularly** - Follow the rotation schedule above
5. **Audit access** - Review Cloudflare audit logs periodically
6. **Mask in logs** - GitHub Actions automatically masks secret values

---

## Related Documentation

- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API tokens runbook (SEC-1.2)
- [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) - MFA enforcement runbook (SEC-1.1)
- [RUNBOOK.md](./RUNBOOK.md) - Operations runbook
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD pipeline documentation
- [Wrangler Secrets Documentation](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare API Token Documentation](https://developers.cloudflare.com/api/tokens/)

---

**Last Updated:** 2026-04-09 (Phase 2 D1 migration cleanup, SEC-1.2 scoped tokens retained)
