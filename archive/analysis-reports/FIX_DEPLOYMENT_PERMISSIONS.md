# Fix Deployment Permissions Guide

## The Problem

You're getting a **"You do not have permission to access the requested document"** error when accessing your Google Apps Script web app.

This happens when:
- The web app deployment hasn't been authorized to access Google Spreadsheets
- The OAuth scopes haven't been granted
- The deployment is executing with incorrect permissions

## The Solution (3 Methods)

### Method 1: Automated Script (Recommended)

We've created an automated script that diagnoses and helps fix permission issues:

```bash
# Run the permission fixer
./fix-permissions.sh

# Or directly with node
node scripts/fix-deployment-permissions.js

# Test only (no changes)
node scripts/fix-deployment-permissions.js --test
```

**What it does:**
1. Tests your deployment URL
2. Checks configuration files
3. Verifies OAuth scopes
4. Generates an authorization script
5. Guides you through the authorization process
6. Optionally redeploys with correct permissions

### Method 2: Manual Authorization (Fastest)

#### Step 1: Open Apps Script Editor

Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

#### Step 2: Run Authorization Function

1. In the function dropdown, select: **`api_checkPermissions`** or **`api_status`**
2. Click the **Run** button (▶️)
3. You'll see: "Authorization required"
4. Click **"Review permissions"**
5. Choose your Google account
6. Click **"Advanced"** → **"Go to [Project name] (unsafe)"**
7. Click **"Allow"**

#### Step 3: Test the Deployment

Once authorized, test your deployment:

```bash
# Test status endpoint
curl "https://script.google.com/macros/s/AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw/exec?page=status&brand=abc"

# Or use the new permission check endpoint
curl "https://script.google.com/macros/s/AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw/exec?page=permissions&brand=abc"
```

Expected response (HTTP 200):
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "abc",
    "time": "2025-11-20T...",
    "db": {
      "ok": true,
      "id": "1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ"
    }
  }
}
```

### Method 3: Using the Generated Authorization Script

The automated script creates `AuthorizeSpreadsheetAccess.gs` in your project directory.

#### Option A: Push via clasp

```bash
# Authenticate with clasp (one-time)
npx @google/clasp login

# Push the authorization script
npx @google/clasp push

# Go to Apps Script editor and run: authorizeSpreadsheetAccess()
```

#### Option B: Copy manually

1. Open the generated `AuthorizeSpreadsheetAccess.gs`
2. Copy its contents
3. Go to Apps Script editor: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
4. Create a new script file (File → New → Script file)
5. Paste the contents
6. Select `authorizeSpreadsheetAccess` and click Run

## New API Endpoints

We've added new diagnostic endpoints to help troubleshoot permission issues:

### 1. Permission Check Endpoint

```bash
GET /exec?page=permissions&brand=abc
```

**Response when permissions are OK:**
```json
{
  "ok": true,
  "value": {
    "status": "ok",
    "message": "All permissions are properly configured!",
    "details": {
      "brand": {
        "id": "abc",
        "name": "American Bocce Company",
        "spreadsheetId": "1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ"
      },
      "deployment": {
        "url": "https://script.google.com/macros/s/.../exec",
        "configured": true
      },
      "spreadsheet": {
        "accessible": true,
        "name": "Zeventbook Production Data",
        "id": "1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ",
        "message": "Spreadsheet access granted"
      },
      "oauth": {
        "allGranted": true,
        "scopes": [
          { "scope": "spreadsheets", "granted": true },
          { "scope": "external_request", "granted": true }
        ]
      }
    }
  }
}
```

**Response when permissions are missing:**
```json
{
  "ok": true,
  "value": {
    "status": "error",
    "message": "Permission issues detected",
    "details": {
      "spreadsheet": {
        "accessible": false,
        "message": "Permission denied"
      }
    },
    "recommendations": [
      "The deployment needs to be authorized to access spreadsheets",
      "Steps to authorize:",
      "1. Open Apps Script editor: https://script.google.com",
      "2. Select function 'api_checkPermissions' and click Run",
      "3. Grant permissions when prompted",
      "4. Re-deploy the web app"
    ]
  }
}
```

### 2. Setup Check Endpoint

For comprehensive diagnostics:

```bash
GET /exec?page=setup&brand=abc
```

This checks:
- Brand configuration
- Spreadsheet access
- Secret properties
- OAuth scopes
- Database structure

## Configuration Files

### appsscript.json

Your configuration is correct:

```json
{
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/forms"
  ]
}
```

**Important:**
- `executeAs: "USER_DEPLOYING"` - Script runs as you (the deployer)
- `access: "ANYONE_ANONYMOUS"` - Anyone can access without logging in
- OAuth scopes include `spreadsheets` - This must be authorized!

### Config.gs

Your brands are configured with spreadsheet ID:

```javascript
const BRANDS = [
  {
    id: 'root',
    store: { spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' }
  },
  {
    id: 'abc',
    store: { spreadsheetId: '1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ' }
  }
  // ... more brands
];
```

**Verify spreadsheet access:**
- Open: https://docs.google.com/spreadsheets/d/1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ/edit
- Make sure you (the deployer) can edit this spreadsheet

## Why Authorization is Required

Google Apps Script has strict security requirements:

1. **First-Time Authorization**: When a script tries to access Google services (like Spreadsheets), it MUST be authorized by a user
2. **Web App Context**: Even though the web app executes as you, it needs explicit permission to access your spreadsheets
3. **OAuth Scopes**: The authorization grants specific scopes (permissions) to the deployment
4. **Cannot be Automated**: For security reasons, Google requires human interaction for the first authorization

## Troubleshooting

### Still getting permission errors after authorization?

1. **Check you authorized the correct account**
   - The account that authorized must be the same one that deployed the script

2. **Check spreadsheet access**
   ```bash
   # Verify you can access the spreadsheet
   https://docs.google.com/spreadsheets/d/1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ/edit
   ```

3. **Re-deploy the web app**
   ```bash
   npx @google/clasp push
   npx @google/clasp deploy
   ```

4. **Check deployment settings in UI**
   - Go to: https://script.google.com
   - Click **Deploy** → **Manage deployments**
   - Verify: "Execute as: Me" and "Who has access: Anyone"

### Error: "Script not authorized"

The authorization expired or was revoked:
1. Go to Apps Script editor
2. Run any function (like `api_status`)
3. Re-authorize when prompted

### Error: "Spreadsheet not found"

The spreadsheet ID is incorrect or you don't have access:
1. Verify spreadsheet ID in Config.gs
2. Make sure the spreadsheet exists
3. Make sure you have edit access

## Automated Deployment with CI/CD

For GitHub Actions or automated deployments:

1. The deployment must be authorized ONCE manually (in the Apps Script UI)
2. After that, you can use clasp to push code changes
3. Code changes don't require re-authorization
4. Only new OAuth scopes require re-authorization

```yaml
# .github/workflows/deploy.yml
- name: Push to Apps Script
  run: npx @google/clasp push
  env:
    CLASPRC_JSON: ${{ secrets.CLASPRC_JSON }}
```

## Next Steps

1. **Authorize the deployment** (use Method 1 or 2 above)
2. **Test the endpoints**:
   - Status: `?page=status&brand=abc`
   - Permissions: `?page=permissions&brand=abc`
   - Setup: `?page=setup&brand=abc`
3. **Verify all brands work** (abc, cbc, cbl, root)
4. **Document your deployment URL** in your project README

## Quick Reference

| Command | Description |
|---------|-------------|
| `./fix-permissions.sh` | Run automated permission fixer |
| `./fix-permissions.sh --test` | Test only, no changes |
| `npx @google/clasp login` | Authenticate with clasp |
| `npx @google/clasp push` | Push code to Apps Script |
| `npx @google/clasp deploy` | Create new deployment |

| Endpoint | Purpose |
|----------|---------|
| `?page=status&brand=abc` | Check if deployment is working |
| `?page=permissions&brand=abc` | Check permission configuration |
| `?page=setup&brand=abc` | Comprehensive setup diagnostics |

| File | Purpose |
|------|---------|
| `appsscript.json` | OAuth scopes and web app config |
| `Config.gs` | Brand and spreadsheet configuration |
| `Code.gs` | Main application code with endpoints |
| `scripts/fix-deployment-permissions.js` | Automated permission fixer |

## Support

For more help:
- **Deployment Guide**: `APPS_SCRIPT_DEPLOYMENT_GUIDE.md`
- **Clasp Setup**: `CLASP_SETUP.md`
- **Apps Script Project**: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l
- **Spreadsheet**: https://docs.google.com/spreadsheets/d/1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ/edit

---

**Last Updated**: 2025-11-20
**Branch**: `claude/fix-script-permissions-01Sf8zFgKVMMyJaXJNPiJF6J`
