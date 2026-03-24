# Hostinger & Google Apps Script Setup Instructions

## Current Status

✅ **Configuration Changes Complete**
- QA environment is configured to use `https://zeventbooks.com`
- Playwright tests are pointing to the correct URL
- Environment detection is working properly

⚠️ **Infrastructure Blockers**
The tests are returning **403 Forbidden** errors because:
1. Google Apps Script deployment is not publicly accessible
2. Hostinger proxy files are not uploaded yet

---

## 🚨 Critical Blockers

### Blocker 1: Google Apps Script Deployment Not Public

**Problem:**
All Google Apps Script deployment URLs return `403 Access denied`:
```bash
curl "https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec?p=status&brand=root"
# Returns: Access denied (HTTP 403)
```

**Root Cause:**
The web app deployment permissions are likely set to "Only myself" instead of "Anyone".

**Impact:**
- All Playwright tests fail with 403 errors
- Cannot test the application through zeventbooks.com
- API endpoints are inaccessible

---

### Blocker 2: Hostinger Proxy Not Configured

**Problem:**
The domain `zeventbooks.com` returns `403 Access denied` for all requests.

**Root Cause:**
The PHP proxy files (`index.php` and `.htaccess`) have not been uploaded to Hostinger's web hosting.

**Impact:**
- zeventbooks.com returns 403 for all requests
- Users cannot access the application via the custom domain
- Tests against zeventbooks.com fail

---

## 📋 Step-by-Step Fix Instructions

### Part 1: Fix Google Apps Script Deployment (15-20 minutes)

#### Step 1.1: Open the Apps Script Project

1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Log in with your Google account (the account that owns the project)
3. Wait for the script editor to load

#### Step 1.2: Check Current Deployments

1. In the Apps Script editor, click **Deploy** → **Manage deployments**
2. You'll see a list of existing deployments
3. Note which deployment is currently active (usually marked with a version number)

#### Step 1.3: Create New Public Deployment

**Option A: Update Existing Deployment (Recommended)**

1. Click **Deploy** → **Manage deployments**
2. Click the **Edit** (pencil icon) on the deployment you want to update
3. Under **Configuration:**
   - **Description:** `Production - Public Access`
   - **Execute as:** `Me (your@email.com)`
   - **Who has access:** **Anyone** ⚠️ **THIS IS CRITICAL - Must be "Anyone"**
4. Click **Deploy**
5. Copy the **Web app URL** (starts with `https://script.google.com/macros/s/AKfycb...`)

**Option B: Create New Deployment**

1. Click **Deploy** → **New deployment**
2. Click the gear icon (⚙️) next to "Select type"
3. Choose **Web app**
4. Fill in configuration:
   - **Description:** `Production - Public zeventbooks.com`
   - **Execute as:** `Me (your@email.com)`
   - **Who has access:** **Anyone** ⚠️ **MUST BE "Anyone"**
5. Click **Deploy**
6. You may need to authorize the app:
   - Click **Authorize access**
   - Choose your Google account
   - Click **Advanced** → **Go to [Project Name] (unsafe)**
   - Click **Allow**
7. Copy the **Web app URL** (starts with `https://script.google.com/macros/s/AKfycb...`)

**IMPORTANT:** The deployment ID is the part after `/s/` and before `/exec`. For example:
```
https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec
                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                    This is your deployment ID
```

#### Step 1.4: Test the Deployment

Open your terminal and test the URL:

```bash
# Replace YOUR_DEPLOYMENT_ID with the actual ID from step 1.3
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"
```

**Expected Response (Success):**
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    "time": "2025-11-15T...",
    "db": {
      "ok": true
    }
  }
}
```

**If you still get 403:**
- Go back to **Deploy** → **Manage deployments**
- Click **Edit** on your deployment
- Verify "Who has access" is set to **Anyone**
- Click **Deploy** again

#### Step 1.5: Save the Deployment ID

Copy your deployment ID to a safe place. You'll need it for Part 2.

```
Deployment ID: AKfycb... (paste yours here)
Full URL: https://script.google.com/macros/s/YOUR_ID/exec
```

---

### Part 2: Configure Hostinger Proxy (20-30 minutes)

#### Step 2.1: Update index.php with Your Deployment ID

1. On your local machine, open this file:
   ```
   hostinger-proxy/index.php
   ```

2. Find line 19 (look for `define('GOOGLE_SCRIPT_URL', ...)`):
   ```php
   define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec');
   ```

3. Replace the deployment ID with **YOUR** deployment ID from Part 1, Step 1.5:
   ```php
   define('GOOGLE_SCRIPT_URL', 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec');
   ```

4. Save the file

#### Step 2.2: Log Into Hostinger

1. Go to: https://hpanel.hostinger.com/
2. Log in with your Hostinger credentials
3. You should see your dashboard with your websites

#### Step 2.3: Access File Manager

1. In the left sidebar, click **Websites**
2. Find **zeventbooks.com** in your websites list
3. Click on **zeventbooks.com** to open its management panel
4. Look for the **File Manager** button (usually near the top)
5. Click **File Manager**

**Alternative path:** Websites → zeventbooks.com → Files → File Manager

#### Step 2.4: Navigate to Website Root

1. In File Manager, you'll see a folder tree on the left
2. Navigate to: **`public_html`**
   - This is your website root directory
   - On some plans it might be: `domains/zeventbooks.com/public_html/`
   - Or: `htdocs/` or `www/`

3. You should now be in the directory where your website files live

**How to verify:** The URL bar in File Manager should show something like:
```
/home/u123456789/domains/zeventbooks.com/public_html
```

#### Step 2.5: Enable Hidden Files (Important!)

1. In File Manager, look for **Settings** or a gear icon (⚙️)
2. Click it to open settings
3. Find and enable **"Show hidden files"**
4. Click Save

**Why:** The `.htaccess` file starts with a dot, making it hidden by default.

#### Step 2.6: Backup Existing Files (If Any)

**Before uploading, check if files already exist:**

1. Look for `index.php` in the file list
   - If it exists: Right-click → **Download** (to backup)
   - Or rename it to `index.php.backup`

2. Look for `.htaccess` in the file list (remember: hidden files must be shown)
   - If it exists: Right-click → **Download** (to backup)
   - Or rename it to `.htaccess.backup`

#### Step 2.7: Upload index.php

1. Make sure you're in `public_html/` directory
2. Click **Upload Files** button (top right or top left)
3. Click **Choose File** or drag and drop
4. Navigate to your local project folder: `hostinger-proxy/`
5. Select **index.php** (the one you updated in Step 2.1)
6. Click **Upload** or **Open**
7. Wait for upload to complete

**Verify:**
- `index.php` should appear in the file list
- File size should be around 3-4 KB

#### Step 2.8: Upload .htaccess

1. Still in `public_html/` directory
2. Click **Upload Files** again
3. Navigate to your local project folder: `hostinger-proxy/`
4. Select **.htaccess**
   - **Note:** On Windows/Mac, you may need to show hidden files in your file browser
5. Click **Upload** or **Open**
6. Wait for upload to complete

**Verify:**
- `.htaccess` should appear in the file list (with hidden files enabled)
- File size should be around 2-3 KB

#### Step 2.9: Set File Permissions

**For index.php:**
1. Right-click `index.php` in File Manager
2. Select **Permissions** or **Change Permissions**
3. Set to **644**:
   ```
   Owner:  [✓] Read  [✓] Write  [ ] Execute
   Group:  [✓] Read  [ ] Write  [ ] Execute
   Public: [✓] Read  [ ] Write  [ ] Execute
   ```
4. Click **Save** or **Change**

**For .htaccess:**
1. Right-click `.htaccess`
2. Select **Permissions**
3. Set to **644** (same as above)
4. Click **Save**

**Permission code 644 means:**
- Owner can read and write (6 = 4+2)
- Group can only read (4)
- Public can only read (4)

#### Step 2.10: Verify PHP Version

1. Go back to zeventbooks.com dashboard in hPanel
2. Look for **Advanced** section
3. Click **PHP Configuration** or **Select PHP Version**
4. Check PHP version:
   - Should be **PHP 7.4** or higher
   - Recommended: **PHP 8.0** or **8.1**
5. If version is too old:
   - Change to PHP 8.0 or 8.1
   - Click Save
   - Wait 1-2 minutes for changes to apply

---

### Part 3: Test Everything (10 minutes)

#### Test 3.1: Test Google Apps Script Directly

```bash
# Replace YOUR_DEPLOYMENT_ID with your actual ID
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"
```

**Expected:**
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    ...
  }
}
```

**If 403:** Go back to Part 1 and verify deployment permissions are set to "Anyone"

#### Test 3.2: Test zeventbooks.com Proxy

**In your browser, open:**
```
https://zeventbooks.com?p=status&brand=root
```

**Expected:**
You should see JSON response (same as Test 3.1)

**Or use curl:**
```bash
curl "https://zeventbooks.com?p=status&brand=root"
```

**If 403 or blank page:** See Troubleshooting section below

#### Test 3.3: Test All Brands

```bash
# Root brand
curl "https://zeventbooks.com?p=status&brand=root"

# ABC brand
curl "https://zeventbooks.com?p=status&brand=abc"

# CBC brand
curl "https://zeventbooks.com?p=status&brand=cbc"

# CBL brand
curl "https://zeventbooks.com?p=status&brand=cbl"
```

All should return JSON with the correct brand ID.

#### Test 3.4: Test Admin Page

Open in browser:
```
https://zeventbooks.com?p=admin&brand=root
```

Should show the admin interface (not a 404 or 403).

#### Test 3.5: Run Playwright Tests

```bash
# In your project directory
BASE_URL=https://zeventbooks.com npm run test:smoke
```

**Expected:**
Tests should pass! No more 403 errors.

---

## 🔧 Troubleshooting

### Problem: Google Apps Script Still Returns 403

**Check:**
1. Go to Apps Script → Deploy → Manage deployments
2. Click Edit on your deployment
3. Verify "Who has access" is set to **Anyone**
4. If it says "Only myself", change it to **Anyone** and redeploy

**Still not working?**
1. Try creating a completely new deployment (Deploy → New deployment)
2. Make sure you authorize the app when prompted
3. Test the new deployment URL

### Problem: zeventbooks.com Returns 500 Internal Server Error

**Check:**
1. In hPanel, go to **Advanced** → **Error Logs**
2. Look for recent PHP errors
3. Common issues:
   - cURL not enabled in PHP
   - PHP version too old (must be 7.4+)
   - Syntax error in index.php

**Fix:**
1. Verify PHP version is 7.4 or higher
2. Check that you updated the deployment ID in index.php
3. Verify the Google Apps Script URL works directly

### Problem: zeventbooks.com Returns 404 Not Found

**Check:**
1. Verify `.htaccess` is in `public_html/` (same directory as index.php)
2. Enable "Show hidden files" in File Manager
3. Verify `.htaccess` contains the rewrite rules

**Fix:**
1. Re-upload `.htaccess` from `hostinger-proxy/.htaccess`
2. Set permissions to 644
3. Wait 1-2 minutes for changes to take effect

### Problem: zeventbooks.com Returns Blank Page

**Debug:**
1. Edit `index.php` in Hostinger File Manager
2. Add these lines at the very top (line 2, after `<?php`):
   ```php
   ini_set('display_errors', 1);
   error_reporting(E_ALL);
   ```
3. Save and refresh the page
4. You should now see actual error messages

**Common causes:**
- Deployment ID not updated in index.php
- Google Apps Script URL is wrong
- PHP syntax error

### Problem: Query Parameters Don't Work

**Example:** `?p=status&brand=root` doesn't change the page

**Check:**
1. Edit `.htaccess`
2. Find line: `RewriteRule ^(.*)$ index.php [QSA,L]`
3. Make sure `[QSA,L]` is present (not just `[L]`)
4. QSA = Query String Append

### Problem: POST Requests Fail

**Check:**
1. Verify `index.php` has POST handling code (it should, starting at line 55)
2. Check error logs for POST-related errors
3. Test with curl:
   ```bash
   curl -X POST "https://zeventbooks.com?action=create" \
     -H "Content-Type: application/json" \
     -d '{"brandId":"root","scope":"events","name":"Test Event"}'
   ```

---

## 📊 Verification Checklist

Use this checklist to verify everything is working:

### Google Apps Script
- [ ] Deployment exists in Apps Script project
- [ ] "Who has access" is set to **Anyone**
- [ ] Deployment URL tested directly (returns JSON, not 403)
- [ ] Deployment ID saved and documented

### Hostinger Files
- [ ] `index.php` uploaded to `public_html/`
- [ ] `.htaccess` uploaded to `public_html/`
- [ ] Both files have 644 permissions
- [ ] Deployment ID in index.php matches your Apps Script deployment
- [ ] PHP version is 7.4 or higher
- [ ] Hidden files are shown in File Manager

### Testing
- [ ] Google Apps Script URL works: `curl https://script.google.com/macros/s/YOUR_ID/exec?p=status&brand=root`
- [ ] zeventbooks.com works: `curl https://zeventbooks.com?p=status&brand=root`
- [ ] All brands return correct JSON (root, abc, cbc, cbl)
- [ ] Admin page loads in browser
- [ ] Playwright tests pass: `npm run test:smoke`

---

## 📝 Quick Reference

### File Locations

**Local (your computer):**
```
MVP-EVENT-TOOLKIT/
├── hostinger-proxy/
│   ├── index.php        ← Update this with your deployment ID
│   └── .htaccess        ← Upload as-is
```

**Hostinger (web server):**
```
public_html/
├── index.php        ← Upload from hostinger-proxy/index.php
└── .htaccess        ← Upload from hostinger-proxy/.htaccess
```

### Key URLs

| Purpose | URL |
|---------|-----|
| Apps Script Editor | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit |
| Hostinger Panel | https://hpanel.hostinger.com/ |
| Test Status (Apps Script) | https://script.google.com/macros/s/YOUR_ID/exec?p=status&brand=root |
| Test Status (zeventbooks.com) | https://zeventbooks.com?p=status&brand=root |
| Test Admin Page | https://zeventbooks.com?p=admin&brand=root |

### Deployment ID Format

```
Full URL: https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec
                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                             Deployment ID (copy this part)
```

---

## 🎯 Summary

**What was already done:**
- ✅ QA environment configuration updated to point to zeventbooks.com
- ✅ Playwright tests configured correctly
- ✅ Proxy files ready in `hostinger-proxy/` directory

**What you need to do:**
1. **Part 1:** Make Google Apps Script deployment publicly accessible (15-20 min)
2. **Part 2:** Upload proxy files to Hostinger (20-30 min)
3. **Part 3:** Test everything (10 min)

**Total estimated time:** 45-60 minutes

**After completing these steps:**
- ✅ zeventbooks.com will be fully functional
- ✅ All Playwright tests will pass
- ✅ Users can access the application via the custom domain
- ✅ No more 403 errors!

---

## 🆘 Need Help?

If you get stuck:
1. Check the Troubleshooting section above
2. Review error logs in Hostinger: Advanced → Error Logs
3. Test the Google Apps Script URL directly first
4. Verify all file permissions are 644
5. Make sure PHP version is 7.4+

**Common mistakes to avoid:**
- ❌ Forgetting to set deployment to "Anyone"
- ❌ Not updating the deployment ID in index.php
- ❌ Uploading files to wrong directory
- ❌ Forgetting to enable "Show hidden files"
- ❌ Not setting file permissions to 644

Good luck! 🚀
