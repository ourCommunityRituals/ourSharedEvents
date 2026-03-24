# GitHub Secrets Setup Guide

This document explains how to configure GitHub repository secrets for the Agile Test Automation framework.

## 🔐 Required Secrets

The test automation framework requires the following GitHub secrets to be configured:

### **1. ADMIN_KEY_ROOT** (Required for Scenario 1)
- **Purpose**: Admin authentication for ROOT brand (creating events, configuring sponsors)
- **Used in**: Scenario 1 (First-Time Admin), Admin workflow tests
- **Security**: ⚠️ **CRITICAL** - Never commit this value to code
- **Your Setup**: ✅ Already configured in repository

### **2. Multi-brand Admin Keys** (Optional - for brand-specific testing)
- **ADMIN_KEY_ABC**: Admin key for ABC brand
- **ADMIN_KEY_CBC**: Admin key for CBC brand
- **ADMIN_KEY_CBL**: Admin key for CBL brand
- **Your Setup**: ✅ Already configured in repository

### **3. PROD_BASE_URL** (Optional)
- **Purpose**: Override default test environment URL
- **Default**: `https://zeventbooks.com` (if not set)
- **Used in**: All scenario tests
- **Example**: `https://zeventbooks.com`
- **Note**: You're currently using zeventbooks.com for testing

### **4. Additional Deployment Secrets** (Already Configured)
Your repository also has these secrets configured for Apps Script deployment:
- `DEPLOYMENT_ID` - Apps Script deployment identifier
- `SCRIPT_ID` - Apps Script project ID
- `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` - Service account credentials
- `CLASPRC_JSON` - Clasp authentication
- `CLASP_CREDENTIALS` - Clasp credentials
- `CLASP_TOKEN` - Clasp token
- `OAUTH_CREDENTIALS` - OAuth credentials
- `SERVICE_ACCOUNT_JSON` - Service account JSON

---

## 📝 Verify Your GitHub Secrets

### **Your Existing Secrets** ✅

Your repository already has these secrets configured:

**Admin Keys (Multi-brand):**
- ✅ `ADMIN_KEY_ROOT` - For root brand testing
- ✅ `ADMIN_KEY_ABC` - For ABC brand testing
- ✅ `ADMIN_KEY_CBC` - For CBC brand testing
- ✅ `ADMIN_KEY_CBL` - For CBL brand testing

**Deployment Secrets:**
- ✅ `DEPLOYMENT_ID` - Apps Script deployment ID
- ✅ `SCRIPT_ID` - Apps Script project ID
- ✅ `APPS_SCRIPT_SERVICE_ACCOUNT_JSON`
- ✅ `CLASPRC_JSON`
- ✅ `CLASP_CREDENTIALS`
- ✅ `CLASP_TOKEN`
- ✅ `OAUTH_CREDENTIALS`
- ✅ `SERVICE_ACCOUNT_JSON`

### **To Verify Your Secrets**

1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions
2. You should see all the secrets listed above
3. No action needed - your secrets are ready! ✅

### **Optional: Add PROD_BASE_URL** (If Not Already Set)

If you want to override the default test URL:

```
Name: PROD_BASE_URL
Secret: https://zeventbooks.com
```

**Note**: Currently using zeventbooks.com for testing

---

## 🔒 Secret Security Best Practices

### **DO:**
- ✅ Use GitHub secrets for sensitive values
- ✅ Rotate secrets regularly (every 90 days)
- ✅ Use different keys for production vs testing
- ✅ Limit secret access to necessary workflows
- ✅ Use environment-specific secrets (dev, qa, prod)

### **DON'T:**
- ❌ Never commit secrets to code
- ❌ Never log secret values in tests
- ❌ Never expose secrets in error messages
- ❌ Never share secrets in pull requests
- ❌ Never use production secrets in tests

---

## 🧪 How Secrets Are Used in Tests

### **GitHub Actions Workflow**

The `.github/workflows/quality-gates-scenarios.yml` file references your existing secrets:

```yaml
- name: Run Scenario 1 Tests
  run: npm run test:scenario:1
  env:
    BASE_URL: ${{ secrets.PROD_BASE_URL || 'https://zeventbooks.com' }}
    ADMIN_KEY: ${{ secrets.ADMIN_KEY_ROOT }}  # Uses your ROOT brand key
    BRAND_ID: root
```

**Multi-brand Testing**: To test different brands, you can modify the workflow to use:
- `ADMIN_KEY_ABC` for ABC brand
- `ADMIN_KEY_CBC` for CBC brand
- `ADMIN_KEY_CBL` for CBL brand

### **Test Files**

Test files use `process.env` to access secrets:

```javascript
const BASE_URL = process.env.BASE_URL || 'https://zeventbooks.com';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = process.env.BRAND_ID || 'root';
```

---

## 💻 Local Development Setup

For local testing, use environment variables instead of hardcoding secrets.

### **Option 1: Export in Terminal** (Temporary)

```bash
# Set for current session only
export BASE_URL=https://zeventbooks.com
export ADMIN_KEY=your_root_admin_key_here  # Use value from ADMIN_KEY_ROOT secret
export BRAND_ID=root

# Run tests
npm run test:scenario:1

# For other brands:
# export ADMIN_KEY=your_abc_admin_key_here  # Use value from ADMIN_KEY_ABC
# export BRAND_ID=abc
```

### **Option 2: Create `.env.local` File** (Recommended)

1. Create `.env.local` in project root:

```bash
# .env.local (DO NOT COMMIT THIS FILE)
BASE_URL=https://zeventbooks.com
ADMIN_KEY=your_admin_key_here
BRAND_ID=root
```

2. Add to `.gitignore`:

```bash
echo ".env.local" >> .gitignore
```

3. Load environment variables:

```bash
# Option A: Using source
source .env.local

# Option B: Using dotenv (if installed)
npm run test:scenario:1
```

### **Option 3: Shell Profile** (Permanent)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
# Add to ~/.bashrc or ~/.zshrc
export BASE_URL=https://zeventbooks.com
export ADMIN_KEY=your_admin_key_here
export BRAND_ID=root
```

Reload shell:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

---

## 🌍 Environment-Specific Configuration

### **Production Environment**
```bash
BASE_URL=https://zeventbooks.com
ADMIN_KEY=[Production Admin Key]
BRAND_ID=root
```

### **QA Environment**
```bash
BASE_URL=https://qa.zeventbooks.com
ADMIN_KEY=[QA Admin Key]
BRAND_ID=root
```

### **Development/Apps Script**
```bash
BASE_URL=https://script.google.com/macros/s/.../exec
ADMIN_KEY=[Dev Admin Key]
BRAND_ID=root
```

---

## ✅ Verify Setup

### **1. Check GitHub Secrets**

Run this workflow manually:
1. Go to **Actions** tab
2. Select **Quality Gates - Agile Test Automation**
3. Click **Run workflow**
4. Select branch and click **Run workflow**

### **2. Check Local Environment**

```bash
# Verify environment variables are set
echo $BASE_URL
echo $ADMIN_KEY
echo $BRAND_ID

# Should show your values (ADMIN_KEY will show if set)
```

### **3. Run a Test**

```bash
# This should work without errors
npm run test:scenario:1
```

If you see: `⚠️ Invalid BASE_URL format: <your-deployed-url>`
- ✅ Set the BASE_URL environment variable

If tests fail with authentication errors:
- ✅ Set the ADMIN_KEY environment variable

---

## 🐛 Troubleshooting

### **Error: "Cannot navigate to invalid URL"**
```bash
# Fix: Set BASE_URL
export BASE_URL=https://zeventbooks.com
npm run test:scenario:1
```

### **Error: "Admin key prompt fails"**
```bash
# Fix: Set ADMIN_KEY
export ADMIN_KEY=your_actual_admin_key
npm run test:scenario:1
```

### **Error: "Secrets not found in GitHub Actions"**
1. Verify secrets are added in repository settings
2. Check secret names match exactly (case-sensitive)
3. Ensure workflow has access to secrets

---

## 📚 Additional Resources

- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Environment Variables in Node.js](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs)
- [Playwright Environment Variables](https://playwright.dev/docs/test-configuration#environment-variables)

---

## 🔄 Secret Rotation Schedule

| Secret | Rotation Frequency | Last Updated | Next Rotation |
|--------|-------------------|--------------|---------------|
| ADMIN_KEY | Every 90 days | [Set date] | [Set date] |
| PROD_BASE_URL | As needed | - | - |
| BRAND_ID | As needed | - | - |

---

## 📞 Need Help?

If you need assistance with secrets setup:
1. Check this guide first
2. Review GitHub Actions logs for error messages
3. Open an issue with tag `testing` and `secrets`
4. **Never** include actual secret values in issues

---

**Last Updated**: 2025-01-15
**Version**: 1.0.0
