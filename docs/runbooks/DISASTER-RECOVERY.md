# Disaster Recovery Protocol — ourSharedEvents

> **Architecture:** Cloudflare Worker + D1 (Phase 2 complete)
> **Created:** 2026-04-09
> **Owner:** Matt
> **Status:** ACTIVE
> **Review cadence:** After each production incident or quarterly, whichever comes first

---

## Recovery Objectives

| Metric                             | Target                                       | Rationale                                                |
| ---------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| **RTO** (Recovery Time Objective)  | < 30 minutes                                 | Worker rollback is instant; D1 restore is the bottleneck |
| **RPO** (Recovery Point Objective) | < 24 hours                                   | D1 automatic backups; PII cron runs daily at 3 AM UTC    |
| **MTTR** (Mean Time to Repair)     | < 15 minutes for Worker, < 30 minutes for D1 | Most failures are Worker-level                           |

---

## Disaster Scenarios

### Scenario 1: Worker Deployment Failure

**Impact:** Site returns 500s or incorrect responses
**Severity:** HIGH — all traffic affected
**Recovery Time:** < 5 minutes

**Procedure:**

```bash
# Immediate rollback
wrangler rollback --env production

# Verify
curl -s https://oursharedevents.com/health | jq
```

**Root cause investigation:**

```bash
# Check what was deployed
wrangler deployments list --env production

# Check logs
wrangler tail --env production --format pretty

# Review the commit that caused the issue
git log --oneline -5
```

---

### Scenario 2: D1 Database Corruption

**Impact:** Data queries fail, events API returns errors
**Severity:** CRITICAL — data integrity at risk
**Recovery Time:** < 30 minutes

**Procedure:**

```bash
# 1. Assess damage
wrangler d1 execute DB --env production --command ".tables"
wrangler d1 execute DB --env production --command "SELECT COUNT(*) FROM events"
wrangler d1 execute DB --env production --command "PRAGMA integrity_check"

# 2. If tables are intact but data is wrong:
#    Write a corrective migration and apply it
#    migrations/NNNN_fix_<description>.sql

# 3. If database is unrecoverable:
#    Use Cloudflare D1 time travel (point-in-time restore)
#    Available in CF Dashboard > D1 > database > Settings > Restore
#    D1 retains 30 days of backups on paid plans

# 4. If D1 time travel is unavailable (free plan):
#    Drop and recreate
wrangler d1 delete ocr-db-production
wrangler d1 create ocr-db-production
#    Update wrangler.toml with new database ID
wrangler d1 migrations apply DB --env production --remote
wrangler d1 migrations apply FORMS_DB --env production --remote
#    Re-seed critical data if backups exist
```

**Data loss assessment:**

- Events table: Check if seed data or manually-created events need re-entry
- Forms data: PII is scrubbed daily — any data older than retention period is already gone by design
- Feature flags: Re-apply tier configuration after DB recreate
- Scan aggregates: Populated by scheduled jobs — will rebuild over time

---

### Scenario 3: Secret Compromise

**Impact:** Unauthorized admin access or PII decryption
**Severity:** CRITICAL — security breach
**Recovery Time:** < 15 minutes for rotation, ongoing for investigation

**Procedure:**

```bash
# 1. IMMEDIATELY rotate the compromised secret
openssl rand -hex 32  # Generate new value

# 2. If ADMIN_KEY compromised:
wrangler secret put ADMIN_KEY --env staging
wrangler secret put ADMIN_KEY --env production
# Also update GitHub Actions secret

# 3. If FORMS_ENCRYPTION_KEY compromised:
wrangler secret put FORMS_ENCRYPTION_KEY --env staging
wrangler secret put FORMS_ENCRYPTION_KEY --env production
# WARNING: Previously encrypted email data becomes unreadable
# Accept data loss — security takes priority

# 4. If CLOUDFLARE_API_TOKEN_ESE compromised:
# Create new token in CF Dashboard, revoke old one
# Update GitHub Actions secret

# 5. Redeploy immediately
npm run deploy:staging
# Tag for production: git tag vX.Y.Z && git push origin vX.Y.Z
```

**Post-incident:**

- Review Cloudflare audit logs for unauthorized access
- Check D1 for any unauthorized data reads/writes
- Determine how the secret was exposed (git history, logs, etc.)
- If found in git history: rotate ALL secrets, not just the exposed one
- Document incident in post-mortem

---

### Scenario 4: Cloudflare Zone / DNS Failure

**Impact:** Domain unreachable
**Severity:** HIGH — complete outage
**Recovery Time:** 5 minutes to 48 hours (DNS propagation)

**Procedure:**

1. Check Cloudflare status: https://www.cloudflarestatus.com/
2. If Cloudflare is down: Wait for resolution (Worker is edge-cached, may partially work)
3. If DNS is misconfigured:
   - Verify A records in CF Dashboard: `@`, `www`, `stg` → 192.0.2.1, all Proxied
   - Verify SSL/TLS is Full (strict)
   - Verify Worker routes match `wrangler.toml`
4. If zone was accidentally deleted:
   - Re-add zone in CF Dashboard
   - Re-create DNS records
   - Wait for NS propagation
   - Re-deploy Worker

---

### Scenario 5: Forms Encryption Key Lost (Not Compromised)

**Impact:** Cannot decrypt previously encrypted email signup data
**Severity:** MEDIUM — data loss, not security breach
**Recovery Time:** N/A — encrypted data is unrecoverable without the key

**Procedure:**

1. Generate new key: `openssl rand -hex 32`
2. Set new key: `wrangler secret put FORMS_ENCRYPTION_KEY --env <env>`
3. Redeploy
4. **Accept:** Previously encrypted emails in `email_signups` are permanently lost
5. **Unaffected:** Hashed data (registrations, surveys) — hashing is one-way by design
6. **Unaffected:** Non-PII data (events, sponsors, scans, feature flags)

**Prevention:** Store encryption key backup in a secure location outside of Cloudflare (e.g., Doppler, 1Password vault)

---

## Backup Strategy

### What's Backed Up Automatically

| Component    | Backup Method                | Retention              | Recovery                                           |
| ------------ | ---------------------------- | ---------------------- | -------------------------------------------------- |
| Worker code  | Git repository               | Permanent              | `git checkout` + `wrangler deploy`                 |
| D1 databases | Cloudflare automatic backups | 30 days (paid)         | CF Dashboard > D1 > Restore                        |
| D1 schema    | Migration files in repo      | Permanent              | Re-apply from `migrations/`                        |
| Secrets      | Not backed up by Cloudflare  | N/A                    | Must be re-generated or restored from secure vault |
| DNS config   | Cloudflare zone              | As long as zone exists | Re-create records if zone deleted                  |
| CI/CD config | `.github/workflows/` in repo | Permanent              | Push to main triggers pipeline                     |

### What YOU Must Back Up

| Item                         | Where to Store                         | How Often               |
| ---------------------------- | -------------------------------------- | ----------------------- |
| `ADMIN_KEY` value            | Doppler / 1Password / secure vault     | On every rotation       |
| `FORMS_ENCRYPTION_KEY` value | Doppler / 1Password / secure vault     | On every rotation       |
| `CLOUDFLARE_API_TOKEN_ESE`   | Doppler / 1Password / secure vault     | On every rotation       |
| `CLOUDFLARE_ACCOUNT_ID`      | Documented in `wrangler.toml` comments | Static                  |
| Production D1 database IDs   | In `wrangler.toml` (committed)         | After provisioning      |
| Critical event data          | Manual D1 export (see below)           | Before major migrations |

### Manual D1 Data Export

```bash
# Export events table
wrangler d1 execute DB --env production \
  --command "SELECT * FROM events" --json > backup/events-$(date +%Y%m%d).json

# Export all tables
for table in events sponsors poster_deployments scans scan_aggregates subscribers; do
  wrangler d1 execute DB --env production \
    --command "SELECT * FROM $table" --json > backup/${table}-$(date +%Y%m%d).json
done
```

---

## Documentation as Code — DR Compliance

Per VISION.md DAC principle, this DR protocol follows documentation-as-code standards:

1. **Versioned:** This file is committed to the repository and tracked in git
2. **Tested:** DR procedures should be exercised against staging before production incidents
3. **Cross-referenced:** Links to ROLLBACK.md, RUNBOOK.md, RUNBOOK-SECRETS.md, INFRA-CHECKLIST.md
4. **Reviewed:** Updated after every production incident or quarterly
5. **Single source of truth:** No duplicate DR procedures in other documents — they link here

### DR Drill Schedule

| Drill            | Frequency                    | Environment | Procedure                                       |
| ---------------- | ---------------------------- | ----------- | ----------------------------------------------- |
| Worker rollback  | Monthly                      | Staging     | Deploy intentionally bad code, rollback, verify |
| D1 restore       | Quarterly                    | Staging     | Drop DB, recreate, re-apply migrations, verify  |
| Secret rotation  | Quarterly (or 90-day policy) | Both        | Full rotation per RUNBOOK-SECRETS.md            |
| Full DR exercise | Semi-annually                | Staging     | Simulate complete outage, recover from scratch  |

---

## Post-Incident Template

After any disaster recovery event, document using this template:

```markdown
## Incident: [Title]

**Date:** YYYY-MM-DD
**Duration:** HH:MM
**Severity:** LOW / MEDIUM / HIGH / CRITICAL
**Scenario:** (reference scenario number above)

### Timeline

- HH:MM — Issue detected
- HH:MM — Investigation started
- HH:MM — Root cause identified
- HH:MM — Recovery action taken
- HH:MM — Service restored
- HH:MM — Verification complete

### Root Cause

[What went wrong]

### Recovery Actions

[What was done to fix it]

### Prevention

[What changes prevent recurrence]

### DR Protocol Updates

[Any changes needed to this document]
```

---

## Related Documentation

- [ROLLBACK.md](./ROLLBACK.md) — Rollback procedures (subset of DR)
- [RUNBOOK.md](./RUNBOOK.md) — Operational runbook
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) — Secret rotation procedures
- [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md) — Infrastructure provisioning
- [migrations/ROLLBACK_PLAN.md](../../workers/oursharedevents/migrations/ROLLBACK_PLAN.md) — D1 migration rollback
- [PRODUCTION_DEPLOYMENT_POLICY.md](../deployment/PRODUCTION_DEPLOYMENT_POLICY.md) — Deploy gates
