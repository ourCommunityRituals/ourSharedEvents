# MVP-EVENT-TOOLKIT: Navigation Structure - Executive Summary

## High-Level Overview

The MVP-EVENT-TOOLKIT is a **multi-page event management system** built on Google Apps Script with 6 main user-facing pages. Navigation is currently **URL-parameter based** (`?page=admin`, `?p=events`, etc.) with **no visible horizontal navigation menu**.

---

## Current Pages (6 Total)

| # | Page | Role | Purpose | Current Entry Point |
|---|------|------|---------|---------------------|
| 1 | **Public.html** | Attendees | Event listing & details | Default (base URL) |
| 2 | **Admin.html** | Organizers | Event creation & configuration | `?page=admin&brand=root` |
| 3 | **Display.html** | Staff/TV | TV screen display with sponsors | `?page=display&brand=root&id=...&tv=1` |
| 4 | **Poster.html** | Marketing | Printable poster with QR codes | `?page=poster&brand=root&id=...` |
| 5 | **SharedReport.html** | Sponsors | Analytics & performance metrics | `?page=report&brand=root&id=...` |
| 6 | **Test.html** | Developers | Testing hub (navigation center) | `?page=test&brand=root` |

---

## Key Navigation Facts

**No Persistent Menu**
- Header.html exists but contains only logo + title
- Users must manually navigate via URLs or back buttons
- Test.html acts as unofficial navigation hub (not production-ready)

**Inconsistent URL Scheme**
- `?page=admin` (page parameter)
- `?p=events` (scope parameter)
- `?action=create` (REST API parameter)
- Mixing conventions makes navigation confusing

**Routing Priority (Code.gs, lines 97-146)**
1. REST API endpoints (`?action=*`)
2. Shortlink redirect (`?p=r&t=TOKEN`)
3. API Docs (`?page=docs`)
4. Status endpoint (`?p=status`)
5. Scope validation
6. Named routes (`?page=admin|poster|test|display|report|analytics`)
7. Default to Public.html

---

## Triangle Framework Alignment

**PERFECT FIT** - Admin page already shows Before/During/After phases:

- **Before Event**: Create event, configure sponsors, upload media
- **During Event**: Display TV screens, check-in attendees, track analytics
- **After Event**: View reports, sponsor analytics, archive event

---

## Current User Journeys

### Admin Event Creation (Before Event)
```
?page=admin  Create Event  Share 4 Links
              ├─ Public (mobile)
              ├─ Display (TV)
              ├─ Poster (print)
              └─ Report (analytics)
```

### Attendee Registration (Before Event)
```
?p=events  List & Detail  External Sign-up Form
```

### Event Day Operations (During Event)
```
?page=display  TV Carousel Display + Sponsor Side Panel
?p=events      Mobile Check-in & Walk-in
```

### Post-Event Analytics (After Event)
```
?page=report  Shareable Metrics Dashboard
```

---

## Navigation Files & Locations

### Core Routing
- **Main Router**: `/home/user/MVP-EVENT-TOOLKIT/Code.gs` (lines 97-146)
- **Page Mapping**: `/home/user/MVP-EVENT-TOOLKIT/Code.gs` (lines 275-282)
- **Configuration**: `/home/user/MVP-EVENT-TOOLKIT/Config.gs` (brands, templates)

### HTML Pages
- **Public Page**: `/home/user/MVP-EVENT-TOOLKIT/Public.html` (event listing/detail)
- **Admin Page**: `/home/user/MVP-EVENT-TOOLKIT/Admin.html` (creation/config)
- **Display Page**: `/home/user/MVP-EVENT-TOOLKIT/Display.html` (TV screen)
- **Poster Page**: `/home/user/MVP-EVENT-TOOLKIT/Poster.html` (print/QR codes)
- **Report Page**: `/home/user/MVP-EVENT-TOOLKIT/SharedReport.html` (analytics)
- **Test Page**: `/home/user/MVP-EVENT-TOOLKIT/Test.html` (testing hub)

### Components
- **Header**: `/home/user/MVP-EVENT-TOOLKIT/Header.html` (logo + title)
- **Styles**: `/home/user/MVP-EVENT-TOOLKIT/Styles.html` (global CSS)
- **SDK**: `/home/user/MVP-EVENT-TOOLKIT/NUSDK.html` (RPC client)
- **Design Adapter**: `/home/user/MVP-EVENT-TOOLKIT/DesignAdapter.html` (UI components)

---

## Template Variables Passed to All Pages

```
appTitle: "Zeventbook · events"  (brand.name + scope)
brandId: "root"                 (current brand)
scope: "events"                  (events|leagues|tournaments)
execUrl: "https://script.google.com/macros/..."  (base URL for self-referential links)
ZEB: { BUILD_ID, CONTRACT_VER }  (metadata)
```

---

## Multi-brand & Scope System

**Brands** (Config.gs):
- root, abc (American Bocce Co.), cbc (Chicago Bocce Club), cbl (Chicago Bocce League)
- Detection: hostname first, then `?brand=` parameter, default to root

**Scopes** (Data segregation):
- events, leagues, tournaments
- Each scope = separate Google Sheet
- Controlled via `?p=` or `?scope=` parameter

---

## Problem Areas & Recommendations

| Problem | Impact | Solution |
|---------|--------|----------|
| **No visible nav menu** | Users get lost | Add persistent Navigation component |
| **URL scheme inconsistent** | Confusing (?page= vs ?p=) | Standardize to ?page= only |
| **No breadcrumbs** | Can't see current location | Add breadcrumb trail |
| **No unified entry point** | Multiple confusing URLs | Create Dashboard landing page |
| **Test page as nav hub** | Not production-ready | Create proper navigation system |
| **Pages are isolated** | Hard to flow between sections | Add inter-page links |
| **No role indicators** | Don't know whose page | Add role badges (admin/attendee/sponsor) |

---

## Detailed Documentation Available

Three comprehensive guides have been created:

1. **NAVIGATION_ANALYSIS.md** - Deep dive into all 9 routes, features, user journeys
2. **NAVIGATION_DIAGRAM.txt** - Visual ASCII diagrams of flows and hierarchy
3. **NAVIGATION_QUICK_REFERENCE.md** - Routing table, URL parameters, code snippets

All files are saved in `/home/user/MVP-EVENT-TOOLKIT/`

---

## Next Steps for Triangle Framework

To reorganize with the Triangle Framework:

1. **Create unified Dashboard** - Single entry point with role selection
2. **Add persistent Navigation** - Menu showing current phase (Before/During/After)
3. **Implement breadcrumbs** - Show location: Dashboard > Events > Event Detail
4. **Standardize URLs** - Use `?page=` consistently across all routes
5. **Role-based entry points** - Direct links for admin, attendee, sponsor
6. **Add phase indicators** - Show event lifecycle stage on every page
7. **Separate test routes** - Keep Test.html but mark as development-only

---

## Quick Links to Key Code

| Task | Location |
|------|----------|
| Understand routing | Code.gs:97-146 (doGet function) |
| See page mapping | Code.gs:275-282 (pageFile_ function) |
| Find Admin features | Admin.html:16-79, 269-312 |
| Understand Public flow | Public.html:265-448 |
| Check config | Config.gs:1-110 |
| Review templates | Config.gs:50-101 |

