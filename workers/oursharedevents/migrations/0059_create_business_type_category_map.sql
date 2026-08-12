-- Migration 0059: business_type_category_map — step-5 smart default (#5 DDL only, seed in 0060).
-- OSE-730 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- Pure-DDL create of the step-5 smart-default map (business_type -> category,
-- is_default). Schema-first per the granularity rule; the seed is the separate
-- 0060 migration so the '>=1 selectable template' invariant validates against
-- the now-seeded template_event_types (0057) and canonical categories (0058).
-- Index on business_type for the step-5 lookup. No seed rows here.
--
-- Count-gate ownership: CREATE bumps the table + index counts here (0059);
-- 0060 is seed-only.
--
-- Invariant compliance:
--   #19 — > 0058, unique prefix, append-only, no destructive table drop.
--   #3  — no hardcoded UEC. Schema-vs-seed split keeps a bare CREATE CI-green
--         with no runtime wiring.
--   ADR-001 — MAIN DB only. No DB-level FK to category_registry (soft-reference);
--             a bad category is caught by the 0060 seed join + invariant test.

CREATE TABLE IF NOT EXISTS business_type_category_map (
  id            TEXT PRIMARY KEY,
  business_type TEXT NOT NULL,
  category      TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_type, category)
);

CREATE INDEX IF NOT EXISTS idx_business_type_category_map_bt ON business_type_category_map(business_type);
