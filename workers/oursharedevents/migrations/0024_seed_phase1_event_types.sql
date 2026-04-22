-- Migration 0024: Seed Phase 1 event type registry — 47 community/recreational types (OSE-133 / REG-1)
--
-- Phase 1 = "no permit required" tier.
-- Regulatory floor: LLC, ToS, Privacy Policy, basic data handling only.
-- No PCI DSS, no age verification, no state licensing triggers.
--
-- UEC code format: CLUSTER-TYPE-NNN
-- Clusters: REC (sports), SOC (social/dining), MKT (markets), ART (arts/culture),
--           VOL (volunteer), CIV (civic), BIZ (business), FND (fundraising),
--           ENT (entertainment), GAR (garden/outdoor), FAI (faith), PER (performing arts),
--           TAB (tabletop), FIT (fitness), LIT (literary)

INSERT INTO event_type_registry
  (id, uec_code, name, description, phase, legal_clearance_tier, regulatory_notes, is_active)
VALUES

  -- ── Recreational Sports (6) ────────────────────────────────────────────────
  ('etr-rec-bocce',      'REC-BOCCE-001',      'Bocce Tournament',
   'Recreational bocce league play, open to all skill levels.',                         1, 1, 'LLC + ToS only', 1),

  ('etr-rec-softball',   'REC-SOFTBALL-001',   'Softball League Game',
   'Organized recreational softball game or league play.',                              1, 1, 'LLC + ToS only', 1),

  ('etr-rec-volleyball', 'REC-VOLLEYBALL-001', 'Volleyball Meetup',
   'Casual or organized volleyball — indoor or beach.',                                 1, 1, 'LLC + ToS only', 1),

  ('etr-rec-cornhole',   'REC-CORNHOLE-001',   'Cornhole Tournament',
   'Backyard and park cornhole bracket play.',                                          1, 1, 'LLC + ToS only', 1),

  ('etr-rec-pickup',     'REC-PICKUP-001',     'Pickup Basketball',
   'Open pickup basketball game at a park or community court.',                         1, 1, 'LLC + ToS only', 1),

  ('etr-rec-kickball',   'REC-KICKBALL-001',   'Kickball Game',
   'Recreational kickball game, league or open play.',                                  1, 1, 'LLC + ToS only', 1),

  -- ── Social / Community Dining (4) ─────────────────────────────────────────
  ('etr-soc-dinner',     'SOC-DINNER-001',     'Community Dinner',
   'Shared meal open to neighborhood or community members.',                            1, 1, 'LLC + ToS only', 1),

  ('etr-soc-potluck',    'SOC-POTLUCK-001',    'Neighborhood Potluck',
   'Bring-a-dish gathering for neighbors and community.',                               1, 1, 'LLC + ToS only', 1),

  ('etr-soc-block',      'SOC-BLOCK-001',      'Block Party',
   'Street or parking lot celebration for a residential block.',                        1, 1, 'LLC + ToS only', 1),

  ('etr-soc-cookout',    'SOC-COOKOUT-001',    'Community Cookout',
   'Outdoor grilling and gathering open to community members.',                         1, 1, 'LLC + ToS only', 1),

  -- ── Neighborhood Markets (3) ───────────────────────────────────────────────
  ('etr-mkt-flea',       'MKT-FLEA-001',       'Flea Market',
   'Community flea market with secondhand goods vendors.',                              1, 1, 'LLC + ToS only', 1),

  ('etr-mkt-craft',      'MKT-CRAFT-001',      'Craft Fair',
   'Handmade goods and artisan vendor market.',                                         1, 1, 'LLC + ToS only', 1),

  ('etr-mkt-swap',       'MKT-SWAP-001',       'Community Swap Meet',
   'Free or low-cost exchange of household goods and clothing.',                        1, 1, 'LLC + ToS only', 1),

  -- ── Arts / Culture / Live Music (5) ───────────────────────────────────────
  ('etr-art-gallery',    'ART-GALLERY-001',    'Art Show & Gallery Opening',
   'Visual art exhibition and gallery reception.',                                      1, 1, 'LLC + ToS only', 1),

  ('etr-art-music',      'ART-MUSIC-001',      'Live Music Event',
   'Live band or solo performance at a community venue or park.',                       1, 1, 'LLC + ToS only', 1),

  ('etr-art-cultural',   'ART-CULTURAL-001',   'Cultural Festival',
   'Celebration of cultural heritage through food, music, and art.',                   1, 1, 'LLC + ToS only', 1),

  ('etr-art-mural',      'ART-MURAL-001',      'Community Mural Unveiling',
   'Public art reveal and community celebration.',                                      1, 1, 'LLC + ToS only', 1),

  ('etr-art-photo',      'ART-PHOTO-001',      'Photography Exhibition',
   'Community photo show — prints, projections, or mixed media.',                      1, 1, 'LLC + ToS only', 1),

  -- ── Volunteer / Mutual Aid (3) ────────────────────────────────────────────
  ('etr-vol-cleanup',    'VOL-CLEANUP-001',    'Neighborhood Cleanup',
   'Organized litter pickup, graffiti removal, or park restoration.',                  1, 1, 'LLC + ToS only', 1),

  ('etr-vol-fooddrive',  'VOL-FOODDRIVE-001',  'Food Drive',
   'Collection and distribution of non-perishable food items.',                        1, 1, 'LLC + ToS only', 1),

  ('etr-vol-mutual',     'VOL-MUTUAL-001',     'Mutual Aid Distribution',
   'Community-organized direct support — goods, supplies, or services.',               1, 1, 'LLC + ToS only', 1),

  -- ── Civic / Neighborhood Associations (3) ─────────────────────────────────
  ('etr-civ-meeting',    'CIV-MEETING-001',    'Neighborhood Association Meeting',
   'Structured residents meeting for block or neighborhood issues.',                   1, 1, 'LLC + ToS only', 1),

  ('etr-civ-forum',      'CIV-FORUM-001',      'Community Forum',
   'Open discussion session on local issues, planning, or policy.',                    1, 1, 'LLC + ToS only', 1),

  ('etr-civ-captain',    'CIV-CAPTAIN-001',    'Block Captain Election',
   'Resident vote to select neighborhood block captain or liaison.',                   1, 1, 'LLC + ToS only', 1),

  -- ── Business Networking / Professional (3) ────────────────────────────────
  ('etr-biz-network',    'BIZ-NETWORK-001',    'Business Networking Meetup',
   'Open professional networking event for local business owners and workers.',        1, 1, 'LLC + ToS only', 1),

  ('etr-biz-workshop',   'BIZ-WORKSHOP-001',   'Professional Development Workshop',
   'Skills-building session for community professionals.',                             1, 1, 'LLC + ToS only', 1),

  ('etr-biz-mixer',      'BIZ-MIXER-001',      'Industry Mixer',
   'Sector-specific social gathering for professionals.',                              1, 1, 'LLC + ToS only', 1),

  -- ── Non-Gambling Fundraisers (3) ──────────────────────────────────────────
  ('etr-fnd-auction',    'FND-AUCTION-001',    'Silent Auction Fundraiser',
   'Non-gambling charity auction with item donations.',                                1, 1, 'LLC + ToS only', 1),

  ('etr-fnd-walkathon',  'FND-WALKATHON-001',  'Walkathon / Fun Run Fundraiser',
   'Pledge-based walking or running event for a community cause.',                     1, 1, 'LLC + ToS only', 1),

  ('etr-fnd-carwash',    'FND-CARWASH-001',    'Car Wash Fundraiser',
   'Community car wash organized for nonprofit or group fundraising.',                 1, 1, 'LLC + ToS only', 1),

  -- ── Entertainment: Film / Games / Trivia (4) ──────────────────────────────
  ('etr-ent-film',       'ENT-FILM-001',       'Film Screening',
   'Outdoor or indoor community movie screening.',                                     1, 1, 'LLC + ToS only', 1),

  ('etr-ent-trivia',     'ENT-TRIVIA-001',     'Trivia Night',
   'Team-based trivia competition at a community venue.',                              1, 1, 'LLC + ToS only', 1),

  ('etr-ent-gamenight',  'ENT-GAMENIGHT-001',  'Game Night',
   'Casual game night with card games, party games, or video games.',                 1, 1, 'LLC + ToS only', 1),

  ('etr-ent-karaoke',    'ENT-KARAOKE-001',    'Karaoke Night',
   'Community karaoke event at a venue or public space.',                             1, 1, 'LLC + ToS only', 1),

  -- ── Gardening / Outdoor (3) ───────────────────────────────────────────────
  ('etr-gar-planting',   'GAR-PLANTING-001',   'Community Garden Planting Day',
   'Organized planting session at a community or school garden.',                     1, 1, 'LLC + ToS only', 1),

  ('etr-gar-harvest',    'GAR-HARVEST-001',    'Garden Harvest Festival',
   'Celebration of seasonal harvest with produce sharing.',                           1, 1, 'LLC + ToS only', 1),

  ('etr-gar-trail',      'GAR-TRAIL-001',      'Nature Trail Walk',
   'Guided or self-guided group walk on a nature trail or greenway.',                 1, 1, 'LLC + ToS only', 1),

  -- ── Faith Community (2) ───────────────────────────────────────────────────
  ('etr-fai-service',    'FAI-SERVICE-001',    'Community Faith Service',
   'Non-health, non-youth-primary religious or spiritual community gathering.',       1, 1, 'LLC + ToS only', 1),

  ('etr-fai-interfaith', 'FAI-INTERFAITH-001', 'Interfaith Community Gathering',
   'Multi-tradition community dialogue, celebration, or service event.',              1, 1, 'LLC + ToS only', 1),

  -- ── Performing Arts: Open Mic / Poetry / Storytelling (4) ────────────────
  ('etr-per-openmic',    'PER-OPENMIC-001',    'Open Mic Night',
   'Open performance night for music, comedy, spoken word, or variety acts.',         1, 1, 'LLC + ToS only', 1),

  ('etr-per-poetry',     'PER-POETRY-001',     'Poetry Slam',
   'Competitive or showcase poetry performance event.',                               1, 1, 'LLC + ToS only', 1),

  ('etr-per-story',      'PER-STORY-001',      'Storytelling Night',
   'Live narrative and personal storytelling showcase.',                              1, 1, 'LLC + ToS only', 1),

  ('etr-per-comedy',     'PER-COMEDY-001',     'Stand-Up Comedy Night',
   'Amateur or community stand-up comedy showcase.',                                  1, 1, 'LLC + ToS only', 1),

  -- ── Tabletop / Board Games (2) ────────────────────────────────────────────
  ('etr-tab-boardgame',  'TAB-BOARDGAME-001',  'Board Game Night',
   'Organized board game session open to community members.',                         1, 1, 'LLC + ToS only', 1),

  ('etr-tab-rpg',        'TAB-RPG-001',        'Tabletop RPG Session',
   'Tabletop role-playing game session — one-shot or campaign.',                      1, 1, 'LLC + ToS only', 1),

  -- ── Fitness / Running (1) ─────────────────────────────────────────────────
  ('etr-fit-running',    'FIT-RUNNING-001',    'Running Club Meetup',
   'Community running group outing — any distance or pace.',                          1, 1, 'LLC + ToS only', 1),

  -- ── Literary / Book Club (1) ──────────────────────────────────────────────
  ('etr-lit-bookclub',   'LIT-BOOKCLUB-001',   'Book Club Meeting',
   'Community book club discussion or author meet-and-greet.',                        1, 1, 'LLC + ToS only', 1)

ON CONFLICT(id) DO NOTHING;
