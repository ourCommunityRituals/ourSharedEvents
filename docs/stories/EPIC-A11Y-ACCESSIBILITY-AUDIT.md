# Epic: ADA Accessibility Audit — All Frontend Surfaces

**Epic ID:** A11Y
**Status:** 🔄 IN PROGRESS
**Priority:** P1 — Pre-accreditation requirement
**Surfaces:** admin.html, public.html, display.html, poster.html, report.html, sponsor.html, landing.html
**Target:** WCAG 2.1 AA compliance (ADA alignment)

---

## Executive Summary

Comprehensive accessibility audit and remediation of all 7 frontend surfaces. This epic takes a Kaizen approach — systematically identifying gaps, implementing foundational fixes, and establishing patterns that scale across future development.

**Current State:** Partial accessibility support exists (some ARIA attributes, touch targets in design tokens, `prefers-reduced-motion` in 2 templates). However, critical gaps exist: missing `lang` attributes, no skip links, no semantic landmarks, inconsistent focus management, no shared accessibility CSS/JS layer, and missing `data-testid` attributes on 6 of 7 surfaces.

**Target State:** WCAG 2.1 AA compliant surfaces with shared accessibility foundation, consistent keyboard navigation, screen reader support, and automation-friendly test IDs across all surfaces.

---

## Audit Findings — Current Gap Analysis

### Critical (WCAG Level A — Must Fix)

| # | Issue | Surfaces Affected | WCAG Criterion |
|---|-------|-------------------|----------------|
| 1 | Missing `lang="en"` on `<html>` | public, admin, display, poster | 3.1.1 Language of Page |
| 2 | No skip-to-content links | All 7 surfaces | 2.4.1 Bypass Blocks |
| 3 | No `<main>` landmark | public, admin, display, poster | 1.3.1 Info and Relationships |
| 4 | Missing `role="navigation"` or `<nav>` | public, admin, display, poster | 1.3.1 Info and Relationships |
| 5 | Form inputs without associated labels | display, poster (dynamic rendering) | 1.3.1 / 4.1.2 |
| 6 | No `aria-live` regions for dynamic content updates | public, display, admin | 4.1.3 Status Messages |
| 7 | Color-only status indicators (badges) | admin, report, sponsor | 1.4.1 Use of Color |

### Serious (WCAG Level AA — Should Fix)

| # | Issue | Surfaces Affected | WCAG Criterion |
|---|-------|-------------------|----------------|
| 8 | No `prefers-reduced-motion` support | public, admin, display, landing | 2.3.3 Animation from Interactions |
| 9 | No `prefers-contrast: high` support | All except archived code | 1.4.6 Contrast (Enhanced) |
| 10 | Inconsistent focus-visible styles | All 7 surfaces | 2.4.7 Focus Visible |
| 11 | No heading hierarchy enforcement | public, display, poster | 1.3.1 Info and Relationships |
| 12 | Missing `aria-current="page"` on navigation | admin, landing | 2.4.8 Location |
| 13 | No keyboard trap prevention in modals | admin (dialog overlays) | 2.1.2 No Keyboard Trap |
| 14 | Tables missing `<caption>` and scope attributes | report (analytics tables) | 1.3.1 Info and Relationships |

### Moderate (Best Practice — Kaizen Improvements)

| # | Issue | Surfaces Affected | Impact |
|---|-------|-------------------|--------|
| 15 | No `data-testid` attributes | 6 of 7 surfaces | Automation fragility |
| 16 | Inconsistent alt text patterns | dynamic image rendering | Screen reader UX |
| 17 | No print stylesheet accessibility | public, poster | Print usability |
| 18 | Missing `.sr-only` utility class | All active templates | Screen reader UX |
| 19 | No color-blind-safe patterns | status badges, sponsor tiers | Inclusive design |
| 20 | Feature flag support not wired to a11y | All surfaces | Gradual rollout |

---

## Scrum Team Breakdown

### PO — Product Owner

**Acceptance Criteria:**
- [ ] All 7 surfaces pass axe-core automated scan with 0 critical/serious violations
- [ ] Keyboard-only navigation tested on all surfaces (Tab, Shift+Tab, Enter, Escape, Arrow keys)
- [ ] Screen reader tested on public.html and admin.html (VoiceOver/NVDA)
- [ ] All forms announce errors to assistive technology
- [ ] No information conveyed by color alone (pattern/icon supplement)
- [ ] Touch targets meet 44x44px minimum on mobile surfaces
- [ ] Business case: ADA compliance reduces legal risk and expands addressable market (15-20% of users have disabilities)
- [ ] Feature flags: `a11y_skip_links`, `a11y_high_contrast`, `a11y_announcements` for gradual rollout
- [ ] Privacy: No PII in ARIA labels or screen reader announcements (sponsor names OK, user emails never)

**Use Cases:**
1. **Screen reader user** browses public events → hears event name, date, venue, CTA in logical order
2. **Keyboard-only user** navigates admin dashboard → can reach all 7 cards, all forms, all actions
3. **Low-vision user** views display on TV → high contrast mode renders cleanly at distance
4. **Motor-impaired user** taps CTA on phone → 48px touch target, no precision required
5. **Cognitive disability user** reads poster → clear hierarchy, predictable layout, minimal cognitive load

---

### Lead BE Architect

**API & Worker Support:**
- [ ] Feature flag middleware: `a11yFlags` object in Worker config (skip_links, high_contrast, announcements)
- [ ] Template variable injection: `<?= a11yFlags ?>` JSON passed to all templates at render time
- [ ] Anonymous session ID: Never expose in ARIA attributes or screen reader content
- [ ] Content-Security-Policy: Allow `style-src 'unsafe-inline'` for accessibility styles (current requirement)
- [ ] `aria-label` content: Sanitize via `esc()` to prevent XSS in accessibility attributes

**API Contracts:**
- No new endpoints required — accessibility is frontend-only with feature flag config
- Existing bundle endpoints already return `esc()`-safe content
- Future: `/api/v2/a11y/preferences` endpoint for user preference persistence (Phase 3)

**Testing:**
- [ ] Unit: Feature flag serialization in staticAssets handler
- [ ] Contract: Template variables include `a11yFlags` when feature enabled
- [ ] Pact: No breaking changes to existing bundle contracts
- [ ] Integration: Verify `lang="en"` present in all served HTML responses
- [ ] Newman/Postman: Add `Content-Language` header check to existing flows

---

### Lead FE Integration

**Surface-by-Surface Implementation:**

| Surface | Priority | Key Changes |
|---------|----------|-------------|
| **public.html** | P0 | `lang`, skip link, `<main>`, `<nav>`, ARIA live for event list updates, heading hierarchy |
| **admin.html** | P0 | `lang`, skip link, `<main>`, form error announcements, modal focus trap, keyboard shortcuts help |
| **display.html** | P1 | `lang`, skip link, `<main>`, rotation mode announcements, high-contrast TV mode |
| **poster.html** | P1 | `lang`, skip link, `<main>`, print a11y, QR code alt text enhancement |
| **report.html** | P1 | Skip link, `<main>`, table `<caption>`, `scope` on `<th>`, tab panel ARIA (already partial) |
| **sponsor.html** | P2 | Skip link, `<main>`, status badge text supplement, metric card ARIA |
| **landing.html** | P2 | Skip link, `<main>`, form error live region (already partial) |

**Shared Accessibility Module (`AccessibilityCore`):**
- CSS: `.sr-only`, `.skip-link`, focus-visible styles, high contrast, reduced motion, color-blind patterns
- JS: `announceToScreenReader()`, `trapFocus()`, `initAccessibility()`
- Injected into all templates via the bundle pipeline
- Feature-flag gated: core styles always on, enhanced features behind flags

**Integration Testing:**
- [ ] axe-core integration in Playwright test suite
- [ ] Cross-surface: verify shared a11y module loads on all 7 surfaces
- [ ] Form submission: verify error announcements on admin create flow
- [ ] QR routing: verify screen reader announces destination before redirect
- [ ] Feature flag: verify flag toggles enable/disable enhanced a11y features

---

### Sr Design FE — Kaizen UX

**Design Principles:**
1. **Invisible when working** — Accessibility should enhance, not clutter the visual design
2. **Mobile-first a11y** — Touch targets, readable font sizes, thumb zones first
3. **Uniform across surfaces** — Same focus ring, same skip link, same SR patterns everywhere
4. **Innovative but accessible** — Animations respect `prefers-reduced-motion`, colors have pattern fallbacks

**Color Palette Compliance (WCAG AA 4.5:1 minimum):**

| Pair | Foreground | Background | Ratio | Pass? |
|------|-----------|------------|-------|-------|
| Body text | `#1e293b` (gray-800) | `#f8fafc` (gray-50) | 12.6:1 | AA ✅ AAA ✅ |
| Primary on white | `#2563eb` (primary) | `#ffffff` | 4.6:1 | AA ✅ (barely) |
| Success on white | `#10b981` (success) | `#ffffff` | 3.4:1 | AA ❌ — needs `#059669` |
| Danger on white | `#ef4444` (danger) | `#ffffff` | 3.9:1 | AA ❌ — needs `#dc2626` |
| Warning text | `#f59e0b` (warning) | `#ffffff` | 2.1:1 | AA ❌ — needs `#78350f` on light bg |
| Muted text | `#64748b` (gray-500) | `#f8fafc` (gray-50) | 5.0:1 | AA ✅ |

**Action Items:**
- [ ] Adjust success color to `--color-success-dark: #059669` for text on white
- [ ] Adjust danger color to `--color-danger-dark: #dc2626` for text on white
- [ ] Use `--color-warning-darker: #78350f` for warning text (already exists in tokens)
- [ ] Add text labels to all color-only badges (e.g., green dot + "Active" text)
- [ ] Ensure sponsor tier badges have text + color (not just background color)

**Test ID Convention (non-brittle selectors):**
```
data-testid="surface-component-action"
Examples:
  data-testid="public-event-card"
  data-testid="admin-form-submit"
  data-testid="display-rotation-pause"
  data-testid="poster-qr-public"
  data-testid="report-tab-sponsors"
  data-testid="sponsor-badge-status"
  data-testid="landing-subscribe-form"
```

**Focus Ring Spec:**
- Color: `var(--color-primary, #2563eb)` — 3px solid
- Offset: 2px
- Shadow: `0 0 0 4px rgba(37, 99, 235, 0.1)` for enhanced visibility
- Only visible on `:focus-visible` (not mouse clicks)

---

### Sr Automation QA

**Playwright E2E Tests (per surface):**

```
tests/e2e/accessibility/
├── axe-scan.spec.ts         # axe-core scan across all surfaces
├── keyboard-nav.spec.ts     # Tab order, focus management, shortcuts
├── screen-reader.spec.ts    # ARIA attributes, live regions, announcements
├── form-a11y.spec.ts        # Form labels, errors, required fields
├── color-contrast.spec.ts   # Dynamic contrast checking
└── responsive-a11y.spec.ts  # Touch targets, zoom, mobile a11y
```

**Test Matrix:**

| Test | public | admin | display | poster | report | sponsor | landing |
|------|--------|-------|---------|--------|--------|---------|---------|
| axe-core 0 violations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Skip link present | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `lang="en"` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `<main>` landmark | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Keyboard tab order | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| Form error announce | ✅ | ✅ | — | — | — | — | ✅ |
| Focus trap (modals) | — | ✅ | — | — | — | — | — |
| Touch targets 44px | ✅ | ✅ | — | — | — | ✅ | ✅ |
| Print a11y | ✅ | — | — | ✅ | ✅ | — | — |

**API Tests:**
- [ ] POST form submit → verify no PII in response ARIA content
- [ ] GET /health → verify `Content-Language: en` header
- [ ] GET all HTML surfaces → verify `<html lang="en">` in response body

---

### SRE / SDET

**CI/CD Gates:**
- [ ] axe-core scan gate: 0 critical/serious violations = pass, any = fail
- [ ] Lighthouse accessibility score: minimum 90 (currently unmeasured)
- [ ] HTML validation: no `<html>` without `lang` attribute
- [ ] Bundle size: accessibility module < 5KB gzipped (CSS + JS)

**Observability:**
- [ ] Log when `prefers-reduced-motion` is active (anonymized, for usage stats)
- [ ] Log when high-contrast mode is active (anonymized)
- [ ] Monitor: screen reader user-agent detection rate (informational only)
- [ ] Alert: if axe-core violations increase between deploys

**Performance:**
- [ ] Accessibility CSS/JS must not add > 10ms to First Contentful Paint
- [ ] Skip link injection: < 1ms (DOM insert, no layout thrash)
- [ ] Focus trap: < 1ms per Tab keypress

---

### DevOps

**CI/CD Pipeline Changes:**
- [ ] Add `@axe-core/playwright` to devDependencies
- [ ] New CI step: `accessibility-scan` after `e2e-tests`
- [ ] Separate reporting: accessibility results in GitHub PR comment
- [ ] Feature flag config: `A11Y_SKIP_LINKS=true`, `A11Y_HIGH_CONTRAST=true` in wrangler.toml
- [ ] Template bundle pipeline: inject AccessibilityCore into all templates

**Config:**
- [ ] No new secrets required
- [ ] No separate DB provisioning required
- [ ] Template bundle script (`scripts/bundle-worker-templates.js`) must include a11y module

---

## Story Breakdown

### A11Y-1: Shared Accessibility Foundation (This PR)
**Status:** 🔄 IN PROGRESS
**Scope:** CSS + HTML fixes across all 7 templates
**Changes:**
- Add `lang="en"` to all `<html>` elements
- Add skip-to-content link to all surfaces
- Add `<main id="main-content">` landmark to all surfaces
- Add `.sr-only` utility class
- Add `:focus-visible` styles
- Add `prefers-reduced-motion` support
- Add `prefers-contrast: high` support
- Add ARIA live region for dynamic announcements
- Add `<nav>` landmark where navigation exists

### A11Y-2: Form Accessibility (admin.html + landing.html)
**Status:** 📋 BACKLOG
**Scope:** Label associations, error announcements, required field marking

### A11Y-3: Table & Tab Panel Accessibility (report.html)
**Status:** 📋 BACKLOG
**Scope:** `<caption>`, `scope`, full ARIA tab pattern

### A11Y-4: Data-Testid Foundation (all surfaces)
**Status:** 📋 BACKLOG
**Scope:** Consistent `data-testid` attributes for automation

### A11Y-5: Color Contrast Remediation
**Status:** 📋 BACKLOG
**Scope:** Fix failing color pairs, add text supplements to color-only indicators

### A11Y-6: Keyboard Navigation & Focus Trap
**Status:** 📋 BACKLOG
**Scope:** Modal focus trap in admin, rotation keyboard controls in display

### A11Y-7: axe-core CI Integration
**Status:** 📋 BACKLOG
**Scope:** Playwright + axe-core automated scanning in CI pipeline

### A11Y-8: Screen Reader Testing & Polish
**Status:** 📋 BACKLOG
**Scope:** Manual testing with VoiceOver/NVDA, fix discovered issues

---

## Definition of Done (Epic Level)

- [ ] All 7 surfaces pass axe-core with 0 critical/serious violations
- [ ] Lighthouse accessibility score ≥ 90 on all surfaces
- [ ] Keyboard-only navigation verified on admin + public + landing
- [ ] Screen reader walkthrough documented for public + admin
- [ ] All forms have associated labels and error announcements
- [ ] No color-only information indicators
- [ ] Feature flags wired for enhanced a11y features
- [ ] CI gate blocks PRs with new accessibility violations
- [ ] `data-testid` attributes on all interactive elements
- [ ] Documentation: accessibility patterns guide for future development
