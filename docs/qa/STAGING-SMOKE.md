# Staging Smoke Checklist — ourSharedEvents

> **Purpose:** Full surface-by-surface sign-off before tagging v1.0.0.
> Run against `stg.oursharedevents.com` after every significant merge batch.
>
> **Updated:** 2026-05-09 — reflects 27 migrations, event state machine, CF Access, AES-GCM PII, rate limiter, WIF/BigQuery, all 9 surfaces.
>
> **Pre-requisite:** `INFRA-CHECKLIST.md` Phase B complete (secrets set, migrations applied, worker deployed).

```bash
# Set once for the session
STG=https://stg.oursharedevents.com
TOK=<your-ADMIN_TOKEN>
```

---

## 0. Baseline — Worker + D1

```bash
# 0.1 Health endpoint
curl -s $STG/health | jq .
```

- [ ] `ok: true`
- [ ] `env: "staging"`
- [ ] `d1: "ok"` (both DB bindings reachable)
- [ ] `version` field present

```bash
# 0.2 All 27 migrations applied
wrangler d1 execute DB --env staging --remote \
  --command "SELECT COUNT(*) as migration_count FROM _cf_KV WHERE key LIKE 'd1-migrations%';"
# OR check for required tables:
wrangler d1 execute DB --env staging --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

- [ ] `admin_audit_log` table exists (migration 0026)
- [ ] `event_type_registry` table exists (migration 0023/0024)
- [ ] `events.status` column supports `draft/ready/active/archived` (migration 0025)
- [ ] `events.qr_verified` column exists (migration 0027)

---

## 1. Public Surface — `/`

```bash
# 1.1 HTTP 200
curl -s -o /dev/null -w "%{http_code}" $STG/
```

- [ ] `200`

```bash
# 1.2 HTML response with correct structure
curl -s $STG/ | grep -E "data-testid|skip-link|OurSharedEvents"
```

- [ ] `data-testid="public-header"` present
- [ ] `class="skip-link"` present (A11Y)
- [ ] `lang="en"` on `<html>` tag

**Browser checks:**

- [ ] Events list loads (or "No events scheduled" — not an error)
- [ ] Sponsor banner visible if sponsors seeded
- [ ] Mobile layout correct at 375px viewport
- [ ] No JS console errors

---

## 2. Admin Surface — `/admin`

```bash
# 2.1 Unauthenticated → 401
curl -s -o /dev/null -w "%{http_code}" $STG/admin
```

- [ ] `401`

```bash
# 2.2 Bearer token (staging fallback) → 200
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOK" $STG/admin
```

- [ ] `200`

**Browser checks (load `/admin` with bearer token or CF Access):**

- [ ] Tier badge renders (Free / Mid / Enterprise)
- [ ] Skeleton loaders appear then resolve (ADMIN-13)
- [ ] Create Event form visible
- [ ] Events table loads with clickable rows
- [ ] Surface cards visible: Poster, Display, Public, SharedReport
- [ ] Copy button shows "Copied!" on click and resets after 2s (ADMIN-15)
- [ ] Sponsor management card visible (SPON-6)
- [ ] Feature-flag locked cards show upgrade message (survey, email-signup on Free tier)
- [ ] Mobile layout correct at 600px breakpoint

```bash
# 2.3 Admin audit log endpoint (auth required)
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOK" $STG/api/v2/admin/audit-log
```

- [ ] `200` (empty log is fine, must not be 404/500)

---

## 3. Display Surface — `/display`

```bash
curl -s -o /dev/null -w "%{http_code}" $STG/display
```

- [ ] `200`

**Browser checks:**

- [ ] Skip link visible on focus (DESIGN-15 — display gap closed)
- [ ] Clock ticking in header
- [ ] `data-testid="display-header"` present (A11Y)
- [ ] Sponsor sidebar and banner render if sponsors seeded
- [ ] Featured event card OR "No events scheduled" — not a JS error
- [ ] TV breakpoint (1920px) does not break layout

---

## 4. Poster Surface — `/poster`

```bash
curl -s -o /dev/null -w "%{http_code}" $STG/poster
```

- [ ] `200`

**Browser checks:**

- [ ] QR codes are rendered as actual PNG images (DESIGN-9 — server-side generation, not placeholder text)
- [ ] 6-tier sponsor CSS renders correctly (OSE-219) — sponsor div has correct tier class
- [ ] Print stylesheet: `@media print` hides action bar
- [ ] Skip link present
- [ ] `data-testid="poster-*"` count ≥ 30 (AS-2 — DESIGN-3 target met)

---

## 5. SharedReport Surface — `/sharedReport`

```bash
curl -s -o /dev/null -w "%{http_code}" $STG/sharedReport
```

- [ ] `200`

**Browser checks (load with bearer token if required):**

- [ ] JSON export button visible (SR-13, Free+)
- [ ] Conversion funnel section visible (SR-17, Mid+ gated — shows upgrade if Free)
- [ ] PDF export button visible (SR-18, Mid+ gated)
- [ ] Skip link present
- [ ] aria-labelledby on table (A11Y-3)
- [ ] `scope="col"` on table headers

```bash
# 5.1 JSON export endpoint
curl -s $STG/api/v2/report/export?format=json \
  -H "Authorization: Bearer $TOK" | jq '.ok'
```

- [ ] `true`

---

## 6. Forms Surface — `/forms/:id`

```bash
# 6.1 Register form (requires a real event ID in D1)
# First get an event ID:
EVENT_ID=$(curl -s $STG/api/v2/events | jq -r '.items[0].id')
echo "Testing with event: $EVENT_ID"

curl -s -o /dev/null -w "%{http_code}" "$STG/forms/$EVENT_ID?type=register&event=Test"
```

- [ ] `200`

**Browser checks:**

- [ ] GDPR privacy notice visible above form (BE-9)
- [ ] Privacy policy link present (BE-10)
- [ ] `role="alert"` error messages on invalid submit (A11Y-2)
- [ ] `autocomplete` attributes on name/email fields
- [ ] `aria-required="true"` on required fields
- [ ] Sponsor logo strip in header (SPON-UX — if seeded)

```bash
# 6.2 Rate limiter — 61 rapid requests should hit 429
# (Only run this test deliberately — it fires real rate limit)
for i in $(seq 1 5); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST "$STG/forms/$EVENT_ID" -d "type=register"
done
```

- [ ] A burst of more than 60 form POSTs in 10 s to one event from the same IP → `429 Too Many Requests` within 3 s, `Retry-After: 10` (BE-11, OSE-1509); 5 a second is never refused

```bash
# 6.3 Public mutation guard — POST to non-form endpoint blocked
curl -s -o /dev/null -w "%{http_code}" -X POST $STG/api/v2/events
```

- [ ] `405 Method Not Allowed` (SEC-7)

---

## 7. Privacy Surface — `/privacy`

```bash
curl -s -o /dev/null -w "%{http_code}" $STG/privacy
```

- [ ] `200`

**Browser checks:**

- [ ] GDPR Art. 13 disclosures present (data controller, purpose, retention period)
- [ ] CCPA rights section present
- [ ] "Right to erasure" (Art. 17) section present

---

## 8. Briefing Surface — `/briefing`

```bash
curl -s -o /dev/null -w "%{http_code}" $STG/briefing
```

- [ ] `200`

---

## 9. API Endpoints

### Events API

```bash
# 9.1 List events
curl -s $STG/api/v2/events | jq '{ok, count: (.items | length)}'
```

- [ ] `ok: true`
- [ ] Response envelope: `{ ok, items: [...] }`

```bash
# 9.2 Create event (admin — tests state machine entry point)
curl -s -X POST $STG/api/v2/admin/events \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Event","startDateISO":"2026-12-01T18:00:00Z","venue":"Test Hall"}' | jq .
```

- [ ] `ok: true`
- [ ] New event has `status: "draft"` (state machine: entry state)

```bash
# Save the new event ID
SMOKE_ID=$(curl -s -X POST $STG/api/v2/admin/events \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke2","startDateISO":"2026-12-01T18:00:00Z"}' | jq -r '.event.id')
```

### Event State Machine

```bash
# 9.3 DRAFT → READY transition
curl -s -X POST "$STG/api/v2/admin/events/$SMOKE_ID/ready" \
  -H "Authorization: Bearer $TOK" | jq '.event.status'
```

- [ ] `"ready"`

```bash
# 9.4 READY → ACTIVE via QR verify
curl -s -X POST "$STG/api/v2/admin/events/$SMOKE_ID/verify-qr" \
  -H "Authorization: Bearer $TOK" | jq '{status: .event.status, qrVerified: .event.qrVerified}'
```

- [ ] `status: "active"`
- [ ] `qrVerified: true`

```bash
# 9.5 ACTIVE → READY via QR unverify
curl -s -X POST "$STG/api/v2/admin/events/$SMOKE_ID/unverify-qr" \
  -H "Authorization: Bearer $TOK" | jq '.event.status'
```

- [ ] `"ready"`

```bash
# 9.6 Invalid transition → 409
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$STG/api/v2/admin/events/$SMOKE_ID/verify-qr" \
  -H "Authorization: Bearer $TOK"
# (event is in 'ready' state — verify-qr from ready should 409 or succeed based on impl)
```

### Security

```bash
# 9.7 Audit log populated after admin actions
curl -s "$STG/api/v2/admin/audit-log" \
  -H "Authorization: Bearer $TOK" | jq '.items | length'
```

- [ ] Count > 0 (actions from steps 9.2–9.5 should be logged)

```bash
# 9.8 Unknown route
curl -s -o /dev/null -w "%{http_code}" $STG/does-not-exist
```

- [ ] `404` (worker 404, not Cloudflare 1xxx error page)

---

## 10. Feature Flag Tiers

Test flag gating by checking what's visible vs locked in `/admin` at each tier.

| Flag                 | Free   | Mid    | Enterprise | Verified? |
| -------------------- | ------ | ------ | ---------- | --------- |
| forms.register       | ON     | ON     | ON         | [ ]       |
| forms.checkin        | ON     | ON     | ON         | [ ]       |
| forms.survey         | locked | ON     | ON         | [ ]       |
| forms.email-signup   | locked | ON     | ON         | [ ]       |
| config.self-serve    | locked | ON     | ON         | [ ]       |
| assets.file-upload   | locked | locked | ON         | [ ]       |
| branding.white-label | locked | locked | ON         | [ ]       |

```bash
# Confirm 22-flag seed parity (QA-6 CI gate)
curl -s $STG/api/v2/admin/flags \
  -H "Authorization: Bearer $TOK" | jq '.flags | length'
```

- [ ] `22` (17 payment + 5 regulatory)

---

## 11. A11Y Spot Checks

- [ ] Skip link on Public: tab from address bar → "Skip to content" visible
- [ ] Skip link on Admin: same
- [ ] Skip link on Display: same (DESIGN-15 — was missing, now present)
- [ ] Skip link on Poster: same
- [ ] axe-core CI: S0 security run shows no WCAG 2.0 AA violations

---

## Sign-Off

| Section                 | Passed | Notes |
| ----------------------- | ------ | ----- |
| 0. Baseline / D1        | [ ]    |       |
| 1. Public               | [ ]    |       |
| 2. Admin                | [ ]    |       |
| 3. Display              | [ ]    |       |
| 4. Poster               | [ ]    |       |
| 5. SharedReport         | [ ]    |       |
| 6. Forms + Rate Limiter | [ ]    |       |
| 7. Privacy              | [ ]    |       |
| 8. Briefing             | [ ]    |       |
| 9. API + State Machine  | [ ]    |       |
| 10. Feature Flags       | [ ]    |       |
| 11. A11Y                | [ ]    |       |

**All sections checked → staging is signed off → OSE-15 (v1.0.0 production launch) is unblocked.**

Date signed off: ****\_\_\_****
Signed off by: ****\_\_\_****
