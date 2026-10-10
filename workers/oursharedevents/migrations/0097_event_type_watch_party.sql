-- Migration 0097: add the Watch Party event type (owner request 2026-10-10).
--
-- WHY. Organizers host game and show watch parties ("Watch the Bears game on
-- the big screen") and the Create Event picker had no type for them, so they
-- picked "Something Else" and the event carried no type.
--
-- WHAT. One registry row in Social & Community Dining (SOC, owner's choice),
-- Phase 1, tier 1, like every other seeded type. It is mapped to two
-- templates so a sponsor can reach it (event-type-reachability.spec.ts fails
-- an active type with no template):
--   bar_night            — a watch party at a bar or venue
--   community_gathering  — neighbors watching together (block, backyard, hall)
-- Then the 0057/0063 recompute refreshes each template's max_clearance_tier.
--
-- Invariant compliance:
--   #3  — SOC is an existing cluster; the template rows are sourced FROM the
--         registry WHERE is_active = 1, so a typo inserts nothing.
--   #19 — > 0096, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

INSERT OR IGNORE INTO event_type_registry
  (id, uec_code, name, description, phase, legal_clearance_tier, regulatory_notes, is_active, category_code)
VALUES
  ('etr-soc-watchparty', 'SOC-WATCHPARTY-001', 'Watch Party',
   'Watch a game, a show or a big night together on a shared screen.', 1, 1, 'LLC + ToS only', 1, 'SOC');

INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'bar_night', uec_code FROM event_type_registry
  WHERE uec_code IN ('SOC-WATCHPARTY-001') AND is_active = 1;

INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('SOC-WATCHPARTY-001') AND is_active = 1;

UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);
