# URGENT: Fix CLASPRC_JSON GitHub Secret

## 🚨 Current Issue

Your GitHub Actions deployment is failing because the `CLASPRC_JSON` secret contains invalid JSON with `***` characters instead of the actual OAuth credentials.

**Error preview shows:**
```
***
  ***
    ***
      "client_id": "1072944905499-..."
```

**Should start with:**
```json
{
  "token": {
    "access_token": "ya29.a0..."
```

---

## ✅ Fix Steps (Run on YOUR Local Machine)

### Step 1: Install Clasp (if not already installed)

```bash
npm install -g @google/clasp
```

### Step 2: Login to Clasp

```bash
clasp login
```

This will:
1. Open your browser
2. Ask you to authenticate with Google
3. Create `~/.clasprc.json` file

### Step 3: Validate Your Setup

```bash
./scripts/validate-clasp-setup.sh
```

This script will check everything and show you the correct values to use.

### Step 4: Get the Correct CLASPRC_JSON

**Option A - Direct copy (macOS):**
```bash
cat ~/.clasprc.json | pbcopy
```

**Option B - Direct copy (Linux):**
```bash
cat ~/.clasprc.json | xclip -selection clipboard
```

**Option C - View and copy manually:**
```bash
cat ~/.clasprc.json
```

**IMPORTANT:** The output should look like ONE of these:

**Format 1 (nested):**
```json
{
  "token": {
    "access_token": "ya29.a0AfB_...",
    "refresh_token": "1//0e...",
    "scope": "https://www.googleapis.com/auth/...",
    "token_type": "Bearer",
    "expiry_date": 1234567890123
  },
  "oauth2ClientSettings": {
    "clientId": "1072944905499-...",
    "clientSecret": "GOCSPX-...",
    "redirectUri": "http://localhost"
  },
  "isLocalCreds": false
}
```

**Format 2 (flat):**
```json
{
  "access_token": "ya29.a0AfB_...",
  "refresh_token": "1//0e...",
  "scope": "https://www.googleapis.com/auth/...",
  "token_type": "Bearer",
  "expiry_date": 1234567890123
}
```

### Step 5: Verify JSON is Valid

```bash
cat ~/.clasprc.json | jq .
```

If this command succeeds (shows formatted JSON), your JSON is valid!

If it fails:
```bash
# Re-login to regenerate credentials
clasp logout
clasp login
```

### Step 6: Update GitHub Secret

1. **Go to GitHub secrets:**
   ```
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
   ```

2. **Find `CLASPRC_JSON` secret** and click the pencil icon (Edit)

3. **Delete the old value completely**

4. **Paste the NEW value** from Step 4
   - Must start with `{`
   - Must end with `}`
   - No `***` characters
   - No extra spaces or newlines before/after

5. **Click "Update secret"**

### Step 7: Also Update SCRIPT_ID (if needed)

**Get your Script ID:**
```bash
cat .clasp.json | jq -r '.scriptId'
```

**Update the GitHub secret:**
- Secret name: `SCRIPT_ID`
- Value: The script ID from above (e.g., `1a2b3c4d5e6f7g8h9i0j`)

### Step 8: Test Locally First

```bash
# Test that your local Clasp works
clasp status

# Try a push
npm run push
```

If local push works, then your credentials are good!

### Step 9: Trigger GitHub Actions

After updating the secret, push a small change to trigger the workflow:

```bash
# Make a small change (or use --allow-empty)
git commit --allow-empty -m "test: Verify Clasp credentials after secret update"
git push
```

Watch the workflow run:
```
https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
```

---

## 🔍 Quick Validation Checklist

Before updating GitHub secret, verify locally:

- [ ] `clasp --version` shows version (Clasp is installed)
- [ ] `clasp status` works (authenticated)
- [ ] `cat ~/.clasprc.json | jq .` succeeds (valid JSON)
- [ ] `cat ~/.clasprc.json | jq -e '.token.access_token // .access_token'` shows token
- [ ] `cat .clasp.json | jq -r '.scriptId'` shows your script ID
- [ ] `npm run push` works locally

---

## 🚑 If Still Having Issues

### Common Problems:

**Problem 1: "User has not enabled the Google Apps Script API"**
- Go to: https://script.google.com/home/usersettings
- Enable "Google Apps Script API"
- Re-run `clasp login`

**Problem 2: "Token expired"**
- Run: `clasp logout && clasp login`
- Get fresh credentials

**Problem 3: JSON still invalid**
- Run the refresh script: `./scripts/refresh-clasp-auth.sh`
- This will guide you through the entire process

**Problem 4: Different Google account**
- Make sure you're logging in with the account that owns the Apps Script project
- Check: `clasp open` (should open YOUR project)

---

## 📚 Reference

- Full troubleshooting: [docs/CLASP_GITHUB_ACTIONS_DEBUG.md](docs/CLASP_GITHUB_ACTIONS_DEBUG.md)
- Setup guide: [CLASP_SETUP.md](CLASP_SETUP.md)
- Validation script: `./scripts/validate-clasp-setup.sh`
- Refresh script: `./scripts/refresh-clasp-auth.sh`

---

## ⚡ Quick Fix (TL;DR)

```bash
# On your local machine:
clasp login
cat ~/.clasprc.json | pbcopy  # or just cat to view
# Go to GitHub → Settings → Secrets → CLASPRC_JSON → Edit
# Paste the ENTIRE JSON (starting with { ending with })
# Update secret
# Push to trigger workflow
```

---

**Created:** 2025-11-12
**Status:** URGENT - Fix required for deployment
