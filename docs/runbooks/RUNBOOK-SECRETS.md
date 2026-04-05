# Runbook: Rotating Secrets and Verifying Environment Alignment

> **Purpose:** Procedures for rotating secrets and verifying environment configuration.
> **Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks

---

## Quick Reference

| Action                 | Command                                                       |
| ---------------------- | ------------------------------------------------------------- |
| Verify all secrets     | `node scripts/verify-secrets.js`                              |
| Verify Stage-1 secrets | `node scripts/verify-secrets.js --stage1`                     |
| Verify Stage-2 secrets | `node scripts/verify-secrets.js --stage2`                     |
| List Worker secrets    | `wrangler secret list --env staging`                          |
| Check backend health   | `curl -s https://stg.eventangle.com/api/health/backend \| jq` |

---

## Secrets Inventory

### GitHub Actions Secrets

| Secret                          | Purpose                     | Rotation Period |
| ------------------------------- | --------------------------- | --------------- |
| `GOOGLE_CLIENT_EMAIL`           | Service account email       | 90 days         |
| `GOOGLE_PRIVATE_KEY`            | Service account private key | 90 days         |
| `STAGING_SHEETS_SPREADSHEET_ID` | Staging spreadsheet         | Static          |
| `CLOUDFLARE_API_TOKEN`          | Worker deployment           | As needed       |
| `CLOUDFLARE_ACCOUNT_ID`         | Account identifier          | Static          |
| `ADMIN_KEY_ROOT`                | Root admin key              | 90 days         |
| `ADMIN_KEY_ABC`                 | ABC admin key               | 90 days         |
| `ADMIN_KEY_CBC`                 | CBC admin key               | 90 days         |
| `ADMIN_KEY_CBL`                 | CBL admin key               | 90 days         |

### Cloudflare Worker Secrets

| Secret                      | Purpose                  | Rotation Period |
| --------------------------- | ------------------------ | --------------- |
| `GOOGLE_SA_CLIENT_EMAIL`    | Service account email    | 90 days         |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Private key (PEM)        | 90 days         |
| `SHEETS_SPREADSHEET_ID`     | Database spreadsheet     | Static          |
| `ADMIN_TOKEN`               | Admin API authentication | 90 days         |

---

## Rotating Google Service Account Credentials

### Step 1: Generate New Key in GCP Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to IAM & Admin > Service Accounts
3. Find the service account (e.g., `eventangle-worker@project.iam.gserviceaccount.com`)
4. Click on the service account
5. Go to Keys tab
6. Click "Add Key" > "Create new key"
7. Select JSON format
8. Download the key file

### Step 2: Extract Key Values

```bash
# Extract client email
cat credentials.json | jq -r '.client_email'

# Extract private key (convert \n to real newlines)
cat credentials.json | jq -r '.private_key'
```

### Step 3: Update GitHub Secrets

1. Go to GitHub > Repository > Settings > Secrets and variables > Actions
2. Update `GOOGLE_CLIENT_EMAIL` with new email
3. Update `GOOGLE_PRIVATE_KEY` with new private key

### Step 4: Update Cloudflare Worker Secrets

```bash
# Staging
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging
# Paste: client_email value

wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
# Paste: full private key including BEGIN/END markers

# Production
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env production
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env production
```

### Step 5: Redeploy Workers

```bash
# Staging
wrangler deploy --env staging

# Production
wrangler deploy --env production
```

### Step 6: Verify

```bash
# Check staging
curl -s https://stg.eventangle.com/api/health/backend | jq

# Check production
curl -s https://www.eventangle.com/api/health/backend | jq

# Expected response includes:
# "googleAuth": "service_account"
# "token": "ok"
# "sheetsProbe": {"ok": true}
```

### Step 7: Revoke Old Key

1. Go back to GCP Console > Service Account > Keys
2. Find the old key (by creation date)
3. Click trash icon to delete

---

## Rotating Admin Keys

### Step 1: Generate New Admin Key

```bash
# Generate secure random key
openssl rand -base64 32
```

### Step 2: Update GitHub Secrets

1. Go to GitHub > Settings > Secrets
2. Update `ADMIN_KEY_ROOT` (and brand-specific keys if used)

### Step 3: Update Cloudflare Worker Secrets

```bash
# Staging
wrangler secret put ADMIN_TOKEN --env staging
# Paste new admin key

# Production
wrangler secret put ADMIN_TOKEN --env production
```

### Step 4: Verify

```bash
# Test admin endpoint with new key
curl -s -H "Authorization: Bearer <NEW_KEY>" \
  https://stg.eventangle.com/api/v2/admin/events | jq '.ok'
# Expected: true
```

---

## Rotating Cloudflare API Token

### Step 1: Create New Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template or custom:
   - Workers Scripts: Edit
   - Workers Routes: Edit
   - Account Settings: Read
4. Copy the new token

### Step 2: Update GitHub Secret

1. Go to GitHub > Settings > Secrets
2. Update `CLOUDFLARE_API_TOKEN`

### Step 3: Verify

```bash
# Test token (set in environment)
export CLOUDFLARE_API_TOKEN=<new_token>
wrangler whoami
# Should show account info
```

### Step 4: Revoke Old Token

1. Go back to Cloudflare API Tokens page
2. Find old token
3. Click "Delete"

---

## Verifying Environment Alignment

### Verify Secrets Configuration

```bash
# Full verification
node scripts/verify-secrets.js

# Stage-1 only
node scripts/verify-secrets.js --stage1

# Stage-2 only
node scripts/verify-secrets.js --stage2

# JSON output
node scripts/verify-secrets.js --json
```

### Verify Backend Health

```bash
# Staging backend
curl -s https://stg.eventangle.com/api/health/backend | jq

# Production backend
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

### Verify Worker Environment

```bash
# Check staging worker
curl -s -I https://stg.eventangle.com/ping | grep -E "x-proxied-by|x-worker-version"

# Check production worker
curl -s -I https://www.eventangle.com/ping | grep -E "x-proxied-by|x-worker-version"
```

### List Current Secrets

```bash
# Staging secrets
wrangler secret list --env staging

# Production secrets
wrangler secret list --env production
```

---

## Troubleshooting

### Error: GOOGLE_AUTH_MISSING_SECRET

**Cause:** Missing service account credentials
**Fix:**

```bash
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env <env>
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env <env>
```

### Error: GOOGLE_AUTH_KEY_IMPORT_FAILED

**Cause:** Invalid PEM format or missing line breaks
**Fix:** Ensure the key includes:

```
-----BEGIN PRIVATE KEY-----
<base64 content>
-----END PRIVATE KEY-----
```

### Error: SHEETS_READ_FAILED

**Cause:** Service account doesn't have access to spreadsheet
**Fix:** Share the spreadsheet with the service account email

### Error: SHEETS_DB_ID_MISSING

**Cause:** Missing spreadsheet ID secret
**Fix:**

```bash
wrangler secret put SHEETS_SPREADSHEET_ID --env <env>
```

### Authentication Failures After Rotation

1. Check secrets are updated in both GitHub AND Cloudflare
2. Redeploy workers after secret changes
3. Verify key format (especially newlines in PEM)
4. Check GCP audit logs for auth failures

---

## Related Documentation

- [BASELINE.md](./BASELINE.md) - System baseline documentation
- [CLOUDFLARE_SECRETS.md](./CLOUDFLARE_SECRETS.md) - Full secrets reference
- [.github-secrets-required.json](../.github-secrets-required.json) - Canonical secrets list
