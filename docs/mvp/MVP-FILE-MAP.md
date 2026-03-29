# MVP File Classification Map

**Story Card:** ZEVENT-001 - Label & Separate MVP vs V2 vs Archive
**Last Updated:** 2025-11-23

This document classifies every `.gs` and `.html` file in the Apps Script project into clear tiers. Files are now physically organized by tier.

---

## Directory Structure

```
MVP-EVENT-TOOLKIT/
├── src/
│   ├── mvp/           # Deployed to Apps Script (clasp push)
│   │   ├── *.gs       # Backend services
│   │   └── *.html     # Frontend surfaces + infrastructure
│   └── v2/            # Future features (not deployed)
│       ├── *.gs       # Deferred backend services
│       ├── *.html     # Experimental surfaces
│       └── components/ # Advanced UI components
├── archive/           # Historical/deprecated (reference only)
└── docs/              # Documentation
```

---

## Tier Definitions

| Tier | Directory | Description |
|------|-----------|-------------|
| **MVP_CORE** | `src/mvp/` | Essential runtime files deployed to Apps Script |
| **MVP_INFRA** | `src/mvp/` | Supporting infrastructure (styles, utilities) |
| **V2_PLUS** | `src/v2/` | Experimental/deferred features (not deployed) |
| **ARCHIVE** | `archive/` | Historical/deprecated files (reference only) |

---

## src/mvp/ - Deployed Files

### Backend Services (.gs)

| File | Purpose |
|------|---------|
| `Code.gs` | Router + API endpoints (doGet/doPost), request handling, response envelopes |
| `Config.gs` | Brands, environment config, templates, feature flags |
| `EventService.gs` | Event CRUD operations with LockService for concurrency |
| `TemplateService.gs` | Event templates (bar, rec, school, fundraiser, custom) |
| `SponsorService.gs` | Sponsor management, tier config, ROI tracking |
| `FormService.gs` | Google Forms creation for event signups |
| `SharedReporting.gs` | Analytics views and data aggregation |
| `AnalyticsService.gs` | Logging, metrics, diagnostics (DIAG sheet) |
| `SecurityMiddleware.gs` | Auth, JWT, rate limiting, CSRF protection, input sanitization |
| `ApiSchemas.gs` | JSON Schema validation for API contracts |
| `AnalyticsRollup.gs` | Precomputed analytics for SharedReport performance |
| `DiagArchiver.gs` | DIAG log rotation and archiving (ops tooling) |
| `BackupService.gs` | Control sheet backup/restore (ops tooling) |
| `DataHealthChecker.gs` | Nightly data sanity checks (ops tooling) |

### Frontend Surfaces (.html)

| File | Purpose |
|------|---------|
| `Admin.html` | Event management dashboard - template picker, section toggles, event lifecycle |
| `Public.html` | Mobile-first public event page - map, calendar, share, YouTube/Vimeo embeds |
| `Display.html` | TV/kiosk display layout - auto-rotate, iframe stage, fallback handling |
| `Poster.html` | Print/share with QR - QR grid, sponsor strip, print CSS |
| `SharedReport.html` | Analytics dashboard - 5-metric grid, data tables |

### Infrastructure (.html)

| File | Purpose | Used By |
|------|---------|---------|
| `Styles.html` | CSS design system, base styles | All surfaces |
| `NUSDK.html` | RPC client for API calls | Admin, SharedReport |
| `Header.html` | Page header component with navigation | Admin, SharedReport |
| `HeaderInit.html` | Header initialization scripts | Admin, SharedReport |
| `SponsorUtils.html` | Shared sponsor rendering utilities | Public, Display, Poster |
| `DesignTokens.html` | CSS variables (colors, spacing, typography) | Poster, SharedReport |
| `DesignAdapter.html` | Brand theming adapter | Admin, Poster |
| `CollapsibleSections.html` | Accordion UI component | Admin |
| `SharedUtils.html` | Utility functions (formatting, validation) | (available) |
| `APIClient.html` | API wrapper functions | (available) |

---

## src/v2/ - Future Features (Not Deployed)

### Deferred Backend Services (.gs)

| File | Purpose | Notes |
|------|---------|-------|
| `TemplateManagementService.gs` | Custom template CRUD for SEM staff | Feature-flagged OFF (TEMPLATE_MANAGEMENT_V2) |

### Experimental Surfaces (.html)

| File | Purpose |
|------|---------|
| `PortfolioDashboard.html` | Multi-brand portfolio analytics dashboard |

### Archived Services (in archive/v2-code/)

| File | Purpose | Notes |
|------|---------|-------|
| `i18nService.gs` | Multi-language support | Feature-flagged OFF |
| `WebhookService.gs` | External integrations (Zapier, Slack) | Feature-flagged OFF |
| `SponsorPortfolioV2.gs` | Advanced sponsor portfolio | Feature-flagged OFF |

---

## archive/ - Historical/Deprecated

Files moved from `docs/archived/` for reference only. Not deployed.

### Experimental Frontends

| File | Purpose |
|------|---------|
| `experimental-frontends/AdminEnhanced.html` | Enhanced admin UI experiment |
| `experimental-frontends/AdminWizard.html` | Wizard-style admin flow experiment |
| `experimental-frontends/SponsorDashboard.html` | Sponsor dashboard experiment |
| `experimental-frontends/SponsorPreview.html` | Sponsor preview experiment |

### Experimental Dashboards

| File | Purpose |
|------|---------|
| `experimental-dashboards/test-dashboard.html` | Test dashboard experiment |
| `experimental-dashboards/dashboard/` | Public dashboard experiment |

### Analysis Reports & Documentation

Historical analysis reports, deployment guides, and planning documents.

---

## Deployment Configuration

### .clasp.json

```json
{
  "scriptId": "1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l",
  "rootDir": "./src/mvp"
}
```

### What Gets Deployed

Only files in `src/mvp/` are pushed to Apps Script:

```
src/mvp/
├── appsscript.json     # Apps Script manifest
├── *.gs                # 13 backend services
└── *.html              # 5 surfaces + 12 infrastructure = 17 files
```

**Total deployed: 31 files** (1 manifest + 13 .gs + 17 .html)

---

## Summary by Location

| Location | .gs Files | .html Files | Total |
|----------|-----------|-------------|-------|
| `src/mvp/` | 13 | 17 | 30 (+1 manifest) |
| `src/v2/` | 1 | 1 | 2 |
| `archive/v2-code/` | 3 | 11+ | 14+ |
| `archive/` | - | 7+ | 7+ |

---

## Quick Reference

### Deploy to Apps Script

```bash
npm run push   # Pushes only src/mvp/ to Apps Script
```

### V2+ Features (Feature-Flagged)

```javascript
// In src/mvp/Config.gs
ZEB.FEATURES = {
  WEBHOOKS: false,  // src/v2/WebhookService.gs
  I18N: false       // src/v2/i18nService.gs
};
```

### How to Identify V2+ Files

All V2+ HTML files have this header comment:

```html
<!--
================================================================================
EXPERIMENTAL - v2+ (Not MVP)
================================================================================
-->
```

---

## Related Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Technical architecture overview
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment and CI/CD
- **[../README.md](../README.md)** - Project overview

---

*MVP File Classification - ZEVENT-001*
