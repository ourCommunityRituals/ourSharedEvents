# Feature Documentation

> What ourSharedEvents **does** — from every audience's perspective.
> For how it's built, see [`docs/architecture/`](../architecture/).

---

## Start Here: [VISION.md](VISION.md)

The foundational philosophy: anonymous-ID-first platform serving the hyperlocal economy through a fair marketplace where every local sponsor has a seat. Covers the 3 core principles, the 11-QR standard system, and the NCR geo-spatial intelligence horizon.

---

## The Triangle — Three Audiences, One Platform

```
       Admins (Event Organizers)
          /           \
         /    Events   \
        /               \
  Sponsors ──────── Customers
  (Brands)           (Attendees)
```

Every feature serves at least one vertex of the Triangle. The live chat assistant is trained per audience.

| Audience      | Who They Are                                 | What They Need                                           |
| ------------- | -------------------------------------------- | -------------------------------------------------------- |
| **Customers** | Attendees, community members                 | Register, check in, find events, know their data is safe |
| **Sponsors**  | Local bar → regional league → national brand | See their impact, get attribution data, grow their brand |
| **Admins**    | Event organizers, league operators           | Manage events, configure forms, review analytics         |

### Future Audiences

| Audience        | When                       | Scope                                          |
| --------------- | -------------------------- | ---------------------------------------------- |
| Government      | Civic event partnerships   | Permitting, public safety, venue compliance    |
| Policy          | Data governance formalized | Retention, compliance, audit                   |
| Public Services | Public-sector hosting      | Libraries, community centers, nonprofits       |
| Researchers     | ourEventRings data APIs    | Anonymized analytics, community impact studies |

---

## Feature Map by Tier

| Feature                                       | Free | Mid | Enterprise | Doc                                          |
| --------------------------------------------- | :--: | :-: | :--------: | -------------------------------------------- |
| Event listing (public page)                   |  Y   |  Y  |     Y      | [EVENTS.md](EVENTS.md)                       |
| Registration form                             |  Y   |  Y  |     Y      | [FORMS.md](FORMS.md)                         |
| Check-in counter                              |  Y   |  Y  |     Y      | [FORMS.md](FORMS.md)                         |
| Survey form                                   |  -   |  Y  |     Y      | [FORMS.md](FORMS.md)                         |
| Email signup form                             |  -   |  Y  |     Y      | [FORMS.md](FORMS.md)                         |
| UEC color-coded QR system                     |  Y   |  Y  |     Y      | [UEC-CODES.md](UEC-CODES.md)                 |
| QR codes and short links (tracking + routing) |  Y   |  Y  |     Y      | [QR-AND-SHORTLINKS.md](QR-AND-SHORTLINKS.md) |
| QR code form routing                          |  Y   |  Y  |     Y      | [QR-ROUTING.md](QR-ROUTING.md)               |
| Sponsor attribution tracking                  |  Y   |  Y  |     Y      | [SPONSORS.md](SPONSORS.md)                   |
| Admin dashboard                               |  Y   |  Y  |     Y      | [SURFACES.md](SURFACES.md)                   |
| Own brand namespace                           |  -   |  Y  |     Y      | [BRANDS.md](BRANDS.md)                       |
| Self-serve event config                       |  -   |  Y  |     Y      | [TIERS.md](TIERS.md)                         |
| Shared analytics report                       |  -   |  Y  |     Y      | [TIERS.md](TIERS.md)                         |
| SharedReport depth (sections/tier)            |  -   |  Y  |     Y      | [REPORT-DEPTH.md](REPORT-DEPTH.md)           |
| Advanced metrics + PDF export                 |  -   |  Y  |     Y      | [TIERS.md](TIERS.md)                         |
| Portfolio reports                             |  -   |  -  |     Y      | [TIERS.md](TIERS.md)                         |
| File upload (logos, posters)                  |  -   |  -  |     Y      | [TIERS.md](TIERS.md)                         |
| White-label branding                          |  -   |  -  |     Y      | [BRANDS.md](BRANDS.md)                       |
| Custom domain                                 |  -   |  -  |     Y      | [BRANDS.md](BRANDS.md)                       |
| Per-event feature overrides                   |  -   |  -  |     Y      | [TIERS.md](TIERS.md)                         |
| PII lifecycle (auto-scrub/delete)             |  Y   |  Y  |     Y      | [PRIVACY.md](PRIVACY.md)                     |
| Landing page + email capture                  |  Y   |  Y  |     Y      | [SURFACES.md](SURFACES.md)                   |

---

## Document Index by Audience

### For Customers (Attendees)

| Document                                 | Description                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| [FORMS.md](FORMS.md)                     | How to register, check in, take surveys, sign up for emails |
| [UEC-CODES.md](UEC-CODES.md)             | Universal Event Code — 7 colors, one meaning each           |
| [QR-ROUTING.md](QR-ROUTING.md)           | What happens when you scan a QR code                        |
| [SURFACES.md](SURFACES.md)               | What pages you can visit                                    |
| [EVENTS.md](EVENTS.md)                   | How to find and view events                                 |
| [PRIVACY.md](PRIVACY.md)                 | What happens with your data                                 |
| [ERROR-REFERENCE.md](ERROR-REFERENCE.md) | Why something isn't working                                 |

### For Sponsors (Brands)

| Document                                 | Description                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| [SPONSORS.md](SPONSORS.md)               | Sponsor experience: attribution, analytics, tiers by scale                |
| [CAMPAIGNS.md](CAMPAIGNS.md)             | A sponsor's campaign across events: the admin API and the public contract |
| [REPORT-DEPTH.md](REPORT-DEPTH.md)       | What each report depth (local/mid/premium) shows a sponsor, and why       |
| [SPONSOR-PRICING.md](SPONSOR-PRICING.md) | Pricing governance: weight classes, governor, pool dynamics               |
| [GOVERNOR-DESIGN.md](GOVERNOR-DESIGN.md) | Deep dive: pool-based allocation — security, edge cases, error handling   |
| [BRANDS.md](BRANDS.md)                   | Multi-brand isolation, white-label, sponsor layering                      |
| [TIERS.md](TIERS.md)                     | What each tier unlocks for sponsors                                       |
| [EVENTS.md](EVENTS.md)                   | How events work, the Triangle data model                                  |
| [SURFACES.md](SURFACES.md)               | Where sponsors appear (report, display, poster)                           |
| [PRIVACY.md](PRIVACY.md)                 | What attendee data sponsors can/cannot access                             |

### For Admins (Event Organizers)

| Document                                 | Description                                            |
| ---------------------------------------- | ------------------------------------------------------ |
| [TIERS.md](TIERS.md)                     | How to enable features, manage flags, apply tiers      |
| [REPORT-DEPTH.md](REPORT-DEPTH.md)       | How report depth is minted into share links + enforced |
| [FORMS.md](FORMS.md)                     | Admin endpoints, registration counts, form management  |
| [QR-ROUTING.md](QR-ROUTING.md)           | Generating QR links, test-IDs for automation           |
| [BRANDS.md](BRANDS.md)                   | Brand setup, isolation, sponsor management             |
| [SPONSORS.md](SPONSORS.md)               | Sponsor attribution data and placement tracking        |
| [AUTH.md](AUTH.md)                       | Admin access: Cloudflare Access + Bearer token         |
| [EVENTS.md](EVENTS.md)                   | Event APIs and data model                              |
| [SURFACES.md](SURFACES.md)               | Admin dashboard and all surfaces                       |
| [ERROR-REFERENCE.md](ERROR-REFERENCE.md) | Troubleshooting every error code                       |

### Design and Methodology

Pillar documents and the SharedReport design set. Where a status line is out of date, the entry says so; the code and its tests win.

| Document                                                             | Description                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ANONYMOUS-ID.md](ANONYMOUS-ID.md)                                   | Pillar 2: the anonymous id contract, why scans and forms live in separate databases, and what each side stores                                                                       |
| [NCR-METHODOLOGY.md](NCR-METHODOLOGY.md)                             | Pillar 5: Neighborhood Community Rituals, the method for turning anonymous event data into area-level patterns (a horizon, not a shipped product)                                    |
| [PLATFORM-FLOW.md](PLATFORM-FLOW.md)                                 | Pillar 1: the end-to-end event lifecycle, from creation to post-event analytics, across the surfaces                                                                                 |
| [SHARED-REPORT-DATA-PIPELINE.md](SHARED-REPORT-DATA-PIPELINE.md)     | SharedReport data pipeline design (ratified 2026-05-15): the primitives, materialization and the aggregates a report carries                                                         |
| [SHARED-REPORT-BIGQUERY-EXPORT.md](SHARED-REPORT-BIGQUERY-EXPORT.md) | SharedReport BigQuery export design (ratified 2026-05-15): what leaves D1 for BigQuery and how                                                                                       |
| [SHARED-REPORT-READ-API.md](SHARED-REPORT-READ-API.md)               | SharedReport read API and WKRP batch design. Its "Design draft" status line is stale: the routes are live; later amendments (for example cache headers, OSE-1502) are inside the doc |
| [SHARED-REPORT-L1-MATRIX.md](SHARED-REPORT-L1-MATRIX.md)             | The API-level (L1) auth and mutation coverage matrix for the SharedReport, and why each case must exist                                                                              |
| [SPONSORSHIP-PAGE-SPEC.md](SPONSORSHIP-PAGE-SPEC.md)                 | Sponsorship page spec, a DRAFT from 2026-09-08 awaiting owner review: the sponsor chooses reach, frequency, creative and report depth, never the honesty                             |
