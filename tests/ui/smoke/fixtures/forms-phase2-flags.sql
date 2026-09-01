-- Per-event feature-flag overrides for the survey/email form E2E fixtures (OSE-1004).
-- Applies to FORMS_DB (feature_flags lives there, per two-DB isolation).
--
--   cd workers/oursharedevents
--   npx wrangler d1 execute FORMS_DB --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/forms-phase2-flags.sql
--
-- WHY: the router checks the feature flag (FORM_DISABLED) BEFORE the clearance
-- tier (PHASE_REQUIRED) — router.ts:1254 then :1276. The GLOBAL forms.survey /
-- forms.email-signup flags are OFF on staging (config drift), so without an
-- override every survey/email POST is FORM_DISABLED regardless of tier. These
-- rows enable the two form types for the SYNTHETIC fixture events ONLY
-- (scope='event' beats global; `@ocr/flags` evaluator checks the event row
-- first). No global flag is touched; no real event is affected.
--
-- evt_forms_phase2 (tier 2) + flag ON  → submission clears both gates (201).
-- evt_forms_phase1 (tier 1) + flag ON  → clears FORM_DISABLED, then 403
--                                        PHASE_REQUIRED (tier gate exercised).
--
-- data-layer fixture, not a migration. Idempotent: ON CONFLICT re-asserts enabled=1.
-- ⚠️ This enables PII-form flags on SYNTHETIC events for CI only. It is NOT
-- regulatory clearance and must never be used to enable these forms on a real
-- event — that is OSE-1007 (documented legal basis + governance guardrail).

INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
VALUES
  ('evt_forms_phase2-forms-survey',       'event', 'evt_forms_phase2', 'forms.survey',       1, datetime('now')),
  ('evt_forms_phase2-forms-email-signup', 'event', 'evt_forms_phase2', 'forms.email-signup', 1, datetime('now')),
  ('evt_forms_phase1-forms-survey',       'event', 'evt_forms_phase1', 'forms.survey',       1, datetime('now')),
  ('evt_forms_phase1-forms-email-signup', 'event', 'evt_forms_phase1', 'forms.email-signup', 1, datetime('now'))
ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at;
