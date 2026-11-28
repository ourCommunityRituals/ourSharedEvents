-- Migration 0127: event type buckets, 25 new types, plain names.
--
-- WHY. The owner approved the event type buckets proposal on 2026-11-28
-- (OCR-docs docs/proposals/PROPOSAL_event-type-buckets.md, D1 to D6, "Yes, all
-- as recommended"). Visitors see 9 plain buckets ("Bargains", "Sports &
-- Recreation") on the landing row and in the Create Event picker, instead of
-- the 15 categories.
--
-- THE GUTS STAY THE SAME (owner, 2026-11-27). Buckets are a display layer:
--   * every type keeps its id, uec_code and category_code;
--   * event_type_category_registry is untouched, so the dashboard's
--     by_category, exports, BigQuery and reports group exactly as before;
--   * nothing is renamed or dropped except the display `name` of 17 types (D6).
--
-- WHAT.
--   1. event_type_bucket: the 9 buckets (code, name, short name for the row,
--      order). Names in other languages live in lib/i18n/event-type-names.ts.
--   2. event_type_registry.bucket_code, set for every type.
--   3. 25 new types (D2, and five more the markets-and-walks test account
--      found: farmers market, sidewalk sale, art walk, house and garden walk,
--      restaurant week). Each takes a home category_code from today's 15 and a
--      uec_code with that prefix, so reports keep grouping the same way.
--      Bingo, Charity Night, Parade and Camp can need a licence or permit (D3):
--      they are tier 2, above the launch ceiling, so the picker hides them and
--      their template (licensed_gathering) is not selectable until the
--      ceiling rises. Every other new type is tier 1.
--   4. Plain display names for 17 types (D6). Ids and codes do not change.
--   5. Template mappings for the new types (event-type-reachability.spec.ts
--      fails an active type with no template), then the 0057 recompute.
--
-- Drinking games are never a type (owner). Soccer is in.
--
-- Invariant compliance:
--   #3  — category codes are existing clusters; template rows are sourced FROM
--         the registry WHERE is_active = 1, so a typo inserts nothing.
--   #19 — > 0126, unique prefix, append-only, no table drop, no rename.
--   ADR-001 — MAIN DB only.

-- ── 1. The buckets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_type_bucket (
  bucket_code   TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  short_name    TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO event_type_bucket (bucket_code, display_name, short_name, display_order) VALUES
  ('SPT', 'Sports & Recreation',  'Sports & Rec',  10),
  ('GAM', 'Games & Trivia',       'Games',         20),
  ('SHW', 'Music & Shows',        'Music & Shows', 30),
  ('PTY', 'Parties & Festivals',  'Parties',       40),
  ('BGN', 'Bargains',             'Bargains',      50),
  ('KID', 'Kids & Family',        'Kids',          60),
  ('LRN', 'Learn & Connect',      'Learn',         70),
  ('GIV', 'Give Back',            'Give Back',     80),
  ('CMT', 'Neighborhood & Faith', 'Community',     90);

-- ── 2. Each type's bucket ───────────────────────────────────────────────────
ALTER TABLE event_type_registry ADD COLUMN bucket_code TEXT;

-- ── 3. The 25 new types ─────────────────────────────────────────────────────
INSERT OR IGNORE INTO event_type_registry
  (id, uec_code, name, description, phase, legal_clearance_tier, regulatory_notes, is_active, category_code)
VALUES
  ('etr-rec-soccer',       'REC-SOCCER-001',       'Soccer',
   'Pickup soccer and league games.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-rec-barleague',    'REC-BARLEAGUE-001',    'Bar League (Darts, Pool)',
   'Darts and pool leagues and nights.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-rec-shuffleboard', 'REC-SHUFFLEBOARD-001', 'Shuffleboard',
   'Shuffleboard games and leagues.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-rec-petanque',     'REC-PETANQUE-001',     'Pétanque',
   'A lawn game: toss metal balls close to a small target ball.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-rec-kubb',         'REC-KUBB-001',         'Kubb',
   'A lawn game: throw wooden sticks to knock over wooden blocks.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-rec-skating',      'REC-SKATING-001',      'Skating',
   'Ice skating and roller skating.', 1, 1, 'LLC + ToS only', 1, 'REC'),
  ('etr-gar-daytrip',      'GAR-DAYTRIP-001',      'Day Trip',
   'A trip out and back in one day.', 1, 1, 'LLC + ToS only', 1, 'GAR'),
  ('etr-ent-bingo',        'ENT-BINGO-001',        'Bingo Night',
   'Bingo games. Bingo for money or prizes can need a licence.', 2, 2, 'Gaming licence may be required', 1, 'ENT'),
  ('etr-ent-pinball',      'ENT-PINBALL-001',      'Pinball',
   'Pinball play and tournaments.', 1, 1, 'LLC + ToS only', 1, 'ENT'),
  ('etr-tab-foosball',     'TAB-FOOSBALL-001',     'Foosball',
   'Table soccer games and tournaments.', 1, 1, 'LLC + ToS only', 1, 'TAB'),
  ('etr-tab-cards',        'TAB-CARDS-001',        'Card Games',
   'Card games for fun.', 1, 1, 'LLC + ToS only', 1, 'TAB'),
  ('etr-soc-dance',        'SOC-DANCE-001',        'Dance',
   'A dance or a dance party.', 1, 1, 'LLC + ToS only', 1, 'SOC'),
  ('etr-civ-parade',       'CIV-PARADE-001',       'Parade',
   'A parade. A street parade can need a city permit.', 2, 2, 'Street permit may be required', 1, 'CIV'),
  ('etr-soc-newyear',      'SOC-NEWYEAR-001',      'New Year''s Party',
   'A party to ring in the new year.', 1, 1, 'LLC + ToS only', 1, 'SOC'),
  ('etr-mkt-yardsale',     'MKT-YARDSALE-001',     'Yard & Garage Sale',
   'Yard sales, garage sales and block sales.', 1, 1, 'LLC + ToS only', 1, 'MKT'),
  ('etr-mkt-resale',       'MKT-RESALE-001',       'Resale & Deals Day',
   'Resale shops and store deals for a day.', 1, 1, 'LLC + ToS only', 1, 'MKT'),
  ('etr-soc-kidsparty',    'SOC-KIDSPARTY-001',    'Kids'' Party',
   'A party for families with kids. No one''s age or details are collected.', 1, 1, 'LLC + ToS only', 1, 'SOC'),
  ('etr-rec-camp',         'REC-CAMP-001',         'Camp',
   'A day or week camp. A camp can need a licence.', 2, 2, 'Camp licence may be required', 1, 'REC'),
  ('etr-biz-class',        'BIZ-CLASS-001',        'Class or Lesson',
   'A class or lesson on any skill.', 1, 1, 'LLC + ToS only', 1, 'BIZ'),
  ('etr-fnd-charity',      'FND-CHARITY-001',      'Charity Night',
   'A night out that raises money for a cause. A raffle can need a licence.', 2, 2, 'Raffle licence may be required', 1, 'FND'),
  ('etr-mkt-farmers',      'MKT-FARMERS-001',      'Farmers Market',
   'Local farmers and makers selling food and goods.', 1, 1, 'LLC + ToS only', 1, 'MKT'),
  ('etr-mkt-sidewalk',     'MKT-SIDEWALK-001',     'Sidewalk Sale',
   'Shops put deals out on the sidewalk for a day.', 1, 1, 'LLC + ToS only', 1, 'MKT'),
  ('etr-art-walk',         'ART-WALK-001',         'Art Walk',
   'Walk from gallery to gallery and shop to shop to see art.', 1, 1, 'LLC + ToS only', 1, 'ART'),
  ('etr-civ-housewalk',    'CIV-HOUSEWALK-001',    'House and Garden Walk',
   'Walk the neighborhood and visit homes and gardens that open for the day.', 1, 1, 'LLC + ToS only', 1, 'CIV'),
  ('etr-soc-restaurantweek', 'SOC-RESTAURANTWEEK-001', 'Restaurant Week',
   'Local restaurants offer special menus for a week.', 1, 1, 'LLC + ToS only', 1, 'SOC');

-- Buckets follow the category, then the exceptions the proposal lists.
UPDATE event_type_registry SET bucket_code = 'SPT' WHERE bucket_code IS NULL AND category_code IN ('REC', 'FIT');
UPDATE event_type_registry SET bucket_code = 'GAM' WHERE bucket_code IS NULL AND category_code IN ('TAB', 'ENT')
  AND id NOT IN ('etr-ent-film', 'etr-ent-karaoke');
UPDATE event_type_registry SET bucket_code = 'SHW' WHERE bucket_code IS NULL AND (category_code IN ('PER', 'ART')
  OR id IN ('etr-ent-film', 'etr-ent-karaoke')) AND id <> 'etr-art-cultural';
UPDATE event_type_registry SET bucket_code = 'PTY' WHERE bucket_code IS NULL AND (category_code = 'SOC'
  OR id IN ('etr-art-cultural', 'etr-gar-harvest', 'etr-civ-parade'))
  AND id NOT IN ('etr-soc-kidsparty', 'etr-soc-restaurantweek');
UPDATE event_type_registry SET bucket_code = 'BGN' WHERE bucket_code IS NULL AND category_code = 'MKT';
UPDATE event_type_registry SET bucket_code = 'KID' WHERE id IN ('etr-soc-kidsparty', 'etr-rec-camp');
UPDATE event_type_registry SET bucket_code = 'LRN' WHERE bucket_code IS NULL AND category_code IN ('LIT', 'BIZ');
UPDATE event_type_registry SET bucket_code = 'GIV' WHERE bucket_code IS NULL AND (category_code IN ('FND', 'VOL')
  OR id = 'etr-gar-planting');
UPDATE event_type_registry SET bucket_code = 'SPT' WHERE bucket_code IS NULL AND id IN ('etr-gar-trail', 'etr-gar-daytrip');
UPDATE event_type_registry SET bucket_code = 'CMT' WHERE bucket_code IS NULL AND (category_code IN ('CIV', 'FAI')
  OR id = 'etr-soc-restaurantweek');

CREATE INDEX IF NOT EXISTS idx_event_type_registry_bucket ON event_type_registry(bucket_code);

-- ── 4. Plain names (D6): display name only ──────────────────────────────────
UPDATE event_type_registry SET name = 'Job Skills Class'             WHERE id = 'etr-biz-workshop';
UPDATE event_type_registry SET name = 'Business Meetup'              WHERE id = 'etr-biz-network';
UPDATE event_type_registry SET name = 'Work Mixer'                   WHERE id = 'etr-biz-mixer';
UPDATE event_type_registry SET name = 'Free Supplies Giveaway'       WHERE id = 'etr-vol-mutual';
UPDATE event_type_registry SET name = 'Neighborhood Meeting'         WHERE id = 'etr-civ-meeting';
UPDATE event_type_registry SET name = 'Block Captain Vote'           WHERE id = 'etr-civ-captain';
UPDATE event_type_registry SET name = 'Faith Service'                WHERE id = 'etr-fai-service';
UPDATE event_type_registry SET name = 'Many Faiths Together'         WHERE id = 'etr-fai-interfaith';
UPDATE event_type_registry SET name = 'Art Show'                     WHERE id = 'etr-art-gallery';
UPDATE event_type_registry SET name = 'New Mural Reveal'             WHERE id = 'etr-art-mural';
UPDATE event_type_registry SET name = 'Photo Show'                   WHERE id = 'etr-art-photo';
UPDATE event_type_registry SET name = 'Role-Playing Game Night'      WHERE id = 'etr-tab-rpg';
UPDATE event_type_registry SET name = 'Silent Auction'               WHERE id = 'etr-fnd-auction';
UPDATE event_type_registry SET name = 'Fun Run or Walk for a Cause'  WHERE id = 'etr-fnd-walkathon';
UPDATE event_type_registry SET name = 'Garden Planting Day'          WHERE id = 'etr-gar-planting';
UPDATE event_type_registry SET name = 'Harvest Festival'             WHERE id = 'etr-gar-harvest';
UPDATE event_type_registry SET name = 'Potluck'                      WHERE id = 'etr-soc-potluck';

-- ── 5. Templates ────────────────────────────────────────────────────────────
-- A tier-1 new type joins every template its nearest existing type is in.
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, 'REC-SOCCER-001' FROM template_event_types t
  WHERE t.uec_code = 'REC-KICKBALL-001'
    AND EXISTS (SELECT 1 FROM event_type_registry WHERE uec_code = 'REC-SOCCER-001' AND is_active = 1);
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'REC-CORNHOLE-001' AND n.is_active = 1
    AND n.uec_code IN ('REC-BARLEAGUE-001', 'REC-SHUFFLEBOARD-001', 'REC-KUBB-001');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'REC-BOCCE-001' AND n.is_active = 1 AND n.uec_code = 'REC-PETANQUE-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'FIT-RUNNING-001' AND n.is_active = 1 AND n.uec_code = 'REC-SKATING-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'GAR-TRAIL-001' AND n.is_active = 1 AND n.uec_code = 'GAR-DAYTRIP-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'ENT-GAMENIGHT-001' AND n.is_active = 1 AND n.uec_code = 'ENT-PINBALL-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'TAB-BOARDGAME-001' AND n.is_active = 1
    AND n.uec_code IN ('TAB-FOOSBALL-001', 'TAB-CARDS-001');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'ART-MUSIC-001' AND n.is_active = 1 AND n.uec_code = 'SOC-DANCE-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'SOC-BLOCK-001' AND n.is_active = 1
    AND n.uec_code IN ('SOC-NEWYEAR-001', 'SOC-KIDSPARTY-001');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'MKT-FLEA-001' AND n.is_active = 1
    AND n.uec_code IN ('MKT-YARDSALE-001', 'MKT-RESALE-001', 'MKT-FARMERS-001', 'MKT-SIDEWALK-001');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'farmers_market', uec_code FROM event_type_registry
  WHERE uec_code = 'MKT-FARMERS-001' AND is_active = 1
    AND EXISTS (SELECT 1 FROM event_templates WHERE id = 'farmers_market');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'ART-GALLERY-001' AND n.is_active = 1
    AND n.uec_code IN ('ART-WALK-001', 'CIV-HOUSEWALK-001');
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'SOC-BLOCK-001' AND n.is_active = 1 AND n.uec_code = 'SOC-RESTAURANTWEEK-001';
INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT t.template_id, n.uec_code FROM template_event_types t, event_type_registry n
  WHERE t.uec_code = 'BIZ-WORKSHOP-001' AND n.is_active = 1 AND n.uec_code = 'BIZ-CLASS-001';

-- The tier-2 types get a template of their own, so they never raise the tier
-- of a template people can choose today. It computes to tier 2 and stays
-- unselectable until the clearance ceiling rises (lib/template-clearance.ts).
INSERT OR IGNORE INTO event_templates
  (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'licensed_gathering',
  'Licensed Gathering',
  'Events that can need a licence or permit: bingo, raffles, parades, camps.',
  'community', '🎟️', 90, 'mvp',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":false}',
  '["RSVP","Add to Calendar"]',
  '{"audience":"Neighbors & Community","notesLabel":"Good to Know","sponsorStripLabel":"Local Sponsors"}',
  'Bingo Night'
);

INSERT OR IGNORE INTO template_event_types (template_id, uec_code)
  SELECT 'licensed_gathering', uec_code FROM event_type_registry
  WHERE uec_code IN ('ENT-BINGO-001', 'FND-CHARITY-001', 'CIV-PARADE-001', 'REC-CAMP-001') AND is_active = 1;

UPDATE event_templates SET max_clearance_tier = (
  SELECT MAX(r.legal_clearance_tier)
  FROM template_event_types t
  JOIN event_type_registry r ON t.uec_code = r.uec_code
  WHERE t.template_id = event_templates.id
);
