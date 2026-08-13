-- Migration 0057: SEED template_event_types + recompute event_templates.max_clearance_tier (#4 seed).
-- OSE-728 (epic OSE-723, Sponsor Onboarding data-model set). Priority: Urgent.
--
-- DML companion to 0056. Populates the template x registry-type mapping via
-- INSERT...SELECT against event_type_registry.uec_code using LIKE-prefix family
-- predicates and explicit registry-sourced IN-lists — NOT a hand-typed pair
-- matrix. Every uec_code is sourced FROM the registry at seed time (WHERE
-- is_active = 1), so a typo matches nothing rather than inserting a dangling FK
-- (#3 hygiene). Then recomputes the cached tier with a single named
-- UPDATE...SELECT MAX(), the reusable statement the promotion path (OSE-736)
-- also invokes.
--
-- Live template set = the 24 event_templates seeded by 0015 (VERIFIED: 0015
-- seeds 24, not the ~32 the design assumed). Mapped templates below; the
-- remainder are INTENTIONALLY UNMAPPED because Phase-1 (0024) has no matching
-- community/recreational type for them — their max_clearance_tier stays NULL
-- (the #5 rule treats NULL as NOT selectable, which is the correct fail-safe):
--   custom          — scratch template, no fixed type
--   school_event    — youth/school types are Phase 5 (COPPA), not offered at launch
--   club_activity   — youth/club types are Phase 5 (COPPA), not offered at launch
--   wedding         — private celebration, not a community Phase-1 type
--   shower          — private celebration
--   bachelor_party  — private celebration
--   travel_hub      — no Phase-1 travel type
--
-- Harness safety: each INSERT...SELECT / UPDATE is a single standalone statement
-- terminated by one ';' with no compound bodies (matches the 0024 seed style).
-- Seed-only PR bumps NOTHING in the table/index count gates (0056 owns those).
--
-- CLEARANCE-GATE-INERT fix: all 47 Phase-1 types are legal_clearance_tier = 1
-- today, so a max-tier gate is currently inert on production data. The
-- selectability rule is implemented as an explicit tier ALLOWLIST in
-- src/lib/template-clearance.ts (max_clearance_tier IS NOT NULL AND <=
-- ALLOWED_MAX_TIER, ALLOWED_MAX_TIER from config, never a hardcoded literal in
-- the predicate) and is proven WIRED by a tier-2 fixture test in
-- template-clearance-gate.spec.ts — so the gate is live even while production
-- data is uniformly tier 1. When registry Phase 2+ types (tier > 1) are seeded,
-- no code change is needed for the gate to bite.

-- ── Bar & entertainment templates ────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'bar_night', uec_code FROM event_type_registry
  WHERE uec_code IN ('ENT-TRIVIA-001','ENT-KARAOKE-001','ENT-GAMENIGHT-001','ART-MUSIC-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'music_event', uec_code FROM event_type_registry
  WHERE uec_code IN ('ART-MUSIC-001','PER-OPENMIC-001') AND is_active = 1;

-- ── Leagues & recreational sports ────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'rec_league', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'REC-%' AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'trivia', uec_code FROM event_type_registry
  WHERE uec_code IN ('ENT-TRIVIA-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'bags', uec_code FROM event_type_registry
  WHERE uec_code IN ('REC-CORNHOLE-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'darts', uec_code FROM event_type_registry
  WHERE uec_code IN ('ENT-GAMENIGHT-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'pinball', uec_code FROM event_type_registry
  WHERE uec_code IN ('ENT-GAMENIGHT-001') AND is_active = 1;

-- ── Fundraisers ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'fundraiser', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'FND-%' AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'school_fundraiser', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'FND-%' AND is_active = 1;

-- ── Community & markets ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'community_day', uec_code FROM event_type_registry
  WHERE uec_code IN ('SOC-BLOCK-001','SOC-COOKOUT-001','ART-CULTURAL-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'farmers_market', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'MKT-%' AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'carnival', uec_code FROM event_type_registry
  WHERE uec_code IN ('ART-CULTURAL-001') AND is_active = 1;

-- ── Arts ─────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'art_show', uec_code FROM event_type_registry
  WHERE uec_code IN ('ART-GALLERY-001','ART-PHOTO-001','ART-MURAL-001') AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'photo_gallery', uec_code FROM event_type_registry
  WHERE uec_code IN ('ART-PHOTO-001') AND is_active = 1;

-- ── Faith community ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'church', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'FAI-%' AND is_active = 1;
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'church_club', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'FAI-%' AND is_active = 1;

-- ── Professional / business ──────────────────────────────────────────────────
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'corporate', uec_code FROM event_type_registry
  WHERE uec_code LIKE 'BIZ-%' AND is_active = 1;

-- ── Named reusable recompute (also invoked by promotion, OSE-736 order 13) ────
-- The ONE sanctioned data-mutating statement against event_templates
-- (LOAD_BEARING). MAX() over the mapped types; unmapped templates get NULL
-- (MAX of empty set), keeping them NOT selectable (fail-safe). No hardcoded tier.
UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);
