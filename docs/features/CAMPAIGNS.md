# Campaigns

> A campaign is a brand's named group of sponsor placements across its events.
> Decision record: [ADR-030](../adr/ADR-030-campaign-stays-in-its-brand-and-is-public-by-consent.md).
> Owner, 2026-11-12: a partner for a whole showcase station is a campaign across that station's events.

**Built 2026-11-13 (showcase S14, part of OSE-1552). API only; there is no admin screen yet.**

## What a campaign is

| Field      | Rule                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `id`       | `cmp_<uuid>`. 40 characters of `[A-Za-z0-9_-]`. Set by the server.     |
| `brand_id` | Exactly one brand. Set at create and never changed.                    |
| `title`    | Plain text, one line, 1 to 120 characters. Escape it when printing it. |
| `status`   | `active`, `paused` or `completed`. Default `active`.                   |

A sponsor placement (one sponsor on one event) is in at most one campaign.

## For an organizer (admin API)

Every route needs an admin identity. Every write passes the admin write guard and is audited.

| Route                                                        | What it does                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET /api/v2/admin/campaigns`                                | Your brands' campaigns, newest first, at most 500. It takes no query parameter.                         |
| `POST /api/v2/admin/campaigns`                               | Body `{ "title", "status"?, "brand_id"? }`. Any other field is a 400. Answers 201 with `id` and `item`. |
| `PUT /api/v2/admin/campaigns/:id/placements/:placementId`    | Puts the placement in the campaign. No body. The placement's event must be in the campaign's brand.     |
| `DELETE /api/v2/admin/campaigns/:id/placements/:placementId` | Takes it out. It must name the campaign the placement is in.                                            |

A placement id is the `placement_id` that `GET /api/v2/admin/sponsors` and sponsor create return.

Refusals:

| Status | Code                                                                                 | When                                                                                     |
| ------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 400    | `MISSING_TITLE`, `INVALID_TITLE`, `INVALID_STATUS`, `UNKNOWN_FIELD`, `INVALID_BRAND` | The body breaks a rule above. Nothing is written.                                        |
| 401    |                                                                                      | No admin identity.                                                                       |
| 403    | `BRAND_FORBIDDEN`                                                                    | The create names a brand you are not a member of.                                        |
| 403    | `CROSS_SITE_WRITE`                                                                   | The browser says the request came from another site.                                     |
| 404    | `NOT_FOUND`                                                                          | The campaign or the placement is unknown, or is in another brand. The two read the same. |

Not built yet (OSE-1552): rename, changing the status after create, linking an event to a campaign,
and one SharedReport across a campaign's events.

## For a public page (ourWKRP's showcase, or any reader)

Read `GET /api/v2/events/:id/sponsor-bundle?surface=public`. Each sponsor in `bundle.sponsors` may
carry:

```json
"campaign": { "id": "cmp_…", "title": "Winter partner series" }
```

- It is there only when that sponsor's placement on this event is **on show**: the event chose to
  have sponsors, the sponsor accepted, the organizer accepted.
- It is there only while the campaign is `active`, and only when the campaign is in the event's own
  brand.
- A sponsor with no campaign has no `campaign` field. It is never `null`.
- `id` and `title` are the whole of it.

To show a station's partner: read the bundle of each upcoming event of the station, and show a
sponsor whose `campaign.id` is the station's campaign. Store nothing; the bundle is the source.

Nothing else in public names a campaign: not the event (`GET /api/v2/events/:id`), not
`/events/:id/sponsors`, not the events list.

## What you cannot do, by design

- **Filter, search or sort by a campaign.** No route reads a campaign parameter, in admin or in
  public. A sponsor is never a filter, and a campaign is a sponsor's banner.
- **Join two brands.** No caller can put a placement in another brand's campaign, the automation
  key included. A sponsor sign-up that names a campaign outside its brand is promoted with none.
- **See a campaign through a placement that is not on show.**

## Reports

The SharedReport's `campaign_summary` (Mid depth) is unchanged in shape. A placement linked to a
campaign outside the event's brand now reports with no campaign.

## Tests

| Layer                | Where                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| T0 structural        | `tests/e2e/0-architecture/campaign-brand-and-consent.invariant.spec.ts`, and `campaigns` in `tenant-isolation.invariant.spec.ts` |
| Workers pool         | `workers/oursharedevents/tests/campaigns.spec.ts`, the brand matrix, `campaign-never-a-filter.spec.ts`                           |
| Staging (Bruno)      | `bruno/ose-api/18. Campaigns (S14)`, fixture `bruno/fixtures/campaigns-seed.sql`                                                 |
| End to end (browser) | None. No page shows a campaign yet.                                                                                              |
