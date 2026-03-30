# Event Contract

## MVP v1.0 – frozen

> **Schema lock date:** 2025-11-30
> **Source of truth:** `/schemas/event.schema.json`
> **Breaking changes require migration scripts.**

This table is the single source of truth for what fields are allowed in MVP v1.0.
Any field marked V2 cannot be depended on by MVP surfaces without a feature flag.

---

### Field Matrix

| field | required | used by surfaces | MVP/V2 |
|-------|:--------:|------------------|:------:|
| **CORE IDENTITY** ||||
| `id` | Y | Public, Display, Poster, Admin | MVP |
| `slug` | Y | Admin | MVP |
| `name` | Y | Public, Display, Poster, Admin | MVP |
| `startDateISO` | Y | Public, Display, Poster, Admin | MVP |
| `venue` | Y | Public, Display, Poster, Admin | MVP |
| `templateId` | N | Display, Admin | MVP |
| **LINKS (auto-generated, read-only)** ||||
| `links.publicUrl` | Y | Public, Display, Poster, Admin | MVP |
| `links.displayUrl` | Y | Admin | MVP |
| `links.posterUrl` | Y | Admin | MVP |
| `links.signupUrl` | Y | Public, Poster, Admin | MVP |
| `links.sharedReportUrl` | N | Admin | V2 |
| **QR CODES (auto-generated, read-only)** ||||
| `qr.public` | Y | Poster, Admin | MVP |
| `qr.signup` | Y | Poster, Admin | MVP |
| **CTAs** ||||
| `ctas.primary.label` | Y | Public, Poster, Admin | MVP |
| `ctas.primary.url` | Y | Public, Admin | MVP |
| `ctas.secondary` | N | Public | V2 |
| **CONTENT** ||||
| `schedule[]` | N | Public, Display | MVP |
| `standings[]` | N | Public, Display | MVP |
| `bracket` | N | Public | MVP |
| `sponsors[]` | N | Public, Display, Poster | V2 |
| `media.videoUrl` | N | Public | V2 |
| `media.mapUrl` | N | Public | V2 |
| `media.gallery[]` | N | Public | V2 |
| `externalData.scheduleUrl` | N | Public, Display | V2 |
| `externalData.standingsUrl` | N | Public, Display | V2 |
| `externalData.bracketUrl` | N | Public, Display | V2 |
| **SETTINGS (display toggles)** ||||
| `settings.showSchedule` | Y | Public, Display, Admin | MVP |
| `settings.showStandings` | Y | Public, Display, Admin | MVP |
| `settings.showBracket` | Y | Public, Display, Admin | MVP |
| `settings.showSponsors` | N | Public, Display, Poster, Admin | MVP |
| `settings.showVideo` | N | Public, Admin | MVP |
| `settings.showMap` | N | Public, Admin | MVP |
| `settings.showGallery` | N | Public, Admin | MVP |
| `settings.showSponsorBanner` | N | Public | MVP |
| `settings.showSponsorStrip` | N | Display | MVP |
| `settings.showLeagueStrip` | N | Display | MVP |
| `settings.showQRSection` | N | Poster | MVP |
| `settings.displayRotation` | N | Display | V2 |
| **METADATA** ||||
| `createdAtISO` | Y | Admin | MVP |
| `updatedAtISO` | Y | System | MVP |
| **RESERVED (do not use)** ||||
| `analytics` | — | — | V2 |
| `payments` | — | — | V2 |

---

### SharedAnalytics (read by SharedReport)

SharedReport uses a separate schema: `/schemas/shared-analytics.schema.json`

| field | required | used by surfaces | MVP/V2 |
|-------|:--------:|------------------|:------:|
| `summary.totalImpressions` | Y | SharedReport | MVP |
| `summary.totalClicks` | Y | SharedReport | MVP |
| `summary.totalQrScans` | Y | SharedReport | MVP |
| `summary.totalSignups` | Y | SharedReport | MVP |
| `summary.uniqueEvents` | Y | SharedReport | MVP |
| `summary.uniqueSponsors` | Y | SharedReport | MVP |
| `surfaces[].id` | Y | SharedReport | MVP |
| `surfaces[].impressions` | Y | SharedReport | MVP |
| `surfaces[].clicks` | Y | SharedReport | MVP |
| `surfaces[].qrScans` | Y | SharedReport | MVP |
| `sponsors[].id` | Y | SharedReport | MVP |
| `sponsors[].impressions` | Y | SharedReport | MVP |
| `sponsors[].clicks` | Y | SharedReport | MVP |
| `sponsors[].ctr` | Y | SharedReport | MVP |
| `events[].id` | Y | SharedReport | MVP |
| `events[].impressions` | Y | SharedReport | MVP |
| `events[].clicks` | Y | SharedReport | MVP |
| `topSponsors[]` | N | SharedReport | MVP |
| `lastUpdatedISO` | Y | SharedReport | MVP |

---

### Surface Constraints

| Surface | Critical Rules |
|---------|----------------|
| **Public** | Must use `links.*` (never rebuild URLs). Gate sections with `setting && data?.length`. |
| **Display** | Sponsor filter: `placement === 'display' \|\| 'tv-banner'`. QR only from `event.qr.*`. |
| **Poster** | Print-safe (no links on sponsors). QR must be pre-generated server-side. |
| **Admin** | Preserve `id`, `slug`, `createdAtISO` on edit. Never overwrite `links.*` or `qr.*`. |
| **SharedReport** | Read-only. Uses analytics schema, not event schema. |

---

### Change Policy

- **MVP fields**: Cannot remove or change types. Additive changes only.
- **V2 fields**: Optional with `null` default. MVP surfaces must not depend on them without feature flags.
- **Breaking changes**: Require new schema version + migration script.
- **CI enforcement**: `npm run test:schemas` validates all surfaces.

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

| Old Field | Replaced By |
|-----------|-------------|
| `dateTime` | `startDateISO` |
| `location` | `venue` |
| `ctaLabels[]` | `ctas.primary/secondary` |
| `sections.*` | `settings.show*` |
| `videoUrl` | `media.videoUrl` |
| `mapEmbedUrl` | `media.mapUrl` |
