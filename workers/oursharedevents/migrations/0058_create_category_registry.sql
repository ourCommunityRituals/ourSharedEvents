-- Migration 0058: category_registry — canonical category lookup (precursor to #5). Soft-reference, NOT a CHECK.
-- OSE-729 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- Canonicalizes the free-text event_templates.category domain (0014 has no
-- CHECK; examples bar_events / leagues / general). Ships as a SEPARATE
-- soft-reference lookup table, NOT a CHECK on event_templates.category (a CHECK
-- would force the SQLite rename-recreate dance on a seeded, load-bearing-adjacent
-- table plus its FKs).
--
-- Both business_type_category_map.category (#5, migration 0059/0060) and the
-- category_selections JSON (#1/#8) key off this canonical list, making the
-- '>=1 selectable template' invariant verifiable. Seeds the DISTINCT category
-- values already present in event_templates (data-driven, not hand-typed).
--
-- Count-gate ownership: the CREATE bumps the table count here (0058); the seed
-- rides in the same file (single standalone INSERT...SELECT, harness-safe).
--
-- Invariant compliance:
--   #19 — > 0057, unique prefix, append-only, no destructive table drop.
--   #3  — category set is data-driven from the existing table, not hardcoded.
--   ADR-001 — MAIN DB only. Soft-reference (no CHECK / no FK from event_templates)
--             deliberately avoids the recreate dance.

CREATE TABLE IF NOT EXISTS category_registry (
  category      TEXT PRIMARY KEY,
  display_name  TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single standalone statement; seed = DISTINCT event_templates.category present at authoring (data-driven).
INSERT OR IGNORE INTO category_registry (category, display_name)
  SELECT DISTINCT category, category FROM event_templates WHERE category IS NOT NULL;
