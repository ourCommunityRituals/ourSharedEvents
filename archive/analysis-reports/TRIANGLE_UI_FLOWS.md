# Triangle UI Flow Documentation

## Overview

The **MVP Event Toolkit** is organized around the **Triangle Framework**, which structures all functionality into three temporal phases centered around event lifecycles:

1. **Before Event** (Pre-Event Preparation)
2. **During Event** (Live Execution)
3. **After Event** (Post-Event Analytics)

This document provides a comprehensive reference for all available UI flows and how to access them.

---

## Navigation Hub

**Primary Entry Point:** Test Dashboard
**URL:** `?page=test&brand=root`
**File:** `Test.html`

The Triangle Framework Dashboard (Test.html) serves as the central navigation hub, organizing all application features by lifecycle phase.

---

## Before Event (Pre-Event Preparation) 📋

**Purpose:** Setup, planning, and promotion phase
**Color Code:** Green (#10b981)
**User Roles:** Event Manager (primary), Sponsor (secondary)

### Available Pages

#### 1. 🏢 Sponsors
- **URL:** `?page=sponsor&brand=root`
- **File:** `Sponsor.html`
- **Purpose:** Manage sponsor relationships and configurations
- **Features:**
  - Add new sponsors with logos and descriptions
  - Configure sponsor placements (Poster Top, TV Top, TV Side, Mobile Banner)
  - View existing sponsors
- **Status:** Placeholder page (full functionality coming soon)
- **Badge:** Setup

#### 2. ➕ Create Event
- **URL:** `?page=admin&brand=root`
- **File:** `Admin.html`
- **Purpose:** Create new events with full details
- **Features:**
  - Event lifecycle phase indicator
  - 15+ field event creation form
  - Sponsor configuration
  - Sign-up form integration
  - Display mode configuration
  - Link generator for all surfaces
- **Status:** Fully functional
- **Badge:** Primary Action

#### 3. 📅 Events
- **URL:** `?page=admin&brand=root#events-list`
- **File:** `Admin.html`
- **Purpose:** View and manage all events
- **Features:**
  - Event dashboard with lifecycle visualization
  - Edit existing events
  - View event cards with generated links
- **Status:** Fully functional
- **Badge:** Management

#### 4. 📝 Sign-Up Forms
- **URL:** `?page=signup&brand=root`
- **File:** `Signup.html`
- **Purpose:** Create attendee registration forms
- **Features:**
  - Four form types: Registration, Check-in, Walk-in, Survey
  - Google Forms integration guide
  - Step-by-step integration instructions
  - Quick links to Admin Dashboard for form configuration
- **Status:** Fully functional (informational page)
- **Badge:** Registration

#### 5. 🖼️ Posters
- **URL:** `?page=poster&brand=root`
- **File:** `Poster.html`
- **Purpose:** Generate promotional posters with QR codes
- **Features:**
  - Sponsor strip at top
  - Event details display
  - QR codes for Public page, Registration, Check-in
  - Print-optimized CSS
  - A4/Letter size support
- **Status:** Fully functional
- **Badge:** Marketing

#### 6. 📺 Display (Preview)
- **URL:** `?page=display&brand=root`
- **File:** `Display.html`
- **Purpose:** Preview TV/display mode for venue screens
- **Features:**
  - Public mode (mirror of public page)
  - Dynamic mode (carousel with configured URLs)
  - Sponsor banner rotation
  - Dark theme optimized for projection
- **Status:** Fully functional
- **Badge:** Preview

#### 7. 🌐 Public Page (Preview)
- **URL:** `?p=events&brand=root`
- **File:** `Public.html`
- **Purpose:** Preview public event listings
- **Features:**
  - Responsive event grid (1-4 columns)
  - Event detail pages
  - Status badges (Today/Upcoming/Past)
  - Integration with sign-up forms
  - Mobile-first responsive design
- **Status:** Fully functional
- **Badge:** Preview

#### 8. 🔗 Links Generator
- **URL:** `?page=admin&brand=root#event-links`
- **File:** `Admin.html`
- **Purpose:** Generate shareable links for all pages
- **Features:**
  - Public page link
  - Display (TV mode) link
  - Poster link
  - Shared Report link
  - One-click copy to clipboard
- **Status:** Fully functional
- **Badge:** Distribution

---

## During Event (Live Event Execution) ▶️

**Purpose:** Live event execution and display
**Color Code:** Orange (#f59e0b)
**User Roles:** Event Manager, Consumer/Attendee

### Available Pages

#### 1. 🔗 Quick Links
- **URL:** `?page=admin&brand=root#event-links`
- **File:** `Admin.html`
- **Purpose:** Access all event-specific URLs quickly
- **Features:**
  - All generated event links in one place
  - Copy buttons for easy sharing
  - QR code generation
- **Status:** Fully functional
- **Badge:** Quick Access

#### 2. ⚙️ Admin Control
- **URL:** `?page=admin&brand=root`
- **File:** `Admin.html`
- **Purpose:** Make live updates and adjustments
- **Features:**
  - Real-time event editing
  - Sponsor configuration updates
  - Display mode switching
  - Form URL updates
- **Status:** Fully functional
- **Badge:** Control

#### 3. 📺 Display (TV Mode)
- **URL:** `?page=display&brand=root&tv=1`
- **File:** `Display.html`
- **Purpose:** Full-screen display for venue TVs (1080p/4K)
- **Features:**
  - Dark theme (#111 background)
  - 10-12 ft viewing distance optimization
  - Sponsor banner rotation with analytics
  - Auto-carousel for configured URLs
  - Fallback handling for blocked embeds
- **Status:** Fully functional
- **Badge:** Live Display

#### 4. 📱 Public Page (Live)
- **URL:** `?p=events&brand=root`
- **File:** `Public.html`
- **Purpose:** Mobile-first page for attendees
- **Features:**
  - Sticky action buttons (mobile optimized)
  - 44px minimum touch targets
  - Event detail views
  - Registration/Check-in/Walk-in forms
  - Analytics tracking (impressions, clicks, dwell time)
- **Status:** Fully functional
- **Badge:** Attendee View

---

## After Event (Post-Event Analytics) 📊

**Purpose:** Analytics, reporting, and planning next events
**Color Code:** Purple (#8b5cf6)
**User Roles:** Event Manager, Sponsor

### Available Pages

#### 1. 📊 Shared Analytics
- **URL:** `?page=report&brand=root` or `?page=analytics&brand=root`
- **File:** `SharedReport.html`
- **Purpose:** Event & sponsor impressions, CTR, ROI metrics
- **Features:**
  - Key Metrics Grid (Total Impressions, Clicks, Engagement Rate)
  - Performance by Surface (Display, Mobile, Poster)
  - Sponsor Performance (Impressions, CTR per sponsor)
  - Event Performance (Event Managers only)
  - Daily Trends chart
  - AI-generated recommendations
  - Export to Google Sheets
  - Mobile-responsive tables
- **Status:** Fully functional (UI complete, backend in progress)
- **Badge:** Single Source of Truth

#### 2. 🔜 Next Events
- **URL:** `?page=admin&brand=root#upcoming`
- **File:** `Admin.html`
- **Purpose:** Plan and schedule upcoming events
- **Features:**
  - Coming soon placeholder
  - Links to create new events
- **Status:** Coming Soon
- **Badge:** Coming Soon

#### 3. 🖼️ Next Posters
- **URL:** `?page=poster&brand=root#upcoming`
- **File:** `Poster.html`
- **Purpose:** Prepare posters for future events
- **Features:**
  - Coming soon placeholder
  - Links to poster generator
- **Status:** Coming Soon
- **Badge:** Coming Soon

---

## All (Always Available) ⚡

**Purpose:** System tools, documentation, and diagnostics
**Color Code:** Blue (#3b82f6)
**User Roles:** All users (Event Manager, Sponsor, Consumer)

### Available Pages

#### 1. ⚙️ Config Editor
- **URL:** `?page=config&brand=root`
- **File:** `Config.html`
- **Purpose:** Configure app settings and brand configuration
- **Features:**
  - View application build information
  - View current session details
  - View brand configuration
  - Configuration guide
  - Links to diagnostics and API docs
- **Status:** Fully functional (read-only view)
- **Badge:** System

#### 2. 🔍 Diagnostics
- **URL:** `?page=diagnostics&brand=root`
- **File:** `Diagnostics.html`
- **Purpose:** System health checks and troubleshooting
- **Features:**
  - Auto-run diagnostic tests
  - Color-coded results (green/red/yellow)
  - Database connectivity tests
  - API endpoint validation
  - Configuration checks
- **Status:** Fully functional
- **Badge:** System

#### 3. 🧪 Test Dashboard
- **URL:** `?page=test&brand=root`
- **File:** `Test.html`
- **Purpose:** Triangle Framework Dashboard (navigation hub)
- **Features:**
  - Beautiful gradient design
  - Color-coded workflow sections
  - Navigation cards with icons and descriptions
  - Badge system for page categories
  - Build information footer
- **Status:** Fully functional
- **Badge:** You Are Here

#### 4. 📖 API Documentation
- **URL:** `?page=api&brand=root` or `?page=docs&brand=root`
- **File:** `ApiDocs.html`
- **Purpose:** API reference and integration guides
- **Features:**
  - REST API endpoint documentation
  - Request/response examples
  - Authentication guide
  - Status codes reference
- **Status:** Fully functional
- **Badge:** Docs

#### 5. 📚 App Documentation
- **URL:** `https://docs.claude.com/en/docs/claude-code` (external)
- **Purpose:** User guides and tutorials
- **Features:**
  - External documentation link
  - Opens in new tab
- **Status:** External link
- **Badge:** External

#### 6. 💚 Status API
- **URL:** `?p=status&brand=root`
- **Purpose:** Build version and system status
- **Features:**
  - JSON endpoint
  - Build ID and version
  - System health status
  - Uptime information
- **Status:** Fully functional
- **Badge:** API

---

## User Role Workflows

### Event Manager (Primary Role)

**Entry Point:** `?page=test&brand=root` (Triangle Dashboard)

**Typical Workflow:**

1. **Before Event:**
   - Create event (`?page=admin`)
   - Add sponsors (`?page=sponsor`)
   - Configure sign-up forms (`?page=signup` → Admin)
   - Generate posters (`?page=poster`)
   - Share public links (`?page=admin#event-links`)

2. **During Event:**
   - Display on TV screens (`?page=display&tv=1`)
   - Monitor check-ins (`?page=admin`)
   - Make live adjustments (`?page=admin`)

3. **After Event:**
   - View analytics (`?page=report`)
   - Export reports to Google Sheets
   - Plan next events (`?page=admin`)

### Sponsor (Secondary Stakeholder)

**Entry Point:** Shared Report link from Event Manager

**Typical Workflow:**

1. **Before Event:**
   - Provide logo and information to Event Manager
   - Review placement options (poster, TV, mobile)

2. **During Event:**
   - See brand displayed on TV screens
   - Track impressions in real-time (future feature)

3. **After Event:**
   - View ROI metrics (`?page=report`)
   - Analyze impressions, CTR, engagement rate
   - Make data-driven sponsorship decisions

### Consumer/Attendee (Public Role)

**Entry Point:** `?p=events&brand=root` (Public page)

**Typical Workflow:**

1. **Before Event:**
   - Browse events (`?p=events`)
   - View event details
   - Register via Google Forms

2. **During Event:**
   - Check-in at door (scan QR code or use form)
   - Walk-in registration if not pre-registered
   - View event info on mobile

3. **After Event:**
   - Complete survey form
   - Provide feedback

---

## Technical Architecture

### Routing Configuration

**Location:** `Code.gs` lines 97-147

**Routing Logic:**
1. REST API routes (`?action=*`)
2. Shortlink redirect (`?page=r`)
3. API Documentation (`?page=docs` or `?page=api`)
4. Status endpoint (`?p=status`)
5. Scope validation
6. Named pages (admin, poster, test, display, report, analytics, diagnostics, sponsor, signup, config)
7. Default: Public.html

### Page File Mapping

**Location:** `Code.gs` function `pageFile_(page)`

```javascript
function pageFile_(page){
  if (page==='admin') return 'Admin';
  if (page==='poster') return 'Poster';
  if (page==='test') return 'Test';
  if (page==='display') return 'Display';
  if (page==='report' || page==='analytics') return 'SharedReport';
  if (page==='diagnostics') return 'Diagnostics';
  if (page==='sponsor') return 'Sponsor';
  if (page==='signup') return 'Signup';
  if (page==='config') return 'Config';
  return 'Public';
}
```

### URL Structure

**Base URL:** `https://script.google.com/macros/s/{SCRIPT_ID}/exec`

**Parameters:**
- `?page=PAGENAME` - Page identifier
- `?p=SCOPE` - Scope (events/leagues/tournaments)
- `?brand=BRANDID` - Multi-brand identifier
- `?id=EVENTID` - Event-specific content
- `?tv=1` - TV mode flag

**Example URLs:**
- Test Dashboard: `?page=test&brand=root`
- Create Event: `?page=admin&brand=root`
- Public Events: `?p=events&brand=root`
- TV Display: `?page=display&brand=root&id=EVENT123&tv=1`
- Analytics: `?page=report&brand=root&id=EVENT123`

### Template Variables

All pages receive these template variables:

```javascript
tpl.appTitle = `${brand.name} · ${scope}`;  // e.g., "Zeventbook · events"
tpl.brandId = brand.id;                     // e.g., "root"
tpl.scope = scope;                            // e.g., "events"
tpl.execUrl = ScriptApp.getService().getUrl(); // Base URL
tpl.ZEB = ZEB;                                // Build ID + version
```

---

## Design System

### Color Palette

- **Primary Blue:** #2563eb
- **Green (Before Event):** #10b981
- **Orange (During Event):** #f59e0b
- **Purple (After Event):** #8b5cf6
- **Blue (All/Always):** #3b82f6
- **Gray (Text):** #1f2937, #6b7280

### Typography

- **Font Family:** -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
- **Base Font Size:** 16px (prevents iOS zoom on focus)
- **Minimum Touch Target:** 44px (exceeds iOS 44x44px standard)

### Responsive Design

- **Mobile-First:** All pages designed for mobile, then enhanced for desktop
- **Breakpoints:**
  - Mobile: < 768px
  - Tablet: 768px - 1024px
  - Desktop: > 1024px
- **Grid System:** CSS Grid with auto-fit/auto-fill
- **Safe Area Insets:** Support for notched devices (iPhone X+)

---

## Build Information

**App Title:** Zeventbook
**Build ID:** triangle-extended-v1.3
**Contract Version:** 1.0.3
**Framework:** TRIANGLE

---

## Future Enhancements

### Planned Features

1. **Sponsor Management:**
   - Full CRUD operations for sponsors
   - Sponsor dashboard with login
   - Sponsor analytics filtering

2. **Form Builder:**
   - In-app form builder (no Google Forms dependency)
   - Custom question types
   - Conditional logic

3. **Next Events:**
   - Upcoming events calendar view
   - Event templates
   - Recurring events

4. **Enhanced Analytics:**
   - Real-time analytics dashboard
   - Export to CSV/PDF
   - Automated email reports
   - Sponsor ROI calculator

5. **Navigation:**
   - Persistent navigation menu across all pages
   - Breadcrumbs showing current location
   - Keyboard navigation support
   - ARIA labels for accessibility

---

## Support & Resources

- **Test Dashboard:** `?page=test&brand=root`
- **API Documentation:** `?page=api&brand=root`
- **Diagnostics:** `?page=diagnostics&brand=root`
- **System Status:** `?p=status&brand=root`
- **GitHub Issues:** https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/issues

---

**Last Updated:** 2025-11-12
**Documentation Version:** 1.0
**Maintained By:** MVP Event Toolkit Team
