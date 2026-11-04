# Pricing Tiers & Feature Flags

> 3-tier system: Free, Mid, Enterprise. Feature flags control what each tier can access.

---

## Tier Comparison

### Free Tier — Community Starter

> Registration + check-in forms. Basic public page. Admin read-only.

| Category      | Feature                           | Status |
| ------------- | --------------------------------- | ------ |
| **Forms**     | Registration                      | ON     |
|               | Check-in counter                  | ON     |
|               | Survey                            | OFF    |
|               | Email signup                      | OFF    |
| **Config**    | Self-serve event settings         | OFF    |
|               | Event settings management         | OFF    |
| **Analytics** | Paid shared report (map and more) | OFF ¹  |
|               | Export JSON                       | ON     |
|               | Advanced metrics                  | OFF    |
|               | Export PDF                        | OFF    |
|               | Custom date window                | OFF    |
|               | Portfolio view                    | OFF    |
| **Assets**    | File upload (logos, posters)      | OFF    |
|               | Custom QR design                  | OFF    |
| **Branding**  | White-label                       | OFF    |
|               | Custom domain                     | OFF    |
|               | Custom color palette              | OFF    |

**Use case:** Community organizer running a one-off event. Needs registration and door count. Nothing else.

¹ Free still gets a SharedReport, at the Local depth: distinct scanners, the sponsors' own display counts and the class breakdown (OSE-682, PO 2026-08-10: "everyone gets SharedReport"). `analytics.shared-report` turns on the paid report; with it off, every signed-link viewer reads at Local, the organizer too. See [REPORT-DEPTH.md](REPORT-DEPTH.md), "The plan caps depth". The admin reads follow the same plan for a brand admin (totals on Free; per-poster, per-day and map data on Mid), while a platform admin sees everything: "Who × plan on every read" in the same doc.

---

### Mid Tier — Growing Organization

> All 4 form types. Self-serve config. Shared reports with advanced metrics.

| Category      | Feature                    | Status |
| ------------- | -------------------------- | ------ |
| **Forms**     | Registration               | ON     |
|               | Check-in counter           | ON     |
|               | Survey                     | **ON** |
|               | Email signup               | **ON** |
| **Config**    | Self-serve event settings  | **ON** |
|               | Event settings management  | **ON** |
| **Analytics** | Shared report (basic view) | **ON** |
|               | Export JSON                | ON     |
|               | Advanced metrics           | **ON** |
|               | Export PDF                 | **ON** |
|               | Custom date window         | **ON** |
|               | Portfolio view             | OFF    |
| **Assets**    | File upload                | OFF    |
|               | Custom QR design           | OFF    |
| **Branding**  | White-label                | OFF    |
|               | Custom domain              | OFF    |
|               | Custom color palette       | OFF    |

**Use case:** League or recurring event series. Wants post-event surveys, email list building, and analytics to share with sponsors.

---

### Enterprise Tier — Full Platform

> File upload, white-label branding, custom domain, portfolio reports, per-event overrides.

| Category      | Feature                                  | Status |
| ------------- | ---------------------------------------- | ------ |
| **Forms**     | All 4 types                              | ON     |
| **Config**    | Self-serve + event settings              | ON     |
| **Analytics** | All reports + portfolio + custom windows | **ON** |
| **Assets**    | File upload (logos, posters, custom QR)  | **ON** |
|               | Custom QR design                         | **ON** |
| **Branding**  | White-label                              | **ON** |
|               | Custom domain                            | **ON** |
|               | Custom color palette                     | **ON** |
| **Overrides** | Per-event flag control                   | **ON** |

**Use case:** Multi-brand organization running events across locations. Wants their logo, their colors, their domain, and full control over which features are enabled per event.

---

## How Feature Flags Work

### Resolution Order

When the system checks if a feature is enabled for a specific event:

```
1. Event-scoped flag (scope='event', scope_id=eventId)
   ↓ if no match
2. Global flag (scope='global')
   ↓ if no match
3. Default: ON (backwards-compatible)
```

This means:

- **Free/Mid tiers** use global flags only
- **Enterprise** can override any flag per event (e.g., enable surveys for one specific event but not others)

### All 17 Flag Keys

| Key                       | Category  | Description                                             |
| ------------------------- | --------- | ------------------------------------------------------- |
| `forms.register`          | Forms     | Registration form                                       |
| `forms.checkin`           | Forms     | Check-in counter                                        |
| `forms.survey`            | Forms     | Post-event survey                                       |
| `forms.email-signup`      | Forms     | Email list signup                                       |
| `config.self-serve`       | Config    | Client manages own settings                             |
| `config.event-settings`   | Config    | Event-level settings                                    |
| `analytics.shared-report` | Analytics | Paid shared report (off = Local depth for every viewer) |
| `report.export-json`      | Analytics | JSON data export                                        |
| `report.advanced-metrics` | Analytics | Advanced metrics                                        |
| `report.export-pdf`       | Analytics | PDF report export                                       |
| `report.custom-window`    | Analytics | Custom date range                                       |
| `report.portfolio`        | Analytics | Portfolio view (multi-event)                            |
| `assets.file-upload`      | Assets    | Upload logos, posters                                   |
| `assets.custom-qr`        | Assets    | Custom QR code design                                   |
| `branding.white-label`    | Branding  | Remove ourSharedEvents branding                         |
| `branding.custom-domain`  | Branding  | Use own domain                                          |
| `branding.color-palette`  | Branding  | Custom brand colors                                     |

---

## Admin: Managing Tiers

### Apply a Tier Preset

```
POST /api/v2/admin/flags/apply-tier
{ "tier": "mid" }
```

This sets all global flags to match the tier definition. Does NOT touch event-level overrides.

### Check Current Tier

```
GET /api/v2/admin/flags/current-tier
→ { "ok": true, "tier": "mid", "name": "Mid", "description": "..." }
```

### Toggle a Single Flag

```
PUT /api/v2/admin/flags/forms.survey
{ "enabled": true }
```

### Set Event-Level Override (Enterprise)

```
PUT /api/v2/admin/events/bocce-night/flags/forms.survey
{ "enabled": true }
```

### Remove Event Override (Revert to Global)

```
DELETE /api/v2/admin/events/bocce-night/flags/forms.survey
```

### View Resolved Flags for an Event

```
GET /api/v2/admin/flags/resolve?eventId=bocce-night
→ { "ok": true, "flags": { "forms.register": true, "forms.survey": false, ... } }
```
