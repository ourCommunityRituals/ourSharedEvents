# Zeventbook Design System & Responsive Flow Documentation

## Overview

This document describes the unified design system for the MVP Event Toolkit, ensuring consistent brand representation across Admin, Poster, Display, and Public pages.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Component Library](#component-library)
3. [Responsive Flow](#responsive-flow)
4. [Device Contexts](#device-contexts)
5. [Integration Guide](#integration-guide)
6. [Accessibility](#accessibility)

---

## Design Principles

### Core Values
- **Consistency**: Same visual language across all surfaces
- **Accessibility**: WCAG 2.1 AA compliant
- **Performance**: Optimized loading and rendering
- **Mobile-First**: Designed for touch interfaces first

### Visual Identity
- **Primary Color**: `#2563eb` (Blue) - Trust, professionalism
- **Accent Colors**: Success (Green), Warning (Orange), Danger (Red)
- **Typography**: System fonts for fast loading
- **Spacing**: 8px grid system

---

## Component Library

### 1. Design Tokens (`DesignTokens.html`)

**Purpose**: Centralized design variables using CSS custom properties.

**Usage**:
```html
<?!= include('DesignTokens'); ?>
<?!= include('Styles'); ?>
```

**Available Tokens**:

#### Colors
```css
--color-primary: #2563eb
--color-success: #10b981
--color-danger: #ef4444
--color-warning: #f59e0b

/* Gray scale */
--color-gray-50 through --color-gray-900

/* Sponsor tiers */
--color-sponsor-gold-bg
--color-sponsor-silver-bg
--color-sponsor-bronze-bg
```

#### Typography
```css
--font-size-xs through --font-size-5xl
--font-weight-normal, -medium, -semibold, -bold
--line-height-tight, -base, -relaxed
```

#### Spacing
```css
--space-1 (4px) through --space-20 (80px)
```

#### Other
```css
--radius-sm, -base, -md, -lg, -full
--shadow-sm through --shadow-xl
--transition-fast, -base, -slow
```

### 2. Empty States (`EmptyStates.html`)

**Purpose**: Provide clear guidance when no data exists.

**Variants**:
- `default`: Standard empty state
- `compact`: Smaller version for inline areas
- `spotlight`: Highlight new features

**Example**:
```javascript
createEmptyState({
  icon: '🎯',
  heading: 'No Sponsors Yet',
  description: 'Add your first sponsor to get started.',
  actions: [
    {
      id: 'add-sponsor',
      text: 'Add Sponsor',
      variant: 'primary',
      onClick: () => showSponsorForm()
    }
  ],
  help: '<strong>💡 Tip:</strong> Sponsors gain valuable analytics!'
});
```

### 3. Tooltips & Help (`Tooltips.html`)

**Purpose**: Inline help without cluttering the UI.

**Components**:
- **Help Icon**: Small `?` icon with tooltip
- **Inline Help**: Highlighted message boxes
- **Feature Cards**: Detailed explanations

**Example**:
```html
<label>
  Dynamic Mode
  <span class="tooltip-trigger"
        data-tooltip="Rotates slides every few seconds"
        data-tooltip-position="top">
    <span class="help-icon">?</span>
  </span>
</label>
```

### 4. Sponsor Preview (`SponsorPreview.html`)

**Purpose**: Preview event across all surfaces before publishing.

**Features**:
- Four preview modes: Poster, TV Display, Public Page, Mobile
- Side-by-side sponsor placement visualization
- Real-time updates

**Example**:
```javascript
openSponsorPreview(
  eventData,
  sponsorsArray
);
```

### 5. Personalized CTA (`PersonalizedCTA.html`)

**Purpose**: Dynamic call-to-action based on event status.

**States**:
- `upcoming`: "Sign Up Now" with countdown
- `happening-now`: "Join Now" with live indicator
- `ending-soon`: "Join Before It Ends" (urgency)
- `ended`: "Event Has Ended"
- `replay`: "Watch Replay"

**Example**:
```javascript
renderPersonalizedCTA(container, {
  name: 'Tech Conference 2025',
  startDateTime: '2025-12-01T09:00:00',
  endDateTime: '2025-12-01T17:00:00',
  hasReplay: true,
  registrationUrl: '/register'
});
```

### 6. Accessibility Utils (`AccessibilityUtils.html`)

**Purpose**: WCAG 2.1 AA compliance utilities.

**Features**:
- Screen reader announcements
- Focus trap for modals
- Keyboard navigation helpers
- Contrast checking
- Skip links

**Example**:
```javascript
// Announce to screen reader
announceToScreenReader('Event created successfully!');

// Trap focus in modal
const cleanup = trapFocus(modalElement);

// Add keyboard navigation
addKeyboardNavigation(container, '.event-card');
```

### 7. Image Optimization (`ImageOptimization.html`)

**Purpose**: Lazy loading and performance optimization.

**Features**:
- Native lazy loading with fallback
- Progressive image loading (blur-up)
- Responsive srcset generation
- Automatic error handling

**Example**:
```javascript
// Create optimized image
const img = createOptimizedImage({
  src: 'image.jpg',
  alt: 'Event banner',
  loading: 'lazy',
  aspectRatio: '16-9'
});

// Progressive image with blur-up
const progressive = createProgressiveImage({
  src: 'full-image.jpg',
  placeholderSrc: 'tiny-placeholder.jpg',
  alt: 'Event photo',
  aspectRatio: '16-9'
});
```

### 8. Shared Utilities (`SharedUtils.html`)

**Purpose**: Common utilities for alert notifications, date formatting, form validation, and XSS prevention across all pages.

**Dependencies**: NUSDK.html (for `NU.esc`)

**Usage**:
```html
<?!= include('NUSDK'); ?>
<?!= include('SharedUtils'); ?>
```

**Available Functions**:

| Function | Purpose |
|----------|---------|
| `SharedUtils.showAlert(message, type, options)` | Show dismissible notification |
| `SharedUtils.formatDate(dateInput, options)` | Format date strings |
| `SharedUtils.formatRelativeTime(dateInput)` | "2 days ago" style formatting |
| `SharedUtils.isValidEmail(email)` | Email validation |
| `SharedUtils.isValidUrl(url)` | URL validation |
| `SharedUtils.validateForm(formIdOrEl)` | Form validation with error states |
| `SharedUtils.debounce(fn, delay)` | Debounce function calls |
| `SharedUtils.throttle(fn, limit)` | Throttle function calls |
| `SharedUtils.esc(unsafe)` | XSS prevention (delegates to `NU.esc`) |

**Example**:
```javascript
// Show success alert
SharedUtils.showAlert('Sponsor created!', 'success');

// Format date
const formatted = SharedUtils.formatDate('2025-12-25'); // "Dec 25, 2025"

// Validate form
const { valid, errors } = SharedUtils.validateForm('my-form');
if (!valid) {
  errors.forEach(e => console.log(e.message));
}
```

### 9. API Client (`APIClient.html`)

**Purpose**: Standardized API client wrapping `NU.rpc` for CRUD operations.

**Dependencies**: NUSDK.html

**Usage**:
```html
<?!= include('NUSDK'); ?>
<?!= include('APIClient'); ?>
```

**Configuration**:
```javascript
// Initialize with defaults
APIClient.init({
  brandId: 'my-brand',
  adminKey: 'my-admin-key',
  onSuccess: (response) => console.log('Success:', response),
  onError: (error) => console.error('Error:', error)
});
```

**CRUD Methods**:

| Method | API Endpoint | Description |
|--------|-------------|-------------|
| `APIClient.create(scope, data, options)` | `api_create` | Create new resource |
| `APIClient.list(scope, options)` | `api_list` | List resources |
| `APIClient.get(scope, id, options)` | `api_get` | Get single resource |
| `APIClient.update(scope, id, data, options)` | `api_update` | Update resource |
| `APIClient.remove(scope, id, options)` | `api_delete` | Delete resource |

**Example**:
```javascript
// List sponsors
const sponsors = await APIClient.list('sponsors');

// Create sponsor
const newSponsor = await APIClient.create('sponsors', {
  name: 'Acme Corp',
  tier: 'gold',
  website: 'https://acme.com'
});

// Update sponsor
await APIClient.update('sponsors', 'sponsor-123', { tier: 'platinum' });

// Delete sponsor
await APIClient.remove('sponsors', 'sponsor-123');
```

### 10. Shared CSS Classes (`Styles.html`)

**Purpose**: Reusable CSS classes for consistent page layouts and components.

**Page Layout Classes**:
```css
.page-header-card  /* White card header with title/subtitle */
.page-section      /* White card section with h2 heading */
.nav-breadcrumb    /* Back navigation link container */
```

**Entity Card Grid**:
```css
.entity-grid       /* Responsive grid for cards (sponsors, events) */
.entity-card       /* Individual card with hover effects */
.entity-card-info  /* Card info text (muted) */
.entity-card-actions /* Card action buttons container */
```

**Alert Components**:
```css
.alert             /* Base alert with slide-in animation */
.alert-info        /* Blue info alert */
.alert-success     /* Green success alert */
.alert-error       /* Red error alert */
.alert-warning     /* Yellow warning alert */
.alert-dismiss     /* Dismiss button */
```

**Tier Badges**:
```css
.tier-badge        /* Base badge styling */
.tier-platinum     /* Platinum tier styling */
.tier-gold         /* Gold tier styling */
.tier-silver       /* Silver tier styling */
.tier-bronze       /* Bronze tier styling */
```

**Form Validation States**:
```css
.form-input-error   /* Red border + shadow for invalid fields */
.form-input-success /* Green border + shadow for valid fields */
.form-hint          /* Muted hint text below inputs */
.form-error-message /* Red error message text */
```

**Analytics Cards**:
```css
.analytics-grid    /* Grid for stat cards */
.analytics-card    /* Individual stat card */
.analytics-card .value /* Large stat number */
.analytics-card .label /* Stat label text */
```

**State Classes**:
```css
.empty-state       /* Centered empty state container */
.empty-state-icon  /* Large emoji/icon */
.loading-state     /* Centered loading indicator */
```

---

## Responsive Flow

### User Journey Mapping

#### 1. Organizer Journey

**Desktop (Admin Dashboard)**
```
Login → Event Dashboard → Create Event → Configure Settings
  ↓
Preview Across Surfaces → Publish → Share Link → Monitor Analytics
```

**Critical Actions**:
- Create event (main CTA, top right)
- Copy public link (one-click copy)
- Preview mode (before publishing)

**Mobile (On-the-Go Management)**
```
Login → Quick Stats → Edit Event → Share Link
```

**Optimizations**:
- Bottom-aligned action buttons (thumb-friendly)
- Swipe gestures for tabs
- Simplified analytics view

#### 2. Attendee Journey

**Mobile (Primary Device)**
```
Scan QR / Click Link → Event Details → View Sponsors → Register/RSVP
  ↓
Event Day: Join Live / Check-In
  ↓
Post-Event: Watch Replay
```

**Desktop (Public Page)**
```
Browse Events → Event Details → Expanded Info → Register
```

**Critical Actions**:
- Personalized CTA (largest button, above fold)
- Share event (secondary action)
- View schedule/agenda (quick access)

#### 3. Sponsor Journey

**Desktop (Sponsor Dashboard)**
```
Login with Token → View Analytics → Export Reports → Contact Organizer
```

**Mobile (Quick Check)**
```
Login → Key Metrics → Impression Count
```

### Breakpoint Strategy

```css
/* Mobile First */
< 640px   : Mobile (1 column)
640-768px : Tablet Portrait (2 columns)
768-1024px: Tablet Landscape (2-3 columns)
1024-1440px: Desktop (3-4 columns)
> 1440px  : Large Desktop (4+ columns)
```

### Surface-Specific Layouts

#### Poster (Print)
- **Size**: 8.5" × 11" (portrait)
- **DPI**: 300 for print quality
- **Colors**: CMYK-safe palette
- **QR Codes**: Minimum 1" × 1"
- **Sponsors**: Top banner, max 4 logos

#### Display (TV/Kiosk)
- **Aspect Ratio**: 16:9
- **Resolution**: 1920×1080 recommended
- **Text Size**: 2-3× larger than web
- **Auto-Rotate**: 5-second intervals
- **Sponsors**: Overlay or side panel

#### Public Page (Web)
- **Max Width**: 1200px
- **Hero Height**: 300-400px
- **Card Grid**: Responsive (1-4 columns)
- **Sponsors**: Bottom banner, collapsible

#### Mobile (App/Web)
- **Viewport**: 320px minimum
- **Touch Targets**: 44×44px minimum
- **Font Size**: 16px base (prevents zoom)
- **Sponsors**: Horizontal scroll or stack

---

## Device Contexts

### 1. Desktop (Organizer Admin)

**Priorities**:
1. Information density
2. Multi-tasking (multiple events)
3. Detailed analytics

**Layout**:
- Sidebar navigation (optional)
- Card-based dashboard
- Modal overlays for forms
- Tabbed interfaces

**Components**:
```html
<?!= include('DesignTokens'); ?>
<?!= include('Styles'); ?>
<?!= include('Tooltips'); ?>
<?!= include('SponsorPreview'); ?>
<?!= include('AccessibilityUtils'); ?>
```

### 2. Mobile (Attendee/Organizer)

**Priorities**:
1. Speed (quick actions)
2. Touch-friendly (large buttons)
3. Offline resilience

**Layout**:
- Bottom navigation
- Sticky CTAs
- Pull-to-refresh
- Swipeable cards

**Components**:
```html
<?!= include('DesignTokens'); ?>
<?!= include('Styles'); ?>
<?!= include('PersonalizedCTA'); ?>
<?!= include('ImageOptimization'); ?>
<?!= include('AccessibilityUtils'); ?>
```

### 3. Large Screens (Display/Kiosk)

**Priorities**:
1. Visibility from distance
2. Auto-rotation
3. No interaction required

**Layout**:
- Full-screen slides
- Large typography (3-5rem)
- High contrast
- Minimal text

**Components**:
```html
<?!= include('DesignTokens'); ?>
<?!= include('Styles'); ?>
<?!= include('ImageOptimization'); ?>
```

### 4. Print (Poster)

**Priorities**:
1. Clarity
2. QR code scannability
3. Sponsor prominence

**Layout**:
- Portrait orientation
- White background
- Large QR codes
- Minimal color

**Print Styles**:
```css
@media print {
  /* Defined in Styles.html */
  background: white;
  color: black;
  remove: buttons, animations;
}
```

---

## Integration Guide

### Step 1: Include Design System Files

In each `.html` template, add at the top:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= pageTitle ?></title>

  <!-- Design System Core -->
  <?!= include('DesignTokens'); ?>
  <?!= include('Styles'); ?>

  <!-- Components (as needed) -->
  <?!= include('EmptyStates'); ?>
  <?!= include('Tooltips'); ?>
  <?!= include('AccessibilityUtils'); ?>
  <?!= include('ImageOptimization'); ?>

  <!-- Page-specific (optional) -->
  <?!= include('SponsorPreview'); ?>
  <?!= include('PersonalizedCTA'); ?>
</head>
```

### Step 2: Use Design Tokens

Replace hardcoded values with tokens:

**Before**:
```css
.my-button {
  background: #2563eb;
  padding: 14px 28px;
  border-radius: 8px;
}
```

**After**:
```css
.my-button {
  background: var(--color-primary);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-base);
}
```

### Step 3: Add Accessibility

#### Announce Updates
```javascript
announceToScreenReader('Event saved successfully!');
```

#### Add Help Icons
```html
<label>
  Event Name
  <span class="tooltip-trigger" data-tooltip="Visible to all attendees">
    <span class="help-icon">?</span>
  </span>
</label>
```

#### Keyboard Navigation
```javascript
addKeyboardNavigation(
  document.getElementById('event-list'),
  '.event-card'
);
```

### Step 4: Optimize Images

```html
<img
  src="event-banner.jpg"
  alt="Tech Conference 2025"
  loading="lazy"
  decoding="async"
  class="responsive-img"
>
```

Or use the helper:
```javascript
const img = createOptimizedImage({
  src: 'banner.jpg',
  alt: 'Event banner',
  loading: 'lazy',
  aspectRatio: '16-9'
});
container.appendChild(img);
```

### Step 5: Implement Empty States

```javascript
if (events.length === 0) {
  const emptyState = createEmptyState({
    icon: '📅',
    heading: 'No Events Yet',
    description: 'Create your first event to get started.',
    actions: [{
      id: 'create',
      text: 'Create Event',
      variant: 'primary',
      onClick: () => showCreateForm()
    }]
  });
  container.appendChild(emptyState);
}
```

---

## Accessibility

### WCAG 2.1 AA Compliance

#### Color Contrast
- **Normal Text**: Minimum 4.5:1 ratio
- **Large Text** (18px+): Minimum 3:1 ratio
- **UI Components**: Minimum 3:1 ratio

All design tokens meet these requirements.

#### Keyboard Navigation
- All interactive elements: `Tab` accessible
- Focus indicators: 3px solid outline
- Skip links: Navigate to main content
- Modal focus trap: Implemented

#### Screen Reader Support
- Semantic HTML: `<main>`, `<nav>`, `<article>`
- ARIA labels: All buttons and links
- ARIA live regions: Status updates
- Alt text: All meaningful images

#### Touch Targets
- Minimum: 44×44px (WCAG AAA)
- Comfortable: 48×48px
- Spacing: 8px between targets

#### Motion & Animation
- Respects `prefers-reduced-motion`
- All animations can be disabled
- No auto-playing video without controls

### Testing Checklist

- [ ] Keyboard-only navigation works
- [ ] Screen reader announces all actions
- [ ] Color contrast passes WCAG AA
- [ ] Touch targets ≥44px
- [ ] Forms have proper labels
- [ ] Modals trap focus
- [ ] Skip links present
- [ ] Images have alt text
- [ ] Reduced motion respected

---

## Performance

### Optimization Strategies

#### Images
- Lazy loading: `loading="lazy"`
- Responsive: `srcset` and `sizes`
- Progressive: Blur-up placeholders
- Format: WebP with fallbacks

#### JavaScript
- Defer non-critical scripts
- Intersection Observer for lazy features
- Debounce scroll/resize handlers

#### CSS
- CSS variables for tokens
- Minimal animations
- Print-specific styles

#### Metrics
- LCP (Largest Contentful Paint): <2.5s
- FID (First Input Delay): <100ms
- CLS (Cumulative Layout Shift): <0.1

---

## Changelog

### Version 1.0.0 (2025-11-18)
- ✅ Created unified design tokens system
- ✅ Implemented enhanced empty states
- ✅ Added tooltip and help system
- ✅ Built sponsor preview mode
- ✅ Created personalized CTA component
- ✅ Accessibility utilities and compliance
- ✅ Image optimization and lazy loading
- ✅ Responsive flow documentation

---

## Future Enhancements

### Planned Features
1. **Dark Mode**: Toggle between light/dark themes
2. **Custom Branding**: Per-brand color schemes
3. **Animation Library**: Reusable micro-interactions
4. **Component Storybook**: Visual component catalog
5. **i18n Support**: Multi-language localization

### Under Consideration
- WebP/AVIF image format support
- Service Worker for offline functionality
- Progressive Web App (PWA) capabilities
- Real-time collaboration features

---

## Support & Contribution

For questions or contributions related to the design system:

1. Review this documentation
2. Check component examples in each `.html` file
3. Test changes across all surfaces (Poster, Display, Public, Admin)
4. Ensure accessibility compliance
5. Update this documentation with changes

**Maintained by**: Zeventbook Team
**Last Updated**: 2025-11-18
