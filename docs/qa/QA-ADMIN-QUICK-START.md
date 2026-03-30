# QA Checklist: Admin Quick Start Flow

**Feature:** "Launch Your Event in 10 Minutes" Quick Start Guide
**Scope:** UX/content changes inside Admin.html
**Automated Test:** `tests/e2e/scenarios/quick-start-10-min.spec.js`

---

## Overview

This checklist validates the "10 Minutes to Launch" admin workflow designed for bar owners, league managers, and event organizers who need to create and publish events without technical assistance.

**Target Time:** ~10 minutes from first visit to fully published event

---

## Pre-Test Setup

- [ ] Clear browser cache and cookies
- [ ] Access Admin page: `?page=admin&brand=root`
- [ ] Have admin key ready (or use demo mode)
- [ ] Optional: Set up screen recording for UX feedback

---

## Part 1: Quick Start Guide (Initial View)

### 1.1 Visual Appearance
- [ ] Quick Start Guide section is visible at top of page
- [ ] Header shows "Launch Your Event in 10 Minutes"
- [ ] Rocket icon (🚀) is displayed
- [ ] Subtitle: "Here's everything you'll do—no surprises, no tech headaches."

### 1.2 Steps Display (6 total)
| Step | Title | Time | Description |
|------|-------|------|-------------|
| 1 | Name your event | ~2 min | Just 3 fields: event name, date, and venue. |
| 2 | Set up sign-ups | ~2 min | Add your registration form link, or let us create one. |
| 3 | Print your poster | ~1 min | One click, print-ready PDF with QR code. |
| 4 | Display on your TV | ~1 min | Copy the link, open on your bar TV or tablet. |
| 5 | Share with your crowd | ~2 min | Copy the public link or share directly to social. |
| ~ | Add sponsors | optional | Give each sponsor their own analytics link. |

- [ ] All 6 steps are visible
- [ ] Each step has a numbered indicator (1-5, then ~)
- [ ] Each step has a time estimate badge
- [ ] Step 6 (sponsors) has dashed border (optional styling)
- [ ] Footer shows: "Ready? Let's get started below."

### 1.3 Responsive Design
- [ ] **Desktop (1280px+):** Steps display in 2-column grid
- [ ] **Tablet (768px):** Steps display in 2-column grid or single
- [ ] **Mobile (375px):** Steps stack vertically, still readable

---

## Part 2: Event Creation Form (Step 1)

### 2.1 Form Layout
- [ ] Header shows "Step 1: Create Your Event"
- [ ] Subtitle explains what you'll get (posters, forms, TV display, reports)
- [ ] Only 3 required fields visible by default:
  - [ ] "What's your event called?" (text input)
  - [ ] "When is it?" (date picker)
  - [ ] "Where?" (text input)

### 2.2 Advanced Options (Collapsed)
- [ ] "More options" section is collapsed by default
- [ ] Clicking expands to show:
  - [ ] Event Type template picker
  - [ ] Sign-up button text
  - [ ] Display settings checkboxes
- [ ] "Advanced display options" is nested and also collapsed
- [ ] "Advanced event details" is collapsed

### 2.3 Form Submission
- [ ] Fill only 3 required fields
- [ ] Click "Create Event"
- [ ] Admin key prompt appears (if not in demo mode)
- [ ] Loading indicator shows during API call
- [ ] Event creates successfully within 5 seconds

---

## Part 3: Post-Creation View

### 3.1 View Transition
- [ ] Quick Start Guide is hidden after event creation
- [ ] Create form is hidden
- [ ] Seven-Card Shell is displayed
- [ ] Page scrolls to Happy Path Checklist

### 3.2 Happy Path Checklist Appearance
- [ ] Header shows "Finish Setup (~X min left)"
- [ ] Progress indicator shows "X of 6 done"
- [ ] 6 checklist items displayed in this order:
  1. Name your event (~2 min) - ✓ Done
  2. Set up sign-ups (~2 min) - Pending
  3. Print your poster (~1 min) - ✓ Done (auto-generated)
  4. Display on TV (~1 min) - ✓ Done (auto-generated)
  5. Share with crowd (~2 min) - ✓ Done (auto-generated)
  6. Add sponsors (optional) - ~ Optional

### 3.3 Time Estimates in Checklist
- [ ] Each item shows time estimate badge
- [ ] Time badges use blue background (pending) or green (done)
- [ ] Optional item uses gray/dashed styling

### 3.4 Dynamic Progress
- [ ] Header updates as items complete
- [ ] Shows "All Set! 🎉" when 5+ items done
- [ ] Progress counter updates in real-time

---

## Part 4: Checklist Item Interactions

### 4.1 Click Navigation
For each checklist item:
- [ ] Click "Name your event" → Scrolls to Card 1 (Event Basics)
- [ ] Click "Set up sign-ups" → Scrolls to Card 3 (Sign-Up Forms)
- [ ] Click "Print your poster" → Scrolls to Card 4 (Poster)
- [ ] Click "Display on TV" → Scrolls to Card 5 (TV Display)
- [ ] Click "Share with crowd" → Scrolls to Card 6 (Public Page)
- [ ] Click "Add sponsors" → Scrolls to Card 2 (Sponsors)

### 4.2 Scroll Behavior
- [ ] Smooth scroll animation
- [ ] Target card gets brief highlight effect (blue shadow)
- [ ] Card is fully visible after scroll

---

## Part 5: Complete Workflow Timing

**Manual Timing Test:**
Record actual time for each step:

| Step | Target | Actual | Pass? |
|------|--------|--------|-------|
| Create event (3 fields) | ≤2 min | ____ | [ ] |
| Configure sign-ups | ≤2 min | ____ | [ ] |
| Copy/print poster link | ≤1 min | ____ | [ ] |
| Copy TV display link | ≤1 min | ____ | [ ] |
| Copy/share public link | ≤2 min | ____ | [ ] |
| **TOTAL** | **≤8 min** | ____ | [ ] |

---

## Part 6: Edge Cases

### 6.1 Form Validation
- [ ] Empty event name shows validation error
- [ ] Empty date shows validation error
- [ ] Empty venue shows validation error
- [ ] Past dates are allowed (or show appropriate message)

### 6.2 Repeat Visits
- [ ] If event already exists (via URL param), Quick Start Guide is hidden
- [ ] Happy Path Checklist shows for existing events
- [ ] Checklist reflects actual completion status

### 6.3 Error Handling
- [ ] Network error during creation shows user-friendly message
- [ ] Can retry after error without losing form data

---

## Part 7: Accessibility

- [ ] All interactive elements are keyboard accessible
- [ ] Tab order follows visual layout
- [ ] Focus indicators are visible
- [ ] Screen reader can navigate checklist items
- [ ] Color contrast meets WCAG AA standards

---

## Part 8: Browser Compatibility

Test on:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

---

## Test Results

**Tester:** _________________
**Date:** _________________
**Environment:** _________________
**Build/Version:** _________________

### Summary
- [ ] **PASS** - All critical items pass
- [ ] **PASS WITH NOTES** - Minor issues found (document below)
- [ ] **FAIL** - Blocking issues found (document below)

### Notes/Issues Found
```
(Document any issues here)
```

---

## Related Files

- `src/mvp/Admin.html` - Admin page with Quick Start Guide
- `tests/e2e/scenarios/quick-start-10-min.spec.js` - Playwright automated test
- `tests/e2e/scenarios/scenario-1-first-time-admin.spec.js` - Related admin workflow test

---

## Acceptance Criteria (from Task)

- [x] Documented "Create and launch an event in 10 minutes" flow in Admin
- [x] QA script runs that flow end-to-end (Playwright test + this manual checklist)
