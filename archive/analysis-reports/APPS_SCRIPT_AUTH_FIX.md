# Fix Apps Script Authentication for Playwright Tests

## Problem

Your Apps Script URL redirects to Google login page:
```
https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec
→ Redirects to accounts.google.com (requires login)
```

This prevents Playwright from running tests because it cannot authenticate programmatically.

## Root Cause

**Your Apps Script deployment is set to "Only myself" instead of "Anyone"**

## Solution: Update Apps Script Deployment Permissions

### Step 1: Open Your Apps Script Project

1. Go to [Google Apps Script](https://script.google.com)
2. Open your **MVP-EVENT-TOOLKIT** project
3. You should see your Code.gs, Config.gs, SharedReporting.gs files

### Step 2: Open Deployment Settings

1. Click the **Deploy** button (top right)
2. Select **Manage deployments**
3. You'll see a list of your deployments

### Step 3: Find Your Current Deployment

Look for the deployment with ID:
```
AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG
```

This is the URL currently in your tests.

### Step 4: Edit Deployment Settings

1. Click the **pencil icon** (Edit) next to that deployment
2. You'll see these settings:

**Current (INCORRECT) Settings:**
```
Execute as: Me (your@email.com)
Who has access: Only myself  ← THIS IS THE PROBLEM!
```

**Change to (CORRECT) Settings:**
```
Execute as: Me (your@email.com)
Who has access: Anyone  ← CHANGE TO THIS!
```

### Step 5: Deploy the Changes

1. Click **Deploy** or **Update**
2. You may need to authorize the app again
3. Apps Script will show you the deployment URL

### Step 6: Get Your New Deployment URL

After deploying, you'll see:
```
Deployment ID: AKfycbz... (new or same ID)
Web app URL: https://script.google.com/macros/s/NEW_DEPLOYMENT_ID/exec
```

**Copy this URL!**

### Step 7: Update Environment Variable

Set the environment variable with your deployment URL:

**Local testing (.env or terminal):**
```bash
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```

**GitHub Actions (Repository Secrets):**
1. Go to: Settings → Secrets and variables → Actions
2. Find or create: `GOOGLE_SCRIPT_URL`
3. Set value to: `https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec`

### Step 8: Test It Works

```bash
# Test the URL directly
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"

# Should return JSON (not HTML login page):
# {"ok":true,"value":{"build":"triangle-extended-v1.3","brand":"root"}}

# Test with npm
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
npm run test:env:print

# Should show:
# Environment: Google Apps Script
# Base URL: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

---

## Security Concerns Addressed

### Q: Is "Anyone" access safe?

**A: YES!** Your app already has multiple layers of authentication and security:

✅ **Admin Secret Authentication** (`getAdminSecret_()`)
- Admin pages require secret keys
- Stored in Script Properties (not in code)
- Verified before any admin operations

✅ **JWT Token Verification** (`verifyJWT_()`)
- Tokens expire after set time
- Algorithm verification (prevents algorithm confusion)
- nbf claim validation (not-before)

✅ **CSRF Protection**
- Token generation and validation
- Prevents cross-site request forgery

✅ **Rate Limiting** (per brand)
- Prevents abuse and DoS
- 62 tests covering rate limiting

✅ **Brand Isolation**
- Each brand has separate data
- findBrandByHost_() validates access
- No cross-brand data leakage

✅ **Input Sanitization**
- XSS prevention (87 tests)
- SQL injection prevention
- URL validation
- Spreadsheet formula injection prevention

### What "Anyone" Actually Means

**"Anyone" means:**
- ❌ NOT "anyone can access admin features"
- ❌ NOT "anyone can modify data"
- ✅ YES "anyone can make HTTP requests to the web app"

**Your app controls what they can do:**
- Public pages (events, display, poster): ✅ Accessible
- Admin pages: ❌ Require admin secret
- API endpoints: ✅ Rate limited and validated
- Data modification: ❌ Requires authentication

**Example: Public vs Admin**
```javascript
// This works for everyone (public):
GET https://script.google.com/.../exec?p=events&brand=root

// This requires admin secret (protected):
POST https://script.google.com/.../exec
Body: { action: 'create', brandId: 'root', adminKey: 'secret123' }
```

---

## Alternative: Create a New Deployment

If you don't want to modify the existing deployment:

### Create New Web App Deployment

1. In Apps Script, click **Deploy** → **New deployment**
2. Click the gear icon ⚙️ → Select **Web app**
3. Fill in:
   - **Description:** "Playwright Testing - Anyone Access"
   - **Execute as:** Me
   - **Who has access:** **Anyone** ← Important!
4. Click **Deploy**
5. Copy the new deployment URL
6. Use this URL for testing (update GOOGLE_SCRIPT_URL)

**Benefit:** Keeps your existing "Only myself" deployment unchanged.

---

## Verification Steps

### 1. Test with curl (No authentication)
```bash
curl "https://script.google.com/macros/s/YOUR_ID/exec?p=status&brand=root"
```

**Expected (GOOD):**
```json
{"ok":true,"value":{"build":"triangle-extended-v1.3","brand":"root"}}
```

**Bad (authentication issue):**
```html
<!doctype html><html lang="en-US">
<head><base href="https://accounts.google.com/v3/signin/">
```

### 2. Test with npm
```bash
export GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/YOUR_ID/exec"
npm run test:smoke
```

**Expected:** Tests run and pass (or fail on test logic, not authentication)

### 3. Test admin protection still works
```bash
# Try to access admin without key (should be blocked)
curl -X POST "https://script.google.com/macros/s/YOUR_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"action":"create","brandId":"root"}'
```

**Expected:**
```json
{"ok":false,"code":"UNAUTHORIZED","message":"Invalid admin key"}
```

This proves admin endpoints are still protected! ✅

---

## Update GitHub Actions Secret

Once your Apps Script URL works:

1. Go to GitHub repository
2. Settings → Secrets and variables → Actions
3. Update `GOOGLE_SCRIPT_URL`:
   ```
   https://script.google.com/macros/s/YOUR_NEW_DEPLOYMENT_ID/exec
   ```

4. Trigger a workflow to test:
   ```bash
   git commit --allow-empty -m "Test GitHub Actions with fixed Apps Script URL"
   git push
   ```

---

## Troubleshooting

### Issue: Still getting login page

**Possible causes:**
1. Deployment not updated → Check deployment settings again
2. Wrong URL → Make sure you copied the NEW deployment URL after changing settings
3. Browser cache → Try in incognito/private mode
4. Script not published → Ensure you clicked "Deploy" not "Save"

### Issue: "Authorization required"

**This is different from login redirect!**

If you see:
```html
<title>Authorization required</title>
```

**Solution:**
1. The app needs permissions for first-time setup
2. Visit the URL in your browser once
3. Grant permissions when prompted
4. After granting, the URL should work for automated tests

### Issue: Tests still fail with authentication error

**Check:**
1. Environment variable is set: `echo $GOOGLE_SCRIPT_URL`
2. Variable has correct URL (no typos)
3. URL is accessible: `curl "$GOOGLE_SCRIPT_URL?p=status&brand=root"`

---

## Summary

1. **Fix Apps Script deployment:** Change "Only myself" → "Anyone"
2. **Get deployment URL:** Copy from Apps Script after deploy
3. **Set environment variable:** `GOOGLE_SCRIPT_URL=https://script.google.com/...`
4. **Test locally:** `npm run test:smoke`
5. **Update GitHub secret:** Settings → Secrets → `GOOGLE_SCRIPT_URL`

**Your app is still secure!** Admin features require authentication. Public features are meant to be public.

---

## Need Help?

If you're still having issues:

1. Share the error message you're seeing
2. Share the output of: `curl -v "YOUR_APPS_SCRIPT_URL?p=status&brand=root"`
3. Confirm deployment settings: "Who has access" = "Anyone"

The key is: **Apps Script web apps need "Anyone" access to work with automated testing tools like Playwright.**
