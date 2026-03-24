# Apps Script API Deployment Setup Guide

**🎯 Goal:** Set up service account authentication for automated Apps Script deployments (replacing Clasp).

**⏱️ Time Required:** 15-30 minutes (one-time setup)

---

## Why Service Accounts?

✅ **No OAuth issues** - Service accounts don't expire
✅ **No user credentials** - Designed for automation
✅ **Better security** - Principle of least privilege
✅ **Production-ready** - Official Google API
✅ **Reliable CI/CD** - No token refresh failures

---

## Prerequisites

- Access to your Google Cloud Project
- Owner/Editor permissions on the Google Cloud Project
- Admin access to your Apps Script project

---

## ⚠️ CRITICAL: Two-Step API Enablement Required

**The Apps Script API must be enabled in TWO places:**

1. **Google Cloud Console** (Project level) ← Enables the API for your GCP project
2. **Apps Script User Settings** (User level) ← Allows YOUR account to use the API

**Both must be enabled or deployments will fail!**

---

## Step 1: Enable Apps Script API (Google Cloud Console)

### 1.1 Go to Google Cloud Console

```
https://console.cloud.google.com
```

### 1.2 Select Your Project

- Click the project dropdown (top bar)
- Select the project associated with your Apps Script
- If you don't know which project, check in Apps Script:
  - Open your Apps Script project
  - Click "Project Settings" (gear icon)
  - Look for "Google Cloud Platform (GCP) Project number"

### 1.3 Enable Apps Script API (Project Level)

1. Go to **APIs & Services** → **Library**
2. Search for "**Apps Script API**"
3. Click "**Google Apps Script API**"
4. Click "**ENABLE**"

✅ **Checkpoint:** Apps Script API should now show as "Enabled"

### 1.4 Enable Apps Script API (User Level) 🆕 CRITICAL!

**THIS STEP IS OFTEN MISSED BUT REQUIRED!**

1. Visit: **https://script.google.com/home/usersettings**
2. Toggle ON: **"Google Apps Script API"**
3. You should see: ✅ "Google Apps Script API: ON"

⚠️ **Why this matters:**
- Even if the API is enabled in GCP Console, the PROJECT OWNER must also enable it in their user settings
- Service accounts inherit this permission from the project owner
- Without this, you'll get: "User has not enabled the Apps Script API"

✅ **Checkpoint:** Both API settings should now be enabled

---

## Step 2: Create Service Account

### 2.1 Navigate to Service Accounts

```
https://console.cloud.google.com/iam-admin/serviceaccounts
```

Or: **IAM & Admin** → **Service Accounts**

### 2.2 Create New Service Account

1. Click "**+ CREATE SERVICE ACCOUNT**"
2. Fill in details:
   - **Service account name:** `apps-script-deployer`
   - **Service account ID:** `apps-script-deployer` (auto-filled)
   - **Description:** `Service account for CI/CD deployment to Apps Script`
3. Click "**CREATE AND CONTINUE**"

### 2.3 Grant Permissions

**Grant this service account access to project:**

Select role: **Service Account User**

Click "**CONTINUE**"

### 2.4 Skip User Access (Optional)

Click "**DONE**" (we don't need to grant users access to this service account)

✅ **Checkpoint:** You should see `apps-script-deployer@YOUR_PROJECT.iam.gserviceaccount.com` in the list

---

## Step 3: Create Service Account Key

### 3.1 Open Service Account

- Find `apps-script-deployer` in the service accounts list
- Click the email address to open it

### 3.2 Create JSON Key

1. Go to the "**KEYS**" tab
2. Click "**ADD KEY**" → "**Create new key**"
3. Select "**JSON**" format
4. Click "**CREATE**"

A JSON file will download automatically: `YOUR_PROJECT-xxxxx.json`

⚠️ **SECURITY WARNING:**
- This file contains credentials - treat it like a password
- Never commit it to git
- Store it securely

✅ **Checkpoint:** You should have a JSON file that looks like:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "xxxxx",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "apps-script-deployer@your-project.iam.gserviceaccount.com",
  "client_id": "xxxxx",
  ...
}
```

---

## Step 4: Grant Service Account Access to Apps Script Project

This is the critical step that many guides miss!

### 4.1 Get Your Apps Script Project ID

1. Open your Apps Script project: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click "**Project Settings**" (gear icon on left)
3. Verify the "**Script ID**": `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

### 4.2 Add Service Account as Project Editor

**Method A: Via Apps Script UI (Easier)**

1. In Apps Script project, click "**Share**" (top right)
2. Add the service account email:
   ```
   apps-script-deployer@zeventbooks.iam.gserviceaccount.com
   ```
3. Set role to "**Editor**"
4. **Uncheck** "Notify people"
5. Click "**Share**"

**Method B: Via API (Alternative)**

If the UI method doesn't work, use the API:

```bash
# Install Google Cloud SDK if not already installed
# https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth login

# Grant permission
gcloud projects add-iam-policy-binding zeventbooks \
  --member="serviceAccount:apps-script-deployer@zeventbooks.iam.gserviceaccount.com" \
  --role="roles/owner"
```

✅ **Checkpoint:** Service account email should appear in the "Share" dialog with Editor access

---

## Step 5: Configure GitHub Secrets

### 5.1 Prepare the Service Account JSON

Open the downloaded JSON file and copy its **entire contents**.

### 5.2 Add to GitHub Secrets

1. Go to your GitHub repository:
   ```
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
   ```

2. Click "**New repository secret**"

3. Create first secret:
   - **Name:** `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
   - **Value:** Paste the entire JSON file contents (service account key from zeventbooks project)
   - Click "**Add secret**"

4. Create second secret (if not already exists):
   - **Name:** `SCRIPT_ID`
   - **Value:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
   - Click "**Add secret**"

✅ **Checkpoint:** You should have 2 secrets:
- `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
- `SCRIPT_ID`

---

## Step 6: Verify Setup (Local Test)

Before pushing to CI/CD, test locally:

### 6.1 Install Dependencies

```bash
npm install
```

This installs the `googleapis` package needed for the deployment script.

### 6.2 Set Environment Variables

```bash
# Copy your service account JSON content (from zeventbooks GCP project)
export SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"zeventbooks",...}'

# Set your script ID
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'
```

### 6.3 Test Deployment

```bash
npm run deploy
```

**Expected output:**

```
═══════════════════════════════════════════════════════
  Google Apps Script API Deployment
═══════════════════════════════════════════════════════

🔐 Authenticating with service account...
✅ Authentication successful

📂 Scanning project files...
  📄 Code.gs (SERVER_JS)
  📄 appsscript.json (JSON)
  ... (more files)

📊 Found 15 files to deploy

📤 Uploading files to Apps Script...
✅ Uploaded 15 files successfully

🚀 Creating deployment...
✅ Deployment created successfully
   Deployment ID: AKfycby...
   Web App URL: https://script.google.com/macros/s/xxx/exec

═══════════════════════════════════════════════════════
  ✅ Deployment Complete!
═══════════════════════════════════════════════════════

🌐 Your app is live at:
   https://script.google.com/macros/s/xxx/exec
```

✅ **Checkpoint:** Deployment should complete successfully

---

## Step 7: CI/CD Integration (Already Done!)

The CI/CD pipeline has been updated to use the new deployment method.

The pipeline will:
1. Authenticate with service account (no OAuth!)
2. Upload files via Apps Script API
3. Create deployment
4. Return deployment URL
5. Run tests against deployed version

---

## Troubleshooting

### ⚠️ Error: "User has not enabled the Apps Script API" (MOST COMMON)

**This error means the user-level API setting is not enabled!**

**Solution:**
1. **Project owner** must visit: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. Wait 2-5 minutes for propagation
4. Retry deployment

**Why it happens:**
- The GCP API might be enabled (project level)
- But the user setting is still disabled (user level)
- **BOTH must be enabled!**

**Verification:**
- ✅ If pre-flight check passes but upload fails → This is your issue
- ✅ If you see "Apps Script API is enabled and accessible" followed by upload failure → This is your issue

### Error: "Service account does not have permission"

**Solution:** Make sure you completed Step 4.2 - the service account MUST be added as an Editor to the Apps Script project.

### Error: "Apps Script API has not been used in project"

**Solution:**
1. Enable the Apps Script API in Google Cloud Console (Step 1.3)
2. **ALSO** enable it in user settings (Step 1.4) ← Often missed!

### Error: "Failed to parse SERVICE_ACCOUNT_JSON"

**Solution:** Make sure you copied the ENTIRE JSON file, including all braces `{}`

### Error: "No Apps Script files found"

**Solution:** Make sure you're running from the project root directory where `Code.gs` and `appsscript.json` are located

### Local test works but CI/CD fails

**Solution:**
1. Verify GitHub secrets are set correctly
2. Check that secret names match exactly:
   - `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` (not `SERVICE_ACCOUNT_JSON`)
   - `SCRIPT_ID`
3. Ensure no extra spaces or newlines in secrets

### Pre-flight check passes but deployment fails

**This is the classic "user settings" issue!**

**What's happening:**
- ✅ Read access works (projects.get) → GCP API is enabled
- ❌ Write access fails (projects.updateContent) → User setting is disabled

**Solution:**
1. Go to: https://script.google.com/home/usersettings
2. Enable: "Google Apps Script API"
3. Wait 2-5 minutes
4. Retry

---

## Security Best Practices

### ✅ DO:
- Store service account JSON only in GitHub Secrets
- Use principle of least privilege (only Editor role)
- Rotate keys periodically (every 90 days)
- Monitor service account usage in Cloud Console
- Delete old/unused service accounts

### ❌ DON'T:
- Commit service account JSON to git
- Share service account credentials
- Give service account more permissions than needed
- Use personal OAuth credentials in CI/CD

---

## Comparison: Before vs After

### Before (Clasp with OAuth)

```yaml
❌ User OAuth credentials (expire)
❌ Complex format conversion (3 versions)
❌ Token refresh failures
❌ Credential exposure risks
❌ 200+ lines of validation logic
❌ Ongoing maintenance burden
```

### After (Apps Script API with Service Account)

```yaml
✅ Service account (never expires)
✅ Simple JSON key
✅ No token refresh needed
✅ Secure by design
✅ ~10 lines of clean code
✅ Set it and forget it
```

---

## Next Steps

1. ✅ Service account is set up
2. ✅ GitHub secrets are configured
3. ✅ Local deployment tested
4. 🔄 Push code to trigger CI/CD
5. 🎉 Watch it deploy successfully!

---

## Migration from Clasp

If you have existing Clasp configuration:

### Keep Clasp as Backup (Recommended for 30 days)

```bash
# New deployment method (default)
npm run deploy

# Old Clasp method (backup)
npm run deploy:clasp
```

### Complete Removal (After Successful Migration)

After 30 days of successful API deployments:

```bash
# Remove Clasp from package.json
npm uninstall @google/clasp

# Remove Clasp files
rm -f .clasprc.json .clasp.json

# Remove Clasp scripts
rm -f clasp-deploy.sh deploy-and-get-urls.sh
```

---

## Support

**Issues?**
- Check the Troubleshooting section above
- Review GitHub Actions logs for detailed error messages
- Verify all steps in this guide were completed

**Success?**
🎉 You now have production-grade Apps Script deployment!

---

## References

- [Google Apps Script API Documentation](https://developers.google.com/apps-script/api/reference/rest)
- [Service Account Authentication](https://cloud.google.com/iam/docs/service-accounts)
- [Google Auth Library for Node.js](https://github.com/googleapis/google-auth-library-nodejs)
