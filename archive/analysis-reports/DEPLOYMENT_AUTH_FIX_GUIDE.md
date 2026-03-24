# Deployment Authentication Fix Guide

## Issue Summary

The deployed Google Apps Script web app is returning **HTTP 302 redirects** to Google's login page instead of serving content anonymously. This breaks the API and prevents public access.

### Error Symptoms

```bash
❌ HTTP 302 (expected 200)
<HTML>
<HEAD>
<TITLE>Moved Temporarily</TITLE>
</HEAD>
<BODY>
The document has moved <A HREF="https://accounts.google.com/ServiceLogin...">here</A>.
</BODY>
</HTML>
```

## Root Cause

The `appsscript.json` manifest has been **correctly configured** with:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE_ANONYMOUS"  ✅ CORRECT
}
```

**However**, the existing deployment was created **before** this fix was applied, with the old `"access": "ANYONE"` setting (which requires Google login).

### Why Updating Doesn't Work

**CRITICAL:** The access level is **set at deployment creation time** and is **immutable**. From Google's documentation:

> "Changing the property values in the manifest has no effect on existing deployments. You must create a new deployment for changes to take effect."

This means:
- ❌ Pushing updated code doesn't fix it
- ❌ Updating an existing deployment doesn't fix it
- ✅ Only creating a **NEW deployment** fixes it

## The Fix: Create New Deployment

### Option 1: Automated Script (Recommended)

We've created a script that automates the entire process:

```bash
chmod +x ./create-new-anonymous-deployment.sh
./create-new-anonymous-deployment.sh
```

This script will:
1. ✅ Verify `appsscript.json` has correct configuration
2. 🚀 Push the updated manifest to Apps Script
3. 📦 Create a **NEW** deployment with anonymous access
4. 🧪 Test the deployment for HTTP 200 (not 302)
5. 📝 Provide next steps and deployment details

### Option 2: Manual via Apps Script UI

If the automated script doesn't work or you prefer manual control:

1. **Open your script:**
   ```
   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
   ```

2. **Push code first** (ensures latest manifest):
   ```bash
   npx clasp push --force
   ```

3. **In Apps Script UI:**
   - Click: **Deploy** → **New deployment**
   - Click the **gear icon ⚙️** next to "Select type"
   - Select: **Web app**

4. **Configure (THIS IS CRITICAL):**
   - Description: `Anonymous Access Fix 2025-11-14`
   - Execute as: `Me (your-email@example.com)`
   - **Who has access:** `Anyone, even anonymous` ⭐ **← MUST BE THIS**

5. **Deploy:**
   - Click: **Deploy**
   - If prompted: **Authorize access** → **Allow**
   - Copy the **Web app URL** (looks like `https://script.google.com/macros/s/AKfycby.../exec`)
   - Note the **Deployment ID** (e.g., `@1`, `@2`, `@HEAD`)

### Option 3: Manual via clasp CLI

```bash
# Authenticate (if not already)
npx clasp login

# Push code to ensure latest manifest
npx clasp push --force

# Create NEW deployment
npx clasp deploy -d "Anonymous Access Fix $(date -Iseconds)"

# List deployments to get the new deployment ID
npx clasp deployments
```

**⚠️ Warning:** Some users report that clasp deployments don't always respect the manifest access settings correctly. The UI method (Option 2) is more reliable.

## After Creating New Deployment

### 1. Update GitHub Secrets

The CI/CD pipeline needs to know about the new deployment:

1. **Go to:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

2. **Update `DEPLOYMENT_ID`:**
   - Click on `DEPLOYMENT_ID` secret
   - Update value to your new deployment ID (e.g., `@2`, `@3`, etc.)
   - Click "Update secret"

3. **The `BASE_URL`** will be auto-extracted by CI from `clasp deployments`

### 2. Test the Deployment

```bash
# Set your new deployment URL
export BASE_URL='https://script.google.com/macros/s/YOUR_NEW_DEPLOYMENT_ID/exec'

# Run verification
./verify-deployment.sh
```

### Expected Results ✅

```bash
🔍 Verifying deployment at https://script.google.com/macros/s/.../exec

📋 Test 1: Status Endpoint
   GET .../exec?page=status
✅ HTTP 200 OK
✅ Valid JSON response
   Build: triangle-prod-v1.2
   Contract: v1
   Database: ✅ Connected

📋 Test 2: Public Page
✅ HTTP 200 OK
✅ Public page accessible

📋 Test 3: Admin Page
✅ HTTP 200 OK
✅ Admin page accessible

📋 Test 4: Display Page
✅ HTTP 200 OK
✅ Display page accessible

🎉 All deployment checks passed!
```

## Troubleshooting

### Still Seeing HTTP 302?

If you still get 302 redirects after creating a new deployment:

1. **Wait 1-2 minutes** - Deployments take time to propagate

2. **Verify in Apps Script UI:**
   - Open: Deploy → Manage deployments
   - Find your new deployment
   - Check it shows: `Who has access: Anyone, even anonymous`
   - If it says `Anyone` (not "even anonymous"), create another new deployment

3. **Check you're testing the NEW URL:**
   - Make sure `BASE_URL` points to the NEW deployment
   - Each deployment has a unique URL/ID
   - Don't use the old deployment URL

4. **Clear cached credentials** (if using clasp):
   ```bash
   rm -f ~/.clasprc.json
   npx clasp login
   ```

5. **Try the UI method:** If clasp isn't working, use the Apps Script UI (Option 2 above)

### Deployment ID vs Deployment URL

- **Deployment ID**: `@1`, `@2`, `@HEAD` - Used by CI/CD to update deployments
- **Deployment URL**: `https://script.google.com/macros/s/AKfycby.../exec` - The actual web app URL

You need to update the **Deployment ID** in GitHub secrets, and the CI workflow will extract the URL automatically.

## Understanding Access Levels

### Access Settings

| Setting | Who Can Access | Requires Login? | Use Case |
|---------|---------------|-----------------|----------|
| `MYSELF` | Only you | Yes | Private testing |
| `DOMAIN` | Your Google Workspace | Yes | Internal tools |
| `ANYONE` | Any Google user | **Yes** ❌ | Semi-public apps |
| `ANYONE_ANONYMOUS` | Anyone | **No** ✅ | **Public APIs** |

### Execute As Settings

| Setting | Runs As | Permissions | Use Case |
|---------|---------|-------------|----------|
| `USER_ACCESSING` | The visitor | Visitor's permissions | User-specific actions |
| `USER_DEPLOYING` | You (owner) | Your permissions | **Public APIs** |

### Our Configuration

For a public API like this toolkit, we need:
- **Execute as:** `USER_DEPLOYING` (runs with your permissions)
- **Access:** `ANYONE_ANONYMOUS` (no login required)

## CI/CD Pipeline Impact

### Current Behavior (Before Fix)

The GitHub Actions workflow:
1. Updates the existing deployment: `clasp deploy -i $DEPLOYMENT_ID`
2. The deployment still has the old `ANYONE` access level
3. Verification tests fail with HTTP 302

### After Fix

Once you update the `DEPLOYMENT_ID` secret:
1. CI updates the **new** deployment (which has `ANYONE_ANONYMOUS`)
2. Verification tests pass with HTTP 200
3. All E2E tests run successfully

## Prevention

To prevent this in the future:

1. **Always verify `appsscript.json` before first deployment:**
   ```json
   "webapp": {
     "access": "ANYONE_ANONYMOUS"  ← Check this!
   }
   ```

2. **Test deployments immediately after creation:**
   ```bash
   curl -i https://script.google.com/macros/s/YOUR_ID/exec?page=status
   # Should return HTTP 200, not HTTP 302
   ```

3. **Add deployment verification to CI/CD** (already implemented in this project ✅)

## Checklist

Before closing this issue, confirm:

- [x] ✅ `appsscript.json` updated to `ANYONE_ANONYMOUS`
- [ ] ⏳ New deployment created with anonymous access
- [ ] ⏳ `DEPLOYMENT_ID` secret updated in GitHub
- [ ] ⏳ Verification tests pass (no HTTP 302)
- [ ] ⏳ CI/CD pipeline passes end-to-end

## Quick Start Commands

```bash
# 1. Create new deployment (automated)
./create-new-anonymous-deployment.sh

# 2. Or manually with clasp
npx clasp login
npx clasp push --force
npx clasp deploy -d "Anonymous Access Fix"
npx clasp deployments  # Note the new deployment ID

# 3. Test it
export BASE_URL='https://script.google.com/macros/s/YOUR_NEW_ID/exec'
./verify-deployment.sh

# 4. Update GitHub secret
# Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
# Update DEPLOYMENT_ID to your new deployment ID (e.g., @2)
```

## References

- [Google Apps Script Manifest: Web Apps](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Apps Script Community: Anonymous Access Issues](https://groups.google.com/g/google-apps-script-community/c/iA-WRn7awFo)
- [Stack Overflow: Allowing Anonymous Access](https://stackoverflow.com/questions/22928411/allowing-anonymous-access-to-google-apps-script-web-app)

---

**Created:** 2025-11-14
**Issue:** Fix deployment verification - 302 redirects
**Status:** Script created, awaiting deployment creation
