-- Meadowlark practice circus school — staging fixture (test account, owner 2026-11-27).
--
-- A practice account shaped like a small circus arts school: weekly classes
-- for kids, teens and adults, programs run inside schools, and birthday
-- parties at the studio. Same pattern as the Lakeside practice tree
-- (lakeside-brand-tree-seed.sql): stand-in names for practice on staging
-- only; no real business is named here. Which prospect it stands in for is
-- kept off this public repository.
--
--   meadowlark-circus          the school itself (runs its own showcases)
--    ├── meadowlark-classes    weekly class sessions at the studio
--    ├── meadowlark-schools    residencies and after-school programs, on site
--    └── meadowlark-parties    birthday parties at the studio
--
-- A member of meadowlark-circus reaches all four brands (lib/brand-tree.ts); a
-- member of one venture reaches only that venture. Who is a member is the
-- owner's STAGING_TESTERS setting, never this file.
--
-- Events are synthetic and unpublished: off the landing list and the attendee
-- map. They sit in the same area cell as the CI brand fixture, so no real
-- address is implied. No person, no coordinates, no scans.
--
-- Applied by CI on staging only, after T1 has run the migrations:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/meadowlark-circus-seed.sql
-- Idempotent: every row is an upsert keyed on its fixed id or brand.

INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('meadowlark-classes', 'meadowlark-circus')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'meadowlark-circus';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('meadowlark-schools', 'meadowlark-circus')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'meadowlark-circus';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('meadowlark-parties', 'meadowlark-circus')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'meadowlark-circus';

-- The studio, a venue the school owns. Classes, parties and showcases are held
-- there; school programs are not (they run at the schools).
INSERT INTO venues (id, brand_id, name) VALUES
  ('ven_3ead0a12c1c000000000000000000001', 'meadowlark-circus', 'Meadowlark Circus Studio')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-circus', name = 'Meadowlark Circus Studio';

-- Weekly class sessions (one event per session).
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id)
VALUES ('mdl-classes-winter-2027', 'meadowlark-classes', 'Winter class session: aerials, acrobatics, juggling and more',
        'mdl-classes-winter-2027', 'active', 0, '2027-01-09', '2027-03-13', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_3ead0a12c1c000000000000000000001')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-classes', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_3ead0a12c1c000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id)
VALUES ('mdl-classes-spring-2027', 'meadowlark-classes', 'Spring class session: intro to circus, wheel, stilts and unicycle',
        'mdl-classes-spring-2027', 'active', 0, '2027-04-03', '2027-05-29', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_3ead0a12c1c000000000000000000001')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-classes', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_3ead0a12c1c000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- A school residency (held at the school, so no studio venue).
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7)
VALUES ('mdl-schools-residency-2027', 'meadowlark-schools', 'Circus at school: spring residency',
        'mdl-schools-residency-2027', 'active', 0, '2027-02-01', '2027-05-14', 'America/Chicago', 'synthetic',
        '872664c1affffff')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-schools', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = NULL,
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- A birthday party at the studio.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id)
VALUES ('mdl-parties-birthday-2027', 'meadowlark-parties', 'Circus birthday party (practice booking)',
        'mdl-parties-birthday-2027', 'active', 0, '2027-01-23', '2027-01-23', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_3ead0a12c1c000000000000000000001')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-parties', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_3ead0a12c1c000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- The school's own end-of-season student showcase.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id)
VALUES ('mdl-showcase-spring-2027', 'meadowlark-circus', 'Spring student showcase',
        'mdl-showcase-spring-2027', 'active', 0, '2027-05-30', '2027-05-30', 'America/Chicago', 'synthetic',
        '872664c1affffff', 'ven_3ead0a12c1c000000000000000000001')
ON CONFLICT(id) DO UPDATE SET brand_id = 'meadowlark-circus', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff', host_venue_id = 'ven_3ead0a12c1c000000000000000000001',
  venue_canonical_id = NULL, event_correlation_id = NULL;
