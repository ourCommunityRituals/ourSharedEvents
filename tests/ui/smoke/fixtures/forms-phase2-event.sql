-- Synthetic Phase-2 event fixture for the survey/email-signup form E2E (OSE-1004).
--
-- Apply (per-env, like tests/ui/smoke/fixtures/sponsored-event.sql):
--   cd workers/oursharedevents
--   npx wrangler d1 execute ocr-db-staging --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/forms-phase2-event.sql
--
-- WHY THIS EXISTS
-- survey + email-signup collect MORE PII than register/checkin (free-text
-- comments; consent-based email), so the router gates their SUBMISSION behind
-- legal_clearance_tier >= 2 (router.ts FORM_PHASE_REQUIREMENTS = {survey:2,
-- 'email-signup':2}). test-event-001 is Phase 1, so POSTing survey/email there
-- correctly returns 403 PHASE_REQUIRED — the compliance gate working as designed,
-- NOT a bug. The survey/email submission E2E therefore can never pass against a
-- Phase-1 event.
--
-- This seeds ONE dedicated event at legal_clearance_tier = 2 so the survey/email
-- submission E2E exercises the real code path (a 201, the success state) against
-- a correctly-cleared event. The survey/email specs target it via
-- PHASE2_EVENT_ID=evt_forms_phase2. register/checkin E2E stay on the Phase-1
-- test-event-001, and a phase-gate spec still asserts a Phase-1 event returns
-- 403 — so the gate is EXERCISED, never bypassed (green != true holds).
--
-- data_class='synthetic' — this is CI test data, not production (the events
-- CHECK constraint, migration 0052, enforces the honest marker). This fixture
-- proves only that the CODE PATH works; it is NOT regulatory clearance. Do NOT
-- read a green survey/email test as production readiness — real Phase-2 legal
-- clearance (documented legal basis, consent capture, retention, a governance
-- guardrail on the tier flag) is tracked separately in OSE-1007, and
-- forms.survey / forms.email-signup must NOT be enabled on any real
-- (non-synthetic) event until that lands.
--
-- Standalone fixture, NOT a numbered migration (a migrations/NNNN file would bump
-- REQUIRED_DB_MIGRATION and 503 every route until the bound D1 is at that
-- version). Fixture data belongs in the data layer, applied per-env.
--
-- Idempotent: INSERT OR IGNORE keyed by a stable id; safe to re-run every CI pass.
-- NOTE: this does NOT touch test-event-001 or any real event, and does NOT
-- change any existing event's legal_clearance_tier.

INSERT OR IGNORE INTO events
  (id, brand_id, title, slug, status, location, where_address,
   what_short, who_host, why_purpose, start_date, end_date,
   legal_clearance_tier, data_class)
VALUES
  ('evt_forms_phase2', 'ose', 'Synthetic Phase-2 Forms Event', 'forms-phase2', 'active',
   'Eagles Hall', '2427 Grove St',
   'Phase-2 form fixture', 'OSG', 'Exercise the survey/email clearance gate',
   datetime('now','-1 hour'), datetime('now','+3 hours'),
   2, 'synthetic');
