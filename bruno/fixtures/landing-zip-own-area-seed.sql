-- Landing zip lookup: a zip shows its own area (owner 2026-11-05) — staging fixture.
--
-- Three published, synthetic events on the root brand, each inside its own town's
-- Census zip boundary and one res-7 ring from Mount Greenwood's (60655) cell. The
-- old 8-ring "near" listed all three for 60655; a zip's own area lists only its own.
--   zip-own-mount-greenwood  41.681,-87.711  60655  no address (nearest zip center)
--   zip-own-oak-lawn         41.698,-87.740  60453  address ends "IL 60453"
--   zip-own-evergreen-park   41.708,-87.706  60805  no address (nearest zip center)
-- Cells from h3-js latLngToCell at res 7 and res 9, as lib/h3-tagging.ts tags them.
--
-- Read by bruno/ose-pages/1. Landing - Public/GET -?zip=60655 and -?zip=60453.
-- Applied by CI before the Bruno contract run (pages section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/landing-zip-own-area-seed.sql
--
-- Dates are relative (10 days out) so the rows never age off the landing list.
-- Published only for the Bruno run: landing-zip-own-area-reset.sql unpublishes them
-- right after it (CI step "Unpublish landing zip own-area fixture").
-- Idempotent: every row is an upsert by fixed id. Never apply to production.

INSERT INTO events (id, brand_id, title, slug, status, is_published, location, where_address,
                    start_date, end_date, timezone, data_class, lat, lon, h3_res9, h3_res7)
VALUES
  ('zip-own-mount-greenwood', 'root', 'Zip Own Area Check (Mount Greenwood)', 'zip-own-mount-greenwood',
   'active', 1, 'A hall', NULL, date('now', '+10 days'), date('now', '+10 days'), 'America/Chicago',
   'synthetic', 41.681, -87.711, '8926645702fffff', '872664570ffffff'),
  ('zip-own-oak-lawn', 'root', 'Zip Own Area Check (Oak Lawn)', 'zip-own-oak-lawn',
   'active', 1, 'A hall', '1 Main St, Oak Lawn, IL 60453', date('now', '+10 days'), date('now', '+10 days'),
   'America/Chicago', 'synthetic', 41.698, -87.740, '8926645766fffff', '872664576ffffff'),
  ('zip-own-evergreen-park', 'root', 'Zip Own Area Check (Evergreen Park)', 'zip-own-evergreen-park',
   'active', 1, 'A hall', NULL, date('now', '+10 days'), date('now', '+10 days'), 'America/Chicago',
   'synthetic', 41.708, -87.706, '8926645740fffff', '872664574ffffff')
ON CONFLICT(id) DO UPDATE SET
  brand_id = excluded.brand_id, title = excluded.title, status = 'active', is_published = 1,
  where_address = excluded.where_address, start_date = excluded.start_date,
  end_date = excluded.end_date, data_class = 'synthetic', lat = excluded.lat, lon = excluded.lon,
  h3_res9 = excluded.h3_res9, h3_res7 = excluded.h3_res7,
  -- A spine-key input may have changed, so both keys are cleared (OSE-1615).
  venue_canonical_id = NULL, event_correlation_id = NULL;
