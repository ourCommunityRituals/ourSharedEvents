# Google Cloud Secrets Setup Guide

**Purpose:** Complete guide to set up Google Cloud service account and GitHub secrets for automated deployment.

**Last Updated:** 2025-11-13

---

## 📋 Overview

This guide walks you through setting up the required secrets for GitHub Actions to automatically deploy your Apps Script project using the Google Apps Script API.

**What you'll set up:**
1. Service account JSON key from Google Cloud
2. GitHub repository secrets
3. Apps Script project permissions
4. Verification of the complete setup

---

## 🎯 Quick Reference

| Component | Value |
|-----------|-------|
| **Service Account Email** | `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` |
| **Service Account ID** | `103062520768864288562` |
| **Apps Script Project ID** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| **GCP Project** | `zeventbooks` |
| **GitHub Repo** | `zeventbooks/MVP-EVENT-TOOLKIT` |

---

## 🔑 Step 1: Generate Service Account Key

### 1.1 Access Service Account in Google Cloud Console

Go to: https://console.cloud.google.com/iam-admin/serviceaccounts/details/103062520768864288562?project=zeventbooks

You should see the service account: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`

### 1.2 Create a New JSON Key

1. Click on the **KEYS** tab
2. Click **ADD KEY** button
3. Select **Create new key**
4. Choose key type: **JSON**
5. Click **CREATE**

A JSON file will be downloaded to your computer with a name like:
```
zeventbooks-1234567890ab.json
```

### 1.3 Review the JSON Key Structure

Open the downloaded file. It should look like this:

```json
{
  "type": "service_account",
  "project_id": "zeventbooks",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "apps-script-deployer@zeventbooks.iam.gserviceaccount.com",
  "client_id": "103062520768864288562",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/apps-script-deployer%40zeventbooks.iam.gserviceaccount.com"
}
```

**IMPORTANT:** Keep this file secure! Never commit it to git or share it publicly.

---

## 🔐 Step 2: Set Up GitHub Secrets

### 2.1 Access GitHub Secrets Page

Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

### 2.2 Create APPS_SCRIPT_SERVICE_ACCOUNT_JSON Secret

1. Click **New repository secret**
2. Name: `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
3. Value: Copy the **entire contents** of the JSON file from Step 1.3
   - Open the downloaded JSON file in a text editor
   - Select all (Ctrl+A / Cmd+A)
   - Copy (Ctrl+C / Cmd+C)
   - Paste into the secret value field
4. Click **Add secret**

### 2.3 Verify/Create SCRIPT_ID Secret

1. Check if `SCRIPT_ID` secret already exists
2. If not, click **New repository secret**
3. Name: `SCRIPT_ID`
4. Value: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
5. Click **Add secret**

### 2.4 Verify/Create ADMIN_KEY_ROOT Secret

This is the admin key used for E2E tests.

1. Find the admin key in your `Config.gs` file (line ~17)
   ```javascript
   adminSecret: 'YOUR_ADMIN_KEY_HERE'
   ```

2. In GitHub Secrets:
   - Name: `ADMIN_KEY_ROOT`
   - Value: The admin secret from Config.gs
   - Click **Add secret**

**Security Note:** Never commit the actual admin key to git!

---

## ✅ Step 3: Verify Service Account Permissions

### 3.1 Grant Service Account Access to Apps Script Project

1. Go to Apps Script Editor:
   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

2. Click **Share** button (top right)

3. Add the service account:
   - Email: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
   - Role: **Editor**
   - Uncheck "Notify people"
   - Click **Share**

### 3.2 Enable Apps Script API (User Settings)

**CRITICAL:** This must be done by the project owner!

1. Go to: https://script.google.com/home/usersettings

2. Find "Google Apps Script API"

3. Toggle it **ON** (if not already enabled)

4. You should see: ✅ "Google Apps Script API: ON"

**Without this, all deployments will fail!**

---

## 🧪 Step 4: Test the Configuration

### 4.1 Test Locally (Optional)

If you want to test before pushing to GitHub:

```bash
# Export the service account JSON (from the file you downloaded)
export SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Export the script ID
export SCRIPT_ID='1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l'

# Run diagnostic test
npm run deploy:diagnose

# If diagnostics pass, try a deployment
npm run deploy
```

### 4.2 Test via GitHub Actions

1. Make a small change to your code (e.g., add a comment)

2. Commit and push to the `main` branch:
   ```bash
   git add .
   git commit -m "test: Verify GitHub Actions deployment with new secrets"
   git push origin main
   ```

3. Monitor the GitHub Actions workflow:
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

4. The workflow should:
   - ✅ Pass lint checks
   - ✅ Pass tests
   - ✅ Deploy to Apps Script
   - ✅ Run health checks
   - ✅ Complete successfully

---

## 🔍 Verification Checklist

Use this checklist to verify everything is set up correctly:

### Google Cloud Console
- [ ] Service account exists: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
- [ ] Service account has a valid JSON key created
- [ ] JSON key file is downloaded and secured
- [ ] Apps Script API is enabled for the project

### Apps Script Project
- [ ] Service account has Editor access to the project
- [ ] Apps Script API user setting is enabled (by project owner)
- [ ] Project ID is correct: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

### GitHub Secrets
- [ ] `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` secret is set (entire JSON)
- [ ] `SCRIPT_ID` secret is set
- [ ] `ADMIN_KEY_ROOT` secret is set
- [ ] All secrets are accessible to GitHub Actions

### Testing
- [ ] Local deployment test passes (optional)
- [ ] GitHub Actions deployment succeeds
- [ ] Deployed app is accessible at production URL
- [ ] Health checks pass

---

## 🐛 Troubleshooting

### Error: "User has not enabled the Apps Script API"

**Solution:**
- Project owner must go to https://script.google.com/home/usersettings
- Toggle ON: "Google Apps Script API"
- Wait 2-5 minutes and retry

### Error: "Permission denied" or "Service account does not have access"

**Solution:**
- Verify service account has Editor access to Apps Script project
- Go to Apps Script → Share → Add service account email
- Make sure role is "Editor"

### Error: "Invalid service account JSON"

**Solution:**
- Verify the entire JSON was copied correctly
- Check for missing characters at beginning/end
- Ensure no extra spaces or newlines were added
- Try downloading a new key and re-adding to GitHub

### GitHub Actions fails at deploy step

**Common causes:**
1. Secret not set or incorrectly formatted
2. Service account doesn't have access
3. Apps Script API not enabled in user settings
4. Wrong SCRIPT_ID value

**Debugging:**
1. Check GitHub Actions logs for specific error
2. Run `npm run deploy:diagnose` locally with same credentials
3. Verify all secrets are set in GitHub
4. Double-check service account permissions

---

## 🔒 Security Best Practices

### Protect Your Service Account Key

1. **Never commit** the JSON key file to git
2. **Never share** the key in emails or chat
3. **Store securely** in a password manager
4. **Rotate keys** every 90 days (quarterly)
5. **Delete old keys** after rotation

### Add to .gitignore

Ensure these patterns are in your `.gitignore`:

```gitignore
# Google Cloud service account keys
*-service-account-*.json
*-credentials*.json
*.serviceaccount.json

# Environment files with secrets
.env
.env.local
.env.*.local
```

### Key Rotation Process

**Every 90 days:**

1. Create a new service account key (Steps 1.1-1.3)
2. Update GitHub secret with new key
3. Test deployment with new key
4. Delete old key from Google Cloud Console
5. Document rotation in change log

---

## 📊 Service Account Permissions

The service account needs these permissions:

| Resource | Permission | Why |
|----------|-----------|-----|
| Apps Script Project | Editor | Deploy code, create versions |
| Apps Script API | Enabled | API access for deployment |
| GCP Project | Service Account User | Authenticate as service account |

---

## 🔄 Alternative: Using Clasp

If you prefer to use Clasp instead of service account:

```bash
# Login with your Google account
clasp login

# This creates .clasprc.json with OAuth tokens
# You can use this for local deployments

# For GitHub Actions, service account is recommended
```

**Note:** Service account is better for CI/CD because:
- No interactive login required
- Permissions are explicit
- Keys can be rotated independently
- No personal account dependency

---

## 📝 Change Log

| Date | Change | Changed By | Reason |
|------|--------|------------|--------|
| 2025-11-13 | Initial setup guide created | System | Document secret setup process |
| | | | |

---

## 📚 Related Documentation

- **Deployment Configuration:** `DEPLOYMENT_CONFIGURATION.md`
- **Deployment Automation:** `DEPLOYMENT_AUTOMATION.md`
- **Apps Script API Setup:** `docs/APPS_SCRIPT_API_SETUP.md`
- **Troubleshooting:** `docs/TROUBLESHOOTING_APPS_SCRIPT.md`

---

## 🆘 Need Help?

1. **Run diagnostics:**
   ```bash
   npm run deploy:diagnose
   ```

2. **Check GitHub Actions logs:**
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

3. **Review configuration:**
   See `DEPLOYMENT_CONFIGURATION.md`

4. **Check service account:**
   https://console.cloud.google.com/iam-admin/serviceaccounts?project=zeventbooks

---

## ✅ Quick Summary

**To set up Google Cloud secrets for GitHub Actions:**

1. **Download service account key** from Google Cloud Console
2. **Add to GitHub Secrets** as `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
3. **Verify other secrets:** `SCRIPT_ID`, `ADMIN_KEY_ROOT`
4. **Grant service account Editor access** to Apps Script project
5. **Enable Apps Script API** in user settings
6. **Test deployment** via GitHub Actions

**Once complete, every push to `main` will automatically deploy! 🚀**

---

**Last Updated:** 2025-11-13
**Status:** ✅ Ready to use
