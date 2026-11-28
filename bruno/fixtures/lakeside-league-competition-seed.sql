-- The Lakeside practice league: staging fixture for leagues phase 1
-- (OSE-525, OSE-526, OSE-527, OSE-529; OCR-docs PROPOSAL_leagues-tournaments-referees.md,
-- decision D8: phase 1 is shown on the lakeside-league practice brand).
--
-- Applied by CI after the Lakeside brand tree (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/lakeside-league-competition-seed.sql
--
-- STAND-IN NAMES ONLY. "Lakeside" is the practice stand-in for a real bocce
-- company; no real group, venue or team is named here until they agree
-- (OSE-2218). Team labels are invented. Nothing about a person is stored: a
-- competition holds team labels and scores only (migration 0125).
--
--   lakeside-league-night-1..5   five Wednesday league nights of lakeside-league,
--                                unlisted (off the landing list and the map),
--                                synthetic
--   cmp_1a6e…0001                "Fall Bar League (practice)", seasonal, active,
--                                six teams, a full round robin on three courts,
--                                rounds 1 and 2 scored
--
-- The public page is /competitions/cmp_1a6e51de0c1b00000000000000000001.
-- Bruno folder "34. Leagues (phase 1)" reads it and also makes, works on and
-- leaves its own league; this file removes that one at the start of each pass.
-- Every row here goes back to its starting state on each pass. Idempotent.
-- Never apply to production.

-- ── the league the Bruno folder made on an earlier pass ──
-- fixture_lineups (migration 0126) points at fixtures, so it goes first.
DELETE FROM fixture_lineups WHERE fixture_id IN (
  SELECT f.id FROM fixtures f JOIN competitions c ON c.id = f.competition_id
   WHERE c.brand_id = 'lakeside-league' AND c.name = 'CI league (synthetic)');
DELETE FROM fixture_results WHERE fixture_id IN (
  SELECT f.id FROM fixtures f JOIN competitions c ON c.id = f.competition_id
   WHERE c.brand_id = 'lakeside-league' AND c.name = 'CI league (synthetic)');
DELETE FROM fixtures WHERE competition_id IN (
  SELECT id FROM competitions WHERE brand_id = 'lakeside-league' AND name = 'CI league (synthetic)');
DELETE FROM competition_entries WHERE competition_id IN (
  SELECT id FROM competitions WHERE brand_id = 'lakeside-league' AND name = 'CI league (synthetic)');
DELETE FROM competition_stages WHERE competition_id IN (
  SELECT id FROM competitions WHERE brand_id = 'lakeside-league' AND name = 'CI league (synthetic)');
DELETE FROM competitions WHERE brand_id = 'lakeside-league' AND name = 'CI league (synthetic)';

-- ── the practice league, back to its start ──
DELETE FROM fixture_lineups WHERE fixture_id LIKE 'fix_1a6e51de0c1b%';
DELETE FROM fixture_results WHERE fixture_id LIKE 'fix_1a6e51de0c1b%';
DELETE FROM fixtures WHERE competition_id = 'cmp_1a6e51de0c1b00000000000000000001';

INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date, timezone, data_class)
VALUES
  ('lakeside-league-night-1', 'lakeside-league', 'Lakeside League Night (practice)', 'lakeside-league-night-1', 'active', 0, 'Lakeside practice bar', '2026-11-18', '2026-11-18', 'America/Chicago', 'synthetic'),
  ('lakeside-league-night-2', 'lakeside-league', 'Lakeside League Night (practice)', 'lakeside-league-night-2', 'active', 0, 'Lakeside practice bar', '2026-11-25', '2026-11-25', 'America/Chicago', 'synthetic'),
  ('lakeside-league-night-3', 'lakeside-league', 'Lakeside League Night (practice)', 'lakeside-league-night-3', 'active', 0, 'Lakeside practice bar', '2026-12-02', '2026-12-02', 'America/Chicago', 'synthetic'),
  ('lakeside-league-night-4', 'lakeside-league', 'Lakeside League Night (practice)', 'lakeside-league-night-4', 'active', 0, 'Lakeside practice bar', '2026-12-09', '2026-12-09', 'America/Chicago', 'synthetic'),
  ('lakeside-league-night-5', 'lakeside-league', 'Lakeside League Night (practice)', 'lakeside-league-night-5', 'active', 0, 'Lakeside practice bar', '2026-12-16', '2026-12-16', 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET
  brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  location = excluded.location, start_date = excluded.start_date, end_date = excluded.end_date,
  timezone = excluded.timezone, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1).
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id LIKE 'lakeside-league-night-%';

INSERT INTO competitions (id, brand_id, created_by, name, sport, format, status, starts_on, ends_on, ruleset, source)
VALUES ('cmp_1a6e51de0c1b00000000000000000001', 'lakeside-league', NULL, 'Fall Bar League (practice)',
        'bocce_league', 'seasonal', 'active', '2026-11-18', '2026-12-16', 'win_loss', 'native')
ON CONFLICT(id) DO UPDATE SET
  brand_id = 'lakeside-league', name = excluded.name, sport = excluded.sport, format = 'seasonal',
  status = 'active', starts_on = excluded.starts_on, ends_on = excluded.ends_on,
  ruleset = 'win_loss', source = 'native';

INSERT INTO competition_stages (id, competition_id, kind, sort)
VALUES ('stg_1a6e51de0c1b00000000000000000001', 'cmp_1a6e51de0c1b00000000000000000001', 'round_robin', 0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO competition_entries (id, competition_id, label, seed, is_active)
VALUES
  ('grp_1a6e51de0c1b000000000000000000a1', 'cmp_1a6e51de0c1b00000000000000000001', 'Rolling Thunder', 1, 1),
  ('grp_1a6e51de0c1b000000000000000000a2', 'cmp_1a6e51de0c1b00000000000000000001', 'Pallino Pals', 2, 1),
  ('grp_1a6e51de0c1b000000000000000000a3', 'cmp_1a6e51de0c1b00000000000000000001', 'Court Jesters', 3, 1),
  ('grp_1a6e51de0c1b000000000000000000a4', 'cmp_1a6e51de0c1b00000000000000000001', 'Backboard Bandits', 4, 1),
  ('grp_1a6e51de0c1b000000000000000000a5', 'cmp_1a6e51de0c1b00000000000000000001', 'Lawn Rangers', 5, 1),
  ('grp_1a6e51de0c1b000000000000000000a6', 'cmp_1a6e51de0c1b00000000000000000001', 'Kiss the Jack', 6, 1)
ON CONFLICT(id) DO UPDATE SET label = excluded.label, seed = excluded.seed, is_active = 1;

-- The circle method's round robin for the six teams (lib/competitions.ts
-- roundRobin), three courts, every match at 19:00.
INSERT INTO fixtures (id, competition_id, stage_id, event_id, round, slot_label, slot_time, entry_a, entry_b, status)
VALUES
  ('fix_1a6e51de0c1b00000000000000000001', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-1', 1, 'Court 1', '19:00', 'grp_1a6e51de0c1b000000000000000000a1', 'grp_1a6e51de0c1b000000000000000000a6', 'played'),
  ('fix_1a6e51de0c1b00000000000000000002', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-1', 1, 'Court 2', '19:00', 'grp_1a6e51de0c1b000000000000000000a2', 'grp_1a6e51de0c1b000000000000000000a5', 'played'),
  ('fix_1a6e51de0c1b00000000000000000003', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-1', 1, 'Court 3', '19:00', 'grp_1a6e51de0c1b000000000000000000a3', 'grp_1a6e51de0c1b000000000000000000a4', 'played'),
  ('fix_1a6e51de0c1b00000000000000000004', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-2', 2, 'Court 1', '19:00', 'grp_1a6e51de0c1b000000000000000000a5', 'grp_1a6e51de0c1b000000000000000000a1', 'played'),
  ('fix_1a6e51de0c1b00000000000000000005', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-2', 2, 'Court 2', '19:00', 'grp_1a6e51de0c1b000000000000000000a6', 'grp_1a6e51de0c1b000000000000000000a4', 'played'),
  ('fix_1a6e51de0c1b00000000000000000006', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-2', 2, 'Court 3', '19:00', 'grp_1a6e51de0c1b000000000000000000a2', 'grp_1a6e51de0c1b000000000000000000a3', 'played'),
  ('fix_1a6e51de0c1b00000000000000000007', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-3', 3, 'Court 1', '19:00', 'grp_1a6e51de0c1b000000000000000000a1', 'grp_1a6e51de0c1b000000000000000000a4', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000008', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-3', 3, 'Court 2', '19:00', 'grp_1a6e51de0c1b000000000000000000a5', 'grp_1a6e51de0c1b000000000000000000a3', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000009', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-3', 3, 'Court 3', '19:00', 'grp_1a6e51de0c1b000000000000000000a6', 'grp_1a6e51de0c1b000000000000000000a2', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000010', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-4', 4, 'Court 1', '19:00', 'grp_1a6e51de0c1b000000000000000000a3', 'grp_1a6e51de0c1b000000000000000000a1', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000011', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-4', 4, 'Court 2', '19:00', 'grp_1a6e51de0c1b000000000000000000a4', 'grp_1a6e51de0c1b000000000000000000a2', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000012', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-4', 4, 'Court 3', '19:00', 'grp_1a6e51de0c1b000000000000000000a5', 'grp_1a6e51de0c1b000000000000000000a6', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000013', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-5', 5, 'Court 1', '19:00', 'grp_1a6e51de0c1b000000000000000000a1', 'grp_1a6e51de0c1b000000000000000000a2', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000014', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-5', 5, 'Court 2', '19:00', 'grp_1a6e51de0c1b000000000000000000a3', 'grp_1a6e51de0c1b000000000000000000a6', 'scheduled'),
  ('fix_1a6e51de0c1b00000000000000000015', 'cmp_1a6e51de0c1b00000000000000000001', 'stg_1a6e51de0c1b00000000000000000001', 'lakeside-league-night-5', 5, 'Court 3', '19:00', 'grp_1a6e51de0c1b000000000000000000a4', 'grp_1a6e51de0c1b000000000000000000a5', 'scheduled');

-- Rounds 1 and 2 were played; first to 12.
INSERT INTO fixture_results (fixture_id, score_a, score_b, state, entered_by)
VALUES
  ('fix_1a6e51de0c1b00000000000000000001', 12, 7, 'confirmed', 'host'),
  ('fix_1a6e51de0c1b00000000000000000002', 9, 12, 'confirmed', 'host'),
  ('fix_1a6e51de0c1b00000000000000000003', 12, 10, 'confirmed', 'host'),
  ('fix_1a6e51de0c1b00000000000000000004', 12, 4, 'confirmed', 'host'),
  ('fix_1a6e51de0c1b00000000000000000005', 12, 11, 'confirmed', 'host'),
  ('fix_1a6e51de0c1b00000000000000000006', 6, 12, 'confirmed', 'host');
