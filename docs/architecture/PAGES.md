# Page Classification

> Which pages are shipped MVP surfaces vs internal/archived

## MVP Shipped Surfaces (Focus Group Ready)

| Page | Purpose | Users |
|------|---------|-------|
| **Admin.html** | Event creation & management | Event organizers |
| **Public.html** | Public event page | Attendees |
| **Display.html** | TV/kiosk display | Venues |
| **Poster.html** | Printable event poster | Print output |
| **SharedReport.html** | Sponsor ROI report | Sponsors |
| **Sponsor.html** | Sponsor management | Admins |

## Internal / Admin Pages (Not for End Users)

| Page | Purpose | Status |
|------|---------|--------|
| Diagnostics.html | System health checks | Internal only |
| DiagnosticsDashboard.html | Extended diagnostics | Internal only |
| Test.html | Triangle Framework testing | Dev only |
| ConfigHtml.html | System configuration | Admin only |
| ApiDocs.html | API documentation | Developer docs |

## Utility Includes (Not Standalone Pages)

| File | Purpose |
|------|---------|
| Styles.html | Global CSS |
| Header.html | Page header component |
| HeaderInit.html | Header initialization |
| DesignTokens.html | Design system tokens |
| DesignAdapter.html | Design adapter |
| SharedUtils.html | Shared JavaScript utilities |
| SponsorUtils.html | Sponsor-specific utilities |
| CollapsibleSections.html | UI component |
| EmptyStates.html | Empty state UI |
| ImageOptimization.html | Image utilities |
| Tooltips.html | Tooltip component |
| AccessibilityUtils.html | A11y utilities |
| NUSDK.html | NU SDK integration |
| DemoMode.html | Demo mode logic |
| APIClient.html | API client |
| PersonalizedCTA.html | CTA component |
| PlannerCards.html | Planner cards UI |
| Signup.html | Signup form embed |

## Archived / Experimental (v2+)

Located in `docs/archived/experimental-frontends/`:

| Page | Purpose | Status |
|------|---------|--------|
| SponsorDashboard.html | Advanced sponsor ROI dashboard | v2+ |
| SponsorPreview.html | Sponsor preview tool | v2+ |
| AdminWizard.html | Wizard-style admin flow | v2+ |
| AdminEnhanced.html | Enhanced admin UI | v2+ |

These files have headers marking them as `EXPERIMENTAL - v2+ (Not MVP)`.

---

## URL Patterns

MVP surfaces are served via Apps Script:
```
https://script.google.com/.../exec?p=admin&brand=xxx
https://script.google.com/.../exec?p=public&eventId=xxx
https://script.google.com/.../exec?p=display&brand=xxx
https://script.google.com/.../exec?p=poster&eventId=xxx
https://script.google.com/.../exec?p=report&eventId=xxx
```

Custom domain (eventangle.com):
```
https://eventangle.com/events/[slug]     → Public.html
https://eventangle.com/display/[brand]   → Display.html
https://eventangle.com/poster/[eventId]  → Poster.html
```
