-- Migration 0007: Seed free-tier feature flags as global defaults.
--
-- Free tier = registration + check-in ON, everything else OFF.
-- This establishes the baseline. Upgrading to mid/enterprise is done
-- via the admin API (POST /api/v2/admin/flags/apply-tier).
--
-- Convention: id format is 'seed-<flag-key>' for traceability.
-- ON CONFLICT: safe to re-run — existing rows are not overwritten.

INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
VALUES
  ('seed-forms-register',        'global', '', 'forms.register',        1, datetime('now')),
  ('seed-forms-checkin',         'global', '', 'forms.checkin',         1, datetime('now')),
  ('seed-forms-survey',          'global', '', 'forms.survey',          0, datetime('now')),
  ('seed-forms-email-signup',    'global', '', 'forms.email-signup',    0, datetime('now')),
  ('seed-config-self-serve',     'global', '', 'config.self-serve',     0, datetime('now')),
  ('seed-config-event-settings', 'global', '', 'config.event-settings', 0, datetime('now')),
  ('seed-analytics-shared-report','global', '', 'analytics.shared-report',0, datetime('now')),
  ('seed-assets-file-upload',    'global', '', 'assets.file-upload',    0, datetime('now')),
  ('seed-assets-custom-qr',     'global', '', 'assets.custom-qr',     0, datetime('now')),
  ('seed-branding-white-label',  'global', '', 'branding.white-label',  0, datetime('now')),
  ('seed-branding-custom-domain','global', '', 'branding.custom-domain',0, datetime('now')),
  ('seed-branding-color-palette','global', '', 'branding.color-palette',0, datetime('now'))
ON CONFLICT(scope, scope_id, flag_key) DO NOTHING;
