# MVP Surfaces - Scope Lock

> **Status**: LOCKED for Focus Group Testing
> **Last Updated**: 2025-11-22
> **Version**: MVP v1.0

---

## The MVP Statement

**"These 5 pages are the product for focus groups. Everything else is internal or v2."**

This document is the source of truth for MVP scope. Do not add new surfaces, features, or dependencies without explicit approval.

---

## MVP Surfaces (5 Total)

| # | Surface | File | Route | Purpose |
|---|---------|------|-------|---------|
| 1 | **Admin** | `Admin.html` | `?page=admin` | Event management control room |
| 2 | **Public** | `Public.html` | `?page=public` (default) | Mobile-first public event page |
| 3 | **Display** | `Display.html` | `?page=display` | TV/kiosk live event display |
| 4 | **Poster** | `Poster.html` | `?page=poster` | Printable poster with QR code |
| 5 | **SharedReport** | `SharedReport.html` | `?page=report` | Shareable analytics dashboard |

### Surface Headers

All MVP surfaces are marked with this header:

```html
<!--
================================================================================
MVP SURFACE - Focus Group Critical
================================================================================
Page: [filename].html
Purpose: [description]
Status: LOCKED for MVP v1.0

DO NOT modify this file's contracts without updating:
  - NUSDK.html (API client)
  - tests/e2e/* (end-to-end tests)
  - tests/unit/* (unit tests)

Related MVP Surfaces: Admin, Poster, Display, Public, SharedReport
================================================================================
-->
```

---

## NOT MVP (v2+)

These pages exist but are **NOT** part of focus group testing:

| Page | File | Status | Notes |
|------|------|--------|-------|
| Sponsor | `Sponsor.html` | V2+ | Sponsor self-service portal |
| API Docs | `ApiDocs.html` | EXPERIMENTAL | Developer tooling |
| Diagnostics | `Diagnostics.html` | EXPERIMENTAL | Admin debugging |
| DevOps Dashboard | `DiagnosticsDashboard.html` | EXPERIMENTAL | Operations |
| Test Dashboard | `Test.html` | EXPERIMENTAL | Dev testing |
| Sign-Up Forms | `Signup.html` | EXPERIMENTAL | Advanced forms |
| Planner Cards | `PlannerCards.html` | EXPERIMENTAL | Alt UI |
| System Config | `ConfigHtml.html` | EXPERIMENTAL | Advanced config |

### Non-MVP Headers

All non-MVP surfaces are marked with this header:

```html
<!--
================================================================================
EXPERIMENTAL - v2+ (Not MVP)
================================================================================
Page: [filename].html
Purpose: [description]
Status: NOT included in MVP focus group testing
================================================================================
-->
```

---

## Archived (Not Wired)

Files in `docs/archived/` are explicitly out of scope:

- `docs/archived/experimental-frontends/` - Alternative admin interfaces
- `docs/archived/experimental-dashboards/` - Standalone dashboard experiments
- `docs/archived/analysis-reports/` - Historical analysis documents

These are not wired into navigation or tests.

---

## The Triangle Value Proposition

```
┌─────────────────────────────────────────────────────────────────┐
│                     EVENT ORGANIZERS                             │
│         Easy setup → Marketing assets → Data sharing             │
└─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────▼─────────────┐
                │      SHARED ANALYTICS      │
                │   Impressions + CTR + ROI  │
                └─────────────┬─────────────┘
                              │
        ┌─────────────────────┼─────────────────────────┐
        ▼                     ▼                         ▼
┌───────────────┐   ┌─────────────────┐       ┌─────────────────┐
│   SPONSORS    │   │    CUSTOMERS    │       │    SURFACES     │
│ Real numbers  │   │ Quality exp     │       │ Mobile+Display  │
│ Not bullshit  │   │ Before/During/  │       │ +Poster+Public  │
│               │   │ After           │       │                 │
└───────────────┘   └─────────────────┘       └─────────────────┘
```

**The WOW Factor**: Sponsors get real ROI data (impressions, CTR, dwell time) across all surfaces.

---

## MVP Definition of Done

- [ ] Single event can be created and managed (Admin)
- [ ] All 5 surfaces render correctly with event data
- [ ] Impressions tracked on Display, Public, Poster
- [ ] CTR tracked via shortlinks
- [ ] SharedReport displays analytics data
- [ ] Sponsor data visible in SharedReport (managed via Admin)

---

## Rules for Changing Scope

1. **DO NOT** add new surfaces without updating this document
2. **DO NOT** wire experimental pages into navigation
3. **DO NOT** add test coverage for v2+ features
4. **DO** keep all non-MVP code clearly marked
5. **DO** update this document if scope changes are approved

---

## Quick Reference

```
MVP (Test These):
  ✅ Admin        - /exec?page=admin
  ✅ Public       - /exec?page=public (default)
  ✅ Display      - /exec?page=display
  ✅ Poster       - /exec?page=poster
  ✅ SharedReport - /exec?page=report

NOT MVP (Don't Test):
  ❌ Sponsor.html
  ❌ ApiDocs.html
  ❌ Diagnostics*.html
  ❌ Test.html
  ❌ Signup.html
  ❌ PlannerCards.html
  ❌ ConfigHtml.html
  ❌ docs/archived/*
```
