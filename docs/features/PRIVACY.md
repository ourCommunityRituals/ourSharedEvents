# Privacy & PII Lifecycle

> Anonymous ID first. Presence, not identity.
> See [VISION.md](VISION.md) for why this is the foundational design principle.

---

## Core Principle

**The platform captures signal of presence — not personal identity.**

This isn't a privacy policy bolted on after the fact. The database schema itself makes it impossible to store PII in the scan system. There is no column for email, name, or IP address in the `scans` table. The anonymous ID system and the forms system are **completely separate databases** with no cross-linking.

```
FORMS_DB (opt-in personal data)     DB (anonymous presence signal)
───────────────────────────────     ────────────────────────────
Registrations (name, email hash)    Scans (scan_bucket, agent_hash)
Surveys (responses, PII-scrubbed)   Poster deployments (qr_token, lat/lng)
Email signups (encrypted, 30d TTL)  Scan aggregates (counts by hour)
Check-in counts (aggregate only)    Sponsors (click/impression tokens)
                                    Events (the core entity)
    ↓                                   ↓
  Auto-deleted on schedule          Permanent anonymous signal
  Customer opted in voluntarily     No opt-in needed — no PII exists
```

**For customers:** You can scan any QR code knowing no personal data is captured. If you voluntarily fill out a form, your data is hashed or encrypted and auto-deleted.

**For sponsors:** The analytics you see are real aggregate signal, not individual tracking. You know how many people engaged with your placement — not who they are.

---

## The Two Data Systems

### System 1: Anonymous Scan Signal (DB — permanent)

The scan system stores **presence signal only**. By schema design, no PII can enter:

| What's Stored                 | How                         | Purpose                       |
| ----------------------------- | --------------------------- | ----------------------------- |
| `scan_bucket`                 | Hourly time window          | When (approximate)            |
| `user_agent_hash`             | SHA-256 of user agent       | Device class (not individual) |
| _no location_                 | Never read (OSE-1460)       | Place comes only from the poster's corridor; the visitor's IP country is not recorded |
| `poster_deployment_id`        | FK to physical QR placement | Which placement was scanned   |

**What's explicitly excluded:** email, name, IP address, any request-derived location (country, region, city; `CF-IPCountry` is never read since OSE-1460, and migration 0088 cleared what was recorded), exact timestamp, cookies, device fingerprint.

This data is **permanent** — it's safe to keep forever because it contains no personal information. It becomes the foundation for geo-spatial intelligence at scale.

### System 2: Opt-In Form Data (FORMS_DB — temporary)

When a customer **voluntarily** fills out a form, that data enters a separate system with strict lifecycle rules:

---

## PII Handling by Form Type

### Registration

| Data       | Treatment                                                     |
| ---------- | ------------------------------------------------------------- |
| Name       | Stored as plain text (needed for check-in lists)              |
| Email      | SHA-256 hashed immediately — raw email never stored           |
| Timestamp  | Bucketed to the hour (e.g., "2026-03-27T14") — no exact times |
| All fields | Auto-deleted 90 days after event (`expires_at`)               |

### Check-In

| Data  | Treatment                         |
| ----- | --------------------------------- |
| Count | Aggregate integer only — zero PII |

### Survey

| Data      | Treatment                                                |
| --------- | -------------------------------------------------------- |
| Responses | Stored as JSON, then PII-scrubbed by daily lifecycle job |
| Timestamp | Bucketed to the hour                                     |

**Scrub logic (whitelist approach):**

- Numeric values: kept (ratings, scores)
- Safe key names (rating, score, count, stars, venue, etc.): kept
- All other string values: replaced with `[SCRUBBED]`
- Admin only sees scrubbed surveys

### Email Signup

| Data       | Treatment                                                          |
| ---------- | ------------------------------------------------------------------ |
| Email      | SHA-256 hashed (for dedup) + AES-256-GCM encrypted (for retrieval) |
| Timestamp  | Bucketed to the hour                                               |
| All fields | Auto-deleted 30 days after signup (`retention_expires_at`)         |

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
