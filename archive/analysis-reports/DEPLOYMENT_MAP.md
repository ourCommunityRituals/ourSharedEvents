# MVP Event Toolkit - Deployment Configuration Map

**Last Updated**: 2025-11-16
**Status**: ✅ Production Ready

---

## Overview

This document maps the complete deployment pipeline from GitHub → Google Apps Script → Hostinger.

---

## 1. Google Apps Script

### Project Details
- **Project Name**: MVP-EVENT-TOOLKIT
- **Project ID**: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- **Script URL**: https://script.google.com/u/1/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit

### Web App Deployment
- **Deployment ID**: `AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g`
- **Access**: Anyone (no Google login required)
- **Execute as**: Me (your Google account)
- **Full Web App URL**: `https://script.google.com/macros/s/AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g/exec`

### Deployment Commands
```bash
# View all deployments
npx clasp deployments

# Create new deployment (if needed)
npx clasp deploy --description "Production v1.0"

# Push code to Apps Script
npx clasp push
```

---

## 2. GitHub Repository

### Repository Details
- **URL**: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT
- **Branch**: `claude/fix-admin-auth-routing-01TXrwnfe1Yeui4s53kcrqWU`
- **GitHub Actions**: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

### Local Development
```bash
# Current working directory
cd ~/ZEVENTBOOKS/MVP-EVENT-TOOLKIT

# Push changes
git add .
git commit -m "Your commit message"
git push -u origin claude/fix-admin-auth-routing-01TXrwnfe1Yeui4s53kcrqWU
```

---

## 3. Hostinger Setup

### Domain
- **Primary Domain**: zeventbooks.com
- **HTTPS**: ✅ Enabled (forced via .htaccess)

### File Structure
```
public_html/
├── index.php      (Proxy to Google Apps Script)
└── .htaccess      (URL rewriting, HTTPS redirect, security)
```

### Proxy Configuration
The `index.php` file acts as a transparent proxy:
- Receives requests at `zeventbooks.com`
- Forwards them to Google Apps Script deployment
- Returns responses to the user

**CRITICAL**: The deployment ID in index.php MUST match the Apps Script deployment ID above.

---

## 4. Multi-brand Configuration

### Brands
| Brand ID | Name | Hostname | Admin URLs |
|-----------|------|----------|-----------|
| `root` | Zeventbook | zeventbook.io | https://zeventbooks.com?p=admin&brand=root |
| `abc` | American Bocce Co. | americanbocceco.zeventbooks.io | https://zeventbooks.com?p=admin&brand=abc |
| `cbc` | Chicago Bocce Club | chicagobocceclub.zeventbooks.io | https://zeventbooks.com?p=admin&brand=cbc |
| `cbl` | Chicago Bocce League | chicagobocceleague.zeventbooks.io | https://zeventbooks.com?p=admin&brand=cbl |

### Data Storage
All brands share the same Google Spreadsheet:
- **Spreadsheet ID**: `1ixHd2iUc27UF0fJvKh9hXsRI1XZtNRKqbZYf0vgMbKrBFItxngd7L-VO`

---

## 5. Admin Page Access

### How It Works
1. User visits: `https://zeventbooks.com?p=admin&brand=root`
2. Hostinger index.php proxies to Apps Script
3. Apps Script `doGet()` function (Code.gs:214-282):
   - Checks `page` parameter (`p=admin`)
   - Serves AdminWizard.html template
   - **No authentication required for page load**
4. Admin page loads in browser
5. JavaScript makes authenticated API calls using adminKey

### No Gmail Sign-In Should Appear
The admin page HTML is public and requires no authentication.
Only the API calls (create event, update, etc.) require authentication via adminKey.

### If Gmail Sign-In Appears
This means the deployment ID is incorrect or the deployment access is not set to "Anyone".

**Fix**:
1. Verify deployment ID in index.php matches Apps Script
2. In Apps Script, go to Deploy → Manage Deployments
3. Ensure "Who has access" is set to **"Anyone"**

---

## 6. Testing URLs

### Admin Pages (Should load WITHOUT Gmail login)
```bash
https://zeventbooks.com?p=admin&brand=root
https://zeventbooks.com?p=admin&brand=abc
https://zeventbooks.com?p=admin&brand=cbc
https://zeventbooks.com?p=admin&brand=cbl
```

### Status Endpoint (Public)
```bash
https://zeventbooks.com?p=status&brand=root
```

### API Documentation
```bash
https://zeventbooks.com?p=docs
```

---

## 7. Troubleshooting

### Issue: Gmail Sign-In Screen Appears

**Root Cause**: Deployment ID mismatch or incorrect access settings

**Solution**:
1. Run `npx clasp deployments` to get current deployment ID
2. Update `hostinger-proxy/index.php` line 19 with correct ID
3. Upload updated index.php to Hostinger
4. Verify deployment access is set to "Anyone" in Apps Script

### Issue: 502 Bad Gateway

**Root Cause**: Can't connect to Apps Script

**Solution**:
1. Verify Apps Script deployment exists
2. Check Apps Script error logs
3. Ensure Apps Script is not throwing errors

### Issue: CORS Errors

**Root Cause**: Cross-origin request blocked

**Solution**:
- CORS headers are already configured in index.php (lines 97-100)
- Apps Script also handles CORS automatically

---

## 8. Deployment Checklist

Before deploying changes:

- [ ] Code changes pushed to GitHub
- [ ] Run `npx clasp push` to update Apps Script
- [ ] Run `npx clasp deployments` to verify deployment ID
- [ ] Update `hostinger-proxy/index.php` if deployment ID changed
- [ ] Upload index.php to Hostinger public_html/
- [ ] Test admin pages load without Gmail login
- [ ] Test API endpoints respond correctly
- [ ] Check Apps Script execution logs for errors

---

## 9. Security Notes

### Admin Secrets
Admin authentication keys are stored in Apps Script Script Properties (NOT in code):
- Set via: File → Project Properties → Script Properties
- Keys: `ADMIN_SECRET_ROOT`, `ADMIN_SECRET_ABC`, etc.

### Public vs Protected Endpoints
**Public (no auth)**:
- Admin page HTML
- Status endpoint
- API documentation
- Public event listings

**Protected (require adminKey)**:
- Create event
- Update event
- Generate shortlinks
- Analytics reports

---

## Quick Reference

| What | Value |
|------|-------|
| Apps Script Deployment ID | `AKfycby355Xo-XVv3ibfYsf9SUPQo0rGvBS3ex1sNvfpiQ6g` |
| Apps Script Project ID | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| Spreadsheet ID | `1ixHd2iUc27UF0fJvKh9hXsRI1XZtNRKqbZYf0vgMbKrBFItxngd7L-VO` |
| Domain | zeventbooks.com |
| Admin URL Template | `https://zeventbooks.com?p=admin&brand={BRAND_ID}` |

---

**Last verification**: Run `npx clasp deployments` to ensure deployment ID is current.
