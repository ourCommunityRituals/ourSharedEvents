# Secrets & Environment Variables Reference

> **Story 2** - Confirm Secrets & Environment Variables
>
> This document provides a comprehensive inventory of all secrets and environment
> variables required by the EventAngle platform. It covers GitHub Actions secrets,
> Cloudflare Worker secrets, and test environment variables.

## Overview

The EventAngle platform relies on multiple secrets for:

- **Google Sheets API** - Service account authentication for data access
- **Cloudflare Workers** - Deployment and routing configuration
- **Admin Authentication** - API endpoint security
- **Google Apps Script** - Legacy backend deployment
- **CI/CD Notifications** - Slack/Teams webhooks

**Security Principles:**

- Never store secrets in source code or `wrangler.toml`
- Use GitHub Secrets for CI/CD and Wrangler secrets for Workers
- Rotate credentials according to the documented schedule
- Separate staging and production credentials

---

## Quick Reference

### Required GitHub Secrets (Staging)

| Secret                          | Category    | Required For              |
| ------------------------------- | ----------- | ------------------------- |
| `GOOGLE_CLIENT_EMAIL`           | Google      | Sheets API authentication |
| `GOOGLE_PRIVATE_KEY`            | Google      | Sheets API authentication |
| `STAGING_SHEETS_SPREADSHEET_ID` | Google      | Staging database          |
| `CLOUDFLARE_API_TOKEN`          | Cloudflare  | Worker deployment         |
| `CLOUDFLARE_ACCOUNT_ID`         | Cloudflare  | Worker deployment         |
| `OAUTH_CREDENTIALS`             | Apps Script | GAS deployment            |
| `ADMIN_KEY_ROOT`                | Admin       | Stage-2 E2E testing       |

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

### 1. Google Service Account (Google Sheets API)

**Purpose:** Authenticate with Google Sheets API for backend data access.

**Environment:** Staging + Production (separate credentials recommended)

**Rotation Policy:** Every 90 days

| Secret Name                     | Description                            | Required |
| ------------------------------- | -------------------------------------- | -------- |
| `GOOGLE_SA_CLIENT_EMAIL`        | Service account email (new naming)     | No\*     |
| `GOOGLE_SA_PRIVATE_KEY_PEM`     | PEM-formatted private key (new naming) | No\*     |
| `GOOGLE_CLIENT_EMAIL`           | Service account email (legacy naming)  | Yes\*    |
| `GOOGLE_PRIVATE_KEY`            | Private key (legacy naming)            | Yes\*    |
| `STAGING_SHEETS_SPREADSHEET_ID` | Staging spreadsheet ID                 | Yes      |

_\* Either new naming (`GOOGLE*SA*_`) or legacy naming (`GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY`) is required. The system supports both with automatic fallback.\*

**Setting in GitHub:**

```bash
# Navigate to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
# Add new repository secret: GOOGLE_CLIENT_EMAIL
# Value: your-service-account@project.iam.gserviceaccount.com
```

**Setting in Cloudflare Worker:**

```bash
cd worker
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
wrangler secret put SHEETS_SPREADSHEET_ID --env staging
```

**Key Format Notes:**

The private key must be in PEM format with proper markers:

```
-----BEGIN PRIVATE KEY-----
MIIEvQ...base64 content...
-----END PRIVATE KEY-----
```

If copying from a JSON key file, convert `\n` to actual newlines:

```bash
cat credentials.json | jq -r '.private_key'
```

---

### 2. Cloudflare Deployment

**Purpose:** Deploy and manage Cloudflare Workers.

**Environment:** Both (same credentials)

**Rotation Policy:** 90 days (per SEC-1.2)

> **Security Policy (SEC-1.2):** All Cloudflare API tokens must be scoped with least-privilege permissions.
> Global API keys (`CF_API_KEY`, `CLOUDFLARE_API_KEY`) are **PROHIBITED**.
> See [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) for details.

| Secret Name             | Description                            | Required |
| ----------------------- | -------------------------------------- | -------- |
| `CLOUDFLARE_API_TOKEN`  | Scoped API token for Worker deployment | Yes      |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier          | Yes      |

**Alternative Naming (SEC-1.2 standard):**
| Current Name | Recommended Name | Purpose |
|--------------|------------------|---------|
| `CLOUDFLARE_API_TOKEN` | `CF_DEPLOY_TOKEN` | CI/CD Worker deployment |
| `CLOUDFLARE_ACCOUNT_ID` | `CF_ACCOUNT_ID` | Account identifier |

**Required API Token Permissions (Least-Privilege):**

- Workers Scripts: Edit
- Workers Routes: Edit
- Account Settings: Read

**Zone Restrictions:**

- Zone: `eventangle.com` only

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
4. Set Zone Resources to **Specific zone: eventangle.com**
5. Add to GitHub Secrets as `CLOUDFLARE_API_TOKEN` (or `CF_DEPLOY_TOKEN`)
6. Find Account ID in the Cloudflare dashboard URL or Overview page
7. Add to GitHub Secrets as `CLOUDFLARE_ACCOUNT_ID`

**Verification (SEC-1.2 Compliance):**

```bash
# Token should work for Worker operations
CLOUDFLARE_API_TOKEN=<token> wrangler whoami

# Token should NOT work for DNS (expected to fail)
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer <token>" | jq '.success'
# Expected: false (permission denied)
```

---

### 3. Admin Authentication

**Purpose:** Secure admin API endpoints for event management.

**Environment:** Stage-2 testing (Staging + Production)

**Rotation Policy:** Every 90 days

| Secret Name      | Description                                | Required      |
| ---------------- | ------------------------------------------ | ------------- |
| `ADMIN_KEY_ROOT` | Root brand admin key                       | Yes (Stage-2) |
| `ADMIN_KEY_ABC`  | ABC brand admin key                        | No            |
| `ADMIN_KEY_CBC`  | CBC brand admin key                        | No            |
| `ADMIN_KEY_CBL`  | CBL brand admin key                        | No            |
| `ADMIN_TOKEN`    | Bearer token for Worker (set via wrangler) | No            |

**Multi-Brand Support:**

The system supports multiple brands with separate admin keys. If brand-specific
keys are not configured, the system falls back to `ADMIN_KEY_ROOT`.

**Setting in Cloudflare Worker:**

```bash
cd worker
wrangler secret put ADMIN_TOKEN --env staging
wrangler secret put ADMIN_TOKEN --env production
```

---

### 4. Google Apps Script (Legacy)

**Purpose:** Deploy to Google Apps Script backend (being phased out in favor of Worker-only mode).

**Environment:** Both

**Rotation Policy:** On expiration (OAuth tokens refresh automatically)

| Secret Name             | Description                               | Required |
| ----------------------- | ----------------------------------------- | -------- |
| `OAUTH_CREDENTIALS`     | Clasp OAuth credentials (~/.clasprc.json) | Yes      |
| `STAGING_SCRIPT_ID`     | Staging Apps Script project ID            | No       |
| `PROD_SCRIPT_ID`        | Production Apps Script project ID         | No       |
| `STAGING_DEPLOYMENT_ID` | Staging deployment ID                     | No       |
| `PROD_DEPLOYMENT_ID`    | Production deployment ID                  | No       |

**Setting Up OAUTH_CREDENTIALS:**

1. Install clasp: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Copy the contents of `~/.clasprc.json`
4. Add to GitHub Secrets as `OAUTH_CREDENTIALS`

**Expected JSON Structure:**

```json
{
  "token": {
    "access_token": "...",
    "refresh_token": "...",
    "scope": "...",
    "token_type": "Bearer",
    "expiry_date": 1234567890
  },
  "oauth2ClientSettings": {
    "clientId": "...",
    "clientSecret": "..."
  }
}
```

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

### 6. Testing Configuration (Stage-2)

**Purpose:** Configure Playwright tests and test data access.

**Environment:** CI/CD testing

**Rotation Policy:** Not sensitive (can be static)

| Secret Name               | Description                 | Required |
| ------------------------- | --------------------------- | -------- |
| `SPREADSHEET_ID_ROOT`     | Root brand test spreadsheet | No       |
| `SPREADSHEET_ID_ABC`      | ABC brand test spreadsheet  | No       |
| `SPREADSHEET_ID_CBC`      | CBC brand test spreadsheet  | No       |
| `SPREADSHEET_ID_CBL`      | CBL brand test spreadsheet  | No       |
| `CF_ACCESS_CLIENT_ID`     | Cloudflare Access client ID | No       |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access secret    | No       |

---

## Environment Variables (Non-Secret)

These are configured in workflow files or `wrangler.toml`, not as secrets:

| Variable       | Description                             | Default                    |
| -------------- | --------------------------------------- | -------------------------- |
| `BASE_URL`     | Target URL for Playwright tests         | https://stg.eventangle.com |
| `CI`           | CI environment flag                     | Set by GitHub Actions      |
| `WORKER_ENV`   | Worker environment (staging/production) | Set in wrangler.toml       |
| `BACKEND_MODE` | Backend mode (worker/gas/mixed)         | worker                     |
| `DEBUG_LEVEL`  | Logging level (debug/error)             | error                      |

---

## Cloudflare Worker Secrets

Secrets that must be set in Cloudflare (not GitHub):

| Secret                      | Description              | Command                                                       |
| --------------------------- | ------------------------ | ------------------------------------------------------------- |
| `GOOGLE_SA_CLIENT_EMAIL`    | Service account email    | `wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging`    |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Private key (PEM format) | `wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging` |
| `SHEETS_SPREADSHEET_ID`     | Database spreadsheet ID  | `wrangler secret put SHEETS_SPREADSHEET_ID --env staging`     |
| `ADMIN_TOKEN`               | Admin bearer token       | `wrangler secret put ADMIN_TOKEN --env staging`               |

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
curl -s https://stg.eventangle.com/api/health/backend | jq

# Production
curl -s https://www.eventangle.com/api/health/backend | jq
```

**Expected Response:**

```json
{
  "ok": true,
  "env": "staging",
  "backend": "cloudflare",
  "googleAuth": "service_account",
  "token": "ok",
  "sheetsProbe": {
    "ok": true,
    "status": 200,
    "latencyMs": 245
  }
}
```

### Error Codes

| Error Code                          | Meaning             | Action                                                       |
| ----------------------------------- | ------------------- | ------------------------------------------------------------ |
| `GOOGLE_AUTH_MISSING_SECRET`        | Missing credentials | Set `GOOGLE_SA_CLIENT_EMAIL` and `GOOGLE_SA_PRIVATE_KEY_PEM` |
| `GOOGLE_AUTH_KEY_IMPORT_FAILED`     | Invalid PEM format  | Check key format and line breaks                             |
| `GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED` | OAuth failed        | Verify Sheets API is enabled in GCP                          |
| `SHEETS_READ_FAILED`                | Can't read sheet    | Share sheet with service account                             |
| `SHEETS_DB_ID_MISSING`              | Missing sheet ID    | Set `SHEETS_SPREADSHEET_ID`                                  |

---

## Rotation Schedule

| Secret Type                 | Rotation Period | Next Rotation     |
| --------------------------- | --------------- | ----------------- |
| Google Service Account Keys | 90 days         | Check GCP Console |
| Admin Keys                  | 90 days         | Manual tracking   |
| Cloudflare API Token        | As needed       | On compromise     |
| OAuth Credentials           | Auto-refresh    | N/A               |

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

### Private Key Formatting Issues

If authentication fails, check the key format:

```bash
# Extract and verify key from JSON
cat credentials.json | jq -r '.private_key' | head -n 3
# Should show: -----BEGIN PRIVATE KEY-----
```

### Missing Secrets in CI

Run the verification script locally:

```bash
# Set environment variables for testing
export GOOGLE_CLIENT_EMAIL="test@example.iam.gserviceaccount.com"
export GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
node scripts/verify-secrets.js --json
```

---

## Security Best Practices

1. **Never commit secrets** - Use `.gitignore` to exclude credential files
2. **Use separate service accounts** - One per environment (staging/production)
3. **Principle of least privilege** - Only grant necessary permissions
4. **Rotate regularly** - Follow the rotation schedule above
5. **Audit access** - Review Google Cloud audit logs periodically
6. **Mask in logs** - GitHub Actions automatically masks secret values

---

## Related Documentation

- [RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md](./RUNBOOK-SEC-1.2-SCOPED-API-TOKENS.md) - Scoped API tokens runbook (SEC-1.2)
- [RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md](./RUNBOOK-SEC-1-CLOUDFLARE-ACCOUNT.md) - MFA enforcement runbook (SEC-1.1)
- [APPS_SCRIPT_API_SETUP.md](./APPS_SCRIPT_API_SETUP.md) - Google Apps Script setup
- [RUNBOOK.md](./RUNBOOK.md) - Operations runbook
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD pipeline documentation
- [Wrangler Secrets Documentation](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare API Token Documentation](https://developers.cloudflare.com/api/tokens/)

---

**Last Updated:** 2025-12-20 (SEC-1.2 - Scoped API Tokens)
