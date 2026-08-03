-- Migration 0013: Seed operational mock/demo mode flags (OSE-190 / MOCK-1b-ii).
--
-- These flags gate the data-provider mock/demo layer in staging environments.
-- Both default to OFF — mock mode must be explicitly enabled by an admin.
-- Production guard: WORKER_ENV=production blocks mock even if these are ON
-- (see data-provider.ts createDataProvider() factory).
--
-- Convention: id format is 'seed-<flag-key>' for traceability.
-- ON CONFLICT: safe to re-run — existing rows are not overwritten.

INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
VALUES
  ('seed-config-mock-mode',          'global', '', 'config.mock-mode',          0, datetime('now')),
  ('seed-config-mock-sponsor-count', 'global', '', 'config.mock-sponsor-count', 0, datetime('now'))
ON CONFLICT(scope, scope_id, flag_key) DO NOTHING;
