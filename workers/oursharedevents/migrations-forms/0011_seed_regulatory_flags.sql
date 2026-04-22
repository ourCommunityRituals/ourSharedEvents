-- Migration 0011: Seed regulatory phase feature flags as global defaults.
--
-- Two-axis resolution: payment tier (free/mid/enterprise) × regulatory tier (phase 1-5).
-- Phase 1 is always enabled globally. Phases 2-5 require corridor-level unlock.
--
-- Corridor-scoped override pattern:
--   INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
--   VALUES ('corridor-<id>-phase2', 'corridor', '<corridor_id>', 'regulatory.phase2.commerce', 1, datetime('now'))
--   ON CONFLICT(scope, scope_id, flag_key) DO UPDATE SET enabled=excluded.enabled;
--
-- Lookup hierarchy: corridor > global > default (enabled=1 when no row exists).

INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
VALUES
  ('seed-regulatory-phase1', 'global', '', 'regulatory.phase1.enabled',  1, datetime('now')),
  ('seed-regulatory-phase2', 'global', '', 'regulatory.phase2.commerce', 0, datetime('now')),
  ('seed-regulatory-phase3', 'global', '', 'regulatory.phase3.licensed', 0, datetime('now')),
  ('seed-regulatory-phase4', 'global', '', 'regulatory.phase4.hipaa',    0, datetime('now')),
  ('seed-regulatory-phase5', 'global', '', 'regulatory.phase5.coppa',    0, datetime('now'))
ON CONFLICT(scope, scope_id, flag_key) DO NOTHING;
