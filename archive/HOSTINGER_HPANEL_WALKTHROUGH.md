# Hostinger hPanel Setup - Step-by-Step Walkthrough

This guide walks you through setting up the proxy in Hostinger's hPanel interface.

## 🎯 Goal

Configure `zeventbooks.com` to proxy to your Google Apps Script deployment.

---

## Prerequisites

Before you start, you need:

1. ✅ Your Google Apps Script deployment ID
   ```bash
   npx clasp deployments
   # Copy the ID: AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

2. ✅ Updated `index.php` file (from `hostinger-proxy/` folder)
   - Replace `YOUR_SCRIPT_ID` with your actual deployment ID

3. ✅ The `.htaccess` file (from `hostinger-proxy/` folder)

---

## Step 1: Log Into Hostinger hPanel

1. Go to: https://hpanel.hostinger.com/
2. Log in with your credentials
3. You should see your dashboard

---

## Step 2: Access Website File Manager

### In hPanel:

1. Click **"Websites"** in the left sidebar
2. Find **zeventbooks.com** in your websites list
3. Click on **zeventbooks.com** to open its management panel
4. Look for **"File Manager"** button (usually near the top)
5. Click **"File Manager"**

### Alternative Path:
- **Websites** → **zeventbooks.com** → **Files** → **File Manager**

---

## Step 3: Navigate to Website Root

Once File Manager opens:

1. You'll see a folder tree on the left
2. Navigate to: **`public_html`** (this is your website root)
   - If you see other folders like `domains/zeventbooks.com/public_html`, go there instead
   - The exact path depends on your Hostinger plan

3. You should now be in the directory where your website files live

**Common paths:**
- Shared hosting: `public_html/`
- Some plans: `domains/zeventbooks.com/public_html/`
- Business plans: `htdocs/` or `www/`

---

## Step 4: Upload index.php

### In File Manager:

1. Make sure you're in `public_html/` (or your website root)

2. **Check if `index.php` already exists:**
   - If YES: You need to replace it (see backup step below)
   - If NO: Proceed to upload

3. **Backup existing files (if any):**
   - If `index.php` exists, right-click it
   - Select **"Download"** to backup
   - Or rename it to `index.php.backup`

4. **Upload new index.php:**
   - Click **"Upload Files"** button (top right or top left)
   - Or click **"Upload"** icon
   - Select your `hostinger-proxy/index.php` file
   - Click **"Upload"** or drag and drop

5. **Verify upload:**
   - You should see `index.php` in the file list
   - File size should be around 2-3 KB

---

## Step 5: Upload .htaccess

### In File Manager:

1. Still in `public_html/` directory

2. **Important: Show hidden files**
   - Look for "Settings" or gear icon (⚙️)
   - Enable **"Show hidden files"**
   - `.htaccess` starts with a dot, so it's hidden by default

3. **Check if `.htaccess` already exists:**
   - If YES: Download it as backup first
   - If NO: Proceed to upload

4. **Upload .htaccess:**
   - Click **"Upload Files"**
   - Select your `hostinger-proxy/.htaccess` file
   - Upload it

5. **Verify upload:**
   - You should see `.htaccess` in the file list (with hidden files shown)
   - File size should be around 1-2 KB

---

## Step 6: Set File Permissions

### For index.php:

1. Right-click `index.php` in File Manager
2. Select **"Permissions"** or **"Change Permissions"**
3. Set to **644**:
   - Owner: Read + Write (6)
   - Group: Read (4)
   - Public: Read (4)
4. Click **"Save"** or **"Change"**

### For .htaccess:

1. Right-click `.htaccess`
2. Select **"Permissions"**
3. Set to **644**
4. Click **"Save"**

**Permission 644 in checkbox form:**
```
Owner:  [✓] Read  [✓] Write  [ ] Execute
Group:  [✓] Read  [ ] Write  [ ] Execute
Public: [✓] Read  [ ] Write  [ ] Execute
```

---

## Step 7: Verify PHP Version

### In hPanel:

1. Go back to your website dashboard (click back or home)
2. Look for **"Advanced"** section
3. Click **"PHP Configuration"** or **"Select PHP Version"**

4. **Check PHP version:**
   - Should be **PHP 7.4** or higher
   - Recommended: **PHP 8.0** or **8.1**

5. **If version is too old:**
   - Change to PHP 8.0 or 8.1
   - Save changes
   - Wait 1-2 minutes for changes to apply

---

## Step 8: Test Your Setup

### Test 1: Basic Connectivity

Open in your browser:
```
https://zeventbooks.com
```

**Expected:**
- Should redirect to HTTPS (if you accessed via HTTP)
- Should show a response (might be JSON or your app)
- Should NOT show a 404 or 500 error

### Test 2: Status Endpoint

Open:
```
https://zeventbooks.com?p=status&brand=root
```

**Expected response (JSON):**
```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "brand": "root",
    "time": "2025-11-14T...",
    "db": { "ok": true }
  }
}
```

### Test 3: All Brands

Try these URLs:
```
https://zeventbooks.com?p=status&brand=root
https://zeventbooks.com?p=status&brand=abc
https://zeventbooks.com?p=status&brand=cbc
```

All should return JSON with the correct brand ID.

### Test 4: Admin Pages

Try opening (in browser):
```
https://zeventbooks.com?p=admin&brand=root
```

Should show your admin interface (not a 404).

---

## Step 9: Check for Errors (If Something's Wrong)

### If you see 500 Internal Server Error:

1. **Check error logs:**
   - In hPanel, go to **Advanced** → **Error Logs**
   - Look for recent PHP errors
   - Common issues:
     - cURL not enabled
     - PHP version too old
     - Syntax error in index.php

2. **Verify your Script ID:**
   - Open `index.php` in File Manager
   - Click "Edit"
   - Find line 17: `define('GOOGLE_SCRIPT_URL', ...)`
   - Make sure you replaced `YOUR_SCRIPT_ID` with actual ID
   - Should look like: `AKfycbXXXXXXXXXXXXXXXXXXXXXXXXX`

### If you see 404 Not Found:

1. **Verify files are in correct location:**
   - Files should be in `public_html/` (website root)
   - NOT in a subdirectory

2. **Check .htaccess uploaded:**
   - Enable "Show hidden files"
   - Verify `.htaccess` exists
   - Check it's in same directory as `index.php`

3. **Verify .htaccess syntax:**
   - Click "Edit" on `.htaccess`
   - Compare with the template file
   - Look for any typos

### If you see blank page:

1. **Enable PHP error display (temporarily):**
   - Edit `index.php`
   - Add at the very top (line 2, after `<?php`):
     ```php
     ini_set('display_errors', 1);
     error_reporting(E_ALL);
     ```
   - Save and refresh page
   - You should now see actual error messages

2. **Check Google Apps Script URL:**
   - Copy the URL from `index.php`
   - Paste it directly in your browser
   - Should work and return JSON
   - If it doesn't, your Script ID is wrong

### If query parameters don't work:

1. **Check .htaccess has QSA flag:**
   - Edit `.htaccess`
   - Find line: `RewriteRule ^(.*)$ index.php [QSA,L]`
   - Make sure `[QSA,L]` is present (not just `[L]`)

---

## Step 10: Run Automated Tests

Once everything works, test with your test suite:

```bash
# Check environment
npm run test:env:print

# Should show:
# Environment: Hostinger
# Base URL: https://zeventbooks.com

# Run API tests
npm run test:hostinger:api

# Run all tests
npm run test:hostinger:all
```

---

## Alternative: Using FTP (If File Manager Doesn't Work)

### FTP Setup:

1. In hPanel, go to **Files** → **FTP Accounts**
2. Create FTP account (or use existing one)
3. Note:
   - FTP Host (usually: ftp.zeventbooks.com)
   - Username
   - Password
   - Port (usually 21)

### Using FTP Client (FileZilla):

1. Download FileZilla: https://filezilla-project.org/
2. Open FileZilla
3. Enter connection details:
   - Host: ftp.zeventbooks.com
   - Username: your_ftp_username
   - Password: your_ftp_password
   - Port: 21
4. Click "Quickconnect"
5. Navigate to `public_html/` on remote side
6. Drag and drop files from local to remote:
   - `index.php`
   - `.htaccess`
7. Right-click each file → File Permissions → Set to 644

---

## Troubleshooting Checklist

Go through this checklist if something's not working:

- [ ] PHP version is 7.4 or higher
- [ ] `index.php` is in `public_html/` (website root)
- [ ] `.htaccess` is in `public_html/` (same directory as index.php)
- [ ] Both files have 644 permissions
- [ ] `YOUR_SCRIPT_ID` in index.php has been replaced with actual ID
- [ ] Google Apps Script URL works when tested directly
- [ ] "Show hidden files" is enabled in File Manager
- [ ] No typos in either file
- [ ] Error logs checked (if 500 error)
- [ ] HTTPS is working (certificate installed)

---

## Quick Reference: File Locations

**What you're uploading:**
- Source: `hostinger-proxy/index.php` (from your project)
- Source: `hostinger-proxy/.htaccess` (from your project)

**Where they go:**
- Destination: `public_html/index.php` (on Hostinger)
- Destination: `public_html/.htaccess` (on Hostinger)

**Final structure on Hostinger:**
```
public_html/
├── index.php          ← Your proxy script
├── .htaccess          ← Your rewrite rules
└── (other files...)   ← Any existing files (ok to keep)
```

---

## Security Note

After everything works, consider:

1. **Remove debug code** (if you added error display)
2. **Set up SSL** (should already be done via Hostinger)
3. **Review error logs** regularly
4. **Monitor traffic** for unusual patterns

---

## Next Steps After Setup

1. ✅ Verify all brand URLs work
2. ✅ Run automated test suite
3. ✅ Set up monitoring/alerts
4. ✅ Configure custom error pages (optional)
5. ✅ Add rate limiting (optional - see main docs)

---

## Need Help?

If you get stuck:

1. **Check error logs:** hPanel → Advanced → Error Logs
2. **Enable debug mode:** Add error display to index.php
3. **Test Script URL:** Make sure Google Apps Script works directly
4. **Contact Hostinger:** Their support can help with file/PHP issues

---

## Summary

**What you did:**
1. ✅ Uploaded `index.php` to `public_html/`
2. ✅ Uploaded `.htaccess` to `public_html/`
3. ✅ Set permissions to 644
4. ✅ Verified PHP version (7.4+)
5. ✅ Tested URLs in browser

**What you get:**
- Clean URLs: `zeventbooks.com?p=status&brand=root`
- All brands work automatically
- All pages work automatically
- Professional appearance
- Ready for production use

---

**Congratulations!** Your Hostinger proxy is now set up. 🎉
