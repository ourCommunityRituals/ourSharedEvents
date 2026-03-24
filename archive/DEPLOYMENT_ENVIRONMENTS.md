# Deployment Environments & Custom Domain Setup

## Overview

This project uses **custom domain-based environments** to provide stable URLs for different deployment stages.

**Base Domain:** `zeventbooks.com`

---

## Environment URLs

| Environment | URL | Purpose | Auto-Deploy | Status |
|-------------|-----|---------|-------------|--------|
| **QA** | `https://qa.zeventbooks.com` | Testing & QA validation | Stage 1 (main branch) | ✅ Active |
| **Dev** | `https://dev.zeventbooks.com` | Development testing | Feature branches | 🔜 Future |
| **Production** | `https://app.zeventbooks.com` | Live application | Manual promotion | 🔜 Future |
| **API** | `https://api.zeventbooks.com` | REST API endpoint | Mirrors production | 🔜 Future |

---

## Current Setup (Phase 1)

**Status:** ✅ Operational
**Method:** Hostinger manual redirects

### QA Environment
- **URL:** `https://qa.zeventbooks.com`
- **Deployment:** Manually updated redirect in Hostinger
- **Usage:** Stage 2 testing pipeline

**How it works:**
1. Stage 1 deploys to Google Apps Script
2. You manually update Hostinger redirect to point to new deployment URL
3. Stage 2 tests against `https://qa.zeventbooks.com`

**See:** [PHASE1_QUICK_FIX.md](./PHASE1_QUICK_FIX.md)

---

## Future Setup (Phase 2)

**Status:** 🔜 Planned
**Method:** Cloudflare Workers + KV Store (fully automated)

### Architecture
```
zeventbooks.com (Cloudflare)
├── qa.zeventbooks.com     → Cloudflare Worker → Apps Script QA deployment
├── dev.zeventbooks.com    → Cloudflare Worker → Apps Script Dev deployment
├── app.zeventbooks.com    → Cloudflare Worker → Apps Script Prod deployment
└── api.zeventbooks.com    → Cloudflare Worker → Apps Script API deployment
```

### Benefits
- ✅ Fully automated URL updates via GitHub Actions
- ✅ Clean URLs (no redirects visible to users)
- ✅ Global CDN performance
- ✅ DDoS protection
- ✅ Free SSL certificates
- ✅ Built-in analytics
- ✅ Programmable auth/rate limiting

**See:** [PHASE2_PROFESSIONAL_SETUP.md](./PHASE2_PROFESSIONAL_SETUP.md)

---

## Brand-Specific URLs

Each environment supports multi-brand access via query parameters:

### QA Environment Examples
- **ROOT brand:** `https://qa.zeventbooks.com?p=events&brand=root`
- **ABC brand:** `https://qa.zeventbooks.com?p=events&brand=abc`
- **CBC brand:** `https://qa.zeventbooks.com?p=events&brand=cbc`

### Production (Future)
- **ROOT brand:** `https://app.zeventbooks.com?p=events&brand=root`
- **ABC brand:** `https://app.zeventbooks.com?p=events&brand=abc`
- **CBC brand:** `https://app.zeventbooks.com?p=events&brand=cbc`

---

## Testing Against Environments

### Manual Testing

**QA:**
```bash
# Health check
curl https://qa.zeventbooks.com?p=events&brand=root

# API test
curl https://qa.zeventbooks.com?p=events&brand=root \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

### Automated Testing (Stage 2)

The Stage 2 workflow automatically tests against QA:
```yaml
# .github/workflows/stage2-testing.yml
BASE_URL: https://qa.zeventbooks.com
```

Tests run in sequence:
1. Newman API tests
2. Playwright smoke tests
3. Playwright flow tests
4. Playwright page tests

---

## Deployment Flow

### Current (Phase 1)

```
1. Developer pushes to main
2. Stage 1 runs (GitHub Actions)
   ├─ Unit tests
   ├─ Contract tests
   └─ Deploy to Apps Script
3. Developer manually updates qa.zeventbooks.com redirect in Hostinger
4. Developer triggers Stage 2 (GitHub Actions)
   ├─ Uses https://qa.zeventbooks.com
   ├─ Newman tests
   ├─ Playwright tests
   └─ Quality gate
5. If pass → Ready for production
```

### Future (Phase 2)

```
1. Developer pushes to main
2. Stage 1 runs (GitHub Actions)
   ├─ Unit tests
   ├─ Contract tests
   ├─ Deploy to Apps Script
   └─ ✨ Auto-update qa.zeventbooks.com via Cloudflare API
3. Stage 2 auto-triggers
   ├─ Uses https://qa.zeventbooks.com
   ├─ Newman tests
   ├─ Playwright tests
   └─ Quality gate
4. If pass → Auto-deploy to production (optional)
```

---

## Security Considerations

### Public URLs
- Environment URLs are **semi-public** (anyone with the link can access)
- This is **intentional** for Apps Script web apps set to "Anyone" access
- URL itself is not a secret

### Protected Resources
- **Admin operations** require `ADMIN_KEY` (stored in GitHub Secrets)
- **Write operations** require authentication
- **API calls** support multiple auth methods:
  - Admin key (header)
  - JWT tokens
  - API keys

### Best Practices
- ✅ Never commit admin keys to code
- ✅ Rotate admin keys regularly
- ✅ Use environment-specific keys (different for QA/Prod)
- ✅ Monitor access logs
- ✅ Implement rate limiting (Phase 2)

---

## Environment Variables

### GitHub Secrets (Required)

**For Stage 1 (Deployment):**
- `OAUTH_CREDENTIALS` - Clasp OAuth credentials for Apps Script
- `DEPLOYMENT_ID` - Apps Script deployment ID

**For Stage 2 (Testing):**
- `ADMIN_KEY_ROOT` - Admin key for ROOT brand in QA environment

**For Phase 2 (Cloudflare):**
- `CLOUDFLARE_API_TOKEN` - API token for KV updates
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
- `CLOUDFLARE_KV_NAMESPACE_ID` - KV namespace ID

### Setting GitHub Secrets
```bash
# Navigate to:
# GitHub repo → Settings → Secrets and variables → Actions
# Click "New repository secret"
```

---

## Monitoring & Observability

### Current
- GitHub Actions logs
- Apps Script execution logs
- Manual URL checks

### Future (Phase 2)
- Cloudflare Analytics (traffic, performance)
- Cloudflare Logs (access logs, errors)
- Custom metrics via Workers
- Uptime monitoring (via external service)

---

## Cost Breakdown

| Component | Current (Phase 1) | Future (Phase 2) | Notes |
|-----------|------------------|------------------|-------|
| Domain (Hostinger) | ~$10/year | ~$10/year | One-time purchase |
| DNS Hosting | Included | Free (Cloudflare) | - |
| Redirects | Included | Free (Workers) | Up to 100k req/day |
| SSL Certificates | Included | Free (Cloudflare) | Auto-renewed |
| CDN | None | Free (Cloudflare) | Global edge network |
| **Total** | **~$10/year** | **~$10/year** | 🎉 No increase! |

---

## Migration Path

### Phase 1 → Phase 2 Migration

**Zero downtime migration:**

1. Set up Cloudflare (parallel to Hostinger)
2. Configure Cloudflare Workers
3. Test on temporary subdomain
4. Switch nameservers to Cloudflare
5. DNS propagates (15-60 min)
6. Hostinger redirects automatically stop working
7. Cloudflare Workers take over seamlessly

**Rollback plan:**
- Switch nameservers back to Hostinger
- DNS propagates back (15-60 min)
- System reverts to Phase 1 setup

---

## Troubleshooting

### QA environment not accessible
1. Check Hostinger redirect is configured
2. Verify redirect target URL is correct
3. Test Apps Script URL directly
4. Check DNS propagation: https://dnschecker.org

### Stage 2 tests failing
1. Verify `qa.zeventbooks.com` is accessible in browser
2. Check `ADMIN_KEY_ROOT` secret is set correctly
3. Review test logs for specific errors
4. Test endpoints manually with curl/Postman

### DNS changes not taking effect
1. Wait 5-10 minutes for Hostinger
2. Wait up to 24 hours for full global propagation
3. Clear local DNS cache: `ipconfig /flushdns` (Windows) or `sudo dscacheutil -flushcache` (Mac)
4. Use online DNS checker tools

---

## Related Documentation

- [Phase 1 Quick Fix Guide](./PHASE1_QUICK_FIX.md) - Get QA environment running today
- [Phase 2 Professional Setup](./PHASE2_PROFESSIONAL_SETUP.md) - Cloudflare automation
- [Staged Deployment Guide](./STAGED_DEPLOYMENT_GUIDE.md) - Overall CI/CD architecture
- [Stage 2 Testing Guide](./STAGE2_TESTING.md) - How to run Stage 2 tests

---

## Support

For questions or issues:
1. Check troubleshooting section above
2. Review related documentation
3. Check GitHub Actions logs
4. Open an issue in the repository
