# Archive

> Historical documentation, legacy code, and analysis reports.
> Preserved for reference. **Not actively maintained.**

---

## Directory Guide

### [`analysis-reports/`](analysis-reports/) — 89 files

Deep-dive analysis reports generated during development. Covers architecture reviews, deployment analysis, testing audits, security scans, and refactoring plans.

**Key reports:**
- `ARCHITECTURE-FINDINGS-SUMMARY.md` — Architecture analysis findings
- `EXECUTIVE_SUMMARY.md` — Executive project summary
- `CODEBASE_ARCHITECTURE_OVERVIEW.md` — Full codebase overview
- `TESTING_INFRASTRUCTURE_AUDIT.md` — Test infrastructure audit
- `SECURITY_FIXES_REPORT.md` — Security fix report

### [`v2-docs/`](v2-docs/) — 35 files

Documentation from the previous (v2) development iteration. Includes setup guides, testing guides, deployment plans, and design system docs that have been superseded by current `/docs/` content.

### [`v2-code/`](v2-code/) — 25 files

Legacy v2 HTML templates, GAS code, and UI components. Superseded by the current Cloudflare Worker embedded surfaces.

### [`gas/`](gas/) — 16 files

Legacy Google Apps Script backend code (`.gs` files). Being migrated to Cloudflare Workers (Phase 1). Preserved as reference for migration verification.

### [`experimental-dashboards/`](experimental-dashboards/) — 10 files

Prototype Node.js dashboard application. Not used in production.

### [`postman/`](postman/) — 6 files

Postman API test collections for different event phases. Superseded by Playwright E2E tests.

### [`experimental-frontends/`](experimental-frontends/) — 4 files

Prototype admin and sponsor UI components. Not used in production.

### [`hostinger-proxy/`](hostinger-proxy/) — 5 files

Legacy PHP proxy on Hostinger. Fully deprecated — replaced by Cloudflare Worker.

### Root-level archive files — 13 files

Hostinger-era deployment guides and Phase 1 implementation summaries.

---

## When to Reference Archive

- **Migration verification**: Compare GAS behavior against Worker implementation
- **Historical context**: Understand past architecture decisions
- **Analysis reuse**: Some analysis reports contain useful metrics and findings
- **API testing**: Postman collections document legacy API contracts

## When NOT to Use Archive

- **Current development**: Use `/docs/` for active documentation
- **Deployment**: Use `/docs/deployment/` and `/docs/runbooks/`
- **Security baselines**: Use `/docs/security/` for current policies
