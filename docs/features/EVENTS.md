# Events

> The core entity. Everything in the platform connects to an event.

---

## What Is an Event?

An event is a community gathering — a bocce night, a record-night social, an open-table dinner. Events have:

| Field          | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| **ID**         | Unique identifier (alphanumeric + hyphens)                  |
| **Name**       | Display name ("Spring Bocce Night")                         |
| **Brand**      | Which brand owns it (`root` default, or `abc`, `orn`, etc.) |
| **Start date** | When the event happens (ISO 8601)                           |
| **Venue**      | Where it happens                                            |
| **Status**     | `active` or `archived`                                      |
| **Slug**       | URL-friendly identifier                                     |
| **Data JSON**  | Flexible payload with event-specific details                |

---

## Viewing Events

### Public API — Active Events

```
GET /api/v2/events
GET /api/v2/events?brand=abc
GET /api/v2/events?brand=root&full=true
```

Returns active (non-archived) events for a brand, sorted by date (newest first). The `full=true` param includes all event data fields; without it, only summary fields (name, date, venue) are returned.

**Response:**

```json
{
  "ok": true,
  "items": [
    {
      "id": "bocce-spring-2026",
      "slug": "bocce-spring",
      "name": "Spring Bocce Night",
      "startDateISO": "2026-04-15T18:00:00Z",
      "venue": "Beverly Park",
      "assetState": "complete",
      "createdAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-15T14:30:00Z"
    }
  ]
}
```

**Caching:** `private, max-age=60, stale-while-revalidate=300` — fresh for 1 minute, stale-while-revalidate for 5 minutes.

### Single Event

```
GET /api/v2/events/:id
```

Returns the full event data for a specific event ID.

### Admin API — All Events (Including Archived)

```
GET /api/v2/admin/events
GET /api/v2/admin/events?brand=abc
```

Returns all events including archived. Requires admin authentication. No caching (`no-store`).

---

## Event Data Model (Phase 1)

Events are stored in a Google Sheets `EVENTS` sheet with this column layout:

| Column | Field       | Description                                     |
| ------ | ----------- | ----------------------------------------------- |
| A      | id          | Primary key                                     |
| B      | brand_id    | Multi-tenant isolation key                      |
| C      | template_id | Event template reference                        |
| D      | data_json   | Flexible JSON payload (name, date, venue, etc.) |
| E      | created_at  | Creation timestamp                              |
| F      | slug        | URL-friendly ID                                 |
| G      | updated_at  | Last update timestamp                           |
| H      | status      | `active` or `archived`                          |
| I      | is_default  | Default event for brand                         |
| J      | asset_state | Asset readiness state                           |

In Phase 2 (D1), this moves to a SQL table with identical fields.

---

## Online or in person (`attendance_mode`)

Every event says how people take part (owner, 2026-11-12; migration 0108). The
create API requires the field. Events from before it are `in_person`.

| Value       | Place                      | Where it shows                                                                                                                          |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `in_person` | Needed                     | The map (by its place), `/events`, the landing page, the sitemap.                                                                       |
| `online`    | None: no text, no map cell | By link only. Not on the map, `/events`, the landing page or the sitemap. Its page, its `/q` and `/s` codes and the brand API all work. |
| `both`      | Needed                     | As `in_person`.                                                                                                                         |

- A place is `location`, `where_address`, or `lat` and `lon`.
- The rule runs on create, and on an update that names the mode or the place.
  An update that names neither is not checked, so an older event with no place
  can still be renamed.
- To turn an event online, clear its place in the same request:
  `{"attendance_mode":"online","location":null,"where_address":null}`. The
  server then clears its coordinates and cells.
- The event page shows "In person", "Online" or "Online and in person".
- The public event response carries `attendance_mode`. No meeting link is
  stored or published. Visitors reach one through the event's own `/s` code.
- `place_kind` is a different field: it says how the zoomed map marks a place.

The code is `workers/oursharedevents/src/lib/attendance-mode.ts`.

---

## Triangle Framework

Events are the center of the data model triangle:

```
        Events
       /      \
      /        \
  Sponsors ── Customers
```

- **Events ↔ Sponsors:** Brands support events via placements. Tracked by `source_placement_id` on form submissions.
- **Events ↔ Customers:** Attendees interact via QR forms. Tracked by registrations, check-ins, surveys, emails.
- **Sponsors ↔ Customers:** Sponsor visibility to attendees. Measured via form attribution.

---

## Error Responses

| Code                   | HTTP | Meaning                       |
| ---------------------- | ---- | ----------------------------- |
| `SHEETS_DB_ID_MISSING` | 503  | Spreadsheet ID not configured |
| `SHEETS_READ_FAILED`   | 503  | Google Sheets API error       |
| `NOT_FOUND`            | 404  | Event ID doesn't exist        |
| `INTERNAL_ERROR`       | 500  | Unexpected server error       |
