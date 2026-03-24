# Deployment URLs Reference

## Quick Deploy with Automated Quality Gate

After making changes to your code, deploy and automatically validate with E2E tests:

```bash
npm run deploy:test
```

This will:
1. ✅ Push your latest code to Apps Script
2. ✅ Create a new deployment
3. ✅ Extract deployment URLs automatically
4. ✅ Output formatted test URLs for all brands and pages
5. ✅ **Run E2E tests against deployed URL (QUALITY GATE)**
6. ✅ Pass/Fail validation before manual testing

## Quality Gate Process

**The deployment script enforces a strict quality gate:**

### Test Stages (Sequential)

**Stage 1: 🚨 Smoke Tests (Critical)**
- Basic functionality validation
- Pages load without errors
- Core API endpoints respond
- **If fails → Deployment REJECTED immediately**

**Stage 2: 📄 Page Tests (Components)**
- Individual page validation (Admin, Public, Display, Poster, SharedReport)
- Component functionality
- Form submissions
- Navigation
- **If fails → Deployment REJECTED**

**Stage 3: 🔄 Flow Tests (End-to-End)**
- Complete workflows
- TRIANGLE framework (Admin → Poster → Display → Public)
- SharedReport integration
- Cross-page data propagation
- **If fails → Deployment REJECTED**

### Success Criteria

✅ **ALL tests must pass** for deployment to be considered successful

❌ **ANY test failure** = Deployment REJECTED
- Script exits with error code 1
- URLs are still displayed for debugging
- Clear error message shows which stage failed
- Fix issues and re-deploy

### Why This Matters

> **"If automation has errors, there is no deployment and we fix until the Quality Gate plus the new functionality is working. This is how the code remains with the highest quality and does not waver."**

**Benefits:**
- 🚫 No broken code reaches manual testers
- ⏱️ Fast feedback loop for developers
- 🎯 Automated validation before human time investment
- 📊 Consistent quality across all deployments
- 🔒 Prevents regression bugs

---

## Manual Deployment

If you prefer manual deployment:

```bash
# Push code only (no new deployment)
npm run push

# Create new deployment
npm run deploy

# Get deployment URLs
npx @google/clasp deployments
```

---

## Test URL Format

Once deployed, your URLs follow this pattern:

```
https://script.google.com/macros/s/{SCRIPT_ID}/exec?page={PAGE}&brand={BRAND}
```

### Pages Available:
- `admin` - Event management dashboard
- `report` - **NEW!** Shared Analytics dashboard
- `public` - Public event listings (mobile)
- `display` - TV display mode
- `poster` - Print poster with QR codes
- `test` - Test dashboard
- `api` - API documentation
- `status` - System status
- `diagnostics` - Diagnostics page

### Brands:
- `root` - Zeventbook (main)
- `abc` - American Bocce Co.
- `cbc` - Chicago Bocce Club
- `cbl` - Chicago Bocce League

---

## Quick Testing Checklist

After deployment, test in this order:

1. **Admin Page** - Create test events
   ```
   {URL}?page=admin&brand=root
   ```

2. **Shared Analytics** - View analytics dashboard (NEW!)
   ```
   {URL}?page=report&brand=root
   ```

3. **Public Page** - Mobile experience
   ```
   {URL}?page=public&brand=root
   ```

4. **Display Page** - TV display
   ```
   {URL}?page=display&brand=root&tv=1
   ```

5. **Poster Page** - Print version
   ```
   {URL}?page=poster&brand=root
   ```

---

## Mobile Testing

1. Open any page in Chrome
2. Press `F12` to open DevTools
3. Click device toggle (or `Ctrl+Shift+M`)
4. Select "iPhone 12 Pro" or similar
5. Verify:
   - ✅ No horizontal scrolling
   - ✅ Buttons are thumb-friendly (44px min)
   - ✅ Cards stack vertically
   - ✅ Forms use full width

---

## API Testing

Test the Shared Analytics API:

```javascript
// Open browser console (F12) on any page
google.script.run
  .withSuccessHandler(result => console.log('✅ Success:', result))
  .withFailureHandler(error => console.error('❌ Error:', error))
  .api_getSharedAnalytics({
    brandId: 'root',
    isSponsorView: false
  });
```

Expected response:
```json
{
  "ok": true,
  "value": {
    "totalImpressions": 0,
    "totalClicks": 0,
    "engagementRate": "0%",
    "uniqueEvents": 0,
    "uniqueSponsors": 0,
    "bySurface": {...},
    "byEvent": {...},
    "bySponsor": {...}
  }
}
```

---

## Troubleshooting

**No deployments found?**
```bash
# Create your first deployment
npx @google/clasp deploy --description "Initial deployment"
```

**Code not updating?**
```bash
# Force push your changes
npx @google/clasp push --force
```

**Need to see Apps Script editor?**
```bash
npm run open
```

**Check deployment logs?**
```bash
npm run logs
```

---

## CI/CD Automated Deployment

When you merge to `main` branch, GitHub Actions will automatically:
1. Run linting
2. Run unit tests
3. Run contract tests
4. Deploy to Apps Script
5. Run E2E smoke tests
6. Run E2E page tests
7. Run E2E flow tests
8. Quality gate check

See `.github/workflows/ci.yml` for details.
