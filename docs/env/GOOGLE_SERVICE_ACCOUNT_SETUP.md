# Google Service Account Setup for Sheets API

> **Story 1.1** - Create Google Service Account & Bind to Sheets
> **Story B3** - DevOps: Provision Google Service Account + Share Sheets
>
> Purpose: Give the Worker its own identity to read/write Sheets without user OAuth flows.
> Remove "authorization failed" class of runtime issues by aligning permissions.

## Overview

This guide walks through setting up a Google Service Account that the Cloudflare Worker
uses to access Google Sheets directly. This eliminates the need for user OAuth flows
and provides a stable, server-to-server authentication mechanism.

## Environment Separation (Story B3)

**Important:** Use a distinct service account per environment to prevent cross-environment
contamination and enable independent permission management.

| Environment | Service Account Name | Purpose |
|-------------|---------------------|---------|
| Staging | `eventangle-stg@<project>.iam.gserviceaccount.com` | Staging Worker access |
| Production | `eventangle-prod@<project>.iam.gserviceaccount.com` | Production Worker access |

This separation ensures:
- Staging issues don't affect production
- Credential rotation can be done independently
- Audit logs clearly identify which environment accessed what
- Principle of least privilege is maintained

## Prerequisites

- Google Cloud Console access (same account that owns the spreadsheets)
- Cloudflare account with Workers enabled
- Access to GitHub repository secrets (for CI/CD)

---

## Step 1: Create a Google Cloud Project (if needed)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown (top-left)
3. Click "New Project"
4. Enter project name: `eventangle-sheets-api` (or similar)
5. Click "Create"

> **Note:** You can use an existing project if you have one.

---

## Step 2: Enable Required Google APIs

1. In Google Cloud Console, select your project
2. Go to **APIs & Services** > **Library**
3. Search for and enable the following APIs:

| API | Required | Purpose |
|-----|----------|---------|
| **Google Sheets API** | Yes | Read/write spreadsheet data |
| **Google Drive API** | If reading by file/folder | List files, access by folder ID |

To enable each API:
1. Search for the API name
2. Click on it
3. Click **Enable**

---

## Step 3: Create a Service Account

Create a separate service account for each environment (Story B3).

### For Staging

1. Go to **IAM & Admin** > **Service Accounts**
2. Click **+ Create Service Account**
3. Fill in the details:
   - **Service account name:** `eventangle-stg`
   - **Service account ID:** `eventangle-stg` (auto-generated)
   - **Description:** `Staging service account for Cloudflare Worker to access Google Sheets`
4. Click **Create and Continue**
5. Skip the "Grant this service account access to project" step (click **Continue**)
6. Skip the "Grant users access to this service account" step (click **Done**)

### For Production

Repeat the steps above with:
   - **Service account name:** `eventangle-prod`
   - **Service account ID:** `eventangle-prod`
   - **Description:** `Production service account for Cloudflare Worker to access Google Sheets`

> **Note:** Keep staging and production credentials completely separate. Never reuse
> the same service account across environments.

---

## Step 4: Create and Download Credentials JSON

1. Click on the newly created service account
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Select **JSON** format
5. Click **Create**
6. **Save the downloaded JSON file securely** - you'll need it for the next steps

The JSON file will look like this:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n",
  "client_email": "eventangle-worker@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

**Important values you'll need:**
- `client_email` - The service account email address
- `private_key` - The RSA private key (PEM format)

---

## Step 5: Share Google Sheets with Service Account

For each spreadsheet the Worker needs to access:

1. Open the Google Sheet in your browser
2. Click **Share** (top-right)
3. In the "Add people and groups" field, paste the service account email:
   ```
   eventangle-worker@your-project.iam.gserviceaccount.com
   ```
4. Set permission to **Editor** (for read/write) or **Viewer** (for read-only)
5. Uncheck "Notify people" (service accounts can't receive emails)
6. Click **Share**

### Sheets to Share (Staging First)

| Environment | Spreadsheet | Permission |
|-------------|-------------|------------|
| Staging     | STG Events Sheet | Editor |
| Production  | PROD Events Sheet | Editor (share later once stable) |

> **Note:** Only share staging sheets initially. Share production sheets once the
> integration is verified and stable.

---

## Step 6: Configure Cloudflare Worker Secrets

Add the service account credentials as Worker secrets using the **new naming convention**.

> **Story B3 Naming Convention:**
> - `GOOGLE_SA_CLIENT_EMAIL` - Service account email address
> - `GOOGLE_SA_PRIVATE_KEY_PEM` - PEM-formatted private key
> - `SHEETS_SPREADSHEET_ID` - Canonical spreadsheet ID (also known as `GOOGLE_SHEETS_DB_ID`)

### For Staging

```bash
# Navigate to the worker directory
cd worker

# Set the service account email (new naming convention)
wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging
# Enter: eventangle-stg@your-project.iam.gserviceaccount.com

# Set the private key (paste the entire PEM block including BEGIN/END markers)
wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging
# Paste the private_key value from the JSON file

# Set the spreadsheet ID (canonical database sheet)
wrangler secret put SHEETS_SPREADSHEET_ID --env staging
# Enter: 1abc123xyz... (from https://docs.google.com/spreadsheets/d/{THIS_ID}/edit)
```

### For Production

```bash
cd worker

wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env production
# Enter: eventangle-prod@your-project.iam.gserviceaccount.com

wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env production
# Paste the private_key value from the JSON file

wrangler secret put SHEETS_SPREADSHEET_ID --env production
# Enter the production spreadsheet ID
```

### Environment Variable Reference

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email | `eventangle-stg@project.iam.gserviceaccount.com` |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | RSA private key (PEM format) | `-----BEGIN PRIVATE KEY-----\n...` |
| `SHEETS_SPREADSHEET_ID` | Canonical spreadsheet ID | `1abc123xyz...` |

> **Backend Architect Note:** The `SHEETS_SPREADSHEET_ID` should point to the canonical
> database sheet for the environment. Confirm with the Backend Architect which sheet
> is authoritative before configuring.

### Finding the Spreadsheet ID

The spreadsheet ID is in the URL:
```
https://docs.google.com/spreadsheets/d/1abc123xyz_the_spreadsheet_id_here/edit
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       This is the SHEETS_SPREADSHEET_ID
```

### Legacy Naming (Deprecated)

The following legacy secret names are still supported for backwards compatibility
but should be migrated to the new naming:

| Legacy Name | New Name | Status |
|-------------|----------|--------|
| `GOOGLE_CLIENT_EMAIL` | `GOOGLE_SA_CLIENT_EMAIL` | Deprecated |
| `GOOGLE_PRIVATE_KEY` | `GOOGLE_SA_PRIVATE_KEY_PEM` | Deprecated |

---

## Step 7: Configure GitHub Secrets (for CI/CD)

Add these secrets to GitHub for the CI pipeline:

1. Go to your repository > **Settings** > **Secrets and variables** > **Actions**
2. Add the following secrets:

### ⚠️ IMPORTANT: How to Copy the Private Key

Open your downloaded JSON credentials file. You'll see something like this:

```json
{
  "type": "service_account",
  "project_id": "my-project",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADA...\n-----END PRIVATE KEY-----\n",
  "client_email": "my-sa@my-project.iam.gserviceaccount.com"
}
```

**For `GOOGLE_PRIVATE_KEY`, copy ONLY the value inside the quotes:**

✅ **CORRECT** — paste this:
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
...more lines...
Abc123XYZ==
-----END PRIVATE KEY-----
```

❌ **WRONG** — do NOT paste the field name or outer quotes:
```
"private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...
```

❌ **WRONG** — do NOT paste the whole JSON object:
```
{ "type": "service_account", "private_key": "-----BEGIN...
```

### Extract the Key Using This Command

Run this command to extract the private key from your JSON file:

```bash
# Replace with your actual file path
cat your-service-account.json | jq -r '.private_key'
```

This outputs the raw key ready to paste:
```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASC...
...
-----END PRIVATE KEY-----
```

**No jq?** Use this instead:
```bash
cat your-service-account.json | grep -o '"private_key": "[^"]*"' | sed 's/"private_key": "//;s/"$//' | sed 's/\\n/\n/g'
```

Or on macOS/Linux with Python:
```bash
python3 -c "import json,sys; print(json.load(sys.stdin)['private_key'])" < your-service-account.json
```

Copy the entire output (including the BEGIN/END lines) and paste into the GitHub secret.

### Required Secrets (Story B3)

| Secret Name | Description | Value |
|-------------|-------------|-------|
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email (preferred) | `eventangle-stg@project.iam.gserviceaccount.com` |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Service account private key (preferred) | The entire PEM block from JSON |
| `GOOGLE_CLIENT_EMAIL` | Service account email (legacy, still supported) | `eventangle-stg@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Service account private key (legacy, still supported) | The entire PEM block from JSON |
| `STAGING_SHEETS_SPREADSHEET_ID` | Staging spreadsheet ID | ID for CI connectivity tests |
| `PROD_SHEETS_SPREADSHEET_ID` | Production spreadsheet ID | ID for production Worker API |

### Cloudflare Deployment Secrets

| Secret Name | Description | Required |
|-------------|-------------|----------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for Worker deployment | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Yes |

> **Note:** The CI pipeline supports both new (`GOOGLE_SA_*`) and legacy (`GOOGLE_*`) naming.
> If both are present, the new naming takes precedence.

---

## Step 8: Create a Test Sheet for CI

Create a dedicated test spreadsheet for CI connectivity checks:

1. Create a new Google Sheet named "CI Connectivity Test"
2. Share it with the service account (Editor access)
3. Note the spreadsheet ID from the URL
4. Add it to GitHub secrets as `STAGING_SHEETS_SPREADSHEET_ID`

The CI pipeline will:
1. Read a test cell (e.g., `TEST!A1`)
2. Write a timestamp to verify write access
3. Read back to confirm the write

---

## Step 9: Verify Setup Locally

Run the local connectivity test script:

```bash
# Set environment variables (use new naming convention)
export GOOGLE_SA_CLIENT_EMAIL="eventangle-stg@your-project.iam.gserviceaccount.com"
export GOOGLE_SA_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----
...your key here...
-----END PRIVATE KEY-----"
export SHEETS_SPREADSHEET_ID="your-test-spreadsheet-id"

# Run the connectivity test
npm run test:sheets:connectivity
```

Expected output:
```
Google Sheets Connectivity Test
================================
Service Account: eventangle-stg@your-project.iam.gserviceaccount.com
Spreadsheet ID:  your-test-spreadsheet-id

[1/4] Getting access token... OK (245ms)
[2/4] Reading test cell (TEST!A1)... OK (312ms)
[3/4] Writing timestamp to TEST!B1... OK (287ms)
[4/4] Verifying write... OK (298ms)

All connectivity tests passed!
```

---

## Step 10: Verify via Health Endpoint (Story B3)

After deploying, verify the setup by calling the backend health endpoint:

### Staging Verification

```bash
# Check backend health (Story B3 acceptance criteria)
curl -s https://stg.eventangle.com/api/health/backend | jq
```

**Expected Response (Success):**
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
  },
  "workerVersion": "stg-2025.12.14",
  "timestamp": "2025-12-14T12:00:00Z"
}
```

### Acceptance Criteria (Story B3)

- `/api/health/backend` returns `ok: true` on staging
- No manual Google login required
- If wrong sheet is shared, health returns `ok: false` with explicit error code

### Error Codes

If the health check fails, look for these error codes:

| Error Code | Meaning | Fix |
|------------|---------|-----|
| `GOOGLE_AUTH_MISSING_SECRET` | Missing credentials | Set `GOOGLE_SA_CLIENT_EMAIL` and `GOOGLE_SA_PRIVATE_KEY_PEM` |
| `GOOGLE_AUTH_KEY_IMPORT_FAILED` | PEM parsing failed | Check private key format |
| `GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED` | OAuth token exchange failed | Verify Sheets API is enabled |
| `SHEETS_READ_FAILED` | Sheets API error | Check sheet is shared with service account |
| `SHEETS_DB_ID_MISSING` | `SHEETS_SPREADSHEET_ID` not configured | Set the spreadsheet ID secret |

---

## Troubleshooting

### Error: 403 Forbidden

**Cause:** Service account doesn't have access to the spreadsheet.

**Fix:**
1. Verify the spreadsheet is shared with the correct service account email
2. Check that the service account has Editor (not Viewer) access for write operations
3. Verify you're using the correct spreadsheet ID

### Error: 404 Not Found

**Cause:** Spreadsheet ID is incorrect or sheet/range doesn't exist.

**Fix:**
1. Double-check the spreadsheet ID in the URL
2. Verify the sheet name (e.g., `EVENTS`, `TEST`) exists
3. Check the range is valid (e.g., `TEST!A1`)

### Error: JWT Signature Invalid

**Cause:** Private key is malformed or incorrectly formatted.

**Fix:**
1. Ensure the private key includes `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
2. Check for any extra whitespace or missing newlines
3. Regenerate the key if necessary (Step 4)

### Error: Token Exchange Failed

**Cause:** Google Sheets API not enabled or invalid credentials.

**Fix:**
1. Verify Google Sheets API is enabled (Step 2)
2. Check the client email matches the service account
3. Ensure the private key matches the client email

---

## Security Best Practices

1. **Never commit credentials** - Always use environment variables or secrets managers
2. **Principle of least privilege** - Only share sheets that need to be accessed
3. **Rotate keys periodically** - Create new keys and delete old ones every 90 days
4. **Use separate test sheets** - Don't use production/staging data for CI tests
5. **Monitor API usage** - Check Google Cloud Console for unusual activity

---

## Related Files

- `worker/src/google/auth.ts` - JWT authentication implementation (Story B1)
- `worker/src/google/pem.ts` - PEM key parsing utilities
- `worker/src/sheetsClient.ts` - Sheets API client with retry logic
- `worker/src/handlers/healthBackend.ts` - Backend health endpoint (Story B2)
- `worker/src/env.ts` - Environment variable validation
- `scripts/test-sheets-connectivity.js` - Local connectivity test script
- `.github/workflows/stage1-ci.yml` - CI pipeline with Sheets connectivity job
- `docs/CLOUDFLARE_SECRETS.md` - Cloudflare Worker secrets reference

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12-12 | Initial Story 1.1 implementation |
| 2.0 | 2025-12-14 | Story B3: Environment separation, new naming convention, health verification |
