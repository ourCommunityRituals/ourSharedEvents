-- Migration 0056: template_event_types join (MISSING/BLOCKING #4) + cached clearance column. SCHEMA ONLY.
-- OSE-727 (epic OSE-723, Sponsor Onboarding data-model set). Priority: Urgent (BLOCKING for onboarding S4/S4b).
--
-- The genuinely missing join between event_templates (0014) and
-- event_type_registry (0023/0024). Pure DDL: adds a nullable cached
-- max_clearance_tier column to event_templates (SQLite-safe ADD COLUMN, no
-- recreate) and creates the join table. NO seed / NO recompute here — that is
-- migration 0057 (OSE-728).
--
-- max_clearance_tier NULL means 'no mapped types / not yet computed' and is
-- DISTINCT from tier 1. The #5 selectable rule treats NULL-tier templates as
-- NOT selectable, so the schema-before-seed window is fail-safe (nothing is
-- wrongly selectable while the join is empty). UNIQUE(template_id,uec_code)
-- blocks duplicate mappings. Independent of 0053/0054/0055 — parallelizable.
--
-- Count-gate ownership: the table/index count bump lands with the migration
-- that CREATES the object (here), not the 0057 seed — a DB at 0056-only must
-- still be CI-green.
--
-- Invariant compliance:
--   #19 — > 0055, unique prefix, no destructive table drop.
--   #3  — clearance derives from the brain-sourced event_type_registry; this
--         file adds NO tier integers and NO hardcoded UEC (the ADD COLUMN is an
--         empty cache; the recompute is 0057).
--   ADR-001 — FK targets in MAIN DB.

ALTER TABLE event_templates ADD COLUMN max_clearance_tier INTEGER;  -- nullable cache, SQLite-safe, no recreate

CREATE TABLE IF NOT EXISTS template_event_types (
  template_id TEXT NOT NULL,
  uec_code    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES event_templates(id),
  FOREIGN KEY (uec_code)    REFERENCES event_type_registry(uec_code),
  UNIQUE(template_id, uec_code)
);

CREATE INDEX IF NOT EXISTS idx_template_event_types_template ON template_event_types(template_id);
CREATE INDEX IF NOT EXISTS idx_template_event_types_uec      ON template_event_types(uec_code);
