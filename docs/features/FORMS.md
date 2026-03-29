# Forms System

> 4 form types that power event attendee interaction.
> Each form is mobile-first, accessible via QR code, and privacy-aware.

---

## The 4 Form Types

### 1. Registration (Pre-Event Sign-Up)

**What it does:** Attendees register for an event before it happens.

**User flow:**
1. Scan QR code or click registration link
2. See event name and "Register for this event" heading
3. Enter name (required) and email (optional)
4. Tap "Register" button
5. See confirmation: "You're registered!"

**What's collected:**
| Field | Required | Stored As |
|-------|----------|-----------|
| Name | Yes | Plain text (max 200 chars) |
| Email | No | SHA-256 hash only (never stored raw) |
| Source placement | No | Which QR code / sponsor placement referred them |

**Privacy:** Email is hashed on submission. Registration records auto-delete 90 days after event ends (via scheduled lifecycle job).

**Tier:** Available on Free, Mid, and Enterprise.

---

### 2. Check-In (Door Counter)

**What it does:** A simple tap counter for door-side headcount. No personal data collected.

**User flow:**
1. Event staff opens check-in page on phone/tablet
2. Large circular "Tap to Check In" button fills the screen
3. Each tap increments the counter with haptic-style visual feedback
4. Running count displayed below: "23 checked in"

**What's collected:**
| Field | Required | Stored As |
|-------|----------|-----------|
| Count | Auto | Running integer per event |

**Privacy:** Zero PII. Only an aggregate count is stored.

**Design notes:** Button is 180px diameter, touch-optimized with `touch-action: manipulation` to prevent zoom. Debounce prevents double-taps. Counter survives page reload (server-side count).

**Tier:** Available on Free, Mid, and Enterprise.

---

### 3. Survey (Post-Event Feedback)

**What it does:** Collect event feedback with a 1-5 star rating and optional comments.

**User flow:**
1. Scan QR code or click survey link after event
2. See "How was the event?" heading
3. Tap 1-5 rating buttons (fill progressively like stars)
4. Optionally add free-text comments (max 1000 chars)
5. Tap "Submit Feedback"
6. See confirmation: "Thanks for your feedback!"

**What's collected:**
| Field | Required | Stored As |
|-------|----------|-----------|
| Overall rating | No (but prompted) | Integer 1-5 |
| Comments | No | Free text, then PII-scrubbed by lifecycle job |

**Privacy:** Survey responses are PII-scrubbed by the daily scheduled job. The scrubber uses a whitelist approach: numeric values and safe keys (rating, score, count, etc.) are kept; all other string values become `[SCRUBBED]`. Admin only sees scrubbed surveys.

**Tier:** Mid and Enterprise only. Disabled on Free tier.

---

### 4. Email Signup (Voluntary Opt-In)

**What it does:** Attendees opt in to hear about future events.

**User flow:**
1. Scan QR code or click email signup link
2. See "Stay in the loop" heading with privacy reassurance
3. Enter email address (required)
4. Tap "Sign me up"
5. See confirmation: "You're on the list!" (or "You're already signed up!" for duplicates)

**What's collected:**
| Field | Required | Stored As |
|-------|----------|-----------|
| Email | Yes | SHA-256 hash (for dedup) + AES-256-GCM encrypted (for retrieval) |

**Privacy:** Email is both hashed (for dedup checking) and encrypted (for later retrieval). Encryption uses PBKDF2-derived AES-256-GCM with 100,000 iterations. Encrypted emails auto-delete after 30 days via lifecycle job.

**Tier:** Mid and Enterprise only. Disabled on Free tier.

---

## Form Validation (All Types)

| Check | Rule |
|-------|------|
| Event ID | Alphanumeric, hyphens, underscores. Max 128 chars |
| Request body | Valid JSON, max 16KB |
| Feature flag | Form type must be enabled for this event's tier |
| Name field | Max 200 characters, trimmed |
| Email field | Max 320 characters, trimmed |
| Survey responses | Must be a JSON object |

## Error Responses

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_EVENT_ID` | 400 | Event ID contains invalid characters |
| `INVALID_BODY` | 400 | Request body isn't valid JSON or exceeds 16KB |
| `MISSING_FIELD` | 400 | A required field is missing |
| `FORM_DISABLED` | 403 | This form type isn't enabled for this event |
| `CONFIG_ERROR` | 503 | Encryption key not configured (email signup) |
| `DB_ERROR` | 503 | Database temporarily unavailable |

## Admin Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/v2/admin/events/:id/forms/registrations` | List all registrations (name + email hash, no raw email) |
| `GET /api/v2/admin/events/:id/forms/checkin-count` | Current check-in count |
| `GET /api/v2/admin/events/:id/forms/surveys` | PII-scrubbed survey responses only |
| `GET /api/v2/admin/events/:id/forms/email-signups` | Count only (no email addresses returned) |
