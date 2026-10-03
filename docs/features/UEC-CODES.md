# Universal Event Code (UEC)

> 7 colors. One meaning each. No instructions required.
> The color tells you what the QR code does before you scan it.
>
> **UEC v1.1** — Color standard for all public events.
> See [VISION.md](VISION.md) for how UEC fits into the platform's 5 foundational pillars.

---

## The Principle

A QR code should tell you what it does **before you scan it.**

Every UEC code has a dedicated color, a single semantic meaning, and a purpose that is immediately understood across every event type — sports, school, church, museum, civic, tourism, bars, government. The color is the instruction.

---

## The 7 Core Codes

| #   | Color        | Code     | Hex       | Semantics                         | Status                    |
| --- | ------------ | -------- | --------- | --------------------------------- | ------------------------- |
| 01  | **Green**    | ENTER    | `#1A6B2F` | Go · Access · Safe Passage        | KEEP                      |
| 02  | **Coral**    | LIVE     | `#C04048` | Exciting · Warm · Now             | UPDATED (was Orange/GAME) |
| 03  | **Blue**     | SPONSOR  | `#1A3A8A` | Trust · Commerce · Partnership    | KEEP                      |
| 04  | **Purple**   | ARCHIVE  | `#5E1A9A` | Memory · History · Record         | KEEP                      |
| 05  | **Pink**     | HELP     | `#B01468` | Care · Assistance · Accessibility | NEW                       |
| 06  | **Amber**    | FEEDBACK | `#8A5A00` | Voice · Opinion · Response        | UPDATED (was Yellow)      |
| 07  | **Charcoal** | UTILITY  | `#2A2A3A` | General · Info · Infrastructure   | UPDATED (was White)       |

### 01 GREEN — ENTER

**URL:** `oursharedevents.com/enter`

Venue entry, gate access, facility check-in, lobby scan, room unlock.

- Traffic light green is the most universal "go" signal on Earth
- Dark green on white passes WCAG AAA contrast
- First scan of every event — sets the tone for the entire platform interaction
- Works indoors and outdoors, legible at distance on signage

**Verdict:** No color challenge possible. Green for ENTER is permanent.

### 02 CORAL — LIVE

**URL:** `oursharedevents.com/live`

Live scoring, real-time brackets, active event feed, fundraiser thermometer, live auction.

- Coral sits at the exact midpoint between red's excitement and orange's warmth — without the baggage of either
- Scanned at peak event energy — maximum foot traffic, maximum sponsor visibility
- Works at a bocce tournament AND a church fundraiser equally

**Changed from Orange/GAME:** Orange carried caution/industrial associations incompatible with school and church contexts. GAME was too narrow — LIVE covers all event types.

### 03 BLUE — SPONSOR

**URL:** `oursharedevents.com/sponsor`

Sponsor landing page, partner offers, advertiser profile, brand activation, local business deals.

- Navy blue is the highest contrast code in the system against white
- Blue universally signals institutional trust — banks, hospitals, governments
- Sponsors recognize blue as "their" color — reduces friction at point of scan
- Critical revenue code — premium placement on all posters and signage

**Verdict:** The most valuable pixel in the system. Blue for SPONSOR is permanent.

### 04 PURPLE — ARCHIVE

**URL:** `oursharedevents.com/archive`

Past results, statistics, event memories, photos, SharedReport, legacy data, season records.

- Purple has meant permanence and importance across cultures for thousands of years
- The archive is the competitive moat — most platforms end when the event ends
- This code brings people back between events — core loyalty driver

**Verdict:** Premium color for the platform's most differentiated feature. Permanent.

### 05 PINK — HELP

**URL:** `oursharedevents.com/help`

ADA assistance, staff contact, first aid location, lost & found, volunteer info, accessibility services.

- Deep magenta-pink is globally associated with care: healthcare, safety, assistance
- Critical for ADA compliance signage at schools and civic venues
- Highest human stakes of any code — help when it's actually needed
- Every event has someone who needs help but won't ask

**New addition:** Fills a gap that exists at every single event in every vertical. An elderly attendee needing accessible seating. A lost child. A medical situation. Pink makes help visible without stigma.

### 06 AMBER — FEEDBACK

**URL:** `oursharedevents.com/feedback`

Attendee surveys, player ratings, post-event input, experience scoring, community voice.

- Amber is warm without being alarming — invites reflection rather than demanding attention
- Feedback closes the flywheel — if attendees feel invited rather than interrogated, completion rates rise

**Changed from Yellow:** Yellow fails QR scanning — near-zero contrast on white background. Yellow's universal meaning is caution, not conversation. Dark amber preserves warmth while achieving reliable scan contrast.

### 07 CHARCOAL — UTILITY

**URL:** `oursharedevents.com/utility`

WiFi password, schedule PDF, venue map, general announcements, admin quick links.

- Maximum possible contrast — most scannable code in the system
- Neutral charcoal reads as infrastructure — backstage, utility, general information
- Catch-all code — anything without a dedicated UEC color receives charcoal

**Changed from White:** White QR modules on white background are physically impossible to scan. Zero contrast. Charcoal is the correct fix.

---

## The 4 Extensions

Extensions address specific operational needs beyond the core 7. The core codes handle 95% of all event scenarios.

| Color         | Code     | Hex       | Priority | Use Case                                                  |
| ------------- | -------- | --------- | -------- | --------------------------------------------------------- |
| **Yellow**    | ALERT    | `#B8960A` | HIGH     | Safety notices, weather delays, venue emergencies         |
| **Red**       | STAFF    | `#A00020` | HIGH     | Staff-only pages, volunteer check-in, backstage access    |
| **Teal**      | CHECK-IN | `#006B6B` | MEDIUM   | Attendance tracking, membership verification, roster      |
| **Dark Teal** | SHOP     | `#1A4A48` | MEDIUM   | Merchandise, ticket upgrades, concessions, silent auction |

### YELLOW — ALERT

The one color whose meaning is universal and non-negotiable. Yellow means caution — reserved exclusively for urgent real-world alerts. Safety notices, weather delays, schedule changes, venue emergencies.

**Why yellow is an extension, not a core code:** Yellow was removed from QR use because it fails contrast requirements on white backgrounds. As an extension, ALERT codes can use alternative printing methods (yellow background with dark modules) when needed for emergency signage.

### RED — STAFF

Authority and restricted access. Separates operational codes from public-facing codes. Staff see red; attendees do not. Staff-only pages, volunteer check-in, admin tools, event worker resources.

### TEAL — CHECK-IN

Distinct from ENTER — you can enter a building but still need to register attendance separately. Attendance tracking, membership verification, roster check-in, season pass confirmation. Critical for school, church, sports, and civic contexts.

### DARK TEAL — SHOP

Commerce beyond sponsors. Separates buying (transaction) from sponsorship (relationship). Shop is attendee-initiated; sponsor is platform-placed. Merchandise, ticket upgrades, concession ordering, silent auction, fundraising purchases.

---

## The Attendee Journey — One Event, Six Scans

```
1. GREEN · ENTER     Arrives at venue. Scans green. No instructions needed.
2. BLUE  · SPONSOR   Sees a local offer on display. Scans blue. Gets a real discount.
3. CORAL · LIVE      Event begins. Scans coral. Real-time action — all live.
4. PINK  · HELP      Needs accessible seating. Scans pink. Help arrives.
5. AMBER · FEEDBACK  Event ends. Scans amber. 30 seconds. Feels heard.
6. PURPLE · ARCHIVE  Goes home. Shares the purple link. The win lives forever.
```

---

## Event Verticals

Every core code works across all verticals — no vertical requires a different system:

| Vertical    | All 7 Core | ALERT | STAFF | CHECK-IN | SHOP |
| ----------- | :--------: | :---: | :---: | :------: | :--: |
| Sports      |     Y      |   Y   |   Y   |    Y     |  Y   |
| School      |     Y      |   Y   |   Y   |    Y     |  -   |
| Church      |     Y      |   Y   |   Y   |    Y     |  -   |
| Museum      |     Y      |   Y   |   Y   |    Y     |  Y   |
| Rec Center  |     Y      |   Y   |   Y   |    Y     |  -   |
| Civic       |     Y      |   Y   |   Y   |    Y     |  -   |
| Tourism     |     Y      |   Y   |   -   |    -     |  Y   |
| Bars        |     Y      |   Y   |   -   |    -     |  Y   |
| Government  |     Y      |   Y   |   Y   |    -     |  -   |
| Fundraising |     Y      |   Y   |   -   |    -     |  Y   |

---

## Technical Specifications

### QR Code Requirements

- **Module colors:** All dark on white — contrast ratios pass WCAG
- **Error correction:** Level H (30%) — allows logo overlay on all codes
- **URL paths:** Human-readable (`/enter`, `/sponsor`, `/feedback`) — not raw event IDs
- **Grayscale fallback:** System works in grayscale — label text backup for accessibility

### Color Psychology Audit

| Code     | Psychology                         | Cultural Basis                                         |
| -------- | ---------------------------------- | ------------------------------------------------------ |
| GREEN    | Go, safe, proceed                  | Only color with same meaning in every culture on Earth |
| CORAL    | Excitement + warmth, no alarm      | Midpoint of red energy and orange inclusivity          |
| BLUE     | Trust, institution, value          | Banks, hospitals, governments worldwide                |
| PURPLE   | Permanence, memory, royalty        | Thousands of years across Western and Eastern cultures |
| PINK     | Care, assistance, compassion       | Healthcare, safety, and compassionate service globally |
| AMBER    | Reflection, warmth, completion     | Harvest, gold, invitation without alarm                |
| CHARCOAL | Infrastructure, backstage, utility | Circuit breakers, pipe labels, server racks            |

### Changes from v1.0

| v1.0              | v1.1               | Reason                                                          |
| ----------------- | ------------------ | --------------------------------------------------------------- |
| Orange / GAME     | Coral / LIVE       | Orange = caution/industrial. GAME too narrow for church/school. |
| Yellow / FEEDBACK | Amber / FEEDBACK   | Yellow fails QR contrast on white. Caution ≠ conversation.      |
| White / UTILITY   | Charcoal / UTILITY | White on white = physically impossible to scan.                 |
| _(none)_          | Pink / HELP        | New — ADA, accessibility, human assistance gap filled.          |

### Deployment Checklist

- [x] All module colors are dark on white — contrast ratios pass WCAG
- [x] Error correction level H (30%) — allows logo overlay on all codes
- [x] URL paths are human-readable — not raw event IDs
- [x] 7 codes cover full lifecycle: pre-event, during, and post
- [x] Color semantics align with global color psychology research
- [x] Each code has exactly one meaning — zero ambiguity across the set
- [x] System works in grayscale — label backup for accessibility
- [x] Pink/HELP satisfies ADA and accessibility signage requirements
- [x] Coral replaces orange — warm, inviting, zero caution associations
- [x] Yellow removed from QR use — insufficient contrast on white
- [x] White removed — physically invalid as a QR module color

---

## Poster and Display Codes → UEC

Every code an organizer puts on a poster prints in one UEC colour, with the
word and the UEC name in text beside it (colour is never the only signal). The
mapping lives in `workers/oursharedevents/src/lib/poster-codes.ts`; colours are
read from the registry (`lib/uec`), never written as hex. PO-confirmed 2026-10-03.

| Poster code                        | Word on the card | UEC code    | Colour    |
| ---------------------------------- | ---------------- | ----------- | --------- |
| Event page                         | EVENT            | 07 UTILITY  | Charcoal  |
| Anonymous check-in                 | CHECK IN         | 10 CHECK-IN | Teal      |
| Registration (own form / external) | REGISTER         | 01 ENTER    | Green     |
| Sign-up link                       | SIGN UP          | 01 ENTER    | Green     |
| Donation link                      | DONATE           | 11 SHOP     | Dark Teal |
| Tickets link                       | TICKETS          | 11 SHOP     | Dark Teal |
| Sponsorship link                   | SPONSOR          | 03 SPONSOR  | Blue      |
| League link                        | LEAGUE           | 02 LIVE     | Coral     |
| Music, Menu, Newsletter, Other     | (as named)       | 07 UTILITY  | Charcoal  |

The TV display's league screen (schedule, standings, bracket) draws its QR
codes in the same LIVE colour as the poster's LEAGUE code.

This replaces the earlier poster-only rule ("green is only check-in, blue is
only donate"), which gave blue a second meaning beside SPONSOR.

---

## How UEC Connects to the Platform

| UEC Code       | Platform Feature                    | Data Generated                         |
| -------------- | ----------------------------------- | -------------------------------------- |
| ENTER          | Registration form, check-in counter | `form_registrations`, `checkin_counts` |
| LIVE           | Display surface (real-time)         | `scans`, `scan_aggregates`             |
| SPONSOR        | Sponsor placement, attribution      | `sponsors`, `source_placement_id`      |
| ARCHIVE        | SharedReport surface                | `scan_aggregates`, form analytics      |
| HELP           | Accessibility services page         | Utility — no tracking                  |
| FEEDBACK       | Survey form, email signup form      | `form_surveys`, `email_signups`        |
| UTILITY        | General info pages                  | Utility — minimal tracking             |
| ALERT (ext)    | Emergency broadcast                 | Admin push — no scan tracking          |
| STAFF (ext)    | Admin surface                       | Admin auth required                    |
| CHECK-IN (ext) | Attendance tracking                 | `checkin_counts` with roster           |
| SHOP (ext)     | Commerce page                       | Sponsor click/impression tokens        |

Every scan through a UEC code feeds the anonymous presence signal system. The `poster_deployments` table stores each physical QR placement with lat/lng. The `scans` table records the time-bucketed, PII-free interaction. SharedReports surface the aggregate results. The UEC color system is the physical-to-digital bridge that makes this data pipeline work.
