# Event Contract

## MVP v1.0 – frozen

> **Contract of record (persisted):** the `events` D1 table —
> `workers/oursharedevents/migrations/0001_create_events.sql`. The flat columns
> (`title`, `start_date`, `location`, `status`, …) are the durable truth, not any
> JSON schema.
> **Contract of record (API output):** `enrichWithPhase()` in
> `workers/oursharedevents/src/handlers/events.ts` maps the DB columns to the
> canonical output names (`title→name`, `start_date→startDateISO`,
> `location→venue`) and adds `phase`, per **ADR-016**. The shape is guarded by
> `workers/oursharedevents/src/api-schema-snapshots/public-events.snapshot.json`
> (v1.1.0) and `tests/e2e/0-architecture/api-response-schema.invariant.spec.ts`.
> **Retired (historical reference only):**
> `reference/gas-mvp/schemas/event.schema.json` — the abandoned zeventbook.com
> JSON shape. It is **not** a contract of record (OSE-882); the D1 table is.
> **Breaking changes to the persisted contract require a migration script.**

The field matrix below is the composed **surface view** an event presents to the
five surfaces. The MVP identity fields (`id`, `name`, `startDateISO`, `venue`)
map directly to D1 columns via `enrichWithPhase`; the richer nesting
(`links.*`, `qr.*`, `ctas.*`, `schedule[]`, `settings.show*`) is composed at the
handler/template layer (partly from the `data_json` column) and V2 fields are
gated behind feature flags.

---

### Field Matrix

| field                                    | required | used by surfaces               | MVP/V2 |
| ---------------------------------------- | :------: | ------------------------------ | :----: |
| **CORE IDENTITY**                        |          |                                |        |
| `id`                                     |    Y     | Public, Display, Poster, Admin |  MVP   |
| `slug`                                   |    Y     | Admin                          |  MVP   |
| `name`                                   |    Y     | Public, Display, Poster, Admin |  MVP   |
| `startDateISO`                           |    Y     | Public, Display, Poster, Admin |  MVP   |
| `venue`                                  |    Y     | Public, Display, Poster, Admin |  MVP   |
| `templateId`                             |    N     | Display, Admin                 |  MVP   |
| **LINKS (auto-generated, read-only)**    |          |                                |        |
| `links.publicUrl`                        |    Y     | Public, Display, Poster, Admin |  MVP   |
| `links.displayUrl`                       |    Y     | Admin                          |  MVP   |
| `links.posterUrl`                        |    Y     | Admin                          |  MVP   |
| `links.signupUrl`                        |    Y     | Public, Poster, Admin          |  MVP   |
| `links.sharedReportUrl`                  |    N     | Admin                          |   V2   |
| **QR CODES (auto-generated, read-only)** |          |                                |        |
| `qr.public`                              |    Y     | Poster, Admin                  |  MVP   |
| `qr.signup`                              |    Y     | Poster, Admin                  |  MVP   |
| **CTAs**                                 |          |                                |        |
| `ctas.primary.label`                     |    Y     | Public, Poster, Admin          |  MVP   |
| `ctas.primary.url`                       |    Y     | Public, Admin                  |  MVP   |
| `ctas.secondary`                         |    N     | Public                         |   V2   |
| **CONTENT**                              |          |                                |        |
| `schedule[]`                             |    N     | Public, Display                |  MVP   |
| `standings[]`                            |    N     | Public, Display                |  MVP   |
| `bracket`                                |    N     | Public                         |  MVP   |
| `sponsors[]`                             |    N     | Public, Display, Poster        |   V2   |
| `media.videoUrl`                         |    N     | Public                         |   V2   |
| `media.mapUrl`                           |    N     | Public                         |   V2   |
| `media.gallery[]`                        |    N     | Public                         |   V2   |
| `externalData.scheduleUrl`               |    N     | Public, Display                |   V2   |
| `externalData.standingsUrl`              |    N     | Public, Display                |   V2   |
| `externalData.bracketUrl`                |    N     | Public, Display                |   V2   |
| **SETTINGS (display toggles)**           |          |                                |        |
| `settings.showSchedule`                  |    Y     | Public, Display, Admin         |  MVP   |
| `settings.showStandings`                 |    Y     | Public, Display, Admin         |  MVP   |
| `settings.showBracket`                   |    Y     | Public, Display, Admin         |  MVP   |
| `settings.showSponsors`                  |    N     | Public, Display, Poster, Admin |  MVP   |
| `settings.showVideo`                     |    N     | Public, Admin                  |  MVP   |
| `settings.showMap`                       |    N     | Public, Admin                  |  MVP   |
| `settings.showGallery`                   |    N     | Public, Admin                  |  MVP   |
| `settings.showSponsorBanner`             |    N     | Public                         |  MVP   |
| `settings.showSponsorStrip`              |    N     | Display                        |  MVP   |
| `settings.showLeagueStrip`               |    N     | Display                        |  MVP   |
| `settings.showQRSection`                 |    N     | Poster                         |  MVP   |
| `settings.displayRotation`               |    N     | Display                        |   V2   |
| **METADATA**                             |          |                                |        |
| `createdAtISO`                           |    Y     | Admin                          |  MVP   |
| `updatedAtISO`                           |    Y     | System                         |  MVP   |
| **RESERVED (do not use)**                |          |                                |        |
| `analytics`                              |    —     | —                              |   V2   |
| `payments`                               |    —     | —                              |   V2   |

---

### SharedAnalytics (read by SharedReport)

SharedReport reads a separate analytics shape. The historical schema
`reference/gas-mvp/schemas/shared-analytics.schema.json` is retired reference
only (OSE-882); the SharedReport response shape is locked at runtime by
Invariant #21 `shared_report_schema_stability`.

| field                      | required | used by surfaces | MVP/V2 |
| -------------------------- | :------: | ---------------- | :----: |
| `summary.totalImpressions` |    Y     | SharedReport     |  MVP   |
| `summary.totalClicks`      |    Y     | SharedReport     |  MVP   |
| `summary.totalQrScans`     |    Y     | SharedReport     |  MVP   |
| `summary.totalSignups`     |    Y     | SharedReport     |  MVP   |
| `summary.uniqueEvents`     |    Y     | SharedReport     |  MVP   |
| `summary.uniqueSponsors`   |    Y     | SharedReport     |  MVP   |
| `surfaces[].id`            |    Y     | SharedReport     |  MVP   |
| `surfaces[].impressions`   |    Y     | SharedReport     |  MVP   |
| `surfaces[].clicks`        |    Y     | SharedReport     |  MVP   |
| `surfaces[].qrScans`       |    Y     | SharedReport     |  MVP   |
| `sponsors[].id`            |    Y     | SharedReport     |  MVP   |
| `sponsors[].impressions`   |    Y     | SharedReport     |  MVP   |
| `sponsors[].clicks`        |    Y     | SharedReport     |  MVP   |
| `sponsors[].ctr`           |    Y     | SharedReport     |  MVP   |
| `events[].id`              |    Y     | SharedReport     |  MVP   |
| `events[].impressions`     |    Y     | SharedReport     |  MVP   |
| `events[].clicks`          |    Y     | SharedReport     |  MVP   |
| `topSponsors[]`            |    N     | SharedReport     |  MVP   |
| `lastUpdatedISO`           |    Y     | SharedReport     |  MVP   |

---

### Surface Constraints

| Surface          | Critical Rules                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Public**       | Must use `links.*` (never rebuild URLs). Gate sections with `setting && data?.length`. |
| **Display**      | Sponsor filter: `placement === 'display' \|\| 'tv-banner'`. QR only from `event.qr.*`. |
| **Poster**       | Print-safe (no links on sponsors). QR must be pre-generated server-side.               |
| **Admin**        | Preserve `id`, `slug`, `createdAtISO` on edit. Never overwrite `links.*` or `qr.*`.    |
| **SharedReport** | Read-only. Uses analytics schema, not event schema.                                    |

---

### Change Policy

- **MVP fields**: Cannot remove or change types. Additive changes only.
- **V2 fields**: Optional with `null` default. MVP surfaces must not depend on them without feature flags.
- **Breaking changes**: Require new schema version + migration script.
- **CI enforcement**: the API response shape is guarded by
  `tests/e2e/0-architecture/api-response-schema.invariant.spec.ts` and the
  `public-events.snapshot.json` diff gate (the retired `test:schemas` harness
  lives at `reference/gas-mvp/scripts/test-schemas.js`).

---

### Supporting Types

```typescript
// ScheduleRow
{ time: string, title: string, description?: string }

// StandingRow
{ rank: number, team: string, wins: number, losses: number, points?: number }

// BracketTree
{ rounds: [{ name: string, matches: BracketMatch[] }] }

// Sponsor (V2)
{ id: string, name: string, logoUrl: string, linkUrl?: string, placement: "poster"|"display"|"public"|"tv-banner" }

// CTA
{ label: string, url: string }
```

---

### Deprecated Fields

| Old Field     | Replaced By              |
| ------------- | ------------------------ |
| `dateTime`    | `startDateISO`           |
| `location`    | `venue`                  |
| `ctaLabels[]` | `ctas.primary/secondary` |
| `sections.*`  | `settings.show*`         |
| `videoUrl`    | `media.videoUrl`         |
| `mapEmbedUrl` | `media.mapUrl`           |
