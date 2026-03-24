# MVP Scope Definition - LOCKED

> **Status**: SCOPE LOCKED
> **Lock Date**: 2025-12-04
> **Version**: MVP v1.0 - Week 1 Baseline

---

## The MVP Statement

**"5 surfaces. Unlimited backend QR flows. 3 display QRs on poster. Events-only."**

This document is the **single source of truth** for MVP scope. Do not expand scope without explicit approval.

---

## MVP Surfaces (5 Total - LOCKED)

| # | Surface | File | Route | Purpose |
|---|---------|------|-------|---------|
| 1 | **Admin** | `Admin.html` | `?page=admin` | Event management control room |
| 2 | **Public** | `Public.html` | `?page=public` | Mobile-first public event page |
| 3 | **Display** | `Display.html` | `?page=display` | TV/kiosk live event display |
| 4 | **Poster** | `Poster.html` | `?page=poster` | Printable poster with QR codes |
| 5 | **SharedReport** | `SharedReport.html` | `?page=report` | Shareable analytics dashboard |

**LOCKED**: No new surfaces may be added to MVP. All other surfaces are v2+.

---

## QR Code Rules (LOCKED)

### Backend: Unlimited QR Flows
- The backend may define and generate **unlimited QR flow types**
- QR flows are defined in `Code.gs` via `generateQRDataUri_()`
- New QR types can be added to backend without poster changes
- Current MVP flows: `public`, `signup`

### Poster: Maximum 3 Display QRs
- `Poster.html` renders **exactly 3 QR display slots** (no more, no less)
- If fewer than 3 QR codes exist, empty slots show placeholder message
- If more than 3 QR codes exist, only first 3 are rendered (extras hidden)
- This is a **hard UI constraint** - do not add a 4th QR slot

```
┌─────────────────────────────────────────────────────────────┐
│                      POSTER QR GRID                          │
├───────────────────┬───────────────────┬───────────────────┤
│   QR Slot 1       │   QR Slot 2       │   QR Slot 3       │
│   (Sign Up)       │   (Event Page)    │   (Reserved)      │
└───────────────────┴───────────────────┴───────────────────┘

Backend: Can define 10+ QR flows
Poster:  Only renders 3 slots MAX
```

### QR Flow Priority (for Poster)
When backend provides >3 QR flows, poster renders in this priority:
1. **Signup QR** - Primary CTA (if `event.qr.signup` exists)
2. **Public QR** - Event page (if `event.qr.public` exists)
3. **Display QR** - TV display URL (if `event.qr.display` exists)

---

## Events-Only Scope (LOCKED)

### IN SCOPE (MVP)
- Single event CRUD (create, read, update, delete)
- Event templates (predefined configurations)
- Basic sponsor management (via Admin)
- Basic analytics (impressions, clicks, CTR)
- Shared reports (for sponsor/organizer visibility)

### OUT OF SCOPE (v2+)
- Sponsor self-service dashboards
- Advanced analytics UI (exports, filtering, custom date ranges)
- Portfolio/multi-event dashboards
- Webhook integrations
- i18n/localization
- Custom template creation UI

---

## API Contract (Core 8 Endpoints)

| Endpoint | Purpose | Surface |
|----------|---------|---------|
| `api_getEventTemplates` | List event templates | Admin |
| `api_saveEvent` | Create/update event | Admin |
| `api_get` | Get single event | All |
| `api_list` | List all events | Admin |
| `api_getPublicBundle` | Public page data | Public |
| `api_getDisplayBundle` | TV display data | Display |
| `api_getPosterBundle` | Poster print data | Poster |
| `api_getSharedAnalytics` | Analytics summary | SharedReport |

---

## File Organization

```
src/mvp/                     # DEPLOYED (MVP only)
├── Code.gs                  # Router + API endpoints
├── Config.gs                # Brands, feature flags, QR config
├── Admin.html               # Surface
├── Public.html              # Surface
├── Display.html             # Surface
├── Poster.html              # Surface (3-QR limit enforced here)
├── SharedReport.html        # Surface
└── *.html                   # Infrastructure (Styles, NUSDK, etc.)

src/v2/                      # NOT DEPLOYED (future)
archive/                     # HISTORICAL (reference only)
```

---

## Scope Change Policy

1. **NO** new surfaces without explicit approval
2. **NO** new QR slots on poster (hard limit: 3)
3. **NO** sponsor self-service dashboards
4. **NO** advanced analytics UI
5. **YES** backend can add new QR flow types
6. **YES** existing surfaces can have bug fixes

---

## Definition of Done (MVP v1.0)

- [x] 5 surfaces locked and marked with MVP headers
- [x] QR code behavior frozen (backend unlimited, poster max 3)
- [x] Events-only scope documented
- [ ] All tests pass (`npm run ci:all`)
- [ ] No scope drift in any surface file

---

## Quick Reference

```
MVP SCOPE LOCK:
  Surfaces: 5 (Admin, Public, Display, Poster, SharedReport)
  Backend QR Flows: Unlimited
  Poster QR Slots: 3 MAX
  Scope: Events-only (no sponsor dashboards, no advanced analytics)

Test Command: npm run ci:all
Guard Check: npm run check:guards
```

---

*MVP Scope Lock v1.0 - Week 1 Baseline*
