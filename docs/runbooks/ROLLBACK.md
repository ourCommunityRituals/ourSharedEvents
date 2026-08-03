# Production Rollback Procedures

> **Architecture:** Cloudflare Worker + D1 (Phase 2 complete)
> **Last Updated:** 2026-04-09
> **Supersedes:** Previous version referencing oursharedevents.com, GAS, and Google Sheets

---

## Quick Rollback

```bash
# Rollback staging Worker to previous version
wrangler rollback --env staging

# Rollback production Worker to previous version
wrangler rollback --env production
```

## Quick Reference

| Issue                         | Rollback Target         | Command / Action                   |
| ----------------------------- | ----------------------- | ---------------------------------- |
| Worker code regression        | Previous Worker version | `wrangler rollback --env <env>`    |
| Bad D1 migration (staging)    | Drop + recreate DB      | See "D1 Migration Rollback" below  |
| Bad D1 migration (production) | Surgical fix or restore | See "D1 Migration Rollback" below  |
| Broken secrets                | Re-set secrets + deploy | See RUNBOOK-SECRETS.md             |
| DNS / routing broken          | CF Dashboard            | Verify DNS records + Worker routes |
| Everything broken             | Full rollback           | Worker rollback + D1 restore       |

## When to Rollback

Rollback is required when any of these conditions occur:

1. **Health check fails after deployment**
   - `/health` returns non-200 or `"d1": "error"`
   - Events API returns errors

2. **CI smoke tests fail after staging deploy**
   - Security gate failures
   - Functional smoke test failures

3. **Admin access broken**
   - `/admin` returns 401 with correct token
   - Admin API endpoints unreachable

4. **Data integrity issues**
   - D1 migration corrupted table data
   - Feature flags in unexpected state

---

## Rollback Procedures

### Option A: Worker Version Rollback (Fast, Recommended)

Use when Worker code is broken but D1 data is fine.

**Via Wrangler CLI:**

```bash
# 1. List recent deployments
wrangler deployments list --env staging

# 2. Rollback to previous version
wrangler rollback --env staging

# 3. Verify
curl -s https://stg.oursharedevents.com/health | jq
```

**Via Cloudflare Dashboard:**

1. dash.cloudflare.com > Workers & Pages > oursharedevents-stg
2. Deployments tab
3. Find previous working deployment
4. Click "Rollback to this deployment"

**Via git revert (if you want the rollback in source):**

```bash
git revert HEAD
git push origin main
# CI auto-deploys the reverted code to staging
```

### Option B: D1 Migration Rollback

Use when a D1 migration corrupted data or schema.

**Staging (self-service — destructive is OK):**

```bash
cd workers/oursharedevents

# Option 1: Drop and recreate (fastest, loses all staging data)
wrangler d1 delete ocr-db-staging
wrangler d1 create ocr-db-staging
# Update database_id in wrangler.toml if it changed
wrangler d1 migrations apply DB --env staging --remote

# Option 2: Surgical fix (if you know the exact issue)
wrangler d1 execute DB --env staging --command "DROP TABLE IF EXISTS <broken_table>"
wrangler d1 migrations apply DB --env staging --remote
```

**Production (requires careful handling):**

> **STOP.** Production D1 rollback is destructive. Assess whether the issue can be fixed forward instead.

```bash
# 1. Assess the damage
wrangler d1 execute DB --env production --command ".tables"
wrangler d1 execute DB --env production --command "SELECT COUNT(*) FROM events"

# 2. If a specific migration broke things, write a corrective migration
#    Add a new migration file: migrations/0018_fix_<description>.sql
#    Apply it:
wrangler d1 migrations apply DB --env production --remote

# 3. If data is corrupted beyond repair:
#    - Export what you can first (see DISASTER-RECOVERY.md)
#    - Then drop + recreate + re-apply all migrations
#    - Re-seed any critical data
```

**See also:** `workers/oursharedevents/migrations/ROLLBACK_PLAN.md` for the migration-specific rollback plan.

### Option C: Full Rollback (Worker + D1)

Use when everything is broken.

**Step 1: Rollback Worker**

```bash
wrangler rollback --env staging
```

**Step 2: Verify D1 state**

```bash
wrangler d1 execute DB --env staging --command ".tables"
wrangler d1 execute DB --env staging --command "SELECT COUNT(*) FROM events"
```

**Step 3: If D1 is also broken, restore**

```bash
# Drop and recreate
wrangler d1 delete ocr-db-staging
wrangler d1 create ocr-db-staging
# Update wrangler.toml with new ID
wrangler d1 migrations apply DB --env staging --remote
wrangler d1 migrations apply FORMS_DB --env staging --remote
```

**Step 4: Redeploy known-good Worker**

```bash
# Check out last known good commit
git log --oneline -10
git checkout <good-commit-hash>

# Deploy directly
cd workers/oursharedevents
npm run deploy:staging
```

**Step 5: Verify**

```bash
curl -s https://stg.oursharedevents.com/health | jq
curl -s https://stg.oursharedevents.com/api/v2/events | jq
```

---

## Verification After Rollback

Run all checks after any rollback:

```bash
# 1. Health check (D1 connectivity)
curl -s https://stg.oursharedevents.com/health | jq
# Expected: { "ok": true, "env": "staging", "d1": "ok" }

# 2. Events API (data layer working)
curl -s https://stg.oursharedevents.com/api/v2/events | jq '.ok'
# Expected: true

# 3. Public page loads
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/
# Expected: 200

# 4. Admin auth works
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <ADMIN_KEY>" \
  https://stg.oursharedevents.com/admin
# Expected: 200

# 5. Admin rejects bad auth
curl -s -o /dev/null -w "%{http_code}" https://stg.oursharedevents.com/admin
# Expected: 401
```

---

## Prevention Checklist

Before any production deployment:

- [ ] Security gate passes (lint, typecheck, unit tests)
- [ ] Staging deploy succeeds
- [ ] D1 migrations applied cleanly to staging
- [ ] Health check passes on staging
- [ ] Functional smoke tests pass on staging
- [ ] Tag follows semver format (`vX.Y.Z`)

---

## Escalation

If rollback fails or issues persist:

1. Check Cloudflare Dashboard for Worker errors
2. Use `wrangler tail --env staging` for real-time logs
3. Review GitHub Actions logs for deployment details
4. Check D1 console in Cloudflare Dashboard for database health

---

## Related Documentation

- [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md) — Full DR procedures
- [RUNBOOK.md](./RUNBOOK.md) — Operational runbook
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) — Secret rotation
- [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md) — Infrastructure setup
- [migrations/ROLLBACK_PLAN.md](../../workers/oursharedevents/migrations/ROLLBACK_PLAN.md) — D1 migration rollback
