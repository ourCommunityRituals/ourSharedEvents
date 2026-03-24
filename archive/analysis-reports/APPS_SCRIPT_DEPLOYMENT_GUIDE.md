# Apps Script Web App Deployment Guide

## 🚨 CRITICAL: Template Variables Not Displaying Fix

If you're seeing raw template placeholders like `<?= appTitle ?>`, `<?= ZEB.BUILD_ID ?>`, or `<?= brandId ?>` instead of actual values, follow this deployment guide.

---

## 📋 Issue Description

**Symptoms:**
- Template variables display as raw text: `<?= appTitle ?>`, `<?= buildId ?>`, `<?= ZEB.BUILD_ID ?>`
- Debug panel shows placeholders instead of values
- Header shows `<?= appTitle ?>` instead of "ABC · events"

**Root Cause:**
The `include()` function in your deployed Code.gs is using the old version that doesn't evaluate templates correctly.

**Solution:**
Deploy the updated Code.gs with the fixed `include()` function.

---

## 🚀 Deployment Steps

### Step 1: Open Your Apps Script Project

1. Go to: https://script.google.com
2. Open your project: **MVP Event Toolkit** (or the project containing your web app)
3. Find the file: **Code.gs**

### Step 2: Update Code.gs

You have two options:

**Option A: Copy from GitHub (Recommended)**
1. Go to: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/blob/claude/setup-apps-script-webapp-01ETGy68MvThLu1brsY5NFK1/Code.gs
2. Click "Raw" button
3. Select all content (Ctrl+A / Cmd+A)
4. Copy (Ctrl+C / Cmd+C)
5. In Apps Script editor, select all content in Code.gs
6. Paste (Ctrl+V / Cmd+V)
7. Save (Ctrl+S / Cmd+S)

**Option B: Manual Update**
If you prefer to update just the `include()` function:

1. In Code.gs, find the `include()` function (around line 806-808 in old version)
2. Replace the OLD version:
   ```javascript
   function include(filename) {
     return HtmlService.createHtmlOutputFromFile(filename).getContent();
   }
   ```

3. With the NEW version (lines 819-868):
   ```javascript
   // === Template Context Management ===========================================
   // Global variable to hold template context for include() function
   var TEMPLATE_CONTEXT_ = null;

   /**
    * Set the global template context (used by include() to pass variables)
    * @param {object} context - Template variables to make available to included files
    * @private
    */
   function global_setTemplateContext_(context) {
     TEMPLATE_CONTEXT_ = context;
   }

   /**
    * Get the global template context
    * @returns {object|null} - Current template context or null
    * @private
    */
   function global_getTemplateContext_() {
     return TEMPLATE_CONTEXT_;
   }

   /**
    * Include and evaluate an HTML template file with template variable support
    *
    * This function is called from HTML templates using <?!= include('filename') ?>
    * It evaluates the included file as a template, allowing it to use <?= ?> tags
    * for variable substitution.
    *
    * @param {string} filename - The name of the HTML file to include (without .html extension)
    * @returns {string} - The evaluated HTML content
    */
   function include(filename) {
     // Create template from file to enable template tag evaluation
     const template = HtmlService.createTemplateFromFile(filename);

     // Get the global template context (set by routePage_)
     const context = global_getTemplateContext_();

     // Pass template variables from context to the included template
     // This enables <?= variableName ?> tags in included files to work correctly
     if (context) {
       Object.keys(context).forEach(function(key) {
         template[key] = context[key];
       });
     }

     // Evaluate the template and return the HTML content
     return template.evaluate().getContent();
   }
   ```

4. Also update `routePage_()` function to add template context (lines 402-413):
   ```javascript
   // Add this BEFORE the return tpl.evaluate() line in routePage_():

   // Set global template context for include() function to use
   // This allows included templates to access these variables
   global_setTemplateContext_({
     appTitle: tpl.appTitle,
     brandId: tpl.brandId,
     scope: tpl.scope,
     execUrl: tpl.execUrl,
     ZEB: tpl.ZEB,
     demoMode: tpl.demoMode,
     friendlyUrl: tpl.friendlyUrl || false,
     urlAlias: tpl.urlAlias || ''
   });
   ```

### Step 3: Update All Other .gs Files (If Doing Full Deployment)

If you're doing a complete deployment, also update these files from the repository:
- Config.gs
- EventService.gs
- SponsorService.gs
- AnalyticsService.gs
- WebhookService.gs
- SecurityMiddleware.gs
- FormService.gs
- TemplateService.gs
- SharedReporting.gs
- i18nService.gs
- ApiSchemas.gs

**Note:** All instances of `brandId` have been renamed to `brandId` in the latest version.

### Step 4: Update HTML Template Files

Update these key HTML files from the repository:
- Admin.html
- AdminWizard.html
- DemoMode.html
- HeaderInit.html
- Header.html
- All other .html files in your project

### Step 5: Deploy New Version

1. In Apps Script editor, click **Deploy** → **Manage deployments**
2. Click **+ Create deployment** (or edit existing deployment)
3. Select type: **Web app**
4. Configure:
   - **Description:** "Fix template variable evaluation (brandId refactoring)"
   - **Execute as:** Me
   - **Who has access:** Anyone (or your preferred setting)
5. Click **Deploy**
6. Copy the new deployment URL (should be the same as before if editing existing)

### Step 6: Test the Deployment

**IMPORTANT:** To access Admin.html (advanced mode), you must include `&mode=advanced`:

```
https://script.google.com/macros/s/AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw/exec?page=admin&brand=abc&mode=advanced
```

**URL Breakdown:**
- `page=admin` - Request admin page
- `brand=abc` - Use ABC brand configuration
- `mode=advanced` - **REQUIRED** to display Admin.html (otherwise shows AdminWizard.html)

**Without `mode=advanced`:**
```
https://script.google.com/macros/s/.../exec?page=admin&brand=abc
```
☝️ This will show **AdminWizard.html** (simple mode), NOT Admin.html

---

## ✅ Verification Checklist

After deployment, verify:

### 1. Template Variables Are Evaluated
- [ ] Page title shows actual value (e.g., "ABC · events · admin") NOT `<?= appTitle ?>`
- [ ] Header shows brand name NOT `<?= appTitle ?>`
- [ ] Build info shows "Build: triangle-extended-v1.3" NOT `<?= ZEB.BUILD_ID ?>`

### 2. Demo Mode Debug Panel (Add `&demo=true`)
Visit: `?page=admin&brand=abc&mode=advanced&demo=true`

- [ ] Debug panel shows actual brandId (e.g., "abc") NOT `<?= brandId ?>`
- [ ] Build version shows "triangle-extended-v1.3" NOT `<?= ZEB.BUILD_ID ?>`
- [ ] "Waiting for API calls..." message appears correctly

### 3. Header Display
- [ ] Logo loads correctly
- [ ] Title displays brand name
- [ ] Build number shows correctly

### 4. JavaScript Console (F12 Developer Tools)
- [ ] NO JavaScript errors about undefined variables
- [ ] NO "<?=" or "?>" visible in DOM inspector
- [ ] Variables have actual values when inspecting elements

---

## 🐛 Troubleshooting

### Issue: Still seeing `<?= ... ?>` placeholders

**Solution:**
1. Clear browser cache (Ctrl+Shift+Del / Cmd+Shift+Del)
2. Do a hard refresh (Ctrl+F5 / Cmd+Shift+R)
3. Verify you deployed the LATEST version in Apps Script
4. Check that `include()` function was updated correctly
5. Ensure `global_setTemplateContext_()` is called in `routePage_()`

### Issue: Blank/empty values instead of placeholders

**Possible causes:**
1. Template context not set - check `global_setTemplateContext_()` call
2. Variable names don't match - verify `brandId` not `brandId`
3. ZEB constant not defined - check Config.gs is deployed

### Issue: Page redirects or shows wrong content

**Check:**
- Are you using `&mode=advanced` to see Admin.html?
- Without it, you'll see AdminWizard.html instead
- Verify `brand` parameter is correct (abc, cbc, cbl, or root)

### Issue: Admin.html not loading at all

**Debug steps:**
1. Check Apps Script execution logs: **View** → **Logs**
2. Look for JavaScript errors in browser console (F12)
3. Verify `pageFile_()` function returns 'Admin' for page='admin' with mode='advanced'
4. Check that Admin.html exists in your Apps Script project

---

## 🧪 Testing URLs

### Admin Page (Advanced Mode)
```
Base URL + ?page=admin&brand=abc&mode=advanced
```

### Admin Page (Advanced Mode + Demo)
```
Base URL + ?page=admin&brand=abc&mode=advanced&demo=true
```

### Admin Wizard (Simple Mode - Default)
```
Base URL + ?page=admin&brand=abc
```

### Public Page
```
Base URL + ?page=public&brand=abc
```

### Diagnostics
```
Base URL + ?page=diagnostics&brand=abc
```

---

## 📊 Playwright Test Configuration

For automated testing, use:

```typescript
// playwright.config.ts
const ABC_ADMIN_URL = 'https://script.google.com/macros/s/AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw/exec?page=admin&brand=abc&mode=advanced';

test('Admin page template variables', async ({ page }) => {
  await page.goto(ABC_ADMIN_URL);

  // Verify template variables are NOT raw placeholders
  const title = await page.title();
  expect(title).not.toContain('<?=');
  expect(title).toContain('ABC');
  expect(title).toContain('events');

  // Verify build info
  const buildInfo = page.locator('#headerBuild');
  await expect(buildInfo).toContainText('triangle-extended-v1.3');
  await expect(buildInfo).not.toContainText('<?=');

  // Verify header title
  const headerTitle = page.locator('#headerTitle');
  await expect(headerTitle).not.toContainText('<?=');

  // Check for any remaining template placeholders in DOM
  const body = await page.textContent('body');
  expect(body).not.toContain('<?=');
  expect(body).not.toContain('?>');
});
```

---

## 📝 Summary

**Key Changes:**
- ✅ `brandId` → `brandId` throughout codebase
- ✅ `include()` function now evaluates templates correctly
- ✅ Template context passed to included files
- ✅ All template variables now render properly

**Deployment URL Pattern:**
```
{BASE_URL}/exec?page=admin&brand={BRAND}&mode=advanced
```

**Required Parameters for Admin.html:**
- `page=admin`
- `brand=abc` (or cbc, cbl, root)
- `mode=advanced` ⚠️ **REQUIRED** for Admin.html

**Optional Parameters:**
- `demo=true` - Enable demo mode with debug panel
- `scope=events` - Specify scope (default: events)

---

## 🔗 Related Documentation

- [APPS_SCRIPT_AUTH_FIX.md](./APPS_SCRIPT_AUTH_FIX.md) - Authentication configuration
- [SECURITY_SETUP.md](./SECURITY_SETUP.md) - Security configuration
- [CUSTOM_FRONTEND_GUIDE.md](./CUSTOM_FRONTEND_GUIDE.md) - API integration guide

---

**Last Updated:** 2025-11-19
**Branch:** `claude/setup-apps-script-webapp-01ETGy68MvThLu1brsY5NFK1`
**Commits:** 568ac21 (template fix), a790f7c (brandId refactoring)
