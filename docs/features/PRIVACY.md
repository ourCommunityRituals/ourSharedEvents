# Privacy & PII Lifecycle

> Anonymous ID first. Presence, not identity.
> See [VISION.md](VISION.md) for why this is the foundational design principle.

---

## Core Principle

**The platform captures signal of presence — not personal identity.**

This isn't a privacy policy bolted on after the fact. The database schema itself makes it impossible to store PII in the scan system. There is no column for email, name, or IP address in either scan table (`scan_placement_events` / `scan_node_returns` — the combined `scans` table was split and dropped in migration 0062). The anonymous ID system and the forms system are **completely separate databases** with no cross-linking.

```
FORMS_DB (opt-in personal data)     DB (anonymous presence signal)
───────────────────────────────     ────────────────────────────
Registrations (name, email hash)    Scan placement events (WHERE)
Surveys (responses, PII-scrubbed)   Scan node returns (WHO)
Email signups (encrypted, 30d TTL)  Poster deployments (qr_token, lat/lng)
Check-in counts (aggregate only)    Scan aggregates (counts by hour)
                                    Sponsors (click/impression tokens)
                                    Events (the core entity)
    ↓                                   ↓
  Auto-deleted on schedule          Retained indefinitely (historical record)
  Customer opted in voluntarily     No opt-in needed — no PII exists
```

**For customers:** You can scan any QR code knowing no personal data is captured. If you voluntarily fill out a form, your data is hashed or encrypted and auto-deleted.

**For sponsors:** The analytics you see are real aggregate signal, not individual tracking. You know how many people engaged with your placement — not who they are.

### Sponsor signal is filtered, but the filter keeps nothing (OSE-1310)

Sponsor impression/click beacons pass through an invalid-traffic filter before a
row is written, so a crawler, a replayed beacon, or a flood does not become a
number a sponsor is shown. That filter necessarily _looks at_ visitor-derived
signals — the client IP, the `User-Agent`, and Cloudflare's bot score.

It retains none of them. Every one of those inputs is read, reduced to a
yes/no answer, and dropped inside the request:

- **Nothing identifying is written to D1.** `sponsor_impressions` still carries
  zero attendee-identifying columns; the table shape is unchanged and enforced
  against the live schema by `tests/red-team/impression-privacy.spec.ts`.
- **Nothing identifying is written to KV.** Dedup and cadence buckets are stored
  as SHA-256 keys with a TTL of minutes — opaque, un-enumerable, and
  self-deleting. This is the same primitive `lib/rate-limit.ts` already hashes
  its buckets with, for the same reason.

The distinction that matters: the filter answers _"is this seeing real?"_ and
never _"who is seeing?"_ — an anti-fraud control, not a tracker. See
`workers/oursharedevents/src/lib/invalid-traffic.ts`.

---

## The Two Data Systems

### System 1: Anonymous Scan Signal (DB)

The scan system stores **presence signal only**. By schema design, no directly
identifying PII can enter. Since OSE-798 a single scan is written as **two rows
in two tables**, deliberately split so that no durable row carries both a
placement and a session-derived value:

**`scan_placement_events` — the WHERE (permanent)**

| What's Stored          | How                         | Purpose                     |
| ---------------------- | --------------------------- | --------------------------- |
| `scan_bucket`          | Hourly time window          | When (approximate)          |
| `poster_deployment_id` | FK to physical QR placement | Which placement was scanned |

This side is **permanent and safe to keep forever** — it contains nothing
derived from the visitor at all. It is the count of record: the scan gauge and
the "this event met reality" delete guard both read it.

**`scan_node_returns` — the WHO (retained indefinitely)**

| What's Stored     | How                        | Purpose                       |
| ----------------- | -------------------------- | ----------------------------- |
| `scan_bucket`     | Hourly time window         | When (approximate)            |
| `anonymous_id`    | From the `ose_anon` cookie | Distinct-visitor counting     |
| `user_agent_hash` | SHA-256 of user agent      | Device class (not individual) |
| `country_code`    | From CF headers            | Where (approximate)           |

**What's explicitly excluded:** email, name, IP address, exact timestamp, device
fingerprint.

Be precise about `anonymous_id`: it is **not** PII, but it **is** a pseudonymous
identifier read from a cookie, and it is the one value on the platform that
could link a visitor's scans across events.

**Scan data is retained indefinitely, by design.** Scans are part of an event's
permanent historical record — the basis for longitudinal and geo-spatial
intelligence — so unlike opt-in form data (bounded lifecycle) and subscribers
(365 days), scan signal has no expiry. That is a deliberate product ruling, not
an oversight.

What bounds it instead is **erasure on request** (OSE-1350): a visitor who ever
linked an email via a form can have their scan rows purged by that email.

Two deletion mechanisms exist in the codebase and are wired into the cron, but
both ship **off** and are not active: prune-raw (OSE-1091) and an age-based
retention window (OSE-1351). They are kept available for a deployment that ever
needs bounded raw retention — a stricter regulatory tier, a customer contract —
not because the default is expected to change.

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
