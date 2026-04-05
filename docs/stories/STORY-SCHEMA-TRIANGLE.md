# Story: Schema Triangle Architecture

## Summary

Formalize the triangle data model (Events at apex, Sponsors bottom-left, Customers bottom-right, SharedReports center) with proper JSON schemas as the single source of truth, then validate the application against these contracts.

## Business Context

The product models a triangle relationship with SharedReports at the center:

- **Events** (apex) - The gatherings/occasions — the core entity, always on top
- **Sponsors** (bottom-left) - Brands supporting events
- **Customers** (bottom-right) - Attendees, represented by QR codes and shortlinks
- **SharedReports** (center) - The proof layer connecting all three vertices

QR codes and shortlinks serve as the "customer representative" in the model - they're the touchpoint where customers interact with events and sponsors.

## Current State

```
              EVENTS (apex)
             /      \
     event.schema.json (solid, frozen v1.0)
     - id, slug, name
     - links, qr, sponsors[]
          /    [Shared    \
         /     Reports]    \
SPONSORS ─────────────────── CUSTOMERS
(bottom-left)          (bottom-right)
    sponsor.schema.json         ??? Fragmented
    - id, name, logoUrl         - sponsor-report-qr.schema.json (partial)
    - placements                - QRCodes in event.schema.json
    - tracking tokens           - No shortlink schema
                                - No customer/attendee schema
```

## Gaps to Address

### 1. Missing: shortlink.schema.json

Define the shortlink contract:

- Base URL structure
- Parameters (page, eventId, sponsorId, etc.)
- Tracking metadata
- Expiration/validity

### 2. Fragmented: QR Code Schemas

Currently split across:

- `event.schema.json` → `QRCodes` def (public, signup)
- `sponsor-report-qr.schema.json` → sponsor report QR

Consolidate into `qr.schema.json`:

- QR type (public, signup, sponsor-report, etc.)
- Encoded URL reference
- Base64 image data
- Verification status
- Scan tracking fields

### 3. Missing: customer.schema.json (or attendee.schema.json)

The third vertex needs representation:

- Customer/attendee identity (anonymous vs. registered)
- Interaction history (scans, clicks, signups)
- Attribution chain (which QR → which event → which sponsor)

### 4. Refactor: shared-analytics.schema.json

Currently has bolted-on pane fields. Should properly model:

- Event metrics (referencing event.schema.json)
- Sponsor metrics (referencing sponsor.schema.json)
- Customer journey metrics (referencing customer.schema.json)
- QR/shortlink attribution (referencing qr/shortlink schemas)

## Implementation Approach

### Phase 1: Define Core Schemas

1. Create `shortlink.schema.json`
2. Create `qr.schema.json` (consolidate existing)
3. Create `customer.schema.json`

### Phase 2: Update Analytics Schema

1. Refactor `shared-analytics.schema.json` to use $ref to entity schemas
2. Model relationships explicitly (not embedded objects)

### Phase 3: Pipeline Validation

1. Update `check-schema-fields.js` to validate triangle relationships
2. Add schema cross-reference validation
3. Ensure all surfaces use schema-compliant data access

## Acceptance Criteria

- [ ] All three vertices of the triangle have dedicated entity schemas
- [ ] QR codes and shortlinks have formalized contracts
- [ ] shared-analytics.schema.json references entity schemas via $ref
- [ ] CI validates schema relationships
- [ ] No KNOWN_EXCEPTIONS needed for entity fields

## Dependencies

- Story 1 (Validate & Align GitHub Workflows) - CI pipeline must be stable

## Notes

- This emerged from Story 1 CI fixes where sponsor/event pane fields were missing from schemas
- Schema-first approach: define contracts, then validate application conformance
