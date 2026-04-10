-- Migration 0015: Seed event_templates with 32 templates from zeventbook archive
-- Source: archive/gas/TemplateService.gs + Config.gs
-- ADR-010: All templates available to all users/tiers. Templates never gate.

-- ── Bar & Tavern (bar_events) ──────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'bar_night',
  'Bar / Tavern Event',
  'Trivia nights, live music, happy hours',
  'bar_events', '🍺', 1, 'mvp',
  '{"video":true,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":true}',
  '["RSVP","Add to Calendar"]',
  '{"audience":"Adults 21+","notesLabel":"House Rules","sponsorStripLabel":"Tonight''s Sponsors"}',
  'Thursday Trivia Night'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'music_event',
  'Music Night / Live Music',
  'Live music, acoustic sets, band nights, promoter events',
  'bar_events', '🎵', 2, 'mvp',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["RSVP","View Lineup"]',
  '{"audience":"Music Fans","notesLabel":"Set Times & Info","sponsorStripLabel":"Event Sponsors"}',
  'Friday Night Live Music'
);

-- ── Leagues & Sports (leagues) ─────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'rec_league',
  'Rec League / Season',
  'Sports leagues, tournaments, team registrations',
  'leagues', '⚾', 1, 'mvp',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Register Team","View Schedule"]',
  '{"audience":"Teams & Captains","notesLabel":"League Notes","sponsorStripLabel":"Season Sponsors"}',
  'Summer Softball League'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'trivia',
  'Trivia Night',
  'Pub trivia, quiz nights, team competitions',
  'leagues', '🧠', 10, 'v2',
  '{"video":false,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":false}',
  '["Register Team","View Rules"]',
  '{"audience":"Teams & Players","notesLabel":"House Rules","sponsorStripLabel":"Tonight''s Sponsors"}',
  'Wednesday Trivia'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'darts',
  'Darts League',
  'Dart leagues, tournaments, competitions',
  'leagues', '🎯', 11, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":false}',
  '["Register","View Standings"]',
  '{"audience":"Players & Teams","notesLabel":"League Rules","sponsorStripLabel":"League Sponsors"}',
  'Tuesday Darts League'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'bags',
  'Bags / Cornhole',
  'Cornhole leagues, bags tournaments',
  'leagues', '🥏', 12, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":false}',
  '["Register Team","View Bracket"]',
  '{"audience":"Players & Teams","notesLabel":"League Rules","sponsorStripLabel":"League Sponsors"}',
  'Summer Bags League'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'pinball',
  'Pinball League',
  'Pinball leagues, arcade tournaments',
  'leagues', '🕹️', 13, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":false}',
  '["Register","View Rankings"]',
  '{"audience":"Players","notesLabel":"League Rules","sponsorStripLabel":"League Sponsors"}',
  'Monday Pinball League'
);

-- ── General (general) ──────────────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'custom',
  'Custom Event',
  'Start from scratch with all options available',
  'general', '✨', 99, 'mvp',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Register","Add to Calendar"]',
  '{}',
  'My Custom Event'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'fundraiser',
  'Fundraiser / Charity Event',
  'Fundraising events, charity nights, benefit events, auctions',
  'general', '💝', 2, 'mvp',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Donate","Buy Tickets"]',
  '{"audience":"Donors & Guests","notesLabel":"About the Cause","sponsorStripLabel":"Event Sponsors"}',
  'Trivia Night for a Cause'
);

-- ── Schools & Youth (schools) ──────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'school_event',
  'School Event',
  'School calendars, concerts, plays, open houses, assemblies',
  'schools', '🏫', 1, 'mvp',
  '{"video":true,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["RSVP","Add to Calendar"]',
  '{"audience":"Parents & Students","notesLabel":"Event Details","sponsorStripLabel":""}',
  'Spring Band Concert'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'club_activity',
  'Club / Activity',
  'Clubs, boosters, arts groups, student organizations',
  'schools', '🎭', 2, 'mvp',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Join Club","View Schedule"]',
  '{"audience":"Members & Parents","notesLabel":"Club Info","sponsorStripLabel":"Club Sponsors"}',
  'Robotics Club Meeting'
);

-- ── Community & Faith (community) ──────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'community_day',
  'Community Day / Festival',
  'Fairs, block parties, parish fests, rec center events',
  'community', '🎪', 1, 'mvp',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Get Directions","View Schedule"]',
  '{"audience":"Community Members","notesLabel":"Event Info","sponsorStripLabel":"Event Sponsors"}',
  'Summer Block Party'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'farmers_market',
  'Farmers Market',
  'Local markets, vendor fairs, craft shows',
  'community', '🥕', 2, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Get Directions","View Vendors"]',
  '{"audience":"Shoppers & Vendors","notesLabel":"Market Info","sponsorStripLabel":"Market Sponsors"}',
  'Saturday Farmers Market'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'art_show',
  'Art Show / Exhibition',
  'Art exhibits, gallery shows, artist showcases',
  'community', '🎨', 3, 'v2',
  '{"video":true,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":true}',
  '["RSVP","View Gallery"]',
  '{"audience":"Art Enthusiasts","notesLabel":"Exhibition Details","sponsorStripLabel":"Gallery Sponsors"}',
  'Spring Art Walk'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'carnival',
  'Carnival / Fair',
  'Carnivals, county fairs, community festivals',
  'community', '🎡', 4, 'v2',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":true}',
  '["Buy Tickets","View Schedule"]',
  '{"audience":"Families & Community","notesLabel":"Event Info","sponsorStripLabel":"Carnival Sponsors"}',
  'Summer Carnival'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'church',
  'Church Event',
  'Services, potlucks, community gatherings',
  'community', '⛪', 5, 'v2',
  '{"video":true,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["RSVP","Get Directions"]',
  '{"audience":"Congregation & Guests","notesLabel":"Event Details","sponsorStripLabel":""}',
  'Easter Service'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'church_club',
  'Church Group / Club',
  'Men''s, women''s, youth groups and ministries',
  'community', '✝️', 6, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["Join Group","Contact Leader"]',
  '{"audience":"Group Members","notesLabel":"Group Info","sponsorStripLabel":""}',
  'Women''s Bible Study'
);

-- ── Professional (professional) ────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'school_fundraiser',
  'School Fundraiser',
  'School fundraisers, band boosters, sports events',
  'professional', '🎓', 1, 'v2',
  '{"video":true,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":true}',
  '["Buy Tickets","Donate"]',
  '{"audience":"Families & Supporters","notesLabel":"Event Details","sponsorStripLabel":"Our Sponsors"}',
  'Band Booster Fundraiser'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'corporate',
  'Corporate / Professional',
  'Conferences, networking, company events',
  'professional', '💼', 2, 'v2',
  '{"video":true,"map":true,"schedule":true,"sponsors":true,"notes":true,"gallery":false}',
  '["Register","Add to Calendar"]',
  '{"audience":"Employees & Partners","notesLabel":"Agenda","sponsorStripLabel":"Event Partners"}',
  'Q4 Sales Kickoff'
);

-- ── Social & Celebration (social) ──────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'wedding',
  'Wedding',
  'Wedding celebrations, ceremonies, receptions',
  'social', '💒', 1, 'v2',
  '{"video":true,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["RSVP","View Registry"]',
  '{"audience":"Guests & Family","notesLabel":"Event Details","sponsorStripLabel":""}',
  'Sarah & John Wedding'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'photo_gallery',
  'Photo Gallery / Sharing',
  'Weddings, birthdays, anniversaries - share photos',
  'social', '📸', 2, 'v2',
  '{"video":true,"map":false,"schedule":false,"sponsors":false,"notes":true,"gallery":true}',
  '["View Photos","Download"]',
  '{"audience":"Friends & Family","notesLabel":"About This Event","sponsorStripLabel":""}',
  'Johnson Family Reunion Photos'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'shower',
  'Shower (Baby/Bridal)',
  'Baby showers, bridal showers, gift registries',
  'social', '🎀', 3, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["RSVP","View Registry"]',
  '{"audience":"Friends & Family","notesLabel":"Party Details","sponsorStripLabel":""}',
  'Sarah''s Baby Shower'
);

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'bachelor_party',
  'Bachelor / Bachelorette',
  'Bachelor parties, bachelorette weekends, stag nights',
  'social', '🥳', 4, 'v2',
  '{"video":false,"map":true,"schedule":true,"sponsors":false,"notes":true,"gallery":true}',
  '["RSVP","View Itinerary"]',
  '{"audience":"Wedding Party & Friends","notesLabel":"Party Details","sponsorStripLabel":""}',
  'Jake''s Bachelor Party'
);

-- ── Travel & Lodging (travel) ──────────────────────────────────────────────────

INSERT OR IGNORE INTO event_templates (id, name, description, category, icon, display_order, stage, default_sections, default_ctas, default_ui_presets, example_name)
VALUES (
  'travel_hub',
  'Travel Hub / Local Guide',
  'Lodging + local guide with nearby wineries, breweries, food, and activities',
  'travel', '🏡', 1, 'v2',
  '{"video":true,"map":true,"schedule":false,"sponsors":true,"notes":true,"gallery":true}',
  '["View Guide","Get Directions"]',
  '{"audience":"Guests & Travelers","notesLabel":"Stay Info","sponsorStripLabel":"Local Partners"}',
  'Harbor Country Cabins Guide'
);
