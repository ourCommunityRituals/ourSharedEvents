# Quick Start: Get Stage 2 Testing Running

**Goal:** Set up QA environment and run Stage 2 tests in the next 30 minutes.

---

## ✅ Prerequisites Checklist

- [ ] You have admin access to Hostinger for `zeventbooks.com`
- [ ] You have the latest Apps Script deployment URL (from Stage 1)
- [ ] GitHub Actions are enabled on this repository
- [ ] `ADMIN_KEY_ROOT` secret is configured in GitHub

---

## 🚀 Step 1: Find Your Deployment URL (5 min)

### Option A: GitHub Actions Summary
1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Click the latest **"Stage 1 - Build & Deploy"** run
3. Scroll to the bottom → Find **"🚀 Stage 1 Deployment Complete!"**
4. Copy the Base Deployment URL

### Option B: Apps Script Console
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. **Deploy** → **Manage deployments**
3. Copy the latest deployment Web app URL

**Your URL looks like:**
```
https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXX/exec
```

---

## 🌐 Step 2: Create QA Subdomain (10 min)

1. **Log into Hostinger:** https://hpanel.hostinger.com

2. **Navigate to Redirects:**
   - **Domains** → **zeventbooks.com** → **Redirects**

3. **Create New Redirect:**
   - Click **Create Redirect**
   - **Type:** 301 (Permanent)
   - **Source:** `qa.zeventbooks.com`
   - **Destination:** [Paste your Apps Script URL from Step 1]
   - **Include path:** ✅ Yes
   - Click **Create**

4. **Wait:** 5-10 minutes for DNS propagation

---

## ✓ Step 3: Test QA Environment (5 min)

**Open in browser:**
```
https://qa.zeventbooks.com?p=events&brand=root
```

**Expected:** Should redirect to your Apps Script deployment and show the admin page.

**Troubleshooting:**
- If not working, wait another 5 minutes
- Check DNS propagation: https://dnschecker.org/#CNAME/qa.zeventbooks.com
- Verify redirect URL in Hostinger is correct

---

## 🧪 Step 4: Run Stage 2 Tests (10 min)

1. **Go to GitHub Actions:**
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions

2. **Select Stage 2 workflow:**
   - Click **"Stage 2 - Testing & QA"** in the left sidebar

3. **Run workflow:**
   - Click **"Run workflow"** button (top right)
   - The default URL is already: `https://qa.zeventbooks.com`
   - Click **"Run workflow"** (green button)

4. **Watch tests run:**
   - Newman API Tests → 🧪
   - Playwright Smoke Tests → 🚨
   - Playwright Flow Tests → 🔄
   - Playwright Page Tests → 📄
   - Quality Gate → 🎯

5. **Success!** All tests should pass ✅

---

## 🎉 You're Done! What You Achieved:

✅ **Stable QA environment:** `https://qa.zeventbooks.com`
✅ **No more URL masking issues**
✅ **Easy Stage 2 triggering:** Just use the default URL
✅ **Professional setup:** Using your custom domain
✅ **Ready for testing:** Full CI/CD pipeline operational

---

## 🔄 Daily Workflow (Going Forward)

### When You Deploy New Code:

1. **Push to main:**
   ```bash
   git add .
   git commit -m "feat: New feature"
   git push origin main
   ```

2. **Stage 1 runs automatically:**
   - Wait for deployment to complete
   - Note the new deployment URL from Job Summary

3. **Update QA subdomain (manual for now):**
   - Go to Hostinger → Redirects
   - Edit `qa.zeventbooks.com` redirect
   - Update to new deployment URL
   - Save

4. **Trigger Stage 2:**
   - Go to Actions → Stage 2
   - Run workflow (default URL already set)
   - Watch tests pass

5. **Deploy to production:**
   - When ready, manually deploy
   - Or wait for Phase 2 automation

---

## 📖 Next Steps

### This Week: Phase 1 (Current Setup)
- ✅ You're running on Phase 1!
- Keep using manual Hostinger redirects
- Run Stage 2 tests for each deployment
- Get comfortable with the workflow

### Next Sprint: Phase 2 (Professional Automation)
- Migrate to Cloudflare
- Automate subdomain updates
- Add dev and production environments
- Full CI/CD automation

**See:** [PHASE2_PROFESSIONAL_SETUP.md](./docs/PHASE2_PROFESSIONAL_SETUP.md)

---

## 🆘 Troubleshooting

### QA subdomain not working
- **Wait:** DNS can take up to 60 minutes
- **Check redirect:** Verify in Hostinger it's pointing to correct URL
- **Test directly:** Try the Apps Script URL directly in browser

### Stage 2 tests failing
- **Check secret:** Verify `ADMIN_KEY_ROOT` is set in GitHub Secrets
- **Check URL:** Make sure qa.zeventbooks.com is accessible
- **Check logs:** Review specific test failures in GitHub Actions

### Apps Script errors
- **Check deployment:** Verify deployment succeeded in Stage 1
- **Check permissions:** Apps Script must be deployed as "Anyone" can access
- **Check quota:** Verify Apps Script quota not exceeded

---

## 📞 Getting Help

1. **Check the docs:**
   - [PHASE1_QUICK_FIX.md](./docs/PHASE1_QUICK_FIX.md) - Detailed Phase 1 guide
   - [DEPLOYMENT_ENVIRONMENTS.md](./docs/DEPLOYMENT_ENVIRONMENTS.md) - Environment overview
   - [STAGED_DEPLOYMENT_GUIDE.md](./docs/STAGED_DEPLOYMENT_GUIDE.md) - Overall architecture

2. **Review logs:**
   - GitHub Actions → Click on failed job → Review logs
   - Apps Script Console → View execution logs

3. **Test manually:**
   - Use Postman to test API endpoints
   - Open URLs in browser to verify access

---

**Ready to go? Start with Step 1! 🚀**
