# Quick Reference: Your New Workflow

## ✅ What You DO

```bash
# Make changes
vim Admin.html

# Commit and push
git add .
git commit -m "Add feature"
git push origin main

# Wait 3-5 minutes, check GitHub Actions
# Done! ✅
```

## ❌ What You DON'T DO Anymore

```bash
clasp push        # ❌ NEVER run this
clasp deploy      # ❌ NEVER run this
clasp pull        # ❌ Only for emergencies
```

## 🔍 How to Monitor

1. **GitHub Actions Tab**
   ```
   https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/actions
   ```

2. **Watch Sequential Execution**
   - Stage 1: Deploy (~2 min)
   - Stage 2A: API Tests (~2 min)
   - Gate 1: Check API results
   - Stage 2B: Smoke Tests (~3 min) - only if API passed
   - Gate 2: Check Smoke results  
   - Stage 2C: Expensive Tests (~16 min) - only if Smoke passed

3. **Read Summary**
   - Click on workflow run
   - Scroll to bottom for Summary
   - Shows: URLs, test results, gate decisions

## 🚨 Troubleshooting

| Problem | Solution |
|---------|----------|
| Tests not running | Check if workflow file uploaded correctly |
| Google sign-in required | Verify Apps Script: "Execute as: Me", "Who has access: Anyone" |
| Tests failing | Check test reports in GitHub Actions artifacts |
| Deployment failing | Check OAUTH_CREDENTIALS secret is set |
| URL not working | Verify deployment ID in workflow summary |

## 📊 Test URLs

After deployment, GitHub Actions Summary shows:

```
Apps Script Base:
https://script.google.com/macros/s/AKfycbz.../exec

Test URLs:
- Status:  ?p=status&tenant=root
- Admin:   ?page=admin&tenant=root
- Events:  ?p=events&tenant=root
```

## 🎯 Quality Gates

**Stage 1 Gates (before deploy):**
- ✅ ESLint passes
- ✅ Unit tests pass
- ✅ Contract tests pass

**Stage 2 Gates (after deploy):**
- ✅ Gate 1: API tests pass → Proceed to Smoke
- ✅ Gate 2: Smoke tests pass → Proceed to Expensive
- ✅ Final: All tests pass → Approved for QA

## 💡 Tips

1. **Small commits**: Easier to debug when tests fail
2. **Descriptive messages**: Makes GitHub Actions logs clearer
3. **Check before push**: Run `npm run lint` locally first
4. **Read failures**: Gate failures show EXACTLY what failed
5. **Trust the pipeline**: It's doing what you used to do manually

## 🔐 Secrets Required

GitHub Secrets → Settings → Secrets and variables → Actions:

```
OAUTH_CREDENTIALS     ← Apps Script auth (CRITICAL)
DEPLOYMENT_ID         ← Optional (updates same deployment)
ADMIN_KEY_ROOT        ← For tests
ADMIN_KEY_ABC         ← For tests
ADMIN_KEY_CBC         ← For tests
```

## 📞 Emergency Manual Deploy

Only if GitHub Actions is completely broken:

```bash
# Last resort only!
cd ~/ZEVENTBOOKS/MVP-EVENT-TOOLKIT
clasp push
clasp deploy -d "Emergency hotfix"
```

Then fix GitHub Actions ASAP!

## 🎉 Success Checklist

After implementing new workflow:

- [ ] New stage2-testing.yml uploaded
- [ ] Pushed to main branch
- [ ] Stage 1 runs automatically
- [ ] Stage 2 auto-triggers after Stage 1
- [ ] API tests run first
- [ ] Gate 1 blocks if API fails
- [ ] Smoke tests run second
- [ ] Gate 2 blocks if Smoke fails
- [ ] Expensive tests run last
- [ ] GitHub Summary shows URLs
- [ ] Test without Google sign-in works
- [ ] You NEVER run clasp manually again!
