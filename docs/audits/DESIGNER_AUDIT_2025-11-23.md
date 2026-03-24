# Designer Role Audit - Full System Review

**Date:** 2025-11-23
**Auditor:** Design System Specialist
**Scope:** Card rhythm, Type scale, TV mode legibility, Poster print margins

---

## Executive Summary

This audit examines the design system foundations across all MVP surfaces. While the system has a solid token foundation in `DesignTokens.html`, there are significant inconsistencies in token usage, typographic scale ratios, and specific legibility issues for TV/print contexts.

| Area | Status | Critical Issues | Priority Fixes |
|------|--------|-----------------|----------------|
| Card Rhythm | ⚠️ Fair | Duplicate rules, inconsistent margins | 5 |
| Type Scale | ⚠️ Fair | Non-standard ratios, hardcoded values | 7 |
| TV Mode Legibility | 🔴 Poor | Text too small for 10ft viewing | 4 |
| Poster Print | ⚠️ Fair | Missing bleed marks, tight margins | 3 |

**Total Issues Found:** 19
**High Priority:** 6
**Medium Priority:** 8
**Low Priority:** 5

---

## 1. Card Rhythm Audit

### Current Spacing Scale (DesignTokens.html:95-108)

```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
```

**Assessment:** The spacing scale follows an 8px base grid (space-2) with half-steps, which is industry standard.

### Card Spacing Analysis

| Component | Location | Current | Expected | Issue |
|-----------|----------|---------|----------|-------|
| `.card` padding | Styles.html:68 | `24px` | `var(--space-6)` | Hardcoded |
| `.card` margin-bottom | Styles.html:69 | `20px` | `var(--space-5)` | Hardcoded |
| `.card h3` margin-top | Styles.html:84 | `28px` | `var(--space-8)` | Off-grid (28px) |
| `.card h3` margin-bottom | Styles.html:85 | `16px` | `var(--space-4)` | Hardcoded |
| `.card h3` padding-top | Styles.html:86 | `20px` | `var(--space-5)` | Hardcoded |
| `.card-header` margin-bottom | CardComponent:66 | `20px` | `var(--space-5)` | Hardcoded |
| `.card-footer` margin-top | CardComponent:96 | `24px` | `var(--space-6)` | Hardcoded |
| `.card-footer` padding-top | CardComponent:97 | `20px` | `var(--space-5)` | Hardcoded |
| `.form-group` margin-bottom | Styles.html:112 | `20px` | `var(--space-5)` | Hardcoded |

### Critical Issue: Duplicate `.card h3` Rules

**Location:** Styles.html lines 82-94 and 96-101

```css
/* Lines 82-94 */
.card h3 {
  margin-top: 28px;
  margin-bottom: 16px;
  padding-top: 20px;
  border-top: 1px solid #f1f5f9;
}

/* Lines 96-101 (OVERRIDES the above!) */
.card h3 {
  margin-top: 20px;
  margin-bottom: 12px;
  color: #475569;
  font-size: 1.2rem;
}
```

**Impact:** The second rule completely overrides the first, making the separator styling orphaned code.

### Card Rhythm Issues Summary

| ID | Severity | Issue | File:Line |
|----|----------|-------|-----------|
| CR-001 | Medium | Duplicate `.card h3` rules causing confusion | Styles.html:82-101 |
| CR-002 | Low | 28px margin is off the 8px grid | Styles.html:84 |
| CR-003 | Low | All card spacing uses hardcoded px instead of tokens | Multiple |
| CR-004 | Low | Inconsistent card padding: 24px (base) vs 20px (event-card) | Styles.html:68,354 |
| CR-005 | Low | CardComponent.html duplicates .card styles from Styles.html | CardComponent.html:47-55 |

### Recommended Card Rhythm Fixes

```css
/* Unified card rhythm using design tokens */
.card {
  padding: var(--space-6);          /* 24px */
  margin-bottom: var(--space-5);    /* 20px */
}

.card h2 {
  margin-bottom: var(--space-4);    /* 16px */
  padding-bottom: var(--space-2);   /* 8px */
}

.card h3 {
  margin-top: var(--space-5);       /* 20px */
  margin-bottom: var(--space-3);    /* 12px */
  padding-top: var(--space-4);      /* 16px - on grid */
}

.card h4 {
  margin-top: var(--space-4);       /* 16px */
  margin-bottom: var(--space-2);    /* 8px */
}

.card-header {
  margin-bottom: var(--space-5);    /* 20px */
}

.card-footer {
  margin-top: var(--space-6);       /* 24px */
  padding-top: var(--space-5);      /* 20px */
}
```

---

## 2. Type Scale Audit

### Current Type Scale (DesignTokens.html:67-76)

```css
--font-size-xs: 0.75rem;    /* 12px */
--font-size-sm: 0.875rem;   /* 14px */
--font-size-base: 1rem;     /* 16px */
--font-size-lg: 1.125rem;   /* 18px */
--font-size-xl: 1.25rem;    /* 20px */
--font-size-2xl: 1.5rem;    /* 24px */
--font-size-3xl: 1.875rem;  /* 30px */
--font-size-4xl: 2.25rem;   /* 36px */
--font-size-5xl: 3rem;      /* 48px */
```

### Scale Ratio Analysis

| Step | Size (px) | Ratio from Previous | Standard Scale |
|------|-----------|---------------------|----------------|
| xs | 12px | - | - |
| sm | 14px | 1.167 | ❌ Not standard |
| base | 16px | 1.143 | ❌ Not standard |
| lg | 18px | 1.125 | ✅ Major Second |
| xl | 20px | 1.111 | ❌ Not standard |
| 2xl | 24px | 1.200 | ✅ Minor Third |
| 3xl | 30px | 1.250 | ✅ Major Third |
| 4xl | 36px | 1.200 | ✅ Minor Third |
| 5xl | 48px | 1.333 | ✅ Perfect Fourth |

**Assessment:** The scale uses mixed ratios (1.111, 1.125, 1.143, 1.167, 1.2, 1.25, 1.333). This creates visual inconsistency in typographic hierarchy.

### Recommended: Modular Scale (1.25 Major Third)

```css
/* Major Third Scale (1.25 ratio) */
--font-size-xs: 0.64rem;    /* 10.24px → 10px */
--font-size-sm: 0.8rem;     /* 12.8px → 13px */
--font-size-base: 1rem;     /* 16px */
--font-size-lg: 1.25rem;    /* 20px */
--font-size-xl: 1.563rem;   /* 25px */
--font-size-2xl: 1.953rem;  /* 31px */
--font-size-3xl: 2.441rem;  /* 39px */
--font-size-4xl: 3.052rem;  /* 49px */
--font-size-5xl: 3.815rem;  /* 61px */
```

### Token Usage Violations

| Component | Location | Current | Expected Token |
|-----------|----------|---------|----------------|
| `.header-title h1` | Styles.html:55 | `1.8rem` | `--font-size-4xl` |
| `.card h2` | Styles.html:77 | `1.5rem` | `--font-size-2xl` ✓ |
| `.card h3` | Styles.html:100 | `1.2rem` | `--font-size-lg` (1.125rem) |
| `.card h4` | Styles.html:107 | `1rem` | `--font-size-base` ✓ |
| `.event-card h3` | Styles.html:368 | `1.1rem` | `--font-size-lg` |
| `.event-card p` | Styles.html:380 | `14px` | `--font-size-sm` |
| Labels | Styles.html:136 | `14px` | `--font-size-sm` |
| `.build-info` | Styles.html:61 | `0.85rem` | Not a token |
| `.event-header h1` | Public.html:89 | `2.2rem` | `--font-size-4xl` |
| `.stat-label` | DashboardCard:283 | `13px` | `--font-size-sm` |
| `.metric-title` | DashboardCard:315 | `15px` | `--font-size-base` |
| `.phase-indicator` | DashboardCard:323 | `12px` | `--font-size-xs` |

### Type Scale Issues Summary

| ID | Severity | Issue | File:Line |
|----|----------|-------|-----------|
| TS-001 | Medium | Non-standard type scale ratios | DesignTokens.html:67-76 |
| TS-002 | Medium | `.header-title h1` uses 1.8rem (not a token) | Styles.html:55 |
| TS-003 | Medium | `.card h3` uses 1.2rem (between tokens) | Styles.html:100 |
| TS-004 | Low | `.event-card h3` uses 1.1rem (not a token) | Styles.html:368 |
| TS-005 | Low | `.build-info` uses 0.85rem (not a token) | Styles.html:61 |
| TS-006 | Low | `.stat-label` uses 13px (between xs and sm) | DashboardCard:283 |
| TS-007 | Low | Multiple components use hardcoded px values | Multiple |

---

## 3. TV Mode Legibility Audit

### Current TV Implementation (Display.html:31-36)

```css
body[data-tv="1"] {
  background: var(--color-tv-bg, #111);
  color: var(--color-tv-text, #eee);
  font-size: clamp(20px, 2.8vw, 32px);
  line-height: 1.5;
}
```

**Assessment:** Base font size range of 20-32px is appropriate for 10-12ft viewing distance.

### TV Mode Viewing Distance Standards

| Distance | Minimum Font Size | Recommended |
|----------|-------------------|-------------|
| 3ft (mobile) | 16px | 16-20px |
| 6ft (desktop) | 18px | 20-24px |
| 10ft (TV) | 24px | 28-36px |
| 15ft (presentation) | 36px | 40-48px |

### TV Component Font Size Analysis

| Component | Location | Current | Minimum for TV | Status |
|-----------|----------|---------|----------------|--------|
| Body text | Display.html:34 | `clamp(20px, 2.8vw, 32px)` | 24px | ⚠️ Min too small |
| Fallback h2 | Display.html:76 | `2em` (~40-64px) | 36px | ✅ OK |
| Fallback text | Display.html:79 | `1.2em` (~24-38px) | 24px | ✅ OK |
| Strip title | Display.html:135 | `0.85rem` (13.6px) | 24px | 🔴 Too small |
| Strip label | Display.html:153 | `0.75rem` (12px) | 20px | 🔴 Too small |
| Strip link | Display.html:171 | `0.9rem` (14.4px) | 24px | 🔴 Too small |
| Toast | Display.html:107 | `0.9em` (~18-28px) | 24px | ⚠️ May be small |
| `.sp-name` | Display.html:102 | `1em` (~20-32px) | 24px | ⚠️ Min too small |

### TV Mode Contrast Analysis

| Element | Foreground | Background | Contrast Ratio | WCAG |
|---------|------------|------------|----------------|------|
| Body text | `#eeeeee` | `#111111` | 15.8:1 | ✅ AAA |
| Muted text | `#aaaaaa` | `#111111` | 7.6:1 | ✅ AAA |
| Strip label | `#9ca3af` | `rgba(0,0,0,0.9)` | 6.5:1 | ✅ AA |
| Strip link | `#ffffff` | `rgba(255,255,255,0.08)` | N/A (on #111) | ✅ OK |
| Error text | `#ef4444` | `#1a1a1a` | 5.2:1 | ✅ AA |
| Warning text | `#f59e0b` | `#111111` | 8.4:1 | ✅ AAA |

**Contrast Assessment:** All contrast ratios pass WCAG AA, most pass AAA.

### TV Mode Issues Summary

| ID | Severity | Issue | File:Line |
|----|----------|-------|-----------|
| TV-001 | High | `.strip-title` at 0.85rem (13.6px) is illegible at 10ft | Display.html:135 |
| TV-002 | High | `.strip-label` at 0.75rem (12px) is illegible at 10ft | Display.html:153 |
| TV-003 | High | `.strip-link` at 0.9rem (14.4px) is too small for TV | Display.html:171 |
| TV-004 | Medium | Body clamp min (20px) should be 24px for TV | Display.html:34 |
| TV-005 | Medium | `.sp-name` at 1em may be too small at clamp minimum | Display.html:102 |
| TV-006 | Low | Toast at 0.9em may be small on lower viewport widths | Display.html:107 |

### Recommended TV Mode Fixes

```css
/* TV-optimized font sizes for 10-12ft viewing */
body[data-tv="1"] {
  font-size: clamp(24px, 2.8vw, 36px);  /* Raised minimum from 20px */
  line-height: 1.5;
}

/* League/Broadcast strip - must be legible from across the room */
.league-broadcast-strip .strip-title {
  font-size: clamp(1rem, 1.8vw, 1.5rem);  /* 16-24px, scaled with viewport */
}

.league-broadcast-strip .strip-label {
  font-size: clamp(0.875rem, 1.5vw, 1.25rem);  /* 14-20px minimum */
}

.league-broadcast-strip .strip-link {
  font-size: clamp(1rem, 2vw, 1.5rem);  /* 16-24px, readable from distance */
  padding: 8px 16px;  /* Larger touch/remote targets */
}

/* Sponsor name legibility */
.sp-name {
  font-size: clamp(1.125rem, 2vw, 1.5rem);  /* 18-24px */
}

/* Toast notifications - brief, must catch attention */
.toast {
  font-size: clamp(1rem, 1.8vw, 1.5rem);  /* 16-24px */
  padding: 16px 24px;
}
```

---

## 4. Poster Print Margins Audit

### Current Print Implementation

**Poster.html Container:**
```css
.poster-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 40px 20px;
}
```

**Print Media Query (Poster.html:209):**
```css
@media print {
  @page { margin: 0.5in; }
  .poster-container { padding: 20px; }
}
```

### Print Safety Margin Standards

| Use Case | Minimum Margin | Recommended | Bleed |
|----------|----------------|-------------|-------|
| Home printer | 0.25" (6.35mm) | 0.5" (12.7mm) | N/A |
| Office printer | 0.5" (12.7mm) | 0.75" (19mm) | N/A |
| Professional print | 0.125" (3mm) | 0.25" (6.35mm) | 0.125" (3mm) |

### Current Print Analysis

| Element | Screen | Print | Issue |
|---------|--------|-------|-------|
| Container padding | `40px 20px` | `20px` | Side margins tight (20px = 0.21") |
| @page margin | N/A | `0.5in` | ✅ Standard for home printers |
| QR grid gap | `28px` | `16px` | ✅ Reduced appropriately |
| Event title | `2.8rem` (44.8px) | Same | ⚠️ May overflow on narrow prints |
| Sponsor strip | Full width | Full width | ⚠️ No safe area inset |

### Print-Specific Issues

| ID | Severity | Issue | File:Line |
|----|----------|-------|-----------|
| PR-001 | Medium | Container side padding of 20px (0.21") is too tight for some printers | Poster.html:38,185 |
| PR-002 | Medium | No print-safe area enforcement for sponsor logos | Poster.html:187-191 |
| PR-003 | Low | Event title at 2.8rem may cause overflow on narrow prints | Poster.html:77 |
| PR-004 | Low | No bleed/trim marks for professional printing | Poster.html (missing) |
| PR-005 | Low | Mobile padding (24px 16px) too tight for print from mobile | Poster.html:214 |

### Recommended Print Fixes

```css
@media print {
  /* Ensure minimum 0.5in safe area on all sides */
  @page {
    margin: 0.5in;
    size: letter portrait;  /* Explicit paper size */
  }

  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .poster-container {
    padding: 0;  /* @page margin handles this */
    max-width: 100%;
  }

  /* Safe area for sponsor strip */
  .sponsor-strip {
    margin: 0 0.25in;  /* Inset from edge */
    box-sizing: border-box;
  }

  /* Prevent title overflow */
  .event-details h1 {
    font-size: clamp(1.5rem, 6vw, 2.5rem);
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  /* Ensure QR codes stay in safe area */
  .qr-grid {
    margin: 0 0.25in;
    page-break-inside: avoid;
  }

  /* Hide interactive elements */
  .btn-utility,
  .calendar-dropdown,
  .toast {
    display: none !important;
  }
}

/* Print preview adjustments */
@media print and (max-width: 6in) {
  .qr-grid {
    grid-template-columns: 1fr 1fr;  /* 2 columns on narrow */
  }

  .event-details h1 {
    font-size: 1.5rem;
  }
}
```

---

## 5. Cross-Cutting Design System Issues

### Token Adoption Analysis

| File | Token Usage | Hardcoded Values | Compliance |
|------|-------------|------------------|------------|
| DesignTokens.html | 100% | 0 | ✅ Reference |
| Styles.html | ~40% | ~60% | ⚠️ Needs work |
| Display.html | ~30% | ~70% | ⚠️ Needs work |
| Poster.html | ~50% | ~50% | ⚠️ Needs work |
| Public.html | ~20% | ~80% | 🔴 Poor |
| CardComponent.html | ~10% | ~90% | 🔴 Poor |
| DashboardCard.html | ~15% | ~85% | 🔴 Poor |

### Color Token Violations

| Component | Current | Expected Token |
|-----------|---------|----------------|
| `.card` border-left | `#2563eb` | `var(--color-primary)` |
| `.card h2` color | `#1e293b` | `var(--color-gray-800)` |
| `.event-card:hover` border | `#2563eb` | `var(--color-primary)` |
| Error state bg | `#fef2f2` | `var(--color-danger-pale)` (missing) |
| Warning text | `#f59e0b` | `var(--color-warning)` |

---

## 6. Priority Fix Matrix

### High Priority (Fix Immediately)

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| TV-001 | Strip title too small for TV | Legibility | Low |
| TV-002 | Strip label too small for TV | Legibility | Low |
| TV-003 | Strip link too small for TV | Legibility | Low |
| CR-001 | Duplicate .card h3 rules | Maintainability | Low |
| TS-002 | Non-token header sizes | Consistency | Medium |
| PR-001 | Print margins too tight | Print quality | Low |

### Medium Priority (Fix This Sprint)

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| TV-004 | Body clamp minimum too low | Legibility | Low |
| TV-005 | Sponsor name may be small | Legibility | Low |
| TS-001 | Non-standard type scale ratios | Consistency | High |
| TS-003 | .card h3 uses non-token size | Consistency | Low |
| PR-002 | No print-safe sponsor area | Print quality | Low |
| PR-003 | Title may overflow on print | Print quality | Low |

### Low Priority (Backlog)

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| CR-002 | 28px margin off-grid | Consistency | Low |
| CR-003 | Hardcoded spacing values | Maintainability | Medium |
| CR-004 | Inconsistent card padding | Consistency | Low |
| CR-005 | CardComponent duplicates styles | Maintainability | Medium |
| TS-004 | .event-card h3 non-token | Consistency | Low |
| TS-005 | .build-info non-token | Consistency | Low |
| TS-006 | .stat-label uses 13px | Consistency | Low |
| TS-007 | Multiple hardcoded px values | Maintainability | High |
| TV-006 | Toast may be small | UX | Low |
| PR-004 | No bleed marks for pro print | Print quality | Medium |
| PR-005 | Mobile print padding tight | Print quality | Low |

---

## 7. Recommended Implementation Order

### Phase 1: TV Mode Critical Fixes (Immediate)
1. Fix `.strip-title`, `.strip-label`, `.strip-link` font sizes
2. Raise body clamp minimum from 20px to 24px
3. Test on 55" TV at 10ft distance

### Phase 2: Card Rhythm Cleanup (This Week)
1. Remove duplicate `.card h3` rule block (lines 82-94)
2. Convert all spacing to token references
3. Standardize card padding across components

### Phase 3: Type Scale Harmonization (This Sprint)
1. Audit all non-token font sizes
2. Replace hardcoded values with closest tokens
3. Consider implementing true modular scale (optional, breaking change)

### Phase 4: Print Safety (Before Next Event)
1. Add print-specific safe margins
2. Add title overflow protection
3. Test print output on multiple printers

---

## 8. Testing Recommendations

### TV Mode Testing Protocol
1. Deploy to staging environment
2. Open Display.html on 55" TV
3. Stand 10-12 feet away
4. Verify all text is readable without squinting
5. Test with sponsor carousel rotating
6. Test error states visibility

### Print Testing Protocol
1. Print Poster.html to PDF (Chrome Print > Save as PDF)
2. Check margins visually in PDF viewer
3. Print to physical printer (letter size)
4. Verify no content clipping at edges
5. Check QR codes scan correctly
6. Test on mobile Safari "Print" option

### Cross-Browser Token Verification
1. Open all surfaces in Chrome, Safari, Firefox
2. Inspect computed styles for token values
3. Verify CSS variable fallbacks work
4. Check reduced-motion preferences

---

**Audit Complete**

Next Steps:
1. Review with development team
2. Create implementation tickets
3. Schedule TV testing session
4. Print test before next event
