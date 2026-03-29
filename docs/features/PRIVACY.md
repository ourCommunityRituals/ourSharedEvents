# Privacy & PII Lifecycle

> How ourSharedEvents protects personal data at every layer.

---

## Core Principle

**Never store what you don't need. Delete what you have when you're done with it.**

The forms system (FORMS_DB) is completely separate from the anonymous scan system (DB). No cross-linking.

---

## PII Handling by Form Type

### Registration
| Data | Treatment |
|------|-----------|
| Name | Stored as plain text (needed for check-in lists) |
| Email | SHA-256 hashed immediately — raw email never stored |
| Timestamp | Bucketed to the hour (e.g., "2026-03-27T14") — no exact times |
| All fields | Auto-deleted 90 days after event (`expires_at`) |

### Check-In
| Data | Treatment |
|------|-----------|
| Count | Aggregate integer only — zero PII |

### Survey
| Data | Treatment |
|------|-----------|
| Responses | Stored as JSON, then PII-scrubbed by daily lifecycle job |
| Timestamp | Bucketed to the hour |

**Scrub logic (whitelist approach):**
- Numeric values: kept (ratings, scores)
- Safe key names (rating, score, count, stars, venue, etc.): kept
- All other string values: replaced with `[SCRUBBED]`
- Admin only sees scrubbed surveys

### Email Signup
| Data | Treatment |
|------|-----------|
| Email | SHA-256 hashed (for dedup) + AES-256-GCM encrypted (for retrieval) |
| Timestamp | Bucketed to the hour |
| All fields | Auto-deleted 30 days after signup (`retention_expires_at`) |

---

## Encryption Details

**Algorithm:** AES-256-GCM via Web Crypto API

**Key derivation:** PBKDF2 with:
- 100,000 iterations
- SHA-256 hash
- Static salt: `oursharedevents-forms-v1`
- Source: `FORMS_ENCRYPTION_KEY` environment secret

**Storage format:** Base64 of (12-byte IV + ciphertext)

**Decryption:** Only possible with the `FORMS_ENCRYPTION_KEY` secret. If the key is rotated, previously encrypted emails cannot be decrypted.

---

## Scheduled Lifecycle Job

A Cloudflare Worker cron trigger runs daily and executes 3 independent phases:

### Phase 1: Delete Expired Registrations
```sql
DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?
```
TTL: 90 days from submission.

### Phase 2: Scrub Survey PII
```sql
SELECT id, responses_json FROM form_surveys WHERE pii_scrubbed = 0 AND created_at < ?
UPDATE form_surveys SET responses_json = ?, pii_scrubbed = 1 WHERE id = ?
```
Runs on all unscrubbed surveys older than the current timestamp.

### Phase 3: Delete Expired Email Signups
```sql
DELETE FROM email_signups WHERE retention_expires_at < ?
```
TTL: 30 days from signup.

**Fault tolerance:** Each phase runs independently. A failure in Phase 1 does not prevent Phases 2 and 3 from running. All results are logged as `LIFECYCLE_COMPLETE` events.

---

## Time Bucketing

All timestamps in the forms system are bucketed to the nearest hour:

```
Actual time:  2026-03-27T14:37:22.891Z
Stored as:    2026-03-27T14
```

This prevents correlating exact submission times with individuals.

---

## Observability

Every form event is logged as structured JSON:

```json
{
  "type": "FORM_EVENT",
  "formType": "register",
  "eventId": "bocce-spring-2026",
  "action": "submit",
  "timestamp": "2026-03-27T14:37:22.891Z",
  "id": "uuid",
  "latencyMs": 45
}
```

Lifecycle job results are logged as:

```json
{
  "type": "LIFECYCLE_COMPLETE",
  "registrationsDeleted": 12,
  "surveysScrubbed": 8,
  "emailSignupsDeleted": 3,
  "timestamp": "2026-03-28T00:00:00.000Z"
}
```
