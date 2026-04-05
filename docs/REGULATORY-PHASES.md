# Regulatory Phases — ourSharedEvents (OSE)

> **Purpose**: Define the 5-phase regulatory progression that governs which event types OSE can support at each stage of product maturity. This is a second axis alongside the payment tier model — two independent dimensions that together determine what an organizer can do on the platform.

---

## Two-Axis Model

OSE operates on two independent axes:

```
                     REGULATORY AXIS
                Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
               (No permit) (Commerce) (Licensed) (HIPAA) (COPPA)

PAYMENT   free    ▓▓▓▓▓▓▓▓
  AXIS    mid     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
          ent.    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```

- **Payment tier** (free / mid / enterprise): controls feature access — forms, analytics, branding, self-serve config. Already implemented via `feature_flags` table and `TIER_PRESETS` in `lib/feature-flags.ts`.
- **Regulatory phase** (1–5): controls which event types are legal to process — determines what OSE can accept, what compliance infrastructure must be in place, and what data handling guarantees must be active.

These axes are **orthogonal**. A free-tier organizer in Phase 1 gets basic forms + basic event types. An enterprise-tier organizer in Phase 4 gets full features + HIPAA-eligible event types. The platform unlocks both dimensions independently as it matures.

---

## Phase 1 — MVP Launch (47 Event Types)

**Target date**: Active now (Q1 2026)

**Regulatory ceiling**: Standard business operations only. LLC formation + ToS + Privacy Policy + basic data handling. No special federal or state licensing triggers.

**Why this is the ceiling**: These are community/recreational events. OSE's anonymous architecture is clean at this layer — no PCI scope, no age verification requirements, no license checking needed. "No permit required" tier.

### Compliance Stack

| Requirement           | Status                 | Notes                                                      |
| --------------------- | ---------------------- | ---------------------------------------------------------- |
| LLC / Business entity | Required before launch | Shields founders from personal liability                   |
| Terms of Service      | Required before launch | Covers organizer conduct, acceptable event types           |
| Privacy Policy        | Required before launch | Describes data collection, anonymization, retention        |
| Basic data handling   | Active                 | 15-min pooling, jitter, PII scrub jobs already implemented |
| GDPR/CCPA awareness   | Passive compliance     | Anonymous architecture minimizes exposure                  |

### Allowed Event Types (47)

**Recreational Sports & Leagues**

- Bocce ball leagues
- Recreational softball leagues
- Recreational volleyball leagues
- Cornhole tournaments
- Basketball pickup leagues
- Kickball leagues
- Dodgeball leagues
- Flag football leagues
- Pickleball leagues
- Tennis ladder leagues

**Community Dining & Social**

- Community potlucks
- Neighborhood block parties
- Community dinners (non-ticketed)
- Backyard cookouts / grilling socials
- Food swap / recipe exchange events

**Neighborhood Markets & Commerce-Light**

- Neighborhood markets (non-food-vendor primary, no paid tables)
- Farmers market companion events (non-transactional)
- Community craft fairs (free entry, no paid vendor slots)

**Cultural, Arts & Live Music**

- Art shows / gallery openings (public venue, free entry)
- Live music showcases (public venue, free entry)
- Cultural heritage celebrations
- Dance showcases / performances
- Photography exhibitions

**Volunteer & Mutual Aid**

- Neighborhood cleanup / beautification events
- Mutual aid distribution events
- Food pantry volunteer days
- Habitat build days (community-organized)
- Community garden workdays

**Civic & Neighborhood**

- Civic meetups / town halls (non-electoral)
- Neighborhood association meetings
- Community input sessions
- Local business networking events
- Professional meetups / coffee chats

**Fundraisers (Non-Gaming)**

- Benefit events without raffle/gaming
- Community car washes / bake sales
- Charity walks / fun runs (non-ticketed)

**Entertainment & Recreation**

- Film screenings (public venue, free)
- Trivia nights (free entry)
- Game nights (board games, free entry)
- Open mic nights (free entry)
- Poetry / storytelling circles
- Comedy open mics (free entry)

**Outdoor & Wellness**

- Running clubs / group runs
- Walking groups
- Fitness meetups (free, outdoor)
- Community yoga / stretching sessions
- Gardening workshops

**Learning & Culture**

- Book clubs
- Language exchange meetups
- Skill-share workshops (free)
- Faith community events (non-health, non-youth primary)

**Total: 47 event types**

### OSE Architecture Notes (Phase 1)

The existing anonymous architecture is already a strength here:

- **15-min time-bucket pooling**: check-in timestamps are bucketed to 15-minute windows — no PII in aggregate analytics
- **PII scrub jobs**: scheduled destruction job (`index.ts` entry point) removes identifiable data per retention policy
- **Encrypted form submissions**: `forms-db.ts` handles hashing and encryption of submitted data
- **No payment processing**: zero PCI scope, no Stripe, no card data

---

## Phase 2 — V2 Commerce Layer

**Target date**: June 1, 2026

**Regulatory ceiling**: PCI DSS + State Sales Tax + Alcohol Notification + Food Handler Awareness. The unlock is money changing hands through OSE and events where licensed activity is present (but not operated by OSE).

### Compliance Stack

| Requirement               | Trigger                     | Notes                                                                                          |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| PCI DSS (SAQ A)           | Stripe integration          | OSE uses Stripe.js — card data never touches Worker. SAQ A scope (redirect model).             |
| State sales tax           | Paid ticket sales           | Stripe Tax or manual nexus determination per state. Illinois is nexus on day 1.                |
| Alcohol notification      | Events with alcohol present | OSE confirms venue holds license; OSE does NOT hold a liquor license. Venue attestation layer. |
| Food handler awareness    | Food vendor markets         | OSE confirms vendors hold permits; OSE does NOT issue food handler certifications.             |
| Event financial reporting | Commerce events             | SharedReport must expose revenue line in Phase 2 financial tier view.                          |

**Key compliance principle**: OSE is a **platform**, not a licensee. OSE confirms that the venue or vendor holds the relevant license/permit — it does not hold or apply for those licenses itself. This is the critical boundary that keeps Phase 2 manageable.

### New Event Types (10)

- Ticketed concerts / paid-entry shows
- Pop-up markets with paid vendor tables
- Ticketed dinners / prix fixe community meals
- Bar crawls / brewery tours (alcohol present at venue, not served by OSE)
- Wine tastings / beer festivals (venue holds license)
- Food truck rallies / street food festivals (vendors hold food permits)
- Charity auctions (non-raffle, non-gaming)
- Comedy shows (ticketed entry)
- Paid fitness classes / wellness workshops
- Ticketed sporting events (recreational leagues with entry fees)

**Total by Phase 2**: 47 + 10 = **57 event types**

### OSE Architecture Notes (Phase 2)

- **Stripe integration**: Worker routes to Stripe checkout; card data never touches D1. PCI scope is SAQ A (redirect only).
- **Venue license attestation**: New `venue_license_attestations` table — organizer checks a box confirming the venue holds the relevant permit. OSE stores the attestation, not the license.
- **Sales tax**: Stripe Tax API handles calculation. State nexus configuration in admin panel.
- **SharedReport commerce view**: Revenue totals, ticket count, refund rate — all visible in Phase 2 SharedReport tier.

---

## Phase 3 — Licensed Activities + Civic Layer

**Target date**: TBD (legal matrix must be complete first)

**Regulatory ceiling**: State-by-state licensing, FEC touch points, raffle/gaming law, cannabis (state-specific). This is the messiest phase — 50-state regulatory patchwork. Beverly ≠ Hammond on raffle law.

**Prerequisite**: A legal matrix covering all corridors where OSE operates must be complete before any Phase 3 event type goes live. This is a legal deliverable, not an engineering deliverable.

### Compliance Stack

| Requirement                  | Trigger                    | Notes                                                                                                        |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| State raffle/gaming licenses | Any raffle, bingo, 50-50   | Per-state licensing. Some states require nonprofit status.                                                   |
| FEC awareness layer          | Political campaign events  | FEC prohibits corporate in-kind contributions to campaigns. OSE must flag when events have FEC implications. |
| Cannabis event compliance    | Cannabis events            | State-by-state. Illegal federally — OSE takes no payment for cannabis events.                                |
| Labor law awareness          | Union / organizing events  | NLRA protections; OSE cannot interfere with organizing activity.                                             |
| Employment law (EEO)         | Hiring fairs               | Cannot discriminate in event promotion. Standard disclaimers.                                                |
| Securities law awareness     | Crowdfunding launch events | Regulation CF / Regulation A+ disclaimers if investment solicitation present.                                |

### New Event Types (10)

- Charity raffles / 50-50 draws / gaming nights
- Bingo nights (nonprofit gaming license required)
- Political campaign events / voter registration drives
- Candidate forums / civic debates
- Union / labor organizing events
- Employment / hiring fairs
- Real estate open houses / community investment tours
- Cannabis events (state-specific, no payment processing)
- Financial education / investment club meetups
- Crowdfunding launch events (Reg CF awareness)

**Total by Phase 3**: 57 + 10 = **67 event types**

### OSE Architecture Notes (Phase 3)

- **Corridor-aware licensing**: `event_type_registry` must include a `requires_license_check` flag and a `license_jurisdictions` JSON array. Admin panel surfaces license requirements per event type per state.
- **FEC flag**: Events tagged `political` cannot accept payment through OSE's Stripe integration (FEC in-kind contribution risk). Admin panel enforces this at event creation.
- **Cannabis events**: Hardcoded to no-payment, no-registration-data-retention mode. Anonymization is more aggressive (no 15-min window — immediate bucket destroy).
- **50-state matrix**: A `legal_corridors` table maps event type × state → `allowed | restricted | prohibited | requires_license`.

---

## Phase 4 — HIPAA Layer

**Target date**: TBD (BAA templates + legal review required)

**Regulatory ceiling**: HIPAA/HITECH + State health privacy laws. Events where health information is reasonably expected to be present — either as the explicit topic or because the attendee population is health-defined.

### Compliance Stack

| Requirement                                   | Trigger                      | Notes                                                                                                      |
| --------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| HIPAA Business Associate Agreement (BAA)      | Health events with PHI risk  | OSE executes BAA with venue partners acting as Covered Entities.                                           |
| HITECH breach notification                    | PHI breach                   | 60-day notification to HHS + affected individuals.                                                         |
| State health privacy laws                     | Health events                | IL PHIPA, CA CMIA, NY SHIELD — stricter than HIPAA in some dimensions.                                     |
| Mental health parity laws                     | Mental health support events | Data about mental health status is especially sensitive — extra anonymization layer.                       |
| Substance use confidentiality (42 CFR Part 2) | Recovery/addiction events    | Federal law stricter than HIPAA for SUD records. No disclosure even with patient consent in some contexts. |

**Key threshold**: OSE does not collect PHI directly (no diagnosis codes, no medical record numbers). But the _topic_ of the event implies attendee health status. OSE's anonymization architecture is the HIPAA asset — aggregated, bucketed, non-identifiable attendance data is not PHI.

### New Event Types (11)

- Health fairs / community health screenings
- Mental health support groups
- Addiction recovery / sobriety meetups
- Chronic illness peer support groups
- Cancer / diagnosis community gatherings
- Grief support circles
- Disability-focused community events
- Clinical trial recruitment events
- Therapy / counseling open houses
- Sexual health education events
- Birth worker / doula community events

**Total by Phase 4**: 67 + 11 = **78 event types**

### OSE Architecture Notes (Phase 4)

- **Three-layer anonymization becomes a HIPAA asset**: The existing 15-min pooling + jitter + scheduled destroy jobs already approach HIPAA-grade de-identification under Safe Harbor (45 CFR §164.514(b)). Phase 4 formalizes this by:
  - Reducing the time bucket from 15 min → 5 min for HIPAA-tagged events
  - Adding geographic generalization (zip → county for health events)
  - Activating HELP Code (UEC 05) Layer 2 fully (already scaffolded)
- **BAA template library**: Admin panel generates pre-filled BAA for venue partners. Venue signs; OSE countersigns. Stored in `legal_documents` table (Phase 4 migration).
- **No health data in SharedReport**: SharedReport for HIPAA-tier events suppresses all granular attendance data. Only aggregate counts (≥10 attendees) shown.
- **42 CFR Part 2 mode**: Recovery/addiction events get a separate flag that disables all form data retention — check-in is count-only, no identifiers stored even transiently.

---

## Phase 5 — COPPA Layer

**Target date**: TBD (parental consent infrastructure required)

**Regulatory ceiling**: COPPA + FERPA (if school-adjacent) + State child safety laws. Events where under-13 participants are the primary audience.

**Prerequisite**: Verifiable parental consent infrastructure must be built and legally reviewed before any under-13-primary event type goes live. This is a significant engineering investment, not just a compliance checkbox.

### Compliance Stack

| Requirement                       | Trigger                        | Notes                                                                                                                    |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| COPPA verifiable parental consent | Under-13 primary audience      | FTC requires "verifiable" consent — not just a checkbox. Credit card verification, signed form, or knowledge-based auth. |
| FERPA compliance                  | School district venue partners | If school district is the venue operator, student records are FERPA-protected. OSE cannot receive student-level data.    |
| State child safety laws           | Youth events                   | IL Child Protection Act, CA AB 1149, etc. Reporting obligations if abuse is observed/reported at venue.                  |
| Enhanced PII destruction          | Youth events                   | Shorter retention windows; parental right to deletion within 30 days.                                                    |
| Age verification for forms        | Under-13 registration          | DOB collection triggers COPPA. OSE must either (a) not collect DOB or (b) obtain verifiable parental consent.            |

### New Event Types (12)

- Youth sports leagues (under-13 primary)
- Kids birthday parties (venue-hosted)
- After-school programs
- Summer camp programming
- School fundraiser events
- Family-first cultural festivals (child programming is primary draw)
- Youth arts / theater productions
- Scouting / youth organization events
- Coding / STEM camps for minors
- Children's book events / story times
- Youth faith formation programs
- Teen-specific community events (13-17, COPPA-adjacent)

**Total by Phase 5**: 78 + 12 = **90 event types**

### OSE Architecture Notes (Phase 5)

- **Anonymous architecture needs a parent/guardian consent wrapper**: Current architecture assumes the attendee is the consenting adult. Phase 5 adds a consent layer where the parent/guardian consents on behalf of the minor. The attendee QR code is issued to the parent, not the child.
- **FERPA boundary**: If a school district is the venue partner, OSE's data flows are constrained to aggregate counts only. No individual-level form submission data can be retained, even temporarily.
- **Age gate at event creation**: Admin panel requires organizers to declare if the event is under-13 primary. This triggers the COPPA flow for all forms associated with that event.
- **Enhanced destruction schedule**: Youth events use a 7-day hard deletion (vs. 30-day default). Parental deletion requests must be honored within 10 days.
- **SharedReport suppression**: Youth event SharedReports show only total headcount. No demographic breakdowns, no time-series granular data.

---

## Event Type Registry

Each event type should be registered with a standard set of metadata:

```
event_type_slug         TEXT PRIMARY KEY     -- e.g. 'recreational-bocce-league'
display_name            TEXT NOT NULL        -- 'Bocce Ball League'
regulatory_phase        INTEGER NOT NULL     -- 1-5: minimum phase required
requires_license_check  INTEGER NOT NULL     -- 0|1: triggers license attestation flow
license_jurisdictions   TEXT                 -- JSON array: ['IL','IN'] or null
payment_allowed         INTEGER NOT NULL     -- 0|1: Stripe integration permitted
hipaa_adjacent          INTEGER NOT NULL     -- 0|1: triggers enhanced anonymization
coppa_adjacent          INTEGER NOT NULL     -- 0|1: triggers parental consent flow
fec_adjacent            INTEGER NOT NULL     -- 0|1: triggers FEC disclaimer
cannabis_adjacent       INTEGER NOT NULL     -- 0|1: disables payment + standard retention
active                  INTEGER NOT NULL     -- 0|1: available for selection
created_at              TEXT NOT NULL
```

---

## Schema Requirements

> **Note**: Do NOT create these migrations yet. This section documents what the D1 migration plan looks like — implementation happens in dedicated stories.

### Migration: Add `legal_clearance_tier` to `events` table

The `events` table (currently in `migrations/0001_create_events.sql`) needs a regulatory phase column:

```sql
-- Future migration: 0010_add_regulatory_fields.sql

ALTER TABLE events ADD COLUMN event_type_slug TEXT;
-- references event_type_registry.slug (enforced in application layer, not FK)

ALTER TABLE events ADD COLUMN legal_clearance_tier INTEGER NOT NULL DEFAULT 1;
-- 1=Phase1, 2=Phase2, 3=Phase3, 4=Phase4, 5=Phase5
-- Derived from event_type_slug at creation time, stored for fast querying

ALTER TABLE events ADD COLUMN requires_parental_consent INTEGER NOT NULL DEFAULT 0;
-- Denormalized from event_type_registry for performance

ALTER TABLE events ADD COLUMN hipaa_mode INTEGER NOT NULL DEFAULT 0;
-- Activates enhanced anonymization pipeline

ALTER TABLE events ADD COLUMN commerce_enabled INTEGER NOT NULL DEFAULT 0;
-- Phase 2+: Stripe integration active for this event
```

### Migration: Create `event_type_registry` table

```sql
-- Future migration: 0011_create_event_type_registry.sql

CREATE TABLE IF NOT EXISTS event_type_registry (
  slug                   TEXT PRIMARY KEY,
  display_name           TEXT NOT NULL,
  regulatory_phase       INTEGER NOT NULL DEFAULT 1,
  requires_license_check INTEGER NOT NULL DEFAULT 0,
  license_jurisdictions  TEXT,                        -- JSON array or NULL
  payment_allowed        INTEGER NOT NULL DEFAULT 0,
  hipaa_adjacent         INTEGER NOT NULL DEFAULT 0,
  coppa_adjacent         INTEGER NOT NULL DEFAULT 0,
  fec_adjacent           INTEGER NOT NULL DEFAULT 0,
  cannabis_adjacent      INTEGER NOT NULL DEFAULT 0,
  active                 INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_types_phase
  ON event_type_registry (regulatory_phase, active);
```

### Migration: Create `venue_license_attestations` table (Phase 2)

```sql
-- Future migration: 0012_create_venue_license_attestations.sql

CREATE TABLE IF NOT EXISTS venue_license_attestations (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  license_type    TEXT NOT NULL,   -- 'liquor' | 'food-vendor' | 'gaming' | 'cannabis'
  attested_by     TEXT NOT NULL,   -- organizer user ID
  attested_at     TEXT NOT NULL DEFAULT (datetime('now')),
  jurisdiction    TEXT NOT NULL,   -- state code e.g. 'IL'
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_attestations_event
  ON venue_license_attestations (event_id);
```

### Migration: Create `legal_corridors` table (Phase 3)

```sql
-- Future migration: 0013_create_legal_corridors.sql

CREATE TABLE IF NOT EXISTS legal_corridors (
  event_type_slug  TEXT NOT NULL,
  state_code       TEXT NOT NULL,       -- 'IL', 'IN', etc.
  status           TEXT NOT NULL,       -- 'allowed' | 'restricted' | 'prohibited' | 'requires_license'
  license_url      TEXT,                -- state licensing authority URL
  notes            TEXT,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_type_slug, state_code)
);
```

### Migration: Create `legal_documents` table (Phase 4)

```sql
-- Future migration: 0014_create_legal_documents.sql

CREATE TABLE IF NOT EXISTS legal_documents (
  id              TEXT PRIMARY KEY,
  document_type   TEXT NOT NULL,   -- 'baa' | 'dpa' | 'consent_form'
  event_id        TEXT,            -- NULL = platform-level document
  brand_id        TEXT,
  signed_by       TEXT,
  signed_at       TEXT,
  document_url    TEXT NOT NULL,   -- R2 or signed storage URL
  expires_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Feature Flag Additions

The existing flag system (`lib/feature-flags.ts`) needs new flags to gate regulatory features:

```typescript
// New flags to add to FLAG_KEYS:
REGULATORY_COMMERCE:      'regulatory.commerce',        // Phase 2 unlock
REGULATORY_LICENSED:      'regulatory.licensed',        // Phase 3 unlock
REGULATORY_HIPAA:         'regulatory.hipaa',           // Phase 4 unlock
REGULATORY_COPPA:         'regulatory.coppa',           // Phase 5 unlock
COMPLIANCE_VENUE_ATTEST:  'compliance.venue-attest',    // Phase 2: license attestation UI
COMPLIANCE_LEGAL_MATRIX:  'compliance.legal-matrix',    // Phase 3: per-state corridor check
```

These flags are **platform-level only** (not per-event). They gate entire regulatory phases. An enterprise customer does not unlock Phase 3 just by having enterprise tier — Phase 3 must be enabled by OSE operators once the legal matrix is complete.

---

## Regulatory Phase vs. Payment Tier Matrix

```
                 Free Tier         Mid Tier          Enterprise Tier
                 ─────────────     ─────────────     ─────────────────
Phase 1          Basic forms       All 4 forms       All 4 forms
(47 types)       Basic analytics   Shared report     Portfolio report
                 No self-serve     Self-serve         White-label + domain

Phase 2          Basic forms       All 4 forms       All 4 forms
(+10 types)      Stripe (limited)  Stripe + tax      Stripe + tax
                 No venue attest   Venue attest      Venue attest + API

Phase 3          Not available     Restricted*       Full access*
(+10 types)      —                 State matrix      State matrix + API

Phase 4          Not available     Not available     Full access*
(+11 types)      —                 —                 BAA + HIPAA mode

Phase 5          Not available     Not available     Full access*
(+12 types)      —                 —                 Parental consent flow
```

`*` = only after OSE operators enable the phase-level flag for the account

---

## Implementation Order

Stories will be filed in STORIES.md as regulatory phases approach. Rough sequence:

1. **REG-1**: Create `event_type_registry` table + seed Phase 1 types (Migration 0011)
2. **REG-2**: Add `event_type_slug` + `legal_clearance_tier` to `events` (Migration 0010)
3. **REG-3**: Admin panel event-type selector (FD story — surface in `admin.html`)
4. **REG-4**: Phase 2 venue license attestation flow (Migration 0012 + handler)
5. **REG-5**: Stripe integration + PCI scope scoping (BE story)
6. **REG-6**: Phase 3 legal corridor table + 50-state matrix seed (Migration 0013)
7. **REG-7**: Phase 4 HIPAA mode flag + enhanced anonymization pipeline
8. **REG-8**: Phase 4 BAA document generation + `legal_documents` table (Migration 0014)
9. **REG-9**: Phase 5 parental consent wrapper + COPPA age gate
10. **REG-10**: Phase 5 FERPA boundary enforcement (school venue partner mode)

---

## Decision Log

| Date       | Decision                                                   | Rationale                                                                                                     |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-03-30 | 47 types in Phase 1                                        | "No permit required" ceiling keeps OSE clean before any commerce infrastructure is in place                   |
| 2026-03-30 | OSE is a platform, not a licensee                          | OSE attests that venue holds license; OSE does not hold liquor/food/gaming licenses itself                    |
| 2026-03-30 | Phase 3 requires legal matrix before any type goes live    | Beverly ≠ Hammond on raffle law — corridor-by-corridor variance cannot be skipped                             |
| 2026-03-30 | Phase 4 HIPAA via anonymization, not BAA-first             | Existing 15-min pooling + destroy jobs already approach Safe Harbor de-identification; BAA layer added on top |
| 2026-03-30 | Phase 5 blocked until verifiable parental consent is built | FTC "verifiable" standard is not a checkbox — requires real engineering investment                            |
| 2026-03-30 | Regulatory flags are platform-level, not per-account       | Phases unlock for all accounts when OSE operators are legally ready — not a customer self-serve upgrade       |
