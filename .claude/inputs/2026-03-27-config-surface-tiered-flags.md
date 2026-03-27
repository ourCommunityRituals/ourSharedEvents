---
name: Config Surface — Self-Serve Client Management with Tiered Feature Flags
description: Admin config page where returning clients manage their own assets, branding, and event settings. Feature flags gate free/mid/enterprise tiers. File upload, white-label branding, and self-serve config unlock at higher tiers.
type: project
---

## The vision

Returning clients want to manage their own assets — file uploads, branding, images, custom QR codes — on their own white-label. The config surface is where they self-serve. Feature flags (already built in FORMS_DB) control what each tier can access.

## Tier model

| Tier | Who | What they can do |
|------|-----|-----------------|
| **Free** | Any event coordinator | Registration + check-in forms. Basic public page. Admin dashboard read-only. |
| **Mid** | Returning clients | All 4 form types. Self-serve config page. Manage event settings. View shared reports. |
| **Enterprise** | Paying organizations | File upload (logos, posters, custom QR). White-label branding (their colors, their domain). Per-event flag overrides. Full API access. |

## Feature flag mapping (already in FORMS_DB.feature_flags)

```
Flag key                    Free    Mid     Enterprise
─────────────────────────── ─────── ─────── ──────────
forms.register              ON      ON      ON
forms.checkin               ON      ON      ON
forms.survey                OFF     ON      ON
forms.email-signup          OFF     ON      ON
config.self-serve           OFF     ON      ON
config.event-settings       OFF     ON      ON
analytics.shared-report     OFF     ON      ON
assets.file-upload          OFF     OFF     ON
assets.custom-qr            OFF     OFF     ON
branding.white-label        OFF     OFF     ON
branding.custom-domain      OFF     OFF     ON
branding.color-palette      OFF     OFF     ON
```

## Config surface (new admin page or Card expansion)

**What it is:** A dedicated page or expanded admin card where clients manage:
- Event settings (date, venue, description)
- Form toggles (which form types are active for this event)
- File uploads (logo, poster image, cover photo) — enterprise only
- Branding (primary color, logo URL, custom header text) — enterprise only
- QR code customization (colors, logo embed) — enterprise only

**Architecture:** Same separate DB principle as forms. Uploaded files go to R2 (Cloudflare object storage), NOT D1. Config metadata lives in FORMS_DB alongside feature_flags.

## Relationship to existing work

- **Feature flags** — Already built (migration 0006, feature-flags.ts, isFeatureEnabled())
- **File upload** — Previously shelved. Now makes sense as an enterprise-tier feature gated by `assets.file-upload` flag
- **White-label** — The form pages (form-pages.ts) already have a consistent color palette. Enterprise tier overrides these with client brand colors from config
- **Config page** — Admin Card 2 (forms management) is the seed. Expand it or create a dedicated `/config` route

## Scrum team breakdown

- **PO:** Define AC per tier. What's free, what's mid, what's enterprise. Pricing model alignment.
- **Lead BE Architect:** Config API endpoints (CRUD event settings, file upload to R2, branding config). Feature flag middleware for tier gating. Separate storage for uploaded assets (R2, not D1).
- **Lead FE Integration:** Config page on admin surface. File upload UI with drag-and-drop. Branding preview (live preview of white-label colors). Integration with all 5 surfaces (admin, public, poster, display, sharedReport).
- **Sr Design FE:** Intuitive config UX — client shouldn't need instructions. Preview panel showing how branding changes look on public/poster surfaces. Mobile-responsive config page.
- **Sr Automation QA:** E2E tests for each tier (free user can't access file upload, mid user can access surveys, enterprise user can upload files). Feature flag toggle tests. File upload validation (size, type, dimensions).
- **SRE SDET:** R2 upload monitoring. File size limits in CI gates. Observability on config changes (who changed what, when). Performance: config page load time.
- **DevOps:** R2 bucket provisioning per environment. File upload CI/CD pipeline. Branding asset CDN caching. Secret management for R2 credentials.

## The real-world pain this solves

Same instructor from Art Institute of Chicago: one platform, one QR system, but now she can also upload her own event poster, customize the QR code with her organization's logo, and share a branded public page with her school's colors. No more "it looks like a tech demo" — it looks like HER event.

## How to apply

1. Feature flags are in place — tier gating works today
2. Build config API endpoints (CRUD for event settings + branding)
3. Build file upload to R2 (gated by `assets.file-upload` flag)
4. Build config UI on admin surface
5. Extend form pages and public page to read branding config
6. White-label: override colors/logos from branding config
