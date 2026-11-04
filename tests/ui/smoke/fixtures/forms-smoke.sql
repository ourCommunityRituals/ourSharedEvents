-- Forms fixture (FORMS_DB) for the smoke tiers — one registration, one check-in,
-- one survey (Part of OSE-834).
--
-- Apply against FORMS_DB (the identified-user DB — separate from DB, ADR-001):
--   cd workers/oursharedevents
--   npx wrangler d1 execute FORMS_DB --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/forms-smoke.sql
--
-- WHY THIS EXISTS
-- OSE-834: the seeded environment carried zero forms data, so any tier asserting a
-- registration / check-in / survey exists skipped as "absent" rather than verified.
-- This seeds exactly one of each, on the dedicated evt_smoke_tiers event (past
-- event, so attendee actions are natural and it never collides with a page-smoke).
--
-- TWO-DB ISOLATION (ADR-001): these tables live ONLY in FORMS_DB; there is no FK to
-- events (that lives in DB). event_id is a plain string reference across the seam.
-- Privacy: no raw PII — email is a hash placeholder, survey responses carry no
-- identity, pii_scrubbed=1. Buckets are coarse (month) so nothing rots or de-anons.
-- Idempotent: INSERT OR IGNORE keyed by stable ids / UNIQUE(event_id).

-- One registration (form_registrations). registration_bucket + consent_type are
-- NOT NULL; consent_type defaults to 'explicit'. attendee_email_hash is a SHA-256
-- placeholder, never a raw email.
INSERT OR IGNORE INTO form_registrations
  (id, event_id, attendee_name, attendee_email_hash, registration_bucket, status)
VALUES
  ('reg_smoke_tiers_1', 'evt_smoke_tiers', 'Smoke Attendee',
   '0000000000000000000000000000000000000000000000000000000000000000',
   strftime('%Y-%m', 'now'), 'confirmed');

-- One check-in (checkin_counts — aggregate count, zero PII, UNIQUE per event).
INSERT OR IGNORE INTO checkin_counts
  (id, event_id, total_count)
VALUES
  ('chk_smoke_tiers', 'evt_smoke_tiers', 7);

-- One survey response (form_surveys). responses_json + submitted_bucket are NOT
-- NULL; pii_scrubbed=1 marks it safe to read (no identity in the response body).
INSERT OR IGNORE INTO form_surveys
  (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
VALUES
  ('srv_smoke_tiers_1', 'evt_smoke_tiers',
   '{"q_enjoyment":5,"q_return":"yes"}', strftime('%Y-%m', 'now'), 1);

-- OSE-1752: put the recap's walk-in line in the case that used to leak. 7 check-ins
-- with 5 walked in: 5 clears the floor, but the 2 who registered and came do not, so
-- the nested floor withholds the walk-in count. That line must read exactly like one
-- under 5 ("Fewer than 5 Walked in"). INSERT OR IGNORE above keeps an older row as it
-- was, so the count is set here, only while none has been recorded.
UPDATE checkin_counts SET walk_in_count = 5
 WHERE id = 'chk_smoke_tiers' AND walk_in_count = 0;

-- OSE-682: evt_smoke_tiers is the T4f depth-gate event, and T4f asserts the PAID
-- depths on it (premium for an admin link, mid for a Mid sponsor link). Since a
-- plan without the paid report caps every viewer at Local, and staging's global
-- plan is whatever the owner set (often Free), this event carries its own
-- paid-report override so T4f holds on any plan. The Free cap itself is asserted
-- on a separate event (bruno/fixtures/report-plan-cap-seed.sql, plancap-evt).
-- Idempotent upsert on UNIQUE(scope, scope_id, flag_key).
INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
VALUES ('evt_smoke_tiers-analytics-shared-report', 'event', 'evt_smoke_tiers', 'analytics.shared-report', 1, datetime('now'))
ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at;
