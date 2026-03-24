# MVP Scope Definition

> **Source of Truth**: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT branch `main`

This document defines what's in scope for the MVP versus future releases.

---

## The Triangle Value Proposition

```
┌─────────────────────────────────────────────────────────────┐
│                     EVENT ORGANIZERS                         │
│         Easy setup → Marketing assets → Data sharing         │
└─────────────────────────────────────────────────────────────┘
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

**The WOW Factor**: Sponsors get real ROI data (impressions, CTR, dwell time) across all surfaces. This is not optional for MVP.

---

## MVP Surfaces (Frontend)

**Status: LOCKED for Focus Group Testing**

All MVP surfaces are marked with header comments identifying them as focus-group critical:

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
================================================================================
-->
```

| File | Purpose | Status |
|------|---------|--------|
| `Admin.html` | Single control room for event management | MVP LOCKED |
| `Poster.html` | Printable/shareable pre-event asset | MVP LOCKED |
| `Display.html` | TV board with sponsor rotation | MVP LOCKED |
| `Public.html` | Mobile-first attendee view | MVP LOCKED |
| `Sponsor.html` | Sponsor management & package view | MVP LOCKED |
| `SharedReport.html` | Shared analytics for sponsors/admins | MVP LOCKED |

---

## MVP Backend (Services)

| File | Purpose | Status |
|------|---------|--------|
| `Code.gs` | Main router (doGet/doPost) | MVP |
| `Config.gs` | Brand + environment config | MVP |
| `SecurityMiddleware.gs` | Auth & validation | MVP |
| `EventService.gs` | Event CRUD | MVP |
| `FormService.gs` | Registration handling | MVP |
| `SponsorService.gs` | Sponsor logic | MVP |
| `AnalyticsService.gs` | Tracking & metrics | MVP |
| `SharedReporting.gs` | Report generation | MVP |
| `ApiSchemas.gs` | Request/response validation | MVP |

---

## MVP Frontend Bridge

| File | Purpose | Status |
|------|---------|--------|
| `NUSDK.html` | `NU.rpc('api_*')` + SWR cache | MVP |
| `DesignAdapter.html` | Theme/brand switching | MVP |
| `Styles.html` | Global CSS | MVP |
| `Header.html` / `HeaderInit.html` | Navigation | MVP |

---

## API Contracts

### MVP Contracts (LOCKED - Don't Break)

These are the **only** APIs that matter for focus group testing. See `Code.gs:1159` for the canonical list.

```
┌─────────────────────────────────────────────────────────────────────────────
│ EVENT CORE
├─────────────────────────────────────────────────────────────────────────────
│ api_create()              → Create new event (Admin)
│ api_get()                 → Get single event (all surfaces)
│ api_updateEventData()     → Update event data (Admin)
│ api_getPublicBundle()     → Public bundle (Public, Poster, Display)
├─────────────────────────────────────────────────────────────────────────────
│ FORMS
├─────────────────────────────────────────────────────────────────────────────
│ api_createFormFromTemplate() → Create registration form (Admin)
│ api_generateFormShortlink()  → Trackable form links (Admin)
├─────────────────────────────────────────────────────────────────────────────
│ SPONSORS & ANALYTICS
├─────────────────────────────────────────────────────────────────────────────
│ api_getSponsorSettings()  → Sponsor placements (all surfaces)
│ api_getSharedAnalytics()  → Shared analytics (SharedReport) [SharedReporting.gs]
│ api_getSponsorAnalytics() → Sponsor metrics (Sponsor, SharedReport)
│ api_getSponsorROI()       → ROI calculation (Sponsor, SharedReport)
└─────────────────────────────────────────────────────────────────────────────
```

### Supporting APIs (MVP but secondary)

These support the MVP but aren't surface contracts:

```
System:       api_status, api_healthCheck, api_getConfig
Auth:         api_generateToken
Tracking:     api_logEvents, api_createShortlink
Diagnostics:  api_runDiagnostics, api_setupCheck, api_checkPermissions
```

### v2+ APIs (Working but not MVP focus)

Don't delete, but stop designing around these:

```
Portfolio:    api_getPortfolioSponsorReport, api_getPortfolioSummary,
              api_getPortfolioSponsors
Exports:      api_exportReport (advanced spreadsheet matrix)
Multi-brand:  Brand hierarchy, child brand rollups
i18n:         Full internationalization system
```

---

## Experimental Pages (v2+)

Pages marked with `EXPERIMENTAL - v2+ (Not MVP)` headers are not part of focus group testing:

| File | Purpose | Status |
|------|---------|--------|
| `ApiDocs.html` | Interactive API documentation | EXPERIMENTAL |
| `Diagnostics.html` | System diagnostics for admins | EXPERIMENTAL |
| `DiagnosticsDashboard.html` | DevOps monitoring dashboard | EXPERIMENTAL |
| `SponsorDashboard.html` | Advanced sponsor ROI dashboard | EXPERIMENTAL |
| `Signup.html` | Sign-up forms management | EXPERIMENTAL |
| `Test.html` | Triangle Framework testing | EXPERIMENTAL |
| `PlannerCards.html` | Event planner card interface | EXPERIMENTAL |
| `ConfigHtml.html` | System configuration | EXPERIMENTAL |
| `PersonalizedCTA.html` | Dynamic CTA component | EXPERIMENTAL |
| `SponsorPreview.html` | Sponsor preview component | EXPERIMENTAL |

---

## What's Out of Scope

Everything in `docs/archived/` is explicitly NOT part of the MVP:
- Experimental dashboards (`docs/archived/experimental-dashboards/`)
- Experimental frontends (`docs/archived/experimental-frontends/`)
- Hostinger deployment docs (outdated)
- Alternative admin interfaces

---

## Testing Priority

1. **Critical Path**: Event create → Sponsor add → Surface view → Analytics log → Report view
2. **Sponsor Value**: Impressions tracked across Display + Public + Poster → CTR calculated → ROI displayed
3. **Admin Flow**: Login → Create event → Configure sponsors → Generate assets → View reports

---

## Definition of Done for MVP

- [ ] Single event can be created and managed
- [ ] All 6 surfaces render correctly with event data
- [ ] Impressions tracked on Display.html, Public.html, Poster.html
- [ ] CTR tracked via shortlinks
- [ ] Sponsor analytics show real numbers (not mocked)
- [ ] SharedReport.html displays data sponsors can use
- [ ] ROI calculation works with sponsor cost input

---

*Last updated: 2025-11-22*
