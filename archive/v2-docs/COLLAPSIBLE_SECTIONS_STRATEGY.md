# Collapsible Sections UI Strategy

## Overview

This document outlines the systematic application of collapsible sections across all front-end pages in the MVP Event Toolkit to ensure uniform UI usability and better user experience.

## Analysis Summary

### Pages Requiring Collapsible Sections ✅

| Page | Priority | Sections to Collapse | Rationale |
|------|----------|---------------------|-----------|
| **Admin.html** | ✅ DONE | Core Details, Summary, Media, Bio, Statistics, Event Lifecycle | Reduce form clutter, improve focus |
| **SharedReport.html** | 🔴 HIGH | Key Metrics, Performance by Surface, Sponsor Performance, Event Performance, Daily Trends, AI Recommendations | Complex analytics dashboard with multiple data sections |
| **ConfigHtml.html** | 🟡 MEDIUM | Build Information, Session Details, Brand Configuration, System Settings | Configuration sections that users review periodically |
| **Diagnostics.html** | 🟡 MEDIUM | Test Categories, Test Results by Type | Group test results by category for better organization |
| **ApiDocs.html** | 🟢 LOW | API Endpoint Groups, Request/Response Examples | Documentation sections for different API categories |
| **Sponsor.html** | 🟢 LOW | Sponsor Details, Placement Options | If form has multiple sections (need verification) |

### Pages NOT Requiring Collapsible Sections ❌

| Page | Reason |
|------|--------|
| **Display.html** | Full-screen TV mode, no complex UI |
| **Poster.html** | Print/QR display, intentionally static |
| **Public.html** | Card-based event listing, already organized |
| **Test.html** | Navigation dashboard, intentionally shows all options |
| **Signup.html** | Simple informational page |
| **AdminWizard.html** | Step-by-step wizard, each step should be visible |
| **PlannerCards.html** | Card-based interface, self-organizing |

### Supporting/Utility Pages (No Changes Needed)

- **Header.html** - Navigation component
- **HeaderInit.html** - Initialization script
- **Styles.html** - Global styles
- **NUSDK.html** - SDK script
- **DesignAdapter.html** - Design system
- **DemoMode.html** - Demo configuration

## Implementation Plan

### Phase 1: High Priority Pages (Week 1)

#### 1.1 SharedReport.html - Analytics Dashboard

**Sections to Make Collapsible:**

```html
<!-- Key Metrics Section -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>Key Metrics</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Metrics grid content -->
  </div>
</div>

<!-- Performance by Surface Section -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>Performance by Surface</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Performance table -->
  </div>
</div>

<!-- Sponsor Performance Section -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>Sponsor Performance</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Sponsor metrics -->
  </div>
</div>

<!-- Event Performance Section (Event Managers only) -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>Event Performance</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Event metrics -->
  </div>
</div>

<!-- Daily Trends Section -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>Daily Trends</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Chart and data -->
  </div>
</div>

<!-- AI Recommendations Section -->
<div class="subsection">
  <div class="collapsible-header" onclick="toggleSection(this)">
    <h3>AI Recommendations</h3>
    <span class="collapsible-icon">▼</span>
  </div>
  <div class="collapsible-content">
    <!-- Recommendations list -->
  </div>
</div>
```

**Default State:** All sections expanded
**Test Coverage:** 10 E2E tests, 15 unit tests

### Phase 2: Medium Priority Pages (Week 2)

#### 2.1 ConfigHtml.html - System Configuration

**Sections to Make Collapsible:**

- Build Information (Version, Build ID, Contract)
- Session Details (Brand, Scope, User)
- Brand Configuration (JSON display)
- System Settings (if applicable)

**Default State:** Build Info and Session Details expanded, others collapsed
**Test Coverage:** 6 E2E tests, 10 unit tests

#### 2.2 Diagnostics.html - System Diagnostics

**Sections to Make Collapsible:**

- Database Tests
- API Tests
- Configuration Tests
- Security Tests

**Default State:** All expanded (so failures are immediately visible)
**Test Coverage:** 6 E2E tests, 10 unit tests

### Phase 3: Low Priority Pages (Week 3)

#### 3.1 ApiDocs.html - API Documentation

**Sections to Make Collapsible:**

- Event API Endpoints
- Sponsor API Endpoints
- Analytics API Endpoints
- Authentication
- Rate Limiting

**Default State:** All collapsed except introduction
**Test Coverage:** 4 E2E tests, 8 unit tests

## Shared Component: Collapsible Section Utility

### Create Reusable Include File

**File:** `CollapsibleSections.html`

```html
<style>
  /* Collapsible Section Styles */
  .collapsible-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding: 12px 16px;
    background: #f8fafc;
    border-radius: 8px;
    margin-bottom: 16px;
    transition: background-color 0.2s;
    user-select: none;
  }

  .collapsible-header:hover {
    background: #f1f5f9;
  }

  .collapsible-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
  }

  .collapsible-icon {
    transition: transform 0.3s ease;
    color: #64748b;
    font-size: 20px;
    font-weight: bold;
  }

  .collapsible-header.collapsed .collapsible-icon {
    transform: rotate(-90deg);
  }

  .collapsible-content {
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    max-height: 5000px;
    opacity: 1;
  }

  .collapsible-content.collapsed {
    max-height: 0;
    opacity: 0;
    margin-bottom: 0;
  }

  .subsection {
    margin-bottom: 20px;
  }
</style>

<script>
  // Toggle collapsible sections
  function toggleSection(header) {
    header.classList.toggle('collapsed');
    const content = header.nextElementSibling;
    content.classList.toggle('collapsed');
  }

  // Utility: Collapse all sections
  function collapseAllSections() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
      if (!header.classList.contains('collapsed')) {
        toggleSection(header);
      }
    });
  }

  // Utility: Expand all sections
  function expandAllSections() {
    document.querySelectorAll('.collapsible-header.collapsed').forEach(header => {
      toggleSection(header);
    });
  }

  // Utility: Expand section by ID
  function expandSectionById(sectionId) {
    const header = document.getElementById(sectionId);
    if (header && header.classList.contains('collapsed')) {
      toggleSection(header);
    }
  }
</script>
```

### Usage in Pages

```html
<head>
  <?!= include('CollapsibleSections'); ?>
</head>

<body>
  <div class="subsection">
    <div class="collapsible-header" onclick="toggleSection(this)">
      <h3>Section Title</h3>
      <span class="collapsible-icon">▼</span>
    </div>
    <div class="collapsible-content">
      <!-- Content here -->
    </div>
  </div>
</body>
```

## Test Strategy

### Unit Tests (Jest)

**File:** `tests/unit/collapsible-sections.test.js` (already created)

- ✅ 28 tests for toggleSection function
- ✅ DOM manipulation
- ✅ Edge cases
- ✅ Multiple sections

### E2E Tests (Playwright)

**Create test files for each page:**

1. `tests/e2e/2-pages/shared-report-page.spec.js` - 10 tests
2. `tests/e2e/2-pages/config-page.spec.js` - 6 tests
3. `tests/e2e/2-pages/diagnostics-page.spec.js` - 6 tests
4. `tests/e2e/2-pages/api-docs-page.spec.js` - 4 tests

**Total:** 26 new E2E tests + 10 existing (Admin) = 36 E2E tests

### Contract Tests

No contract tests needed for UI-only changes.

## GitHub Actions CI/CD

### Workflow File: `.github/workflows/collapsible-sections-tests.yml`

```yaml
name: Collapsible Sections Tests

on:
  push:
    branches: [ main, develop, 'claude/**' ]
    paths:
      - '**/*.html'
      - 'tests/**/*.spec.js'
      - 'tests/**/*.test.js'
  pull_request:
    branches: [ main, develop ]

jobs:
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:unit

  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx playwright install --with-deps
      - run: npm run test:pages
        env:
          BASE_URL: ${{ secrets.BASE_URL || 'https://zeventbooks.com' }}
          ADMIN_KEY: ${{ secrets.ADMIN_KEY }}

  triangle-tests:
    name: Triangle Framework Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:triangle:before
```

## Rollout Schedule

### Week 1: Foundation & High Priority
- ✅ Day 1: Admin.html (DONE)
- Day 2: Create CollapsibleSections.html include
- Day 3-4: Implement SharedReport.html collapsible sections
- Day 5: Create E2E tests for SharedReport.html

### Week 2: Medium Priority
- Day 1-2: Implement ConfigHtml.html collapsible sections
- Day 3-4: Implement Diagnostics.html collapsible sections
- Day 5: Create E2E tests for Config and Diagnostics

### Week 3: Low Priority & Documentation
- Day 1-2: Implement ApiDocs.html collapsible sections
- Day 3: Create E2E tests for ApiDocs
- Day 4: Update all documentation
- Day 5: Final testing and deployment

## Success Metrics

### Usability Metrics
- ✅ Consistent UI pattern across all pages
- ✅ Reduced cognitive load (fewer visible elements)
- ✅ Improved focus (users can hide irrelevant sections)
- ✅ Mobile-friendly (less scrolling required)

### Technical Metrics
- ✅ 100% test coverage for toggleSection function
- ✅ All E2E tests passing in CI/CD
- ✅ No regressions in existing functionality
- ✅ Cross-browser compatibility (Chrome, Safari)

### User Experience Metrics
- ✅ Faster task completion (users can focus on relevant sections)
- ✅ Lower bounce rate (less overwhelming interface)
- ✅ Accessibility compliance (keyboard navigation, screen readers)

## Accessibility Considerations

### Keyboard Navigation
- Tab through collapsible headers
- Enter/Space to toggle sections
- Arrow keys for navigation

### Screen Reader Support
```html
<div class="collapsible-header"
     onclick="toggleSection(this)"
     role="button"
     aria-expanded="true"
     aria-controls="section-content-id"
     tabindex="0">
  <h3>Section Title</h3>
  <span class="collapsible-icon" aria-hidden="true">▼</span>
</div>
<div class="collapsible-content" id="section-content-id">
  <!-- Content -->
</div>
```

### ARIA Attributes
- `role="button"` - Indicates the header is interactive
- `aria-expanded="true|false"` - Indicates section state
- `aria-controls="id"` - Links header to content
- `tabindex="0"` - Makes header keyboard accessible
- `aria-hidden="true"` - Hides decorative chevron from screen readers

## Documentation Updates

### Files to Update
1. ✅ `TRIANGLE_UI_FLOWS.md` - Add collapsible sections to page descriptions
2. `README.md` - Add UI pattern documentation
3. `tests/COLLAPSIBLE_SECTIONS_TESTS.md` - Update with new pages
4. Create `docs/UI_PATTERNS.md` - Comprehensive UI pattern guide

## Migration Checklist

### For Each Page:
- [ ] Identify sections to make collapsible
- [ ] Add `<?!= include('CollapsibleSections'); ?>` to `<head>`
- [ ] Wrap sections with collapsible HTML structure
- [ ] Add ARIA attributes for accessibility
- [ ] Test on mobile (375px width)
- [ ] Test on desktop (1920px width)
- [ ] Create E2E tests (minimum 4 per page)
- [ ] Update documentation
- [ ] Commit with descriptive message
- [ ] Create PR with before/after screenshots

## Risk Mitigation

### Potential Issues
1. **Breaking existing tests** - Solution: Update tests before deployment
2. **Performance impact** - Solution: CSS-only animations, no JavaScript until click
3. **User confusion** - Solution: All sections start expanded by default
4. **Mobile issues** - Solution: Minimum 44px touch targets
5. **Accessibility violations** - Solution: Full ARIA attribute implementation

## Next Steps

1. Create `CollapsibleSections.html` include file
2. Start with SharedReport.html (highest value)
3. Create E2E tests as sections are implemented
4. Set up GitHub Actions workflow
5. Monitor user feedback and analytics

---

**Document Version:** 1.0
**Last Updated:** 2025-11-18
**Owner:** MVP Event Toolkit Team
**Status:** 📋 Planning → 🚧 Implementation
