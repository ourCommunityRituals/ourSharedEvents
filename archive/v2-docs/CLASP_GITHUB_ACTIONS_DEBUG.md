# GitHub Actions Debugging Guide for Clasp Deployment

This guide helps you debug Clasp deployment issues in GitHub Actions CI/CD pipeline.

## 📋 Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Common Errors](#common-errors)
3. [Secret Configuration Issues](#secret-configuration-issues)
4. [JSON Validation Issues](#json-validation-issues)
5. [OAuth & Authentication Issues](#oauth--authentication-issues)
6. [Network & Timeout Issues](#network--timeout-issues)
7. [Advanced Debugging](#advanced-debugging)

---

## 🔍 Quick Diagnostics

### Step 1: Check GitHub Actions Logs

Navigate to: `https://github.com/YOUR_USERNAME/YOUR_REPO/actions`

Look for:
- ❌ Red X = Failed job
- ✅ Green checkmark = Passed job
- 🟡 Yellow dot = In progress

Click on the failed workflow run to see detailed logs.

### Step 2: Identify the Failing Step

Common failure points:
1. **Validate secrets** - Secrets not configured
2. **Write .clasprc.json** - JSON validation fails
3. **Push to Apps Script** - Authentication or permission issues
4. **Deploy** - Script ID or deployment issues

### Step 3: Run Local Validation

```bash
# Validate your local Clasp setup
./scripts/validate-clasp-setup.sh
```

This catches most issues before they reach GitHub Actions.

---

## 🚨 Common Errors

### Error 1: "CLASPRC_JSON secret is not set"

**Full Error:**
```
❌ ERROR: CLASPRC_JSON secret is not set!
Please configure the CLASPRC_JSON secret in your repository settings.
```

**Cause:** GitHub secret `CLASPRC_JSON` doesn't exist or is misnamed.

**Solution:**
1. Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions`
2. Check if `CLASPRC_JSON` exists (exact case-sensitive match)
3. If missing, create it:
   - Name: `CLASPRC_JSON`
   - Value: Contents of `~/.clasprc.json`

**Verify locally:**
```bash
cat ~/.clasprc.json
```

Copy the **entire output** (including `{` and `}`) to the GitHub secret.

---

### Error 2: "CLASPRC_JSON is not valid JSON"

**Full Error:**
```
❌ ERROR: CLASPRC_JSON is not valid JSON!
Please check the CLASPRC_JSON secret format.
Current content preview (first 100 chars):
{%0A  "token": {...
```

**Cause:** The JSON in the secret is malformed or corrupted.

**Common Issues:**
- Extra characters before `{` or after `}`
- Newlines or special formatting from copy/paste
- Incomplete JSON (truncated during paste)
- Invalid escape sequences

**Solution:**

1. **Validate your local JSON:**
   ```bash
   cat ~/.clasprc.json | jq .
   ```
   If this fails, regenerate credentials:
   ```bash
   clasp logout
   clasp login
   ```

2. **Copy JSON correctly:**
   ```bash
   # macOS
   cat ~/.clasprc.json | pbcopy

   # Linux
   cat ~/.clasprc.json | xclip -selection clipboard

   # Windows
   type %USERPROFILE%\.clasprc.json | clip
   ```

3. **Update GitHub secret:**
   - Go to secret settings
   - Delete old `CLASPRC_JSON` secret
   - Create new one with fresh JSON
   - **Paste directly** - don't add quotes or formatting

4. **Verify the secret:**
   The JSON should start with `{` and end with `}`:
   ```json
   {"token":{"access_token":"ya29...
   ```
   or
   ```json
   {"access_token":"ya29...
   ```

**Debug tip:** Look at the "Current content preview" in the error. If you see:
- `{%0A` or `\n` - Extra newlines (might be OK with heredoc)
- Strange characters - Copy/paste issue
- `{%22` or `\"` - Over-escaped quotes

---

### Error 3: "Missing required OAuth access_token field"

**Full Error:**
```
❌ ERROR: CLASPRC_JSON is missing required OAuth access_token field!
Expected either '.token.access_token' (nested) or '.access_token' (flat) structure.
```

**Cause:** The `.clasprc.json` structure is incomplete or corrupted.

**Expected Structures:**

**Nested format (older Clasp):**
```json
{
  "token": {
    "access_token": "ya29.a0...",
    "refresh_token": "1//0e...",
    "scope": "https://www.googleapis.com/auth/...",
    "token_type": "Bearer",
    "expiry_date": 1234567890123
  },
  "oauth2ClientSettings": {
    "clientId": "...",
    "clientSecret": "...",
    "redirectUri": "http://localhost"
  },
  "isLocalCreds": false
}
```

**Flat format (newer Clasp):**
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//0e...",
  "scope": "https://www.googleapis.com/auth/...",
  "token_type": "Bearer",
  "expiry_date": 1234567890123
}
```

**Solution:**

1. **Verify local structure:**
   ```bash
   # Check if access_token exists (nested)
   cat ~/.clasprc.json | jq -e '.token.access_token'

   # Or flat
   cat ~/.clasprc.json | jq -e '.access_token'
   ```

2. **If missing, regenerate:**
   ```bash
   clasp logout
   clasp login
   ```

3. **Verify login worked:**
   ```bash
   ./scripts/validate-clasp-setup.sh
   ```

4. **Update GitHub secret** with new credentials

---

### Error 4: "SCRIPT_ID secret is not set"

**Full Error:**
```
❌ ERROR: SCRIPT_ID secret is not set!
Please configure the SCRIPT_ID secret in your repository settings.
```

**Cause:** GitHub secret `SCRIPT_ID` doesn't exist.

**Solution:**

1. **Get your Script ID:**

   **Option A - From existing `.clasp.json`:**
   ```bash
   cat .clasp.json | jq -r '.scriptId'
   ```

   **Option B - From Apps Script Editor:**
   - Go to: https://script.google.com
   - Open your project
   - Click **Project Settings** (gear icon)
   - Copy the **Script ID**

   **Option C - Create new project:**
   ```bash
   clasp create --title "MVP Event Toolkit" --type webapp --rootDir .
   cat .clasp.json
   ```

2. **Configure GitHub secret:**
   - Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions`
   - Create secret:
     - Name: `SCRIPT_ID`
     - Value: `<your-script-id>` (e.g., `1a2b3c4d5e6f7g8h9i0j`)

---

### Error 5: "User has not enabled the Google Apps Script API"

**Full Error:**
```
Error: User has not enabled the Google Apps Script API.
Visit https://script.google.com/home/usersettings to enable it.
```

**Cause:** Apps Script API is disabled for the authenticated account.

**Solution:**

1. Visit: https://script.google.com/home/usersettings
2. Enable "Google Apps Script API"
3. Re-authenticate:
   ```bash
   clasp logout
   clasp login
   ```
4. Update GitHub `CLASPRC_JSON` secret with new credentials

---

### Error 6: "Script not found" or "Permission denied"

**Full Error:**
```
Error: Script not found: 1a2b3c4d5e6f7g8h9i0j
```
or
```
Error: Permission denied
```

**Causes:**
- Wrong Script ID
- OAuth account doesn't have access to the script
- Script was deleted

**Solution:**

1. **Verify Script ID:**
   ```bash
   cat .clasp.json | jq -r '.scriptId'
   ```

2. **Check script exists:**
   ```bash
   clasp open
   ```
   This should open the script in your browser.

3. **Verify permissions:**
   - The Google account used for `clasp login` must be:
     - The script owner, OR
     - Have "Edit" permissions on the script

4. **Check account match:**
   ```bash
   # See which account is logged in
   cat ~/.clasprc.json | jq -r '.token.scope' 2>/dev/null || \
   cat ~/.clasprc.json | jq -r '.scope'
   ```

5. **If needed, re-login with correct account:**
   ```bash
   clasp logout
   clasp login  # Make sure to use the correct Google account
   ```

---

## 🔐 Secret Configuration Issues

### Issue: Secrets not being read correctly

**Symptoms:**
- Empty or partial values
- Extra whitespace
- Quote escaping issues

**Root Cause:**
GitHub Actions used to use `echo` or `printf` which had issues with special characters.

**Current Solution (Heredoc):**
The workflow now uses heredoc, which is the most robust:

```bash
cat > ~/.clasprc.json << 'EOF'
${{ secrets.CLASPRC_JSON }}
EOF
```

**Why this works:**
- ✅ No shell interpretation of special characters
- ✅ Handles quotes (single, double)
- ✅ Handles backslashes
- ✅ Handles newlines
- ✅ GitHub Actions expands `${{ }}` before bash sees it

**Verify it's being used:**
Check `.github/workflows/ci.yml` lines 109-114:
```yaml
- name: Write .clasprc.json
  run: |
    # Write secret to file using heredoc to handle all special characters
    cat > ~/.clasprc.json << 'EOF'
    ${{ secrets.CLASPRC_JSON }}
    EOF
```

If you see `echo` or `printf` instead, update to use heredoc.

---

## 🔍 JSON Validation Issues

### Debug: See what's actually being written

**Option 1: Add debug step to workflow**

Edit `.github/workflows/ci.yml` after line 114:

```yaml
- name: Debug CLASPRC_JSON
  run: |
    echo "File size:"
    wc -c ~/.clasprc.json
    echo "Structure with redacted credentials:"
    jq -r 'walk(if type == "string" and (.|length) > 10 then .[0:4] + "..." + .[-4:] else . end)' ~/.clasprc.json || echo "Failed to parse JSON - check secret format"
    echo "JSON structure:"
    jq 'keys' ~/.clasprc.json || echo "Invalid JSON"
```

**Option 2: Test heredoc locally**

```bash
# Simulate GitHub Actions heredoc behavior
cat > /tmp/test-clasprc.json << 'EOF'
$(cat ~/.clasprc.json)
EOF

# Validate
jq empty /tmp/test-clasprc.json
```

---

## 🔑 OAuth & Authentication Issues

### Issue: Token expired

**Symptoms:**
```
Error: Invalid token
Error: Token expired
```

**Cause:** OAuth tokens expire after some time (usually hours to days).

**Solution:**

1. **Re-authenticate locally:**
   ```bash
   clasp logout
   clasp login
   ```

2. **Verify new token:**
   ```bash
   ./scripts/validate-clasp-setup.sh
   ```

3. **Update GitHub secret:**
   - Get new credentials: `cat ~/.clasprc.json`
   - Update `CLASPRC_JSON` secret in GitHub

**Prevention:**
- Refresh tokens should auto-renew, but if they expire:
- Set up calendar reminder to refresh every 6 months
- Consider using a service account for CI/CD (advanced)

---

### Issue: Different Clasp versions (nested vs flat JSON)

**Symptoms:**
- Local Clasp works, but GitHub Actions fails
- JSON structure looks different

**Cause:** Different Clasp versions use different OAuth JSON structures.

**Solution:**

The workflow supports **both** formats:
```bash
# Check for access_token in both locations
if ! jq -e '.token.access_token // .access_token' ~/.clasprc.json >/dev/null 2>&1; then
  echo "ERROR!"
  exit 1
fi
```

**Verify support:**
Check `.github/workflows/ci.yml` line 122-128 has the `//` (fallback) operator.

---

## 🌐 Network & Timeout Issues

### Issue: Clasp push hangs or times out

**Symptoms:**
```
Pushing to Apps Script...
(hangs for >5 minutes)
```

**Causes:**
- Network issues
- Large file uploads
- Apps Script API rate limits

**Solutions:**

1. **Check file size:**
   ```bash
   # See what's being pushed
   npx @google/clasp status

   # Check for large files
   du -sh * | sort -h
   ```

2. **Add timeout to workflow:**
   Edit `.github/workflows/ci.yml`, add to deploy step:
   ```yaml
   - name: Push to Apps Script
     run: clasp push --force
     timeout-minutes: 5
   ```

3. **Exclude unnecessary files:**
   Create/update `.claspignore`:
   ```
   node_modules/**
   tests/**
   coverage/**
   *.md
   .git/**
   .github/**
   ```

---

## 🛠 Advanced Debugging

### Enable verbose logging

Add to `.github/workflows/ci.yml` at the start of deploy job:

```yaml
- name: Enable debug logging
  run: echo "CLASP_DEBUG=1" >> $GITHUB_ENV
```

### Add comprehensive debug output

```yaml
- name: Debug Environment
  run: |
    echo "Node version: $(node --version)"
    echo "NPM version: $(npm --version)"
    echo "Clasp version: $(clasp --version)"
    echo "Working directory: $(pwd)"
    echo "Files in directory:"
    ls -la
    echo "Home directory:"
    ls -la ~/
    echo "Clasp config exists:"
    [ -f ~/.clasprc.json ] && echo "YES" || echo "NO"
    [ -f .clasp.json ] && echo ".clasp.json exists" || echo ".clasp.json missing"
```

### Test secrets in isolation

Create a minimal test workflow:

`.github/workflows/test-secrets.yml`:
```yaml
name: Test Secrets
on:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Test CLASPRC_JSON
        run: |
          cat > /tmp/test.json << 'EOF'
          ${{ secrets.CLASPRC_JSON }}
          EOF

          echo "File created"
          wc -c /tmp/test.json

          echo "JSON validation:"
          jq empty /tmp/test.json && echo "VALID" || echo "INVALID"

          echo "Has access_token:"
          jq -e '.token.access_token // .access_token' /tmp/test.json && echo "YES" || echo "NO"

      - name: Test SCRIPT_ID
        run: |
          if [ -n "${{ secrets.SCRIPT_ID }}" ]; then
            echo "SCRIPT_ID is set: ${{ secrets.SCRIPT_ID }}"
          else
            echo "SCRIPT_ID is NOT set"
          fi
```

Run manually from Actions tab to test secrets in isolation.

---

## 📝 Checklist: Before Opening an Issue

If you're still stuck, gather this info:

- [ ] GitHub Actions workflow run URL
- [ ] Full error message from logs
- [ ] Output of `./scripts/validate-clasp-setup.sh` (run locally)
- [ ] Output of `cat ~/.clasprc.json | jq 'keys'` (shows structure)
- [ ] Clasp version: `clasp --version`
- [ ] Node version: `node --version`
- [ ] Operating system (for local testing)
- [ ] Screenshots of GitHub secret configuration (redact values!)

---

## 🎯 Quick Reference

**Validation Command:**
```bash
./scripts/validate-clasp-setup.sh
```

**Re-authenticate:**
```bash
clasp logout && clasp login
```

**Update GitHub Secret:**
1. Copy credentials: `cat ~/.clasprc.json | pbcopy`
2. Go to: `https://github.com/USER/REPO/settings/secrets/actions`
3. Update `CLASPRC_JSON`

**Check workflow:**
```bash
cat .github/workflows/ci.yml | grep -A 5 "Write .clasprc.json"
```

Should see:
```yaml
cat > ~/.clasprc.json << 'EOF'
${{ secrets.CLASPRC_JSON }}
EOF
```

**Test locally:**
```bash
npm run test:quick  # Fast validation
npm run test:all    # Full suite
```

---

## 📚 Related Documentation

- [Deployment Flow](DEPLOYMENT_FLOW.md) - Complete CI/CD pipeline visualization
- [Clasp Setup Guide](../CLASP_SETUP.md) - Initial setup instructions
- [GitHub Actions Workflow](../.github/workflows/ci.yml) - Full workflow configuration
- [Validation Script](../scripts/validate-clasp-setup.sh) - Local validation tool

---

**Last Updated:** 2025-11-12
**Version:** 1.0
