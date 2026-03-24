# Apps Script API - Quick Fix Guide

## 🚨 Got the "User has not enabled the Apps Script API" error?

This is the **most common** issue with service account deployments.

---

## ✅ Quick Fix (5 minutes)

### Step 1: Enable API in User Settings

**The project OWNER must do this:**

1. Go to: **https://script.google.com/home/usersettings**
2. Find: "Google Apps Script API"
3. Toggle it **ON** (if it's OFF)
4. Wait 2-5 minutes

### Step 2: Retry Deployment

```bash
npm run deploy
```

**That's it!** This fixes 90% of cases.

---

## 🔍 Still Not Working? Check These:

### Checklist: All Required Settings

- [ ] **GCP API Enabled** (Project level)
  - Go to: https://console.cloud.google.com/apis/library
  - Search: "Apps Script API"
  - Status should be: ✅ **ENABLED**

- [ ] **User API Enabled** (User level) ⭐ **CRITICAL**
  - Go to: https://script.google.com/home/usersettings
  - "Google Apps Script API": ✅ **ON**

- [ ] **Service Account Created**
  - Go to: https://console.cloud.google.com/iam-admin/serviceaccounts
  - Should see: `apps-script-deployer@...`

- [ ] **Service Account Has Access to Apps Script Project**
  - Open your Apps Script project
  - Click "Share" (top right)
  - Service account email should be listed as **Editor**

- [ ] **GitHub Secrets Configured**
  - Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
  - Must have:
    - `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
    - `SCRIPT_ID`

---

## 📊 Understanding the Error

### Why Two Settings?

Google Apps Script API requires **two separate enablements:**

| Setting | Location | What It Does |
|---------|----------|--------------|
| **GCP API** | Cloud Console | Enables the API for your project |
| **User API** | Script Settings | Allows your account to use the API |

### Symptoms by Setting

| Symptom | Likely Cause |
|---------|--------------|
| ❌ Can't authenticate | Service account not created |
| ❌ "Access denied" on pre-flight | GCP API not enabled |
| ✅ Pre-flight passes, ❌ Upload fails | **User API not enabled** ⭐ |
| ❌ "Service account does not have permission" | Service account not shared |

---

## 🎯 The Most Common Issue

**90% of failures are caused by:**

```
✅ GCP API: Enabled in Cloud Console (Step done)
❌ User API: NOT enabled in Script Settings (Step skipped!)
```

**Result:** Pre-flight check passes, but deployment fails.

**Solution:** Go to https://script.google.com/home/usersettings and enable it!

---

## 📖 Need More Help?

- **Full Setup Guide**: [APPS_SCRIPT_API_SETUP.md](./APPS_SCRIPT_API_SETUP.md)
- **Troubleshooting**: See "Troubleshooting" section in setup guide
- **GitHub Issues**: [Report a problem](https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/issues)

---

## ⚡ Pro Tip

After enabling the user setting, it can take 2-5 minutes to propagate.

If it still doesn't work:
1. Sign out of Google
2. Sign back in
3. Wait 5 minutes
4. Retry deployment
