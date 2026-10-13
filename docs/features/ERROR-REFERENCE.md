# Error Reference

> Every error code in the system and what to do about it.

---

## Error Response Format

All API errors follow a consistent shape:

```json
{
  "ok": false,
  "status": 400,
  "code": "INVALID_EVENT_ID",
  "error": "Invalid event ID format",
  "timestamp": "2026-03-27T14:37:22.891Z"
}
```

Some endpoints also include `requestId` for tracing.

---

## Error Codes by Category

### Authentication Errors

| Code     | HTTP | Meaning           | What to Do                                  |
| -------- | ---- | ----------------- | ------------------------------------------- |
| `UNAUTH` | 401  | Not authenticated | Check Bearer token or Cloudflare Access JWT |

### Input Validation Errors

| Code                    | HTTP | Meaning                                                                        | What to Do                                                |
| ----------------------- | ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `INVALID_EVENT_ID`      | 400  | Event ID has invalid characters                                                | Use only letters, numbers, hyphens, underscores (max 128) |
| `INVALID_BODY`          | 400  | Request body is not valid JSON or exceeds 16KB                                 | Check JSON syntax and body size                           |
| `MISSING_FIELD`         | 400  | A required field is missing                                                    | Check which field the error message specifies             |
| `INVALID_FLAG_KEY`      | 400  | Unknown feature flag key                                                       | Use a valid flag key from the 17 known keys               |
| `INVALID_TIER`          | 400  | Invalid tier name                                                              | Use `free`, `mid`, or `enterprise`                        |
| `SERVER_COMPUTED_FIELD` | 400  | An event create or update named `venue_canonical_id` or `event_correlation_id` | Remove the field: the server computes both                |

### Feature Gating Errors

| Code            | HTTP | Meaning                                      | What to Do                                                             |
| --------------- | ---- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `FORM_DISABLED` | 403  | This form type is not enabled for this event | Check tier — upgrade to Mid or Enterprise for surveys and email signup |

### Data Source Errors

| Code           | HTTP | Meaning                             | What to Do                             |
| -------------- | ---- | ----------------------------------- | -------------------------------------- |
| `DB_ERROR`     | 503  | D1 database temporarily unavailable | Retry after a moment — transient error |
| `CONFIG_ERROR` | 503  | Encryption key not configured       | Set `FORMS_ENCRYPTION_KEY` secret      |
| `NOT_FOUND`    | 404  | Event, resource, or route not found | Check the event ID or URL              |

**Removed error codes (Phase 2 D1 migration):**

| Code (Removed)             | Reason                                               |
| -------------------------- | ---------------------------------------------------- |
| ~~`SHEETS_DB_ID_MISSING`~~ | D1 replaced Google Sheets — no spreadsheet ID needed |
| ~~`SHEETS_READ_FAILED`~~   | D1 replaced Google Sheets — no Sheets API calls      |

### Rate Limiting

| Scenario                           | HTTP | Response                                                                                  |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| Email subscribe rate limit         | 429  | `{ "error": "Too many requests. Please try again later." }` with `Retry-After: 60` header |
| Payload too large (subscribe)      | 413  | `{ "error": "Payload too large." }`                                                       |
| Missing Content-Length (subscribe) | 411  | `{ "error": "Content-Length required." }`                                                 |

### Server Errors

| Code             | HTTP | Meaning                 | What to Do                                       |
| ---------------- | ---- | ----------------------- | ------------------------------------------------ |
| `INTERNAL_ERROR` | 500  | Unexpected server error | Report with the request ID from response headers |

---

## Health Check

```
GET /health
GET /api/status
```

Returns system health including D1 connectivity:

```json
{
  "ok": true,
  "env": "staging",
  "version": "stg-2026.03.22",
  "d1": "ok",
  "timestamp": "2026-03-27T14:37:22.891Z"
}
```

| `d1` value | Meaning                                   |
| ---------- | ----------------------------------------- |
| `ok`       | D1 database is reachable and responding   |
| `error`    | D1 query failed — check migrations/config |

---

## Troubleshooting Quick Reference

| Symptom                                   | Check                                                   |
| ----------------------------------------- | ------------------------------------------------------- |
| All admin routes return 401               | Is `ALLOW_ADMIN_KEY_FALLBACK=true`? Is `ADMIN_KEY` set? |
| Form submission returns 403               | Is this form type enabled for the event's tier?         |
| Events page shows "Could not load events" | Check D1 connectivity via `/health` — is `d1: "ok"`?    |
| Email signup returns 503 CONFIG_ERROR     | Is `FORMS_ENCRYPTION_KEY` set?                          |
| Survey admin shows no results             | Surveys only show after PII scrub job runs (daily)      |
| Duplicate email signup returns success    | By design — returns `{ "duplicate": true }` for privacy |
