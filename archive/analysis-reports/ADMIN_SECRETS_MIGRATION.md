# Admin Secrets Migration Guide

## Overview

This guide explains how to migrate from hardcoded admin secrets in `Config.gs` to secure Script Properties storage.

**⚠️ CRITICAL SECURITY FIX**: Admin secrets were previously hardcoded in source code (committed to git). This has been fixed by moving secrets to Google Apps Script's PropertiesService.

## Why This Change?

- **Security**: Secrets in source code are visible to anyone with repository access
- **Compliance**: Hardcoded secrets violate security best practices
- **Auditability**: PropertiesService provides better access control
- **Rotation**: Easier to rotate secrets without code changes

## Migration Steps

### Step 1: Access Apps Script Editor

1. Open your Google Apps Script project:
   - Go to https://script.google.com
   - Open project ID: `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`

### Step 2: Set Script Properties (Manual Method)

1. In Apps Script Editor, go to **Project Settings** (gear icon)
2. Scroll to **Script Properties**
3. Click **Add script property**
4. Add the following properties:

| Property Name | Value (use your actual secrets) |
|---------------|--------------------------------|
| `ADMIN_SECRET_ROOT` | `4a249d9791716c208479712c74aae27a` |
| `ADMIN_SECRET_ABC` | `<generate-new-secret>` |
| `ADMIN_SECRET_CBC` | `<generate-new-secret>` |
| `ADMIN_SECRET_CBL` | `<generate-new-secret>` |

**⚠️ IMPORTANT**: Replace `CHANGE_ME_*` values with strong, randomly generated secrets.

### Step 3: Generate Strong Secrets

Use this command to generate strong secrets:

```bash
# On Linux/Mac
openssl rand -hex 16

# On Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### Step 4: Set Script Properties (Automated Method)

Alternatively, use the helper function in `Config.gs`:

1. Open Apps Script Editor
2. Click on `Config.gs`
3. In the toolbar, select function: `setupAdminSecrets_`
4. Click **Run**
5. Authorize the script when prompted
6. Check the **Execution log** for success messages

Example code to run manually:

```javascript
// Run this once in Apps Script Editor
setupAdminSecrets_({
  root: '4a249d9791716c208479712c74aae27a',  // Replace with actual secret
  abc: 'your-new-secret-for-abc',
  cbc: 'your-new-secret-for-cbc',
  cbl: 'your-new-secret-for-cbl'
});
```

### Step 5: Verify Migration

Test that secrets are working:

1. In Apps Script Editor, run: `getAdminSecret_('root')`
2. Check execution log - should show your secret value
3. If returns `null`, secrets are not set correctly

### Step 6: Update Test Secrets

Update the GitHub Actions secret `ADMIN_KEY_ROOT` to match the new value:

1. Go to GitHub repository settings
2. Navigate to **Secrets and variables** → **Actions**
3. Update `ADMIN_KEY_ROOT` with the value from `ADMIN_SECRET_ROOT`

### Step 7: Deploy Updated Code

The code changes are already in this commit. Deploy to production:

```bash
# From local machine
npm run deploy

# Or wait for GitHub Actions to auto-deploy on merge to main
```

### Step 8: Test API Authentication

Test that API authentication still works:

```bash
# Test health endpoint
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?p=status&brand=root"

# Test authenticated endpoint
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "list",
    "brandId": "root",
    "adminKey": "YOUR_ADMIN_SECRET_ROOT",
    "scope": "events"
  }'
```

## Troubleshooting

### Problem: API returns "Invalid admin key"

**Solution**: Check that Script Properties are set correctly

```javascript
// Run in Apps Script Editor
const props = PropertiesService.getScriptProperties();
console.log('ROOT secret:', props.getProperty('ADMIN_SECRET_ROOT'));
```

### Problem: Tests failing in GitHub Actions

**Solution**: Update `ADMIN_KEY_ROOT` secret in GitHub:

1. Get the value from Script Properties `ADMIN_SECRET_ROOT`
2. Update GitHub secret to match

### Problem: "Brand secret not configured" error

**Solution**: Ensure all 4 brand secrets are set:

```javascript
// Check all secrets
['ROOT', 'ABC', 'CBC', 'CBL'].forEach(brand => {
  const key = `ADMIN_SECRET_${brand}`;
  const val = PropertiesService.getScriptProperties().getProperty(key);
  console.log(key + ':', val ? '✅ SET' : '❌ MISSING');
});
```

## Security Best Practices

### ✅ DO

- Use strong, randomly generated secrets (32+ characters)
- Rotate secrets periodically (every 90 days)
- Use different secrets for each brand
- Never commit secrets to version control
- Use GitHub Secrets for CI/CD secrets

### ❌ DON'T

- Don't use weak secrets like "password123"
- Don't reuse the same secret across brands
- Don't hardcode secrets in source files
- Don't share secrets via email/Slack
- Don't commit `.env` files with real secrets

## Secret Rotation Process

When rotating secrets:

1. Generate new secret: `openssl rand -hex 16`
2. Update Script Property (e.g., `ADMIN_SECRET_ROOT`)
3. Update GitHub Secret (`ADMIN_KEY_ROOT`)
4. Test API authentication
5. No code deployment needed!

## Reference

### Script Properties API

```javascript
// Get a secret
const secret = getAdminSecret_('root');

// Set a secret
PropertiesService.getScriptProperties().setProperty('ADMIN_SECRET_ROOT', 'new-value');

// Delete a secret
PropertiesService.getScriptProperties().deleteProperty('ADMIN_SECRET_ROOT');

// List all secrets
const allProps = PropertiesService.getScriptProperties().getProperties();
console.log(allProps);
```

### Files Modified

- `Config.gs`: Removed hardcoded `adminSecret` fields
- `Config.gs`: Added `getAdminSecret_()` helper function
- `Code.gs`: Updated all references to use `getAdminSecret_()`
- `.github/workflows/stage1-deploy.yml`: Added secret validation

## Support

If you encounter issues, check:

1. **Execution logs** in Apps Script Editor
2. **GitHub Actions logs** for CI/CD failures
3. **Newman test reports** for API authentication errors

## Post-Migration Checklist

- [ ] Script Properties set for all 4 brands
- [ ] GitHub Actions secret `ADMIN_KEY_ROOT` updated
- [ ] Code deployed to production
- [ ] API authentication tested
- [ ] Newman tests passing
- [ ] Old hardcoded secrets removed from Config.gs (already done)
- [ ] Team notified of secret rotation

---

**Migration completed on**: _[Add date after migration]_
**Migrated by**: _[Add name]_
**Verified by**: _[Add name]_
