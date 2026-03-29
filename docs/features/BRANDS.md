# Multi-Brand Isolation

> How ourSharedEvents supports multiple brands/tenants within one platform.

---

## How Brands Work

Every event belongs to a **brand**. The default brand is `root`. Other brands (e.g., `abc` for American Bocce Co.) are isolated — they only see their own events.

### Brand Filtering

| API | Filter | Behavior |
|-----|--------|----------|
| `GET /api/v2/events` | `?brand=root` (default) | Only root brand events |
| `GET /api/v2/events?brand=abc` | `?brand=abc` | Only ABC brand events |
| `GET /api/v2/admin/events` | `?brand=root` (default) | Admin view, root brand |
| `GET /api/v2/admin/events?brand=abc` | `?brand=abc` | Admin view, ABC brand |

### Data Model

Events have a `brand_id` column (column B in Google Sheets, will be a column in D1):

| Event ID | Brand ID | Name |
|----------|----------|------|
| `bocce-spring` | `root` | Spring Bocce Night |
| `abc-league-1` | `abc` | ABC League Week 1 |
| `orn-vinyl-night` | `orn` | OurRecordNights Vinyl |

### Dual-Key Pattern

In Phase 2 (D1), all queries use dual-key isolation: `WHERE id = ? AND brand_id = ?`. This ensures no cross-brand data leakage even if event IDs collide across brands.

---

## Brand-Specific URLs (Phase 2+)

Friendly URLs support brand-specific paths:

| URL | Maps To |
|-----|---------|
| `/events` | Public events (root brand) |
| `/abc/events` | Public events (ABC brand) |
| `/abc/manage` | Admin for ABC brand |
| `/abc/posters` | Posters for ABC brand |

See [`docs/architecture/FRIENDLY_URLS.md`](../architecture/FRIENDLY_URLS.md) for the full URL system.

---

## Enterprise: White-Label Branding

With the Enterprise tier, brands can:

| Feature | Flag | Description |
|---------|------|-------------|
| Remove "OurSharedEvents" branding | `branding.white-label` | Their brand name appears instead |
| Use custom colors | `branding.color-palette` | Their color scheme |
| Use their own domain | `branding.custom-domain` | `events.americanbocce.com` |
| Upload custom assets | `assets.file-upload` | Logos, posters, custom QR designs |

---

## Current State

| Capability | Status |
|-----------|--------|
| Brand filtering on events API | Working |
| Dual-key isolation in queries | Working (Sheets), Ready (D1) |
| Brand-specific friendly URLs | Designed, not yet routed |
| White-label branding | Flag exists, UI not implemented |
| Custom domains | Flag exists, DNS not configured |
| Custom color palette | Flag exists, CSS not parameterized |
