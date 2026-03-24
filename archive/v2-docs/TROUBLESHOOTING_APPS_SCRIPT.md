# Apps Script API Access Troubleshooting

Quick reference guide for fixing Apps Script API access issues.

## Quick Diagnosis

Run the diagnostic tool to identify the exact issue:

```bash
npm run deploy:diagnose
```

This will check all configuration steps and tell you exactly what's wrong.

---

## Most Common Issue (90% of cases)

### ❌ Error: "User has not enabled the Apps Script API"

**Problem:** Apps Script API user setting is not enabled.

**Solution (2 minutes):**

1. **Project owner** must visit: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. You should see: ✅ "Google Apps Script API: ON"
4. Wait 2-5 minutes for propagation
5. Retry deployment: `npm run deploy`

**Why this matters:**
- The GCP API setting enables the API at the **project level**
- The user setting enables the API for the **project owner**
- Service accounts inherit permissions from the project owner
- **BOTH must be enabled!**

---

## Other Common Issues

### 1. Apps Script API Not Enabled in GCP Console

**Symptoms:**
- Error 403 when accessing Apps Script API
- "API has not been used in project" message

**Solution:**

1. Go to: https://console.cloud.google.com/apis/library
2. Search for "Apps Script API"
3. Click "ENABLE"
4. **Also** enable user setting (see above) - often forgotten!

---

### 2. Service Account Not Granted Access

**Symptoms:**
- "Service account does not have permission" error
- 403 error when trying to access the script project

**Solution:**

1. Get service account email from `SERVICE_ACCOUNT_JSON`:
   ```json
   "client_email": "apps-script-deployer@zeventbooks.iam.gserviceaccount.com"
   ```

2. Open Apps Script project: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

3. Click "Share" (top right)

4. Add service account email as **Editor**: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`

5. **Uncheck** "Notify people"

6. Click "Share"

---

### 3. Wrong SCRIPT_ID

**Symptoms:**
- 404 error: "Apps Script project not found"
- "Requested entity was not found" error

**Solution:**

1. Open your Apps Script project: https://script.google.com

2. Click "Project Settings" (gear icon)

3. Copy the "Script ID" (should be: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`)

4. Update environment variable or GitHub secret:
   - Local: `export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'`
   - GitHub: Update `SCRIPT_ID` secret at https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

---

### 4. Invalid Service Account JSON

**Symptoms:**
- "Failed to parse SERVICE_ACCOUNT_JSON" error
- Authentication fails immediately

**Solution:**

1. Verify you copied the **entire** JSON file

2. Check for:
   - Missing opening/closing braces `{}`
   - Truncated content
   - Extra spaces or newlines

3. The JSON should start with:
   ```json
   {
     "type": "service_account",
     "project_id": "...",
   ```

4. The JSON should end with:
   ```json
     "universe_domain": "googleapis.com"
   }
   ```

---

## Diagnostic Steps

### Step 1: Check Environment Variables

```bash
# Check if variables are set
echo $SCRIPT_ID
echo $SERVICE_ACCOUNT_JSON | head -c 50
```

### Step 2: Run Diagnostic Tool

```bash
npm run deploy:diagnose
```

This will:
- ✅ Verify environment variables
- ✅ Test service account authentication
- ✅ Check Apps Script API (GCP level)
- ✅ Check service account access
- ✅ Check Apps Script API (user level) ← **Most important!**

### Step 3: Review Error Messages

The diagnostic tool will tell you:
- ✅ What's working
- ❌ What's broken
- 📋 Exact steps to fix each issue

---

## GitHub Actions Troubleshooting

### Check Secrets Are Set

1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

2. Verify both secrets exist:
   - ✅ `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
   - ✅ `SCRIPT_ID`

3. Update if needed (secrets are encrypted, you can't view them)

### Check Workflow Logs

1. Go to Actions tab in GitHub

2. Click on the failed workflow run

3. Look for the deployment step

4. Check the error message

5. Follow the remediation steps shown

---

## Testing Locally

Before pushing to CI/CD, test locally:

```bash
# Set environment variables
export SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export SCRIPT_ID='your-script-id'

# Run diagnostic
npm run deploy:diagnose

# If diagnostic passes, try deployment
npm run deploy
```

---

## Complete Setup Checklist

Use this checklist to ensure everything is configured:

- [ ] **GCP API Enabled:** Apps Script API is enabled in Google Cloud Console
- [ ] **User Setting Enabled:** Apps Script API is enabled in user settings
- [ ] **Service Account Created:** Service account exists in GCP Console
- [ ] **Service Account Key:** JSON key file downloaded
- [ ] **Script Access:** Service account added as Editor to Apps Script project
- [ ] **SCRIPT_ID Set:** Script ID is correct and set in environment/secrets
- [ ] **SERVICE_ACCOUNT_JSON Set:** Complete JSON is set in environment/secrets
- [ ] **Local Test:** `npm run deploy:diagnose` passes locally
- [ ] **GitHub Secrets:** Both secrets are set in GitHub repository

---

## Reference Links

- **User Settings (CRITICAL!):** https://script.google.com/home/usersettings
- **GCP Console:** https://console.cloud.google.com
- **Apps Script API Library:** https://console.cloud.google.com/apis/library
- **Service Accounts:** https://console.cloud.google.com/iam-admin/serviceaccounts
- **Complete Setup Guide:** [docs/APPS_SCRIPT_API_SETUP.md](./APPS_SCRIPT_API_SETUP.md)

---

## Still Having Issues?

1. Run the diagnostic tool: `npm run deploy:diagnose`
2. Check the complete setup guide: `docs/APPS_SCRIPT_API_SETUP.md`
3. Verify all checklist items above are complete
4. Check GitHub Actions logs for detailed error messages
5. Ensure you're using the correct Google Cloud project

---

## Quick Command Reference

```bash
# Diagnose issues
npm run deploy:diagnose

# Deploy (after fixing issues)
npm run deploy

# View deployment logs (old clasp method)
npm run logs

# Open Apps Script project in browser
npm run open
```

---

## Success Indicators

When everything is working, you should see:

```
✅ Authentication successful
🔍 Verifying Apps Script API access...
✅ Apps Script API read access verified
✅ Apps Script API write access verified
📂 Scanning project files...
📊 Found 15 files to deploy
📤 Uploading files to Apps Script...
✅ Uploaded 15 files successfully
🚀 Creating deployment...
✅ Deployment created successfully
```

If you see this, your configuration is correct and deployments will work reliably.
