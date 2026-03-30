# Setup Diagnostics Guide

## Overview

The MVP Event Toolkit now includes comprehensive setup diagnostics to help first-time clients identify and fix configuration issues quickly.

---

## Quick Start

### Run Setup Check

```bash
# Replace YOUR_DEPLOYMENT_URL with your actual deployment URL
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

Or open in browser:
```
YOUR_DEPLOYMENT_URL?p=setup&brand=root
```

---

## What Gets Checked

The setup diagnostic performs 6 comprehensive checks:

### 1. ✅ Brand Configuration
**What it checks:**
- Brand ID is valid
- Brand name is configured
- Store configuration exists

**Common issues:**
- Brand not found in Config.gs
- Missing required fields

**How to fix:**
- Verify BRANDS array in Config.gs
- Ensure brand has id, name, and store properties

---

### 2. 📊 Spreadsheet Access
**What it checks:**
- Spreadsheet ID is configured
- Spreadsheet exists and is accessible
- Script owner has edit permissions

**Common issues:**
- ❌ Spreadsheet not found: Invalid or incorrect ID
- ❌ Permission denied: Script owner can't access the spreadsheet
- ⚠️ Limited permissions: Only viewer access

**How to fix:**
```javascript
// In Config.gs, update spreadsheetId:
store: {
  type: 'workbook',
  spreadsheetId: 'YOUR_SPREADSHEET_ID_HERE'
}
```

**Get spreadsheet ID from URL:**
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
                                       ^^^^^^^^^^^^^^^^
                                       This is the ID
```

**Grant permissions:**
1. Open the spreadsheet
2. Click "Share"
3. Add script owner email
4. Grant "Editor" access

---

### 3. 🔐 Admin Secrets
**What it checks:**
- Admin secret is configured in Script Properties
- Secret has reasonable length

**Common issues:**
- ⚠️ Not configured: Write operations will fail
- ⚠️ Too short: Weak security

**How to fix:**
1. Apps Script → Project Settings (gear icon)
2. Scroll to "Script Properties"
3. Click "Add script property"
4. Name: `ADMIN_SECRET_ROOT`
5. Value: Generate a secure secret
6. Click "Save"

**Generate secure secret:**
```bash
# On Linux/Mac:
openssl rand -base64 32

# Or use a password manager
```

---

### 4. 🚀 Deployment Configuration
**What it checks:**
- Web app deployment exists
- Deployment URL is accessible
- Access level (anonymous vs authenticated)

**Common issues:**
- ❌ No deployment: App not deployed as web app
- ⚠️ Requires authentication: Wrong access settings

**How to fix:**
1. Apps Script → Deploy → New deployment
2. Select: Web app
3. **Execute as:** Me (your-email@gmail.com)
4. **Who has access:** Anyone
5. Click Deploy
6. Authorize permissions

**CRITICAL:** Must use "Execute as: Me" + "Who has access: Anyone"

---

### 5. 🔑 OAuth Scopes
**What it checks:**
- Spreadsheets API access
- External requests API access
- All required scopes are authorized

**Common issues:**
- ⚠️ Some scopes not authorized
- ❌ Permission denied for certain operations

**How to fix:**
1. Re-deploy the web app
2. When prompted, click "Authorize access"
3. Review permissions
4. Click "Allow"

---

### 6. 🗄️ Database Structure
**What it checks:**
- Required sheets exist (EVENTS, SPONSORS, ANALYTICS, etc.)

**Common issues:**
- ⚠️ Missing sheets: Will be auto-created

**How to fix:**
- No action needed - sheets are auto-created on first use
- Or manually create sheets in advance

---

## Response Format

### Success Response

```json
{
  "ok": true,
  "value": {
    "status": "ok",
    "message": "All setup checks passed! System is ready to use.",
    "brand": "root",
    "timestamp": "2025-11-17T23:45:00.000Z",
    "checks": [
      {
        "name": "Brand Configuration",
        "status": "ok",
        "details": "Brand: Zeventbook (root)"
      },
      {
        "name": "Spreadsheet Access",
        "status": "ok",
        "details": "Connected to: \"Zeventbook Event Database\" (1SV1...)",
        "permissions": "owner/editor"
      },
      {
        "name": "Admin Secrets",
        "status": "ok",
        "details": "Configured (length: 44 chars)"
      },
      {
        "name": "Deployment Configuration",
        "status": "ok",
        "details": "https://script.google.com/macros/s/AKfy.../exec",
        "access": "anonymous"
      },
      {
        "name": "OAuth Scopes",
        "status": "ok",
        "details": "All required scopes authorized"
      },
      {
        "name": "Database Structure",
        "status": "ok",
        "details": "All required sheets present"
      }
    ],
    "issues": [],
    "warnings": [],
    "fixes": [],
    "nextSteps": [
      "Your setup is complete!",
      "Test the API: https://script.google.com/.../exec?p=status&brand=root",
      "View documentation: https://script.google.com/.../exec?p=docs"
    ]
  }
}
```

### Error Response (Configuration Issues)

```json
{
  "ok": true,
  "value": {
    "status": "error",
    "message": "Setup incomplete. Found 2 critical issue(s) that must be fixed.",
    "brand": "root",
    "timestamp": "2025-11-17T23:45:00.000Z",
    "checks": [
      {
        "name": "Brand Configuration",
        "status": "ok",
        "details": "Brand: Zeventbook (root)"
      },
      {
        "name": "Spreadsheet Access",
        "status": "error",
        "error": "Exception: Requested entity was not found.",
        "details": null
      },
      {
        "name": "Admin Secrets",
        "status": "warning",
        "details": "Not configured (write operations will fail)"
      }
    ],
    "issues": [
      "Spreadsheet not found: 1ixHd2iUc27UF0fJvKh9hXsRI1XZtNRKqbZYf0vgMbKrBFItxngd7L-VO",
      "No permission to access spreadsheet"
    ],
    "warnings": [
      "Admin secret not set for brand: root"
    ],
    "fixes": [
      "Update spreadsheetId in Config.gs with a valid Google Sheets ID",
      "Ensure spreadsheet ID is from URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit",
      "Share the spreadsheet with script owner (zeventbook@gmail.com)",
      "Grant at least \"Editor\" access to the spreadsheet",
      "Set admin secret via Script Properties: ADMIN_SECRET_ROOT",
      "Go to: Project Settings > Script Properties > Add property"
    ],
    "nextSteps": [
      "Update spreadsheetId in Config.gs with a valid Google Sheets ID",
      "Ensure spreadsheet ID is from URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit",
      "Share the spreadsheet with script owner (zeventbook@gmail.com)"
    ]
  }
}
```

---

## Status Codes

Each check returns one of these status codes:

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| `ok` | ✅ Check passed | None |
| `warning` | ⚠️ Non-critical issue | Recommended to fix |
| `error` | ❌ Critical issue | Must fix before using |
| `skipped` | ⏭️ Check skipped | Depends on previous check |

---

## Overall Status

The overall status is determined by:

- **`ok`**: All checks passed ✅
- **`warning`**: Some warnings, but usable ⚠️
- **`error`**: Critical issues must be fixed ❌

---

## Integration with Status Endpoint

The standard status endpoint now includes helpful error messages when setup is incomplete:

```bash
curl "YOUR_DEPLOYMENT_URL?p=status&brand=root"
```

**Before (unhelpful):**
```json
{
  "ok": false,
  "code": "INTERNAL",
  "message": "Unexpected error"
}
```

**After (helpful):**
```json
{
  "ok": false,
  "code": "INTERNAL",
  "message": "Spreadsheet not found or inaccessible. Please check:\n1. Spreadsheet ID is correct: 1ixHd...\n2. Script owner has access to the spreadsheet\n3. Run setup check: https://script.google.com/.../exec?p=setup"
}
```

---

## Use Cases

### 1. First-Time Setup Verification

After completing initial configuration:
```bash
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

Ensure all checks show `"status": "ok"`

---

### 2. Troubleshooting Deployment Issues

When API returns errors:
```bash
# Run diagnostics
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"

# Review the "fixes" array for specific instructions
```

---

### 3. Post-Update Validation

After updating configuration:
```bash
# Verify changes didn't break anything
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

---

### 4. New Team Member Onboarding

Provide new team members with setup checklist:
1. Run setup diagnostics
2. Fix any errors shown in `fixes` array
3. Re-run until `"status": "ok"`

---

## Common Workflows

### Initial Setup Checklist

```bash
# 1. Create spreadsheet, copy ID

# 2. Update Config.gs with spreadsheet ID

# 3. Add admin secret to Script Properties

# 4. Deploy as web app

# 5. Run diagnostics
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"

# 6. Fix any issues listed in "fixes" array

# 7. Re-run until all green
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"

# 8. Test status endpoint
curl "YOUR_DEPLOYMENT_URL?p=status&brand=root"
```

---

### Troubleshooting Workflow

```bash
# 1. Error occurs during API call

# 2. Check detailed diagnostics
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root" | jq '.value'

# 3. Review "issues" array for problems

# 4. Follow "fixes" array instructions

# 5. Verify fix worked
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

---

## Related Documentation

- **[FIRST_TIME_SETUP.md](./FIRST_TIME_SETUP.md)** - Complete setup guide for new users
- **[TROUBLESHOOTING_APPS_SCRIPT.md](./TROUBLESHOOTING_APPS_SCRIPT.md)** - Common issues and solutions
- **[DEPLOYMENT_302_FIX.md](../DEPLOYMENT_302_FIX.md)** - Fix deployment access issues
- **[APPS_SCRIPT_PROJECT.md](../APPS_SCRIPT_PROJECT.md)** - Project configuration reference

---

## FAQ

### Q: Do I need to run setup check every time?

**A:** No, only during:
- Initial setup
- Troubleshooting errors
- Configuration changes
- New environment setup

### Q: What if setup check shows warnings but status is "ok"?

**A:** System is usable, but some features may not work:
- Missing admin secret → Can't create/update data
- Limited permissions → Can't modify spreadsheet structure
- Missing sheets → Will auto-create on first use

### Q: Can I use this in production?

**A:** Yes! Setup check is lightweight and safe to run anytime. It only reads configuration, doesn't modify anything.

### Q: How do I automate setup validation?

**A:** Include in CI/CD pipeline:
```bash
#!/bin/bash
RESPONSE=$(curl -s "YOUR_DEPLOYMENT_URL?p=setup&brand=root")
STATUS=$(echo "$RESPONSE" | jq -r '.value.status')

if [ "$STATUS" != "ok" ]; then
  echo "Setup check failed!"
  echo "$RESPONSE" | jq '.value.fixes'
  exit 1
fi

echo "Setup check passed ✅"
```

---

**Last Updated:** 2025-11-17
**Version:** MVP Event Toolkit v1.3+
