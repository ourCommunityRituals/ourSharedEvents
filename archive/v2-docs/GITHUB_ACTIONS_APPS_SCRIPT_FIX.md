# GitHub Actions → Apps Script Upload Fix

## 🔴 Problem

GitHub Actions deployment fails with:
```
✅ Authentication successful
✅ Apps Script API read access verified
✅ Apps Script API write access verified
📊 Found 32 files to deploy
❌ Upload failed: User has not enabled the Apps Script API
```

**This works locally but fails in GitHub Actions.**

---

## 🎯 Root Cause

When a **service account** (used in GitHub Actions) tries to upload to an Apps Script project:

1. ✅ **GCP API enabled** → Read access works
2. ✅ **Service account has Editor access** → Read access works
3. ❌ **Apps Script project OWNER hasn't enabled API in user settings** → Write access fails

The key: **Google checks the Apps Script project OWNER's user settings, not just the service account permissions.**

---

## ✅ Solution 1: Enable User Settings (Recommended - Simple)

**Who:** The person who OWNS the Apps Script project (check in Share dialog)

**Steps:**

1. Go to: https://script.google.com/home/usersettings
2. Toggle ON: **"Google Apps Script API"**
3. Verify you see: ✅ "Google Apps Script API: ON"
4. Wait 2-5 minutes for propagation
5. Retry the GitHub Actions workflow

**Why this works:**
- When the service account uploads, Google checks the project owner's settings
- If the owner has enabled the API, the service account can write
- No code changes required!

---

## ✅ Solution 2: Domain-Wide Delegation with User Impersonation (Advanced)

**Use this if:** The Apps Script project owner can't enable the setting, or you need the service account to fully impersonate a user.

### Prerequisites

- Google Workspace domain (not available for personal Google accounts)
- Workspace Admin access
- The Apps Script project owner's email address

### Step 1: Enable Domain-Wide Delegation

1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Click on your service account (`apps-script-deployer@...`)
3. Click **"Show Domain-Wide Delegation"**
4. Check **"Enable Google Workspace Domain-wide Delegation"**
5. Note the **Client ID** (you'll need this)
6. Click **"Save"**

### Step 2: Authorize in Google Workspace Admin

1. Go to: https://admin.google.com
2. Navigate to: **Security → Access and data control → API controls → Domain-wide delegation**
3. Click **"Add new"**
4. Enter the **Client ID** from Step 1
5. Add these OAuth scopes:
   ```
   https://www.googleapis.com/auth/script.projects,https://www.googleapis.com/auth/script.deployments,https://www.googleapis.com/auth/script.webapp.deploy
   ```
6. Click **"Authorize"**

### Step 3: Add GitHub Secret

1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
2. Click **"New repository secret"**
3. Name: `IMPERSONATE_USER`
4. Value: Email of the Apps Script project owner (e.g., `owner@example.com`)
5. Click **"Add secret"**

### Step 4: Test

Push a commit and watch the GitHub Actions workflow. You should see:
```
🔄 Impersonating user: owner@example.com
✅ Authentication successful
📤 Uploading files to Apps Script...
✅ Uploaded 32 files successfully
```

---

## 🔍 How to Identify the Apps Script Project Owner

1. Open your Apps Script project: https://script.google.com/d/YOUR_SCRIPT_ID/edit
2. Click **"Share"** (top right)
3. Look for the entry with role: **"Owner"** (not just "Editor")
4. That email is the project owner

**Important:** The service account might be listed as "Editor", but there should be a different email as "Owner".

---

## 🤔 Why Does This Fail in GitHub Actions but Work Locally?

### Scenario 1: Different Credentials
- **Locally:** You run with your own user credentials (where YOU have enabled the API)
- **GitHub Actions:** Uses service account (where the owner hasn't enabled the API)

### Scenario 2: Different Projects
- **Locally:** Testing against a different Apps Script project
- **GitHub Actions:** Deploying to production project with different owner

### Scenario 3: Different Service Account
- **Locally:** Using a service account from a different GCP project
- **GitHub Actions:** Using the service account from GitHub secrets

---

## ⚡ Quick Diagnosis

Run this locally to verify the exact issue:

```bash
export SERVICE_ACCOUNT_JSON='<paste GitHub secret value>'
export SCRIPT_ID='<paste GitHub secret value>'
npm run deploy:diagnose
```

This will tell you exactly which step is failing and why.

---

## 📊 Comparison of Solutions

| Solution | Pros | Cons | Setup Time |
|----------|------|------|------------|
| **User Settings** | ✅ Simple<br>✅ No code changes<br>✅ Works immediately | ❌ Requires owner action<br>❌ Owner-dependent | 5 minutes |
| **Domain-Wide Delegation** | ✅ Fully automated<br>✅ Owner-independent<br>✅ More control | ❌ Requires Workspace Admin<br>❌ Complex setup<br>❌ Enterprise-only | 30 minutes |

---

## 🎯 Recommended Approach

**For most teams: Use Solution 1 (User Settings)**

- Faster setup
- Less complexity
- Works for 99% of cases
- Owner just needs to toggle one setting

**Only use Solution 2 if:**
- Apps Script project owner can't enable the setting
- You're managing multiple projects with different owners
- You need full automation without human intervention
- You have Google Workspace Enterprise

---

## 📖 Additional Resources

- [Apps Script API Setup Guide](./APPS_SCRIPT_API_SETUP.md) - Complete setup instructions
- [Quick Fix Guide](./APPS_SCRIPT_API_QUICK_FIX.md) - Fast troubleshooting
- [Google Apps Script API Docs](https://developers.google.com/apps-script/api/reference/rest)
- [Domain-Wide Delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)

---

## ✅ Verification

After applying either solution, you should see in GitHub Actions:

```
✅ Authentication successful
✅ Apps Script API read access verified
✅ Apps Script API write access verified
📊 Found 32 files to deploy
📤 Uploading files to Apps Script...
✅ Uploaded 32 files successfully
🚀 Creating deployment...
✅ Deployment created successfully
```

No more "User has not enabled the Apps Script API" error!
