# MVP-EVENT-TOOLKIT: Navigation & Page Structure Analysis

## Executive Summary
The MVP-EVENT-TOOLKIT is a Google Apps Script-based event management system with **6 main user-facing pages** serving different audiences and stages of event lifecycle. The navigation is currently **URL-parameter based** (via `?page=` or `?p=` parameters) with no visible horizontal navigation menu.

---

## 1. PAGES CURRENTLY EXIST (6 Main Pages)

### 1.1 **Public.html** (Default / Entry Point)
- **Router Logic**: `pageParam !== 'admin|poster|test|display|report|analytics'` → defaults to 'public'
- **URL**: `?p=events&brand=root` (or just base URL)
- **Purpose**: Public-facing event listing and detail pages
- **Features**:
  - Lists all events for a brand/scope
  - Event detail view with registration links
  - Sponsor banner display
  - Check-in, Walk-in, Survey links
  - Analytics logging (impressions, clicks, dwell time)
- **Audience**: Event attendees, public users
- **Status Badge**: Shows "Today", "Upcoming", or "Past Event"

### 1.2 **Admin.html** (Admin Dashboard)
- **Router Logic**: `pageParam === 'admin'`
- **URL**: `?page=admin&brand=root`
- **Purpose**: Admin control center for event management
- **Features**:
  - **Create Event Form** - Core event details (name, date, time, location, entity)
  - **Event Dashboard** - Shows lifecycle phases with progress bars
  - **Event Lifecycle Indicator**:
    - Pre-Event Phase (Preparation)
    - Event Day (Active)
    - Post-Event Phase (Analytics)
  - **Event Details Card** - Shows created event with 4 generated links
  - **Links Generated**:
    - Public (Mobile) - `?p=events&brand=...&id=...`
    - Display (TV) - `?page=display&brand=...&id=...&tv=1`
    - Poster (Print/QR) - `?page=poster&brand=...&id=...`
    - Shared Analytics - `?page=report&brand=...&id=...`
  - **Configuration Dialogs**:
    - Sign-Up Forms (Register, Check-in, Walk-in, Survey)
    - Display & Sponsors (Mode selection, carousel URLs, sponsor management)
- **Audience**: Event organizers, admins

### 1.3 **Display.html** (TV Screen / Kiosk Display)
- **Router Logic**: `pageParam === 'display'`
- **URL**: `?page=display&brand=root&id=EVENT_ID&tv=1`
- **Purpose**: TV screen display for event promotion and sponsor rotation
- **Features**:
  - **Sponsor Top Banner** - Featured sponsors rotating
  - **Main Stage** - Carousel of URLs (YouTube, Vimeo, custom content)
  - **Sponsor Side Panel** - List of sponsors in sidebar
  - **Fallback Display** - Shows when content unavailable
  - **TV-Optimized Layout**:
    - Large fonts (clamp(20px, 2.8vw, 32px)) for 10-12 ft viewing
    - Dark theme for projection
    - Grid layout: 1fr + sidebar (320px)
  - **Analytics Logging**:
    - Impression tracking per sponsor
    - Dwell time tracking
- **Audience**: Event staff, sponsors, general public viewing TV screens

### 1.4 **Poster.html** (Print / QR Code Page)
- **Router Logic**: `pageParam === 'poster'`
- **URL**: `?page=poster&brand=root&id=EVENT_ID`
- **Purpose**: Printable poster with QR codes for event promotion
- **Features**:
  - **Sponsor Strip** - Top sponsor branding
  - **Event Details** - Large title, date, time, location
  - **Event Image** - Featured event photo
  - **QR Codes Section** - Scannable codes linking to:
    - Public event page
    - Registration form
    - Check-in form
  - **Summary Text** - Event description
  - **Print-Optimized** - Clean layout for printing
- **Audience**: Marketing teams, event promoters

### 1.5 **SharedReport.html** (Analytics Dashboard)
- **Router Logic**: `pageParam === 'report' || pageParam === 'analytics'`
- **URL**: `?page=report&brand=root&id=EVENT_ID`
- **Purpose**: Public/shared analytics and event reporting
- **Features**:
  - **Key Metrics Grid** (Mobile-first responsive):
    - Total Impressions
    - Total Clicks
    - Click-Through Rate (CTR)
    - Dwell Time
  - **Report Header** - Event title and subtitle
  - **Aggregated Analytics**:
    - Totals (impressions, clicks, dwell)
    - By Surface (display, mobile, etc.)
    - By Sponsor (with CTR calculation)
    - By Token/Shortlink
  - **Sponsor Performance** - CTR metrics per sponsor
  - **Sharable** - Can be shared publicly for sponsors
- **Audience**: Sponsors, event organizers, stakeholders

### 1.6 **Test.html** (Internal Testing / QA)
- **Router Logic**: `pageParam === 'test'`
- **URL**: `?page=test&brand=root`
- **Purpose**: Testing hub with navigation cards for all flows
- **Features**:
  - Navigation cards to test each page/flow:
    - Setup flows (Create sponsor, Create event)
    - Admin flows (Event creation, configuration)
    - Attendee flows (Registration, check-in)
    - Display flows (TV setup)
    - Analytics flows (Report generation)
  - Links to all major user journeys
  - Administrative features (Config, Diagnostics, API Docs)
- **Audience**: QA engineers, developers

---

## 2. SPECIAL PAGES (Non-paginated Routes)

### 2.1 **API Documentation Page**
- **Router Logic**: `pageParam === 'docs' || pageParam === 'api'`
- **URL**: `?page=docs` or `?page=api`
- **Purpose**: REST API documentation for custom frontends
- **Features**:
  - Complete API reference
  - Endpoint documentation
  - Links back to admin/test pages
- **Served From**: `ApiDocs.html`

### 2.2 **Status Endpoint (JSON)**
- **Router Logic**: `pageParam === 'status'`
- **URL**: `?p=status`
- **Purpose**: Health check / system status
- **Response**: JSON with build ID, database status, timestamp
- **Audience**: Monitoring, health checks

### 2.3 **Shortlink Redirect**
- **Router Logic**: `pageParam === 'r' || pageParam === 'redirect'`
- **URL**: `?p=r&t=TOKEN` or `?page=redirect&token=TOKEN`
- **Purpose**: URL shortening with analytics tracking
- **Features**:
  - Redirects to target URL
  - Logs analytics (surface, sponsor, event)
  - Tracking via token

---

## 3. URL ROUTING LOGIC (Code.gs - doGet function)

```
REQUEST: ?page=XXX or ?p=XXX
            ↓
┌─────────────────────────────────────────────────────┐
│ Router Priority (from Code.gs line 98-146)          │
└─────────────────────────────────────────────────────┘

1. Check for ?action=* (REST API) → handleRestApiGet_()
2. Check for ?page=r|redirect → handleRedirect_()
3. Check for ?page=docs|api → ApiDocs.html
4. Check for ?page=status → JSON status response
5. Check scope validation (?p=events|leagues|tournaments)
6. Check explicit pages:
   - ?page=admin     → Admin.html
   - ?page=poster    → Poster.html
   - ?page=test      → Test.html
   - ?page=display   → Display.html
   - ?page=report    → SharedReport.html
   - ?page=analytics → SharedReport.html
7. Default → Public.html (event listing/detail)

Template Variables Passed:
  - appTitle: "${brand.name} · ${scope}"
  - brandId: brand.id
  - scope: 'events'|'leagues'|'tournaments'
  - execUrl: Base script URL for self-referential links
  - ZEB: Build/contract metadata
```

---

## 4. CURRENT NAVIGATION STRUCTURE

### 4.1 **No Visible Navigation Menu**
- **Header.html** exists but is minimal (logo + title + build info)
- No horizontal nav bar across pages
- No breadcrumbs
- No persistent navigation between pages

### 4.2 **Links Between Pages**

#### Public.html → Admin
- NOT directly linked
- Admin must be accessed manually via URL

#### Admin.html → Other Pages
- Generates direct links to:
  - Public page: `${execUrl}?p=events&brand=...&id=...`
  - Display page: `${execUrl}?page=display&brand=...&id=...&tv=1`
  - Poster page: `${execUrl}?page=poster&brand=...&id=...`
  - Report page: `${execUrl}?page=report&brand=...&id=...`

#### Public.html → Public Detail
- Click event card: `href="${EXEC_URL}?p=events&brand=${BRAND}&id=${ev.id}"`
- Back link: `${EXEC_URL}?p=events&brand=${BRAND}`

#### Display.html → N/A
- Standalone page, no navigation

#### Poster.html → N/A
- Standalone page, no navigation

#### SharedReport.html → N/A
- Standalone page, no navigation

#### Test.html → All Pages
- Navigation cards link to all major flows and pages
- Acts as testing/development hub

---

## 5. ENTRY POINTS & USER JOURNEYS

### Journey 1: Admin Event Creation (Before Event)
```
Admin (Create Event Form)
    ↓
Event Created + Dashboard Shown
    ├─ Configure Display & Sponsors
    ├─ Configure Sign-Up Forms
    ├─ Copy Links:
    │  ├─ Public (Mobile) → Public.html
    │  ├─ Display (TV) → Display.html
    │  ├─ Poster (Print) → Poster.html
    │  └─ Report (Analytics) → SharedReport.html
```

### Journey 2: Attendee Registration (Before Event)
```
Public.html (List/Detail)
    ├─ "Register" button → External form (registerUrl)
    ├─ "Sign Up" button → External form (signupUrl)
    └─ "← Back to Events" → Public.html list
```

### Journey 3: Event Day (During Event)
```
Display.html (TV Screens)
    ├─ Sponsor Carousel (rotating)
    ├─ Main Content Stage (YouTube/Vimeo)
    └─ Sponsor Side Panel

Public.html (Mobile Check-in)
    ├─ "Check In" → External form (checkinUrl)
    └─ "Walk-in" → External form (walkinUrl)
```

### Journey 4: Post-Event Analytics (After Event)
```
Admin.html (Dashboard shows Post-Event Phase)
    ↓
SharedReport.html (Detailed Analytics)
    ├─ Key metrics grid
    ├─ Surface breakdowns
    ├─ Sponsor performance
    └─ Shareable with sponsors
```

---

## 6. MULTI-BRAND & SCOPE SYSTEM

### Brand Concept (Config.gs)
```
BRANDS = [
  { id: 'root', name: 'Zeventbook', scopesAllowed: ['events','sponsors'] },
  { id: 'abc', name: 'American Bocce Co.', ... },
  { id: 'cbc', name: 'Chicago Bocce Club', ... },
  { id: 'cbl', name: 'Chicago Bocce League', ... }
]
```

### Scope System
- Scopes: 'events', 'leagues', 'tournaments'
- Passed via `?p=events` or `?scope=events`
- Controls which sheet stores data
- Validated per brand's scopesAllowed

### URL Structure
```
?page=admin&brand=root&p=events
        ↑          ↑          ↑
     page type   brand      scope
```

---

## 7. COMPONENT FILES

### HTML Files:
| File | Purpose | Used In |
|------|---------|---------|
| Header.html | Logo + title bar | Admin, SharedReport |
| Styles.html | Global CSS | All pages |
| DesignAdapter.html | UI component library | Admin, Poster |
| NUSDK.html | RPC/API client SDK | Public, Admin, SharedReport |
| ApiDocs.html | REST API documentation | Special route |

### Google Apps Script Files:
| File | Purpose |
|------|---------|
| Code.gs | Main router, REST API, page routing |
| Config.gs | Brands, templates, configuration |
| SharedReporting.gs | Reporting/analytics functions |

---

## 8. CURRENT LIMITATIONS & ISSUES

1. **No Persistent Navigation Menu**
   - Users must manually type URLs or use back buttons
   - No clear "Home" or "Dashboard" entry point
   - Admin and Public pages isolated

2. **Scattered Entry Points**
   - Admin: `?page=admin`
   - Public: `?p=events`
   - Display: `?page=display`
   - No consistent URL scheme (page vs p)

3. **Limited User Guidance**
   - No breadcrumbs showing current location
   - No indication of event lifecycle stage
   - Admin dashboard shows mock metrics (not real data)

4. **Display is TV-Centric**
   - Display.html is standalone (no back button)
   - Designed for 10+ ft viewing
   - Not designed for mobile/admin access

5. **Test Page as Hub**
   - Test.html acts as unofficial navigation center
   - Not intended for production users
   - Contains both testing and admin links

---

## 9. RECOMMENDATION: TRIANGLE FRAMEWORK STRUCTURE

For the Triangle Framework reorganization, consider:

### **Before Event** (Pre-Event Phase)
- Admin Dashboard (event creation, sponsorships)
- Public Registration (signup, event listing)
- Marketing Materials (posters, digital assets)

### **During Event** (Event Day)
- Public Mobile (check-in, wayfinding)
- Display TV (sponsor rotation, content)
- Staff Dashboard (real-time analytics, adjustments)

### **After Event** (Post-Event Phase)
- Shared Analytics (sponsor ROI, metrics)
- Feedback Survey (attendee feedback)
- Reporting Tools (export, archive)

---

## File Locations

| File | Path |
|------|------|
| Main Router | `/home/user/MVP-EVENT-TOOLKIT/Code.gs` (lines 97-282) |
| Admin Page | `/home/user/MVP-EVENT-TOOLKIT/Admin.html` |
| Public Page | `/home/user/MVP-EVENT-TOOLKIT/Public.html` |
| Display Page | `/home/user/MVP-EVENT-TOOLKIT/Display.html` |
| Poster Page | `/home/user/MVP-EVENT-TOOLKIT/Poster.html` |
| Reports Page | `/home/user/MVP-EVENT-TOOLKIT/SharedReport.html` |
| Test Hub | `/home/user/MVP-EVENT-TOOLKIT/Test.html` |
| Config | `/home/user/MVP-EVENT-TOOLKIT/Config.gs` |
| Header Component | `/home/user/MVP-EVENT-TOOLKIT/Header.html` |
| Styles | `/home/user/MVP-EVENT-TOOLKIT/Styles.html` |

