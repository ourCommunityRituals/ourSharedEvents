# Archived Google Apps Script (GAS) Backend

**Archived:** 2025-12-13
**Story:** 5.3 - Decommission Apps Script Project
**Status:** ARCHIVED - No longer in active use

---

## Why This Code Was Archived

As part of the migration from Google Apps Script to Cloudflare Workers (Epic 3: GAS Retirement), the GAS backend has been decommissioned. All API traffic now flows through the Cloudflare Worker which connects directly to Google Sheets via the Sheets API.

**Key Migration Benefits:**
- Sub-500ms latency (vs 2-3s with GAS)
- No dependency on Google Apps Script quotas
- Direct control over error handling and observability
- Simplified deployment via Wrangler CI/CD

---

## Archived Files

| File | Purpose | Lines |
|------|---------|-------|
| `Code.gs` | Main router (doGet/doPost) & API handlers | ~900+ |
| `Config.gs` | Brands, environment, templates, feature flags | ~400 |
| `TemplateService.gs` | Event templates (bar, rec, school, fundraiser, custom) | ~800 |
| `ApiSchemas.gs` | JSON Schema validation for API contracts | ~300 |
| `FormService.gs` | Google Forms creation for signups | ~300 |
| `SponsorService.gs` | Sponsor management and ROI tracking | ~400 |
| `SharedReporting.gs` | Analytics views and aggregation | ~300 |
| `AnalyticsService.gs` | Logging and metrics aggregation | ~400 |
| `AnalyticsRollup.gs` | Analytics rollup functions | ~200 |
| `SecurityMiddleware.gs` | Auth, JWT, rate limiting, CSRF | ~350 |
| `BackupService.gs` | Backup and recovery services | ~300 |
| `DataHealthChecker.gs` | Data validation and health checks | ~400 |
| `DiagArchiver.gs` | Diagnostic log archiving | ~300 |
| `appsscript.json` | Apps Script manifest configuration | - |

---

## Original GAS Projects (For Reference)

### Staging (DEPRECATED)
- **Script ID:** `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ`
- **Former Owner:** `mzdano@gmail.com`
- **Status:** DEPRECATED - No longer receives deployments

### Production (ARCHIVED)
- **Script ID:** `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l`
- **Owner:** `zeventbook@gmail.com`
- **Status:** ARCHIVED - Webapp deployments disabled

---

## Restoration Instructions

If you need to restore the GAS backend (emergency rollback scenario):

### Prerequisites
1. Access to `zeventbook@gmail.com` Google account
2. `clasp` CLI installed: `npm install -g @google/clasp`
3. Valid OAuth credentials

### Steps to Restore

1. **Copy archived files back to src/mvp:**
   ```bash
   cp archive/gas/*.gs src/mvp/
   cp archive/gas/appsscript.json src/mvp/
   ```

2. **Restore clasp configuration:**
   ```bash
   # For production (CI-only)
   cp .clasp-production.json.archived .clasp-production.json

   # For staging
   cp .clasp-staging.json.archived .clasp-staging.json
   ```

3. **Login to clasp:**
   ```bash
   clasp login
   ```

4. **Push code to GAS:**
   ```bash
   clasp push --force
   ```

5. **Create new deployment:**
   ```bash
   clasp deploy -d "Emergency restore - $(date -Iseconds)"
   ```

6. **Update Worker to proxy to GAS:**
   - Edit `cloudflare-proxy/wrangler.toml`
   - Set the new deployment ID
   - Re-enable GAS proxy routes in `worker.js`
   - Deploy Worker: `wrangler deploy --env production`

### Important Notes

- GAS deployments are IMMUTABLE - you cannot fix permissions after creation
- Always deploy with `access: "ANYONE_ANONYMOUS"` in appsscript.json
- The GAS proxy routes have been removed from the Worker
- Restoring GAS requires re-adding proxy routes to `worker.js`

---

## Current Architecture (Post-Migration)

All traffic now flows through the Cloudflare Worker:

```
Clients (Admin, Public, Display, Poster)
    │
    ▼
Cloudflare Worker (edge)
    ├── /api/v2/* → Worker-native handlers
    ├── /events, /admin, /display, /poster → HTML templates
    │
    ▼
Google Sheets API (via service account)
    └── Direct access to EVENTS, ANALYTICS, CONFIG sheets
```

**No GAS in the request path.**

---

## Related Documentation

- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) - Current Worker-only architecture
- [CLOUDFLARE_WORKER_MIGRATION.md](../../docs/CLOUDFLARE_WORKER_MIGRATION.md) - Migration history
- [MIGRATION_EPICS.md](../../docs/MIGRATION_EPICS.md) - Full migration story map

---

*Archived as part of Story 5.3 - Decommission Apps Script Project*
