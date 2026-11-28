-- Hollyhock Avenue markets, fairs and walks — staging fixture (test account, owner 2026-11-28).
--
-- A practice account that shows every kind of market, fair and walk a
-- neighborhood runs: a chamber of commerce with its shop strip, restaurant row
-- and markets; an arts collective with galleries, studios and an art center;
-- a historical society's house walks; and a park district that co-hosts with
-- them. Every name is invented for practice on staging only; no real place,
-- business or person is named here.
--
--   hollyhock-chamber          Hollyhock Avenue Chamber of Commerce (holiday stroll, mixer)
--    ├── hollyhock-shops       the shop strip (sidewalk sale, shop small Saturday)
--    ├── hollyhock-eats        restaurant row (restaurant week passport, taste of)
--    └── hollyhock-markets     farmers, night, craft, spring, harvest, swap and winter markets
--   tansy-collective           Tansy Arts Collective
--    ├── tansy-galleries       first Friday art walk, photo opening, mural tour
--    ├── tansy-studios         open studios weekend
--    └── tansy-artcenter       summer art fair, pottery class
--   fernbrook-history          Fernbrook Historical Society (house walk, garden walk, candlelight tour)
--   fernbrook-parks            Fernbrook Park District, a public body (concerts, art in the park)
--
-- Two neighborhoods: Hollyhock Avenue is the CI fixture's area cell (res 7)
-- and Fernbrook its neighbour, so walks and the restaurant week cross from
-- one area into the other. No real address is implied; no coordinates.
--
-- STOPS. A walk, a passport or a market is one event with one booth per stop
-- (a stall, shop, gallery, restaurant or home), and one code per booth
-- (OSE-1998, OSE ADR-034). Scans count per stop, through the same floored
-- cells as every other count. Nothing links one person's scans across stops.
--
-- PARTNERS. A sponsor row belongs to the brand of the events it backs, so a
-- partner from another tree (the restaurant row on the art walk, the park
-- district on the night market, the chamber on the park concerts) is a
-- sponsor row in that event's brand, accepted on both sides. Every event with
-- partners has opted in to sponsors (useSponsors).
--
-- Practice traffic: stand-in scans on five events, one anonymous row per
-- scan; no person, device or session. Five stops stay under 5 on purpose and
-- must read "Fewer than 5". Event pictures are the owner's photographs that
-- the Juniper Grove step puts in the staging uploads bucket
-- (events/practice-art/), so this step runs after it.
--
-- Who may sign in is the owner's STAGING_TESTERS setting, never this file.
-- Events are practice data (data_class 'demo') and unpublished: off the
-- landing list and the attendee map. Never apply to production.
--
-- Applied by CI on staging only, after T1 has run the migrations and after
-- the other practice accounts:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/hollyhock-markets-walks-seed.sql
-- Idempotent: brands, places, events, booths and sponsors are upserts keyed on
-- fixed ids; the practice codes and their scans are cleared and written again.


-- ── the brand trees (two private trees; the historical society and the park district stand alone) ──
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('hollyhock-shops', 'hollyhock-chamber')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'hollyhock-chamber';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('hollyhock-eats', 'hollyhock-chamber')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'hollyhock-chamber';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('hollyhock-markets', 'hollyhock-chamber')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'hollyhock-chamber';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('tansy-galleries', 'tansy-collective')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'tansy-collective';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('tansy-studios', 'tansy-collective')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'tansy-collective';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('tansy-artcenter', 'tansy-collective')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'tansy-collective';

-- ── the places ──
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000001', 'hollyhock-chamber', 'Hollyhock Avenue (the 3000 to 3400 blocks)')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000002', 'hollyhock-markets', 'Hollyhock Station plaza')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000003', 'tansy-artcenter', 'Tansy Art Center')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000004', 'tansy-studios', 'Tansy Mill studio building')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000005', 'fernbrook-parks', 'Fernbrook Park and band shell')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;
INSERT INTO venues (id, brand_id, name) VALUES ('ven_401140c0000000000000000000000006', 'fernbrook-history', 'Fernbrook Historical Society carriage house')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name;

-- ── the events (practice data, unpublished: off the landing list and the map) ──
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-holiday-stroll', 'hollyhock-chamber', 'Holiday stroll: shops open late, cocoa at every stop', 'hha-holiday-stroll', 'active', 0, '2027-12-03', '2027-12-03', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-soc-block', '/api/v2/uploads/events/practice-art/holiday-train.jpg', 'Walk the avenue from 5 to 9 pm. Each open shop has a code at the door. Scan it to see what is on at that stop.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-chamber-mixer', 'hollyhock-chamber', 'Chamber member mixer and new business welcome', 'hha-chamber-mixer', 'active', 0, '2027-02-17', '2027-02-17', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-biz-mixer', '/api/v2/uploads/events/practice-art/storefront-curb.jpg', 'For chamber members and businesses thinking of joining. Short welcome at 6 pm.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-sidewalk-sale', 'hollyhock-shops', 'Sidewalk sale days on Hollyhock Avenue', 'hha-sidewalk-sale', 'active', 0, '2027-07-16', '2027-07-18', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-mkt-flea', '/api/v2/uploads/events/practice-art/city-sidewalk.jpg', 'Shops put their sale racks on the sidewalk. Each shop is a stop with its own code.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-shop-small', 'hollyhock-shops', 'Shop small Saturday', 'hha-shop-small', 'active', 0, '2027-11-27', '2027-11-27', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-mkt-flea', '/api/v2/uploads/events/practice-art/storefront-curb.jpg', 'Local shops only. Pick up a shopping bag at the chamber table.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-restaurant-week', 'hollyhock-eats', 'Restaurant week passport: 8 places, two neighborhoods', 'hha-restaurant-week', 'active', 0, '2027-03-05', '2027-03-14', 'America/Chicago', 'demo', '872664c1affffff', NULL, 'etr-soc-dinner', '/api/v2/uploads/events/practice-art/city-sidewalk.jpg', 'Eight places in Hollyhock Avenue and Fernbrook offer a set menu. Each place has its own code. Scan at each stop. Counts are per stop, never per person.', NULL, 'varies', '{"useSponsors":true,"passport":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-taste-of', 'hollyhock-eats', 'Taste of Hollyhock: small plates on the street', 'hha-taste-of', 'active', 0, '2027-06-12', '2027-06-12', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-soc-block', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'Buy a strip of tasting tickets at the info tent. Each restaurant tent is a stop.', 1500, 'fixed', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-farmers-market', 'hollyhock-markets', 'Saturday farmers market', 'hha-farmers-market', 'active', 0, '2027-05-01', '2027-10-30', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000002', 'etr-gar-harvest', '/api/v2/uploads/events/practice-art/storefront-curb.jpg', 'Every Saturday, 8 am to 1 pm. Farm stands, bread, flowers and honey. Each stall has its own code.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-night-market', 'hollyhock-markets', 'Summer night market with live music in Fernbrook Park', 'hha-night-market', 'active', 0, '2027-07-09', '2027-08-27', 'America/Chicago', 'demo', '872664c1bffffff', NULL, 'etr-art-music', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'Fridays 6 to 10 pm in Fernbrook Park, with the park district. Food stalls, makers and a band on the shell.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-craft-fair', 'hollyhock-markets', 'Holiday craft fair', 'hha-craft-fair', 'active', 0, '2027-12-11', '2027-12-12', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000002', 'etr-mkt-craft', '/api/v2/uploads/events/practice-art/holiday-train.jpg', 'Handmade gifts from local makers. Each stall has a number and a code.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-spring-fair', 'hollyhock-markets', 'Spring fair on the avenue', 'hha-spring-fair', 'active', 0, '2027-05-22', '2027-05-22', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000001', 'etr-soc-block', '/api/v2/uploads/events/practice-art/city-sidewalk.jpg', 'The avenue closes to cars. Kids zone, plant sale and food stalls.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-harvest-fair', 'hollyhock-markets', 'Harvest fair and pumpkin patch', 'hha-harvest-fair', 'active', 0, '2027-10-09', '2027-10-10', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000002', 'etr-gar-harvest', '/api/v2/uploads/events/practice-art/storefront-curb.jpg', 'Pumpkins, cider, hay bales and a costume walk for kids.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-kids-swap', 'hollyhock-markets', 'Kids clothes and toy swap', 'hha-kids-swap', 'active', 0, '2027-08-14', '2027-08-14', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000002', 'etr-mkt-swap', '/api/v2/uploads/events/practice-art/city-sidewalk.jpg', 'Bring what your kids have outgrown, take what fits.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('hha-winter-market', 'hollyhock-markets', 'Winter market under the lights', 'hha-winter-market', 'active', 0, '2027-12-18', '2027-12-19', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000002', 'etr-mkt-craft', '/api/v2/uploads/events/practice-art/holiday-train.jpg', 'Warm drinks, makers and a tree lighting at 5 pm.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-art-walk', 'tansy-galleries', 'First Friday art walk: 9 galleries and studios', 'tac-art-walk', 'active', 0, '2027-06-04', '2027-06-04', 'America/Chicago', 'demo', '872664c1affffff', NULL, 'etr-art-gallery', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'Start anywhere. Galleries on Hollyhock Avenue, studios across the tracks in Fernbrook. Each stop has a code. Co-hosted with the Fernbrook Park District.', NULL, 'free', '{"useSponsors":true,"passport":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-photo-opening', 'tansy-galleries', 'Opening night: neighborhood photographers', 'tac-photo-opening', 'active', 0, '2027-04-09', '2027-04-09', 'America/Chicago', 'demo', '872664c1affffff', NULL, 'etr-art-photo', '/api/v2/uploads/events/practice-art/passenger-seat.jpg', 'Meet the photographers. Light snacks.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-mural-tour', 'tansy-galleries', 'Mural walking tour', 'tac-mural-tour', 'active', 0, '2027-05-15', '2027-05-15', 'America/Chicago', 'demo', '872664c1bffffff', NULL, 'etr-art-mural', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'A one hour guided walk past six murals. Meet at the plaza.', 1000, 'donation', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-open-studios', 'tansy-studios', 'Open studios weekend at the Tansy Mill', 'tac-open-studios', 'active', 0, '2027-09-25', '2027-09-26', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000004', 'etr-art-cultural', '/api/v2/uploads/events/practice-art/passenger-seat.jpg', 'Twelve artists open their studio doors. Each studio has its own code.', NULL, 'free', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-art-fair', 'tansy-artcenter', 'Art center summer art fair', 'tac-art-fair', 'active', 0, '2027-08-07', '2027-08-08', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000003', 'etr-mkt-craft', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'Juried art fair on the lawn: paintings, prints, pottery and jewelry.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('tac-pottery-class', 'tansy-artcenter', 'Beginner pottery class (4 weeks)', 'tac-pottery-class', 'active', 0, '2027-02-02', '2027-02-23', 'America/Chicago', 'demo', '872664c1affffff', 'ven_401140c0000000000000000000000003', 'etr-biz-workshop', '/api/v2/uploads/events/practice-art/court-reflection.jpg', 'Tuesdays 6:30 to 8:30 pm. Clay and firing included.', 12000, 'fixed', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('fbh-house-walk', 'fernbrook-history', 'Historic house walk: 6 homes, one ticket', 'fbh-house-walk', 'active', 0, '2027-05-08', '2027-05-08', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000006', 'etr-art-cultural', '/api/v2/uploads/events/practice-art/storefront-curb.jpg', 'Tickets at the carriage house. Six homes open 10 am to 4 pm. Each home is a stop with its own code. Homes are named by style, never by owner.', 3000, 'fixed', '{"useSponsors":true,"passport":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('fbh-garden-walk', 'fernbrook-history', 'Hidden garden walk', 'fbh-garden-walk', 'active', 0, '2027-06-26', '2027-06-26', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000006', 'etr-gar-trail', '/api/v2/uploads/events/practice-art/court-reflection.jpg', 'Eight back gardens open for the day. Map at the carriage house.', 2000, 'fixed', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('fbh-candlelight-tour', 'fernbrook-history', 'Holiday house tour by candlelight', 'fbh-candlelight-tour', 'active', 0, '2027-12-10', '2027-12-11', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000006', 'etr-art-cultural', '/api/v2/uploads/events/practice-art/holiday-train.jpg', 'Four decorated homes, 5 to 9 pm. Timed entry every 30 minutes.', 3500, 'fixed', '{}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('fbp-concerts', 'fernbrook-parks', 'Concerts in Fernbrook Park, with the Hollyhock Avenue chamber', 'fbp-concerts', 'active', 0, '2027-06-17', '2027-08-19', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000005', 'etr-art-music', '/api/v2/uploads/events/practice-art/court-reflection.jpg', 'Thursdays at 7 pm. The chamber runs the food row. Bring a blanket.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7, host_venue_id, event_type_id, cover_image_url, how_details, price_cents, price_model, settings_json)
VALUES ('fbp-art-in-park', 'fernbrook-parks', 'Art in the park, with the Tansy Arts Collective', 'fbp-art-in-park', 'active', 0, '2027-09-11', '2027-09-11', 'America/Chicago', 'demo', '872664c1bffffff', 'ven_401140c0000000000000000000000005', 'etr-art-cultural', '/api/v2/uploads/events/practice-art/blue-island-mural.jpg', 'Free art stations for all ages, led by collective artists.', NULL, 'free', '{"useSponsors":true}')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'demo', h3_res7 = excluded.h3_res7,
  host_venue_id = excluded.host_venue_id, event_type_id = excluded.event_type_id, cover_image_url = excluded.cover_image_url,
  how_details = excluded.how_details, price_cents = excluded.price_cents, price_model = excluded.price_model,
  settings_json = excluded.settings_json, venue_canonical_id = NULL, event_correlation_id = NULL;

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1).
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('hha-holiday-stroll', 'hha-chamber-mixer', 'hha-sidewalk-sale', 'hha-shop-small', 'hha-restaurant-week', 'hha-taste-of', 'hha-farmers-market', 'hha-night-market', 'hha-craft-fair', 'hha-spring-fair', 'hha-harvest-fair', 'hha-kids-swap', 'hha-winter-market', 'tac-art-walk', 'tac-photo-opening', 'tac-mural-tour', 'tac-open-studios', 'tac-art-fair', 'tac-pottery-class', 'fbh-house-walk', 'fbh-garden-walk', 'fbh-candlelight-tour', 'fbp-concerts', 'fbp-art-in-park');

-- ── stops: each stall, shop, gallery, restaurant or home is a booth with its own code ──
DELETE FROM scan_placement_events WHERE id LIKE 'hha-s-%';
DELETE FROM poster_deployments WHERE id LIKE 'hha-pd-%';
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-rw-1', 'hha-restaurant-week', '1', 'Juniper Table (Hollyhock Avenue)', 'food', 1, 0),
  ('hha-bo-rw-2', 'hha-restaurant-week', '2', 'Saffron Lane Kitchen (Hollyhock Avenue)', 'food', 1, 1),
  ('hha-bo-rw-3', 'hha-restaurant-week', '3', 'Little Plum Bakery (Hollyhock Avenue)', 'food', 1, 2),
  ('hha-bo-rw-4', 'hha-restaurant-week', '4', 'Corner Noodle House (Hollyhock Avenue)', 'food', 1, 3),
  ('hha-bo-rw-5', 'hha-restaurant-week', '5', 'Fernbrook Grill (Fernbrook)', 'food', 1, 4),
  ('hha-bo-rw-6', 'hha-restaurant-week', '6', 'Rye and Robin Deli (Fernbrook)', 'food', 1, 5),
  ('hha-bo-rw-7', 'hha-restaurant-week', '7', 'Tamarind Tacos (Fernbrook)', 'food', 1, 6),
  ('hha-bo-rw-8', 'hha-restaurant-week', '8', 'Station Cafe (Fernbrook)', 'food', 1, 7)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-rw-1', 'hha-restaurant-week', 'qrt_hha-pd-rw-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-rw-1', 1),
  ('hha-pd-rw-2', 'hha-restaurant-week', 'qrt_hha-pd-rw-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-rw-2', 1),
  ('hha-pd-rw-3', 'hha-restaurant-week', 'qrt_hha-pd-rw-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-rw-3', 1),
  ('hha-pd-rw-4', 'hha-restaurant-week', 'qrt_hha-pd-rw-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-rw-4', 1),
  ('hha-pd-rw-5', 'hha-restaurant-week', 'qrt_hha-pd-rw-5', 'Stop 5 (practice)', 'venue', '872664c1bffffff', 'hha-bo-rw-5', 1),
  ('hha-pd-rw-6', 'hha-restaurant-week', 'qrt_hha-pd-rw-6', 'Stop 6 (practice)', 'venue', '872664c1bffffff', 'hha-bo-rw-6', 1),
  ('hha-pd-rw-7', 'hha-restaurant-week', 'qrt_hha-pd-rw-7', 'Stop 7 (practice)', 'venue', '872664c1bffffff', 'hha-bo-rw-7', 1),
  ('hha-pd-rw-8', 'hha-restaurant-week', 'qrt_hha-pd-rw-8', 'Stop 8 (practice)', 'venue', '872664c1bffffff', 'hha-bo-rw-8', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-aw-1', 'tac-art-walk', '1', 'Tansy Gallery (Hollyhock Avenue)', 'art', 1, 0),
  ('hha-bo-aw-2', 'tac-art-walk', '2', 'North Light Gallery (Hollyhock Avenue)', 'art', 1, 1),
  ('hha-bo-aw-3', 'tac-art-walk', '3', 'Paper Moon Prints (Hollyhock Avenue)', 'art', 1, 2),
  ('hha-bo-aw-4', 'tac-art-walk', '4', 'Little Plum Bakery: window show (Hollyhock Avenue)', 'food', 1, 3),
  ('hha-bo-aw-5', 'tac-art-walk', '5', 'Glass and Grain studio (Fernbrook)', 'art', 1, 4),
  ('hha-bo-aw-6', 'tac-art-walk', '6', 'Tansy Mill studios (Fernbrook)', 'art', 1, 5),
  ('hha-bo-aw-7', 'tac-art-walk', '7', 'Fernbrook Library art wall (Fernbrook)', 'community', 1, 6),
  ('hha-bo-aw-8', 'tac-art-walk', '8', 'Fernbrook Park band shell: live painting (Fernbrook)', 'community', 1, 7),
  ('hha-bo-aw-9', 'tac-art-walk', '9', 'Wren Ceramics (Fernbrook)', 'art', 1, 8)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-aw-1', 'tac-art-walk', 'qrt_hha-pd-aw-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-aw-1', 1),
  ('hha-pd-aw-2', 'tac-art-walk', 'qrt_hha-pd-aw-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-aw-2', 1),
  ('hha-pd-aw-3', 'tac-art-walk', 'qrt_hha-pd-aw-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-aw-3', 1),
  ('hha-pd-aw-4', 'tac-art-walk', 'qrt_hha-pd-aw-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-aw-4', 1),
  ('hha-pd-aw-5', 'tac-art-walk', 'qrt_hha-pd-aw-5', 'Stop 5 (practice)', 'venue', '872664c1bffffff', 'hha-bo-aw-5', 1),
  ('hha-pd-aw-6', 'tac-art-walk', 'qrt_hha-pd-aw-6', 'Stop 6 (practice)', 'venue', '872664c1bffffff', 'hha-bo-aw-6', 1),
  ('hha-pd-aw-7', 'tac-art-walk', 'qrt_hha-pd-aw-7', 'Stop 7 (practice)', 'venue', '872664c1bffffff', 'hha-bo-aw-7', 1),
  ('hha-pd-aw-8', 'tac-art-walk', 'qrt_hha-pd-aw-8', 'Stop 8 (practice)', 'venue', '872664c1bffffff', 'hha-bo-aw-8', 1),
  ('hha-pd-aw-9', 'tac-art-walk', 'qrt_hha-pd-aw-9', 'Stop 9 (practice)', 'venue', '872664c1bffffff', 'hha-bo-aw-9', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-hs-1', 'hha-holiday-stroll', '1', 'Chamber welcome table', 'community', 1, 0),
  ('hha-bo-hs-2', 'hha-holiday-stroll', '2', 'Hollyhock Books', 'books', 1, 1),
  ('hha-bo-hs-3', 'hha-holiday-stroll', '3', 'Thread and Thimble', 'clothing', 1, 2),
  ('hha-bo-hs-4', 'hha-holiday-stroll', '4', 'Lantern Hardware', 'other', 1, 3),
  ('hha-bo-hs-5', 'hha-holiday-stroll', '5', 'Little Plum Bakery', 'food', 1, 4),
  ('hha-bo-hs-6', 'hha-holiday-stroll', '6', 'Pocket Toys', 'other', 1, 5),
  ('hha-bo-hs-7', 'hha-holiday-stroll', '7', 'Copper Kettle Tea', 'food', 1, 6),
  ('hha-bo-hs-8', 'hha-holiday-stroll', '8', 'Tansy Gallery', 'art', 1, 7),
  ('hha-bo-hs-9', 'hha-holiday-stroll', '9', 'Bramble Florist', 'other', 1, 8),
  ('hha-bo-hs-10', 'hha-holiday-stroll', '10', 'Hollyhock Community Bank: cocoa stop', 'services', 1, 9)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-hs-1', 'hha-holiday-stroll', 'qrt_hha-pd-hs-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-1', 1),
  ('hha-pd-hs-2', 'hha-holiday-stroll', 'qrt_hha-pd-hs-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-2', 1),
  ('hha-pd-hs-3', 'hha-holiday-stroll', 'qrt_hha-pd-hs-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-3', 1),
  ('hha-pd-hs-4', 'hha-holiday-stroll', 'qrt_hha-pd-hs-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-4', 1),
  ('hha-pd-hs-5', 'hha-holiday-stroll', 'qrt_hha-pd-hs-5', 'Stop 5 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-5', 1),
  ('hha-pd-hs-6', 'hha-holiday-stroll', 'qrt_hha-pd-hs-6', 'Stop 6 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-6', 1),
  ('hha-pd-hs-7', 'hha-holiday-stroll', 'qrt_hha-pd-hs-7', 'Stop 7 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-7', 1),
  ('hha-pd-hs-8', 'hha-holiday-stroll', 'qrt_hha-pd-hs-8', 'Stop 8 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-8', 1),
  ('hha-pd-hs-9', 'hha-holiday-stroll', 'qrt_hha-pd-hs-9', 'Stop 9 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-9', 1),
  ('hha-pd-hs-10', 'hha-holiday-stroll', 'qrt_hha-pd-hs-10', 'Stop 10 (practice)', 'venue', '872664c1affffff', 'hha-bo-hs-10', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-ss-1', 'hha-sidewalk-sale', '1', 'Hollyhock Books', 'books', 1, 0),
  ('hha-bo-ss-2', 'hha-sidewalk-sale', '2', 'Thread and Thimble', 'clothing', 1, 1),
  ('hha-bo-ss-3', 'hha-sidewalk-sale', '3', 'Lantern Hardware', 'other', 1, 2),
  ('hha-bo-ss-4', 'hha-sidewalk-sale', '4', 'Pocket Toys', 'other', 1, 3),
  ('hha-bo-ss-5', 'hha-sidewalk-sale', '5', 'Second Look Resale', 'clothing', 1, 4),
  ('hha-bo-ss-6', 'hha-sidewalk-sale', '6', 'Bramble Florist', 'other', 1, 5),
  ('hha-bo-ss-7', 'hha-sidewalk-sale', '7', 'Run Club Shoes', 'clothing', 1, 6),
  ('hha-bo-ss-8', 'hha-sidewalk-sale', '8', 'Paper Moon Prints', 'art', 1, 7)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-ss-1', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-1', 1),
  ('hha-pd-ss-2', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-2', 1),
  ('hha-pd-ss-3', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-3', 1),
  ('hha-pd-ss-4', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-4', 1),
  ('hha-pd-ss-5', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-5', 'Stop 5 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-5', 1),
  ('hha-pd-ss-6', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-6', 'Stop 6 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-6', 1),
  ('hha-pd-ss-7', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-7', 'Stop 7 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-7', 1),
  ('hha-pd-ss-8', 'hha-sidewalk-sale', 'qrt_hha-pd-ss-8', 'Stop 8 (practice)', 'venue', '872664c1affffff', 'hha-bo-ss-8', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-fm-a1', 'hha-farmers-market', 'A1', 'Oak Hollow Farm: vegetables', 'food', 1, 0),
  ('hha-bo-fm-a2', 'hha-farmers-market', 'A2', 'Two Bees Honey', 'food', 1, 1),
  ('hha-bo-fm-a3', 'hha-farmers-market', 'A3', 'Rise Bread Co.', 'food', 1, 2),
  ('hha-bo-fm-a4', 'hha-farmers-market', 'A4', 'Bramble Florist: cut flowers', 'other', 1, 3),
  ('hha-bo-fm-a5', 'hha-farmers-market', 'A5', 'Meadow Eggs', 'food', 1, 4),
  ('hha-bo-fm-a6', 'hha-farmers-market', 'A6', 'Orchard Row apples', 'food', 1, 5),
  ('hha-bo-fm-b1', 'hha-farmers-market', 'B1', 'Hot Pepper Sauce Co.', 'food', 1, 6),
  ('hha-bo-fm-b2', 'hha-farmers-market', 'B2', 'Goat Hill cheese', 'food', 1, 7),
  ('hha-bo-fm-b3', 'hha-farmers-market', 'B3', 'Herb and Root seedlings', 'other', 1, 8),
  ('hha-bo-fm-b4', 'hha-farmers-market', 'B4', 'Knife sharpening', 'services', 1, 9),
  ('hha-bo-fm-b5', 'hha-farmers-market', 'B5', 'Kids corner: seed planting', 'community', 1, 10),
  ('hha-bo-fm-b6', 'hha-farmers-market', 'B6', 'Market info and tokens', 'community', 1, 11)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-fm-a1', 'hha-farmers-market', 'qrt_hha-pd-fm-a1', 'Stop A1 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a1', 1),
  ('hha-pd-fm-a2', 'hha-farmers-market', 'qrt_hha-pd-fm-a2', 'Stop A2 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a2', 1),
  ('hha-pd-fm-a3', 'hha-farmers-market', 'qrt_hha-pd-fm-a3', 'Stop A3 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a3', 1),
  ('hha-pd-fm-a4', 'hha-farmers-market', 'qrt_hha-pd-fm-a4', 'Stop A4 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a4', 1),
  ('hha-pd-fm-a5', 'hha-farmers-market', 'qrt_hha-pd-fm-a5', 'Stop A5 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a5', 1),
  ('hha-pd-fm-a6', 'hha-farmers-market', 'qrt_hha-pd-fm-a6', 'Stop A6 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-a6', 1),
  ('hha-pd-fm-b1', 'hha-farmers-market', 'qrt_hha-pd-fm-b1', 'Stop B1 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b1', 1),
  ('hha-pd-fm-b2', 'hha-farmers-market', 'qrt_hha-pd-fm-b2', 'Stop B2 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b2', 1),
  ('hha-pd-fm-b3', 'hha-farmers-market', 'qrt_hha-pd-fm-b3', 'Stop B3 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b3', 1),
  ('hha-pd-fm-b4', 'hha-farmers-market', 'qrt_hha-pd-fm-b4', 'Stop B4 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b4', 1),
  ('hha-pd-fm-b5', 'hha-farmers-market', 'qrt_hha-pd-fm-b5', 'Stop B5 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b5', 1),
  ('hha-pd-fm-b6', 'hha-farmers-market', 'qrt_hha-pd-fm-b6', 'Stop B6 (practice)', 'venue', '872664c1affffff', 'hha-bo-fm-b6', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-nm-1', 'hha-night-market', '1', 'Tamarind Tacos', 'food', 1, 0),
  ('hha-bo-nm-2', 'hha-night-market', '2', 'Dumpling Cart', 'food', 1, 1),
  ('hha-bo-nm-3', 'hha-night-market', '3', 'Fernbrook Grill', 'food', 1, 2),
  ('hha-bo-nm-4', 'hha-night-market', '4', 'Shaved ice', 'food', 1, 3),
  ('hha-bo-nm-5', 'hha-night-market', '5', 'Wren Ceramics', 'craft', 1, 4),
  ('hha-bo-nm-6', 'hha-night-market', '6', 'Thread and Thimble pop-up', 'clothing', 1, 5),
  ('hha-bo-nm-7', 'hha-night-market', '7', 'Paper Moon Prints', 'art', 1, 6),
  ('hha-bo-nm-8', 'hha-night-market', '8', 'Park district info tent', 'community', 1, 7),
  ('hha-bo-nm-9', 'hha-night-market', '9', 'Chamber info tent', 'community', 1, 8),
  ('hha-bo-nm-10', 'hha-night-market', '10', 'Face painting', 'services', 1, 9)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-nm-1', 'hha-night-market', 'qrt_hha-pd-nm-1', 'Stop 1 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-1', 1),
  ('hha-pd-nm-2', 'hha-night-market', 'qrt_hha-pd-nm-2', 'Stop 2 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-2', 1),
  ('hha-pd-nm-3', 'hha-night-market', 'qrt_hha-pd-nm-3', 'Stop 3 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-3', 1),
  ('hha-pd-nm-4', 'hha-night-market', 'qrt_hha-pd-nm-4', 'Stop 4 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-4', 1),
  ('hha-pd-nm-5', 'hha-night-market', 'qrt_hha-pd-nm-5', 'Stop 5 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-5', 1),
  ('hha-pd-nm-6', 'hha-night-market', 'qrt_hha-pd-nm-6', 'Stop 6 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-6', 1),
  ('hha-pd-nm-7', 'hha-night-market', 'qrt_hha-pd-nm-7', 'Stop 7 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-7', 1),
  ('hha-pd-nm-8', 'hha-night-market', 'qrt_hha-pd-nm-8', 'Stop 8 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-8', 1),
  ('hha-pd-nm-9', 'hha-night-market', 'qrt_hha-pd-nm-9', 'Stop 9 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-9', 1),
  ('hha-pd-nm-10', 'hha-night-market', 'qrt_hha-pd-nm-10', 'Stop 10 (practice)', 'venue', '872664c1bffffff', 'hha-bo-nm-10', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-cf-1', 'hha-craft-fair', '1', 'Wren Ceramics', 'craft', 1, 0),
  ('hha-bo-cf-2', 'hha-craft-fair', '2', 'Hand-knit hats', 'clothing', 1, 1),
  ('hha-bo-cf-3', 'hha-craft-fair', '3', 'Beeswax candles', 'craft', 1, 2),
  ('hha-bo-cf-4', 'hha-craft-fair', '4', 'Wood toys', 'craft', 1, 3),
  ('hha-bo-cf-5', 'hha-craft-fair', '5', 'Paper Moon Prints', 'art', 1, 4),
  ('hha-bo-cf-6', 'hha-craft-fair', '6', 'Soap and salve', 'craft', 1, 5),
  ('hha-bo-cf-7', 'hha-craft-fair', '7', 'Leather goods', 'craft', 1, 6),
  ('hha-bo-cf-8', 'hha-craft-fair', '8', 'Ornament makers', 'craft', 1, 7),
  ('hha-bo-cf-9', 'hha-craft-fair', '9', 'Quilts', 'craft', 1, 8),
  ('hha-bo-cf-10', 'hha-craft-fair', '10', 'Jewelry by hand', 'art', 1, 9),
  ('hha-bo-cf-11', 'hha-craft-fair', '11', 'Holiday cookies', 'food', 1, 10),
  ('hha-bo-cf-12', 'hha-craft-fair', '12', 'Glass and Grain studio', 'art', 1, 11),
  ('hha-bo-cf-13', 'hha-craft-fair', '13', 'Kids make-and-take', 'community', 1, 12),
  ('hha-bo-cf-14', 'hha-craft-fair', '14', 'Gift wrap for a cause', 'community', 1, 13)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-cf-1', 'hha-craft-fair', 'qrt_hha-pd-cf-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-1', 1),
  ('hha-pd-cf-2', 'hha-craft-fair', 'qrt_hha-pd-cf-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-2', 1),
  ('hha-pd-cf-3', 'hha-craft-fair', 'qrt_hha-pd-cf-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-3', 1),
  ('hha-pd-cf-4', 'hha-craft-fair', 'qrt_hha-pd-cf-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-4', 1),
  ('hha-pd-cf-5', 'hha-craft-fair', 'qrt_hha-pd-cf-5', 'Stop 5 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-5', 1),
  ('hha-pd-cf-6', 'hha-craft-fair', 'qrt_hha-pd-cf-6', 'Stop 6 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-6', 1),
  ('hha-pd-cf-7', 'hha-craft-fair', 'qrt_hha-pd-cf-7', 'Stop 7 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-7', 1),
  ('hha-pd-cf-8', 'hha-craft-fair', 'qrt_hha-pd-cf-8', 'Stop 8 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-8', 1),
  ('hha-pd-cf-9', 'hha-craft-fair', 'qrt_hha-pd-cf-9', 'Stop 9 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-9', 1),
  ('hha-pd-cf-10', 'hha-craft-fair', 'qrt_hha-pd-cf-10', 'Stop 10 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-10', 1),
  ('hha-pd-cf-11', 'hha-craft-fair', 'qrt_hha-pd-cf-11', 'Stop 11 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-11', 1),
  ('hha-pd-cf-12', 'hha-craft-fair', 'qrt_hha-pd-cf-12', 'Stop 12 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-12', 1),
  ('hha-pd-cf-13', 'hha-craft-fair', 'qrt_hha-pd-cf-13', 'Stop 13 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-13', 1),
  ('hha-pd-cf-14', 'hha-craft-fair', 'qrt_hha-pd-cf-14', 'Stop 14 (practice)', 'venue', '872664c1affffff', 'hha-bo-cf-14', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-os-1', 'tac-open-studios', '1', 'Studio 1: painting', 'art', 1, 0),
  ('hha-bo-os-2', 'tac-open-studios', '2', 'Studio 2: printmaking', 'art', 1, 1),
  ('hha-bo-os-3', 'tac-open-studios', '3', 'Studio 3: ceramics', 'art', 1, 2),
  ('hha-bo-os-4', 'tac-open-studios', '4', 'Studio 4: glass', 'art', 1, 3),
  ('hha-bo-os-5', 'tac-open-studios', '5', 'Studio 5: weaving', 'art', 1, 4),
  ('hha-bo-os-6', 'tac-open-studios', '6', 'Studio 6: photography', 'art', 1, 5),
  ('hha-bo-os-7', 'tac-open-studios', '7', 'Studio 7: jewelry', 'art', 1, 6),
  ('hha-bo-os-8', 'tac-open-studios', '8', 'Studio 8: wood', 'art', 1, 7),
  ('hha-bo-os-9', 'tac-open-studios', '9', 'Studio 9: sculpture', 'art', 1, 8),
  ('hha-bo-os-10', 'tac-open-studios', '10', 'Studio 10: illustration', 'art', 1, 9),
  ('hha-bo-os-11', 'tac-open-studios', '11', 'Studio 11: textile', 'art', 1, 10),
  ('hha-bo-os-12', 'tac-open-studios', '12', 'Studio 12: mixed media', 'art', 1, 11)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-os-1', 'tac-open-studios', 'qrt_hha-pd-os-1', 'Stop 1 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-1', 1),
  ('hha-pd-os-2', 'tac-open-studios', 'qrt_hha-pd-os-2', 'Stop 2 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-2', 1),
  ('hha-pd-os-3', 'tac-open-studios', 'qrt_hha-pd-os-3', 'Stop 3 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-3', 1),
  ('hha-pd-os-4', 'tac-open-studios', 'qrt_hha-pd-os-4', 'Stop 4 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-4', 1),
  ('hha-pd-os-5', 'tac-open-studios', 'qrt_hha-pd-os-5', 'Stop 5 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-5', 1),
  ('hha-pd-os-6', 'tac-open-studios', 'qrt_hha-pd-os-6', 'Stop 6 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-6', 1),
  ('hha-pd-os-7', 'tac-open-studios', 'qrt_hha-pd-os-7', 'Stop 7 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-7', 1),
  ('hha-pd-os-8', 'tac-open-studios', 'qrt_hha-pd-os-8', 'Stop 8 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-8', 1),
  ('hha-pd-os-9', 'tac-open-studios', 'qrt_hha-pd-os-9', 'Stop 9 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-9', 1),
  ('hha-pd-os-10', 'tac-open-studios', 'qrt_hha-pd-os-10', 'Stop 10 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-10', 1),
  ('hha-pd-os-11', 'tac-open-studios', 'qrt_hha-pd-os-11', 'Stop 11 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-11', 1),
  ('hha-pd-os-12', 'tac-open-studios', 'qrt_hha-pd-os-12', 'Stop 12 (practice)', 'venue', '872664c1bffffff', 'hha-bo-os-12', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-af-1', 'tac-art-fair', '1', 'Oil paintings', 'art', 1, 0),
  ('hha-bo-af-2', 'tac-art-fair', '2', 'Watercolors', 'art', 1, 1),
  ('hha-bo-af-3', 'tac-art-fair', '3', 'Screen prints', 'art', 1, 2),
  ('hha-bo-af-4', 'tac-art-fair', '4', 'Pottery', 'craft', 1, 3),
  ('hha-bo-af-5', 'tac-art-fair', '5', 'Jewelry', 'art', 1, 4),
  ('hha-bo-af-6', 'tac-art-fair', '6', 'Photography', 'art', 1, 5),
  ('hha-bo-af-7', 'tac-art-fair', '7', 'Woodturning', 'craft', 1, 6),
  ('hha-bo-af-8', 'tac-art-fair', '8', 'Glass', 'art', 1, 7),
  ('hha-bo-af-9', 'tac-art-fair', '9', 'Fiber art', 'craft', 1, 8),
  ('hha-bo-af-10', 'tac-art-fair', '10', 'Sculpture', 'art', 1, 9),
  ('hha-bo-af-11', 'tac-art-fair', '11', 'Kids art tent', 'community', 1, 10),
  ('hha-bo-af-12', 'tac-art-fair', '12', 'Lemonade stand', 'food', 1, 11)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-af-1', 'tac-art-fair', 'qrt_hha-pd-af-1', 'Stop 1 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-1', 1),
  ('hha-pd-af-2', 'tac-art-fair', 'qrt_hha-pd-af-2', 'Stop 2 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-2', 1),
  ('hha-pd-af-3', 'tac-art-fair', 'qrt_hha-pd-af-3', 'Stop 3 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-3', 1),
  ('hha-pd-af-4', 'tac-art-fair', 'qrt_hha-pd-af-4', 'Stop 4 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-4', 1),
  ('hha-pd-af-5', 'tac-art-fair', 'qrt_hha-pd-af-5', 'Stop 5 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-5', 1),
  ('hha-pd-af-6', 'tac-art-fair', 'qrt_hha-pd-af-6', 'Stop 6 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-6', 1),
  ('hha-pd-af-7', 'tac-art-fair', 'qrt_hha-pd-af-7', 'Stop 7 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-7', 1),
  ('hha-pd-af-8', 'tac-art-fair', 'qrt_hha-pd-af-8', 'Stop 8 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-8', 1),
  ('hha-pd-af-9', 'tac-art-fair', 'qrt_hha-pd-af-9', 'Stop 9 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-9', 1),
  ('hha-pd-af-10', 'tac-art-fair', 'qrt_hha-pd-af-10', 'Stop 10 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-10', 1),
  ('hha-pd-af-11', 'tac-art-fair', 'qrt_hha-pd-af-11', 'Stop 11 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-11', 1),
  ('hha-pd-af-12', 'tac-art-fair', 'qrt_hha-pd-af-12', 'Stop 12 (practice)', 'venue', '872664c1affffff', 'hha-bo-af-12', 1);
INSERT INTO event_booths (id, event_id, number, name, category, is_active, sort) VALUES
  ('hha-bo-hw-1', 'fbh-house-walk', '1', 'Queen Anne house, 1891', 'community', 1, 0),
  ('hha-bo-hw-2', 'fbh-house-walk', '2', 'Prairie style house, 1912', 'community', 1, 1),
  ('hha-bo-hw-3', 'fbh-house-walk', '3', 'Brick bungalow, 1924', 'community', 1, 2),
  ('hha-bo-hw-4', 'fbh-house-walk', '4', 'Craftsman house, 1916', 'community', 1, 3),
  ('hha-bo-hw-5', 'fbh-house-walk', '5', 'Italianate house, 1878', 'community', 1, 4),
  ('hha-bo-hw-6', 'fbh-house-walk', '6', 'Carriage house and tea table', 'food', 1, 5)
ON CONFLICT(id) DO UPDATE SET number = excluded.number, name = excluded.name, category = excluded.category, is_active = 1, sort = excluded.sort;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, booth_id, is_active) VALUES
  ('hha-pd-hw-1', 'fbh-house-walk', 'qrt_hha-pd-hw-1', 'Stop 1 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-1', 1),
  ('hha-pd-hw-2', 'fbh-house-walk', 'qrt_hha-pd-hw-2', 'Stop 2 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-2', 1),
  ('hha-pd-hw-3', 'fbh-house-walk', 'qrt_hha-pd-hw-3', 'Stop 3 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-3', 1),
  ('hha-pd-hw-4', 'fbh-house-walk', 'qrt_hha-pd-hw-4', 'Stop 4 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-4', 1),
  ('hha-pd-hw-5', 'fbh-house-walk', 'qrt_hha-pd-hw-5', 'Stop 5 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-5', 1),
  ('hha-pd-hw-6', 'fbh-house-walk', 'qrt_hha-pd-hw-6', 'Stop 6 (practice)', 'venue', '872664c1bffffff', 'hha-bo-hw-6', 1);

-- ── practice scans: one anonymous row per scan; no person, device or session ──
-- The JSON maps each practice code to its scans per hour (6, 7 and 8 pm on
-- 2026-11-21). json_each turns it into rows, so the file stays small and holds
-- no compound SELECT. A stop with fewer than 5 in its only hour reads
-- "Fewer than 5".
INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
SELECT 'hha-s-' || substr(p.id, 8) || '-' || h.key || '-' || n.value, p.event_id, p.id,
       '2026-11-21T' || (18 + h.key) || ':00'
  FROM json_each('{"hha-pd-rw-1":[9],"hha-pd-rw-2":[8],"hha-pd-rw-3":[9],"hha-pd-rw-4":[5,7],"hha-pd-rw-5":[7,9],"hha-pd-rw-6":[8,6],"hha-pd-rw-7":[5,7],"hha-pd-rw-8":[3],"hha-pd-aw-1":[9,5],"hha-pd-aw-2":[7,7],"hha-pd-aw-3":[9],"hha-pd-aw-4":[5,9],"hha-pd-aw-5":[6,5],"hha-pd-aw-6":[8,7],"hha-pd-aw-7":[2],"hha-pd-aw-8":[9,8],"hha-pd-aw-9":[5,9],"hha-pd-fm-a1":[6,9],"hha-pd-fm-a2":[6,6],"hha-pd-fm-a3":[6],"hha-pd-fm-a4":[6],"hha-pd-fm-a5":[7],"hha-pd-fm-a6":[5],"hha-pd-fm-b1":[5],"hha-pd-fm-b2":[7],"hha-pd-fm-b3":[8,8],"hha-pd-fm-b4":[2],"hha-pd-fm-b5":[9,8],"hha-pd-fm-b6":[9],"hha-pd-cf-1":[5],"hha-pd-cf-2":[7],"hha-pd-cf-3":[8,5],"hha-pd-cf-4":[7],"hha-pd-cf-5":[7],"hha-pd-cf-6":[6],"hha-pd-cf-7":[9],"hha-pd-cf-8":[9],"hha-pd-cf-9":[5,9],"hha-pd-cf-10":[9],"hha-pd-cf-11":[8],"hha-pd-cf-12":[6,6],"hha-pd-cf-13":[9],"hha-pd-cf-14":[2],"hha-pd-hw-1":[8,6],"hha-pd-hw-2":[6],"hha-pd-hw-3":[5,5],"hha-pd-hw-4":[9,5],"hha-pd-hw-5":[9],"hha-pd-hw-6":[4]}') AS c
  JOIN poster_deployments p ON p.id = c.key
  JOIN json_each(c.value) AS h
  JOIN json_each('[1,2,3,4,5,6,7,8,9]') AS n ON n.value <= h.value;

-- ── sponsors and partners (each one lives in the brand of the events it backs; both sides accepted) ──
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_hha_cu_mkts', 'hollyhock-markets', 'Hollyhock Community Bank', 'Hollyhock Community Bank', 'finance', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_hha_bakery_mkts', 'hollyhock-markets', 'Little Plum Bakery', 'Little Plum Bakery', 'cafe', 'standard', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_hha_parks_mkts', 'hollyhock-markets', 'Fernbrook Park District (partner)', 'Fernbrook Park District', 'nonprofit', 'standard', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_hha_tansy_eats', 'hollyhock-eats', 'Tansy Arts Collective (partner)', 'Tansy Arts Collective', 'nonprofit', 'standard', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_hha_cu_eats', 'hollyhock-eats', 'Hollyhock Community Bank', 'Hollyhock Community Bank', 'finance', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_tac_eats_gal', 'tansy-galleries', 'Hollyhock Avenue restaurant row', 'Hollyhock Avenue restaurant row', 'restaurant', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_tac_parks_gal', 'tansy-galleries', 'Fernbrook Park District (co-host)', 'Fernbrook Park District', 'nonprofit', 'standard', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_tac_cu_center', 'tansy-artcenter', 'Hollyhock Community Bank', 'Hollyhock Community Bank', 'finance', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_fbh_hardware', 'fernbrook-history', 'Lantern Hardware', 'Lantern Hardware', 'retail', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_fbh_chamber', 'fernbrook-history', 'Hollyhock Avenue Chamber of Commerce (partner)', 'Hollyhock Avenue Chamber', 'nonprofit', 'standard', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_fbp_chamber', 'fernbrook-parks', 'Hollyhock Avenue Chamber of Commerce (co-host)', 'Hollyhock Avenue Chamber', 'nonprofit', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_business (id, brand_id, name, display_name, business_kind, tier, is_active) VALUES ('sb_fbp_tansy', 'fernbrook-parks', 'Tansy Arts Collective (co-host)', 'Tansy Arts Collective', 'nonprofit', 'gold', 1)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, name = excluded.name, display_name = excluded.display_name, business_kind = excluded.business_kind, tier = excluded.tier, is_active = 1;
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_hha_cu_mkts_hha_farmers_market', 'sb_hha_cu_mkts', 'hha-farmers-market', 'gold', 'organizer', 1, 1, 1),
  ('spl_hha_cu_mkts_hha_night_market', 'sb_hha_cu_mkts', 'hha-night-market', 'gold', 'organizer', 1, 1, 1),
  ('spl_hha_cu_mkts_hha_craft_fair', 'sb_hha_cu_mkts', 'hha-craft-fair', 'gold', 'organizer', 1, 1, 1),
  ('spl_hha_cu_mkts_hha_harvest_fair', 'sb_hha_cu_mkts', 'hha-harvest-fair', 'gold', 'organizer', 1, 1, 1),
  ('spl_hha_bakery_mkts_hha_farmers_market', 'sb_hha_bakery_mkts', 'hha-farmers-market', 'standard', 'organizer', 1, 1, 1),
  ('spl_hha_parks_mkts_hha_night_market', 'sb_hha_parks_mkts', 'hha-night-market', 'standard', 'organizer', 1, 1, 1),
  ('spl_hha_tansy_eats_hha_restaurant_week', 'sb_hha_tansy_eats', 'hha-restaurant-week', 'standard', 'organizer', 1, 1, 1),
  ('spl_hha_cu_eats_hha_restaurant_week', 'sb_hha_cu_eats', 'hha-restaurant-week', 'gold', 'organizer', 1, 1, 1),
  ('spl_tac_eats_gal_tac_art_walk', 'sb_tac_eats_gal', 'tac-art-walk', 'gold', 'organizer', 1, 1, 1),
  ('spl_tac_parks_gal_tac_art_walk', 'sb_tac_parks_gal', 'tac-art-walk', 'standard', 'organizer', 1, 1, 1),
  ('spl_tac_cu_center_tac_art_fair', 'sb_tac_cu_center', 'tac-art-fair', 'gold', 'organizer', 1, 1, 1),
  ('spl_fbh_hardware_fbh_house_walk', 'sb_fbh_hardware', 'fbh-house-walk', 'gold', 'organizer', 1, 1, 1),
  ('spl_fbh_chamber_fbh_house_walk', 'sb_fbh_chamber', 'fbh-house-walk', 'standard', 'organizer', 1, 1, 1),
  ('spl_fbp_chamber_fbp_concerts', 'sb_fbp_chamber', 'fbp-concerts', 'gold', 'organizer', 1, 1, 1),
  ('spl_fbp_tansy_fbp_art_in_park', 'sb_fbp_tansy', 'fbp-art-in-park', 'gold', 'organizer', 1, 1, 1)
ON CONFLICT(id) DO UPDATE SET tier = excluded.tier, source = 'organizer', is_active = 1, sponsor_accepted = 1, organizer_accepted = 1;
