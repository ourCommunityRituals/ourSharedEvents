-- Juniper Grove High boosters — staging fixture (test account, owner 2026-11-27).
--
-- A practice account shaped like the adult volunteer wing of a high school
-- athletic boosters club. Parents and neighbours, with or without a student
-- at the school, run the concession stands and the other game-day services
-- at home games: football, basketball, volleyball and soccer. Somebody has
-- to cook, staff the stand, work the gate and sell 50/50 tickets, and has to
-- sign up and then actually show up.
--
-- Same pattern as the Lakeside and Meadowlark practice accounts: stand-in
-- names for practice on staging only; no real school or club is named here.
-- Which prospect it stands in for is kept off this public repository.
--
--   juniper-schools            (Juniper Grove practice village, its own seed)
--    └── juniper-boosters      the boosters club: home games + volunteer meetings
--
-- The parent link is made only when the village seed has made juniper-schools
-- (juniper-grove-village-seed.sql), so this file applies on its own too. A
-- member of juniper-boosters reaches only the boosters; a member of the
-- village or its schools brand reaches the boosters through the tree. Who is
-- a member is the owner's STAGING_TESTERS setting, never this file.
--
-- STUDENTS ARE MINORS: no student, player, roster, score or photo is in this
-- file, and none belongs in any boosters fixture. Titles name the sport and
-- level only. Volunteers are not seeded either: the shift roles each game
-- needs are written in how_details as plain text until the volunteer shift
-- board exists (it reuses the referee schedule, OSE-2239).
--
-- Events are synthetic and unpublished: off the landing list and the attendee
-- map. They sit in the same area cell as the CI brand fixture, so no real
-- address is implied. No person, no coordinates, no scans.
--
-- Applied by CI on staging only, after T1 has run the migrations and after
-- the Juniper Grove village seed:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/juniper-boosters-seed.sql
-- Idempotent: every row is an upsert keyed on its fixed id or brand.

INSERT INTO brand_parents (brand_id, parent_brand_id)
SELECT 'juniper-boosters', 'juniper-schools'
 WHERE EXISTS (SELECT 1 FROM brand_parents WHERE brand_id = 'juniper-schools')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'juniper-schools';

-- The two home sites. The club runs the stands there; it does not own them,
-- but a practice venue row is how events point at a place.
INSERT INTO venues (id, brand_id, name) VALUES
  ('ven_b0057e25000000000000000000000001', 'juniper-boosters', 'Juniper Grove High stadium')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', name = 'Juniper Grove High stadium';
INSERT INTO venues (id, brand_id, name) VALUES
  ('ven_b0057e25000000000000000000000002', 'juniper-boosters', 'Juniper Grove High fieldhouse')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', name = 'Juniper Grove High fieldhouse';

-- Season kickoff: the volunteer meeting where shifts are handed out.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-volunteer-kickoff-2027', 'juniper-boosters', 'Boosters volunteer kickoff: pick your game-day shifts',
        'jgb-volunteer-kickoff-2027', 'active', 0, '2027-01-07', '2027-01-07', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Adults only. Bring your calendar. Roles: grill cook, concession counter, cashier, gate, 50/50 seller, setup and cleanup.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- Basketball, at the fieldhouse.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-basketball-girls-2027-01', 'juniper-boosters', 'Girls varsity basketball home game',
        'jgb-basketball-girls-2027-01', 'active', 0, '2027-01-15', '2027-01-15', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Volunteer shifts (5:30 to 9:00 pm): concession counter x2, cashier x1, gate x2, setup and cleanup x1.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-basketball-boys-2027-01', 'juniper-boosters', 'Boys varsity basketball home game',
        'jgb-basketball-boys-2027-01', 'active', 0, '2027-01-22', '2027-01-22', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Volunteer shifts (5:30 to 9:30 pm): concession counter x3, cashier x1, gate x2, 50/50 seller x1, setup and cleanup x1.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- Volleyball, at the fieldhouse.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-volleyball-boys-2027-04', 'juniper-boosters', 'Boys varsity volleyball home match',
        'jgb-volleyball-boys-2027-04', 'active', 0, '2027-04-13', '2027-04-13', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Volunteer shifts (5:00 to 8:30 pm): concession counter x2, cashier x1, gate x1, setup and cleanup x1.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- Soccer, at the stadium.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-soccer-girls-2027-04', 'juniper-boosters', 'Girls varsity soccer home match',
        'jgb-soccer-girls-2027-04', 'active', 0, '2027-04-20', '2027-04-20', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Volunteer shifts (4:00 to 7:00 pm): concession counter x2, cashier x1, gate x1, setup and cleanup x1.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- Football, at the stadium: the biggest night, with the grill running.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-football-home-opener-2027', 'juniper-boosters', 'Varsity football home opener',
        'jgb-football-home-opener-2027', 'active', 0, '2027-08-27', '2027-08-27', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Volunteer shifts (two shifts, 5:00 to 7:30 pm and 7:30 to 10:00 pm): grill cook x2, concession counter x4, cashier x2, gate x3, 50/50 seller x2, setup and cleanup x2.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-football-homecoming-2027', 'juniper-boosters', 'Varsity football homecoming game',
        'jgb-football-homecoming-2027', 'active', 0, '2027-10-01', '2027-10-01', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Volunteer shifts (two shifts, 5:00 to 7:30 pm and 7:30 to 10:00 pm): grill cook x3, concession counter x4, cashier x2, gate x4, 50/50 seller x2, setup and cleanup x3.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- The boosters' own fundraiser: a 3-on-3 basketball tournament the volunteers run.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-tournament-3on3-2027', 'juniper-boosters', 'Boosters 3-on-3 basketball fundraiser tournament',
        'jgb-tournament-3on3-2027', 'active', 0, '2027-03-06', '2027-03-06', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Open to adult teams. Volunteers run the check-in and bracket desk, the courts and the stand; see the two volunteer shifts.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- Volunteer shifts. Until the shift board exists (referee schedule, OSE-2239),
-- each shift is its own unpublished event: Register = sign up, check-in at the
-- stand = showed up. Names and emails go to FORMS_DB under its usual rules
-- (encrypted, cleared the day after the shift); this file seeds no person.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-basketball-girls-2027-01', 'juniper-boosters', 'Volunteer shift: concessions and gate, girls basketball (5:30 to 9:00 pm)',
        'jgb-shift-basketball-girls-2027-01', 'active', 0, '2027-01-15', '2027-01-15', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Roles: concession counter x2, cashier x1, gate x2, setup and cleanup x1. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-basketball-boys-2027-01', 'juniper-boosters', 'Volunteer shift: concessions and gate, boys basketball (5:30 to 9:30 pm)',
        'jgb-shift-basketball-boys-2027-01', 'active', 0, '2027-01-22', '2027-01-22', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Roles: concession counter x3, cashier x1, gate x2, 50/50 seller x1, setup and cleanup x1. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-volleyball-boys-2027-04', 'juniper-boosters', 'Volunteer shift: concessions and gate, boys volleyball (5:00 to 8:30 pm)',
        'jgb-shift-volleyball-boys-2027-04', 'active', 0, '2027-04-13', '2027-04-13', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Roles: concession counter x2, cashier x1, gate x1, setup and cleanup x1. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-soccer-girls-2027-04', 'juniper-boosters', 'Volunteer shift: concessions and gate, girls soccer (4:00 to 7:00 pm)',
        'jgb-shift-soccer-girls-2027-04', 'active', 0, '2027-04-20', '2027-04-20', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Roles: concession counter x2, cashier x1, gate x1, setup and cleanup x1. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-football-opener-early-2027', 'juniper-boosters', 'Volunteer shift 1: grill and stand, football home opener (5:00 to 7:30 pm)',
        'jgb-shift-football-opener-early-2027', 'active', 0, '2027-08-27', '2027-08-27', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Roles: grill cook x2, concession counter x4, cashier x2, gate x3, 50/50 seller x2. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-football-opener-late-2027', 'juniper-boosters', 'Volunteer shift 2: grill, stand and cleanup, football home opener (7:30 to 10:00 pm)',
        'jgb-shift-football-opener-late-2027', 'active', 0, '2027-08-27', '2027-08-27', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Roles: grill cook x2, concession counter x3, cashier x1, 50/50 seller x1, setup and cleanup x2. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-football-homecoming-early-2027', 'juniper-boosters', 'Volunteer shift 1: grill and stand, football homecoming (5:00 to 7:30 pm)',
        'jgb-shift-football-homecoming-early-2027', 'active', 0, '2027-10-01', '2027-10-01', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Roles: grill cook x3, concession counter x4, cashier x2, gate x4, 50/50 seller x2. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-football-homecoming-late-2027', 'juniper-boosters', 'Volunteer shift 2: grill, stand and cleanup, football homecoming (7:30 to 10:00 pm)',
        'jgb-shift-football-homecoming-late-2027', 'active', 0, '2027-10-01', '2027-10-01', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000001',
        'Roles: grill cook x2, concession counter x3, cashier x1, 50/50 seller x1, setup and cleanup x3. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-tournament-morning-2027', 'juniper-boosters', 'Volunteer shift 1: tournament desk and courts, 3-on-3 fundraiser (8:00 am to 12:30 pm)',
        'jgb-shift-tournament-morning-2027', 'active', 0, '2027-03-06', '2027-03-06', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Roles: check-in and bracket desk x2, court monitor and scorekeeper x4, concession counter x2, cashier x1. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, how_details)
VALUES ('jgb-shift-tournament-afternoon-2027', 'juniper-boosters', 'Volunteer shift 2: tournament desk, courts and cleanup, 3-on-3 fundraiser (12:30 to 5:00 pm)',
        'jgb-shift-tournament-afternoon-2027', 'active', 0, '2027-03-06', '2027-03-06', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_b0057e25000000000000000000000002',
        'Roles: bracket desk x2, court monitor and scorekeeper x4, concession counter x2, cashier x1, setup and cleanup x2. Sign up with the Register button; check in at the stand when you arrive, so the club knows the shift is covered.')
ON CONFLICT(id) DO UPDATE SET brand_id = 'juniper-boosters', title = excluded.title, how_details = excluded.how_details,
  status = 'active', is_published = 0, data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_b0057e25000000000000000000000002',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1), as every
-- door in the Worker writes it. Run on every pass, so a row seeded before the
-- rule is corrected too. Gate: workers/oursharedevents/tests/seed-live-rows-verified.spec.ts
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('jgb-volunteer-kickoff-2027', 'jgb-basketball-girls-2027-01', 'jgb-basketball-boys-2027-01',
              'jgb-volleyball-boys-2027-04', 'jgb-soccer-girls-2027-04', 'jgb-football-home-opener-2027',
              'jgb-football-homecoming-2027', 'jgb-tournament-3on3-2027', 'jgb-shift-basketball-girls-2027-01',
              'jgb-shift-basketball-boys-2027-01', 'jgb-shift-volleyball-boys-2027-04', 'jgb-shift-soccer-girls-2027-04',
              'jgb-shift-football-opener-early-2027', 'jgb-shift-football-opener-late-2027', 'jgb-shift-football-homecoming-early-2027',
              'jgb-shift-football-homecoming-late-2027', 'jgb-shift-tournament-morning-2027', 'jgb-shift-tournament-afternoon-2027');
