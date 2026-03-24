# Phase 1: Quick Fix - Get Stage 2 Testing Running Today

## 🎯 Goal
Set up `qa.zeventbooks.com` to point to your Apps Script deployment so Stage 2 can run without manual URL handoff.

**Time estimate:** 30 minutes

---

## Step 1: Find Your Current Deployment URL

### Option A: From GitHub Actions Job Summary
1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Click the most recent **"Stage 1 - Build & Deploy"** workflow run
3. **Scroll to the bottom** of the page (below all the job logs)
4. Look for the section: **"🚀 Stage 1 Deployment Complete!"**
5. Copy the **Base Deployment URL** from the code block

### Option B: From Google Apps Script Console
1. Go to: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click **Deploy** → **Manage deployments**
3. Find the latest deployment
4. Copy the **Web app URL**

**Your URL will look like:**
```
https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXX/exec
```

---

## Step 2: Create QA Subdomain in Hostinger

### Instructions:

1. **Log into Hostinger** (https://hpanel.hostinger.com)

2. **Navigate to DNS Management:**
   - Go to **Domains** → **zeventbooks.com** → **DNS / Name Servers**

3. **Create a subdomain redirect:**

   **Method 1: Using Redirects (Simplest)**
   - Go to **Domains** → **zeventbooks.com** → **Redirects**
   - Click **Create Redirect**
   - Configure:
     - **Type:** 301 (Permanent) or 302 (Temporary)
     - **Source:** `qa.zeventbooks.com`
     - **Destination:** `[YOUR_APPS_SCRIPT_URL_FROM_STEP_1]`
     - **Include path:** Yes
   - Click **Create**

   **Method 2: Using DNS Records (Alternative)**
   - Add CNAME record:
     - **Type:** CNAME
     - **Name:** `qa`
     - **Points to:** `script.google.com`
   - Note: This requires additional configuration in Apps Script custom domains

   **⚠️ Recommendation:** Use Method 1 (Redirects) for quickest setup.

4. **Wait for propagation:** 5-10 minutes (usually instant for Hostinger)

5. **Test it:**
   ```bash
   curl -I https://qa.zeventbooks.com
   ```

   You should see a redirect (301/302) to your Apps Script URL.

---

## Step 3: Verify Subdomain Works

Open in your browser:
```
https://qa.zeventbooks.com?p=events&brand=root
```

**Expected:** Should redirect to your Apps Script deployment and show the admin page.

**If it doesn't work:**
- Check DNS propagation: https://dnschecker.org/#CNAME/qa.zeventbooks.com
- Verify the redirect URL is correct in Hostinger
- Wait a few more minutes for DNS propagation

---

## Step 4: Update Stage 2 Workflow (Done by Claude)

The Stage 2 workflow will be updated to use `https://qa.zeventbooks.com` as the default BASE_URL.

---

## Step 5: Test Stage 2

Once the subdomain is working:

1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
2. Click **"Stage 2 - Testing & QA"** workflow
3. Click **"Run workflow"**
4. Enter: `https://qa.zeventbooks.com`
5. Click **"Run workflow"**

**Stage 2 should now run successfully!**

---

## What You've Achieved

✅ **Stable QA URL:** `qa.zeventbooks.com` always points to latest QA deployment
✅ **No URL masking issues:** You know the URL ahead of time
✅ **Easy Stage 2 triggering:** Just paste `qa.zeventbooks.com` every time
✅ **Professional setup:** Using your own domain

---

## Next: Phase 2 (Professional Automation)

Once this is working, we'll:
- Move to Cloudflare for better automation
- Automate subdomain updates in Stage 1
- Add `dev.zeventbooks.com` and `app.zeventbooks.com`
- Fully automated CI/CD pipeline

See: `PHASE2_PROFESSIONAL_SETUP.md` (coming next)
