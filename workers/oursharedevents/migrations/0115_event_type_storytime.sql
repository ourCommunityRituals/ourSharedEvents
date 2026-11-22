-- Migration 0115: add the Storytime event type (Part of OSE-2155).
--
-- WHY. The owner asked for Storytime as a type of its own (2026-11-19) and
-- said it is "meant for adult telling stories like spoken word", in
-- Performing arts. The product handles no children's data (no HIPAA, COPPA
-- or SOPPA until further notice), so this type carries no age, child or
-- family meaning.
--
-- ASSUMPTION (not an owner ruling). Whether Storytime is a new type or the
-- existing Storytelling Night (PER-STORY-001) was asked and left open. This
-- adds a new type BESIDE Storytelling Night, which stays unchanged. Closing
-- the PR reverses it.
--
-- WHAT. One registry row in Performing Arts (PER), Phase 1, tier 1, like
-- every other seeded type. It maps to the same template as Storytelling
-- Night (music_event, 0063) so a sponsor can reach it under the same
-- two-sided consent rules (event-type-reachability.spec.ts fails an active
-- type with no template). Then the 0057/0063/0097 recompute refreshes each
-- template's max_clearance_tier.
--
-- The name is neutral on purpose: a future story application (name still
-- open) can use it as it is.
--
-- Invariant compliance:
--   #3  — PER is an existing cluster; the template row is sourced FROM the
--         registry WHERE is_active = 1, so a typo inserts nothing.
--   #19 — > 0114, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

INSERT OR IGNORE INTO event_type_registry
  (id, uec_code, name, description, phase, legal_clearance_tier, regulatory_notes, is_active, category_code)
VALUES
  ('etr-per-storytime', 'PER-STORYTIME-001', 'Storytime',
   'Adults telling stories aloud: spoken word, personal tales and told stories.', 1, 1, 'LLC + ToS only', 1, 'PER');

INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'music_event', uec_code FROM event_type_registry
  WHERE uec_code IN ('PER-STORYTIME-001') AND is_active = 1;

UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);
