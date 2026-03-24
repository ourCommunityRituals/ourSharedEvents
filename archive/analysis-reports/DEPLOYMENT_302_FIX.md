# Fix: HTTP 302 Redirects to Login Page (Deployment Access Issue)

## Problem Summary

The deployed Google Apps Script web app is returning **HTTP 302 redirects to a Google login page** instead of HTTP 200 responses. This breaks the verification tests and prevents anonymous API access.

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

The `appsscript.json` manifest file had:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE"  ← ❌ WRONG: Requires Google account
}
```

This configuration means:
- **"access": "ANYONE"** - Allows any Google user to access (requires login)
- We need **"access": "ANYONE_ANONYMOUS"** - Allows access without login

## The Fix

### Step 1: Update appsscript.json ✅ DONE

Changed the manifest to:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE_ANONYMOUS"  ← ✅ CORRECT: No login required
}
```

**Commit:** Fix deployment access to allow anonymous users

### Step 2: Create NEW Deployment ⚠️ REQUIRED

**CRITICAL:** Simply pushing the code or updating an existing deployment **WILL NOT work**.

The access level is **set at deployment creation time** and cannot be changed by updating an existing deployment.

#### Why This Is Necessary

From Google's documentation and community reports (2025):
> "Changing the property values in the manifest appears to have no effect on the deployment settings. You need to create a new deployment for changes to take effect."

The deployment access level is immutable after creation. To fix this:
1. Push the updated manifest ✅
2. Create a **brand new deployment** with the correct settings ⚠️
3. Update GitHub secrets with the new deployment ID ⚠️

### Step 3: Run the Fix Script

We've provided a guided script:

```bash
chmod +x ./fix-anonymous-access.sh
./fix-anonymous-access.sh
```

This script will:
1. ✅ Verify appsscript.json has the correct configuration
2. 🚀 Push the updated manifest to Apps Script
3. 📖 Guide you through creating a new deployment with anonymous access
4. 🔑 Remind you to update GitHub secrets

## Creating the New Deployment

### Via Apps Script UI (Recommended) 🌟

1. **Open your script:** https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

2. **Deploy → New deployment**

3. **Click gear icon ⚙️** next to "Select type"

4. **Select: Web app**

5. **Configure:**
   - Description: `Anonymous Access Fix 2025-11-14`
   - Execute as: `Me (your-email@example.com)`
   - Who has access: **Anyone, even anonymous** ⭐ ← THIS IS CRITICAL

6. **Click: Deploy**

7. **If prompted:** Authorize access → Allow

8. **Copy the Web app URL:**
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

9. **Save the Deployment ID** (e.g., `@1`, `@2`, `@HEAD`)

### Via clasp (Alternative, Less Reliable)

```bash
# Push code
clasp push

# Create new deployment
clasp deploy --description "Anonymous access fix $(date +%Y-%m-%d)"

# List deployments to get the ID
clasp deployments
```

⚠️ **Warning:** Some users report that clasp deployments don't always respect the manifest access settings correctly. The UI method is more reliable.

## Updating GitHub Secrets

After creating the new deployment:

1. **Go to:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

2. **Update `DEPLOYMENT_ID`:**
   - Click on `DEPLOYMENT_ID`
   - Update value (e.g., `@5` for your new deployment)
   - Click "Update secret"

3. **The BASE_URL** will be auto-extracted by the CI workflow from `clasp deployments`

## Testing the Fix

### Manual Test

```bash
# Set your new deployment URL
export BASE_URL='https://script.google.com/macros/s/YOUR_NEW_DEPLOYMENT_ID/exec'

# Run verification
chmod +x ./verify-deployment.sh
./verify-deployment.sh
```

### Expected Results ✅

```bash
✅ Test 1: Status Endpoint - HTTP 200
✅ Test 2: Public Page - HTTP 200
✅ Test 3: Admin Page - HTTP 200
✅ Test 4: Display Page - HTTP 200

🎉 All deployment checks passed!
```

### If Still Failing ❌

If you still see HTTP 302 redirects:

1. **Verify in Apps Script UI:**
   - Open: Deploy → Manage deployments
   - Check your deployment shows: "Who has access: Anyone, even anonymous"
   - If not, create another new deployment ensuring this setting is correct

2. **Check you're testing the NEW deployment URL:**
   - Make sure your `BASE_URL` points to the NEW deployment
   - Each deployment has a unique URL/ID

3. **Wait 1-2 minutes:**
   - Sometimes deployments take a moment to fully propagate

4. **Clear any cached credentials:**
   ```bash
   # Clear any stored auth
   rm -f ~/.clasprc.json
   clasp login
   ```

## Understanding the Settings

### Access Levels

| Setting | Who Can Access | Requires Login? | Use Case |
|---------|---------------|-----------------|----------|
| `MYSELF` | Only you | Yes | Private testing |
| `DOMAIN` | Your Google Workspace | Yes | Internal tools |
| `ANYONE` | Any Google user | **Yes** ❌ | Semi-public apps |
| `ANYONE_ANONYMOUS` | Anyone | **No** ✅ | Public APIs |

### Execute As

| Setting | Runs As | Permissions | Use Case |
|---------|---------|-------------|----------|
| `USER_ACCESSING` | The visiting user | Visitor's permissions | User-specific actions |
| `USER_DEPLOYING` | You (the owner) | Your permissions | Public APIs, backend services |

For a public API like this toolkit, we need:
- **Execute as:** `USER_DEPLOYING` (runs with your permissions)
- **Access:** `ANYONE_ANONYMOUS` (no login required)

## Why Did This Happen?

1. **Initial deployment** was likely created before the manifest was correctly configured
2. **Manifest access level** was set to `"ANYONE"` instead of `"ANYONE_ANONYMOUS"`
3. **Updating existing deployment** doesn't change access settings (they're immutable)
4. **Solution:** Create new deployment with correct settings

## GitHub Actions Impact

### Before Fix

```yaml
verify-deployment:
  run: ./verify-deployment.sh
  # ❌ FAILS with HTTP 302 redirects
```

### After Fix

```yaml
verify-deployment:
  run: ./verify-deployment.sh
  # ✅ PASSES with HTTP 200 responses
```

The CI/CD pipeline will:
1. Deploy code via `clasp push`
2. Update the deployment via `clasp deploy -i $DEPLOYMENT_ID`
3. Extract the web app URL
4. Run verification tests
5. ✅ All tests pass (no more 302s)

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

3. **Document the deployment settings** in your README

4. **Add deployment verification to CI/CD** (already implemented in this project)

## References

- [Google Apps Script Manifest: Web Apps](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Apps Script Community: Anonymous Access Issues](https://groups.google.com/g/google-apps-script-community/c/iA-WRn7awFo)
- [Stack Overflow: Allowing Anonymous Access](https://stackoverflow.com/questions/22928411/allowing-anonymous-access-to-google-apps-script-web-app)

## Checklist

Before closing this issue, confirm:

- [x] ✅ appsscript.json updated to `ANYONE_ANONYMOUS`
- [ ] ⏳ New deployment created with anonymous access
- [ ] ⏳ DEPLOYMENT_ID secret updated in GitHub
- [ ] ⏳ Verification tests pass (no HTTP 302)
- [ ] ⏳ CI/CD pipeline passes end-to-end
- [ ] ⏳ Documentation updated

## Status

**Current Status:** Manifest fixed, awaiting new deployment creation

**Next Step:** Run `./fix-anonymous-access.sh` and follow the guided process

---

**Last Updated:** 2025-11-14
**Issue:** #36 (Fix deployment verification - 302 redirects)
