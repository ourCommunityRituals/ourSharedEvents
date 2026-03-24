# Setup Instructions for zeventbooks.com Infrastructure

## Summary

This PR documents the infrastructure setup required to make zeventbooks.com fully operational and resolve 403 Forbidden errors currently blocking Playwright E2E tests.

**Status:** ✅ Configuration Complete | ⚠️ Infrastructure Setup Required

---

## What This PR Includes

### ✅ Completed
- **Comprehensive setup documentation** in `HOSTINGER_SETUP_INSTRUCTIONS.md`
- Step-by-step instructions for configuring Google Apps Script deployment
- Detailed guide for setting up Hostinger proxy
- Complete troubleshooting section for common issues
- Verification checklist and testing procedures

### ⚠️ Required Actions (Infrastructure)
This PR documents what needs to be done **manually** to complete the setup:
1. Configure Google Apps Script deployment with public access
2. Upload proxy files to Hostinger web hosting

---

## Current Status & Blockers

### Blocker 1: Google Apps Script Not Publicly Accessible

**Issue:**
```bash
$ curl "https://script.google.com/macros/s/AKfycbzu-U4UgdjdAiXHTg9TD5Y-1gDkc798YSTqQCdhOddG/exec?p=status&brand=root"
Access denied
```

**Root Cause:** Web app deployment permissions likely set to "Only myself" instead of "Anyone"

**Impact:**
- All Playwright tests fail with 403 errors
- API endpoints inaccessible
- Cannot test application functionality

### Blocker 2: Hostinger Proxy Not Configured

**Issue:**
```bash
$ curl "https://zeventbooks.com?p=status&brand=root"
Access denied
```

**Root Cause:** PHP proxy files (`index.php` and `.htaccess`) not uploaded to Hostinger

**Impact:**
- Custom domain returns 403 for all requests
- Users cannot access application via zeventbooks.com
- All tests against zeventbooks.com fail

---

## Setup Instructions

Complete, detailed instructions are provided in:
### 📘 `HOSTINGER_SETUP_INSTRUCTIONS.md`

This document includes:

### Part 1: Fix Google Apps Script Deployment (15-20 min)
- How to open the Apps Script project
- How to check/update deployment permissions
- How to set "Who has access" to **Anyone**
- How to test the deployment
- What to do if you still get 403 errors

### Part 2: Configure Hostinger Proxy (20-30 min)
- How to update index.php with your deployment ID
- How to access Hostinger File Manager
- How to upload files to the correct directory
- How to set file permissions
- How to verify PHP version

### Part 3: Test Everything (10 min)
- Test Google Apps Script directly
- Test zeventbooks.com proxy
- Test all brand URLs
- Run Playwright tests

### Troubleshooting Guide
- Google Apps Script still returns 403
- zeventbooks.com returns 500 error
- zeventbooks.com returns 404 error
- Blank page issues
- Query parameters don't work
- POST requests fail

### Verification Checklist
Complete checklist to ensure everything is configured correctly.

---

## Quick Start

### For the Repository Owner

1. **Read the instructions:**
   ```bash
   cat HOSTINGER_SETUP_INSTRUCTIONS.md
   ```

2. **Fix Google Apps Script (Part 1):**
   - Open: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
   - Deploy → Manage deployments → Edit
   - Set "Who has access" to **Anyone**
   - Copy deployment URL

3. **Fix Hostinger (Part 2):**
   - Update `hostinger-proxy/index.php` with your deployment ID
   - Upload to Hostinger: https://hpanel.hostinger.com/
   - Upload `index.php` and `.htaccess` to `public_html/`
   - Set permissions to 644

4. **Test:**
   ```bash
   # Should return JSON (not 403)
   curl "https://zeventbooks.com?p=status&brand=root"

   # Run Playwright tests
   npm run test:smoke
   ```

**Estimated time:** 45-60 minutes total

---

## Why This is Needed

### Background
The Playwright E2E tests are configured to run against `https://zeventbooks.com`, which is the production/QA domain hosted on Hostinger. This domain acts as a **proxy** to the Google Apps Script deployment.

### The Flow
```
User/Test → zeventbooks.com → Hostinger (index.php) → Google Apps Script
```

### What's Not Working
Both parts of this chain are currently blocking with 403:
1. **Google Apps Script:** Not publicly accessible
2. **Hostinger:** Proxy files not uploaded

### What Happens After Setup
Once both blockers are resolved:
- ✅ `https://zeventbooks.com` will work for all users
- ✅ All Playwright E2E tests will pass
- ✅ Clean URLs with custom domain
- ✅ Professional appearance
- ✅ Full multi-brand support

---

## Files Modified

### New Files
- `HOSTINGER_SETUP_INSTRUCTIONS.md` - Comprehensive setup guide

### Existing Files (Already Configured)
- `tests/config/environments.js` - Points to zeventbooks.com ✅
- `playwright.config.js` - Uses environment config ✅
- `hostinger-proxy/index.php` - Proxy script ready ✅
- `hostinger-proxy/.htaccess` - Rewrite rules ready ✅

---

## Testing After Setup

Once you complete the setup instructions, verify everything works:

```bash
# 1. Test Google Apps Script directly
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"

# 2. Test zeventbooks.com proxy
curl "https://zeventbooks.com?p=status&brand=root"

# 3. Test all brands
curl "https://zeventbooks.com?p=status&brand=root"
curl "https://zeventbooks.com?p=status&brand=abc"
curl "https://zeventbooks.com?p=status&brand=cbc"
curl "https://zeventbooks.com?p=status&brand=cbl"

# 4. Run Playwright smoke tests
npm run test:smoke

# 5. Run full E2E suite
npm run test:e2e
```

**Expected result:** All tests pass! ✅

---

## Dependencies

### Required Access
- Google account with access to Apps Script project
- Hostinger account with access to zeventbooks.com hosting

### Required Tools
- Web browser for Apps Script editor
- Web browser for Hostinger hPanel
- Terminal for testing (curl or browser)

### External Services
- Google Apps Script: https://script.google.com
- Hostinger Web Hosting: https://hpanel.hostinger.com

---

## Deployment Notes

### This PR Does NOT
- ❌ Deploy any code changes
- ❌ Modify the application logic
- ❌ Change test configurations (already done)
- ❌ Require code review for functionality

### This PR DOES
- ✅ Document infrastructure setup requirements
- ✅ Provide step-by-step instructions
- ✅ Include troubleshooting guide
- ✅ Add verification checklist

---

## Related Issues/PRs

- Related to: QA environment configuration
- Previous PR: #62 - Config: Point QA environment to zeventbooks.com
- Fixes: 403 Forbidden errors blocking Playwright tests
- Enables: Full E2E test suite against zeventbooks.com

---

## Next Steps

### Immediate (Required)
1. ✅ Review this PR
2. ⚠️ Follow `HOSTINGER_SETUP_INSTRUCTIONS.md` (45-60 min)
3. ⚠️ Verify all tests pass
4. ✅ Merge PR (documentation)

### After Merge
- 🎯 zeventbooks.com will be fully operational
- 🎯 E2E tests will run successfully in CI/CD
- 🎯 Custom domain ready for production use

---

## Support

If you encounter issues during setup:

1. **Check Troubleshooting section** in `HOSTINGER_SETUP_INSTRUCTIONS.md`
2. **Review error logs** in Hostinger: Advanced → Error Logs
3. **Verify checklist** at end of setup instructions
4. **Test incrementally** (Apps Script first, then Hostinger)

---

## Questions?

**Q: Why can't this be automated?**
A: Requires manual access to Google Apps Script UI and Hostinger hPanel, which cannot be scripted without credentials.

**Q: Is this a one-time setup?**
A: Yes! Once configured, it will continue working. Only need to update if you create a new Apps Script deployment.

**Q: What if I get stuck?**
A: The setup instructions include detailed troubleshooting for all common issues.

**Q: Can I test locally first?**
A: Yes! Part 1 (Google Apps Script) can be tested immediately. Part 2 (Hostinger) requires web hosting access.

---

## Checklist

- [x] Documentation complete and comprehensive
- [x] Step-by-step instructions provided
- [x] Troubleshooting guide included
- [x] Verification checklist added
- [ ] Infrastructure setup completed (manual, by repo owner)
- [ ] Tests verified passing (after infrastructure setup)

---

**Ready to proceed!** Follow the instructions in `HOSTINGER_SETUP_INSTRUCTIONS.md` to complete the setup.
