-- Migration 0063: make the 19 dark event types reachable (OSE-800 / A3, milestone M0).
-- First Scan — Contact With Reality. Priority: Urgent (M0, before first write).
--
-- THE GAP (verified live against ocr-db-staging):
--   event_type_registry (active)              47
--     ...reachable via template_event_types   28
--     ...UNREACHABLE                          19    ← 40% of the vocabulary
-- The sponsor selects a template_id (24 templates); the event carries a
-- uec_code (47 types); the bridge template_event_types (0056/0057) covered only
-- 28 codes. An organizer who correctly tags "Neighborhood Potluck" received zero
-- sponsor matches forever and was told nothing. This migration closes the gap by
-- EXTENDING the 0057 suggestion layer — template_event_types stays the "you
-- picked this template, we pre-checked these types" map. NO change to the match
-- runtime, NO change to the sponsor identity schema (that is A2/OSE-799).
--
-- DESIGN (Co-Architect + PO, 2026-08-20): the bare-bones hyperlocal class —
-- "local people throwing community get-togethers" — gets its OWN named home
-- rather than being scattered into commercial templates (bar_night/corporate)
-- or the no-fixed-type scratch bucket (custom, which stays intentionally
-- unmapped + fail-safe per 0057). A dedicated template also gives the future
-- local/mid-only sponsorship rule (OSE-930) a real object to hang on. The
-- genuinely clearly-defined performance/recreation forms keep their precise
-- existing homes so the new template does not become a junk drawer.
--
-- Invariant compliance:
--   #3  — clearance derives from the brain-sourced event_type_registry; NO tier
--         integers, NO dangling UEC (every code is sourced FROM the registry at
--         seed time WHERE is_active = 1, so a typo matches nothing rather than
--         inserting a dangling FK). The recompute is the reusable 0057 statement.
--   #5  — the new template becomes selectable ONLY via the recomputed
--         max_clearance_tier (tier 1, from its mapped Phase-1 types); custom and
--         the other intentionally-unmapped templates keep NULL / NOT selectable.
--   #19 — > 0062, unique prefix, no destructive table drop.
--   #25 — templates never gate access (ADR-010); this file adds no tier/pricing
--         asymmetry. Sponsorship-tier policy for hyperlocal events is OSE-930,
--         deliberately NOT here.
--   ADR-001 — all FK targets (template_event_types → event_templates /
--         event_type_registry) live in MAIN DB.
--
-- Harness safety: every INSERT...SELECT / UPDATE is a single standalone
-- statement terminated by one ';' with no compound bodies (0024/0057 style).
-- Seed-only PR: bumps NOTHING in the table/index count gates (no new object);
-- it DOES bump REQUIRED_DB_MIGRATION (62 → 63) via schema-guard.ts.

-- ── The new hyperlocal template ──────────────────────────────────────────────
-- Category 'community'; low-stakes defaults (no video, RSVP + calendar). The
-- sponsor strip label stays lexicon-clean (#25: no impressions/reach/views).
INSERT OR IGNORE INTO event_templates
  (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'community_gathering',
  'Community Gathering',
  'Bare-bones neighborhood get-togethers — dinners, potlucks, cleanups, forums, garden days.',
  'community', '🏘️', 3, 'mvp',
  '{"video":false,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":false}',
  '["RSVP","Add to Calendar"]',
  '{"audience":"Neighbors & Community","notesLabel":"What to Bring","sponsorStripLabel":"Local Sponsors"}',
  'Neighborhood Potluck'
);

-- ── The 14 bare-bones hyperlocal types → community_gathering ─────────────────
-- Social / community dining
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('SOC-DINNER-001','SOC-POTLUCK-001') AND is_active = 1;
-- Volunteer / mutual aid
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('VOL-CLEANUP-001','VOL-FOODDRIVE-001','VOL-MUTUAL-001') AND is_active = 1;
-- Civic / neighborhood association
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('CIV-MEETING-001','CIV-FORUM-001','CIV-CAPTAIN-001') AND is_active = 1;
-- Gardening / outdoor
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('GAR-PLANTING-001','GAR-HARVEST-001','GAR-TRAIL-001') AND is_active = 1;
-- Literary / tabletop hobby / community film
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('LIT-BOOKCLUB-001','TAB-RPG-001','ENT-FILM-001') AND is_active = 1;

-- ── The 5 clearly-defined forms → their precise existing homes ───────────────
-- Stand-up comedy + board game night are venue entertainment (bar_night already
-- hosts trivia/game/karaoke via 0057).
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'bar_night', uec_code FROM event_type_registry
  WHERE uec_code IN ('PER-COMEDY-001','TAB-BOARDGAME-001') AND is_active = 1;
-- Poetry slam + storytelling are performance nights (music_event already hosts
-- open-mic via 0057).
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'music_event', uec_code FROM event_type_registry
  WHERE uec_code IN ('PER-POETRY-001','PER-STORY-001') AND is_active = 1;
-- Running club is recreational activity.
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'rec_league', uec_code FROM event_type_registry
  WHERE uec_code IN ('FIT-RUNNING-001') AND is_active = 1;

-- ── Named reusable recompute (identical to 0057 / promotion path) ────────────
-- MAX() over each template's mapped types; unmapped templates stay NULL (fail-
-- safe). No hardcoded tier. community_gathering resolves to tier 1 (its types
-- are all Phase-1 tier 1); the already-mapped templates are unchanged.
UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);
