-- Migration 0006: Feature flags — system-wide and per-event toggle for any feature.
-- Used by forms, but designed for ANY feature across the platform.
-- Convention: flag keys use dot notation (forms.register, forms.checkin, etc.)
-- Default behavior: if no row exists for a flag, the feature is ON.

CREATE TABLE IF NOT EXISTS feature_flags (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL DEFAULT 'global',
  scope_id    TEXT,
  flag_key    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, scope_id, flag_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_lookup
  ON feature_flags(flag_key, scope, scope_id);
