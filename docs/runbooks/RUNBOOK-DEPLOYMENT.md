# Runbook: Deploying to Staging and Production

> **Purpose:** Step-by-step deployment procedures for the MVP Event Toolkit.
> **Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks

---

## Quick Reference

| Action                | Command                                  |
| --------------------- | ---------------------------------------- |
| Deploy to staging     | Push to `main` branch (automatic via CI) |
| Deploy to production  | Tag with `vX.Y.Z` (automatic via CI)     |
| Manual staging worker | `wrangler deploy --env staging`          |
| Rollback staging      | `npm run rollback:staging`               |
| Rollback production   | `npm run rollback:prod`                  |

---

## Deployment Workflow

### CI/CD-Based Deployment (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT WORKFLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Create PR to main                                            │
│     └── Stage-1 validates (lint, test, contract, guards)        │
│                                                                  │
│  2. Merge PR to main                                             │
│     └── Stage-1 deploys to staging (stg.oursharedevents.com)         │
│     └── Stage-2 validates live staging                          │
│                                                                  │
│  3. Tag release (vX.Y.Z)                                         │
│     └── Stage-1 deploys to production (www.oursharedevents.com)      │
│     └── Manual approval required for Stage-2 production tests   │
│     └── Stage-2 validates live production                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Deploying to Staging

### Step 1: Prepare Changes

```bash
# Ensure local tests pass
npm run stage1-local

# Or quick CI for faster feedback
npm run ci:local quick
```

### Step 2: Create Pull Request

```bash
# Push your feature branch
git push -u origin feature/my-feature

# Create PR in GitHub targeting main
```

### Step 3: Wait for Stage-1 Validation

Watch the Actions tab for these status checks:

- Security Check
- Lint
- Unit Tests
- Contract Tests
- Guards
- Quality Gates

**All checks must pass before merge.**

### Step 4: Merge PR

Once approved and all checks pass:

- Click "Merge pull request"
- Stage-1 automatically deploys to staging

### Step 5: Verify Staging Deployment

```bash
# Wait for deployment (~2-3 minutes)

# Verify staging is up
curl -s https://stg.oursharedevents.com/ping

# Check backend health
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Run staging smoke tests
npm run test:smoke
```

### Step 6: Monitor Stage-2

Watch the Stage-2 Orchestrator workflow:

- Check Stage-1 Status
- API Smoke Tests
- UI Smoke Tests
- Validation Gate

**Stage-2 must pass before considering production deployment.**

---

## Deploying to Production

### Prerequisites

- [ ] Staging deployment successful
- [ ] Stage-2 staging validation passed
- [ ] No open SEV1 or SEV2 incidents
- [ ] Avoid deploying on Fridays, holidays, or peak traffic times

### Step 1: Verify Staging

```bash
# Ensure staging is healthy
curl -s https://stg.oursharedevents.com/api/health/backend | jq '.ok'
# Expected: true

# Run synthetic health checks
npm run test:synthetic:staging
```

### Step 2: Create Release Tag

```bash
# Get current version
git describe --tags --abbrev=0

# Create new tag (semver format required)
git tag -a v1.2.3 -m "Release v1.2.3: Brief description"

# Push tag to trigger deployment
git push origin v1.2.3
```

### Step 3: Wait for Stage-1 Production Deploy

Stage-1 will:

1. Run all validation steps
2. Deploy Cloudflare Worker to production
3. Create `prod-base-url` artifact for Stage-2

### Step 4: Approve Production Validation

Stage-2 requires manual approval for production:

1. Go to Actions > Stage-2 Orchestrator workflow
2. Click "Review deployments"
3. Select "production" environment
4. Click "Approve and deploy"

### Step 5: Monitor Stage-2 Production Validation

Watch for:

- API smoke tests against production
- UI smoke tests against production
- Validation gate result

### Step 6: Post-Deployment Verification

```bash
# Verify production is up
curl -s https://www.oursharedevents.com/ping

# Check backend health
curl -s https://www.oursharedevents.com/api/health/backend | jq

# Verify no GAS HTML leak
curl -s https://www.oursharedevents.com/events | grep -c "Google Apps Script"
# Expected: 0

# Check Worker headers
curl -s -I https://www.oursharedevents.com/events | grep x-proxied-by
# Expected: x-proxied-by: oursharedevents-worker

# Run production smoke tests
npm run test:prod:smoke
```

### Step 7: Monitor (30 minutes post-deploy)

- Check Cloudflare dashboard for error rates
- Monitor application logs
- Watch for user reports

---

## First Production Launch — One-Time Data Steps

These run once, against the production database, before the first launch. They are data steps, not migrations, so no test brand or fixture ever ships in `migrations/`.

### Founder admin brand membership (OSE-1415)

**Why:** production has no `ADMIN_SCOPE_ALL` escape hatch. That setting exists only on staging, and `tests/prod-admin-scope-config.spec.ts` fails if it is ever added to `[env.production.vars]`. So an admin sees events only through a row in `admin_brand_memberships` (`src/lib/admin-brand-scope.ts`, `resolveAdminBrandScopeAsync`). With 0 rows, the founder's `/admin` list is empty ("deny" scope) on launch day.

**Order:**

1. After the production Cloudflare Access app protects `oursharedevents.com/admin` (OSE-1353).
2. Before the first authenticated admin smoke on production.

**The row:** one row, matching staging's shape exactly. Staging holds `mzdano@gmail.com | root | brand_owner`. The email must match the CF Access identity character for character, because the lookup is an exact `WHERE email = ?`.

**Apply** (idempotent: re-running changes nothing):

```bash
cd workers/oursharedevents
npx wrangler d1 execute DB --env production --remote --command "
INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role)
  VALUES ('mzdano@gmail.com', 'root', 'brand_owner');
INSERT OR IGNORE INTO admin_audit_log
  (id, action, actor, resource_type, resource_id, request_id, outcome, details)
  VALUES ('ose-1415-founder-membership', 'GRANT_BRAND_MEMBERSHIP', 'mzdano@gmail.com',
          'admin_brand_membership', 'mzdano@gmail.com:root', 'runbook:OSE-1415', 'success',
          '{\"role\":\"brand_owner\",\"source\":\"RUNBOOK-DEPLOYMENT first-launch step\"}');"
```

The audit row gives the first admin grant on production a trace in `admin_audit_log`. It uses a fixed id so a re-run stays idempotent.

**Verify:**

```bash
npx wrangler d1 execute DB --env production --remote --command "
SELECT email, brand_id, role FROM admin_brand_memberships;
SELECT action, resource_id, outcome FROM admin_audit_log WHERE id = 'ose-1415-founder-membership';"
# Expected: exactly one membership row (mzdano@gmail.com | root | brand_owner) and one audit row.
```

After OSE-1353, sign in to `https://oursharedevents.com/admin` through the **production** Access app:

- `GET /api/v2/admin/events` must return `ok: true` with `filters` echoed back, not an empty deny-scoped list.
- A non-member identity must still get an empty list. `tests/admin-brand-membership.spec.ts` covers this fail-closed case.

**Never:** add a wildcard brand, add a second identity without its own ticket, or set `ADMIN_SCOPE_ALL` on production.

---

## Manual Deployment (Emergency Only)

Use only when CI/CD is broken and immediate deployment is critical.

### Manual Staging Deploy

```bash
# Deploy staging worker
cd cloudflare-proxy
wrangler deploy --env staging

# Verify
curl -s https://stg.oursharedevents.com/ping
```

### Manual Production Deploy

```bash
# CAUTION: Only use in emergencies
cd cloudflare-proxy
wrangler deploy --env production

# Verify
curl -s https://www.oursharedevents.com/ping
```

---

## Rollback Procedures

### Staging Rollback

```bash
# Single-command rollback
npm run rollback:staging

# Or via wrangler
wrangler rollback --env staging
```

### Production Rollback

```bash
# Single-command rollback
npm run rollback:prod

# Or via wrangler
wrangler rollback --env production
```

### Verify Rollback

```bash
# Check staging
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Check production
curl -s https://www.oursharedevents.com/api/health/backend | jq
```

---

## Troubleshooting

### Deployment Fails in Stage-1

1. Check which quality gate failed in Actions tab
2. Review logs for specific failure reason
3. Fix locally and re-push

### Stage-2 Tests Fail

1. Check which test failed
2. Review Playwright report artifact
3. If staging issue, investigate and fix via new PR
4. If flaky test, re-run workflow

### Worker Not Responding

1. Check Cloudflare dashboard for errors
2. Verify secrets are set: `wrangler secret list --env <env>`
3. Check health endpoint: `curl https://<domain>/api/health/backend`
4. Consider rollback if issues persist

---

## Related Documentation

- [BASELINE.md](./BASELINE.md) - System baseline documentation
- [ROLLBACK.md](./ROLLBACK.md) - Detailed rollback procedures
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD architecture
- [RUNBOOK.md](../RUNBOOK.md) - Incident response
