# GAS Projects Inventory

**Last Updated:** 2025-12-13
**Status:** ALL PROJECTS ARCHIVED
**Story:** 5.3 - Decommission Apps Script Project

---

## Summary

All Google Apps Script (GAS) projects have been **archived** as part of the migration to Cloudflare Workers. The GAS backend is no longer in active use. All API traffic now flows through the Cloudflare Worker.

**Archive Location:** `archive/gas/`
**Restoration Guide:** `archive/gas/README.md`

---

## Project Inventory Table

| Environment | Script ID | Project Name | Owner Email | Status |
|-------------|-----------|--------------|-------------|--------|
| **Staging** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` | EA-MVP-Backend-Staging | `mzdano@gmail.com` | **ARCHIVED** |
| **Production** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` | EventAngle Production | `zeventbook@gmail.com` | **ARCHIVED** |

---

## Detailed Project Information

### Staging Environment (ARCHIVED)

| Property | Value |
|----------|-------|
| **Script ID** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` |
| **Status** | **ARCHIVED** - No longer receiving deployments |
| **Archived Date** | 2025-12-13 |
| **Former Owner** | `mzdano@gmail.com` |
| **Project Editor URL** | https://script.google.com/home/projects/1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ/edit |
| **Replacement** | Cloudflare Worker at `stg.eventangle.com` |

### Production Environment (ARCHIVED)

| Property | Value |
|----------|-------|
| **Script ID** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| **Status** | **ARCHIVED** - Webapp deployments disabled |
| **Archived Date** | 2025-12-13 |
| **Owner** | `zeventbook@gmail.com` |
| **Project Editor URL** | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit |
| **Replacement** | Cloudflare Worker at `www.eventangle.com` |

---

## Current Architecture

All traffic is now served by Cloudflare Workers:

| Environment | URL | Backend |
|-------------|-----|---------|
| Staging | `https://stg.eventangle.com` | Cloudflare Worker |
| Production | `https://www.eventangle.com` | Cloudflare Worker |

The Workers connect directly to Google Sheets via the Sheets API using a service account.

---

## Archived Configuration Files

The following clasp configuration files have been marked as archived:

| File | Purpose | Status |
|------|---------|--------|
| `.clasp.json` | Default clasp config | ARCHIVED (rootDir → archive/gas) |
| `.clasp-staging.json` | Staging config | ARCHIVED |
| `.clasp-production.json` | Production config | ARCHIVED |
| `.clasp.json.archived` | Backup of original | For restoration |
| `.clasp-staging.json.archived` | Backup | For restoration |
| `.clasp-production.json.archived` | Backup | For restoration |

---

## Emergency Restoration

If GAS needs to be restored for emergency rollback:

1. See `archive/gas/README.md` for detailed instructions
2. Restore GAS code: `cp archive/gas/*.gs src/mvp/`
3. Restore clasp configs from `.archived` backups
4. Push to GAS: `clasp push --force`
5. Create new deployment: `clasp deploy`
6. Update Worker to proxy to GAS

---

## Related Documentation

- [`archive/gas/README.md`](../../archive/gas/README.md) - GAS restoration guide
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - Current Worker-only architecture
- [`CLOUDFLARE_WORKER_MIGRATION.md`](../CLOUDFLARE_WORKER_MIGRATION.md) - Migration history
- [`deploy-manifest.json`](../../deploy-manifest.json) - Deployment manifest

---

## Change Log

| Date | Change | Story |
|------|--------|-------|
| 2025-12-13 | All projects marked ARCHIVED | Story 5.3 |
| 2025-12-11 | Added deprecated project tracking | Story 1.1.2 |
| 2025-12-11 | Initial inventory created | Story 1.1.1 |

---

*All GAS projects archived as part of Story 5.3 - Decommission Apps Script Project*
