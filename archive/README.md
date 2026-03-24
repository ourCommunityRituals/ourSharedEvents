# Archived Documentation

This directory contains archived documentation and code that is no longer part of the active MVP.

## Archive Structure

### `/hostinger-proxy/`
Legacy PHP proxy files replaced by Cloudflare Workers.
- `index.php`, `index-advanced.php` - PHP proxy scripts
- `.htaccess` - Apache rewrite rules
- `README.md`, `ROUTING_EXAMPLES.md` - Proxy documentation

### `/experimental-frontends/`
Alternative Admin interfaces that are not part of the MVP golden path.
- `AdminEnhanced.html` - Enhanced admin UI (experimental)
- `AdminWizard.html` - Step-by-step wizard (experimental)

**MVP Admin**: Use `Admin.html` in the root directory.

### `/experimental-dashboards/`
Standalone dashboard experiments not integrated into main product.
- `dashboard/` - Standalone monitoring dashboard
- `test-dashboard.html` - Test dashboard page

### `/analysis-reports/`
Historical analysis documents from previous sprints and reviews.
- Architecture analyses
- Deployment fix guides
- CI/CD enhancement plans
- Executive summaries
- Consolidation reports

## Current Production Stack

| Component | Current | Archived |
|-----------|---------|----------|
| Proxy Layer | Cloudflare Workers | Hostinger PHP |
| Admin Interface | `Admin.html` | `AdminEnhanced.html`, `AdminWizard.html` |
| Documentation | 13 essential guides in root | 89+ analysis reports |

## For Current Documentation

See root directory for active documentation:
- `README.md` - Project overview
- `START_HERE.md` - Quick start guide
- `DEPLOYMENT.md` - Deployment instructions
- `TESTING.md` - Test infrastructure
- `MVP_GOLDEN_PATH.md` - Canonical pages and architecture

See `docs/` for scope and architecture:
- **`docs/MVP_SURFACES.md`** - MVP scope lock (5 surfaces for focus groups)
- `docs/ARCHITECTURE.md` - System architecture
- `docs/FRIENDLY_URLS.md` - URL routing documentation

## MVP vs Archived

**MVP Surfaces (5 total)**: Admin, Public, Display, Poster, SharedReport

**Everything in this directory is NOT part of the MVP** and should NOT be wired into navigation or tests.
