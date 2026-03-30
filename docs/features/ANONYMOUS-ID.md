# Anonymous ID — Presence, Not Identity

> Pillar 2: The zero-PII contract that makes the platform safe to scale.
> This is the standalone design document for the Anonymous ID system.

---

## The Design Decision

Most event platforms collect personal data first and worry about privacy later. ourSharedEvents does the opposite: the database schema itself makes it **impossible** to store PII in the scan system. There is no column for email, name, or IP address. This isn't a policy. It's architecture.

```
┌─────────────────────────────────────────────────────────────────┐
│                    The Anonymous ID Contract                     │
│                                                                 │
│  "Your presence is counted. Your identity is not."              │
│                                                                 │
│  - No email in the scan system                                  │
│  - No name in the scan system                                   │
│  - No IP address in the scan system                             │
│  - No exact timestamps (hourly buckets only)                    │
│  - No cross-event individual tracking                           │
│  - No behavioral profiles                                       │
│                                                                 │
│  This is enforced by schema, not by policy.                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why This Matters

### For Customers (Attendees)

You can scan any QR code at any event knowing no personal data is captured. If you voluntarily fill out a form (registration, survey, email signup), that data enters a **separate, temporary** system with strict lifecycle rules:

- Email → hashed immediately, never stored raw
- Registration → auto-deleted 90 days after event
- Survey comments → PII-scrubbed by daily job
- Email signup → encrypted, auto-deleted after 30 days

The scan system and the forms system are **completely separate databases with no cross-linking**.

### For Sponsors

The analytics you receive are honest. Aggregate signal — how many people engaged with your placement, when during the event, from what region. Not inflated by bots, not enriched with purchased data, not tracking individuals across events. Real presence at real events.

### For the Platform

By removing PII from the data layer by design, the platform can scale across thousands of events without becoming a surveillance system. The data becomes **more valuable** over time (NCR geo-spatial intelligence) precisely because it's safe to keep forever.

---

## Two-Database Architecture

The most critical design decision: **two separate D1 databases with no cross-linking**.

```
FORMS_DB (opt-in personal data)          DB (anonymous presence signal)
───────────────────────────────          ──────────────────────────────
form_registrations                       scans
  name          (plain text)               scan_bucket      (hourly window)
  email_hash    (SHA-256)                  user_agent_hash  (device class)
  expires_at    (90-day TTL)               country_code     (from CF headers)
                                           region_code      (from CF headers)
form_surveys                               poster_deployment_id (FK)
  responses_json (scrubbed)
  pii_scrubbed   (boolean)              scan_aggregates
                                           bucket_date     (daily rollup)
email_signups                              bucket_hour     (hourly rollup)
  email_hash      (SHA-256 dedup)          total_scans     (count)
  encrypted_email (AES-256-GCM)            unique_agents   (count)
  retention_expires_at (30-day TTL)
                                         poster_deployments
checkin_counts                             qr_token        (unique)
  count (aggregate integer only)           latitude        (placement)
                                           longitude       (placement)

  ↓ AUTO-DELETED on schedule               ↓ PERMANENT — no PII exists
  ↓ Customer opted in voluntarily          ↓ No opt-in needed
```

**Why two databases?** If they were one database, a JOIN could correlate form submissions with scan data, creating a de-anonymization path. Separate databases make this architecturally impossible.

---

## Schema-Level Privacy (DB — Scan System)

### `scans` table

```sql
CREATE TABLE IF NOT EXISTS scans (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL,
  poster_deployment_id  TEXT NOT NULL,
  scan_bucket           TEXT NOT NULL,        -- hourly window, not exact time
  user_agent_hash       TEXT,                 -- device class, not individual
  referrer_domain       TEXT,
  country_code          TEXT,                 -- from CF headers, not IP
  region_code           TEXT,                 -- from CF headers, not IP
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**What's explicitly excluded:** email, name, IP address, exact timestamp, cookies, device fingerprint, any column that could identify an individual.

### `poster_deployments` table

```sql
CREATE TABLE IF NOT EXISTS poster_deployments (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  qr_token        TEXT NOT NULL UNIQUE,
  placement_label TEXT,
  location_desc   TEXT,
  latitude        REAL,
  longitude       REAL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This table stores **where QR codes are placed** — not who scanned them. The lat/lng data enables NCR geo-spatial intelligence without any PII.

### `scan_aggregates` table

```sql
CREATE TABLE IF NOT EXISTS scan_aggregates (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  bucket_date     TEXT NOT NULL,
  bucket_hour     INTEGER,
  total_scans     INTEGER NOT NULL DEFAULT 0,
  unique_agents   INTEGER NOT NULL DEFAULT 0,
  top_country     TEXT,
  top_region      TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Pre-computed rollups. Written by scheduled Worker only, never by user-facing endpoints. Dashboard performance without query-time aggregation.

---

## Privacy Enforcement Layers

The Anonymous ID contract is enforced at multiple layers — not just one:

### Layer 1: Schema (database structure)

No PII columns exist in the scan system tables. You cannot `INSERT` an email into the `scans` table because there's no column for it.

### Layer 2: Hashing (form submissions)

Emails are SHA-256 hashed before storage. The raw email never touches the database.

```typescript
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### Layer 3: Encryption (email signups)

Email signups are double-protected: hashed for dedup AND AES-256-GCM encrypted for retrieval.

- **Algorithm:** AES-256-GCM via Web Crypto API
- **Key derivation:** PBKDF2, 100,000 iterations, SHA-256
- **Salt:** `oursharedevents-forms-v1`
- **IV:** 12 bytes, cryptographically random per encryption
- **Storage:** Base64 of (IV + ciphertext)

If the `FORMS_ENCRYPTION_KEY` is rotated, previously encrypted emails cannot be decrypted. This is a feature, not a bug — it's a hard TTL enforcement.

### Layer 4: Time Bucketing

All timestamps in the forms system are truncated to the nearest hour:

```typescript
export function bucketTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13); // "2026-03-27T14"
}
```

This prevents correlating exact submission times with individuals.

### Layer 5: Whitelist Scrubbing (surveys)

Survey responses are PII-scrubbed using a whitelist approach. Only known-safe values survive:

- **Kept:** Numeric values (ratings, scores, counts)
- **Kept:** Values under safe key names (`rating`, `score`, `count`, `stars`, `venue`, `speaker`, etc.)
- **Scrubbed:** All other string values → `[SCRUBBED]`

```typescript
const SAFE_KEY_PATTERNS = /^(rating|score|count|number|rank|order|id|uuid|type|
  category|topic|session|duration|index|overall|venue|speaker|event|quality|
  value|level|tier|scale|stars?|thumbs?).*$/i;
```

### Layer 6: TTL Deletion (scheduled lifecycle)

A daily cron job runs three independent cleanup phases:

| Phase | Target | TTL | SQL |
|-------|--------|-----|-----|
| 1 | Registrations | 90 days after event | `DELETE WHERE expires_at < now()` |
| 2 | Survey PII | Immediate (next cron run) | `UPDATE SET pii_scrubbed = 1` |
| 3 | Email signups | 30 days after signup | `DELETE WHERE retention_expires_at < now()` |

Each phase runs independently. Failure in one does not block others.

### Layer 7: Database Separation

FORMS_DB and DB are separate D1 databases. No foreign keys cross the boundary. No JOINs possible. Architecturally impossible to correlate opt-in form data with anonymous scan data.

---

## What Each Audience Sees

| Data Point | Customer Sees | Sponsor Sees | Admin Sees |
|-----------|--------------|-------------|-----------|
| Scan count | — | Aggregate total | Aggregate total |
| Scan time | — | Hourly buckets | Hourly buckets |
| Scan location | — | Poster placement | Poster placement + lat/lng |
| Registration name | Own submission | — | Plain text (90-day TTL) |
| Registration email | Own submission | — | Hash only (never raw) |
| Survey rating | Own submission | Aggregate | Scrubbed responses |
| Email address | Own submission | — | Count only (never raw) |
| Check-in count | — | Aggregate total | Aggregate total |

---

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| **Database breach of scan system** | No PII to leak — schema has no PII columns |
| **Database breach of forms system** | Emails hashed/encrypted, surveys scrubbed, TTL-deleted |
| **Cross-database correlation** | Separate D1 databases, no foreign keys between them |
| **Timing correlation** | Hour-bucketed timestamps prevent exact-time matching |
| **Device fingerprinting** | Only `user_agent_hash` stored — device class, not individual |
| **IP logging** | IP never stored; country/region derived from CF headers at request time |
| **Encryption key compromise** | Email signups TTL-deleted after 30 days regardless |
| **Admin data access** | Admin APIs return hashes, counts, and scrubbed data — never raw PII |

---

## The Compound Effect

The Anonymous ID architecture creates a dataset that becomes **more valuable** over time:

1. **Safe to keep forever** — no PII means no retention liability
2. **Safe to aggregate** — cross-event analysis doesn't create surveillance
3. **Safe to share** — sponsor reports contain aggregate signal, not individual data
4. **Foundation for NCR** — geo-spatial intelligence from lat/lng + scan aggregates

This is the design decision that makes Pillar 5 (NCR Methodology) possible. Without anonymous ID, accumulated scan data would be a privacy liability. With it, the data becomes community intelligence.

---

## Cross-References

- [PLATFORM-FLOW.md](PLATFORM-FLOW.md) — Pillar 1: End-to-end event lifecycle
- [PRIVACY.md](PRIVACY.md) — Technical PII handling, encryption details, lifecycle job
- [NCR-METHODOLOGY.md](NCR-METHODOLOGY.md) — Pillar 5: What anonymous data enables at scale
- [FORMS.md](FORMS.md) — The 4 form types and their PII treatment
- [UEC-CODES.md](UEC-CODES.md) — Pillar 4: QR codes that generate the scan data
