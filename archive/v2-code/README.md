# V2 Code Archive

**Archived by:** Story 16 - Remove Non-MVP TODOs & V2 Remnants
**Date:** 2024

## Purpose

This folder contains V2+ experimental code that was removed from the MVP deployment.
These files were in `src/v2/` but are NOT included in the Apps Script deployment
(which only deploys `src/mvp/` per `.clasp.json`).

## Why Archived

1. **Not deployed**: These files were never in the production deployment
2. **Feature-gated**: Features like webhooks and i18n were behind feature flags
3. **MVP focus**: Story 16 cleans the codebase to include only MVP surfaces

## Contents

### Backend Services (*.gs)
- `WebhookService.gs` - Event-driven webhook system (WEBHOOKS feature flag)
- `i18nService.gs` - Internationalization/multi-language support (I18N feature flag)

### Frontend Pages (*.html)
- `Sponsor.html` - V2 sponsor portal
- `Diagnostics.html` - System diagnostics dashboard
- `PlannerCards.html` - Event planning UI
- `Signup.html` - Registration flow
- `ConfigHtml.html` - Configuration management UI
- `Test.html` - Triangle framework testing dashboard
- `ApiDocs.html` - Interactive API documentation

### Utility Files
- `AccessibilityUtils.html` - Accessibility helpers
- `DemoMode.html` - Demo/screenshot mode support
- `EmptyStates.html` - Empty state UI patterns
- `ImageOptimization.html` - Image optimization utilities
- `PersonalizedCTA.html` - Personalized call-to-action
- `Tooltips.html` - Tooltip components
- `DiagnosticsDashboard.html` - Alternative diagnostics view

### Components (components/)
- `CardComponent.html` - Reusable card UI
- `DashboardCard.html` - Dashboard card variant
- `QRRegenerator.html` - QR code regeneration
- `StateManager.html` - Client-side state management

### Tools (tools/)
- `APIClient.html` - API testing client

## Re-enabling V2 Features

To re-enable these features in a future version:

1. Move the required files back to `src/mvp/` (or update `.clasp.json` rootDir)
2. Update `pageFile_()` in `Code.gs` to route to the pages
3. Update `doGet()` routing to accept the page parameters
4. Restore the endpoint handlers in `handleRestApiPost_()`
5. Enable the feature flags in `Config.gs`

## MVP Surfaces (Deployed)

The MVP includes these 5 surfaces only:
- `Admin.html` - Event management dashboard
- `Public.html` - Public event listing
- `Display.html` - TV/kiosk display
- `Poster.html` - QR poster generator
- `SharedReport.html` - Analytics reports

See `/docs/MVP_SURFACES.md` for details.
