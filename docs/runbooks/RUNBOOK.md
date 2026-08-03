# Operations Runbook

> **Purpose:** Step-by-step procedures for diagnosing and resolving common production issues.
> **Architecture:** Cloudflare Worker + D1 (Phase 2 complete)
> **Last Updated:** 2026-04-09
> **Supersedes:** Previous version referencing oursharedevents.com, GAS, and Google Sheets

---

## Quick Reference

### Health Check URLs

| Check          | URL                                             | Expected Response                       |
| -------------- | ----------------------------------------------- | --------------------------------------- |
| Health         | `https://stg.oursharedevents.com/health`        | `{"ok":true,"env":"staging","d1":"ok"}` |
| Events API     | `https://stg.oursharedevents.com/api/v2/events` | `{"ok":true,"items":[...]}`             |
| Public page    | `https://stg.oursharedevents.com/`              | HTTP 200, HTML                          |
| Admin (authed) | `https://stg.oursharedevents.com/admin`         | HTTP 200 (with Bearer token)            |

> Replace `stg` with `www` or remove subdomain for production URLs.

### Quick Commands

```bash
# Basic health check
curl -s https://stg.oursharedevents.com/health | jq

# Events API
curl -s https://stg.oursharedevents.com/api/v2/events | jq

# Admin auth test
curl -s -H "Authorization: Bearer <ADMIN_KEY>" \
  https://stg.oursharedevents.com/api/v2/admin/events | jq '.ok'

# Live logs (real-time)
wrangler tail --env staging
```

---

## Incident Response

### When Alerted

**Step 1: Acknowledge** (0-2 minutes)

- Note the time and initial symptoms

**Step 2: Verify** (2-5 minutes)

```bash
# Health endpoint — checks D1 connectivity
curl -s https://stg.oursharedevents.com/health | jq

# If health fails, check Cloudflare status
# https://www.cloudflarestatus.com/
```

**Step 3: Diagnose** (5-15 minutes)

- See specific issue sections below
- Use `wrangler tail --env staging` for real-time error logs

**Step 4: Resolve or Escalate** (15+ minutes)

- Apply fix from runbook
- Or rollback (see ROLLBACK.md)

---

## Common Issues

### Issue: Health Check Returns Non-200

**Symptoms:**

- Health endpoint returns 5xx or no response
- D1 connectivity shows `"d1": "error"`

**Diagnostic Steps:**

1. **Check Cloudflare status**: https://www.cloudflarestatus.com/ (Workers + D1)

2. **Check Worker logs**:

   ```bash
   wrangler tail --env staging
   ```

3. **Verify D1 is accessible**:
   ```bash
   wrangler d1 execute DB --env staging --command "SELECT 1"
   ```

**Resolution:**

- If Cloudflare is down: Wait for restore
- If D1 query fails: Check migrations are applied (`wrangler d1 migrations apply DB --env staging --remote`)
- If Worker throws: Check logs for the specific error, redeploy if needed

---

### Issue: D1 Query Errors

**Symptoms:**

- Events API returns errors
- Health shows `"d1": "error"`

**Diagnostic Steps:**

1. **Check table existence**:

   ```bash
   wrangler d1 execute DB --env staging --command ".tables"
   ```

2. **Check migration state**:

   ```bash
   wrangler d1 migrations list DB --env staging --remote
   ```

3. **Verify specific table**:
   ```bash
   wrangler d1 execute DB --env staging --command "SELECT COUNT(*) FROM events"
   ```

**Resolution:**

- If tables missing: Apply migrations
  ```bash
  wrangler d1 migrations apply DB --env staging --remote
  wrangler d1 migrations apply FORMS_DB --env staging --remote
  ```
- If data corrupted: See DISASTER-RECOVERY.md for D1 restore procedures

---

### Issue: Admin Authentication Fails

**Symptoms:**

- `/admin` returns 401 even with correct token
- Admin API endpoints reject Bearer token

**Diagnostic Steps:**

1. **Verify ADMIN_KEY is set**:

   ```bash
   wrangler secret list --env staging
   # Should show ADMIN_KEY
   ```

2. **Test auth**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer <ADMIN_KEY>" \
     https://stg.oursharedevents.com/admin
   ```

3. **Check ALLOW_ADMIN_KEY_FALLBACK** (staging only):
   - In `wrangler.toml`: `ALLOW_ADMIN_KEY_FALLBACK = "true"` should be set for staging
   - Production uses CF Access JWT as primary

**Resolution:**

- Re-set the secret: `wrangler secret put ADMIN_KEY --env staging`
- Redeploy: `npm run deploy:staging`

---

### Issue: Recent Deployment Broke Something

**Symptoms:**

- Issues started after a push to main
- New build version in health response

**Diagnostic Steps:**

1. **Check current build**:

   ```bash
   curl -s https://stg.oursharedevents.com/health | jq '.version'
   ```

2. **Check GitHub Actions history**:
   - Repository > Actions tab > recent workflow runs
   - Look for failed tests or deployment errors

3. **Check what changed**:
   ```bash
   git log --oneline -10
   ```

**Resolution:**

- Rollback Worker to previous version:
  ```bash
  wrangler rollback --env staging
  ```
- Or revert the commit and push:
  ```bash
  git revert HEAD
  git push origin main
  ```
- See ROLLBACK.md for full rollback procedures

---

### Issue: Forms / PII Encryption Errors

**Symptoms:**

- Form submissions fail
- Email signup encryption errors in logs

**Diagnostic Steps:**

1. **Check FORMS_ENCRYPTION_KEY**:

   ```bash
   wrangler secret list --env staging
   # Should show FORMS_ENCRYPTION_KEY
   ```

2. **Check Forms DB**:
   ```bash
   wrangler d1 execute FORMS_DB --env staging --command ".tables"
   ```

**Resolution:**

- If key missing: `wrangler secret put FORMS_ENCRYPTION_KEY --env staging`
- If forms DB tables missing: `wrangler d1 migrations apply FORMS_DB --env staging --remote`

---

### Issue: PII Cron Job Not Running

**Symptoms:**

- Expired registrations not being deleted
- Survey PII not being scrubbed

**Diagnostic Steps:**

1. **Check cron is configured** (in `wrangler.toml`):

   ```toml
   [triggers]
   crons = ["0 3 * * *"]
   ```

2. **Check logs during cron window** (3 AM UTC):
   ```bash
   wrangler tail --env staging --format pretty
   # Look for FORM_EVENT and LIFECYCLE log entries
   ```

**Resolution:**

- Verify the cron trigger is deployed: redeploy the Worker
- Manually trigger the cron in CF Dashboard: Workers > oursharedevents-stg > Triggers > Run Now

---

## Monitoring

### Cloudflare Dashboard

- Worker analytics: dash.cloudflare.com > Workers > oursharedevents-stg > Analytics
- Request logs: Workers > oursharedevents-stg > Logs
- D1 metrics: Workers > D1 > ocr-db-staging

### GitHub Actions

- CI/CD runs: Repository > Actions tab
- Deploy history: Filter by "oursharedevents-ci" workflow

### Live Logging

```bash
# Staging (real-time logs)
wrangler tail --env staging --format pretty

# Production
wrangler tail --env production --format pretty
```

---

## Escalation

| Role              | Contact             | When to Escalate        |
| ----------------- | ------------------- | ----------------------- |
| Primary On-Call   | (configure in team) | First responder         |
| Backend Developer | (configure in team) | D1 / Worker issues      |
| Infrastructure    | (configure in team) | Cloudflare / DNS issues |

---

## Post-Incident

After resolving an incident:

1. **Document in incident log**
   - Time detected → Time resolved
   - Root cause
   - Fix applied
   - Lessons learned

2. **Update runbook** if the incident revealed a gap in procedures

3. **Consider automation** — if the same issue recurs, add monitoring or auto-recovery

---

## Related Documentation

- [ROLLBACK.md](./ROLLBACK.md) — Rollback procedures
- [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md) — DR protocol
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) — Secret rotation
- [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md) — Infrastructure setup
