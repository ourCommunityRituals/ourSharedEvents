# MVP Feature Matrix - Triangle Live Demo

> **Reality check**: Lean, believable test footprint - not fantasy numbers.

---

## Feature Coverage Matrix

| Feature | Admin | Poster | Display | Public | Tests (MVP) |
|---------|:-----:|:------:|:-------:|:------:|-------------|
| Event Creation | ✅ | – | – | – | 1 Jest + 1 E2E |
| Event Editing | ✅ | ✅ | ✅ | ✅ | 1 cross-page E2E |
| Sponsor Management | ✅ | – | – | – | 1 E2E |
| Sponsor Display | – | ✅ | ✅ | ✅ | 1 E2E (propagation) |
| Data Propagation | ✅ | ✅ | ✅ | ✅ | covered by above |
| TV Layout | – | – | ✅ | – | 1 E2E (viewport) |
| Mobile Responsive | ✅ | ✅ | ✅ | ✅ | 2-3 viewports |
| Video Streaming | ✅ | ✅ | ✅ | ✅ | 1 E2E (happy path) |
| Google Maps | ✅ | – | – | ✅ | 1 E2E (map present) |
| Admin Notes | ✅ | – | ✅ | – | 1 E2E (note surfaced) |
| Print Layout | – | ✅ | – | – | manual + 1 visual |
| Dynamic URLs | – | – | ✅ | ✅ | 1 E2E (shortlink) |
| Slide-Up Behavior | – | – | ✅ | ✅ | 1 E2E (no sponsor) |
| SharedReport View | ✅ | – | – | – | 1 Jest + 1 E2E |

---

## Test Count Summary

| Type | Count | Purpose |
|------|-------|---------|
| Jest (unit) | ~3 | Event creation, SharedReporting, validation |
| E2E (Playwright) | ~12-15 | Feature coverage across surfaces |
| **Total** | **~15-18** | Proves pipeline works |

---

## Test Mapping to Files

### Jest Tests

| Feature | Test File | What it proves |
|---------|-----------|----------------|
| Event Creation | `tests/unit/backend.test.js` | Ok/Err envelope, EventService |
| SharedReport | `tests/unit/shared-reporting.test.js` | Analytics calculations |
| Validation | `tests/unit/validation.test.js` | Input validation |

### E2E Tests

| Feature | Test File | What it proves |
|---------|-----------|----------------|
| Event Creation | `tests/e2e/3-flows/admin-flows.spec.js` | Create → visible on public |
| Event Editing | `tests/e2e/3-flows/admin-flows.spec.js` | Edit → 4 surfaces updated |
| Sponsor Management | `tests/e2e/3-flows/sponsor-management-flows.spec.js` | CRUD works |
| Sponsor Display | `tests/e2e/3-flows/sponsor-flows.spec.js` | Propagates to Poster/Display/Public |
| TV Layout | `tests/e2e/scenarios/scenario-3-tv-display.spec.js` | 1920x1080 renders |
| Mobile Responsive | `tests/e2e/scenarios/scenario-2-mobile-user.spec.js` | 375x667 works |
| Video/Maps | `tests/e2e/3-flows/poster-maps-integration.spec.js` | Embeds don't crash |
| Slide-Up | `tests/e2e/scenarios/scenario-3-tv-display.spec.js` | Behavior works |
| SharedReport | `tests/e2e/3-flows/shared-reporting.spec.js` | Loads with real data |

---

## What Each E2E Test Proves

### 1. Event Creation (admin-flows.spec.js)
```
Admin → Create event → Verify card appears → Navigate to public → Event visible
```

### 2. Event Editing / Data Propagation (admin-flows.spec.js)
```
Admin → Edit event (time/title) → Verify:
  - Admin card updated
  - Poster updated
  - Display updated
  - Public updated
```

### 3. Sponsor Management (sponsor-management-flows.spec.js)
```
Admin → Add sponsor → Configure placements → Save
```

### 4. Sponsor Display Propagation (sponsor-flows.spec.js)
```
Sponsor added → Appears on:
  - Poster sponsor strip
  - Display side/strip
  - Public sponsors section
```

### 5. TV Layout (scenario-3-tv-display.spec.js)
```
Display @ 1920x1080:
  - Stage renders
  - Sponsor carousel rotates
  - Slide-up behavior works
```

### 6. Mobile Responsive (scenario-2-mobile-user.spec.js)
```
Public + Admin @ 375x667:
  - Same flows work
  - Touch targets adequate
```

### 7. Video/Maps (poster-maps-integration.spec.js)
```
Admin → Configure video/map → Public/Display → Embeds visible, no crash
```

### 8. SharedReport (shared-reporting.spec.js)
```
SharedReport loads → Shows non-empty data → Impressions/clicks/CTR visible
```

---

## Manual Tests (Focus Group)

| Feature | What to verify |
|---------|----------------|
| Print Layout | Poster.html prints cleanly (Ctrl+P) |
| Video Playback | YouTube/Vimeo embed plays |
| QR Codes | Scan with phone, opens correct URL |
| Map Interaction | Google Maps loads, can zoom/pan |

---

## Definition of Done

- [ ] All Jest tests pass (`npm run test:unit`)
- [ ] All E2E tests pass (`npm run test:fe`)
- [ ] Each feature row has at least 1 passing test
- [ ] Focus group can complete golden path without crashes
- [ ] No test assumes features beyond MVP scope

---

## What's NOT in MVP Tests

| Feature | Why deferred |
|---------|--------------|
| Portfolio analytics | v2+ |
| Multi-brand hierarchy | v2+ |
| Advanced exports | v2+ |
| i18n | v2+ |
| Accessibility audit | nice-to-have |
| Load testing | separate workflow |

---

*Last updated: 2025-11-22*
