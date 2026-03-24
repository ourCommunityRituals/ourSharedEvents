# First-Time Setup Guide

## Welcome! 👋

This guide will help you set up the MVP Event Toolkit Google Apps Script deployment from scratch. Follow these steps carefully to avoid common configuration issues.

---

## Prerequisites

- ✅ Google account with access to Google Sheets and Apps Script
- ✅ Basic understanding of Google Apps Script
- ✅ 30-45 minutes for initial setup

---

## Step 1: Create Your Database (Google Spreadsheet)

1. **Go to Google Sheets:** https://sheets.google.com

2. **Create a new spreadsheet:**
   - Click "Blank" to create a new sheet
   - Name it: "Zeventbook Event Database" (or your preferred name)

3. **Copy the Spreadsheet ID:**
   - Look at the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
   - Copy the long ID between `/d/` and `/edit`
   - Example: `1SV1oZMq4GbZBaRc0YmTeV02Tl5KXWD8R6FZXC7TwVCQ`

4. **Save this ID** - you'll need it in Step 3

---

## Step 2: Create the Apps Script Project

### Option A: Use Existing Project (Recommended)

If you already have access to the project:

1. **Open the project:**
   https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

2. **Skip to Step 3**

### Option B: Create New Project

1. **Go to Apps Script:** https://script.google.com

2. **Click:** New Project

3. **Copy all files** from this repository to your project:
   - Code.gs
   - Config.gs
   - All HTML files (Admin.html, Public.html, etc.)
   - appsscript.json

4. **Continue to Step 3**

---

## Step 3: Configure Your Database Connection

1. **Open `Config.gs` in the Apps Script editor**

2. **Find the BRANDS array** (around line 14)

3. **Update the `spreadsheetId` for the 'root' brand:**
   ```javascript
   {
     id: 'root',
     name: 'Zeventbook',
     hostnames: ['zeventbook.io','www.zeventbook.io'],
     logoUrl: '/My files/Linux files/zeventbook/assets/logos/ABCMainTransparent.webp',
     store: {
       type: 'workbook',
       spreadsheetId: 'YOUR_SPREADSHEET_ID_HERE'  // ← Replace this
     },
     scopesAllowed: ['events', 'sponsors']
   }
   ```

4. **Replace `YOUR_SPREADSHEET_ID_HERE`** with the ID from Step 1

5. **Update other brands** if you're using multi-brand setup (optional)

6. **Click Save** (Ctrl+S or Cmd+S)

---

## Step 4: Set Up Admin Secrets

Admin secrets are used to authenticate API requests for write operations.

1. **In Apps Script, click:** Project Settings (gear icon)

2. **Scroll to "Script Properties"**

3. **Click:** Add script property

4. **Add the following properties:**

   | Property Name | Value | Description |
   |--------------|-------|-------------|
   | `ADMIN_SECRET_ROOT` | `your-secure-secret-here` | Admin key for root brand |

   **Generate a secure secret:**
   ```bash
   # On Linux/Mac
   openssl rand -base64 32

   # Or use a password manager to generate a random string
   ```

5. **Click Save**

6. **IMPORTANT:** Copy this secret somewhere safe - you'll need it for API calls

---

## Step 5: Deploy as Web App

This is where most first-time users have issues. Follow carefully!

### Create the Deployment

1. **In Apps Script, click:** Deploy → New deployment

2. **Click the gear icon ⚙️** next to "Select type"

3. **Select:** Web app

4. **Configure settings:**
   - **Description:** `Production v1.0`
   - **Execute as:** **Me (your-email@gmail.com)** ⚠️ CRITICAL
   - **Who has access:** **Anyone** ⚠️ CRITICAL

   ⚠️ **Common Mistakes:**
   - ❌ Don't select "User accessing the web app" for Execute as
   - ❌ Don't select "Only myself" for Who has access
   - ✅ Must be: "Execute as: Me" + "Who has access: Anyone"

5. **Click:** Deploy

6. **Authorize the app:**
   - Click "Authorize access"
   - Choose your Google account
   - Click "Advanced" → "Go to [your project] (unsafe)"
   - Review permissions
   - Click "Allow"

7. **Copy the Web app URL:**
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

8. **Save this URL** - this is your API endpoint!

---

## Step 6: Verify Your Setup

Now let's make sure everything works!

### Test 1: Setup Check Endpoint

```bash
# Replace YOUR_DEPLOYMENT_URL with the URL from Step 5
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

**Expected response:**
```json
{
  "ok": true,
  "value": {
    "status": "ok",
    "message": "All setup checks passed! System is ready to use.",
    "checks": [
      {"name": "Brand Configuration", "status": "ok"},
      {"name": "Spreadsheet Access", "status": "ok"},
      {"name": "Admin Secrets", "status": "ok"},
      {"name": "Deployment Configuration", "status": "ok"},
      {"name": "OAuth Scopes", "status": "ok"},
      {"name": "Database Structure", "status": "ok"}
    ]
  }
}
```

### Test 2: Status Endpoint

```bash
curl "YOUR_DEPLOYMENT_URL?p=status&brand=root"
```

**Expected response:**
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    "db": {
      "ok": true,
      "id": "YOUR_SPREADSHEET_ID"
    }
  }
}
```

---

## Common Setup Issues

### Issue 1: HTTP 302 Redirect to Login Page

**Problem:** Deployment settings are incorrect

**Solution:**
1. Go to Deploy → Manage deployments
2. Click Edit on your deployment
3. Ensure "Who has access" = **Anyone**
4. Click Deploy again

**Reference:** See [DEPLOYMENT_302_FIX.md](../DEPLOYMENT_302_FIX.md)

---

### Issue 2: "INTERNAL: Spreadsheet not found"

**Problem:** Spreadsheet ID is incorrect or inaccessible

**Solution:**
1. Verify spreadsheet ID in Config.gs
2. Ensure script owner can access the spreadsheet
3. Share spreadsheet with script owner email if needed

**How to fix:**
```javascript
// In Config.gs, update:
store: {
  type: 'workbook',
  spreadsheetId: 'CORRECT_ID_HERE'  // Update this
}
```

---

### Issue 3: "Admin secret not set"

**Problem:** Script Properties not configured

**Solution:**
1. Apps Script → Project Settings (gear icon)
2. Scroll to "Script Properties"
3. Add property: `ADMIN_SECRET_ROOT` = `your-secret`
4. Click Save

---

### Issue 4: "Permission denied accessing spreadsheet"

**Problem:** Script owner doesn't have edit access to spreadsheet

**Solution:**
1. Open the spreadsheet
2. Click Share
3. Add script owner email (the email you used in Step 5)
4. Grant "Editor" permission
5. Uncheck "Notify people"
6. Click Share

---

### Issue 5: Setup check shows warnings

**Problem:** Some components not fully configured

**Example:**
```json
{
  "status": "warning",
  "warnings": [
    "Some data sheets will be auto-created on first use"
  ],
  "fixes": [
    "These will be created automatically when needed"
  ]
}
```

**Solution:** Warnings are usually OK - sheets will be created automatically on first use

---

## Understanding Setup Check Results

The setup check endpoint (`?p=setup`) performs 6 comprehensive checks:

### 1. Brand Configuration
- ✅ **OK:** Brand is properly configured
- ❌ **ERROR:** Brand config missing or invalid
- 🔧 **Fix:** Check Config.gs BRANDS array

### 2. Spreadsheet Access
- ✅ **OK:** Connected to spreadsheet successfully
- ❌ **ERROR:** Can't access spreadsheet
- 🔧 **Fix:** Verify spreadsheet ID and permissions

### 3. Admin Secrets
- ✅ **OK:** Admin secret configured
- ⚠️ **WARNING:** No admin secret (read-only mode)
- 🔧 **Fix:** Add ADMIN_SECRET_ROOT to Script Properties

### 4. Deployment Configuration
- ✅ **OK:** Deployment active and accessible
- ❌ **ERROR:** No deployment found
- 🔧 **Fix:** Deploy as Web App

### 5. OAuth Scopes
- ✅ **OK:** All required scopes authorized
- ⚠️ **WARNING:** Some scopes not authorized
- 🔧 **Fix:** Re-authorize deployment

### 6. Database Structure
- ✅ **OK:** All required sheets exist
- ⚠️ **WARNING:** Some sheets missing (will auto-create)
- 🔧 **Fix:** No action needed - auto-created on first use

---

## Next Steps

Once your setup check passes:

1. **Test the API:**
   ```bash
   # Create an event
   curl -X POST "YOUR_DEPLOYMENT_URL" \
     -H "Content-Type: application/json" \
     -d '{
       "action": "create",
       "brandId": "root",
       "scope": "events",
       "templateId": "event",
       "adminKey": "YOUR_ADMIN_SECRET",
       "data": {
         "name": "Test Event",
         "dateISO": "2025-12-31",
         "signupUrl": ""
       }
     }'
   ```

2. **View API Documentation:**
   ```
   YOUR_DEPLOYMENT_URL?p=docs
   ```

3. **Explore the admin interface:**
   ```
   YOUR_DEPLOYMENT_URL?p=admin&brand=root
   ```

4. **Read the full documentation:**
   - [DEPLOYMENT.md](./DEPLOYMENT.md)
   - [AUTHENTICATION_GUIDE.md](./AUTHENTICATION_GUIDE.md)
   - [CUSTOM_FRONTEND_GUIDE.md](./CUSTOM_FRONTEND_GUIDE.md)

---

## Security Checklist

Before going to production:

- [ ] Admin secrets are strong (32+ characters, random)
- [ ] Spreadsheet is shared only with necessary accounts
- [ ] Deployment URL is documented securely
- [ ] Script Properties are set (not hardcoded in Config.gs)
- [ ] Test all API endpoints
- [ ] Review Apps Script execution logs for errors

---

## Getting Help

If you're stuck:

1. **Run the setup check:**
   ```bash
   curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
   ```

2. **Read the error message carefully** - it includes specific fix instructions

3. **Check the troubleshooting guides:**
   - [TROUBLESHOOTING_APPS_SCRIPT.md](./TROUBLESHOOTING_APPS_SCRIPT.md)
   - [DEPLOYMENT_302_FIX.md](../DEPLOYMENT_302_FIX.md)

4. **Review execution logs:**
   - Apps Script → Executions
   - Look for error details

5. **Open an issue:**
   - Include setup check output
   - Include any error messages
   - Describe what you've tried

---

## Quick Reference

```
Setup Workflow:
1. Create spreadsheet → Copy ID
2. Open Apps Script project
3. Update Config.gs with spreadsheet ID
4. Add ADMIN_SECRET_ROOT to Script Properties
5. Deploy as Web App (Execute as: Me, Access: Anyone)
6. Test: ?p=setup&brand=root
7. Verify: ?p=status&brand=root
8. Start using the API!
```

---

**Last Updated:** 2025-11-17
**For:** MVP Event Toolkit v1.3+
